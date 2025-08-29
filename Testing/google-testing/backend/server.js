// Real-time Voice AI Assistant with Twilio + Gemini
// Optimized for fast, natural conversations

// --------------------------------------------------------------------------------
// SETUP INSTRUCTIONS
// --------------------------------------------------------------------------------
// 1. Install dependencies: npm install express twilio ws @google/generative-ai dotenv @google-cloud/speech @google-cloud/text-to-speech
// 2. Set up Google Cloud: Enable Speech-to-Text and Text-to-Speech APIs
// 3. Create service account key and set GOOGLE_APPLICATION_CREDENTIALS
// 4. Configure Twilio webhook to: https://your-domain.ngrok-free.app/voice

import express from 'express';
import { WebSocketServer } from 'ws';
import Twilio from 'twilio';
import { GoogleGenerativeAI } from '@google/generative-ai';
import speech from '@google-cloud/speech';
import textToSpeech from '@google-cloud/text-to-speech';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// Initialize clients
const twilioClient = new Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const speechClient = new speech.SpeechClient();
const ttsClient = new textToSpeech.TextToSpeechClient();

// Configuration
const WS_SERVER_URL = `${process.env.NGROK_URL.replace('https://', 'wss://')}/media`;
const GEMINI_MODEL = "gemini-1.5-flash";

// Initialize Gemini with optimized settings for conversation
const model = genAI.getGenerativeModel({ 
  model: GEMINI_MODEL,
  systemInstruction: `You are a helpful AI assistant taking phone calls. 
  Rules:
  - Keep responses conversational and under 50 words
  - Be natural, friendly, and direct
  - Don't mention you're an AI unless asked
  - If you don't know something, say so briefly
  - Ask follow-up questions to help users
  - Speak like you're having a phone conversation`,
  generationConfig: {
    maxOutputTokens: 150,
    temperature: 0.7,
  }
});

// --------------------------------------------------------------------------------
// SPEECH PROCESSING UTILITIES
// --------------------------------------------------------------------------------

async function transcribeAudio(audioBuffer) {
  try {
    const request = {
      audio: { content: audioBuffer.toString('base64') },
      config: {
        encoding: 'MULAW',
        sampleRateHertz: 8000,
        languageCode: 'en-US',
        enableAutomaticPunctuation: true,
        model: 'phone_call'
      },
    };

    const [response] = await speechClient.recognize(request);
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');
    
    return transcription.trim();
  } catch (error) {
    console.error('Speech recognition error:', error);
    return null;
  }
}

async function synthesizeSpeech(text) {
  try {
    const request = {
      input: { text: text },
      voice: { 
        languageCode: 'en-US', 
        name: 'en-US-Journey-F',
        ssmlGender: 'FEMALE' 
      },
      audioConfig: { 
        audioEncoding: 'MULAW',
        sampleRateHertz: 8000
      },
    };

    const [response] = await ttsClient.synthesizeSpeech(request);
    return response.audioContent;
  } catch (error) {
    console.error('Text-to-speech error:', error);
    return null;
  }
}

