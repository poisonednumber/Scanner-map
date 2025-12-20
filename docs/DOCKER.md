# Docker Setup Guide

[← Back to README](../README.md)

---

## Available Services

| Service | Description | Default Port |
|---------|-------------|--------------|
| `scanner-map` | Main application (required) | 3001, 3306 |
| `ollama` | Local AI service (optional) | 11434 |
| `icad-transcribe` | Advanced transcription (optional) | 9912 |
| `trunk-recorder` | Radio recording (optional) | - |
| `rdio-scanner` | Web-based scanner (optional) | 3000 |
| `op25` | Command-line decoder (optional) | - |

---

## Docker Compose Files

| File | Use Case |
|------|----------|
| `docker-compose.yml` | Default - Scanner Map only |
| `docker-compose.full.yml` | All services enabled |
| `docker-compose.with-trunk-recorder.yml` | With TrunkRecorder |
| `docker-compose.prod.yml` | Production optimized |

---

## Basic Commands

```bash
# Start all services
docker-compose up -d

# Start specific services
docker-compose up -d scanner-map ollama

# Stop all services
docker-compose down

# View logs
docker-compose logs -f
docker-compose logs -f scanner-map

# Restart a service
docker-compose restart scanner-map

# Rebuild after changes
docker-compose build --no-cache
docker-compose up -d
```

---

## Service Configuration

### Scanner Map (Required)

Always included. Configured via `.env` file.

```yaml
services:
  scanner-map:
    build: .
    ports:
      - "${WEBSERVER_PORT:-3001}:3001"
      - "${BOT_PORT:-3306}:3306"
    volumes:
      - ./appdata/scanner-map/data:/app/data
      - ./appdata/scanner-map/audio:/app/audio
      - ./appdata/scanner-map/logs:/app/logs
      - ./.env:/app/.env
```

### Ollama (Optional)

Local AI service for address extraction and summaries.

```yaml
services:
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ./appdata/ollama:/root/.ollama
    # GPU support (uncomment for NVIDIA)
    # deploy:
    #   resources:
    #     reservations:
    #       devices:
    #         - driver: nvidia
    #           count: 1
    #           capabilities: [gpu]
```

**After starting:**
```bash
# Pull a model
docker exec -it ollama ollama pull llama3.1:8b
```

### iCAD Transcribe (Optional)

Advanced transcription with radio-optimized profiles.

```yaml
services:
  icad-transcribe:
    image: thegreatcodeholio/icad_transcribe:latest
    ports:
      - "9912:9912"
    volumes:
      - ./appdata/icad-transcribe:/app/data
    environment:
      - ICAD_API_KEY=${ICAD_API_KEY}
```

**Configuration:**
- Web interface: http://localhost:9912
- Change default password in `appdata/icad-transcribe/.env`
- Install transcription models via web UI

### TrunkRecorder (Optional)

Radio recording and call capture.

```yaml
services:
  trunk-recorder:
    image: robotastic/trunk-recorder:latest
    privileged: true
    volumes:
      - ./appdata/trunk-recorder/config:/app/config
      - ./appdata/trunk-recorder/recordings:/app/recordings
    devices:
      - /dev/bus/usb:/dev/bus/usb  # USB access (Linux only)
```

**Note:** USB passthrough only works on Linux. On Windows, run TrunkRecorder natively.

---

## Data Persistence

All persistent data is stored in the `appdata/` directory:

```
appdata/
├── scanner-map/
│   ├── data/          # Database, API keys
│   ├── audio/         # Audio recordings
│   └── logs/          # Application logs
├── ollama/            # Ollama models
├── icad-transcribe/   # iCAD data
├── trunk-recorder/
│   ├── config/        # TrunkRecorder config
│   └── recordings/    # Raw recordings
├── sdrtrunk/
│   └── config/        # SDRTrunk config files
├── rdio-scanner/
│   ├── config/        # rdio-scanner config
│   └── data/          # rdio-scanner data
└── op25/
    ├── config/        # OP25 config
    └── recordings/    # Audio recordings
```

**Backup:** Simply backup the `appdata/` folder.

---

## Networking

All services communicate over the `scanner-network` Docker network.

Service URLs from within Docker:
- Scanner Map → Ollama: `http://ollama:11434`
- Scanner Map → iCAD: `http://icad-transcribe:9912`
- TrunkRecorder → Scanner Map: `http://scanner-map:3306`
- rdio-scanner → Scanner Map: `http://scanner-map:3306`
- OP25 → Scanner Map: `http://scanner-map:3306`

Service URLs from host:
- Scanner Map: `http://localhost:3001`
- Ollama: `http://localhost:11434`
- iCAD: `http://localhost:9912`

---

## GPU Support (NVIDIA)

For CUDA acceleration with Ollama or local transcription:

1. Install NVIDIA Container Toolkit:
```bash
# Ubuntu/Debian
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://nvidia.github.io/libnvidia-container/stable/ubuntu22.04/amd64 /" | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker
```

2. Uncomment GPU sections in `docker-compose.yml`

3. Restart services:
```bash
docker-compose down
docker-compose up -d
```

---

## Auto-Start on Boot

Docker containers with `restart: unless-stopped` will auto-restart when Docker starts.

To ensure Docker starts on boot:

**Linux (systemd):**
```bash
sudo systemctl enable docker
```

**Windows/macOS:**
- Docker Desktop: Enable "Start Docker Desktop when you log in"

---

## Troubleshooting

### Services won't start
```bash
# Check logs
docker-compose logs scanner-map

# Check if ports are in use
netstat -an | grep 3001
```

### Permission errors
```bash
# Fix ownership
sudo chown -R $USER:$USER appdata/
```

### Out of disk space
```bash
# Clean up Docker
docker system prune -a
```

### Container keeps restarting
```bash
# Check exit code
docker inspect scanner-map --format='{{.State.ExitCode}}'

# View full logs
docker logs scanner-map --tail 100
```

