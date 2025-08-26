@echo off
echo 🚀 Building and Running Whisper Speech-to-Text Docker Container

REM Create audio_files directory if it doesn't exist
if not exist "audio_files" mkdir audio_files

REM Check if Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker is not running. Please start Docker Desktop first.
    pause
    exit /b 1
)

REM Check GPU support
echo 🔍 Testing GPU support...
docker run --rm --gpus all nvcr.io/nvidia/cuda:12.2.2-runtime-ubuntu22.04 nvidia-smi >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ NVIDIA RTX 3050 GPU support detected!
    set USE_GPU=true
) else (
    echo ⚠️  GPU support not detected - using CPU only
    echo    Make sure NVIDIA Container Toolkit is installed in WSL 2
    set USE_GPU=false
)

REM Build the Docker image
echo 🔨 Building Docker image...
docker build -t whisper-stt:latest .
if %errorlevel% neq 0 (
    echo ❌ Docker build failed
    pause
    exit /b 1
)

REM Stop and remove existing container if it exists
docker stop whisper-speech-to-text >nul 2>&1
docker rm whisper-speech-to-text >nul 2>&1

REM Run the container
echo 🏃 Starting container...
if "%USE_GPU%"=="true" (
    echo 🎮 Using GPU acceleration with RTX 3050
    docker run -d ^
        --name whisper-speech-to-text ^
        --gpus all ^
        -p 7860:7860 ^
        -v "%cd%\audio_files:/app/audio_files" ^
        -e GRADIO_SERVER_NAME=0.0.0.0 ^
        -e GRADIO_SERVER_PORT=7860 ^
        -e CUDA_VISIBLE_DEVICES=0 ^
        --restart unless-stopped ^
        whisper-stt:latest
) else (
    echo 💻 Using CPU only
    docker run -d ^
        --name whisper-speech-to-text ^
        -p 7860:7860 ^
        -v "%cd%\audio_files:/app/audio_files" ^
        -e GRADIO_SERVER_NAME=0.0.0.0 ^
        -e GRADIO_SERVER_PORT=7860 ^
        --restart unless-stopped ^
        whisper-stt:latest
)

if %errorlevel% equ 0 (
    echo ✅ Container started successfully!
    echo 🌐 Access the application at: http://localhost:7860
    echo 📋 Container name: whisper-speech-to-text
    echo.
    echo 📊 Container logs (Press Ctrl+C to stop viewing logs):
    echo.
    timeout /t 3 /nobreak >nul
    docker logs -f whisper-speech-to-text
) else (
    echo ❌ Failed to start container
    echo 🔍 Check Docker logs for more information:
    docker logs whisper-speech-to-text
    pause
    exit /b 1
)