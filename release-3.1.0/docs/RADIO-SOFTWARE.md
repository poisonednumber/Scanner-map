# Radio Software Setup

[← Back to README](../README.md)

Connect your radio software to Scanner Map to receive and process calls.

---

## Supported Software

| Software | Type | Notes | Auto-Configured |
|----------|------|-------|----------------|
| **TrunkRecorder** | Trunked radio recorder | Linux/Docker | ✅ Yes (Docker + Config) |
| **SDRTrunk** | Trunked radio decoder | Desktop application | ✅ Yes (Config file) |
| **rdio-scanner** | Web-based scanner | Web-based, Docker available | ✅ Yes (Docker + Config) |
| **OP25** | Command-line decoder | Linux/Docker | ✅ Yes (Docker + Config) |

All use the **rdio-scanner compatible API** for uploading calls. The installer can auto-configure all of these options.

---

## API Endpoint

```
POST http://your-server:3306/api/call-upload
```

Replace `your-server` with your Scanner Map server address:
- Local: `localhost` or `127.0.0.1`
- Docker: `scanner-map` (from other containers) or host IP
- Remote: Your public IP or domain

---

## API Key

Scanner Map auto-generates an API key on first startup.

### Finding Your API Key

**Docker:**
```bash
cat appdata/scanner-map/data/apikeys.json
```

**Local:**
```bash
cat data/apikeys.json
```

**Console Output:**
The key is also displayed in the console on first run:
```
[API] Generated new API key: abc123-def456-ghi789
```

### Regenerating API Key

Delete the apikeys.json file and restart Scanner Map:

```bash
# Docker
rm appdata/scanner-map/data/apikeys.json
docker-compose restart scanner-map

# Local
rm data/apikeys.json
npm start
```

---

## SDRTrunk Setup

SDRTrunk is a desktop application for decoding trunked radio systems.

### Auto-Configuration (Installer)

If you selected SDRTrunk during installation:

1. **Configuration file is auto-generated** in `appdata/sdrtrunk/config/streaming-config.json`
2. **Import the config into SDRTrunk:**
   - Open SDRTrunk
   - Go to **View** → **Playlist Editor**
   - Click the **Streaming** tab
   - Click **Import** and select `appdata/sdrtrunk/config/streaming-config.json`
3. **Enable streaming** for your desired systems/talkgroups
4. **API key is already configured** in the imported config

### Manual Configuration

If you prefer to configure manually:

#### Step 1: Configure Streaming

1. Open SDRTrunk
2. Go to **View** → **Playlist Editor**
3. Click the **Streaming** tab
4. Click **New** → **Broadcastify Calls (rdio-scanner)**

#### Step 2: Configure Settings

| Setting | Value |
|---------|-------|
| **Name** | Scanner Map (or any name) |
| **Host** | `localhost` (or your server IP) |
| **Port** | `3306` |
| **Path** | `/api/call-upload` |
| **API Key** | Your API key from `data/api-key.txt` or `appdata/scanner-map/data/api-key.txt` |
| **System ID** | `1` (or any number) |

#### Step 3: Enable Streaming

1. Select the broadcast configuration
2. Enable it for the desired system/talkgroups
3. Calls will now upload to Scanner Map

### Full URL

SDRTrunk may want the full URL:
```
http://localhost:3306/api/call-upload
```

**For Docker networking (if SDRTrunk is on host, Scanner Map in Docker):**
```
http://host.docker.internal:3306/api/call-upload
```

---

## TrunkRecorder Setup

TrunkRecorder is a Linux/Docker-based trunked radio recorder.

### Docker Installation (Auto-Configured)

If you selected TrunkRecorder during installation:

1. **Configuration is auto-generated** in `appdata/trunk-recorder/config/config.json`
2. **API key is already configured** automatically
3. **Start the container:**
   ```bash
   docker-compose up -d trunk-recorder
   ```
4. **Configure your radio system** in `appdata/trunk-recorder/config/config.json`:
   - Add your SDR sources
   - Configure your trunked radio systems
   - Upload server is already set up

### Manual Configuration

If you're running TrunkRecorder manually:

#### Step 1: Edit config.json

Location:
- **Docker:** `appdata/trunk-recorder/config/config.json`
- **Local:** Your TrunkRecorder install directory

#### Step 2: Add Upload Configuration

Add to your `config.json`:

```json
{
  "sources": [...],
  "systems": [...],
  "uploadServer": {
    "type": "rdio-scanner",
    "url": "http://scanner-map:3306/api/call-upload",
    "apiKey": "your-api-key"
  }
}
```

