# Use NVIDIA CUDA base image with Python (from NVIDIA Container Registry)
FROM nvcr.io/nvidia/cuda:12.2.2-runtime-ubuntu22.04

# Set environment variables
ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Install system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    portaudio19-dev \
    libsndfile1 \
    ffmpeg \
    wget \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user
RUN useradd -m -s /bin/bash whisper_user

# Set working directory
WORKDIR /app

# Copy requirements first (for better caching)
COPY requirements.txt .

# Install Python dependencies
RUN pip3 install --no-cache-dir --upgrade pip && \
    pip3 install --no-cache-dir -r requirements.txt

# Copy application code
COPY app.py .

# Create directory for audio files
RUN mkdir -p /app/audio_files && \
    chown -R whisper_user:whisper_user /app

# Switch to non-root user
USER whisper_user

# Expose the port Gradio will use
EXPOSE 7860

# Command to run the application
CMD ["python3", "app.py"]