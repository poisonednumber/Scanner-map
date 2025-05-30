# Scanner Map

A real-time mapping system that ingests radio calls from SDRTrunk, TrunkRecorder, or **rdio-scanner downstreams** (via an RdioScanner compatible endpoint), automatically transcribes audio using local or remote AI, extracts locations using local AI, geocodes them, and displays calls on an interactive web map with integrated audio playback.

![Scanner Map Interface 1](https://github.com/user-attachments/assets/4f51548f-e33f-4807-a11d-d91f3a6b4db1) ![Scanner Map Interface 2](https://github.com/user-attachments/assets/873ede4c-b9d6-4abc-9a1d-5d0754ba26b1) ![Scanner Map Interface 3](https://github.com/user-attachments/assets/262f9918-fc20-46c7-9e88-598f75991ced) ![Scanner Map Interface 4](https://github.com/user-attachments/assets/417e1194-3884-4eef-b2b4-33903d4a7e51)

## ✨ Features

-   **Real-time Mapping:** Visualize radio communications on a map as they happen.
-   **Flexible Transcription:**
    -   **Local:** Utilizes the `faster-whisper` model running locally for accurate audio-to-text conversion (CPU or NVIDIA GPU).
    -   **Remote:** Option to offload transcription to a separate `faster-whisper-server` (like [speaches](https://github.com/speaches-ai/speaches)) via its API.
-   **Flexible Audio Storage:** Store audio files locally (`./audio` folder) or in an S3-compatible object storage service (AWS S3, MinIO, etc.).
-   **AI-Powered Location Extraction & Geocoding:**
    -   Uses a  Ollama LLM (e.g., Llama 3.1) to identify potential addresses mentioned in transmissions for specified talk groups.
    -   Geocodes extracted addresses using either **Google Maps Geocoding API** or **LocationIQ API** (user chooses by selecting the appropriate `geocoding.js` file).
-   **AI-Powered Summarization:** Generates summaries and highlights of recent notable transmissions using Ollama.
-   **Interactive Web UI:**
    -   Leaflet map with marker clustering.
    -   Day/Night/Satellite map views.
    -   Heatmap visualization of call density.
    -   Clickable markers with call details, transcription, and integrated WaveSurfer audio player.
    -   Call filtering by time range and category.
    -   Live audio streaming button (links to external stream).
    -   Marker correction/relocation tools.
-   **Discord Integration:**
    -   Automatic posting of transcriptions to dedicated Discord channels (categorized by talk group).
    -   Keyword-based alerts sent to a specific Discord channel.
    -   AI-generated summaries posted to a dedicated channel.
    -   Optional: Stream live audio for specific talk groups to Discord voice channels.
-   **Optional User Authentication:** Secure the web interface with a username/password system and manage user sessions.
-   **Data Persistence:** Stores transcriptions, locations, and audio metadata in an SQLite database.

## 🚀 Installation

This project can be installed on Windows or Linux. Automated installation scripts are provided to simplify the setup process. Separate `geocoding.js` files are available depending on whether you want to use Google Maps or LocationIQ for geocoding lookups.

### Prerequisites (Common):

-   SDRTrunk, TrunkRecorder, **or rdio-scanner** already configured and running.
-   Access to export Talk Group information from RadioReference.com (usually requires a Premium Subscription).
-   **EITHER** a Google Cloud Platform account with the Geocoding API enabled and an API Key **OR** a LocationIQ account with an API Key. You only need the key for the service you choose to use.
-   (Optional but Recommended for Local Transcription Speed) An NVIDIA GPU with CUDA support (8GB+ VRAM recommended). Ensure appropriate drivers and CUDA/cuDNN libraries are installed before running the installation script.
-   (Optional for Discord Features) A Discord account and the ability to create a Discord Bot Application.
-   (Optional for Remote Transcription) A running instance of a `faster-whisper-server` compatible API (e.g., [speaches](https://github.com/speaches-ai/speaches)).

### 🐧 Linux Installation (Debian/Ubuntu-based)

1.  **Choose Geocoding File:** Decide if you want to use Google Maps or LocationIQ. Ensure you have the correct `geocoding.js` file ready (e.g., `geocoding_google.js` or `geocoding_locationiq.js`). You will rename the chosen one to `geocoding.js` after cloning.
    
2.  **Download the Script:** Save the Linux installation script (`linux_install_scanner_map.sh`) to your Linux machine.
    
3.  **Make Executable:** Open a terminal and run:
    
    ```bash
    chmod +x linux_install_scanner_map.sh
    
    ```
    
4.  **Run the Script:** Execute the script with sudo (required for package installation):
    
    ```bash
    sudo bash linux_install_scanner_map.sh
    
    ```
    
5.  **Follow Prompts:** The script will guide you through:
    
    -   Installing prerequisites (git, python, pip, nodejs, npm, ffmpeg, etc.).
    -   Installing Ollama and pulling the required model.
    -   Asking if you intend to use an NVIDIA GPU for _local_ transcription (provides manual installation links if yes).
    -   Cloning the repository.
    -   Interactively creating a base `.env` configuration file (including prompts for transcription mode and storage mode).
    -   Installing Node.js and Python dependencies (using a virtual environment). *The script installs required packages like `express`, `discord.js`, `faster-whisper`, `aws-sdk`, `pydub`, etc.*
    -   Creating necessary directories.
    -   Interactively importing `talkgroups.csv` from RadioReference.
6.  **Replace Geocoding File:** After the script clones the repo, navigate to the install directory (`~/scanner-map` by default) and replace the default `geocoding.js` with the version you chose (e.g., `cp geocoding_google.js geocoding.js`).
    
7.  **Manual Configuration (REQUIRED):** After the script finishes, it will pause and remind you to manually edit configuration files within the installation directory:
    
    -   **`.env`:** Open this file (`nano .env`).
        -   Verify all settings entered during the script.
        -   CRITICAL: Add your actual `DISCORD_TOKEN`.
        -   CRITICAL: Provide the API key for your _chosen_ geocoding provider (`Maps_API_KEY` or `LOCATIONIQ_API_KEY`). Comment out the unused one.
        -   CRITICAL: Add your specific `TALK_GROUP_XXXX=Location Description` lines for each talk group listed in `MAPPED_TALK_GROUPS`.
        -   Verify `TRANSCRIPTION_MODE` ('local' or 'remote'). If 'remote', set `FASTER_WHISPER_SERVER_URL`. If 'local', set `TRANSCRIPTION_DEVICE` ('cpu' or 'cuda').
        -   Adjust `WEBSERVER_PASSWORD` if `ENABLE_AUTH=true`.
        -   Verify `STORAGE_MODE` ('local' or 's3'). If 's3', set `S3_ENDPOINT`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`.
    -   **`public/config.js`:** Open this file (`nano public/config.js`) and configure map defaults (center, zoom, icons, etc.). If using Google Maps for the _frontend map display_, you might need to add your `Maps_API_KEY` here too.
    -   **`data/apikeys.json`:**
        -   Edit `GenApiKey.js` (`nano GenApiKey.js`) and set your desired secret API key for SDRTrunk/TrunkRecorder.
        -   Run `node GenApiKey.js` to get the hashed key.
        -   Edit `data/apikeys.json` (`nano data/apikeys.json`) and replace the placeholder with your hashed key in the correct JSON format: `[{"key":"YOUR_HASHED_KEY_HERE","disabled":false}]`
    -   (If Skipped) Run `node import_csv.js` after placing `talkgroups.csv`.
    -   (If Auth Enabled) Run `node init-admin.js`.
8.  **Run:** Follow the "How to Run" instructions provided by the script.
    
    ```bash
    # Terminal 1 (Activate venv first!)
    cd ~/scanner-map
    source .venv/bin/activate
    node bot.js
    
    # Terminal 2
    cd ~/scanner-map
    sudo node webserver.js # Sudo might be needed for port 80
    
    ```
    

### 🪟 Windows Installation

1.  **Choose Geocoding File:** Decide if you want to use Google Maps or LocationIQ. Ensure you have the correct `geocoding.js` file ready (e.g., `geocoding_google.js` or `geocoding_locationiq.js`). You will rename the chosen one to `geocoding.js` after cloning.
    
2.  **Download the Script:** Save the Windows installation script (`install_scanner_map.ps1`) to your Windows machine.
    
3.  **Open PowerShell as Administrator:** Search for PowerShell, right-click, and select "Run as administrator".
    
4.  **Set Execution Policy (If Needed):** If you haven't run PowerShell scripts before, you may need to allow it for this session:
    
    ```powershell
    Set-ExecutionPolicy RemoteSigned -Scope Process -Force
    
    ```
    
5.  **Navigate to Script:** Use `cd` to go to the directory where you saved the script.
    
    ```powershell
    # Example: If saved to Downloads
    cd $HOME\Downloads
    
    ```
    
6.  **Run the Script:** You might need to run it once, let it finish/error on dependencies, restart PowerShell as Admin, and run it again.
    
    ```powershell
    .\install_scanner_map.ps1
    
    ```
    
7.  **Follow Prompts:** The script will guide you through:
    
    -   Installing prerequisites using `winget` (Node.js, Python, Git, VS Build Tools, FFmpeg). Ensure these are added to your system PATH during their installations.
    -   Installing Ollama and pulling the required model.
    -   Asking if you intend to use an NVIDIA GPU for _local_ transcription (provides manual installation links/instructions if yes).
    -   Cloning the repository.
    -   Interactively creating a base `.env` configuration file (including prompts for transcription mode and storage mode).
    -   Installing Node.js and Python dependencies. *The script installs required packages like `express`, `discord.js`, `faster-whisper`, `aws-sdk`, `pydub`, etc.*
    -   Creating necessary directories.
    -   Interactively importing `talkgroups.csv` from RadioReference.
8.  **Replace Geocoding File:** After the script clones the repo, navigate to the install directory (`$HOME\scanner-map` by default) and replace the default `geocoding.js` with the version you chose (e.g., `Copy-Item geocoding_google.js geocoding.js -Force`).
    
9.  **Manual Configuration (REQUIRED):** After the script finishes, it will pause and remind you to manually edit configuration files within the installation directory:
    
    -   **`.env`:** Open this file (`notepad .\.env`).
        -   Verify all settings entered during the script.
        -   CRITICAL: Add your actual `DISCORD_TOKEN`.
        -   CRITICAL: Provide the API key for your _chosen_ geocoding provider (`Maps_API_KEY` or `LOCATIONIQ_API_KEY`). Comment out the unused one.
        -   CRITICAL: Add your specific `TALK_GROUP_XXXX=Location Description` lines for each talk group listed in `MAPPED_TALK_GROUPS`.
        -   Verify `TRANSCRIPTION_MODE` ('local' or 'remote'). If 'remote', set `FASTER_WHISPER_SERVER_URL`. If 'local', set `TRANSCRIPTION_DEVICE` ('cpu' or 'cuda').
        -   Adjust `WEBSERVER_PASSWORD` if `ENABLE_AUTH=true`.
        -   Verify `STORAGE_MODE` ('local' or 's3'). If 's3', set `S3_ENDPOINT`, `S3_BUCKET_NAME`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY`.
    -   **`public\config.js`:** Open this file (`notepad .\public\config.js`) and configure map defaults (center, zoom, icons, etc.). If using Google Maps for the _frontend map display_, you might need to add your `Maps_API_KEY` here too.
    -   **`data\apikeys.json`:**
        -   Edit `GenApiKey.js` (`notepad .\GenApiKey.js`) and set your desired secret API key for SDRTrunk/TrunkRecorder.
        -   Run `node GenApiKey.js` (in PowerShell/CMD in the project dir) to get the hashed key.
        -   Edit `data\apikeys.json` (`notepad .\data\apikeys.json`) and replace the placeholder with your hashed key in the correct JSON format: `[{"key":"YOUR_HASHED_KEY_HERE","disabled":false}]`
    -   (If Skipped) Run `node import_csv.js` after placing `talkgroups.csv`.
    -   (If Auth Enabled) Run `node init-admin.js`.
10.  **Run:** Follow the "How to Run" instructions provided by the script.
    
    ```powershell
    # Terminal 1 (PowerShell or CMD)
    cd $HOME\scanner-map
    # If using Python venv on Windows, activate: .\.venv\Scripts\activate.ps1 or .\venv\Scripts\activate.bat
    node bot.js
    
    # Terminal 2 (PowerShell or CMD)
    cd $HOME\scanner-map
    node webserver.js
    
    ```
    

## ⚙️ Configuration Details

### .env File

This file contains the core configuration. The installation scripts help create it, but pay close attention to:

-   **`DISCORD_TOKEN`:** Get this from your Discord Developer Portal application.
-   **Geocoding API Keys:**
    -   Use the correct `geocoding.js` file (Google or LocationIQ version).
    -   Provide the API key for the chosen service (`Maps_API_KEY` or `LOCATIONIQ_API_KEY`).
    -   Comment out the unused key (e.g., `# LOCATIONIQ_API_KEY=...`).
-   **`PUBLIC_DOMAIN`:** The domain name or IP address that the web interface and audio files will be accessible from externally. Use `localhost` if only accessing locally.
-   **`MAPPED_TALK_GROUPS`:** Crucial. Only talk groups listed here will have their transcriptions processed for address extraction by Ollama. List the decimal IDs, comma-separated. Focus on dispatch talk groups where addresses are likely to be spoken.
-   **`TALK_GROUP_XXXX=Location Description`:** Crucial. Add one line for each ID listed in `MAPPED_TALK_GROUPS`. The location description helps Ollama geocode correctly (e.g., `TALK_GROUP_1234=Anytown or surrounding areas in Example County, ST`).
-   **`TRANSCRIPTION_MODE`:**
    -   `local`: Uses `faster-whisper` locally via Python. Requires `WHISPER_MODEL` and `TRANSCRIPTION_DEVICE`.
    -   `remote`: Uses a separate `faster-whisper-server` API. Requires `FASTER_WHISPER_SERVER_URL`. `WHISPER_MODEL` might be used if server supports model selection via API.
-   **`TRANSCRIPTION_DEVICE`:** (Only if `TRANSCRIPTION_MODE=local`) Set to `cuda` if you installed NVIDIA components and CUDA-enabled PyTorch, otherwise set to `cpu`.
-   **`FASTER_WHISPER_SERVER_URL`:** (Only if `TRANSCRIPTION_MODE=remote`) The full URL of your running transcription server API (e.g., `http://localhost:8000`).
-   **`WHISPER_MODEL` / `OLLAMA_MODEL`:** Choose appropriate models. Larger models are more accurate but require more resources (especially VRAM for large-v3 Whisper).
-   **`ENABLE_AUTH` / `WEBSERVER_PASSWORD`:** Configure if you want to password-protect the web UI. Run `node init-admin.js` after setting the password if enabling auth.
-   **`STORAGE_MODE`:** (New) Select where audio files are stored.
    -   `local`: Saves audio files to the `./audio` folder on the server running `bot.js`. This is the default and simplest option.
    -   `s3`: Saves audio files to an S3-compatible object storage service (like AWS S3, MinIO, Wasabi, etc.). Requires the S3 variables below to be set. This is useful for scalability, durability, or offloading storage from the main server.
-   **`S3_ENDPOINT`:** (New - Required if `STORAGE_MODE=s3`) The full URL of your S3-compatible storage endpoint (e.g., `https://s3.us-east-1.amazonaws.com` or `https://your-minio-server.com:9000`).
-   **`S3_BUCKET_NAME`:** (New - Required if `STORAGE_MODE=s3`) The name of the S3 bucket where audio files will be stored. The bucket must already exist.
-   **`S3_ACCESS_KEY_ID`:** (New - Required if `STORAGE_MODE=s3`) Your S3 access key ID.
-   **`S3_SECRET_ACCESS_KEY`:** (New - Required if `STORAGE_MODE=s3`) Your S3 secret access key.

### public/config.js

Configure the web map's appearance and behavior:

-   **`map.defaultCenter`, `map.defaultZoom`:** Initial map view.
-   **`icons`:** Define custom marker icons (paths relative to the `public` directory).
-   **`permanentLocations`:** Add fixed markers (like fire stations).
-   **`markerClassification`:** Rules to assign icons based on talk group names or audio file paths.
-   **`googleApiKey`:** _May_ be needed here if you are using Google Maps as the base map layer provider in Leaflet, even if backend geocoding uses LocationIQ. Leave blank if using OpenStreetMap or other non-key-based layers.

### data/apikeys.json

Stores hashed API keys used by SDRTrunk/TrunkRecorder to authenticate with the `/api/call-upload` endpoint. Generate the hash using `GenApiKey.js`.

## 📡 Configuring SDRTrunk / TrunkRecorder / rdio-scanner

Configure your radio software (SDRTrunk, TrunkRecorder, or rdio-scanner) to send call recordings and metadata to the Scanner Map bot.

### RdioScanner Compatible Endpoint

The endpoint URL is: `http://<YOUR_SERVER_IP_OR_DOMAIN>:<BOT_PORT>/api/call-upload`

-   Replace `<YOUR_SERVER_IP_OR_DOMAIN>` with the actual IP address or domain name of the machine running `bot.js`.
-   Replace `<BOT_PORT>` with the port you set in your `.env` file (default is 3306).

### SDRTrunk Setup

1.  Go to Settings > Streaming.
2.  Add or Edit an Rdio Scanner stream.
3.  Set the URL to the endpoint address above.
4.  Enter the API Key (the **secret key** you put in `GenApiKey.js`, not the hashed one from `apikeys.json`).
5.  Enable streaming for the desired talk groups.

### TrunkRecorder Setup

Edit your `config.json`:

```json
{
  "sources": [ ... ],
  "systems": [ ... ],
  "uploadServer": {
    "type": "rdioscanner",
    "server": "http://<YOUR_SERVER_IP_OR_DOMAIN>:<BOT_PORT>/api/call-upload",
    "key": "your-secret-api-key" // The secret key you put in GenApiKey.js
  }
}

```

### rdio-scanner Setup (Downstream)

1.  Go to your rdio-scanner web interface > Config > Downstreams.
2.  Click "New downstream".
3.  Enter the **Endpoint URL without `/api/call-upload`**: `http://<YOUR_SERVER_IP_OR_DOMAIN>:<BOT_PORT>`.
4.  Enter the **NON-HASHED / SECRET API Key** (the **original secret key** you defined inside `GenApiKey.js` before running it). **Note:** This differs from SDRTrunk/TrunkRecorder setup. `bot.js` still requires the *hashed* key in `data/apikeys.json` for validation.
5.  Ensure the "Disabled" switch is OFF.
6.  Configure Access (Choose systems/talkgroups) as needed.
7.  Save the downstream configuration.

## 🤖 Discord Bot Setup

1.  Go to the Discord Developer Portal.
2.  Create a New Application.
3.  Go to the Bot tab:
    -   Click Add Bot.
    -   Enable Privileged Gateway Intents:
        -   Server Members Intent
        -   Message Content Intent
    -   Copy the Token (this is your DISCORD_TOKEN for the .env file).
4.  Go to the OAuth2 > General tab:
    -   Copy the Client ID (this is your CLIENT_ID for the .env file - Note: The install scripts currently don't prompt for this, add it manually to .env).
5.  Go to the OAuth2 > URL Generator tab:
    -   Select the bot and applications.commands scopes.
    -   Select the following Bot Permissions:
        -   Manage Channels
        -   Send Messages
        -   Embed Links
        -   Attach Files
        -   Read Message History
        -   Connect (Voice)
        -   Speak (Voice)
    -   Copy the generated Invite URL and use it to add the bot to your Discord server.

### Discord Commands

-   `/alert add <keyword> [talkgroup]` - Add alert keyword (case-insensitive). Optionally restrict to a specific talk group name.
-   `/alert remove <keyword> [talkgroup]` - Remove alert keyword. Optionally specify talk group.
-   `/alert list` - List all configured alert keywords.
-   `/summary refresh` - Manually trigger an update of the AI summary message.

## 💻 System Requirements

-   **OS:** Windows 10/11 or Debian/Ubuntu-based Linux.
-   **CPU:** Modern multi-core CPU.
-   **RAM:** 16GB minimum recommended, more for larger AI models.
-   **GPU (Optional but Recommended for Local Transcription):** NVIDIA GPU with CUDA support (Compute Capability 3.5+). 8GB+ VRAM highly recommended for larger Whisper models. Correct CUDA/cuDNN libraries must be installed manually if using GPU.
-   **Storage:** SSD recommended. ~5-10GB for AI models, plus space for database and logs. Audio files are stored temporarily or in the database depending on configuration.

## 🩺 Troubleshooting

-   **Check Logs:** The primary logs are combined.log and error.log in the project directory. Check the output in the terminals running bot.js and webserver.js.
-   **Dependencies:** Ensure all prerequisites (Node, Python, FFmpeg, VS Build Tools/build-essential) are installed correctly and accessible in the system's PATH. Re-run npm install if Node modules seem missing. Ensure Python packages installed correctly (use pip list inside the venv if using Linux).
-   **.env Configuration:** Double-check all paths, URLs, API keys, and IDs. Ensure PUBLIC_DOMAIN and ports are correct.
    -   Verify TRANSCRIPTION_MODE is 'local' or 'remote'.
    -   If 'local', check TRANSCRIPTION_DEVICE ('cpu' or 'cuda') and WHISPER_MODEL.
    -   If 'remote', check FASTER_WHISPER_SERVER_URL.
    -   Ensure you are using the correct geocoding.js file and have uncommented/provided the matching API key (Maps_API_KEY or LOCATIONIQ_API_KEY).
-   **API Keys:** Ensure the API key used in SDRTrunk/TrunkRecorder is the secret key from GenApiKey.js, and the hashed key is correctly placed in data/apikeys.json.
-   **Ollama:** Verify Ollama is running (ollama ps) and the specified model is pulled (ollama list). Check the OLLAMA_URL.
-   **CUDA/GPU Issues (Local Transcription):**
    -   Verify NVIDIA drivers (nvidia-smi).
    -   Ensure correct CUDA Toolkit & cuDNN installed manually and paths are configured.
    -   Confirm TRANSCRIPTION_DEVICE=cuda in .env.
    -   Check PyTorch was installed with CUDA support.
-   **Remote Transcription Issues:**
    -   Ensure the faster-whisper-server is running and accessible at the FASTER_WHISPER_SERVER_URL.
    -   Check the server's logs for errors (e.g., CUDA/cuDNN errors on the server).
-   **Geocoding Issues:**
    -   Ensure the correct geocoding.js file is in place.
    -   Check the relevant API key (Maps_API_KEY or LOCATIONIQ_API_KEY) is correct in .env.
    -   Check if the API is enabled in your Google Cloud / LocationIQ account.
    -   Check the bot.js logs for specific geocoding errors.
-   **Database Errors:** Ensure bot.js and webserver.js have write permissions in the project directory. Check for errors opening botdata.db.
-   **Web UI Issues:** Check the webserver.js console for errors. Ensure the WEBSERVER_PORT is not blocked by a firewall or used by another application. Check browser developer console (F12) for errors.
-   **Talk Group Import:** Ensure talkgroups.csv is correctly formatted and placed in the root directory before running node import_csv.js.

## 🆘 Need Help?

-   Review the Troubleshooting section and check the log files first.
-   Open an Issue on the GitHub repository, providing details about the problem and relevant logs.
-   Contact poisonednumber on Discord.
