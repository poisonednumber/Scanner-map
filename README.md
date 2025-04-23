# Scanner Map

A real-time mapping system that ingests radio calls from SDRTrunk or TrunkRecorder (via an RdioScanner compatible endpoint), automatically transcribes audio, extracts locations using local AI, and displays calls on an interactive web map with integrated audio playback.


![image](https://github.com/user-attachments/assets/4f51548f-e33f-4807-a11d-d91f3a6b4db1)![image](https://github.com/user-attachments/assets/873ede4c-b9d6-4abc-9a1d-5d0754ba26b1)![image](https://github.com/user-attachments/assets/262f9918-fc20-46c7-9e88-598f75991ced)![image](https://github.com/user-attachments/assets/417e1194-3884-4eef-b2b4-33903d4a7e51)

## ✨ Features

- **Real-time Mapping:** Visualize radio communications on a map as they happen.
- **AI-Powered Location Extraction:** Uses a local Ollama LLM (e.g., Llama 3.1) to identify and geocode addresses mentioned in transmissions for specified talk groups.
- **AI-Powered Transcription:** Utilizes the faster-whisper model for accurate audio-to-text conversion (CPU or NVIDIA GPU).
- **AI-Powered Summarization:** Generates summaries and highlights of recent notable transmissions using Ollama.
- **Interactive Web UI:**
  - Leaflet map with marker clustering.
  - Day/Night/Satellite map views.
  - Heatmap visualization of call density.
  - Clickable markers with call details, transcription, and integrated WaveSurfer audio player.
  - Call filtering by time range and category.
  - Live audio streaming button (links to external stream).
  - Marker correction/relocation tools.
- **Discord Integration:**
  - Automatic posting of transcriptions to dedicated Discord channels (categorized by talk group).
  - Keyword-based alerts sent to a specific Discord channel.
  - AI-generated summaries posted to a dedicated channel.
  - Optional: Stream live audio for specific talk groups to Discord voice channels.
- **Optional User Authentication:** Secure the web interface with a username/password system and manage user sessions.
- **Data Persistence:** Stores transcriptions, locations, and audio metadata in an SQLite database.

## 🚀 Installation

This project can be installed on Windows or Linux. Automated installation scripts are provided to simplify the setup process.

### Prerequisites (Common):
- SDRTrunk or TrunkRecorder already configured and running.
- Access to export Talk Group information from RadioReference.com (usually requires a Premium Subscription).
- A Google Cloud Platform account to create a Geocoding API Key. (Free Tier available).
- (Optional but Recommended for Transcription Speed) An NVIDIA GPU with CUDA support (8GB+ VRAM recommended). Ensure appropriate drivers are installed before running the installation script.
- (Optional for Discord Features) A Discord account and the ability to create a Discord Bot Application.

### 🐧 Linux Installation (Debian/Ubuntu-based)

1. **Download the Script:** Save the Linux installation script (install_scanner_map.sh) to your Linux machine.
2. **Make Executable:** Open a terminal and run:
   ```bash
   chmod +x install_scanner_map.sh
   ```
3. **Run the Script:** Execute the script with sudo (required for package installation):
   ```bash
   sudo bash install_scanner_map.sh
   ```
4. **Follow Prompts:** The script will guide you through:
   - Installing prerequisites (git, python, pip, nodejs, npm, ffmpeg, etc.).
   - Installing Ollama and pulling the required model.
   - Asking if you intend to use an NVIDIA GPU (provides manual installation links if yes).
   - Cloning the repository.
   - Interactively creating a base .env configuration file.
   - Installing Node.js and Python dependencies (using a virtual environment).
   - Creating necessary directories.
   - Interactively importing talkgroups.csv from RadioReference.
5. **Manual Configuration (REQUIRED):** After the script finishes, it will pause and remind you to manually edit configuration files within the installation directory (~/scanner-map by default):
   - **.env:** Open this file (`nano .env`).
     - Verify all settings entered during the script.
     - CRITICAL: Add your actual DISCORD_TOKEN, CLIENT_ID, GOOGLE_MAPS_API_KEY, and optionally OPENAI_API_KEY.
     - CRITICAL: Add your specific TALK_GROUP_XXXX=Location Description lines for each talk group listed in MAPPED_TALK_GROUPS.
     - Adjust WEBSERVER_PASSWORD if ENABLE_AUTH=true.
   - **public/config.js:** Open this file (`nano public/config.js`) and configure map defaults (center, zoom, icons, etc.).
   - **data/apikeys.json:**
     - Edit GenApiKey.js (`nano GenApiKey.js`) and set your desired secret API key for SDRTrunk/TrunkRecorder.
     - Run `node GenApiKey.js` to get the hashed key.
     - Edit data/apikeys.json (`nano data/apikeys.json`) and replace the placeholder with your hashed key in the correct JSON format: `[{"key":"YOUR_HASHED_KEY_HERE","disabled":false}]`
   - (If Skipped) Run `node import_csv.js` after placing talkgroups.csv.
   - (If Auth Enabled) Run `node init-admin.js`.
6. **Run:** Follow the "How to Run" instructions provided by the script.

### 🪟 Windows Installation

1. **Download the Script:** Save the Windows installation script (install_scanner_map.ps1) to your Windows machine.
2. **Open PowerShell as Administrator:** Search for PowerShell, right-click, and select "Run as administrator".
3. **Set Execution Policy (If Needed):** If you haven't run PowerShell scripts before, you may need to allow it for this session:
   ```powershell
   Set-ExecutionPolicy RemoteSigned -Scope Process -Force
   ```
4. **Navigate to Script:** Use cd to go to the directory where you saved the script.
   ```powershell
   # Example: If saved to Downloads
   cd $HOME\Downloads
   ```
5. **Run the Script:**
   ```powershell
   .\install_scanner_map.ps1
   ```
6. **Follow Prompts:** The script will guide you through:
   - Installing prerequisites using winget (Node.js, Python, Git, VS Build Tools, FFmpeg). Ensure these are added to your system PATH during their installations.
   - Installing Ollama and pulling the required model.
   - Asking if you intend to use an NVIDIA GPU (provides manual installation links/instructions if yes).
   - Cloning the repository.
   - Interactively creating a base .env configuration file.
   - Installing Node.js and Python dependencies.
   - Creating necessary directories.
   - Interactively importing talkgroups.csv from RadioReference.
7. **Manual Configuration (REQUIRED):** After the script finishes, it will pause and remind you to manually edit configuration files within the installation directory ($HOME\scanner-map by default):
   - **.env:** Open this file (`notepad .\.env`).
     - Verify all settings entered during the script.
     - CRITICAL: Add your actual DISCORD_TOKEN, CLIENT_ID, GOOGLE_MAPS_API_KEY, and optionally OPENAI_API_KEY.
     - CRITICAL: Add your specific TALK_GROUP_XXXX=Location Description lines for each talk group listed in MAPPED_TALK_GROUPS.
     - Adjust WEBSERVER_PASSWORD if ENABLE_AUTH=true.
   - **public\config.js:** Open this file (`notepad .\public\config.js`) and configure map defaults (center, zoom, icons, etc.).
   - **data\apikeys.json:**
     - Edit GenApiKey.js (`notepad .\GenApiKey.js`) and set your desired secret API key for SDRTrunk/TrunkRecorder.
     - Run `node GenApiKey.js` (in PowerShell/CMD in the project dir) to get the hashed key.
     - Edit data\apikeys.json (`notepad .\data\apikeys.json`) and replace the placeholder with your hashed key in the correct JSON format: `[{"key":"YOUR_HASHED_KEY_HERE","disabled":false}]`
   - (If Skipped) Run `node import_csv.js` after placing talkgroups.csv.
   - (If Auth Enabled) Run `node init-admin.js`.
8. **Run:** Follow the "How to Run" instructions provided by the script.

## ⚙️ Configuration Details

### .env File
This file contains the core configuration. The installation scripts help create it, but pay close attention to:
- **DISCORD_TOKEN, CLIENT_ID:** Get these from your Discord Developer Portal application.
- **GOOGLE_MAPS_API_KEY:** Your API key from Google Cloud Platform. Enable the Geocoding API.
- **PUBLIC_DOMAIN:** The domain name or IP address that the web interface and audio files will be accessible from externally. Use localhost if only accessing locally.
- **MAPPED_TALK_GROUPS:** Crucial. Only talk groups listed here will have their transcriptions processed for address extraction by Ollama. List the decimal IDs, comma-separated. Focus on dispatch talk groups where addresses are likely to be spoken.
- **TALK_GROUP_XXXX=Location Description:** Crucial. Add one line for each ID listed in MAPPED_TALK_GROUPS. The location description helps Ollama geocode correctly (e.g., TALK_GROUP_1234=Anytown or surrounding areas in Example County, ST).
- **TRANSCRIPTION_DEVICE:** Set to cuda if you installed NVIDIA components and CUDA-enabled PyTorch, otherwise set to cpu.
- **WHISPER_MODEL / OLLAMA_MODEL:** Choose appropriate models. Larger models are more accurate but require more resources (especially VRAM for large-v3 Whisper).
- **ENABLE_AUTH / WEBSERVER_PASSWORD:** Configure if you want to password-protect the web UI. Run `node init-admin.js` after setting the password if enabling auth.

### public/config.js
Configure the web map's appearance and behavior:
- **map.defaultCenter, map.defaultZoom:** Initial map view.
- **icons:** Define custom marker icons (paths relative to the public directory).
- **permanentLocations:** Add fixed markers (like fire stations).
- **markerClassification:** Rules to assign icons based on talk group names or audio file paths.
- **googleApiKey:** For marker address search correction.

### data/apikeys.json
Stores hashed API keys used by SDRTrunk/TrunkRecorder to authenticate with the call-upload endpoint. Generate the hash using GenApiKey.js.

## 📡 Configuring SDRTrunk / TrunkRecorder

Configure your radio software to send call recordings and metadata to the Scanner Map bot.

### RdioScanner Endpoint
The endpoint URL is: `http://<YOUR_SERVER_IP_OR_DOMAIN>:<BOT_PORT>/api/call-upload`
- Replace `<YOUR_SERVER_IP_OR_DOMAIN>` with the actual IP address or domain name of the machine running bot.js.
- Replace `<BOT_PORT>` with the port you set in your .env file (default is 3306).

### SDRTrunk Setup
1. Go to Settings > Streaming.
2. Add or Edit an Rdio Scanner stream.
3. Set the URL to the endpoint address above.
4. Enter the API Key (the secret key you put in GenApiKey.js, not the hashed one).
5. Enable streaming for the desired talk groups.

### TrunkRecorder Setup
Edit your config.json:
```json
{
  "sources": [ ... ],
  "systems": [ ... ],
  "uploadServer": {
    "type": "rdioscanner",
    "server": "http://<YOUR_SERVER_IP_OR_DOMAIN>:<BOT_PORT>/api/call-upload",
    "key": "your-secret-api-key" // The key you put in GenApiKey.js
  }
}
```

## 🤖 Discord Bot Setup

1. Go to the Discord Developer Portal.
2. Create a New Application.
3. Go to the Bot tab:
   - Click Add Bot.
   - Enable Privileged Gateway Intents:
     - Server Members Intent
     - Message Content Intent
   - Copy the Token (this is your DISCORD_TOKEN for the .env file).
4. Go to the OAuth2 > General tab:
   - Copy the Client ID (this is your CLIENT_ID for the .env file).
5. Go to the OAuth2 > URL Generator tab:
   - Select the bot and applications.commands scopes.
   - Select the following Bot Permissions:
     - Manage Channels
     - Send Messages
     - Embed Links
     - Attach Files
     - Read Message History
     - Connect (Voice)
     - Speak (Voice)
   - Copy the generated Invite URL and use it to add the bot to your Discord server.

### Discord Commands
- `/alert add <keyword> [talkgroup]` - Add alert keyword (case-insensitive). Optionally restrict to a specific talk group name.
- `/alert remove <keyword> [talkgroup]` - Remove alert keyword. Optionally specify talk group.
- `/alert list` - List all configured alert keywords.
- `/summary refresh` - Manually trigger an update of the AI summary message.

## 💻 System Requirements

- **OS:** Windows 10/11 or Debian/Ubuntu-based Linux.
- **CPU:** Modern multi-core CPU.
- **RAM:** 16GB minimum recommended, more for larger AI models.
- **GPU (Optional but Recommended):** NVIDIA GPU with CUDA support (Compute Capability 3.5+). 8GB+ VRAM highly recommended for larger Whisper models.
- **Storage:** SSD recommended. ~5-10GB for models, plus space for database and logs. Audio files are stored temporarily or in the database depending on configuration.

## 🩺 Troubleshooting

- **Check Logs:** The primary logs are combined.log and error.log in the project directory. Check the output in the terminals running bot.js and webserver.js.
- **Dependencies:** Ensure all prerequisites (Node, Python, FFmpeg, VS Build Tools/build-essential) are installed correctly and accessible in the system's PATH. Re-run npm install if Node modules seem missing. Ensure Python packages installed correctly (use pip list inside the venv if using Linux).
- **.env Configuration:** Double-check all paths, URLs, API keys, and IDs in your .env file. Ensure PUBLIC_DOMAIN and ports are correct. Verify TRANSCRIPTION_DEVICE matches your setup (cpu or cuda).
- **API Keys:** Ensure the API key used in SDRTrunk/TrunkRecorder is the secret key from GenApiKey.js, and the hashed key is correctly placed in data/apikeys.json.
- **Ollama:** Verify Ollama is running (`ollama ps`) and the specified model is pulled (`ollama pull <model_name>`). Check the OLLAMA_URL in .env.
- **CUDA/GPU Issues:**
  - Verify NVIDIA drivers are installed (`nvidia-smi`).
  - Ensure CUDA Toolkit, cuDNN, and (if needed) cuBLAS were installed correctly and are compatible with your driver and PyTorch version.
  - Confirm TRANSCRIPTION_DEVICE=cuda in .env.
- **Database Errors:** Ensure bot.js and webserver.js have write permissions in the project directory. Check for errors opening botdata.db.
- **Web UI Issues:** Check the webserver.js console for errors. Ensure the WEBSERVER_PORT is not blocked by a firewall or used by another application. Check browser developer console (F12) for errors.
- **Talk Group Import:** Ensure talkgroups.csv is correctly formatted and placed in the root directory before running node import_csv.js.

## 🆘 Need Help?

- Review the Troubleshooting section and check the log files first.
- Open an Issue on the GitHub repository, providing details about the problem and relevant logs.
- Contact poisonednumber on Discord.
