import { RawData, WebSocket } from "ws";
import { Session } from "./types";
import { parseMessage, jsonSend } from "./utils";
import { streamLLM } from "./groqLLMClient";
import { synthesizeTextStream } from "./azureTTSClient";

let session: Session = {};

export function handleCallConnection(ws: WebSocket) {
  session.twilioConn = ws;

  ws.on("message", handleTwilioMessage);
  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    ws.close();
  });
  ws.on("close", () => { 
    console.log("WebSocket connection closed");
    session = {}; 
  });

  console.log("Call connection established");
}

function handleTwilioMessage(data: RawData) {
  const msg = parseMessage(data as Buffer);
  if (!msg) return;

  console.log("Received message:", msg.event);

  switch (msg.event) {
    case "start":
      session.streamSid = msg.start.streamSid;
      console.log("Stream started with SID:", session.streamSid);
      // Send welcome message immediately after stream starts
      sendWelcomeMessage();
      break;

    case "dtmf":
      console.log("DTMF digit received:", msg.dtmf.digit);
      handleDTMF(msg.dtmf.digit);
      break;

    case "stop":
      console.log("Stream stopped");
      if (session.twilioConn) session.twilioConn.close();
      session = {};
      break;

    case "media":
      // Handle incoming audio if needed - for now we'll ignore it
      break;
  }
}

async function sendWelcomeMessage() {
  if (!session.twilioConn || !session.streamSid) {
    console.error("No active connection or stream SID for welcome message");
    return;
  }

  const welcomeText = "Welcome! Press 1 for an English story or 2 for a Hindi story.";
  const voice = process.env.VOICE_EN || "en-US-JennyNeural";

  try {
    console.log("Sending welcome message");
    await synthesizeTextStream(welcomeText, voice, (base64Audio) => {
      if (session.twilioConn && session.streamSid) {
        jsonSend(session.twilioConn, {
          event: "media",
          streamSid: session.streamSid,
          media: { payload: base64Audio },
        });
      }
    });

    // Send a mark to indicate welcome message is complete
    jsonSend(session.twilioConn, {
      event: "mark",
      streamSid: session.streamSid,
      mark: { name: "welcome_complete" },
    });

  } catch (error) {
    console.error("Error sending welcome message:", error);
  }
}

async function handleDTMF(digit: string) {
  if (!session.twilioConn || !session.streamSid) {
    console.error("No active connection or stream SID");
    return;
  }

  // Clear any ongoing audio first
  jsonSend(session.twilioConn, {
    event: "clear",
    streamSid: session.streamSid,
  });

  let prompt = "";
  let lang: "en" | "hi" = "en";
  let responseText = "";

  if (digit === "1") {
    prompt = "Tell a short story about a brave knight who saves a village.";
    lang = "en";
    responseText = "Starting your English story...";
  } else if (digit === "2") {
    prompt = "Ek chhoti kahani sunaiye ek lomdi ke baare mein jo kisaan ko hara deta hai.";
    lang = "hi";
    responseText = "Aapki Hindi kahani shuru kar rahe hain...";
  } else {
    prompt = "Sorry, I didn't understand that. Press 1 for English story or 2 for Hindi story.";
    lang = "en";
    responseText = "Sorry, I didn't understand that. Press 1 for English story or 2 for Hindi story.";
    
    // For invalid input, just play the error message and return
    const voice = process.env.VOICE_EN || "en-US-JennyNeural";
    try {
      await synthesizeTextStream(responseText, voice, (base64Audio) => {
        if (session.twilioConn && session.streamSid) {
          jsonSend(session.twilioConn, {
            event: "media",
            streamSid: session.streamSid,
            media: { payload: base64Audio },
          });
        }
      });
    } catch (error) {
      console.error("Error sending error message:", error);
    }
    return;
  }

  console.log(`Processing ${lang} prompt for digit ${digit}`);

  try {
    const voice = lang === "hi" 
      ? process.env.VOICE_HI || "hi-IN-SwaraNeural"
      : process.env.VOICE_EN || "en-US-JennyNeural";

    // Send immediate feedback
    await synthesizeTextStream(responseText, voice, (base64Audio) => {
      if (session.twilioConn && session.streamSid) {
        jsonSend(session.twilioConn, {
          event: "media",
          streamSid: session.streamSid,
          media: { payload: base64Audio },
        });
      }
    });

    let textBuffer = "";
    let sentenceCount = 0;
    const maxSentences = 3; // Limit to keep stories short

    // Stream the LLM response
    for await (const textChunk of streamLLM(prompt)) {
      console.log("Received text chunk:", textChunk);
      
      textBuffer += textChunk;
      
      // Send chunks at sentence boundaries for more natural speech
      const sentences = textBuffer.match(/[^.!?]*[.!?]+/g) || [];
      
      if (sentences.length > 0) {
        const completeSentences = sentences.slice(0, -1); // All but the last (potentially incomplete) sentence
        const remaining = textBuffer.substring(completeSentences.join('').length);
        
        for (const sentence of completeSentences) {
          if (sentenceCount >= maxSentences) break;
          
          const trimmedSentence = sentence.trim();
          if (trimmedSentence) {
            console.log("Synthesizing sentence:", trimmedSentence);
            
            await synthesizeTextStream(trimmedSentence, voice, (base64Audio) => {
              if (session.twilioConn && session.streamSid) {
                jsonSend(session.twilioConn, {
                  event: "media",
                  streamSid: session.streamSid,
                  media: { payload: base64Audio },
                });
              }
            });
            
            sentenceCount++;
          }
        }
        
        textBuffer = remaining;
        
        if (sentenceCount >= maxSentences) {
          console.log("Reached maximum sentences, stopping story");
          break;
        }
      }
    }

    // Send any remaining text
    if (textBuffer.trim() && sentenceCount < maxSentences) {
      console.log("Synthesizing final chunk:", textBuffer.trim());
      await synthesizeTextStream(textBuffer.trim(), voice, (base64Audio) => {
        if (session.twilioConn && session.streamSid) {
          jsonSend(session.twilioConn, {
            event: "media",
            streamSid: session.streamSid,
            media: { payload: base64Audio },
          });
        }
      });
    }

    // Send completion mark and prompt for next action
    if (session.twilioConn && session.streamSid) {
      jsonSend(session.twilioConn, {
        event: "mark",
        streamSid: session.streamSid,
        mark: { name: "story_end" },
      });

      // Prompt for another story
      const nextPrompt = lang === "hi" 
        ? "Ek aur kahani ke liye 1 ya 2 dabaiye."
        : "Press 1 or 2 for another story.";
      
      await synthesizeTextStream(nextPrompt, voice, (base64Audio) => {
        if (session.twilioConn && session.streamSid) {
          jsonSend(session.twilioConn, {
            event: "media",
            streamSid: session.streamSid,
            media: { payload: base64Audio },
          });
        }
      });
    }

    console.log("Story playback completed");

  } catch (error) {
    console.error("Error in TTS pipeline:", error);
    
    // Send error message to user
    const errorMessage = "Sorry, there was an error processing your request. Please try again.";
    const voice = process.env.VOICE_EN || "en-US-JennyNeural";
    
    try {
      await synthesizeTextStream(errorMessage, voice, (base64Audio) => {
        if (session.twilioConn && session.streamSid) {
          jsonSend(session.twilioConn, {
            event: "media",
            streamSid: session.streamSid,
            media: { payload: base64Audio },
          });
        }
      });
    } catch (ttsError) {
      console.error("Error sending error message:", ttsError);
    }
  }
}