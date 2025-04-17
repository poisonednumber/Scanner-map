# Scanner Map
![image](https://github.com/user-attachments/assets/4f51548f-e33f-4807-a11d-d91f3a6b4db1)![image](https://github.com/user-attachments/assets/873ede4c-b9d6-4abc-9a1d-5d0754ba26b1)![image](https://github.com/user-attachments/assets/262f9918-fc20-46c7-9e88-598f75991ced)![image](https://github.com/user-attachments/assets/417e1194-3884-4eef-b2b4-33903d4a7e51)




A real-time mapping system that pulls radio calls from SDRTrunk and TrunkRecorder via a RdioScanner endpoint. This system processes radio transmissions, extracts location data, and displays them on an interactive map with audio playback and transcription.

## Features

-   Real-time mapping of radio communications with automatic location extraction
-   Audio transcription using faster-whisper AI model
-   Interactive map with day/night/satellite views and heatmap
-   Discord integration for notifications and voice channel playback
-   User authentication and management system
-   Categorized view of call types (medical, fire, police, etc.)
-   Uses local Ollama model for address extractions and call summery/categories

## Windows Installation Guide

### Prerequisites

-   Windows 10 or 11
-   SDRTrunk or TrunkRecorder already configured
-   Google geocoding api access create one free https://cloud.google.com/

### Step 1: Install Required Software

1.  **Install Node.js (LTS version)**
    
    -   Open PowerShell as Administrator and run:
    
    ```
    winget install OpenJS.NodeJS.LTS
    ```
    
    -   Or download from nodejs.org
2.  **Install Python 3.9 or higher**
    
    ```
    winget install Python.Python.3.10
    ```
    
    -   Make sure to check "Add Python to PATH" during installation
3.  **Install Git**
    
    ```
    winget install Git.Git
    ```
    
4.  **Install Visual Studio Build Tools (for native dependencies)**
    
    ```
    winget install Microsoft.VisualStudio.2022.BuildTools
    ```
    
5.  **Install FFmpeg**
    
    ```
    winget install Gyan.FFmpeg
    ```
    
    -   Verify installation by running:
    
    ```
    ffmpeg -version
    ```
    
6.  **Install NVIDIA CUDA Toolkit**
    -   For faster-whisper, you need:
        -   CUDA 12
        -   cuBLAS for CUDA 12
        -   cuDNN 9 for CUDA 12
    -   Download and install from [NVIDIA website](https://developer.nvidia.com/cuda-downloads)
7.  **Install Ollama** (for AI-based location extraction)
    
    -   Download from [ollama.ai](https://ollama.ai/download)
    -   After installation, pull the required model (may need smaller one if your gpu has less then 8gb vram) :
    
    ```
    ollama pull llama3.1:8b
    ```
    

### Step 2: Clone Repository

1.  **Create project directory**
    
    ```
    mkdir C:\scanner-map
    cd C:\scanner-map
    ```
    
2.  **Clone the repository**
    
    ```
    git clone https://github.com/yourusername/scanner-map.git .
    ```
    
    Alternatively, download the zip file and extract it to C:\scanner-map

### Step 3: Install Dependencies

1.  **Install Node.js packages**
    
    ```
    npm install dotenv express sqlite3 bcrypt uuid busboy winston moment-timezone @discordjs/opus discord.js @discordjs/voice prism-media node-fetch@2 socket.io csv-parser
    ```
    
2.  **Install Python packages**
    
    ```
    # Open a new PowerShell window as Administrator
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
    pip install faster-whisper
    pip install python-dotenv
    ```
    
    If you have CUDA 11, use:
    
    ```
    pip install --force-reinstall ctranslate2==3.24.0
    ```
    
    If you have CUDA 12 with cuDNN 8, use:
    
    ```
    pip install --force-reinstall ctranslate2==4.4.0
    ```
    
3.  **Create necessary directories**
    
    ```
    mkdir audio
    mkdir data
    ```
    

### Step 4: Configure Environment

1.  **Create an .env file**
    
    ```
    copy NUL .env
    notepad .env
    ```
    
2.  **Add the following configuration to the .env file:**
    
    ```
    # Discord Bot Configuration
    DISCORD_TOKEN=your_discord_token
    CLIENT_ID=your_discord_client_id
    
    # Server Ports
    BOT_PORT=3306                      # Used by the bot to talk to sdrtrunk
    API_KEY_FILE=data/apikeys.json     # API key storage location
    WEBSERVER_PORT=80                  # Used by the web server
    PUBLIC_DOMAIN=your.domain.or.ip    # Public domain or IP for audio links
    
    # Geocoding Configuration
    GOOGLE_MAPS_API_KEY=your_google_maps_api_key
    GEOCODING_CITY=YourCity            # Default city
    GEOCODING_STATE=YourState          # Default state abbreviation (e.g., TX)
    GEOCODING_COUNTRY=US               # Default country
    GEOCODING_TARGET_COUNTIES=Your County  # Target counties for validation
    
    # Transcription Configuration
    WHISPER_MODEL=large-v3         # Model for transcription (try smaller if u ran out of vram)
    TRANSCRIPTION_DEVICE=cuda      # Use 'cuda' for GPU or 'cpu' for CPU
    
    # Local LLM Configuration
    OLLAMA_URL=http://localhost:11434  # Ollama API URL
    OLLAMA_MODEL=llama3.1:8b             # Model for address extraction (try smaller if u ran out of vram)
    SUMMARY_LOOKBACK_HOURS=1    # Number of hours to look back for the summary
    
    # Web Server
    ENABLE_AUTH=false     # Set to 'true' to enable authentication
    WEBSERVER_PASSWORD=changeme  # Web interface password when auth is enabled
    
    # Talk Groups mapping (format: ID=Location)
    TALK_GROUP_6010=Your City or any town in Your County
    TALK_GROUP_4005=Your City or any town in Your County
    
    # Talk Groups to process for address extraction
    MAPPED_TALK_GROUPS=6010,4005,6000,6005
    
    # Timezone
    TIMEZONE=US/Eastern
    ```
    

### Step 5: Create API Key for SDRTrunk/TrunkRecorder

1.  **Edit the GenApiKey.js file**
    
    ```
    notepad GenApiKey.js
    ```
    
    Change the `apiKey` variable to your desired key:
    
    javascript
    
    ```javascript
    const apiKey = 'your-secret-api-key'; // Replace with your desired key this also goes in sdrtrunk/trunkrecorder
    ```
    
2.  **Generate the hashed API key**
    
    ```
    node GenApiKey.js
    ```
    
    This will output a hashed version of your API key.
3.  **Create the apikeys.json file**
    
    ```
    echo [{"key":"YOUR_HASHED_KEY_HERE","disabled":false}] > data\apikeys.json
    ```
    
    Replace YOUR_HASHED_KEY_HERE with the hash from the previous step.

### Step 6: Import Talk Group Data

1.  **Prepare your talk group data**
    -   Export your talk groups from RadioReference as CSV
    -   Save the file as `talkgroups.csv` in the project root directory
2.  **Prepare frequency data** (optional)
    -   Export frequencies from RadioReference as CSV
    -   Save as `frequencies.csv` in the project root directory
3.  **Run the import script**
    
    ```
    node import_csv.js
    ```
    

### Step 7: Initialize Admin User

```
node init-admin.js
```

This will create an admin user with the password specified in your .env file.

### Step 8: Start the Application

1.  **Start the main service** (in one PowerShell window)
    
    ```
    node bot.js
    ```
    
2.  **Start the web server** (in a second PowerShell window)
    
    ```
    node webserver.js
    ```
    
3.  **Access the web interface**
    -   Open your browser: `http://localhost` (or the IP/domain you configured)
    -   Login with username: `admin` and the password from your .env file

## Configuring SDRTrunk/TrunkRecorder

### RdioScanner Setup

Configure your SDRTrunk or TrunkRecorder to stream calls to your Scanner Map:

#### For SDRTrunk:

1.  Go to SDRTrunk **Settings** > **Streaming**
2.  Select **RdioScanner streaming**
3.  Configure the following:
    -   URL: `http://localhost:3306/api/call-upload` (or your server's address)
    -   Add your API key to the configuration
    -   Enable streaming for the talkgroups you want to map

#### For TrunkRecorder:

Edit your config.json file:

json

```json
"uploadServer": {
  "type": "rdioscanner",
  "server": "http://localhost:3306/api/call-upload",
  "key": "your-api-key"
}
```

## System Requirements

-   **GPU:** NVIDIA GPU with at least 8GB VRAM recommended
-   **RAM:** 16GB minimum
-   **Storage:** SSD with at least 20GB free space

## Troubleshooting

### Common Issues

1.  **"Node module not found" errors**
    -   Make sure you've installed all required Node.js packages
    -   Try running `npm install` in the project directory
2.  **Python/Whisper errors**
    -   Verify CUDA installation with `nvidia-smi`
    -   Check CUDA toolkit installation with `nvcc --version`
    -   Ensure Python path is correctly set
    -   Try reinstalling faster-whisper: `pip install --force-reinstall faster-whisper`
3.  **Audio transmission not showing up**
    -   Check your .env configuration, especially ports and API keys
    -   Verify SDRTrunk/TrunkRecorder is properly configured
    -   Check firewall settings for the configured ports
4.  **Ollama connection errors**
    -   Verify Ollama is running: `ollama ps`
    -   Make sure the model is downloaded: `ollama pull llama3.1:8b`
    -   Check OLLAMA_URL in your .env file
5.  **"Error opening database" message**
    -   Ensure you have write permissions to the project directory
    -   Try running the command prompt/PowerShell as administrator
6.  **Web interface not loading**
    -   Check if webserver.js is running without errors
    -   Verify your configured web port isn't in use by another application
    -   Make sure your firewall allows the configured port

### Logs to Check

Log files are located in the root directory:

-   `error.log` - Error messages
-   `combined.log` - All application logs

## Discord Bot Setup

1.  Create a Discord application at [Discord Developer Portal](https://discord.com/developers/applications)
2.  Create a bot and enable:
    -   Server Members Intent
    -   Message Content Intent
    -   Voice States Intent
3.  Invite the bot to your server with permissions:
    -   Manage Channels
    -   Send Messages
    -   Embed Links
    -   Attach Files
    -   Connect and Speak in Voice Channels

### Discord Commands

-   `/alert add <keyword> [talkgroup]` - Add alert keyword
-   `/alert remove <keyword> [talkgroup]` - Remove alert keyword
-   `/alert list` - List all alert keywords
-   `/summary refresh` - Refresh the AI-generated summary

## Need Help?

-   Check the log files for specific error messages
-   Open an issue on the GitHub repository
-   Contact me on discord poisonednumber
