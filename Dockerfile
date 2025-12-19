# Multi-stage Dockerfile for Scanner Map (Optimized for lightweight production)
# Target size: <2GB (down from ~14GB)

# Stage 1: Python build environment (Debian slim for better package compatibility)
FROM python:3.11-slim as python-build

# Build argument for transcription mode
ARG TRANSCRIPTION_MODE=local

# Install build dependencies (only if needed for local transcription)
# For non-local modes, we only need minimal runtime dependencies
RUN if [ "$TRANSCRIPTION_MODE" = "local" ]; then \
      apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        g++ \
        libffi-dev \
        libssl-dev \
        ffmpeg \
        libavformat-dev \
        libavcodec-dev \
        libavdevice-dev \
        libavutil-dev \
        libswscale-dev \
        libswresample-dev \
        libavfilter-dev \
        pkg-config \
        git \
        make \
        cmake \
        && rm -rf /var/lib/apt/lists/*; \
    else \
      apt-get update && apt-get install -y --no-install-recommends \
        ffmpeg \
        && rm -rf /var/lib/apt/lists/*; \
    fi

# Create virtual environment
WORKDIR /build
RUN python3 -m venv /build/.venv
ENV PATH="/build/.venv/bin:$PATH"

# Copy and install Python requirements
COPY requirements.txt /build/

# Upgrade pip
RUN pip install --no-cache-dir --upgrade pip

# Install dependencies based on transcription mode
RUN if [ "$TRANSCRIPTION_MODE" = "local" ]; then \
      # Local transcription mode: install PyTorch, av, faster-whisper, etc. \
      echo "Installing local transcription dependencies (PyTorch, faster-whisper, av)..." && \
      pip install --no-cache-dir torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu && \
      pip install --no-cache-dir --upgrade "setuptools>=65.0" wheel && \
      pip install --no-cache-dir "Cython>=0.29,<3.0" && \
      pip install --no-cache-dir "av==12.3.0" && \
      pip install --no-cache-dir -r requirements.txt || \
        (echo "Fallback: Installing packages individually..." && \
         pip install --no-cache-dir "faster-whisper>=0.10.0" pydub>=0.25.1 icad-tone-detection>=1.0.0 python-dotenv>=1.0.0 boto3>=1.34.0 && \
         echo "Installed packages individually"); \
    else \
      # Non-local modes: only install minimal dependencies (no build needed) \
      echo "Installing minimal dependencies for $TRANSCRIPTION_MODE transcription mode..." && \
      pip install --no-cache-dir python-dotenv>=1.0.0 boto3>=1.34.0 icad-tone-detection>=1.0.0; \
    fi

# Stage 2: Node.js build environment (Debian slim for compatibility)
FROM node:18-slim as node-build

WORKDIR /build

# Copy package files and install dependencies
COPY package.json /build/
RUN npm install --omit=dev --no-audit --no-fund

# Stage 3: Final runtime image (Node.js base with Python for compatibility)
FROM node:18-slim

# Install Python 3 and ffmpeg runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy Python virtual environment from build stage
COPY --from=python-build /build/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# Copy Node.js dependencies from build stage
COPY --from=node-build /build/node_modules /app/node_modules

# Copy application code (only what's needed)
COPY bot.js webserver.js geocoding.js import_csv.js /app/
COPY tone_detect.py transcribe.py /app/
COPY requirements.txt package.json /app/
COPY public/ /app/public/
COPY scripts/ /app/scripts/

# Create necessary directories
RUN mkdir -p /app/audio /app/data /app/logs /app/appdata/trunk-recorder/config /app/appdata/icad-transcribe && \
    chmod 755 /app/audio /app/data /app/logs /app/appdata

# Expose ports
EXPOSE 3001 3306

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/api/test', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "bot.js"]
