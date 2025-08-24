import time
from faster_whisper import WhisperModel

model = WhisperModel("medium", device="cuda", compute_type="float16")

start = time.time()
segments, info = model.transcribe("audio/test.wav", beam_size=5)
end = time.time()

audio_length = sum([s.end - s.start for s in segments])
print(f"Audio length: {audio_length:.2f}s, Processing time: {end - start:.2f}s, RTF={ (end-start)/audio_length :.2f}")
