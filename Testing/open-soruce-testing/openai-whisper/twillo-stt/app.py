import base64
import json
import os
import threading
from queue import Queue
from pydub import AudioSegment
import audioop

from flask import Flask, request, render_template
from flask_socketio import SocketIO, emit
from twilio.twiml.voice_response import VoiceResponse, Connect, Stream
from faster_whisper import WhisperModel
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# --- Configuration ---
app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv("FLASK_SECRET_KEY", "your_secret_key")
socketio = SocketIO(app, cors_allowed_origins="*")

# Twilio Configuration
NGROK_TUNNEL_URL = os.getenv("NGROK_TUNNEL_URL")

# --- Global Variables and Queues ---
audio_queue = Queue()
audio_buffer = AudioSegment.empty()
transcription_thread_running = False

# Load the faster-whisper model once at startup
print("Loading faster_whisper model...")
model = WhisperModel("tiny.en", device="cpu", compute_type="int8")
print("Model loaded.")

# --- Transcription Logic ---
def transcribe_audio_chunks():
    """
    A separate thread that pulls audio data from the queue,
    transcribes it, and sends the result to the frontend.
    """
    global audio_buffer, transcription_thread_running
    
    transcription_thread_running = True
    
    while transcription_thread_running or not audio_queue.empty():
        try:
            raw_audio_chunk = audio_queue.get(block=True, timeout=1)
            if raw_audio_chunk is None:
                break

            wav_chunk = AudioSegment(
                data=raw_audio_chunk,
                sample_width=1,
                frame_rate=8000,
                channels=1
            ).set_frame_rate(16000)

            audio_buffer += wav_chunk
            
            # Key Change: Only proceed if there is data in the buffer
            if len(audio_buffer) >= 3000:
                # Key Change: Check if the buffer is not empty before exporting
                if audio_buffer:
                    try:
                        with audio_buffer.export(format="wav") as temp_wav:
                            segments, _ = model.transcribe(temp_wav, beam_size=5)
                            transcription = " ".join([s.text for s in segments])
                            
                            if transcription:
                                print(f"Transcription: {transcription}")
                                socketio.emit('transcription_update', {'text': transcription}, namespace='/')

                        audio_buffer = AudioSegment.empty()
                    except Exception as e:
                        print(f"Transcription export error: {e}")
            
            audio_queue.task_done()
        except Exception as e:
            if not transcription_thread_running and audio_queue.empty():
                break
            print(f"Transcription error: {e}")

    print("Transcription thread stopped.")

# Start the transcription thread at the application's startup
threading.Thread(target=transcribe_audio_chunks, daemon=True).start()

# --- Twilio Endpoint for Call Handling ---
@app.route("/voice", methods=['POST'])
def voice():
    response = VoiceResponse()
    response.say("Connecting to the transcription service.")
    
    connect = Connect()
    connect.stream(url=f"wss://{NGROK_TUNNEL_URL}/media")
    response.append(connect)
    
    return str(response)

# --- WebSocket Endpoints for Communication ---
@socketio.on('connect', namespace='/media')
def twilio_media_connect():
    print("Twilio Media Stream connected.")

@socketio.on('message', namespace='/media')
def twilio_media_message(message):
    event = message.get("event")
    
    if event == "media":
        payload = message["media"]["payload"]
        audio_chunk = base64.b64decode(payload)
        audio_queue.put(audio_chunk)
    
    elif event == "stop":
        print("Twilio Media Stream stopped.")
        global transcription_thread_running
        transcription_thread_running = False
        audio_queue.put(None)

@socketio.on('connect', namespace='/')
def frontend_connect():
    print("Frontend client connected.")

@socketio.on('disconnect', namespace='/')
def frontend_disconnect():
    print("Frontend client disconnected.")

# --- Frontend Route ---
@app.route("/")
def index():
    return render_template("index.html")

if __name__ == "__main__":
    socketio.run(app, debug=True, port=5000, allow_unsafe_werkzeug=True)