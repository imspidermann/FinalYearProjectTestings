import { RawData, WebSocket } from "ws";
import { Session } from "../types";
import { parseMessage, jsonSend } from "./sessionUtils";
import { mulawToPcm16LE } from "../utils/audioUtils";
import { appendTranscriptionRecord } from "../utils/fileUtils";
import { AzureRecognizer } from "../clients/azureRecognizer";
import { AzureTTSClient } from "../clients/azureTTSClient";
import { streamLLM } from "../clients/groqClient";
import dotenv from "dotenv";
dotenv.config();

const AZURE_KEY = process.env.AZURE_SPEECH_KEY || "";
const AZURE_REGION = process.env.AZURE_SPEECH_REGION || "";
const TRANSCRIPTS_FILE = process.env.TRANSCRIPTS_FILE || "./data/transcripts.json";

let session: Session = {};

export function handleCallConnection(ws: WebSocket) {
  cleanupConnection(session.twilioConn);
  session.twilioConn = ws;

  ws.on("message", handleTwilioMessage);
  ws.on("close", () => {
    if (session.azureRecognizer) session.azureRecognizer.close();
    cleanupConnection(session.twilioConn);
    session = {};
  });
  ws.on("error", () => cleanupConnection(session.twilioConn));
}

export function handleFrontendConnection(ws: WebSocket) {
  cleanupConnection(session.frontendConn);
  session.frontendConn = ws;

  ws.on("message", (d) => {
    try {
      const m = JSON.parse(d.toString());
      if (m.type === "session.update" && m.session) {
        session = { ...session, ...m.session };
      } else if (m.type === "ping") {
        jsonSend(session.frontendConn, { type: "pong" });
      }
    } catch {}
  });

  ws.on("close", () => {
    cleanupConnection(session.frontendConn);
    session.frontendConn = undefined;
  });
}

/* ---------- Twilio -> Server Handling ---------- */
function handleTwilioMessage(data: RawData) {
  const msg = parseMessage(data);
  if (!msg || !msg.event) return;

  switch (msg.event) {
    case "start": {
      session.streamSid = msg.start.streamSid;
      session.latestMediaTimestamp = 0;
      session.isAssistantSpeaking = false; // Add flag to track if assistant is speaking

      session.azureRecognizer = new AzureRecognizer({
        azureKey: AZURE_KEY,
        azureRegion: AZURE_REGION,
      });

      session.azureRecognizer.on("partial", (ev: any) => {
        jsonSend(session.frontendConn, {
          type: "partial_transcript",
          text: ev.text,
          timestamp: Date.now(),
        });

        appendTranscriptionRecord(TRANSCRIPTS_FILE, {
          role: "user_partial",
          text: ev.text,
          timestamp: new Date().toISOString(),
          streamSid: session.streamSid,
        });
      });

      session.azureRecognizer.on("final", (ev: any) => {
        jsonSend(session.frontendConn, {
          type: "final_transcript",
          text: ev.text,
          timestamp: Date.now(),
        });

        appendTranscriptionRecord(TRANSCRIPTS_FILE, {
          role: "user",
          text: ev.text,
          timestamp: new Date().toISOString(),
          streamSid: session.streamSid,
        });

        handleFinalTranscript(ev.text).catch((err) => {
          console.error("Error in handleFinalTranscript:", err);
          jsonSend(session.frontendConn, { type: "error", message: String(err) });
        });
      });

      session.azureRecognizer.on("error", (err: any) => {
        jsonSend(session.frontendConn, { type: "error", message: String(err) });
      });

      break;
    }

    case "media": {
      session.latestMediaTimestamp = msg.media.timestamp || session.latestMediaTimestamp;
      const audioBuffer = Buffer.from(msg.media.payload, "base64");
      const pcm16 = mulawToPcm16LE(audioBuffer);
      
      // Only push to recognizer if assistant is not speaking
      if (session.azureRecognizer && !session.isAssistantSpeaking) {
        session.azureRecognizer.pushAudioChunk(pcm16);
      }

      // Only cancel TTS if we detect significant user audio while assistant is speaking
      if (session.currentTTSCancel && session.isAssistantSpeaking) {
        // Add simple volume detection to avoid canceling on background noise
        const volume = calculateVolume(audioBuffer);
        if (volume > 500) { // Adjust threshold as needed
          try {
            session.currentTTSCancel();
            session.isAssistantSpeaking = false;
          } catch {}
          session.currentTTSCancel = null;
          jsonSend(session.twilioConn, { event: "clear", streamSid: session.streamSid });
        }
      }
      break;
    }

    case "stop":
    case "close":
    case "disconnect": {
      if (session.azureRecognizer) {
        session.azureRecognizer.close();
        session.azureRecognizer = undefined;
      }
      if (session.currentTTSCancel) {
        session.currentTTSCancel();
        session.currentTTSCancel = null;
      }
      session.isAssistantSpeaking = false;
      jsonSend(session.frontendConn, { type: "call_stopped", streamSid: session.streamSid });
      session.streamSid = undefined;
      break;
    }
  }
}

