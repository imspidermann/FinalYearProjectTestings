const express = require('express');
const twilio = require('twilio');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Configuration
const config = {
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID,
    authToken: process.env.TWILIO_AUTH_TOKEN,
    phoneNumber: process.env.TWILIO_PHONE_NUMBER
  },
  agora: {
    appId: process.env.AGORA_APP_ID,
    apiKey: process.env.AGORA_API_KEY,
    apiSecret: process.env.AGORA_API_SECRET,
    baseUrl: 'https://api.agora.io',
    conversationalEndpoint: 'https://api.agora.io/api/v1/projects'
  },
  server: {
    port: process.env.PORT || 3000,
    baseUrl: process.env.BASE_URL || 'https://your-ngrok-url.ngrok.io'
  }
};

// Initialize Twilio client
const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

// Store active call sessions
const activeCalls = new Map();

class CallSession {
  constructor(callSid, from) {
    this.callSid = callSid;
    this.from = from;
    this.conversationHistory = [];
    this.agoraConversationalSessionId = null;
    this.channelName = `call_${callSid}`;
  }

  addMessage(role, content) {
    this.conversationHistory.push({ role, content, timestamp: Date.now() });
  }
}

class AgoraAIService {
  constructor() {
    this.appId = config.agora.appId;
    this.apiKey = config.agora.apiKey;
    this.apiSecret = config.agora.apiSecret;
  }

  getAuthHeader() {
    const credentials = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64');
    return `Basic ${credentials}`;
  }

  generateRtcToken(channelName, uid = 0) {
    // In production, use Agora's official token generation library.
    return 'temp_token';
  }

  async startConversationalEngine(channelName, callSid) {
    try {
      const url = `${config.agora.conversationalEndpoint}/${this.appId}/conversational-ai/start`;

      const response = await axios.post(
        url,
        {
          channel: channelName,
          uid: '888888',
          token: this.generateRtcToken(channelName, 888888),
          config: {
            stt: {
              provider: 'agora', // Use Agora's own STT
              language: 'en-US'
            },
            llm: {
              provider: 'agora', // Use Agora's built-in LLM
              model: 'agora-chat-model', // Placeholder for Agora's LLM model name
              systemPrompt: 'You are a helpful AI assistant answering phone calls. Keep responses conversational, friendly, and under 80 words.'
            },
            tts: {
              provider: 'agora', // Use Agora's own TTS
              voice: 'male-1',
              speed: 1.0
            }
          },
          callbackUrl: `${config.server.baseUrl}/voice/agora-callback/${callSid}`
        },
        {
          headers: {
            'Authorization': this.getAuthHeader(),
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Agora Conversational Engine started:', response.data);
      return response.data.sessionId;
    } catch (error) {
      console.error('Error starting Agora Conversational Engine:', error.response?.data || error.message);
      return null;
    }
  }

  async stopConversationalEngine(sessionId) {
    try {
      await axios.post(
        `${config.agora.conversationalEndpoint}/${this.appId}/conversational-ai/stop`,
        { sessionId: sessionId },
        {
          headers: {
            'Authorization': this.getAuthHeader(),
            'Content-Type': 'application/json'
          }
        }
      );
      console.log(`Conversational session ${sessionId} stopped`);
    } catch (error) {
      console.error('Error stopping conversational engine:', error.response?.data || error.message);
    }
  }
}

const agoraService = new AgoraAIService();

// Twilio webhook for incoming calls
app.post('/voice/incoming', async (req, res) => {
  const { CallSid, From, To } = req.body;

  console.log(`📞 Incoming call from ${From} to ${To}, CallSid: ${CallSid}`);

  const session = new CallSession(CallSid, From);
  activeCalls.set(CallSid, session);

  session.agoraConversationalSessionId = await agoraService.startConversationalEngine(session.channelName, CallSid);

  const twiml = new twilio.twiml.VoiceResponse();
  twiml.say({
    voice: 'alice',
    language: 'en-US'
  }, 'Hello! Please wait while I connect you to our AI assistant.');

  const dial = twiml.dial({
    action: `/voice/status`,
    method: 'POST'
  });
  dial.conference({
    startConferenceOnEnter: true,
    endConferenceOnExit: true,
    statusCallback: `${config.server.baseUrl}/voice/status`,
    statusCallbackEvent: 'end'
  }, session.channelName);

  res.type('text/xml');
  res.send(twiml.toString());
});

// Agora Webhook for conversational events
app.post('/voice/agora-callback/:callSid', (req, res) => {
  const { callSid } = req.params;
  const event = req.body;

  console.log(`Agora Callback Event for ${callSid}:`, event);

  const session = activeCalls.get(callSid);
  if (!session) {
    console.log(`No session found for Agora event on call ${callSid}`);
    return res.status(404).send('Session not found');
  }

  switch (event.eventType) {
    case 'transcription.update':
      if (event.content.isFinal) {
        console.log(`🎤 Final Transcription from Agora: ${event.content.text}`);
        session.addMessage('user', event.content.text);
      }
      break;
    case 'llm.response':
      console.log(`🤖 LLM Response from Agora: ${event.content.text}`);
      session.addMessage('assistant', event.content.text);
      break;
    case 'tts.started':
      console.log(`🔊 TTS playback started for CallSid: ${callSid}`);
      break;
    case 'engine.error':
      console.error('⚠️ Agora Conversational Engine Error:', event.error);
      break;
    default:
      console.log('Unhandled Agora event type:', event.eventType);
  }

  res.sendStatus(200);
});

// Twilio webhook for call status updates
app.post('/voice/status', async (req, res) => {
  const { CallSid, CallStatus } = req.body;

  console.log(`📋 Call ${CallSid} status: ${CallStatus}`);

  const session = activeCalls.get(CallSid);

  if (CallStatus === 'completed' || CallStatus === 'failed' || CallStatus === 'busy' || CallStatus === 'no-answer') {
    if (session && session.agoraConversationalSessionId) {
      await agoraService.stopConversationalEngine(session.agoraConversationalSessionId);
    }
    console.log(`🗂️ Call session ${CallSid} completed.`);
    activeCalls.delete(CallSid);
  }

  res.sendStatus(200);
});

// Health check endpoint with enhanced monitoring
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    server: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      activeCalls: activeCalls.size
    },
    config: {
      twilioConfigured: !!(config.twilio.accountSid && config.twilio.authToken),
      agoraConfigured: !!(config.agora.appId && config.agora.apiKey),
      baseUrl: config.server.baseUrl
    },
    timestamp: new Date().toISOString()
  });
});

