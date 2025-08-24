import gradio as gr
import sounddevice as sd
import soundfile as sf
from faster_whisper import WhisperModel
import os

# Initialize Whisper model (load only once for efficiency)
# Check for GPU availability
def get_device():
    import subprocess
    try:
        # Check if nvidia-smi works (GPU available)
        result = subprocess.run(['nvidia-smi'], capture_output=True, text=True)
        if result.returncode == 0 and 'NVIDIA' in result.stdout:
            return "cuda", "float16"
        else:
            return "cpu", "int8"
    except:
        return "cpu", "int8"

device, compute_type = get_device()

print(f"🔍 GPU Detection:")
print(f"   Device: {device}")
print(f"   Compute Type: {compute_type}")
print(f"   CUDA_VISIBLE_DEVICES: {os.getenv('CUDA_VISIBLE_DEVICES', 'Not set')}")

if device == "cuda":
    print("🎮 RTX 3050 GPU acceleration enabled!")
else:
    print("💻 Running on CPU mode")

print(f"Initializing Whisper model on {device}...")
model = WhisperModel("medium", device=device, compute_type=compute_type)

def record_audio(duration=5):
    """Record audio from microphone and save as WAV."""
    print(f"Recording for {duration} seconds...")
    try:
        audio = sd.rec(int(duration * 16000), samplerate=16000, channels=1, dtype="int16")
        sd.wait()
        
        # Save to audio_files directory
        audio_path = "/app/audio_files/recorded_audio.wav"
        sf.write(audio_path, audio, 16000)
        print(f"Audio saved to {audio_path}")
        return audio_path
    except Exception as e:
        print(f"Recording error: {e}")
        return None

def transcribe_audio(audio_file):
    """Transcribe audio using Whisper."""
    if not audio_file:
        return "No audio file provided."
    
    try:
        print(f"Transcribing audio file: {audio_file}")
        segments, info = model.transcribe(audio_file, beam_size=5)
        
        transcription = f"Detected language: {info.language}\n\nTranscription:\n"
        for segment in segments:
            transcription += f"[{segment.start:.2f}s → {segment.end:.2f}s] {segment.text}\n"
        
        return transcription
    except Exception as e:
        return f"Transcription error: {str(e)}"

def record_and_transcribe(duration):
    """Record + transcribe in one go."""
    audio_file = record_audio(duration)
    if audio_file:
        transcription = transcribe_audio(audio_file)
        return audio_file, transcription
    else:
        return None, "Failed to record audio. Check microphone permissions."

# Gradio Interface
with gr.Blocks(title="Speech-to-Text (Whisper)") as app:
    gr.Markdown("# 🎤 Speech-to-Text with Whisper")
    gr.Markdown(f"**Running on:** {device.upper()} | **Compute Type:** {compute_type}")
    
    with gr.Tab("🎙️ Record & Transcribe"):
        gr.Markdown("### Record your voice and get transcription")
        duration = gr.Slider(1, 30, value=5, label="Recording Duration (seconds)")
        record_btn = gr.Button("Start Recording", variant="primary")
        audio_output = gr.Audio(label="Recorded Audio", interactive=False)
        text_output = gr.Textbox(label="Transcription", lines=6)
        record_btn.click(record_and_transcribe, inputs=[duration], outputs=[audio_output, text_output])
    
    with gr.Tab("📁 Upload Audio File"):
        gr.Markdown("### Upload an audio file (WAV/MP3)")
        upload_audio = gr.Audio(type="filepath", label="Upload Audio")
        upload_btn = gr.Button("Transcribe", variant="primary")
        upload_text = gr.Textbox(label="Transcription", lines=6)
        upload_btn.click(transcribe_audio, inputs=[upload_audio], outputs=[upload_text])

if __name__ == "__main__":
    print(f"🌐 Starting Gradio app on http://0.0.0.0:7860")
    app.launch(
        server_name="0.0.0.0",
        server_port=7860,
        share=False
    )