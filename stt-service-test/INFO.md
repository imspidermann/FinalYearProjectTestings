# create Python venv
python -m venv venv
venv\Scripts\activate   # (Windows)

**install dependencies**
pip install faster-whisper soundfile  gradio
pip install sounddevice - for real time testing
# pip install torch - 
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126


# Ensure CUDA and cuDNN
check CUDA Version - nvcc --version 
**if not available install and setup paths**