// Get active calls with conversation data
app.get('/calls/active', (req, res) => {
  const callData = Array.from(activeCalls.entries()).map(([callSid, session]) => ({
    callSid,
    from: session.from,
    channelName: session.channelName,
    agoraConversationalSessionId: session.agoraConversationalSessionId,
    conversationLength: session.conversationHistory.length,
    lastActivity: session.conversationHistory.length > 0 ?
      new Date(session.conversationHistory[session.conversationHistory.length - 1].timestamp) : null
  }));

  res.json({
    activeCalls: callData,
    totalCalls: activeCalls.size,
    timestamp: new Date().toISOString()
  });
});

// Get conversation history for a specific call
app.get('/calls/:callSid/history', (req, res) => {
  const { callSid } = req.params;
  const session = activeCalls.get(callSid);

  if (!session) {
    return res.status(404).json({ error: 'Call session not found' });
  }

  res.json({
    callSid,
    from: session.from,
    history: session.conversationHistory,
    totalMessages: session.conversationHistory.length
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('💥 Server error:', error);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Something went wrong'
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('🔄 Shutting down gracefully...');
  for (const [callSid, session] of activeCalls) {
    if (session.agoraConversationalSessionId) {
      await agoraService.stopConversationalEngine(session.agoraConversationalSessionId);
    }
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('🔄 Received SIGINT, shutting down...');
  for (const [callSid, session] of activeCalls) {
    if (session.agoraConversationalSessionId) {
      await agoraService.stopConversationalEngine(session.agoraConversationalSessionId);
    }
  }
  process.exit(0);
});

// Start the server
const port = config.server.port;
app.listen(port, () => {
  console.log('🚀 AI Call Agent Server Started');
  console.log(`📡 Server running on port ${port}`);
  console.log(`🌐 Base URL: ${config.server.baseUrl}`);
  console.log('');
  console.log('📋 Twilio Configuration:');
  console.log(`   Webhook URL: ${config.server.baseUrl}/voice/incoming`);
  console.log(`   Status URL: ${config.server.baseUrl}/voice/status`);
  console.log('');
  console.log('🔧 Development URLs:');
  console.log(`   Health Check: ${config.server.baseUrl}/health`);
  console.log(`   Active Calls: ${config.server.baseUrl}/calls/active`);
});

module.exports = app;