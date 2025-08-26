# Install Coqui TTS

python -m venv venv
source venv/bin/activate # Linux/Mac
venv\Scripts\activate # Windows

pip install TTS or pip install TTS --prefer-binary

tts --help

# list available models

tts --list_models

example output -

tts_models/en/ljspeech/tacotron2-DDC
tts_models/en/vctk/vits
tts_models/multilingual/multi-dataset/your_tts
tts_models/hi/cv/vits

# download and test

tts --model_name tts_models/en/vctk/vits --text "Hello! This is a test of Coqui TTS." --out_path output.wav

# test by running this in terminal -

**still need to test and find better way to work with tts for multilangual**
1. tts --model_name tts_models/en/ljspeech/tacotron2-DDC --text "Hello Sahil, Coqui TTS is finally working!" --out_path hello.wav
2. tts --model_name tts_models/multilingual/multi-dataset/your_tts \
    --text "नमस्ते, यह हमारी TTS प्रणाली है।" \
    --speaker_idx female-en-5 \
    --out_path output_hi.wav



**note**

- you need to have eSpeak NG installed in your laptop run it correctly.
