import * as sdk from "microsoft-cognitiveservices-speech-sdk";

// Convert PCM16 -> 8-bit µ-law for Twilio (Fixed implementation)
function pcm16ToMulawSample(sample: number): number {
  const MULAW_MAX = 0x1FFF;
  const MULAW_BIAS = 33;

  // Clamp the sample to 16-bit range first
  sample = Math.max(-32768, Math.min(32767, sample));
  
  let sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  
  // Add bias and find exponent
  sample += MULAW_BIAS;
  if (sample > MULAW_MAX) sample = MULAW_MAX;

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

// Strip RIFF header and return raw PCM16 data
function stripRiffHeaderToRawPCM16(buf: Buffer): Buffer {
  if (buf.length >= 12 && buf.slice(0, 4).toString("ascii") === "RIFF") {
    // Look for the "data" chunk
    const dataIdx = buf.indexOf(Buffer.from("data"));
    if (dataIdx !== -1) {
      // Skip "data" + 4-byte size field
      const audioStart = dataIdx + 8;
      return buf.slice(audioStart);
    }
    // Fallback: assume standard 44-byte WAV header
    return buf.slice(44);
  }
  return buf;
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
    
    // Use 8kHz, 16-bit, mono PCM - exactly what Twilio expects before µ-law conversion
    speechConfig.speechSynthesisOutputFormat = sdk.SpeechSynthesisOutputFormat.Riff8Khz16BitMonoPcm;

    let synthesizer: sdk.SpeechSynthesizer | null = null;
    let isCanceled = false;

    const p = new Promise<void>((resolve, reject) => {
      synthesizer = new sdk.SpeechSynthesizer(speechConfig, undefined);

      synthesizer.speakTextAsync(
        text,
        result => {
          try {
            if (isCanceled) {
              console.log("TTS was canceled, skipping audio processing");
              resolve();
              return;
            }

            if (result.audioData && result.audioData.byteLength > 0) {
              console.log(`TTS: Received ${result.audioData.byteLength} bytes of audio data`);
              
              // Convert ArrayBuffer to Buffer
              const audioBuffer = Buffer.from(result.audioData);
              
              // Strip RIFF header to get raw PCM16
              const pcm16 = stripRiffHeaderToRawPCM16(audioBuffer);
              console.log(`TTS: PCM16 data size: ${pcm16.length} bytes`);
              
              // Convert PCM16 to µ-law
              const mulaw = pcm16ToMulawBuffer(pcm16);
              console.log(`TTS: µ-law data size: ${mulaw.length} bytes`);

              // Send audio in chunks suitable for Twilio (160 bytes = 20ms at 8kHz)
              const CHUNK_SIZE = 160;
              let chunkCount = 0;
              
              for (let i = 0; i < mulaw.length; i += CHUNK_SIZE) {
                if (isCanceled) break;
                
                const chunk = mulaw.slice(i, i + CHUNK_SIZE);
                const base64Chunk = chunk.toString("base64");
                
                // Add small delay between chunks for proper timing
                setTimeout(() => {
                  if (!isCanceled) {
                    onAudioChunk(base64Chunk);
                  }
                }, chunkCount * 20); // 20ms intervals
                
                chunkCount++;
              }
              
              // Signal end of stream after all chunks are sent
              setTimeout(() => {
                if (!isCanceled) {
                  onAudioChunk(""); // Empty string signals end
                }
              }, chunkCount * 20 + 100); // Small buffer after last chunk

              console.log(`TTS: Scheduled ${chunkCount} chunks for streaming`);
            } else {
              console.warn("TTS: No audio data received");
              onAudioChunk(""); // Signal end even if no audio
            }

          } catch (err) {
            console.error("TTS processing error:", err);
            onAudioChunk(""); // Signal end on error
          } finally {
            synthesizer?.close();
            resolve();
          }
        },
        err => {
          console.error("TTS synthesis error:", err);
          try { 
            synthesizer?.close(); 
          } catch {}
          reject(err);
        }
      );
    });

    const cancel = () => {
      console.log("TTS: Canceling synthesis");
      isCanceled = true;
      try { 
        synthesizer?.close(); 
      } catch {}
    };

    return { promise: p, cancel };
  }
}