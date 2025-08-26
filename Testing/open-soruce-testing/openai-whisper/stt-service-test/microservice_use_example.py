def transcribe_audio(file_path: str, model_size="medium"):
    model = WhisperModel(model_size, device="cuda", compute_type="float16")
    segments, info = model.transcribe(file_path, beam_size=5)

    return {
        "language": info.language,
        "text": " ".join([seg.text for seg in segments])
    }

if __name__ == "__main__":
    result = transcribe_audio("sample.wav")
    print(result)