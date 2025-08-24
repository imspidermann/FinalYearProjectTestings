// server.js
const express = require('express');
const WebSocket = require('ws');
const mysql = require('mysql2/promise');
const twilio = require('twilio');
const path = require('path');
const http = require('http');
const { Server: IOServer } = require('socket.io');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new IOServer(server, { cors: { origin: '*' } });

// WebSocket server for Twilio Media Streams (our inbound WS endpoint)
const wss = new WebSocket.Server({ server, path: '/media-stream' });

// ───────────────────────────────────────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const ASSEMBLYAI_API_KEY = process.env.ASSEMBLYAI_API_KEY;
if (!ASSEMBLYAI_API_KEY) {
  console.warn('⚠️  Missing ASSEMBLYAI_API_KEY in .env');
}

// MySQL pool
const db = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'voice_transcription',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Active calls (in-memory)
const activeCalls = new Map();
// Structure: callSid -> {
//   ws (Twilio WS),
//   aaiWs (AssemblyAI WS),
//   callerNumber,
//   callData (db row refs),
// }

// ───────────────────────────────────────────────────────────────────────────────
// Helpers: Twilio μ-law (PCMU) -> PCM16 + upsample to 16k
// ───────────────────────────────────────────────────────────────────────────────

// μ-law decode lookup (on the fly)
function muLawDecodeSample(uVal) {
  // From ITU-T G.711 μ-law
  uVal = ~uVal & 0xff;
  const sign = (uVal & 0x80) ? -1 : 1;
  const exponent = (uVal >> 4) & 0x07;
  const mantissa = uVal & 0x0f;
  let magnitude = ((mantissa << 1) + 1) << (exponent + 2);
  magnitude -= 33; // bias correction (approx)
  let sample = sign * magnitude;
  // Clamp to int16 range
  if (sample > 32767) sample = 32767;
  if (sample < -32768) sample = -32768;
  return sample;
}

function muLawToPCM16(bufferUlaw) {
  const out = new Int16Array(bufferUlaw.length);
  for (let i = 0; i < bufferUlaw.length; i++) {
    out[i] = muLawDecodeSample(bufferUlaw[i]);
  }
  return out;
}

// Simple 8k -> 16k upsample (linear interpolation)
function upsample8kTo16k(int16mono) {
  const n = int16mono.length;
  if (n === 0) return new Int16Array(0);
  const out = new Int16Array(n * 2);
  for (let i = 0; i < n - 1; i++) {
    const a = int16mono[i];
    const b = int16mono[i + 1];
    out[2 * i] = a;
    out[2 * i + 1] = ((a + b) / 2) | 0; // midpoint
  }
  // last sample duplicate
  out[out.length - 2] = int16mono[n - 1];
  out[out.length - 1] = int16mono[n - 1];
  return out;
}

// Convert Int16Array -> Buffer (little endian)
function int16ToBufferLE(int16) {
  const buf = Buffer.alloc(int16.length * 2);
  for (let i = 0; i < int16.length; i++) {
    buf.writeInt16LE(int16[i], i * 2);
  }
  return buf;
}

// ───────────────────────────────────────────────────────────────────────────────
// Twilio Voice Webhook (answer & start media stream)
// ───────────────────────────────────────────────────────────────────────────────
app.post('/webhook/voice', (req, res) => {
  const twiml = new twilio.twiml.VoiceResponse();
  const callSid = req.body.CallSid;
  const from = req.body.From;

  console.log(`📞 Incoming call from ${from}, Call SID: ${callSid}`);

  // Greeting
  twiml.say({ voice: 'alice', language: 'en-US' },
    'Hello! This call will be transcribed. Please speak clearly.');

  // IMPORTANT: Twilio connects to our WS endpoint (/media-stream)
  // Use your external wss host (ngrok or domain). req.get('host') works when behind https proxy.
  // Twilio requires secure wss, so ensure you expose your server via https/wss (e.g. ngrok).
  twiml.start().stream({
    url: `wss://${req.get('host')}/media-stream`,
    track: 'inbound_track',
    // name: 'twilio-stream', // optional
  });

  // Keep the call open
  twiml.pause({ length: 300 });

  res.type('text/xml').send(twiml.toString());
});

// ───────────────────────────────────────────────────────────────────────────────
// AssemblyAI Realtime: open/close per-call socket
// ───────────────────────────────────────────────────────────────────────────────
function openAssemblyRealtime(callSid) {
  const realtimeUrl = 'wss://api.assemblyai.com/v2/realtime/ws?sample_rate=16000';
  const aaiWs = new WebSocket(realtimeUrl, {
    headers: { Authorization: ASSEMBLYAI_API_KEY },
  });

  aaiWs.on('open', () => {
    console.log(`🔗 [${callSid}] Connected to AssemblyAI Realtime`);
  });

  aaiWs.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      // message types: "PartialTranscript" or "FinalTranscript"
      if (data.text && data.text.trim()) {
        const callObj = activeCalls.get(callSid);
        const text = data.text.trim();

        // Emit to dashboard
        io.emit('new_transcription', {
          callSid,
          transcription: text,
          timestamp: Date.now(),
          callerNumber: callObj?.callerNumber || 'Unknown',
        });

        // Store (only store final to avoid DB spam)
        if (data.message_type === 'FinalTranscript' && callObj?.callData?.id) {
          try {
            await storeTranscription(callObj.callData.id, text);
          } catch (e) {
            console.error('❌ DB store transcription error:', e);
          }
        }
      }
    } catch (e) {
      console.error(`❌ [${callSid}] AAI message parse error:`, e);
    }
  });

  aaiWs.on('close', () => {
    console.log(`🔚 [${callSid}] AssemblyAI socket closed`);
  });

  aaiWs.on('error', (err) => {
    console.error(`❌ [${callSid}] AssemblyAI socket error:`, err);
  });

  return aaiWs;
}

