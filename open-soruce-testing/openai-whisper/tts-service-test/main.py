import torch
from TTS.api import TTS
import gradio as gr

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"Using device: {device}")

# Load once instead of reloading every call
tts = TTS(model_name='tts_models/en/ljspeech/fast_pitch', gpu=(device=="cuda"))

def genrate_audio(text='No text provided please provide some text'):
    tts.tts_to_file(text=text, file_path='outputs/output.wav')
    return 'outputs/output.wav'

print(genrate_audio())

demo = gr.Interface(
    fn=genrate_audio,
    inputs=[gr.Text(label="Text")],
    outputs=[gr.Audio(label="Audio")]
)

demo.launch()
