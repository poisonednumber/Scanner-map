# Web UI Configuration Guide

[← Back to README](../README.md)

Scanner Map's web UI includes a comprehensive "Quick Start" menu that allows you to configure most settings without editing the `.env` file directly. This guide covers all configuration options available in the web UI.

---

## Accessing the Quick Start Menu

1. Open Scanner Map in your browser: `http://localhost:3001`
2. Click the **Settings** button in the top-right corner
3. Select **Quick Start** from the dropdown menu

---

## Location Configuration

Configure your location for accurate geocoding of addresses from radio calls.

### Features:
- **Browser Geolocation** - Automatically detect your location
- **Interactive Map** - Visual selection with 50-mile radius display
- **Location Search** - Search and select cities/counties
- **Manual Entry** - Enter city, state, country, and counties manually

### Configuration:
1. Open the **Location** tab in Quick Start
2. Click **Detect Location** to use browser geolocation
3. Or use the map to select your location
4. Enter or adjust:
   - City
   - State
   - Country
   - Target Counties (comma-separated)
5. Click **Save Configuration**

**Note:** Location settings help filter geocoding results to your area for better accuracy.

---

## System Status & Dependencies

View system requirements and install missing dependencies.

### Features:
- **Dependency Status** - Check Docker, Node.js, Python installation
- **System Information** - View OS, versions, architecture
- **One-Click Installation** - Install missing dependencies with progress tracking
- **Real-Time Logs** - See installation progress in real-time

### Installing Dependencies:

#### Docker Installation:
1. Open the **System** tab
2. Click **Install Docker** (if not installed)
3. Follow the progress bar and logs
4. Docker will be installed based on your operating system

#### Node.js Installation:
1. Click **Install Node.js**
2. Progress will be shown in real-time
3. Installer will restart to apply PATH changes

#### Python Installation:
1. Click **Install Python**
2. Progress tracking available
3. Python will be installed with required packages

---

## Update Management

Check for updates and configure auto-update settings.

### Features:
- **Version Check** - See current and latest versions
- **Update Installation** - Install updates with one click
- **Auto-Update Toggle** - Enable/disable automatic update checks

### Updating Scanner Map:
1. Open the **Updates** tab
2. Click **Check for Updates**
3. If an update is available, click **Install Update**
4. Progress will be shown during installation
5. Toggle **Auto-Update** to enable automatic checks

---

## GPU Configuration

Configure GPU acceleration for AI models and transcription (NVIDIA only).

### Features:
- **GPU Detection** - Automatic NVIDIA GPU detection
- **Docker GPU Support** - Enable GPU access in Docker containers
- **Toolkit Installation** - One-click NVIDIA Container Toolkit installation (Linux)
- **Test GPU Access** - Verify GPU is accessible in Docker

### Configuration:
1. Open the **GPU** tab
2. View GPU status and name
3. Toggle **Enable GPU in Docker** (if using Docker)
4. On Linux, click **Install NVIDIA Container Toolkit** if needed
5. Click **Test GPU** to verify access

**Note:** GPU acceleration significantly speeds up Ollama AI models and local transcription.

---

## Auto-Start Configuration

Configure Scanner Map to start automatically on system boot.

### Features:
- **Platform Support** - Windows, Linux, macOS
- **System Service** - Create system service for auto-start
- **Installation Instructions** - Platform-specific setup guides

### Configuration:
1. Open the **Auto-Start** tab
2. View current auto-start status
3. Click **Configure Auto-Start**
4. Follow platform-specific instructions shown in the UI
5. Service will be created and enabled

---

## Radio Configuration

Manage talkgroups and frequencies for your radio system.

### Features:
- **Talkgroup Management** - Add, edit, delete talkgroups
- **Frequency Management** - Add, edit, delete frequencies
- **CSV Import** - Import from RadioReference exports
- **Auto-Configuration** - Generate TrunkRecorder config from database

### Managing Talkgroups:
1. Open the **Radio Config** tab
2. Select **Talkgroups** sub-tab
3. Click **Add Talkgroup**
4. Enter:
   - DEC (Decimal ID) - Required
   - HEX (Hexadecimal ID)
   - Alpha Tag (Name)
   - Description
   - Tag/Category
   - County
5. Click **Save**
6. Edit or delete existing talkgroups using the Actions column

### Managing Frequencies:
1. Select **Frequencies** sub-tab
2. Click **Add Frequency**
3. Enter:
   - Site ID - Required
   - Frequency (MHz) - Required
   - Description
4. Click **Save**

