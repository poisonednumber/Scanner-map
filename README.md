# Scanner Map (made with lots of ai code)

A real-time scanner mapping system that integrates with SDRTrunk, providing live audio streaming, transcription, and geographic visualization of radio communications. This system processes radio transmissions, extracts location data, and displays them on an interactive map with various visualization options.

## Overview

The Scanner Map system consists of:
- A Node.js backend that processes SDRTrunk streams
- A Python-based transcription service using Whisper AI
- A web interface with interactive mapping
- A Discord bot for notifications and audio streaming
- A configurable geocoding system for location extraction

## Real-Time Features

### Live Call Tracking and Auto-Play

The system provides real-time tracking and automatic playback of new calls as they come in:

1. **Real-Time Mapping**
   - New calls appear on map within ~10 seconds (varies with GPU processing power)
   - Map automatically centers on new calls
   - Smooth animation transitions between markers
   - Clustering of nearby markers for better performance

2. **Automatic Audio Playback**
   - Auto-plays new call audio when enabled
   - Can be toggled with "Mute New Calls" button
   - Queues multiple calls if they arrive simultaneously
   - Transcription appears with audio playback

3. **Performance Factors**
   - Processing delay typically 8-15 seconds from transmission
   - Factors affecting delay:
     - GPU processing power (main factor)
     - Network speed
     - Server load
     - Number of simultaneous calls
   - NVIDIA GPU recommended for optimal performance

4. **Visual Indicators**
   - New call banner shows talk group information
   - Marker pulses when new
   - Audio waveform visualization
   - Heat map option for call density

5. **Controls**
   - Toggle auto-play with mute button
   - Adjust audio volume per call
   - Manual marker navigation
   - Time range filtering
   - Search functionality

### System Impact

For optimal real-time performance:
- Recommended: NVIDIA GPU with 4GB+ VRAM
- Minimum 16GB system RAM
- SSD storage for audio processing
- Broadband internet connection
- Processor: i5/Ryzen 5 or better

Processing times:
- High-end GPU (RTX 3070+): ~5-8 seconds
- Mid-range GPU (GTX 1660+): ~8-12 seconds
- Lower-end GPU: 12-20 seconds

## Features

- Real-time mapping of radio communications with location data
- Live audio streaming from SDRTrunk
- Audio transcription using Whisper large-v3-turbo model
- Interactive map with day/night/satellite views
- Marker clustering for better performance
- Heatmap visualization
- Search functionality
- Custom time range filtering
- Live audio streaming support
- User management system
- Session management
- Secure authentication
- Mobile-responsive design

## API Key Generation

1. Generate and hash your API key:
   ```bash
   # Edit hashApiKey.js to set your desired API key
   node hashApiKey.js
   ```
   The script will output a hashed version of your API key. Save both the original and hashed versions.

2. Create the API keys file:
   ```json
   // data/apikeys.json
   [
     {
       "key": "your_hashed_key_here",
       "disabled": false
     }
   ]
   ```

## Discord Integration

### Features
- Automatic channel creation for each talk group
- Real-time alerts for keyword matches
- Audio playback in voice channels
- Interactive buttons for live listening
- Channel categorization by jurisdiction
- Embedded messages with transcription and audio

### Discord Bot Setup
1. Create a Discord application at https://discord.com/developers/applications
2. Create a bot and get your bot token
3. Enable required Gateway Intents:
   - Server Members
   - Message Content
   - Voice States
4. Add bot to your server with required permissions:
   - Manage Channels
   - Send Messages
   - Connect to Voice
   - Speak in Voice Channels
   - Embed Links
   - Attach Files

### Discord Channel Structure
- Each talk group gets its own text channel
- Channels are organized by jurisdiction categories
- Special #alerts channel for keyword matches
- Voice channels created dynamically for live listening

### Alert Keywords
Set up alert keywords using Discord commands:
```
/alert add <keyword> [talkgroup]
/alert remove <keyword> [talkgroup]
/alert list
```

### Live Audio Features
- Click "Listen Live" button to join voice channel
- Voice channels auto-delete when inactive
- Multiple simultaneous streams supported
- Audio quality settings configurable

