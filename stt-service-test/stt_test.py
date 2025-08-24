from faster_whisper import WhisperModel

#load model
model = WhisperModel("medium", device="cuda", compute_type="float16")

#transcribe audio
segments, info = model.transcribe("audio/test.wav", beam_size=5)

#print the results
print("Detected language:", info.language)
print("Transcription:")
for segment in segments:
    print(f"[{segment.start:.2f} -> {segment.end:.2f}] {segment.text}")