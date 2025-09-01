import * as sdk from "microsoft-cognitiveservices-speech-sdk";

// Convert PCM16 -> 8-bit µ-law
function pcm16ToMulawSample(sample: number): number {
  const MULAW_MAX = 0x1fff;
  const MULAW_BIAS = 33;

  let sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  sample = Math.min(sample, MULAW_MAX);

  let exponent = 7;
  for (
    let expMask = 0x4000;
    (sample & expMask) === 0 && exponent > 0;
    expMask >>= 1
  ) {
    exponent--;
  }

  let mantissa = (sample >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function pcm16ToMulawBuffer(pcm16: Buffer): Buffer {
  const out = Buffer.alloc(pcm16.length / 2);
  for (let i = 0; i < out.length; i++) {
    const sample = pcm16.readInt16LE(i * 2);
    out[i] = pcm16ToMulawSample(sample);
  }
  return out;
}

// Remove RIFF header from PCM16 WAV
function stripRiffHeader(buf: Buffer): Buffer {
  // RIFF header is 44 bytes
  if (buf.length > 44) return buf.slice(44);
  return buf;
}

export class AzureTTSClient {
  private synthesizer: sdk.SpeechSynthesizer | null = null;

  constructor(private key: string, private region: string) {
    if (!key || !region) console.warn("Azure TTS key/region missing");
  }

  synthesizeTextStream(
    text: string,
    voiceName: string,
    onAudioChunk: (base64Mulaw: string) => void
  ): { promise: Promise<void>; cancel: () => void } {
    if (!this.key || !this.region) {
      return { promise: Promise.resolve(), cancel: () => {} };
    }

    const speechConfig = sdk.SpeechConfig.fromSubscription(
      this.key,
      this.region
    );
    speechConfig.speechSynthesisVoiceName = voiceName || "en-IN-PrabhatNeural";
    // Use PCM16 so we can convert manually
    // @ts-ignore
    speechConfig.speechSynthesisOutputFormat =
      sdk.SpeechSynthesisOutputFormat.Riff16Khz16BitMonoPcm;

    this.synthesizer = new sdk.SpeechSynthesizer(speechConfig);

    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      try {
        this.synthesizer?.close();
      } catch {}
    };

    const promise = new Promise<void>((resolve, reject) => {
      // Incremental audio events
      // @ts-ignore
      this.synthesizer.synthesizing = (_s, e) => {
        if (cancelled) return;
        try {
          // e.result.audioData is the incremental audio chunk (Uint8Array / Buffer)
          const audioChunk = e.result.audioData;
          if (!audioChunk) return;

          const buf = Buffer.from(audioChunk); // convert to Node.js Buffer
          const pcm16 = stripRiffHeader(buf); // remove RIFF header
          const mulaw = pcm16ToMulawBuffer(pcm16); // convert PCM16 -> µ-law
          onAudioChunk(mulaw.toString("base64"));
        } catch (err) {
          console.error("Error in synthesizing event:", err);
        }
      };

      this.synthesizer?.speakTextAsync(
        text,
        (result: any) => {
          try {
            if (result && result.audioData) {
              const pcm16 = stripRiffHeader(Buffer.from(result.audioData));
              const mulaw = pcm16ToMulawBuffer(pcm16);
              onAudioChunk(mulaw.toString("base64"));
            }
          } catch (err) {
            console.error("Error in final TTS callback:", err);
          }
          this.synthesizer?.close();
          resolve();
        },
        (err: any) => {
          this.synthesizer?.close();
          reject(err);
        }
      );
    });

    return { promise, cancel };
  }
}