## Prerequisites

- Node.js (v14 or higher)
- Python 3.8 or higher (for transcription)
- CUDA-capable GPU (for Whisper transcription)
- SQLite3
- SDRTrunk setup with streaming enabled

## Installation

## Windows Installation Steps

1. **Install Required Software**
   ```batch
   :: Download and install prerequisites (use administrative PowerShell)
   winget install Python.Python.3.8
   winget install OpenJS.NodeJS.LTS
   winget install Git.Git
   winget install Microsoft.VisualStudio.2022.BuildTools
   ```

2. **Install CUDA Toolkit**
   - Download [NVIDIA CUDA Toolkit](https://developer.nvidia.com/cuda-downloads)
   - Select Windows version
   - Run installer as administrator
   - Reboot system after installation

3. **Clone Repository**
   ```batch
   :: Open Command Prompt as administrator
   cd C:\
   mkdir scanner-map
   cd scanner-map
   git clone [repository-url] .
   ```

4. **Install Dependencies**
   ```batch
   :: Install Node.js packages
   npm install dotenv express sqlite3 bcrypt uuid busboy winston moment-timezone discord.js @discordjs/voice prism-media node-fetch@2 socket.io wavesurfer.js leaflet.heat csv-parser openai path http fs crypto

   :: Install Python packages (might need administrative PowerShell)
   pip install torch --extra-index-url https://download.pytorch.org/whl/cu117
   pip install openai-whisper
   pip install whisper-timestamped
   ```

   Note: We specifically use node-fetch@2 because newer versions require ES modules.

5. **Create Directory Structure**
   ```batch
   mkdir audio
   mkdir data
   mkdir config
   ```

6. **Configure Environment**
   ```batch
   :: Create .env file (use Notepad or preferred editor)
   copy nul .env
   notepad .env
   ```

   Add the following to `.env`:
   ```env
   DISCORD_TOKEN=your_discord_token
   CLIENT_ID=your_client_id
   PORT=3306
   WEBSERVER_PORT=80
   PUBLIC_DOMAIN=your_public_ip_or_domain
   GOOGLE_MAPS_API_KEY=your_google_maps_api_key
   GEOCODING_CITY=YourCity
   GEOCODING_STATE=YourState
   GEOCODING_COUNTRY=YourCountry
   OPENAI_API_KEY=your_openai_api_key
   MAPPED_TALK_GROUPS=group1,group2,group3
   WEBSERVER_PASSWORD=your_admin_password
   ```

7. **Setup API Keys**
   ```batch
   :: Generate API key hash
   node hashApiKey.js
   
   :: Create apikeys.json
   echo [{"key":"your_hashed_key","disabled":false}] > data\apikeys.json
   ```

8. **Initialize Database**
   ```batch
   :: Initialize admin user
   node init-admin.js
   ```

9. **Import Radio Reference Data**
   - Export your talk groups from Radio Reference as CSV
   - Save as `talkgroups.csv` in root directory
   - Export frequencies as `frequencies.csv`
   ```batch
   node import_csv.js
   ```

10. **Start Services**
    ```batch
    :: Start main server (in one Command Prompt)
    node bot.js

    :: Start web server (in another Command Prompt)
    node webserver.js
    ```

11. **Verify Installation**
    - Open browser: `http://localhost:80`
    - Check Discord bot presence
    - Monitor logs:
    ```batch
    type error.log
    type combined.log
    ```

1. Create `.env` file:
```env
DISCORD_TOKEN=your_discord_token
CLIENT_ID=your_client_id
PORT=3306
WEBSERVER_PORT=80
PUBLIC_DOMAIN=your_public_ip_or_domain
GOOGLE_MAPS_API_KEY=your_google_maps_api_key
GEOCODING_CITY=YourCity
GEOCODING_STATE=YourState
GEOCODING_COUNTRY=YourCountry
OPENAI_API_KEY=your_openai_api_key
MAPPED_TALK_GROUPS=group1,group2,group3
WEBSERVER_PASSWORD=your_admin_password
```

2. Generate API key:
```bash
# Edit hashApiKey.js first
node hashApiKey.js
```

3. Create API keys file:
```bash
mkdir data
echo '[{"key":"your_hashed_key","disabled":false}]' > data/apikeys.json
```

4. Copy geocoding config:
```bash
cp config/geocoding-config.example.js config/geocoding-config.js
# Edit config/geocoding-config.js with your settings
```

5. Import Radio Reference Data:

   a. Export your talk groups from Radio Reference as CSV and save as `txwarn_talkgroups.csv`
   b. Export your frequencies from Radio Reference as CSV and save as `frequencies.csv`
   c. Run the import script:
   ```bash
   node import_csv.js
   ```

6. Initialize the admin user:
```bash
node init-admin.js
```

## SDRTrunk Configuration

1. Set up SDRTrunk with HTTP POST streaming enabled
2. Configure the streaming URL to point to `http://your_server:3306/api/call-upload`
3. Set the API key in SDRTrunk's streaming configuration

## Running the Application

### 1. Database Initialization
```bash
# Initialize admin user
node init-admin.js

# Import Radio Reference data
node import_csv.js
```

### 2. Start Services
```bash
# Start main application server
node bot.js

# Start web interface server
node webserver.js
```

### 3. Access Points
- Web Interface: `http://your_domain:80`
- API Endpoint: `http://your_domain:3306/api/call-upload`
- Discord Bot: Will appear in your Discord server

### 4. Verify Operation
1. Check the logs:
   ```bash
   tail -f error.log
   tail -f combined.log
   ```

2. Monitor Discord channels:
   - Check if bot is online
   - Verify channel creation
   - Test alert keywords

3. Verify SDRTrunk connection:
   - Send test transmission
   - Check audio processing
   - Verify transcription

## Project Structure

### Core Files
```
├── bot.js              # Main application server
├── webserver.js        # Web interface server
├── geocoding.js        # Location processing
├── transcribe.py       # Audio transcription
├── import_csv.js       # Radio Reference data import
├── hashApiKey.js       # API key generation
└── init-admin.js       # Admin initialization

├── config/
│   ├── geocoding-config.js    # Geocoding rules
│   └── geocoding-config.example.js
│
├── data/
│   └── apikeys.json    # API key storage
│
├── public/             # Static web files
│   ├── app.js         # Frontend application
│   ├── styles.css     # Styling
│   └── index.html     # Main page
│
└── audio/             # Temporary audio storage
```

### Configuration Files
```
├── .env               # Environment variables
├── botdata.db         # SQLite database
├── error.log          # Error logging
└── combined.log       # General logging
```

## Feature Details

### Audio Processing
- Receives audio streams from SDRTrunk
- Transcribes audio using Whisper large-v3-turbo model
- Supports MP3 format

### Mapping
- Uses OpenStreetMap with multiple view options
- Supports marker clustering
- Real-time heatmap visualization
- Location correction capabilities

### Search and Filtering
- Full-text search of transcriptions
- Time-based filtering
- Talk group filtering

### User Management
- Multi-user support
- Session management
- Role-based access control

### Location Processing
- Address extraction from transcriptions
- Geocoding using Google Maps API
- Geographic fence configuration

## Troubleshooting

### Common Issues

1. Transcription not working:
   - Verify CUDA installation
   - Check Python dependencies
   - Ensure Whisper model is properly installed

2. Audio streaming issues:
   - Verify SDRTrunk configuration
   - Check network connectivity
   - Validate API key configuration

3. Map not loading:
   - Verify Google Maps API key
   - Check browser console for errors
   - Validate network connectivity

### Error Logs

Log files are located in the root directory:
- `error.log` - Error messages
- `combined.log` - All application logs

## Security Considerations

- Keep your `.env` file secure and never commit it to version control
- Regularly update the admin password
- Monitor active sessions
- Use HTTPS in production
- Regularly update dependencies

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- SDRTrunk developers
- OpenStreetMap contributors
- Whisper by OpenAI
- Discord.js team

## Support

For support, please open an issue in the GitHub repository or contact the development team.
