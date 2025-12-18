# Multi-stage Dockerfile for Scanner Map (Optimized for lightweight production)
# Target size: <2GB (down from ~14GB)

# Stage 1: Python build environment (Alpine for smaller size)
FROM python:3.11-alpine as python-build

# Install build dependencies
RUN apk add --no-cache \
    gcc \
    g++ \
    musl-dev \
    linux-headers \
    ffmpeg-dev \
    git \
    make \
    cmake

# Create virtual environment
WORKDIR /build
RUN python3 -m venv /build/.venv
ENV PATH="/build/.venv/bin:$PATH"

# Copy and install Python requirements
COPY requirements.txt /build/
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Stage 2: Node.js build environment (Alpine)
FROM node:18-alpine as node-build

WORKDIR /build

# Copy package files and install dependencies
COPY package.json /build/
RUN npm install --omit=dev --no-audit --no-fund

# Stage 3: Final runtime image (minimal Alpine base)
FROM alpine:3.19

# Install only runtime dependencies (no build tools)
RUN apk add --no-cache \
    nodejs \
    npm \
    python3 \
    py3-pip \
    ffmpeg \
    && rm -rf /var/cache/apk/*

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

    CMD node -e "require('http').get('http://localhost:3001/api/test', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "bot.js"]

    CMD node -e "require('http').get('http://localhost:3001/api/test', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "bot.js"]

    CMD node -e "require('http').get('http://localhost:3001/api/test', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "bot.js"]
