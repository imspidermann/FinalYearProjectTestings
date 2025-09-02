import axios from "axios";
import { Buffer } from "buffer";

// Convert PCM16 -> 8-bit µ-law for Twilio
function pcm16ToMulawSample(sample: number): number {
  const MULAW_MAX = 0x1FFF;
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

export function pcm16ToMulawBuffer(pcm16: Buffer): Buffer {
  const out = Buffer.alloc(pcm16.length / 2);
  for (let i = 0; i < out.length; i++) {
    const sample = pcm16.readInt16LE(i * 2);
    out[i] = pcm16ToMulawSample(sample);
  }
  return out;
}

// Resample to 8kHz
export function resampleTo8kHz(inputBuffer: Buffer, inputSampleRate: number): Buffer {
  const outputSampleRate = 8000;
  const ratio = inputSampleRate / outputSampleRate;
  const inputSamples = inputBuffer.length / 2;
  const outputSamples = Math.floor(inputSamples / ratio);
  const outputBuffer = Buffer.alloc(outputSamples * 2);
  for (let i = 0; i < outputSamples; i++) {
    const inputIndex = Math.floor(i * ratio) * 2;
    if (inputIndex + 1 < inputBuffer.length) {
      const sample = inputBuffer.readInt16LE(inputIndex);
      outputBuffer.writeInt16LE(sample, i * 2);
    }
  }
  return outputBuffer;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: string;
}

export class ElevenLabsTTSClient {
  private apiKey: string;
  private baseUrl: string = "https://api.elevenlabs.io/v1";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    if (!this.apiKey) console.warn("ElevenLabs API key missing");
  }

  async getVoices(): Promise<ElevenLabsVoice[]> {
    if (!this.apiKey) {
      return [
        { voice_id: "pNInz6obpgDQGcFmaJgB", name: "Adam", category: "premade" },
        { voice_id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", category: "premade" },
      ];
    }

    try {
      const response = await axios.get(`${this.baseUrl}/voices`, {
        headers: { "xi-api-key": this.apiKey },
      });
      console.log("Received WAV buffer length:", response.data.byteLength);
      return response.data.voices || [];
    } catch (error) {
      console.error("Error fetching voices:", error);
      return [];
    }
  }

  synthesizeTextStream(
    text: string,
    voiceId: string,
    onAudioChunk: (base64Mulaw: string) => void
  ): { promise: Promise<void>; cancel: () => void } {
    if (!this.apiKey || !text.trim()) {
      onAudioChunk(""); // end immediately
      return { promise: Promise.resolve(), cancel: () => {} };
    }

    let cancelled = false;
    let chunkInterval: NodeJS.Timeout | null = null;

    const p = new Promise<void>(async (resolve, reject) => {
      try {
        const streamingUrl = `${this.baseUrl}/text-to-speech/${voiceId}/stream`;
        const requestData = {
          text: text,
          model_id: "eleven_turbo_v2",
          voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0, use_speaker_boost: true },
        };

        // Request WAV output
        const response = await axios.post(streamingUrl, requestData, {
          headers: {
            "Accept": "audio/wav",
            "Content-Type": "application/json",
            "xi-api-key": this.apiKey,
          },
          responseType: "arraybuffer",
          timeout: 30000,
        });

        if (cancelled) return resolve();
        const pcm16Buffer = this.extractPCMFromWAV(Buffer.from(response.data));
        const resampledPCM = resampleTo8kHz(pcm16Buffer, 22050);
        const mulaw = pcm16ToMulawBuffer(resampledPCM);

        const CHUNK_SIZE = 160;
        const CHUNK_INTERVAL_MS = 20;
        let chunkIndex = 0;

        const sendNextChunk = () => {
          if (cancelled || chunkIndex >= mulaw.length) {
            if (chunkInterval) clearInterval(chunkInterval);
            onAudioChunk("");
            return resolve();
          }
          const chunk = mulaw.slice(chunkIndex, chunkIndex + CHUNK_SIZE);
          onAudioChunk(chunk.toString("base64"));
          chunkIndex += CHUNK_SIZE;
        };

        sendNextChunk();
        if (chunkIndex < mulaw.length) chunkInterval = setInterval(sendNextChunk, CHUNK_INTERVAL_MS);
      } catch (error) {
        console.error("ElevenLabs TTS synthesis error:", error);
        reject(error);
      }
    });

    const cancel = () => {
      cancelled = true;
      if (chunkInterval) clearInterval(chunkInterval);
    };

    return { promise: p, cancel };
  }

  private extractPCMFromWAV(buffer: Buffer): Buffer {
    if (buffer.length < 44) return buffer; // treat raw PCM
    if (buffer.slice(0, 4).toString() !== "RIFF" || buffer.slice(8, 12).toString() !== "WAVE") return buffer;

    let offset = 12;
    while (offset < buffer.length - 8) {
      const chunkId = buffer.slice(offset, offset + 4).toString();
      const chunkSize = buffer.readUInt32LE(offset + 4);
      if (chunkId === "data") return buffer.slice(offset + 8, offset + 8 + chunkSize);
      offset += 8 + chunkSize;
    }
    return Buffer.alloc(0);
  }
}
