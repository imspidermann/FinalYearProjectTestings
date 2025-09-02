import fs from "fs";
import path from "path";

/* mu-law -> PCM16LE conversion (RFC 3551) */
const MULAW_MAX = 0x1FFF;
const MULAW_BIAS = 33;

export function mulawToPcm16LE(muLawBuffer: Buffer): Buffer {
  const len = muLawBuffer.length;
  const out = Buffer.alloc(len * 2);
  for (let i = 0; i < len; i++) {
    const sample = muLawDecode(muLawBuffer[i]);
    out.writeInt16LE(sample, i * 2);
  }
  return out;
}

function muLawDecode(muLawByte: number): number {
  muLawByte = ~muLawByte & 0xff;
  const sign = (muLawByte & 0x80) ? -1 : 1;
  const exponent = (muLawByte >> 4) & 0x07;
  const mantissa = muLawByte & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample = sign === -1 ? -sample : sample;
  return sample;
}

/* strip RIFF header if present (Azure may return RIFF) -> return raw mu-law data */
export function stripRiffHeaderToRawMulaw(buf: Buffer): Buffer {
  if (buf.length >= 12 && buf.slice(0, 4).toString("ascii") === "RIFF") {
    const dataIdx = buf.indexOf(Buffer.from("data"));
    if (dataIdx !== -1) {
      const audioStart = dataIdx + 8;
      return buf.slice(audioStart);
    }
    // fallback: remove 44-byte header
    return buf.slice(44);
  }
  return buf;
}