// ───────────────────────────────────────────────────────────────────────────────
// Twilio Media Streams WebSocket handler
// ───────────────────────────────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  console.log('🔌 Twilio WS connected');
  let callSid = null;

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.event) {
        case 'connected':
          console.log('✅ Twilio -> connected');
          break;

        case 'start': {
          callSid = data.start.callSid;
          const callerNumber = data.start.customParameters?.from || 'Unknown';
          console.log(`🎤 Start stream: ${callSid} from ${callerNumber}`);

          // Create DB row
          const callData = await storeCall(callSid, callerNumber);

          // Open AssemblyAI ws
          const aaiWs = openAssemblyRealtime(callSid);

          // Track call
          activeCalls.set(callSid, {
            ws,
            aaiWs,
            callerNumber,
            callData,
          });

          // Notify dashboard
          io.emit('call_started', {
            callSid,
            callerNumber,
            timestamp: Date.now(),
          });
          break;
        }

        case 'media': {
          if (!callSid) break;
          const callObj = activeCalls.get(callSid);
          if (!callObj || callObj.aaiWs?.readyState !== WebSocket.OPEN) break;

          // Twilio payload: base64 μ-law @ 8kHz, 20ms frames
          const b64 = data.media.payload;
          const ulawBuf = Buffer.from(b64, 'base64');
          const pcm8k = muLawToPCM16(ulawBuf);       // Int16Array @ 8kHz
          const pcm16k = upsample8kTo16k(pcm8k);     // Int16Array @ 16kHz
          const leBuf = int16ToBufferLE(pcm16k);     // Buffer little-endian

          // Send to AAI (base64 of raw PCM16LE)
          callObj.aaiWs.send(JSON.stringify({
            audio_data: leBuf.toString('base64'),
          }));
          break;
        }

        case 'stop': {
          console.log(`⏹️  Stop stream: ${callSid}`);
          const callObj = activeCalls.get(callSid);
          if (callObj?.aaiWs && callObj.aaiWs.readyState === WebSocket.OPEN) {
            try {
              // Tell AAI we're done
              callObj.aaiWs.send(JSON.stringify({ terminate_session: true }));
              callObj.aaiWs.close();
            } catch (_) {}
          }

          // Update DB + cleanup
          await updateCallStatus(callSid, 'completed');
          activeCalls.delete(callSid);

          // Notify dashboard
          io.emit('call_ended', { callSid, timestamp: Date.now() });
          break;
        }
      }
    } catch (error) {
      console.error('❌ Twilio WS message error:', error);
    }
  });

  ws.on('close', async () => {
    console.log('🔌 Twilio WS disconnected');
    if (callSid) {
      const callObj = activeCalls.get(callSid);
      if (callObj?.aaiWs && callObj.aaiWs.readyState === WebSocket.OPEN) {
        try {
          callObj.aaiWs.send(JSON.stringify({ terminate_session: true }));
          callObj.aaiWs.close();
        } catch (_) {}
      }
      await updateCallStatus(callSid, 'completed');
      activeCalls.delete(callSid);
      io.emit('call_ended', { callSid, timestamp: Date.now() });
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// Database helpers
// ───────────────────────────────────────────────────────────────────────────────
async function storeCall(callSid, callerNumber) {
  const [result] = await db.execute(
    'INSERT INTO calls (call_sid, caller_number, status, started_at) VALUES (?, ?, ?, NOW())',
    [callSid, callerNumber, 'active']
  );
  return { id: result.insertId, call_sid: callSid, caller_number: callerNumber, status: 'active' };
}

async function storeTranscription(callId, text) {
  await db.execute(
    'INSERT INTO transcriptions (call_id, text, timestamp) VALUES (?, ?, NOW())',
    [callId, text]
  );
}

async function updateCallStatus(callSid, status) {
  await db.execute(
    'UPDATE calls SET status = ?, ended_at = NOW() WHERE call_sid = ?',
    [status, callSid]
  );
}

// ───────────────────────────────────────────────────────────────────────────────
// REST API for frontend
// ───────────────────────────────────────────────────────────────────────────────
app.get('/api/calls', async (_req, res) => {
  try {
    const [calls] = await db.execute(
      'SELECT * FROM calls ORDER BY started_at DESC LIMIT 10'
    );
    res.json(calls);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/calls/active', async (_req, res) => {
  try {
    const [calls] = await db.execute(
      'SELECT * FROM calls WHERE status = ? ORDER BY started_at DESC',
      ['active']
    );
    res.json(calls);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/calls/:callSid/transcriptions', async (req, res) => {
  try {
    const { callSid } = req.params;
    const [calls] = await db.execute(
      'SELECT id FROM calls WHERE call_sid = ?',
      [callSid]
    );
    if (calls.length === 0) {
      return res.status(404).json({ error: 'Call not found' });
    }
    const [transcriptions] = await db.execute(
      'SELECT * FROM transcriptions WHERE call_id = ? ORDER BY timestamp ASC',
      [calls[0].id]
    );
    res.json({ call: calls[0], transcriptions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Health
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    activeCalls: activeCalls.size,
    timestamp: new Date().toISOString(),
  });
});

// Serve index.html for /
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ───────────────────────────────────────────────────────────────────────────────
// Boot
// ───────────────────────────────────────────────────────────────────────────────
async function startServer() {
  try {
    await db.execute('SELECT 1'); // test DB
    console.log('✅ Database connected');

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📱 Twilio webhook URL: https://8463f80e9696.ngrok-free.app/webhook/voice`);
      console.log(`🌐 Dashboard URL: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
}
startServer();
