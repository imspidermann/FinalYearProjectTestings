# speech_tools/app/stt/engine.py
from faster_whisper import WhisperModel
import logging
from typing import Tuple, Optional
import sounddevice as sd
import soundfile as sf

class STTEngine:
    def __init__(self):
        try:
            self.model = WhisperModel("medium", device="cuda", compute_type="float16")
            logging.info("STT engine initialized successfully")
        except Exception as e:
            logging.error(f"Failed to initialize STT: {str(e)}")
            raise

    def record(self, duration: int = 5) -> Optional[str]:
        try:
            audio = sd.rec(int(duration * 16000), samplerate=16000, channels=1, dtype='int16')
            sd.wait()
            sf.write("recording.wav", audio, 16000)
            return "recording.wav"
        except Exception as e:
            logging.error(f"Recording failed: {str(e)}")
            return None

    def transcribe(self, audio_path: str) -> Tuple[Optional[str], Optional[str]]:
        try:
            segments, info = self.model.transcribe(audio_path, beam_size=5)
            transcription = "\n".join(
                # f"[{segment.start:.2f}s → {segment.end:.2f}s] {segment.text}"
                f"{segment.text}"
                for segment in segments
            )
            return info.language, transcription
        except Exception as e:
            logging.error(f"Transcription failed: {str(e)}")
            return None, None