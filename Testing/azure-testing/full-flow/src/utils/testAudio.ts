import { WebSocket } from "ws";

// µ-law conversion
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

function pcm16ToMulawBuffer(pcm16: Buffer): Buffer {
  const out = Buffer.alloc(pcm16.length / 2);
  for (let i = 0; i < out.length; i++) {
    const sample = pcm16.readInt16LE(i * 2);
    out[i] = pcm16ToMulawSample(sample);
  }
  return out;
}

// Generate 1 second of 440Hz sine wave at 8kHz, 16-bit PCM
export function generateSinePCM16(frequency = 440, durationSec = 1, sampleRate = 8000) {
  const samples = sampleRate * durationSec;
  const buffer = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const t = i / sampleRate;
    const amplitude = 0.5 * 32767; // half volume
    const value = Math.round(amplitude * Math.sin(2 * Math.PI * frequency * t));
    buffer.writeInt16LE(value, i * 2);
  }
  return buffer;
}

// Send over Twilio WebSocket
export function sendTestAudio(ws: WebSocket, streamSid: string = "test") {
  const pcm16 = generateSinePCM16();
  const mulaw = pcm16ToMulawBuffer(pcm16);
  const CHUNK_SIZE = 160;

  let index = 0;
  const interval = setInterval(() => {
    if (!ws || ws.readyState !== ws.OPEN || index >= mulaw.length) {
      ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: "" } }));
      clearInterval(interval);
      return;
    }
    const chunk = mulaw.slice(index, index + CHUNK_SIZE);
    ws.send(JSON.stringify({ event: "media", streamSid, media: { payload: chunk.toString("base64") } }));
    index += CHUNK_SIZE;
  }, 20);
}