**For Docker networking:**
```json
"url": "http://scanner-map:3306/api/call-upload"
```

**For local/remote:**
```json
"url": "http://localhost:3306/api/call-upload"
```

#### Step 3: Restart TrunkRecorder

```bash
# Docker
docker-compose restart trunk-recorder

# Local
./trunk-recorder
```

### Docker Compose Integration

If using Scanner Map's Docker Compose with TrunkRecorder:

```yaml
services:
  trunk-recorder:
    image: robotastic/trunk-recorder:latest
    volumes:
      - ./appdata/trunk-recorder/config:/config
      - ./appdata/trunk-recorder/recordings:/recordings
    networks:
      - scanner-network
```

The API key and upload server are auto-configured when using the installer.

---

## rdio-scanner Setup

rdio-scanner is a web-based scanner that can forward calls to Scanner Map.

### Docker Installation (Auto-Configured)

If you selected rdio-scanner during installation:

1. **Configuration is auto-generated** in `appdata/rdio-scanner/config/config.json`
2. **Start the container:**
   ```bash
   docker-compose up -d rdio-scanner
   ```
3. **Access web interface:** http://localhost:3000
4. **Downstream server is already configured** to forward to Scanner Map

### Manual Installation

If you're already running rdio-scanner, you can forward calls to Scanner Map.

#### Configuration

In rdio-scanner's config (`appdata/rdio-scanner/config/config.json`), add Scanner Map as a downstream server:

```json
{
  "downstream": [
    {
      "url": "http://localhost:3306/api/call-upload",
      "apiKey": "your-scanner-map-api-key"
    }
  ]
}
```

**For Docker networking:**
```json
{
  "downstream": [
    {
      "url": "http://scanner-map:3306/api/call-upload",
      "apiKey": "your-scanner-map-api-key"
    }
  ]
}
```

The installer auto-generates this configuration with the correct API key.

---

## OP25 Setup

OP25 is a command-line trunked radio decoder.

### Docker Installation (Auto-Configured)

If you selected OP25 during installation:

1. **Configuration is auto-generated** in `appdata/op25/config/config.json`
2. **Start the container:**
   ```bash
   docker-compose up -d op25
   ```
3. **Upload server is already configured** to send calls to Scanner Map

### Manual Installation

1. **Install OP25** on your system
2. **Use the generated config** from `appdata/op25/config/config.json`
3. **Configure your radio system** in OP25
4. **Upload server settings** are already configured with the API key

The installer auto-generates the upload server configuration with the correct API key.

---

## Upload Format

Scanner Map accepts the rdio-scanner call upload format:

```
POST /api/call-upload
Content-Type: multipart/form-data

Fields:
- audio: Audio file (m4a, mp3, wav)
- key: API key
- system: System ID
- talkgroup: Talk group ID
- dateTime: Unix timestamp
- source: Source unit (optional)
- freq: Frequency (optional)
```

---

## Testing Uploads

### Using curl

```bash
curl -X POST \
  -F "audio=@test.m4a" \
  -F "key=your-api-key" \
  -F "system=1" \
  -F "talkgroup=1001" \
  -F "dateTime=$(date +%s)" \
  http://localhost:3306/api/call-upload
```

### Expected Response

**Success:**
```json
{
  "success": true,
  "id": 123
}
```

**Auth Error:**
```json
{
  "error": "Invalid API key"
}
```

---

## Troubleshooting

### "Invalid API key"

- Verify key matches `apikeys.json`
- Ensure no extra spaces or characters
- Check key hasn't been regenerated

### "Connection refused"

- Verify Scanner Map is running
- Check port 3306 is accessible
- Verify firewall allows connection

### Uploads work but no transcriptions

- Check `TRANSCRIPTION_MODE` settings
- Verify AI provider is configured
- Check logs: `docker logs scanner-map`

### Audio plays but no map markers

- Verify `MAPPED_TALK_GROUPS` includes your talk groups
- Check geocoding configuration
- Verify AI provider for address extraction

### Docker: Can't connect from TrunkRecorder

Use Docker service name, not localhost:
```json
"server": "http://scanner-map:3306/api/call-upload"
```

### Windows: USB devices not accessible in Docker

Run SDRTrunk/TrunkRecorder on Windows host, upload to Scanner Map via network:
```json
"server": "http://host.docker.internal:3306/api/call-upload"
```

---

## Firewall Rules

If connecting from another machine, allow port 3306:

**Linux (ufw):**
```bash
sudo ufw allow 3306/tcp
```

**Windows:**
```powershell
netsh advfirewall firewall add rule name="Scanner Map API" dir=in action=allow protocol=TCP localport=3306
```

