import sounddevice as sd
import soundfile as sf
from faster_whisper import WhisperModel

#record 5 seconds of audio
duration = 10
print("Recording...")
audio = sd.rec(int(duration * 16000 * 2), samplerate=16000 * 2, channels = 1, dtype='int16')
sd.wait()
sf.write("mic.wav", audio, 16000 * 2)
print("Recording complete. Transcribing...")

#transcribe the recorded audio
model = WhisperModel("medium", device="cuda", compute_type="float16")
segements, _ = model.transcribe("mic.wav")
for seg in segements:
    print(seg.text)

#output example:

# sahil@Sahil MINGW64 /d/FinalYearProject/stt-service-test (experiments)
# $ python stt_test_realtime.py
# Recording...
# Recording complete. Transcribing...
#  hello I am Sahil and I am currently testing this STG test data
# (venv)
# sahil@Sahil MINGW64 /d/FinalYearProject/stt-service-test (experiments)
# $ python stt_test_realtime.py
# Recording...
# Recording complete. Transcribing...
#  Hello मेरा नाम साहिल है और मैं अभी स्टेटी ट्रेक्स रियल टाइम को टेस्ट कर रहा हूं
#  और ये मैं हिंडि में ट्राइ कर रहा हूं
# (venv)