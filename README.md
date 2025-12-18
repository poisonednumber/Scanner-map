# Scanner Map

A **real-time mapping system** for radio calls.  
Ingests calls from SDRTrunk, TrunkRecorder, or any **rdio-scanner compatible endpoint**, then:

- Transcribes audio (local or cloud AI)  
- Extracts and geocodes locations  
- Displays calls on an interactive map with **playback** and **Discord integration**

## 💬 Community Support
[![Discord](https://img.shields.io/badge/Discord-Join%20Server-7289da?logo=discord)](https://discord.gg/X7vej75zZy)

**Join our Discord community for:**
- 🆘 Installation help and troubleshooting
- 📸 Share your scanner-map setups  
- 💡 Feature requests and discussions
- 🔔 Get notified of new releases

**[Join Discord Server →](https://discord.gg/X7vej75zZy)**

---

<img width="1918" height="906" alt="434934279-4f51548f-e33f-4807-a11d-d91f3a6b4db1(1)" src="https://github.com/user-attachments/assets/801a6bb1-ee8b-4dcf-95a0-7b4d665ef394" />

---

## 🔥 Recent Updates

- **Docker-based installation** - One-command setup for all platforms
- **Free geocoding** - Nominatim (OpenStreetMap) support, no API key required
- **Optional services** - Ollama, iCAD Transcribe, TrunkRecorder as Docker services
- **Auto-configuration** - API keys and service links configured automatically
- **Centralized data** - All persistent data in `appdata/` directory
- Same geocoding.js works for both google and locationiq.
- **Admin-restricted marker editing** — Map marker editing now locked behind admin user when authentication is enabled
- **Purge calls from map** — New admin-only feature to remove calls by talkgroup category and time range, includes undo button to restore accidentally purged calls
- Full **one-command integration** (no multiple terminals)  
- Auto-generated API keys & admin users  
- Improved **AI summaries & Ask AI** features  
- New **S3 audio storage option**  
- **OpenAI transcription prompting** — configure custom prompts in `.env` to fine‑tune transcription behavior  
- **Two-tone detection** — powered by [icad-tone-detection](https://github.com/TheGreatCodeholio/icad-tone-detection).  
  - Detects fire/EMS tones in radio calls  
  - Optionally restrict address extraction to toned calls only, or combine tone + address detection for greater accuracy  
- **ICAD Transcribe integration** — thanks to [TheGreatCodeholio/icad_transcribe](https://github.com/TheGreatCodeholio/icad_transcribe) for providing advanced radio-optimized transcription support  

---

## ✨ Features

### 🚀 Core
- **One-command startup:** `docker-compose up -d`
- **Automatic setup:** database, API keys, talkgroups, admin accounts
- **Integrated services:** Discord bot + webserver run together
- **Easy installation:** Interactive installers for Windows, Linux, and macOS

### 🗺️ Mapping
- Real-time calls displayed on a Leaflet map  
- Marker clustering, heatmaps, day/night/satellite views  
- Call details with transcript + audio playback  
- Call filtering and marker editing (admin-restricted when auth enabled)
- **Call purging:** Admin-only bulk removal with undo functionality

### 🎤 Transcription
- **Local:** `faster-whisper` (CPU or NVIDIA GPU)  
- **Remote:** via [speaches](https://github.com/speaches-ai/speaches) or custom servers  
- **OpenAI Whisper API** with support for custom prompts  
- **ICAD Transcribe** for radio-optimized results  

### 🤖 AI Enhancements
- Address extraction + geocoding (Nominatim, Google Maps, or LocationIQ)  
- AI summaries of recent transmissions  
- "Ask AI" chat about call history  
- Optional two‑tone detection for toned call filtering  

### 🎮 Discord Integration
- Auto-post transcriptions by talkgroup  
- Keyword alerts  
- AI summaries with refresh buttons  
- Optional: live audio in voice channels  

### 🔒 Security
- Optional user authentication  
- Auto-generated API keys  
- Secure session management  
- Admin-only controls for sensitive operations

---

## 📦 Installation

### Prerequisites

- **Git** - [Download Git](https://git-scm.com/downloads)
- **Docker Desktop** - [Download Docker](https://docs.docker.com/get-docker/)
  - Windows: Docker Desktop for Windows
  - Linux: Docker Engine + Docker Compose
  - macOS: Docker Desktop for Mac

### Quick Start (Recommended)

**Easy installer for all platforms:**

#### Linux / macOS
```bash
bash install.sh
```

#### Windows
```batch
install.bat
```

The installer will:
- ✅ Check prerequisites (Git, Docker, Docker Compose)
- ✅ Clone the repository
- ✅ Configure optional services (Ollama, iCAD Transcribe, TrunkRecorder)
- ✅ Configure geocoding (Nominatim, LocationIQ, or Google Maps)
- ✅ Configure AI provider (OpenAI or Ollama)
- ✅ Configure Discord bot (optional)
- ✅ Create `.env` configuration file
- ✅ Set up Docker Compose
- ✅ Start all services automatically
- ✅ Optionally configure auto-start on boot

### Manual Installation Steps

If you prefer to set up manually:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/poisonednumber/Scanner-map.git
   cd Scanner-map
   ```

2. **Create `.env` file:**
   ```bash
   cp .env.example .env  # If example exists
   # Or create manually (see Configuration section)
   ```

3. **Start services:**
   ```bash
   docker-compose up -d
   ```

4. **Access the web interface:**
   - Scanner Map: http://localhost:3001
   - iCAD Transcribe (if enabled): http://localhost:9912

### Platform-Specific Instructions

#### Windows

1. **Install Docker Desktop:**
   - Download from: https://docs.docker.com/desktop/install/windows-install/
   - Enable WSL 2 backend (recommended)
   - Restart your computer after installation

2. **Run the installer:**
   ```batch
   install.bat
   ```

3. **USB Device Access (for SDR devices):**
   
   To allow Docker containers to access USB devices (like RTL-SDR dongles), you need to configure USB passthrough:
   
   **Option 1: Using Docker Desktop (Recommended)**
   
   Docker Desktop on Windows uses WSL 2, which doesn't directly support USB passthrough. Use one of these methods:
   
   **Method A: USB/IP (Windows to WSL)**
   1. Install USB/IP tools in WSL:
      ```bash
      wsl
      sudo apt-get update
      sudo apt-get install usbipd
      ```
   2. In Windows PowerShell (as Admin), share USB device:
      ```powershell
      usbipd list
      usbipd bind --busid <BUSID>
      ```
   3. In WSL, attach the device:
      ```bash
      usbip attach -r localhost -b <BUSID>
      ```
   4. Update `docker-compose.yml` to use the device:
      ```yaml
      services:
        scanner-map:
          devices:
            - /dev/bus/usb:/dev/bus/usb
      ```
   
   **Method B: Use Windows Host for SDR Software**
   - Run SDRTrunk or TrunkRecorder on Windows (not in Docker)
   - Configure them to upload to Scanner Map via HTTP API
   - This is the recommended approach for Windows users
   
   **Method C: Use Linux Container with USB Passthrough**
   - If you must use USB in Docker, consider running Docker on a Linux VM or dual-boot
   - Or use a network-based SDR solution

   **For TrunkRecorder in Docker:**
   ```yaml
   services:
     trunk-recorder:
       devices:
         - /dev/bus/usb:/dev/bus/usb  # Only works in Linux/WSL
       privileged: true  # May be required for USB access
   ```

4. **Verify installation:**
   ```batch
   docker-compose ps
   docker-compose logs scanner-map
   ```

#### Linux

1. **Install Docker:**
   ```bash
   # Ubuntu/Debian
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   sudo usermod -aG docker $USER
   
   # Install Docker Compose
   sudo apt-get update
   sudo apt-get install docker-compose-plugin
   ```

2. **Run the installer:**
   ```bash
   bash install.sh
   ```

3. **USB Device Access:**
   
   For USB devices (RTL-SDR, etc.), add your user to the `dialout` group:
   ```bash
   sudo usermod -aG dialout $USER
   newgrp dialout  # Or log out and back in
   ```
   
   Update `docker-compose.yml`:
   ```yaml
   services:
     trunk-recorder:
       devices:
         - /dev/ttyUSB0:/dev/ttyUSB0  # Your USB device
         - /dev/bus/usb:/dev/bus/usb  # All USB devices
   ```

4. **Verify installation:**
   ```bash
   docker-compose ps
   docker-compose logs scanner-map
   ```

#### macOS

1. **Install Docker Desktop:**
   - Download from: https://docs.docker.com/desktop/install/mac-install/
   - Open Docker Desktop and complete setup

2. **Run the installer:**
   ```bash
   bash install.sh
   ```

3. **USB Device Access:**
   
   macOS Docker Desktop supports USB devices through device mapping:
   ```yaml
   services:
     trunk-recorder:
       devices:
         - /dev/tty.usbserial-*:/dev/ttyUSB0
   ```

4. **Verify installation:**
   ```bash
   docker-compose ps
   docker-compose logs scanner-map
   ```

---

## ⚙️ Configuration

All main settings are in `.env`. Key options:

### Core Settings
- `WEBSERVER_PORT` — Web interface port (default: 3001)
- `BOT_PORT` — API port for call uploads (default: 3306)
- `PUBLIC_DOMAIN` — Your public domain (for Discord embeds)
- `TIMEZONE` — Your timezone (e.g., America/New_York)

### Discord Bot (Optional)
- `ENABLE_DISCORD` — Enable Discord bot (true/false)
- `DISCORD_TOKEN` — Your Discord bot token
- `CLIENT_ID` — Discord Client ID (optional)

### Geocoding
- `GEOCODING_PROVIDER` — `nominatim` (free), `locationiq`, or `google`
- `GOOGLE_MAPS_API_KEY` — Google Maps API key (if using Google)
- `LOCATIONIQ_API_KEY` — LocationIQ API key (if using LocationIQ)
- `GEOCODING_STATE` — Your state (e.g., MD)
- `GEOCODING_CITY` — Your city (e.g., Baltimore)

### AI Provider
- `AI_PROVIDER` — `openai` or `ollama`
- `OPENAI_API_KEY` — OpenAI API key (if using OpenAI)
- `OPENAI_MODEL` — OpenAI model (e.g., gpt-4o-mini)
- `OLLAMA_URL` — Ollama URL (default: http://ollama:11434)
- `OLLAMA_MODEL` — Ollama model (e.g., llama3.1:8b)

### Transcription
- `TRANSCRIPTION_MODE` — `local`, `remote`, `openai`, or `icad`
- `TRANSCRIPTION_DEVICE` — `cpu` or `cuda` (for local)
- `ICAD_URL` — iCAD Transcribe URL (default: http://icad-transcribe:9912)
- `ICAD_PROFILE` — iCAD profile/model (default: whisper-1)

### Storage
- `STORAGE_MODE` — `local` or `s3`
- S3 settings (if using S3 storage)

### Authentication
- `ENABLE_AUTH` — Enable user authentication (true/false)
- `WEBSERVER_PASSWORD` — Admin password (if auth enabled)

### Talk Groups
- `MAPPED_TALK_GROUPS` — Comma-separated talkgroup IDs
- `ENABLE_MAPPED_TALK_GROUPS` — Enable talkgroup filtering (true/false)

Other files to edit:
- `public/config.js` ← map defaults (center, zoom, icons, etc.)  
- `appdata/scanner-map/data/apikeys.json` ← auto-generated on first run  

---

## 📡 Connecting Your Radio Software

### SDRTrunk
1. Open SDRTrunk
2. Go to **Streaming** → **Rdio Scanner**
3. Add endpoint: `http://localhost:3306/api/call-upload`
4. Get API key from: `appdata/scanner-map/data/apikeys.json`
5. Enter API key in SDRTrunk

### TrunkRecorder
1. Edit `appdata/trunk-recorder/config/config.json`
2. The installer pre-configures:
   ```json
   {
     "uploadServer": {
       "type": "rdio-scanner",
       "url": "http://scanner-map:3306/api/call-upload",
       "apiKey": "AUTO_GENERATE_ON_STARTUP"
     }
   }
   ```
3. API key is auto-generated on first Scanner Map startup
4. Check `appdata/scanner-map/data/trunk-recorder-api-key.txt` for the key

### rdio-scanner
1. Add Scanner Map as a downstream server
2. URL: `http://localhost:3306/api/call-upload`
3. API key from: `appdata/scanner-map/data/apikeys.json`

---

## 🐳 Docker Services

### Available Services

- **scanner-map** (required) - Main application
- **ollama** (optional) - Local AI service
- **icad-transcribe** (optional) - Advanced transcription
- **trunk-recorder** (optional) - Radio recording

### Managing Services

```bash
# Start all services
docker-compose up -d

# Start specific service
docker-compose up -d scanner-map
docker-compose up -d icad-transcribe

# Stop services
docker-compose down

# View logs
docker-compose logs -f scanner-map
docker-compose logs -f icad-transcribe

# Restart service
docker-compose restart scanner-map

# View service status
docker-compose ps
```

### Auto-Start on Boot

The installer can configure Scanner Map to automatically start when your system boots.

**During Installation:**
- The installer will prompt you to set up auto-start after asking to start services immediately
- Choose "Yes" to configure automatic startup on boot

**Manual Setup:**

**Linux (systemd):**
```bash
# Create systemd service (if not done by installer)
sudo systemctl enable scanner-map.service
sudo systemctl start scanner-map.service

# Check status
sudo systemctl status scanner-map.service

# Disable auto-start
sudo systemctl disable scanner-map.service
```

**macOS (launchd):**
```bash
# Service is created at: ~/Library/LaunchAgents/com.scanner-map.plist
# Load service
launchctl load ~/Library/LaunchAgents/com.scanner-map.plist

# Unload service
launchctl unload ~/Library/LaunchAgents/com.scanner-map.plist
```

**Windows (Scheduled Task):**
```batch
# Task is created as "Scanner Map Auto-Start"
# Check status
schtasks /query /tn "Scanner Map Auto-Start"

# Disable auto-start
schtasks /delete /tn "Scanner Map Auto-Start" /f
```

**Note:** Docker containers already have `restart: unless-stopped` policy, so they will automatically restart when Docker starts. The auto-start configuration ensures Docker Compose starts the services on system boot.

### Service Configuration Files

- `docker-compose.yml` - Main configuration
- `docker-compose.full.yml` - All optional services enabled
- `docker-compose.with-trunk-recorder.yml` - Example with TrunkRecorder

---

## 📁 Directory Structure

```
Scanner-map/
├── appdata/                    # Persistent data (created at runtime)
│   ├── scanner-map/
│   │   ├── data/              # Database, API keys
│   │   ├── audio/             # Audio files
│   │   └── logs/              # Log files
│   ├── icad-transcribe/       # iCAD Transcribe data
│   └── trunk-recorder/        # TrunkRecorder config & recordings
├── public/                     # Web interface files
├── scripts/                    # Utility scripts
├── bot.js                      # Main application
├── webserver.js                # Web server
├── geocoding.js                # Geocoding functions
├── docker-compose.yml          # Docker configuration
├── Dockerfile                  # Scanner Map container definition
└── .env                        # Configuration (create from installer)
```

---

## 💻 System Requirements

- **OS:** Windows 10/11, Linux (Debian/Ubuntu), or macOS
- **CPU:** Modern multi-core processor
- **RAM:** 8GB minimum, 16GB+ recommended
- **GPU:** (Optional) NVIDIA CUDA (8GB+ VRAM recommended for local transcription)
- **Storage:** SSD recommended, 10GB+ free space
- **Docker:** Docker Desktop (Windows/macOS) or Docker Engine (Linux)

---

## 🛠 Troubleshooting

### Common Issues

**Services won't start:**
```bash
# Check logs
docker-compose logs scanner-map

# Check if ports are in use
netstat -an | findstr "3001"  # Windows
lsof -i :3001                 # Linux/macOS
```

**Web interface not accessible:**
- Verify services are running: `docker-compose ps`
- Check firewall settings
- Verify port mappings in `docker-compose.yml`

**API key errors:**
- Check `appdata/scanner-map/data/apikeys.json`
- Regenerate if needed: Delete the file and restart

**USB device not accessible (Windows):**
- Use Windows host for SDR software (recommended)
- Or configure USB/IP for WSL (see Windows installation section)

**Database errors:**
- Check `appdata/scanner-map/data/` directory permissions
- Verify Docker volume mounts

### Logs

- Application logs: `appdata/scanner-map/logs/`
- Docker logs: `docker-compose logs -f`
- Container logs: `docker logs scanner-map`

### Getting Help

- Check logs first
- Review `.env` configuration
- Verify Docker and Docker Compose versions
- Check [SERVICE_SETUP_GUIDES.md](SERVICE_SETUP_GUIDES.md) for optional services
- Join [Discord community](https://discord.gg/X7vej75zZy)

---

## 📚 Additional Documentation

- [SERVICE_SETUP_GUIDES.md](SERVICE_SETUP_GUIDES.md) - Setup guides for optional services
- [README_DOCKER.md](README_DOCKER.md) - Detailed Docker information
- [AUTO_API_KEY_SETUP.md](AUTO_API_KEY_SETUP.md) - API key automation details
- [APPDATA_STRUCTURE.md](APPDATA_STRUCTURE.md) - Data directory structure
- [LICENSE_NOTICE.md](LICENSE_NOTICE.md) - Third-party license information

---

## 🤝 Contributing

Pull requests and issue reports are welcome.  

## 📬 Support
- **[Join our Discord community](https://discord.gg/X7vej75zZy)** for help and discussion
- Open a GitHub Issue  
- Contact **poisonednumber** on Discord

---

## 📄 License

See [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [TrunkRecorder](https://github.com/TrunkRecorder/trunk-recorder) - GPL-3.0 licensed
- [iCAD Transcribe](https://github.com/TheGreatCodeholio/icad_transcribe) - Apache-2.0 licensed
- [Ollama](https://ollama.com) - Local AI service
