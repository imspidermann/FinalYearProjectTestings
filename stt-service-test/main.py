import gradio as gr
import sounddevice as sd
import soundfile as sf
from faster_whisper import WhisperModel

# Initialize Whisper model (load only once for efficiency)
model = WhisperModel("medium", device="cuda", compute_type="float16")

def record_audio(duration=5):
    """Record audio from microphone and save as WAV."""
    print("Recording...")
    audio = sd.rec(int(duration * 16000), samplerate=16000, channels=1, dtype="int16")
    sd.wait()
    sf.write("recorded_audio.wav", audio, 16000)
    return "recorded_audio.wav"

def transcribe_audio(audio_file):
    """Transcribe audio using Whisper."""
    segments, info = model.transcribe(audio_file, beam_size=5)
    
    transcription = f"Detected language: {info.language}\n\nTranscription:\n"
    for segment in segments:
        transcription += f"[{segment.start:.2f}s → {segment.end:.2f}s] {segment.text}\n"
    
    return transcription

def record_and_transcribe(duration):
    """Record + transcribe in one go."""
    audio_file = record_audio(duration)
    transcription = transcribe_audio(audio_file)
    return audio_file, transcription

# Gradio Interface
with gr.Blocks(title="Speech-to-Text (Whisper)") as app:
    gr.Markdown("# 🎤 Speech-to-Text with Whisper")
    
    with gr.Tab("🎙️ Record & Transcribe"):
        gr.Markdown("### Record your voice and get transcription")
        duration = gr.Slider(1, 30, value=5, label="Recording Duration (seconds)")
        record_btn = gr.Button("Start Recording")
        audio_output = gr.Audio(label="Recorded Audio", interactive=False)
        text_output = gr.Textbox(label="Transcription", lines=6)
        record_btn.click(record_and_transcribe, inputs=duration, outputs=[audio_output, text_output])
    
    with gr.Tab("📁 Upload Audio File"):
        gr.Markdown("### Upload an audio file (WAV/MP3)")
        upload_audio = gr.Audio(type="filepath", label="Upload Audio")
        upload_btn = gr.Button("Transcribe")
        upload_text = gr.Textbox(label="Transcription", lines=6)
        upload_btn.click(transcribe_audio, inputs=upload_audio, outputs=upload_text)

app.launch()