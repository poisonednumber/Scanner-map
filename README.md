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

## 📦 Requirements

Before installing, make sure you have:

- **Node.js 18+** — [Download here](https://nodejs.org/)
- **Docker** (recommended) — [Download here](https://docs.docker.com/get-docker/)

---

## 🚀 Installation

### Option 1: Download ZIP (Easiest)

1. **Download the latest release**
   
   → [**Download ZIP**](https://github.com/Dadud/Scanner-map/releases/latest)
   
   Click on `Source code (zip)` under Assets

2. **Extract the ZIP**
   
   Extract to a folder of your choice (e.g., `C:\Scanner-Map` or `~/Scanner-Map`)

3. **Run the installer**

   **Windows:** Double-click `install.bat`
   
   **Linux/macOS:** Open terminal in the folder and run:
   ```bash
   bash install.sh
   ```

4. **Follow the prompts**
   
   The installer will guide you through:
   - Choosing Docker or local installation
   - Configuring transcription and AI
   - Setting up geocoding
   - Optional Discord integration

5. **Start Scanner Map**

   ```bash
   # Docker installation
   docker-compose up -d
   
   # Local installation
   npm start
   ```

6. **Open the web interface**
   
   → http://localhost:3001

---

### Option 2: Clone with Git

If you prefer using Git (easier to update later):

**Windows:**
```batch
git clone https://github.com/Dadud/Scanner-map.git
cd Scanner-map
install.bat
```

**Linux/macOS:**
```bash
git clone https://github.com/Dadud/Scanner-map.git
cd Scanner-map
bash install.sh
```

---

## ✨ Features

| Category | Features |
|----------|----------|
| **Mapping** | Real-time Leaflet map, marker clustering, heatmaps, day/night/satellite views |
| **Transcription** | Local Whisper, remote servers, OpenAI API, iCAD Transcribe |
| **AI** | Address extraction, call categorization, summaries, "Ask AI" chat |
| **Geocoding** | Nominatim (free), LocationIQ, Google Maps |
| **Discord** | Auto-post by talkgroup, keyword alerts, AI summaries |
| **Security** | Optional authentication, auto-generated API keys |
| **Storage** | Local files or S3-compatible storage |
| **Detection** | Two-tone pager detection for fire/EMS calls |

---

## 📡 Connect Your Radio Software

After installation, connect SDRTrunk or TrunkRecorder:

**Endpoint:** `http://localhost:3306/api/call-upload`

**API Key:** Found in `data/apikeys.json` (auto-generated on first run)

See [Radio Software Guide](docs/RADIO-SOFTWARE.md) for detailed setup.

---

## 📚 Documentation

| Guide | Description |
|-------|-------------|
| [Installation](docs/INSTALLATION.md) | Detailed setup for Windows, Linux, macOS |
| [Configuration](docs/CONFIGURATION.md) | All `.env` settings explained |
| [Docker](docs/DOCKER.md) | Docker-specific configuration |
| [Transcription](docs/TRANSCRIPTION.md) | Local, remote, OpenAI, iCAD modes |
| [Geocoding](docs/GEOCODING.md) | Nominatim, LocationIQ, Google Maps |
| [Discord](docs/DISCORD.md) | Discord bot setup |
| [Radio Software](docs/RADIO-SOFTWARE.md) | SDRTrunk & TrunkRecorder |
| [Troubleshooting](docs/TROUBLESHOOTING.md) | Common issues and solutions |

---

## 💬 Support

- **[Discord Server](https://discord.gg/X7vej75zZy)** — Community help and discussion
- **[GitHub Issues](https://github.com/Dadud/Scanner-map/issues)** — Bug reports and features

---

## 🤝 Contributing

Pull requests welcome! Please read the documentation before contributing.

## 📄 License

See [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [TrunkRecorder](https://github.com/TrunkRecorder/trunk-recorder) — GPL-3.0
- [iCAD Transcribe](https://github.com/TheGreatCodeholio/icad_transcribe) — Apache-2.0
- [Ollama](https://ollama.com) — Local AI
- [faster-whisper](https://github.com/guillaumekln/faster-whisper) — Fast transcription
