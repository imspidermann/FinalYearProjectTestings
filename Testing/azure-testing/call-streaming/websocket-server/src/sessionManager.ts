import { RawData, WebSocket} from "ws";
import { mulawToPcm16LE, appendTranscriptionRecord } from "./utils";
import { AzureRecognizer } from "./azureRecognizer";
import { Session } from "./types";
import dotenv from "dotenv";

dotenv.config();

const AZURE_KEY = process.env.AZURE_SPEECH_KEY || "";
const AZURE_REGION = process.env.AZURE_SPEECH_REGION || "";
const TRANSCRIPTS_FILE = process.env.TRANSCRIPTS_FILE || "./data/transcripts.json";

const SUPPORTED_LANGUAGES = ["en-US", "hi-IN", "mr-IN"];


let session: Session = {};

export function handleCallConnection(ws : WebSocket){
    cleanupConnection(session.twilioConn);
    session.twilioConn = ws;

    ws.on("message", handleTwilioMessage);
    ws.on("close", () => {
        if(session.azureRecognizer){
            session.azureRecognizer.close();
        }
        cleanupConnection(session.twilioConn);
        session = {};
    });
    ws.on("error", () => {
        cleanupConnection(session.twilioConn);
    });
}

export function handleFrontendConnection(ws: WebSocket){
    cleanupConnection(session.frontendConn);
    session.frontendConn = ws;

    ws.on("message", (data) =>{
        try {
            const m = JSON.parse(data.toString());
            if(m.type === "ping"){
                jsonSend(session.frontendConn, {type: "pong"});
            }
        } catch {}
    });

    ws.on("close", () => {
        cleanupConnection(session.frontendConn);
        session.frontendConn = undefined;
    });
}

function handleTwilioMessage(data: RawData){
    let msg: any;
    try{
        msg = JSON.parse(data.toString());
    } catch (err) {
        return;
    }

    if(!msg || !msg.event) return;

    switch(msg.event){
        case "start" :{
            session.streamSid = msg.start.streamSid;
            session.latestMediaTimeStamp = 0;
            //create azure recognizer for this call/ session
            session.azureRecognizer = new AzureRecognizer({
                azureKey: AZURE_KEY,
                azureRegion: AZURE_REGION,
                candidateLanguages: SUPPORTED_LANGUAGES,
            });

            // wire azure events -> frontend + persistence
            session.azureRecognizer.on("partial", (ev: any) => {
                // console.log("Hellooo")
                console.log(`[Partial] ${ev.text} (${ev.language})`);
                jsonSend(session.frontendConn, {
                    type: "partial_transcript",
                    text: ev.text,
                    language: ev.language,
                    timeStamp: Date.now(),
                });
            });

            session.azureRecognizer.on("final", (ev: any) => {
                const rec = {
                streamSid : session.streamSid,
                text: ev.text,
                language: ev.language,
                timestamp: new Date().toISOString(),
                // type: "final",
            };

                // save to file
                // console.log("Byeee");
                console.log(`[Final] ${ev.text} (${ev.language})`); 
                appendTranscriptionRecord(TRANSCRIPTS_FILE, rec);

                jsonSend(session.frontendConn, {
                    type: "final_transcript",
                    ...rec,
                });
            });

            // language detection
            session.azureRecognizer.on("language_detected", (ev: any) => {
                session.detectedLanguage = ev.language;
                console.log(`[Language] ${ev.language} (${ev.confidence})`);

                jsonSend(session.frontendConn, {
                    type: "language_detected",
                    language: ev.language,
                    streamSid: session.streamSid,
                    timestamp: new Date().toISOString(),
                });

                // save to file
                const langRecord = {
                    streamSid: session.streamSid,
                    language: ev.language,
                    timestamp: new Date().toISOString(),
                    type: "language_detected",
                };
                appendTranscriptionRecord(TRANSCRIPTS_FILE, langRecord);
            });

            session.azureRecognizer.on("error", (err: any) => {
                console.log("Azure error: ", err);
                jsonSend(session.frontendConn, {
                    type:"error",
                    message: String(err)
                });
            });

            jsonSend(session.frontendConn, {
                type: "session_started",
                streamSid: session.streamSid,
                supportedLanguages: SUPPORTED_LANGUAGES,
                timestamp: new Date().toISOString(),
            });

            break;
        }

        case "media": {
            //Twilio: msg.media.payload is base^4 audio chunk (usually g711_law)

            session.latestMediaTimeStamp = msg.media.timeStamp || session.latestMediaTimeStamp;
            const base64 = msg.media.payload;
            const audioBuffer = Buffer.from(base64, "base64");

            //convert mu0law -> PCM16LE for azure
            const pcm16 = mulawToPcm16LE(audioBuffer);

            //push to azure
            if(session.azureRecognizer){
                session.azureRecognizer.pushAudioChunk(pcm16);
            }
            break;
        }

        case "stop":
        case "disconnect":
        case "close": {
            //close azure recognizer
            if(session.azureRecognizer){
                console.log("Closing Azure recong")
                session.azureRecognizer.close();
                session.azureRecognizer = undefined;
            }

            //inform frontend 
            jsonSend(session.frontendConn, {
                type : "call_stopped",
                streamSid: session.streamSid,
                detectedLanguage: session.detectedLanguage,
                timestamp: new Date().toISOString(),
            });
            session.streamSid = undefined;
            session.detectedLanguage = undefined;
            break;
        }

        default:
            //ignore other events
            break;
    }
}

function jsonSend(ws?: WebSocket, obj?: unknown){
    if(!ws || ws.readyState !== ws.OPEN) return;
    try{
        ws.send(JSON.stringify(obj));
    } catch {}
}

function cleanupConnection(ws?: WebSocket) {
  if (!ws) return;
  try {
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) ws.close();
  } catch {}
}