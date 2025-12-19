# Scanner Map

**Real-time radio call mapping with AI transcription and geocoding.**

[![Discord](https://img.shields.io/badge/Discord-Join%20Server-7289da?logo=discord)](https://discord.gg/X7vej75zZy)

Scanner Map ingests radio calls from SDRTrunk, TrunkRecorder, or any rdio-scanner compatible source, then:
- 🎤 **Transcribes** audio using local AI, OpenAI, or iCAD
- 📍 **Extracts addresses** and geocodes them to coordinates
- 🗺️ **Displays calls** on an interactive real-time map
- 🎮 **Integrates with Discord** for notifications and alerts

<img width="1918" alt="Scanner Map Screenshot" src="https://github.com/user-attachments/assets/801a6bb1-ee8b-4dcf-95a0-7b4d665ef394" />

---

## ✨ Features

| Category | Features |
|----------|----------|
| **Mapping** | Real-time Leaflet map, marker clustering, heatmaps, day/night/satellite views |
| **Transcription** | Local Whisper, remote servers, OpenAI API, iCAD Transcribe |
| **AI** | Address extraction, call categorization, summaries, "Ask AI" chat |
| **Geocoding** | Nominatim (free), LocationIQ, Google Maps |
| **Discord** | Auto-post by talkgroup, keyword alerts, AI summaries |
| **Security** | Optional authentication, auto-generated API keys, session management |
| **Storage** | Local files or S3-compatible storage |
| **Detection** | Two-tone pager detection for fire/EMS calls |

---

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+** - [Download](https://nodejs.org/)
- **Git** - [Download](https://git-scm.com/)
- **Docker** (recommended) - [Download](https://docs.docker.com/get-docker/)

### Installation

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

The interactive installer will guide you through:
- Choosing Docker or local installation
- Configuring transcription, AI, and geocoding
- Setting up optional services (Ollama, iCAD, TrunkRecorder)
- Generating your `.env` configuration

### After Installation

```bash
# Docker installation
docker-compose up -d

# Local installation
npm start
```

**Access the web interface:** http://localhost:3001

---

## 📚 Documentation

| Guide | Description |
|-------|-------------|
| [Installation Guide](docs/INSTALLATION.md) | Detailed setup for Windows, Linux, macOS |
| [Configuration](docs/CONFIGURATION.md) | All `.env` settings explained |
| [Docker Setup](docs/DOCKER.md) | Docker-specific configuration |
| [Transcription](docs/TRANSCRIPTION.md) | Local, remote, OpenAI, iCAD modes |
| [Geocoding](docs/GEOCODING.md) | Nominatim, LocationIQ, Google Maps |
| [Discord Bot](docs/DISCORD.md) | Discord integration setup |
| [Radio Software](docs/RADIO-SOFTWARE.md) | SDRTrunk & TrunkRecorder setup |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common issues and solutions |

---

## 📡 Connecting Radio Software

### SDRTrunk
1. Go to **Streaming** → **Rdio Scanner**
2. Endpoint: `http://localhost:3306/api/call-upload`
3. API key: Found in `data/apikeys.json` (auto-generated)

### TrunkRecorder
1. Edit `config.json` with rdio-scanner upload settings
2. API key auto-configured if using Docker

See [Radio Software Guide](docs/RADIO-SOFTWARE.md) for detailed instructions.

---

## 💬 Support

- **[Discord Server](https://discord.gg/X7vej75zZy)** - Community help and discussion
- **[GitHub Issues](https://github.com/poisonednumber/Scanner-map/issues)** - Bug reports and features
- Contact **poisonednumber** on Discord

---

## 🤝 Contributing

Pull requests welcome! Please read the documentation before contributing.

## 📄 License

See [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [TrunkRecorder](https://github.com/TrunkRecorder/trunk-recorder) - GPL-3.0
- [iCAD Transcribe](https://github.com/TheGreatCodeholio/icad_transcribe) - Apache-2.0
- [Ollama](https://ollama.com) - Local AI
- [faster-whisper](https://github.com/guillaumekln/faster-whisper) - Fast transcription
