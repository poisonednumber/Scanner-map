# Transcription Guide

[← Back to README](../README.md)

Scanner Map supports multiple transcription backends. Choose based on your needs.

---

## Comparison

| Mode | Speed | Accuracy | Cost | Requirements |
|------|-------|----------|------|--------------|
| **Local** | Medium | Good | Free | Python, CPU/GPU |
| **Remote** | Fast | Good | Free | Self-hosted server |
| **OpenAI** | Fast | Excellent | ~$0.006/min | API key |
| **iCAD** | Fast | Excellent | Free | Docker/self-hosted |

---

## Local Transcription

Uses faster-whisper running locally via Python.

### Configuration

```env
TRANSCRIPTION_MODE=local
TRANSCRIPTION_DEVICE=cpu   # or 'cuda' for NVIDIA GPU
WHISPER_MODEL=base         # See model options below
```

### Whisper Models

| Model | Size | Speed | Accuracy | VRAM Required | Best For |
|-------|------|-------|----------|---------------|----------|
| `tiny` | 39M | Fastest | Low | ~1 GB | CPU, low-end |
| `base` | 74M | Fast | Medium | ~1 GB | CPU, low-end GPU |
| `small` | 244M | Medium | Good | ~2-3 GB | ⭐ **8GB GPU (Recommended)** |
| `medium` | 769M | Slow | Very Good | ~5-6 GB | 8GB+ GPU |
| `large-v3` | 1550M | Slowest | Best | ~10 GB | 16GB+ GPU |

**Recommendations:**
- **8GB GPU:** `small` - Best balance of speed and accuracy
- **16GB+ GPU:** `medium` or `large-v3` - Better accuracy
- **CPU only:** `base` or `tiny` - Smaller models work better on CPU

**Note:** Models are automatically downloaded during installation. The installer detects your GPU and recommends the best model.

### Python Setup

```bash
# Create virtual environment
python -m venv .venv

# Activate
source .venv/bin/activate  # Linux/macOS
.venv\Scripts\activate     # Windows

# Install dependencies
pip install -r requirements.txt
```

### GPU Acceleration (NVIDIA)

1. Install CUDA Toolkit
2. Install PyTorch with CUDA:
```bash
pip install torch --index-url https://download.pytorch.org/whl/cu121
```
3. Set `TRANSCRIPTION_DEVICE=cuda`

---

## Remote Transcription

Use a self-hosted faster-whisper server.

### Configuration

```env
TRANSCRIPTION_MODE=remote
FASTER_WHISPER_SERVER_URL=http://your-server:8000
WHISPER_MODEL=large-v3
```

### Server Setup

We recommend [speaches](https://github.com/speaches-ai/speaches) for the remote server:

```bash
# Docker
docker run -d -p 8000:8000 ghcr.io/speaches-ai/speaches:latest

# Or with GPU
docker run -d -p 8000:8000 --gpus all ghcr.io/speaches-ai/speaches:latest
```

---

## OpenAI Transcription

Uses OpenAI's Whisper API for cloud transcription.

### Configuration

```env
TRANSCRIPTION_MODE=openai
OPENAI_API_KEY=sk-your-api-key
OPENAI_TRANSCRIPTION_MODEL=whisper-1
```

### Custom Prompts

Improve transcription quality with a context prompt:

```env
OPENAI_TRANSCRIPTION_PROMPT=This is police/fire/EMS scanner radio audio. Transcribe addresses, unit numbers, and call signs accurately.
```

### Pricing

- ~$0.006 per minute of audio
- 25 MB file size limit
- Very fast processing

---

## iCAD Transcribe

Advanced transcription optimized for radio/scanner audio.

### Configuration

```env
TRANSCRIPTION_MODE=icad
ICAD_URL=http://localhost:9912
ICAD_PROFILE=tiny
ICAD_API_KEY=your-api-key
```

### Docker Setup

```yaml
# In docker-compose.yml
services:
  icad-transcribe:
    image: thegreatcodeholio/icad_transcribe:latest
    ports:
      - "9912:9912"
    volumes:
      - ./appdata/icad-transcribe:/app/data
```

### Features

- Radio-optimized models
- Web UI for model management
- Multiple transcription profiles
- Low latency

### Profiles

| Profile | Best For |
|---------|----------|
| `tiny` | Fast, low resource |
| `base` | Balanced |
| `small` | Good accuracy |
| `analog-radio` | Analog radio audio |

Access web UI at http://localhost:9912 to manage profiles and install models.

---

## Troubleshooting

### Local: "CUDA out of memory"
- Use a smaller model
- Set `TRANSCRIPTION_DEVICE=cpu`
- Close other GPU applications

### Local: "Python not found"
- Set `PYTHON_COMMAND=python3` or full path
- Ensure virtual environment is activated

### Remote: Connection refused
- Verify server is running
- Check firewall rules
- Verify URL includes protocol (`http://`)

### OpenAI: 401 Unauthorized
- Verify API key is correct
- Check API key has credits
- Ensure no extra spaces in `.env`

### iCAD: Empty transcriptions
- Install models via web UI
- Verify ICAD_PROFILE matches installed model
- Check iCAD logs: `docker logs icad-transcribe`

---

## Performance Tips

1. **For speed:** Use `tiny` or `base` model, or OpenAI
2. **For accuracy:** Use `large-v3`, OpenAI, or iCAD
3. **For cost:** Use local or iCAD
4. **For ease:** Use OpenAI (no setup required)

### Concurrency

Limit concurrent transcriptions to prevent overload:

```env
MAX_CONCURRENT_TRANSCRIPTIONS=2  # Increase for powerful hardware
```