/* ---------- LLM -> TTS Pipeline ---------- */
async function handleFinalTranscript(userText: string) {
  if (!session.twilioConn || !session.streamSid) return;

  console.log("Processing user transcript:", userText);
  session.isAssistantSpeaking = true;

  const voice = process.env.VOICE_EN || "en-IN-PrabhatNeural";
  const prompt = `You are a concise helpful voice assistant. Keep the reply under 30 seconds and speak naturally. User said: "${userText}"`;

  const tts = new AzureTTSClient(AZURE_KEY, AZURE_REGION);
  let itemId = `assistant_item_${Date.now()}`;
  
  jsonSend(session.frontendConn, { 
    type: "response.start", 
    item_id: itemId, 
    timestamp: Date.now() 
  });

  let fullAssistantText = "";
  let bufferText = "";
  let sentenceCount = 0;

  try {
    for await (const textChunk of streamLLM(prompt)) {
      fullAssistantText += textChunk;
      bufferText += textChunk;

      // Send delta to frontend for display
      jsonSend(session.frontendConn, {
        type: "response.delta",
        item_id: itemId,
        delta: textChunk,
      });

      // Check for sentence endings and buffer enough content
      const sentences = bufferText.match(/[.!?]+/g);
      if (sentences && sentences.length > 0 && bufferText.trim().length > 10) {
        // Find the last complete sentence
        const lastSentenceIndex = bufferText.lastIndexOf(sentences[sentences.length - 1]);
        if (lastSentenceIndex !== -1) {
          const completeSentence = bufferText.substring(0, lastSentenceIndex + 1).trim();
          
          if (completeSentence && completeSentence.length > 5) {
            console.log(`Synthesizing sentence ${sentenceCount + 1}:`, completeSentence);
            
            // Synthesize and send the complete sentence
            await speakAndSend(completeSentence, voice, tts, itemId);
            
            // Update buffer to remaining text
            bufferText = bufferText.substring(lastSentenceIndex + 1);
            sentenceCount++;
          }
        }
      }

      // Also send chunks when we have enough words (fallback for long sentences)
      const wordCount = bufferText.split(' ').length;
      if (wordCount >= 15) {
        console.log("Synthesizing chunk:", bufferText.trim());
        await speakAndSend(bufferText.trim(), voice, tts, itemId);
        bufferText = "";
      }
    }

    // Handle any remaining text
    if (bufferText.trim()) {
      console.log("Synthesizing final chunk:", bufferText.trim());
      await speakAndSend(bufferText.trim(), voice, tts, itemId);
    }

    // Save the complete assistant response to transcripts
    appendTranscriptionRecord(TRANSCRIPTS_FILE, {
      role: "assistant",
      text: fullAssistantText,
      timestamp: new Date().toISOString(),
      streamSid: session.streamSid,
    });

    jsonSend(session.frontendConn, {
      type: "response.output_item.done",
      item: { type: "response", item_id: itemId },
    });

    jsonSend(session.twilioConn, {
      event: "mark",
      streamSid: session.streamSid,
      mark: { name: "assistant_done" },
    });

    console.log("Assistant response completed:", fullAssistantText);

  } catch (err) {
    console.error("Error in LLM/TTS pipeline:", err);
    jsonSend(session.frontendConn, { type: "error", message: String(err) });
  } finally {
    session.responseStartTimestamp = undefined;
    session.isAssistantSpeaking = false;
  }
}

export async function speakAndSend(
  text: string,
  voice: string,
  tts: AzureTTSClient,
  itemId: string
) {
  if (!text.trim()) return;
  
  console.log("TTS synthesizing:", text);

  const { promise, cancel } = tts.synthesizeTextStream(text, voice, (b64) => {
    if (!b64) {
      // End of stream signal
      jsonSend(session.twilioConn, { 
        event: "media", 
        streamSid: session.streamSid, 
        media: { payload: "" } 
      });
      return;
    }

    // Send audio chunk to Twilio
    jsonSend(session.twilioConn, {
      event: "media",
      streamSid: session.streamSid,
      media: { payload: b64 },
    });

    // Also send to frontend for monitoring
    jsonSend(session.frontendConn, {
      type: "response.audio.delta",
      item_id: itemId,
      payload: b64,
      timestamp: Date.now(),
    });
  });

  session.currentTTSCancel = cancel;
  
  try {
    await promise;
    console.log("TTS completed for text:", text.substring(0, 50) + "...");
  } catch (error) {
    console.error("TTS error:", error);
  } finally {
    session.currentTTSCancel = null;
  }
}

/* ---------- Helper Functions ---------- */
function cleanupConnection(ws?: WebSocket) {
  if (!ws) return;
  try {
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close();
  } catch {}
}

// Simple volume calculation for interruption detection
function calculateVolume(buffer: Buffer): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const sample = buffer[i];
    sum += Math.abs(sample - 128); // Adjust for mu-law offset
  }
  return sum / buffer.length;
}