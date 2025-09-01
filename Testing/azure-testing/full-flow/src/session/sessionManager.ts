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
      if (session.azureRecognizer) session.azureRecognizer.pushAudioChunk(pcm16);

      if (session.currentTTSCancel) {
        try {
          session.currentTTSCancel();
        } catch {}
        session.currentTTSCancel = null;

        jsonSend(session.twilioConn, { event: "clear", streamSid: session.streamSid });
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
      jsonSend(session.frontendConn, { type: "call_stopped", streamSid: session.streamSid });
      session.streamSid = undefined;
      break;
    }
  }
}

/* ---------- LLM -> TTS Pipeline ---------- */
async function handleFinalTranscript(userText: string) {
  if (!session.twilioConn || !session.streamSid) return;

  const voice = process.env.VOICE_EN || "en-IN-PrabhatNeural";
  const prompt = `You are a concise helpful voice assistant. Keep the reply ~30 seconds. User said: "${userText}"`;

  const tts = new AzureTTSClient(AZURE_KEY, AZURE_REGION);

  let itemId = `assistant_item_${Date.now()}`;
  jsonSend(session.frontendConn, { type: "response.start", item_id: itemId, timestamp: Date.now() });

  let fullAssistantText = "";
  let bufferText = "";

  try {
    for await (const textChunk of streamLLM(prompt)) {
      fullAssistantText += textChunk;
      bufferText += textChunk;

      jsonSend(session.frontendConn, {
        type: "response.delta",
        item_id: itemId,
        delta: textChunk,
      });

      if (/[.?!]\s$/.test(bufferText)) {
        await speakAndSend(bufferText.trim(), voice, tts, itemId);
        bufferText = "";
      }
    }

    if (bufferText) {
      await speakAndSend(bufferText.trim(), voice, tts, itemId);
    }

    jsonSend(session.frontendConn, {
      type: "response.output_item.done",
      item: { type: "response", item_id: itemId },
    });

    appendTranscriptionRecord(TRANSCRIPTS_FILE, {
      role: "assistant",
      text: fullAssistantText,
      timestamp: new Date().toISOString(),
      streamSid: session.streamSid,
    });

    jsonSend(session.twilioConn, {
      event: "mark",
      streamSid: session.streamSid,
      mark: { name: "assistant_done" },
    });
  } catch (err) {
    console.error("Error in LLM/TTS pipeline:", err);
    jsonSend(session.frontendConn, { type: "error", message: String(err) });
  } finally {
    session.responseStartTimestamp = undefined;
  }
}

async function speakAndSend(text: string, voice: string, tts: AzureTTSClient, itemId: string) {
  const { promise, cancel } = tts.synthesizeTextStream(text, voice, (b64) => {
    jsonSend(session.twilioConn, {
      event: "media",
      streamSid: session.streamSid,
      media: { payload: b64 },
    });

    jsonSend(session.frontendConn, {
      type: "response.audio.delta",
      item_id: itemId,
      payload: b64,
      timestamp: Date.now(),
    });
  });

  session.currentTTSCancel = cancel;
  await promise;
  session.currentTTSCancel = null;
}

/* ---------- helpers ---------- */
function cleanupConnection(ws?: WebSocket) {
  if (!ws) return;
  try {
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close();
  } catch {}
}