### CSV Import:
1. Select **CSV Import** sub-tab
2. Choose **Talkgroups** or **Frequencies**
3. Drag and drop CSV file or click to browse
4. Preview the data
5. Select merge/update options
6. Click **Import**
7. Review import results and errors

**CSV Format:** RadioReference export format with columns: DEC, HEX, Alpha Tag, Mode, Description, Tag, County, Site ID, Frequency

### TrunkRecorder Auto-Configuration:
1. Select **Software Config** sub-tab
2. View detected radio software
3. Click **Configure TrunkRecorder**
4. Preview generated configuration
5. Click **Save Configuration**
6. Configuration is saved to `appdata/trunk-recorder/config/config.json`

**Note:** Auto-configuration generates TrunkRecorder v2 format config files with all frequencies and talkgroups from your database.

---

## Transcription & AI Configuration

Configure transcription services and AI providers (NEW in 3.1.0).

### Transcription Services:

#### Via Web UI:
1. Open the **Settings** menu
2. Select **Service Configuration**
3. Configure transcription mode:
   - **Local Whisper** - Runs on your machine (free)
   - **OpenAI Whisper** - Cloud transcription (paid)
   - **iCAD Transcribe** - Radio-optimized transcription
   - **Remote Server** - External Whisper server

#### Configuration Options:
- **Local Mode**: Device (CPU/CUDA), Whisper Model (tiny/base/small/medium/large-v3)
- **Remote Mode**: Server URL
- **iCAD Mode**: URL, Profile, API Key
- **OpenAI Mode**: API Key, Model

**Note:** Transcription configuration requires editing `.env` file directly. The web UI displays current settings and provides guidance.

### AI Provider Configuration:

#### Via Web UI:
1. Open **Service Configuration** from Settings
2. View current AI provider status
3. Configure Ollama URL (if using Ollama)
4. Configure iCAD URL (if using iCAD)

#### API Key Configuration:
- **OpenAI API Key**: Edit `.env` file directly
- **Ollama URL**: Can be configured via web UI
- **iCAD URL**: Can be configured via web UI

**Environment Variables:**
```env
AI_PROVIDER=openai  # or ollama
OPENAI_API_KEY=sk-your-key-here  # For OpenAI
OLLAMA_URL=http://localhost:11434  # For Ollama
OLLAMA_MODEL=llama3.1:8b  # Model name
```

**Note:** API keys should be added to `.env` file for security. The web UI shows current configuration status.

---

## Natural Language Configuration (AI Commands)

Use natural language to configure radio settings.

### Features:
- **Voice Input** - Speak commands using your microphone
- **Text Input** - Type commands
- **Command History** - View previous commands
- **Example Commands** - Learn available commands

### Using AI Commands:
1. Open the **AI Commands** tab
2. Type or speak a command, for example:
   - "Add talkgroup 1234 for Fire Department"
   - "Set frequency 851.0125 for Site 1"
   - "Show all police talkgroups"
3. Command is parsed and executed
4. Results are shown in the history

**Supported Commands:**
- Add/edit/delete talkgroups
- Add/edit/delete frequencies
- Query talkgroups and frequencies
- Configure radio settings

---

## Service Configuration

Configure optional services (Ollama, iCAD Transcribe).

### Features:
- **Service Status** - View enabled/disabled status
- **URL Configuration** - Set service URLs
- **Auto-Configuration** - Docker services auto-configured

### Configuration:
1. Open **Settings** → **Service Configuration**
2. View current service status:
   - **Ollama**: URL, Model, Enabled status
   - **iCAD Transcribe**: URL, Enabled status
3. Update URLs if using remote services
4. Click **Save Configuration**

**Note:** Docker services use service names (e.g., `http://ollama:11434`). Remote services use full URLs.

---

## Tips & Best Practices

### First-Time Setup:
1. Configure **Location** first for accurate geocoding
2. Install missing **Dependencies** if needed
3. Configure **GPU** if you have NVIDIA GPU
4. Set up **Radio Configuration** with your talkgroups/frequencies
5. Configure **Transcription & AI** via `.env` file (see [Configuration Guide](CONFIGURATION.md))

### Performance Optimization:
- Enable GPU if available (faster AI/transcription)
- Use appropriate Whisper model size for your hardware
- Configure auto-start for convenience
- Use CSV import for bulk talkgroup/frequency management

### Troubleshooting:
- Check **System Status** for dependency issues
- View **Update Status** if experiencing issues
- Use **Test GPU** to verify GPU access
- Check browser console for errors

---

## Need Help?

- See [Configuration Reference](CONFIGURATION.md) for all `.env` settings
- See [Installation Guide](INSTALLATION.md) for setup help
- See [Troubleshooting Guide](TROUBLESHOOTING.md) for common issues

