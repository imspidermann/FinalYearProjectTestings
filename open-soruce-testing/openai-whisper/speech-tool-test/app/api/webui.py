# speech_tools/app/api/webui.py
from typing import Optional, Tuple
import gradio as gr
from app.tts.engine import TTSEngine
from app.stt.engine import STTEngine
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class SpeechInterface:
    def __init__(self):
        """Initialize both TTS and STT engines"""
        try:
            self.tts = TTSEngine()
            self.stt = STTEngine()
            logger.info("Speech services initialized successfully")
        except Exception as e:
            logger.error(f"Initialization failed: {str(e)}")
            raise RuntimeError("Failed to initialize speech services")

    def process_stt(self, duration: int) -> Tuple[Optional[str], Optional[str]]:
        """Handle STT pipeline: Record → Transcribe"""
        try:
            # Record audio
            audio_path = self.stt.record(duration)
            if not audio_path:
                raise ValueError("Recording failed")
            
            # Transcribe audio
            language, transcription = self.stt.transcribe(audio_path)
            if not transcription:
                raise ValueError("Transcription failed")
            
            return audio_path, transcription
        except Exception as e:
            logger.error(f"STT processing failed: {str(e)}")
            return None, str(e)

    def process_tts(self, text: str) -> Optional[str]:
        """Handle TTS pipeline: Text → Speech"""
        try:
            if not text.strip():
                raise ValueError("Empty input text")
            return self.tts.synthesize(text)
        except Exception as e:
            logger.error(f"TTS processing failed: {str(e)}")
            return None

    def stt_to_tts(self, duration: int) -> Tuple[Optional[str], Optional[str]]:
        """Full pipeline: Record → Transcribe → Speak"""
        try:
            audio_path, transcription = self.process_stt(duration)
            if not transcription:
                raise ValueError("STT step failed")
            
            output_path = self.process_tts(transcription)
            if not output_path:
                raise ValueError("TTS step failed")
            
            return transcription, output_path
        except Exception as e:
            logger.error(f"STT→TTS pipeline failed: {str(e)}")
            return None, str(e)

    def tts_to_stt(self, text: str) -> Tuple[Optional[str], Optional[str]]:
        """Full pipeline: Text → Speak → Transcribe"""
        try:
            audio_path = self.process_tts(text)
            if not audio_path:
                raise ValueError("TTS step failed")
            
            _, transcription = self.stt.transcribe(audio_path)
            if not transcription:
                raise ValueError("STT step failed")
            
            return audio_path, transcription
        except Exception as e:
            logger.error(f"TTS→STT pipeline failed: {str(e)}")
            return None, str(e)

def create_interface():
    """Create Gradio interface with all features"""
    interface = SpeechInterface()
    
    with gr.Blocks(title="Speech Tools Pro", theme=gr.themes.Soft()) as app:
        gr.Markdown("""
        # 🎤🔊 Speech Processing Platform
        *Record audio, transcribe speech, generate synthetic voice*
        """)

        # STT Tab
        with gr.Tab("🎙️ Speech-to-Text"):
            with gr.Row():
                with gr.Column():
                    duration = gr.Slider(1, 30, value=5, 
                                       label="Recording Duration (seconds)")
                    stt_btn = gr.Button("Record & Transcribe", variant="primary")
                with gr.Column():
                    stt_audio = gr.Audio(label="Recording", interactive=False)
            stt_text = gr.Textbox(label="Transcription", lines=5)
            stt_btn.click(
                fn=interface.process_stt,
                inputs=duration,
                outputs=[stt_audio, stt_text]
            )

        # TTS Tab
        with gr.Tab("🔊 Text-to-Speech"):
            tts_input = gr.Textbox(label="Enter Text", 
                                 placeholder="Type something...")
            tts_btn = gr.Button("Generate Speech", variant="primary")
            tts_output = gr.Audio(label="Generated Audio", interactive=False)
            tts_btn.click(
                fn=interface.process_tts,
                inputs=tts_input,
                outputs=tts_output
            )

        # STT→TTS Pipeline
        with gr.Tab("🔄 Voice Echo"):
            with gr.Row():
                with gr.Column():
                    pipeline_duration = gr.Slider(1, 20, value=5, 
                                                 label="Recording Duration")
                    pipeline_btn = gr.Button("Record → Transcribe → Speak", 
                                          variant="primary")
                with gr.Column():
                    pipeline_audio = gr.Audio(label="Echo Audio", 
                                           interactive=False)
            pipeline_text = gr.Textbox(label="Transcription", lines=5)
            pipeline_btn.click(
                fn=interface.stt_to_tts,
                inputs=pipeline_duration,
                outputs=[pipeline_text, pipeline_audio]
            )

        # TTS→STT Pipeline
        with gr.Tab("🔄 Text Roundtrip"):
            with gr.Row():
                with gr.Column():
                    ttsstt_input = gr.Textbox(label="Enter Text", 
                                            placeholder="Type something...")
                    ttsstt_btn = gr.Button("Generate → Transcribe", 
                                         variant="primary")
                with gr.Column():
                    ttsstt_audio = gr.Audio(label="Generated Audio", 
                                          interactive=False)
            ttsstt_text = gr.Textbox(label="Roundtrip Transcription", lines=5)
            ttsstt_btn.click(
                fn=interface.tts_to_stt,
                inputs=ttsstt_input,
                outputs=[ttsstt_audio, ttsstt_text]
            )

        # Error handling
        app.load(
            fn=lambda: gr.Info("Application ready!"),
            inputs=None,
            outputs=None,
            queue=False
        )

    return app