# Multi-stage Dockerfile for Scanner Map
# Stage 1: Base image with Node.js and Python
FROM node:18-slim as base

# Install Python 3 and build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    build-essential \
    ffmpeg \
    git \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Stage 2: Install Python dependencies
FROM base as python-deps

# Create virtual environment
RUN python3 -m venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# Copy Python requirements
COPY requirements.txt /app/
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Stage 3: Install Node.js dependencies
FROM base as node-deps

# Copy package files
COPY package.json /app/

# Install Node.js dependencies (production only)
# Using npm install instead of npm ci since package-lock.json may not exist
RUN npm install --omit=dev --no-audit --no-fund

# Stage 4: Final image
FROM base as final

# Copy Python virtual environment
COPY --from=python-deps /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# Copy Node.js dependencies
COPY --from=node-deps /app/node_modules /app/node_modules

# Copy application code (only what's needed, excluding node_modules, .git, etc.)
COPY bot.js webserver.js geocoding.js import_csv.js /app/
COPY tone_detect.py transcribe.py /app/
COPY requirements.txt package.json /app/
COPY public/ /app/public/
COPY scripts/ /app/scripts/
# Note: talkgroups.csv is mounted as a volume, so we don't need to copy it

# Create necessary directories
RUN mkdir -p /app/audio /app/data /app/logs /app/appdata/trunk-recorder/config /app/appdata/icad-transcribe

# Set permissions only on directories we created (not on entire /app which includes node_modules)
RUN chmod 755 /app/audio /app/data /app/logs /app/appdata

# Expose ports
EXPOSE 3001 3306

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3001/api/test', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the application
CMD ["node", "bot.js"]

