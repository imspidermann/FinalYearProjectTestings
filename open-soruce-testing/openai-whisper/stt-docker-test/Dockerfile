# Use official PyTorch image with CUDA 12.1 and cuDNN 8
FROM pytorch/pytorch:2.1.2-cuda12.1-cudnn8-runtime

# Prevent interactive prompts
ENV DEBIAN_FRONTEND=noninteractive

# Install system dependencies including build tools and PortAudio
RUN apt-get update && apt-get install -yq \
    ffmpeg git build-essential cmake libportaudio2 libportaudiocpp0 portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*

# Upgrade pip/setuptools/wheel
RUN python3 -m pip install --upgrade pip setuptools wheel

# Install Rust compiler (required for tokenizers)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Python dependencies
RUN pip install --no-cache-dir \
    tokenizers==0.15.2 \
    faster-whisper \
    soundfile \
    sounddevice \
    gradio

# Preload Whisper model (medium) to speed up first request
RUN python3 -c "from faster_whisper import WhisperModel; WhisperModel('medium', device='cuda', compute_type='float16')"

# Set working directory
WORKDIR /app

# Copy application code
COPY . /app

# Expose Gradio default port
EXPOSE 7860

# Run the app
CMD ["python3", "app.py"]
