import os
import torch
from torch.serialization import add_safe_globals
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.api import TTS
import gradio as gr

# ✅ Fix for PyTorch 2.6+ safe deserialization
add_safe_globals([XttsConfig])

# Ensure outputs folder exists
os.makedirs("outputs", exist_ok=True)

# Use GPU if available
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Using device: {device}")

# Load XTTS-v2 model once (human-like, multilingual)
MODEL_PATH = "/app/models/tts_models--multilingual--multi-dataset--xtts_v2"
tts = TTS(model_name=MODEL_PATH).to(device)

def generate_audio(text="Hello! How are you?"):
    file_path = "outputs/output.wav"
    # Optional: speaker="en_female_1" or provide speaker_wav="sample.wav" for cloning
    tts.tts_to_file(text=text, speaker="en_female_1", language="en", file_path=file_path)
    return file_path

# Gradio UI
demo = gr.Interface(
    fn=generate_audio,
    inputs=[gr.Text(label="Text")],
    outputs=[gr.Audio(label="Audio")],
)

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)
