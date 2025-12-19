# Radio Software Setup

[← Back to README](../README.md)

Connect your radio software to Scanner Map to receive and process calls.

---

## Supported Software

| Software | Type | Notes |
|----------|------|-------|
| **SDRTrunk** | Trunked radio decoder | Desktop application |
| **TrunkRecorder** | Trunked radio recorder | Linux/Docker |
| **rdio-scanner** | Web-based scanner | Can forward to Scanner Map |

All use the **rdio-scanner compatible API** for uploading calls.

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

### Step 1: Configure Streaming

1. Open SDRTrunk
2. Go to **View** → **Playlist Editor**
3. Click the **Streaming** tab
4. Click **New** → **Broadcastify Calls (rdio-scanner)**

### Step 2: Configure Settings

| Setting | Value |
|---------|-------|
| **Name** | Scanner Map (or any name) |
| **Host** | `localhost` (or your server IP) |
| **Port** | `3306` |
| **Path** | `/api/call-upload` |
| **API Key** | Your API key from apikeys.json |
| **System ID** | `1` (or any number) |

### Step 3: Enable Streaming

1. Select the broadcast configuration
2. Enable it for the desired system/talkgroups
3. Calls will now upload to Scanner Map

### Full URL

SDRTrunk may want the full URL:
```
http://localhost:3306/api/call-upload
```

---

## TrunkRecorder Setup

### Step 1: Edit config.json

Location:
- **Docker:** `appdata/trunk-recorder/config/config.json`
- **Local:** Your TrunkRecorder install directory

### Step 2: Add Upload Configuration

Add to your `config.json`:

```json
{
  "sources": [...],
  "systems": [...],
  "uploadServer": {
    "server": "http://scanner-map:3306/api/call-upload",
    "apiKey": "your-api-key"
  }
}
```

**For Docker networking:**
```json
"server": "http://scanner-map:3306/api/call-upload"
```

**For local/remote:**
```json
"server": "http://localhost:3306/api/call-upload"
```

### Step 3: Restart TrunkRecorder

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
      - ./appdata/trunk-recorder/config:/app/config
      - ./appdata/trunk-recorder/recordings:/app/recordings
    depends_on:
      - scanner-map
    networks:
      - scanner-network
```

The API key is auto-configured when using the installer.

---

## rdio-scanner Forwarding

If you're already running rdio-scanner, you can forward calls to Scanner Map.

### Configuration

In rdio-scanner's config, add Scanner Map as a downstream server:

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

