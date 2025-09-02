import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { stripRiffHeaderToRawMulaw } from "../utils/audioUtils";

// Convert PCM16 -> 8-bit Âµ-law for Twilio
function pcm16ToMulawSample(sample: number): number {
  const MULAW_MAX = 0x1FFF;
  const MULAW_BIAS = 33;

  let sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  sample = Math.min(sample, MULAW_MAX);

  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; expMask >>= 1) {
    exponent--;
  }

  let mantissa = (sample >> (exponent + 3)) & 0x0F;
  return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

function pcm16ToMulawBuffer(pcm16: Buffer): Buffer {
  const out = Buffer.alloc(pcm16.length / 2);
  for (let i = 0; i < out.length; i++) {
    const sample = pcm16.readInt16LE(i * 2);
    out[i] = pcm16ToMulawSample(sample);
  }
  return out;
}

export class AzureTTSClient {
  private key: string;
  private region: string;

  constructor(key: string, region: string) {
    this.key = key;
    this.region = region;
    if (!this.key || !this.region) {
      console.warn("Azure TTS key/region missing");
    }
  }

  synthesizeTextStream(
    text: string,
    voiceName: string,
    onAudioChunk: (base64Mulaw: string) => void
  ): { promise: Promise<void>; cancel: () => void } {
    if (!this.key || !this.region) {
      return { promise: Promise.resolve(), cancel: () => {} };
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(this.key, this.region);
    speechConfig.speechSynthesisVoiceName = voiceName || "en-IN-NeerjaNeural";
    // 8 kHz PCM16 for Twilio
    // @ts-ignore
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff8Khz16BitMonoPcm;

    let synthesizer: sdk.SpeechSynthesizer | null = null;

    const p = new Promise<void>((resolve, reject) => {
      synthesizer = new sdk.SpeechSynthesizer(speechConfig, undefined);

      synthesizer.speakTextAsync(
        text,
        result => {
          try {
            if (result.audioData) {
              const pcm16 = stripRiffHeaderToRawMulaw(Buffer.from(result.audioData));
              const mulaw = pcm16ToMulawBuffer(pcm16);

              // Chunk audio for Twilio
              const MAX_CHUNK = 3200;
              for (let i = 0; i < mulaw.length; i += MAX_CHUNK) {
                const chunk = mulaw.slice(i, i + MAX_CHUNK);
                onAudioChunk(chunk.toString("base64"));
              }
            }

            // Signal end of stream
            onAudioChunk("");

            console.log("TTS finished sending all chunks.");
          } catch (err) {
            console.error("TTS error:", err);
          } finally {
            synthesizer?.close();
            resolve();
          }
        },
        err => {
          try { synthesizer?.close(); } catch {}
          reject(err);
        }
      );
    });

    const cancel = () => {
      try { synthesizer?.close(); } catch {}
    };

    return { promise: p, cancel };
  }
}

