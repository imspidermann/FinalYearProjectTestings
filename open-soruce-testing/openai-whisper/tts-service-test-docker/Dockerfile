# Base image with CUDA runtime
FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

# Install Python & system dependencies
RUN apt-get update && apt-get install -y \
    python3 python3-pip python3-venv git ffmpeg espeak \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy project files
COPY requirements.txt .
COPY app.py .
RUN mkdir outputs models

# Install GPU-enabled PyTorch
RUN pip3 install --no-cache-dir torch==2.3.1+cu121 torchvision==0.18.1+cu121 torchaudio==2.3.1+cu121 \
    -f https://download.pytorch.org/whl/torch_stable.html

# Install TTS + Gradio
RUN pip3 install --no-cache-dir -r requirements.txt

# ✅ Pre-download XTTS-v2 model inside Docker so it doesn't download at runtime
RUN python3 -c "from torch.serialization import add_safe_globals; \
from TTS.tts.configs.xtts_config import XttsConfig; add_safe_globals([XttsConfig]); \
from TTS.api import TTS; \
TTS('tts_models/multilingual/multi-dataset/xtts_v2', progress_bar=False, cache_path='/app/models')"

EXPOSE 7860

# Run app
CMD ["python3", "app.py"]
