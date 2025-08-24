# import sys
# from faster_whisper import WhisperModel

# print("🚀 Starting transcription...")

# audio_file = sys.argv[1] if len(sys.argv) > 1 else "audio/test.wav"
# print(f"🎵 Using audio file: {audio_file}")

# model = WhisperModel("small", device="cuda", compute_type="float16")
# print("✅ Model loaded")

# segments, info = model.transcribe(audio_file)
# print(f"🌐 Detected language: {info.language}")

# for segment in segments:
#     print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")


import gradio as gr
import sounddevice as sd
import soundfile as sf
from faster_whisper import WhisperModel
import numpy as np

print("⚡ Launching Gradio...")
# 🚀 Load model once (long-lived service)
print("Loading Whisper model...")
model = WhisperModel("medium", device="cuda", compute_type="float16")
print("✅ Model ready")

def record_audio(duration=5):
    """Record audio from mic and save as WAV."""
    print(f"🎙️ Recording {duration}s...")
    audio = sd.rec(int(duration * 16000), samplerate=16000, channels=1, dtype="int16")
    sd.wait()
    sf.write("recorded_audio.wav", audio, 16000)
    return "recorded_audio.wav"

def transcribe_audio(audio_file):
    """Transcribe audio file with streaming-style output."""
    if audio_file is None:
        return "⚠️ No audio provided"

    transcription = ""
    print(f"📂 Transcribing {audio_file} ...")

    # Streaming-style: process chunks and yield results incrementally
    segments, info = model.transcribe(audio_file, beam_size=5)
    transcription += f"🌐 Detected language: {info.language}\n\n"

    for segment in segments:
        line = f"[{segment.start:.2f}s → {segment.end:.2f}s] {segment.text}"
        print(line)  # debug log in server
        transcription += line + "\n"

    return transcription

def record_and_transcribe(duration):
    """Record + transcribe in one go."""
    audio_file = record_audio(duration)
    transcription = transcribe_audio(audio_file)
    return audio_file, transcription

# 🎨 Gradio Interface
with gr.Blocks(title="Whisper STT Service") as app:
    gr.Markdown("# 🎤 Real-time-ish Speech-to-Text (Whisper)")
    gr.Markdown("Persistent service running Whisper **medium** on GPU")

    with gr.Tab("🎙️ Record & Transcribe"):
        duration = gr.Slider(1, 30, value=5, label="Recording Duration (seconds)")
        record_btn = gr.Button("Start Recording")
        audio_output = gr.Audio(label="Recorded Audio", interactive=False)
        text_output = gr.Textbox(label="Transcription", lines=8)
        record_btn.click(record_and_transcribe, inputs=duration, outputs=[audio_output, text_output])

    with gr.Tab("📁 Upload Audio File"):
        upload_audio = gr.Audio(type="filepath", label="Upload Audio")
        upload_btn = gr.Button("Transcribe File")
        upload_text = gr.Textbox(label="Transcription", lines=8)
        upload_btn.click(transcribe_audio, inputs=upload_audio, outputs=upload_text)

# app.launch(server_name="0.0.0.0", server_port=7860)
app.launch()
