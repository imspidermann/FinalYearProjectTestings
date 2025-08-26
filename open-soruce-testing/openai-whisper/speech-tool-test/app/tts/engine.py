# speech_tools/app/tts/engine.py
import torch
from TTS.api import TTS
import logging
from typing import Optional

class TTSEngine:
    def __init__(self):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        try:
            self.model = TTS(model_name='tts_models/en/ljspeech/fast_pitch').to(self.device)
            logging.info("TTS engine initialized successfully")
        except Exception as e:
            logging.error(f"Failed to initialize TTS: {str(e)}")
            raise

    def synthesize(self, text: str, output_path: str = "tts_output.wav") -> Optional[str]:
        try:
            if not text.strip():
                raise ValueError("Empty input text")
            self.model.tts_to_file(text=text, file_path=output_path)
            return output_path
        except Exception as e:
            logging.error(f"TTS synthesis failed: {str(e)}")
            return None