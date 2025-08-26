import fs from "fs";
import path from "path";

const MULAW_MAX = 0x1FFF;
const MULAW_BIAS = 33;

/**
 * Convert a Buffer of 8-bit mu-law (u-law) samples into PCM16LE Buffer.
 * Twilio sends base64 payload that is usually u-law (g711_ulaw).
 */

export function mulawToPcm16LE(muLawBuffer: Buffer) : Buffer {
    const samples = new Int16Array(muLawBuffer.length);
    for(let i = 0; i < muLawBuffer.length; i++){
        samples[i] = mulawDecode(muLawBuffer[i]);
    }

    // Convert Int16Array to Buffer (little-endian)
    const out = Buffer.alloc(samples.length * 2);
    for(let i = 0; i < samples.length; i++){
        out.writeInt16LE(samples[i], i * 2);
    }
    return out;
}


// mulaw decoding (from RFC 3551)
function mulawDecode(muLawByte: number): number {
  muLawByte = ~muLawByte & 0xFF;

  let sign = (muLawByte & 0x80) ? -1 : 1;
  let exponent = (muLawByte >> 4) & 0x07;
  let mantissa = muLawByte & 0x0F;
  let sample = ((mantissa << 3) + MULAW_BIAS) << (exponent);
  sample = sign === -1 ? -sample : sample;
  return sample;
}

/**
 * Append a transcript record to JSON file (simple persistence for PoC)
 */

export function appendTranscriptionRecord(filePath: string, record: any){
    const dir = path.dirname(filePath);
    if(!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});

    let arr: any[] = [];
    if(fs.existsSync(filePath)){
        try {
            const existing = fs.readFileSync(filePath, "utf-8");
            arr = existing ? JSON.parse(existing) : [];
        } catch {
            arr = [];
        }
    }
    arr.push(record);
    fs.writeFileSync(filePath, JSON.stringify(arr, null, 2), "utf-8");
}