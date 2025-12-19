# Installation Guide

[← Back to README](../README.md)

---

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 18+ | [Download](https://nodejs.org/) |
| npm | 9+ | Included with Node.js |
| Git | Any | [Download](https://git-scm.com/) |
| Docker | Latest | Required for Docker installation |
| Python | 3.10+ | Required for local transcription only |

---

## Installation Methods

### Method 1: Interactive Installer (Recommended)

The unified installer works on Windows, Linux, and macOS.

**Windows:**
```batch
git clone https://github.com/poisonednumber/Scanner-map.git
cd Scanner-map
install.bat
```

**Linux/macOS:**
```bash
git clone https://github.com/poisonednumber/Scanner-map.git
cd Scanner-map
bash install.sh
```

The installer will:
1. ✅ Check prerequisites
2. ✅ Let you choose Docker or Local installation
3. ✅ Configure optional services (Ollama, iCAD, TrunkRecorder)
4. ✅ Set up geocoding and AI providers
5. ✅ Generate `.env` configuration
6. ✅ Optionally start services

---

### Method 2: Manual Installation

#### Docker Installation

```bash
# Clone repository
git clone https://github.com/poisonednumber/Scanner-map.git
cd Scanner-map

# Install dependencies (for installer)
npm install

# Create .env file (copy from example or create manually)
cp .env.example .env
# Edit .env with your settings

# Start services
docker-compose up -d
```

#### Local Installation

```bash
# Clone repository
git clone https://github.com/poisonednumber/Scanner-map.git
cd Scanner-map

# Install Node.js dependencies
npm install

# Create Python virtual environment (for local transcription)
python -m venv .venv
source .venv/bin/activate  # Linux/macOS
# OR: .venv\Scripts\activate  # Windows

# Install Python dependencies
pip install -r requirements.txt

# Create .env file
cp .env.example .env
# Edit .env with your settings

# Start application
npm start
```

---

## Platform-Specific Notes

### Windows

**Docker Desktop:**
- Enable WSL 2 backend (recommended)
- Restart after installation

**USB Devices (SDR dongles):**
- Docker on Windows cannot directly access USB devices
- Run SDRTrunk/TrunkRecorder on Windows host, upload to Scanner Map via API
- See [Radio Software Guide](RADIO-SOFTWARE.md)

### Linux

**Docker permissions:**
```bash
# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker
```

**USB permissions:**
```bash
# Add user to dialout group for SDR access
sudo usermod -aG dialout $USER
```

### macOS

**Docker Desktop:**
- Download from [Docker Hub](https://docs.docker.com/desktop/install/mac-install/)
- Grant permissions when prompted

---

## Verification

After installation, verify everything is working:

```bash
# Docker: Check services are running
docker-compose ps

# Docker: View logs
docker-compose logs -f scanner-map

# Local: Check process
npm start
```

**Access the web interface:** http://localhost:3001

---

## Directory Structure

After installation, your project will have:

```
Scanner-map/
├── appdata/                    # Runtime data (Docker)
│   ├── scanner-map/
│   │   ├── data/              # Database, API keys
│   │   ├── audio/             # Audio files
│   │   └── logs/              # Logs
│   ├── icad-transcribe/       # iCAD data (if enabled)
│   └── trunk-recorder/        # TrunkRecorder config (if enabled)
├── data/                       # Runtime data (Local)
├── audio/                      # Audio files (Local)
├── logs/                       # Logs (Local)
├── public/                     # Web interface
├── .env                        # Configuration
├── docker-compose.yml          # Docker services
└── bot.js                      # Main application
```

---

## Next Steps

1. [Configure your settings](CONFIGURATION.md)
2. [Set up transcription](TRANSCRIPTION.md)
3. [Configure geocoding](GEOCODING.md)
4. [Connect radio software](RADIO-SOFTWARE.md)

