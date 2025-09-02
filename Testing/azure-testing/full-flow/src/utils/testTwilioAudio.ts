// Add this to your sessionManager.ts for testing

import { jsonSend } from "../session/sessionUtils";


export function testTwilioAudioPlayback(streamSid: string, twilioConn: any) {
  console.log("Testing Twilio audio playback with simple tone...");
  
  // Generate a simple 440Hz tone (A note) for 2 seconds at 8kHz sample rate
  const sampleRate = 8000;
  const duration = 2; // 2 seconds
  const frequency = 440; // 440Hz tone (A note)
  const amplitude = 2000; // Moderate volume for PCM16
  
  const samples = sampleRate * duration;
  const mulawData = Buffer.alloc(samples);
  
  for (let i = 0; i < samples; i++) {
    // Generate sine wave
    const sample = Math.sin(2 * Math.PI * frequency * i / sampleRate) * amplitude;
    // Convert to µ-law
    mulawData[i] = pcm16ToMulaw(Math.round(sample));
  }
  
  console.log(`Generated ${samples} samples of test audio`);
  
  // Send in 160-byte chunks (20ms each) with proper timing
  const CHUNK_SIZE = 160;
  const CHUNK_INTERVAL_MS = 20;
  let chunkIndex = 0;
  let chunkCount = 0;
  
  const sendNextChunk = () => {
    if (chunkIndex >= mulawData.length) {
      console.log(`Test tone completed. Sent ${chunkCount} chunks total.`);
      
      // Send completion mark
      jsonSend(twilioConn, {
        event: "mark",
        streamSid: streamSid,
        mark: { name: "test_tone_complete" }
      });
      return;
    }
    
    const chunk = mulawData.slice(chunkIndex, Math.min(chunkIndex + CHUNK_SIZE, mulawData.length));
    const base64Chunk = chunk.toString("base64");
    
    const mediaMessage = {
      event: "media",
      streamSid: streamSid,
      media: { payload: base64Chunk }
    };
    
    try {
      jsonSend(twilioConn, mediaMessage);
      chunkCount++;
      console.log(`Sent test chunk ${chunkCount}, size: ${chunk.length}`);
    } catch (err) {
      console.error("Error sending test chunk:", err);
      return;
    }
    
    chunkIndex += CHUNK_SIZE;
    
    // Schedule next chunk
    setTimeout(sendNextChunk, CHUNK_INTERVAL_MS);
  };
  
  // Start sending immediately
  sendNextChunk();
}

// Helper function to convert PCM16 sample to µ-law
function pcm16ToMulaw(sample: number): number {
  const MULAW_MAX = 0x1FFF;
  const MULAW_BIAS = 33;
  
  let sign = sample < 0 ? 0x80 : 0;
  if (sample < 0) sample = -sample;
  sample = Math.min(Math.floor(sample), MULAW_MAX);
  
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; expMask >>= 1) {
    exponent--;
  }
  
  let mantissa = (sample >> (exponent + 3)) & 0x0F;
  return ~(sign | (exponent << 4) | mantissa) & 0xFF;
}

// To test, call this function in your handleFinalTranscript before TTS:
// testTwilioAudioPlayback(session.streamSid, session.twilioConn);