// --------------------------------------------------------------------------------
// MAIN VOICE ENDPOINT
// --------------------------------------------------------------------------------
app.post('/voice', (req, res) => {
  const twiml = new Twilio.twiml.VoiceResponse();
  
  twiml.say({ 
    voice: 'alice' 
  }, "Hello! I'm your AI assistant. I'm ready to help you with anything. What can I do for you today?");
  
  // Start streaming for real-time conversation
  twiml.connect().stream({ 
    url: WS_SERVER_URL,
    track: 'inbound_track'
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// --------------------------------------------------------------------------------
// WEBSOCKET HANDLER FOR REAL-TIME CONVERSATION
// --------------------------------------------------------------------------------
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  console.log('📞 New call connected');
  
  let audioBuffer = Buffer.alloc(0);
  let streamSid = null;
  let isProcessing = false;
  let silenceCount = 0;
  let conversationHistory = [];
  
  // Voice Activity Detection parameters
  const SILENCE_THRESHOLD = 30; // Frames of silence before processing
  const MIN_AUDIO_LENGTH = 8000; // Minimum audio bytes to process
  
  ws.on('message', async (message) => {
    const data = JSON.parse(message);
    
    switch (data.event) {
      case 'start':
        streamSid = data.start.streamSid;
        console.log('🎙️ Stream started:', streamSid);
        break;
        
      case 'media':
        if (isProcessing) return;
        
        const audioChunk = Buffer.from(data.media.payload, 'base64');
        audioBuffer = Buffer.concat([audioBuffer, audioChunk]);
        
        // Simple silence detection
        const avgVolume = audioChunk.reduce((sum, byte) => sum + Math.abs(byte - 128), 0) / audioChunk.length;
        
        if (avgVolume < 5) { // Likely silence
          silenceCount++;
        } else {
          silenceCount = 0;
        }
        
        // Process when we detect end of speech
        if (silenceCount > SILENCE_THRESHOLD && audioBuffer.length > MIN_AUDIO_LENGTH) {
          await processUserSpeech(ws, streamSid, audioBuffer, conversationHistory);
          audioBuffer = Buffer.alloc(0);
          silenceCount = 0;
        }
        break;
        
      case 'stop':
        console.log('📞 Call ended');
        break;
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket closed');
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
  });
});

async function processUserSpeech(ws, streamSid, audioBuffer, conversationHistory) {
  console.log('🎯 Processing speech...');
  
  try {
    // 1. Convert speech to text
    const userText = await transcribeAudio(audioBuffer);
    
    if (!userText || userText.length < 2) {
      console.log('⚠️ No clear speech detected');
      return;
    }
    
    console.log('👤 User said:', userText);
    
    // 2. Add to conversation history
    conversationHistory.push(`User: ${userText}`);
    
    // Keep conversation history manageable
    if (conversationHistory.length > 10) {
      conversationHistory = conversationHistory.slice(-8);
    }
    
    // 3. Generate AI response
    const contextPrompt = conversationHistory.join('\n') + '\nAssistant:';
    const result = await model.generateContent(contextPrompt);
    const aiResponse = result.response.text().replace('Assistant:', '').trim();
    
    console.log('🤖 AI response:', aiResponse);
    conversationHistory.push(`Assistant: ${aiResponse}`);
    
    // 4. Convert to speech and send back
    const audioResponse = await synthesizeSpeech(aiResponse);
    
    if (audioResponse) {
      // Send audio back to Twilio in chunks
      const base64Audio = audioResponse.toString('base64');
      const chunkSize = 1024;
      
      for (let i = 0; i < base64Audio.length; i += chunkSize) {
        const chunk = base64Audio.slice(i, i + chunkSize);
        const mediaMessage = {
          event: 'media',
          streamSid: streamSid,
          media: {
            payload: chunk
          }
        };
        ws.send(JSON.stringify(mediaMessage));
        
        // Small delay to prevent overwhelming Twilio
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }
    
    console.log('✅ Response sent');
    
  } catch (error) {
    console.error('❌ Error processing speech:', error);
    
    // Send error response
    const errorResponse = await synthesizeSpeech("I'm sorry, I didn't catch that. Could you please repeat?");
    if (errorResponse) {
      const mediaMessage = {
        event: 'media',
        streamSid: streamSid,
        media: {
          payload: errorResponse.toString('base64')
        }
      };
      ws.send(JSON.stringify(mediaMessage));
    }
  }
}

// --------------------------------------------------------------------------------
// ALTERNATIVE: FASTER RECORD-AND-RESPOND APPROACH
// --------------------------------------------------------------------------------
app.post('/voice-record', (req, res) => {
  const twiml = new Twilio.twiml.VoiceResponse();
  
  twiml.say({ 
    voice: 'alice' 
  }, "Hi! I'm your AI assistant. Please tell me what you need help with, then press any key when you're done.");
  
  twiml.record({
    action: '/process-recording',
    maxLength: 30,
    timeout: 3,
    finishOnKey: 'any',
    transcribe: false,
    playBeep: false
  });
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/process-recording', async (req, res) => {
  const recordingUrl = req.body.RecordingUrl;
  
  try {
    console.log('🎙️ Processing recording:', recordingUrl);
    
    // Download the recording
    const recordingResponse = await fetch(recordingUrl);
    const audioBuffer = Buffer.from(await recordingResponse.arrayBuffer());
    
    // Transcribe
    const userText = await transcribeAudio(audioBuffer);
    
    if (!userText) {
      throw new Error('Could not transcribe audio');
    }
    
    console.log('👤 User said:', userText);
    
    // Generate AI response
    const result = await model.generateContent(userText);
    const aiResponse = result.response.text().trim();
    
    console.log('🤖 AI response:', aiResponse);
    
    // Create TwiML response
    const twiml = new Twilio.twiml.VoiceResponse();
    twiml.say({ voice: 'alice' }, aiResponse);
    
    // Continue conversation
    twiml.say({ voice: 'alice' }, "Is there anything else I can help you with? Press any key when you're ready to speak.");
    twiml.record({
      action: '/process-recording',
      maxLength: 30,
      timeout: 3,
      finishOnKey: 'any',
      transcribe: false,
      playBeep: false
    });
    
    res.type('text/xml');
    res.send(twiml.toString());
    
  } catch (error) {
    console.error('❌ Error processing recording:', error);
    
    const twiml = new Twilio.twiml.VoiceResponse();
    twiml.say({ voice: 'alice' }, "I'm sorry, I didn't understand that. Let's try again.");
    twiml.redirect('/voice-record');
    
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// --------------------------------------------------------------------------------
// HEALTH CHECK
// --------------------------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    model: GEMINI_MODEL 
  });
});

// --------------------------------------------------------------------------------
// START SERVER
// --------------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log('🚀 AI Voice Assistant Server Started');
  console.log(`📱 Port: ${PORT}`);
  console.log(`🎯 Webhook URL: ${process.env.NGROK_URL}/voice`);
  console.log(`⚡ Fast Record URL: ${process.env.NGROK_URL}/voice-record`);
  console.log(`🧠 Using model: ${GEMINI_MODEL}`);
  console.log('\n💡 Configure your Twilio phone number webhook to point to the webhook URL above');
});

server.on('upgrade', (request, socket, head) => {
  if (request.url === '/media') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});