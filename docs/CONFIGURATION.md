# Configuration Reference

[← Back to README](../README.md)

All settings are configured in the `.env` file. This document explains every option.

---

## Quick Reference

| Setting | Required | Default | Description |
|---------|----------|---------|-------------|
| `WEBSERVER_PORT` | Yes | `3001` | Web interface port |
| `BOT_PORT` | Yes | `3306` | API port for audio uploads |
| `PUBLIC_DOMAIN` | Yes | `localhost` | Domain for audio links |
| `AI_PROVIDER` | Yes | - | `openai` or `ollama` |
| `TRANSCRIPTION_MODE` | Yes | `local` | See [Transcription](TRANSCRIPTION.md) |

---

## Core Settings

```env
# Port for the web interface
WEBSERVER_PORT=3001

# Port for SDRTrunk/TrunkRecorder uploads
BOT_PORT=3306

# Public domain or IP for audio playback URLs
PUBLIC_DOMAIN=localhost

# Timezone (affects timestamps in logs and UI)
TIMEZONE=America/New_York
```

---

## AI Provider (Required)

You must choose an AI provider for address extraction and categorization.

### Option 1: OpenAI (Recommended for accuracy)

```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-your-api-key-here
OPENAI_MODEL=gpt-4o-mini
```

**Models:**
- `gpt-4o-mini` - Fast, cheap, good accuracy (recommended)
- `gpt-4o` - Best accuracy, higher cost
- `gpt-3.5-turbo` - Cheapest, lower accuracy

### Option 2: Ollama (Free, runs locally)

```env
AI_PROVIDER=ollama
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
```

**Models:**
- `llama3.1:8b` - Good balance of speed/accuracy
- `llama3.1:70b` - Best accuracy, requires powerful hardware
- `mistral:7b` - Fast alternative

---

## Transcription Mode (Required)

See [Transcription Guide](TRANSCRIPTION.md) for details.

```env
# Options: local, remote, openai, icad
TRANSCRIPTION_MODE=local

# For local mode only
TRANSCRIPTION_DEVICE=cpu  # or 'cuda' for NVIDIA GPU
```

---

## Geocoding

See [Geocoding Guide](GEOCODING.md) for details.

```env
# Provider: nominatim (free), locationiq, google
GEOCODING_PROVIDER=nominatim

# API keys (only needed for LocationIQ or Google)
LOCATIONIQ_API_KEY=
GOOGLE_MAPS_API_KEY=

# Location hints for better accuracy
GEOCODING_STATE=MD
GEOCODING_CITY=Baltimore
GEOCODING_COUNTRY=us
GEOCODING_TARGET_COUNTIES=Baltimore,Baltimore City
```

---

## Discord Bot (Optional)

See [Discord Guide](DISCORD.md) for setup.

```env
ENABLE_DISCORD=false
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-client-id
```

---

## Authentication (Optional)

Enable password protection for the web interface.

```env
# Enable authentication
ENABLE_AUTH=false
WEBSERVER_PASSWORD=your-password

# Session settings
SESSION_DURATION_DAYS=7
MAX_SESSIONS_PER_USER=5
```

When enabled:
- Users must log in to access the interface
- Admin user is auto-created on first startup
- Default username: `admin`, password: from `WEBSERVER_PASSWORD`

---

## Storage

```env
# Storage mode: local or s3
STORAGE_MODE=local

# S3 settings (only if STORAGE_MODE=s3)
S3_ENDPOINT=https://your-s3-endpoint.com
S3_BUCKET_NAME=scanner-map
S3_ACCESS_KEY_ID=your-access-key
S3_SECRET_ACCESS_KEY=your-secret-key
```

---

## Talk Groups

Configure which talk groups trigger address extraction.

```env
# Enable talk group filtering
ENABLE_MAPPED_TALK_GROUPS=true

# Comma-separated talk group IDs (dispatch channels recommended)
MAPPED_TALK_GROUPS=1001,1002,2001

# Location context for each talk group (helps AI accuracy)
TALK_GROUP_1001=Baltimore City Fire Dispatch
TALK_GROUP_1002=Baltimore County Police Dispatch
TALK_GROUP_2001=Anne Arundel Fire Dispatch
```

---

## Two-Tone Detection (Optional)

Enable pager tone detection for fire/EMS calls.

```env
ENABLE_TWO_TONE_MODE=false
TWO_TONE_TALK_GROUPS=4005
TWO_TONE_QUEUE_SIZE=1
TONE_DETECTION_TYPE=auto

# Tone parameters (usually don't need to change)
TWO_TONE_MIN_TONE_LENGTH=0.7
TWO_TONE_MAX_TONE_LENGTH=3.0
TONE_DETECTION_THRESHOLD=0.3
```

---

## API Keys File

API keys for SDRTrunk/TrunkRecorder are stored in:
- **Docker:** `appdata/scanner-map/data/apikeys.json`
- **Local:** `data/apikeys.json`

This file is auto-generated on first startup. The plain-text key is displayed in the console once.

---

## Advanced Settings

```env
# Maximum concurrent transcriptions
MAX_CONCURRENT_TRANSCRIPTIONS=2

# AI summary lookback period
SUMMARY_LOOKBACK_HOURS=1
ASK_AI_LOOKBACK_HOURS=8

# Python command (if not in PATH)
PYTHON_COMMAND=python3

# Auto-update Python packages on startup
AUTO_UPDATE_PYTHON_PACKAGES=true
```

---

## Example Complete Configuration

```env
# Core
WEBSERVER_PORT=3001
BOT_PORT=3306
PUBLIC_DOMAIN=192.168.1.100
TIMEZONE=America/New_York

# AI
AI_PROVIDER=openai
OPENAI_API_KEY=sk-xxx
OPENAI_MODEL=gpt-4o-mini

# Transcription
TRANSCRIPTION_MODE=local
TRANSCRIPTION_DEVICE=cuda

# Geocoding
GEOCODING_PROVIDER=nominatim
GEOCODING_STATE=MD
GEOCODING_CITY=Baltimore
GEOCODING_COUNTRY=us
GEOCODING_TARGET_COUNTIES=Baltimore,Baltimore City

# Talk Groups
ENABLE_MAPPED_TALK_GROUPS=true
MAPPED_TALK_GROUPS=1001,1002
TALK_GROUP_1001=Baltimore City Dispatch
TALK_GROUP_1002=Baltimore County Dispatch

# Optional
ENABLE_DISCORD=false
ENABLE_AUTH=false
STORAGE_MODE=local
```

