# Alternative Software Research - Drop-in Replacements

This document provides research on compatible drop-in replacement applications for:
1. **LLM Features** (address extraction, AI chat)
2. **Transcription** (audio-to-text)
3. **Radio Receiving** (SDR trunking scanners)

## Current Stack

### LLM Features
- **Primary**: Ollama (local) or OpenAI (cloud)
- **Usage**: Address extraction from transcripts, Discord "Ask AI" commands
- **API**: OpenAI-compatible REST API

### Transcription
- **Primary**: faster-whisper (local Whisper implementation)
- **Alternatives**: iCAD transcription service, faster-whisper server
- **Usage**: Real-time audio transcription from radio calls

### Radio Receiving
- **Primary**: TrunkRecorder, SDRTrunk, rdio-scanner, OP25
- **Integration**: HTTP POST to `/api/call-upload` endpoint
- **Format**: Multipart form data with audio file and metadata

---

## 1. LLM Alternatives

### 1.1 LocalAI ⭐ **RECOMMENDED**
**Status**: Drop-in replacement for OpenAI API

**Description**: Open-source platform that provides OpenAI-compatible API endpoints for running LLMs locally.

**Pros**:
- ✅ **100% OpenAI API compatible** - drop-in replacement
- ✅ Supports multiple model backends (llama.cpp, exllama, vLLM, etc.)
- ✅ Docker support
- ✅ REST API compatible with existing code
- ✅ Supports function calling, embeddings, audio transcription
- ✅ Active development and community

**Cons**:
- ⚠️ Requires more setup than Ollama
- ⚠️ May need more resources depending on backend

**Integration Notes**:
- Can replace OpenAI API calls directly (change base URL)
- Compatible with existing `OPENAI_API_KEY` pattern (can use dummy key)
- Supports same models as OpenAI (via different backends)

**Installation**:
```bash
# Docker
docker run -p 8080:8080 --name local-ai -ti localai/localai:latest

# Or with specific backend
docker run -p 8080:8080 --name local-ai -ti localai/localai:latest-aio-cpu
```

**Configuration**:
```env
AI_PROVIDER=openai
OPENAI_API_KEY=dummy  # LocalAI doesn't require real key
OPENAI_MODEL=llama3.1:8b  # Model name configured in LocalAI
OLLAMA_URL=http://localhost:8080  # Or use OPENAI_BASE_URL
```

**GitHub**: https://github.com/go-skynet/LocalAI

---

### 1.2 vLLM
**Status**: High-performance inference server

**Description**: Fast LLM inference engine with OpenAI-compatible API.

**Pros**:
- ✅ Very fast inference (PagedAttention)
- ✅ OpenAI-compatible API
- ✅ Supports many models (Llama, Mistral, etc.)
- ✅ Efficient GPU utilization

**Cons**:
- ⚠️ Requires NVIDIA GPU (CUDA)
- ⚠️ More complex setup than Ollama
- ⚠️ No CPU support

**Integration Notes**:
- Can use OpenAI API compatibility layer
- Requires GPU hardware

**Installation**:
```bash
pip install vllm
python -m vllm.entrypoints.openai.api_server --model meta-llama/Llama-2-7b-chat-hf
```

---

### 1.3 llama.cpp (via llama-cpp-python)
**Status**: Lightweight CPU/GPU inference

**Description**: C++ implementation of LLaMA with Python bindings.

**Pros**:
- ✅ Very efficient CPU inference
- ✅ Low memory usage
- ✅ Supports GPU acceleration
- ✅ Can be wrapped with OpenAI-compatible API

**Cons**:
- ⚠️ Requires wrapper for OpenAI API compatibility
- ⚠️ Limited model support (GGUF format)

**Integration Notes**:
- Would need LocalAI or custom wrapper for OpenAI API compatibility
- Good for resource-constrained systems

---

### 1.4 Text Generation Inference (TGI)
**Status**: Hugging Face inference server

**Description**: Production-ready inference server for LLMs.

**Pros**:
- ✅ OpenAI-compatible API
- ✅ Supports many Hugging Face models
- ✅ Optimized for production
- ✅ Docker support

**Cons**:
- ⚠️ Requires more setup
- ⚠️ Primarily GPU-focused

**GitHub**: https://github.com/huggingface/text-generation-inference

---

### 1.5 LM Studio
**Status**: User-friendly local LLM server

**Description**: Desktop application with built-in OpenAI-compatible API server.

**Pros**:
- ✅ Very easy to use (GUI)
- ✅ OpenAI-compatible API
- ✅ Model management UI
- ✅ Cross-platform

**Cons**:
- ⚠️ Primarily desktop application
- ⚠️ Less suitable for headless servers
- ⚠️ Commercial licensing for some features

**Integration Notes**:
- Can enable API server in settings
- Compatible with OpenAI API calls

---

## 2. Transcription Alternatives

### 2.1 Vosk ⭐ **RECOMMENDED for lightweight**
**Status**: Offline speech recognition

**Description**: Offline speech recognition toolkit with multiple language models.

**Pros**:
- ✅ Completely offline
- ✅ Very fast inference
- ✅ Low resource usage
- ✅ Multiple language support
- ✅ Real-time streaming support
- ✅ Python API

**Cons**:
- ⚠️ Accuracy may be lower than Whisper for noisy audio
- ⚠️ Smaller vocabulary than Whisper

**Integration Notes**:
- Would need wrapper script similar to `transcribe.py`
- API: `from vosk import Model, KaldiRecognizer`
- Can process audio streams in real-time

**Installation**:
```bash
pip install vosk
# Download model from https://alphacephei.com/vosk/models
```

**Python Example**:
```python
import json
from vosk import Model, KaldiRecognizer
import wave

model = Model("model")
rec = KaldiRecognizer(model, 16000)
# Process audio...
```

**Website**: https://alphacephei.com/vosk/

---

### 2.2 Wav2Vec2 (Facebook)
**Status**: Transformer-based ASR

**Description**: Facebook's transformer-based speech recognition model.

**Pros**:
- ✅ Good accuracy
- ✅ Supports fine-tuning
- ✅ Multiple languages
- ✅ Hugging Face integration

**Cons**:
- ⚠️ Requires more setup
- ⚠️ Slower than Vosk
- ⚠️ More resource-intensive

**Integration Notes**:
- Available via Hugging Face Transformers
- Would need custom wrapper

**Installation**:
```bash
pip install transformers torch
```

---

### 2.3 DeepSpeech (Mozilla)
**Status**: Open-source STT engine

**Description**: Mozilla's open-source speech-to-text engine.

**Pros**:
- ✅ Completely open-source
- ✅ Good for English
- ✅ Real-time capable
- ✅ Python bindings

**Cons**:
- ⚠️ Limited language support
- ⚠️ Project maintenance status unclear
- ⚠️ May have accuracy issues with radio audio

**Integration Notes**:
- Would need wrapper script
- API: `import deepspeech`

**GitHub**: https://github.com/mozilla/DeepSpeech

---

### 2.4 SpeechT5 (Microsoft)
**Status**: Multi-task speech model

**Description**: Microsoft's multi-task speech model (TTS and STT).

**Pros**:
- ✅ Good accuracy
- ✅ Modern architecture
- ✅ Hugging Face support

**Cons**:
- ⚠️ More complex setup
- ⚠️ Primarily research-focused

---

### 2.5 AssemblyAI API
**Status**: Cloud transcription service

**Description**: Commercial transcription API with high accuracy.

**Pros**:
- ✅ Very high accuracy
- ✅ Real-time streaming
- ✅ Speaker diarization
- ✅ Easy API integration

**Cons**:
- ⚠️ Requires internet
- ⚠️ Paid service (free tier available)
- ⚠️ Privacy concerns (cloud-based)

**Integration Notes**:
- REST API compatible
- Would need to add API key to `.env`
- Good for users who prefer cloud solutions

**Website**: https://www.assemblyai.com/

---

### 2.6 Deepgram API
**Status**: Cloud transcription service

**Description**: Commercial transcription API with real-time capabilities.

**Pros**:
- ✅ Very fast
- ✅ Real-time streaming
- ✅ Good accuracy
- ✅ Easy integration

**Cons**:
- ⚠️ Cloud-based (requires internet)
- ⚠️ Paid service
- ⚠️ Privacy concerns

**Integration Notes**:
- REST API compatible
- Similar to AssemblyAI

**Website**: https://deepgram.com/

---

### 2.7 Coqui STT
**Status**: Open-source STT

**Description**: Coqui's open-source speech-to-text toolkit.

**Pros**:
- ✅ Open-source
- ✅ Good accuracy
- ✅ Multiple languages
- ✅ Python API

**Cons**:
- ⚠️ Project status unclear (Coqui merged with Hugging Face)
- ⚠️ May need migration to Hugging Face

**Integration Notes**:
- Would need wrapper script
- API similar to DeepSpeech

---

## 3. Radio Receiving Alternatives

### 3.1 Unitrunker ⭐ **RECOMMENDED for Windows**
**Status**: Trunking decoder for Windows

**Description**: Windows-based trunking decoder with extensive system support.

**Pros**:
- ✅ Extensive system support (P25, DMR, NXDN, etc.)
- ✅ Good Windows integration
- ✅ Active development
- ✅ Can export audio files

**Cons**:
- ⚠️ Windows-only
- ⚠️ No built-in HTTP upload (would need custom script)
- ⚠️ GUI-based (less automation-friendly)

**Integration Notes**:
- Would need custom script to monitor output directory
- Can export audio files that could be uploaded via API
- Not a direct drop-in (requires wrapper)

**Website**: http://www.unitrunker.com/

---

### 3.2 DSDPlus Fastlane
**Status**: Digital decoder (commercial)

**Description**: Commercial digital voice decoder for various protocols.

**Pros**:
- ✅ Excellent decoding quality
- ✅ Supports many protocols
- ✅ Active development
- ✅ Good documentation

**Cons**:
- ⚠️ Commercial license required
- ⚠️ Windows-only
- ⚠️ No built-in HTTP upload
- ⚠️ Requires wrapper for integration

**Integration Notes**:
- Would need file monitoring script
- Commercial licensing may conflict with project goals

**Website**: https://www.dsdplus.com/

---

### 3.3 GQRX + Custom Scripts
**Status**: SDR receiver with manual integration

**Description**: Open-source SDR receiver with Qt GUI.

**Pros**:
- ✅ Cross-platform
- ✅ Good for manual monitoring
- ✅ Supports many SDRs

**Cons**:
- ⚠️ Primarily GUI tool
- ⚠️ No trunking support
- ⚠️ Would need significant custom development

**Integration Notes**:
- Not suitable as direct replacement
- Would require extensive custom development

---

### 3.4 SDR++ with Plugins
**Status**: Modern SDR software

**Description**: Cross-platform SDR software with plugin support.

**Pros**:
- ✅ Modern interface
- ✅ Cross-platform
- ✅ Plugin architecture
- ✅ Active development

**Cons**:
- ⚠️ Limited trunking support
- ⚠️ Would need custom plugins for integration
- ⚠️ Primarily for manual use

**Integration Notes**:
- Would require custom plugin development
- Not a direct drop-in replacement

**GitHub**: https://github.com/AlexandreRouma/SDRPlusPlus

---

### 3.5 OP25 (already supported)
**Status**: Already integrated

**Description**: Command-line P25 decoder.

**Pros**:
- ✅ Already supported in project
- ✅ Good P25 decoding
- ✅ Can output audio files

**Cons**:
- ⚠️ P25-only
- ⚠️ Requires manual configuration
- ⚠️ Command-line only

**Integration Notes**:
- Already has integration path
- Can be enhanced with better automation

---

### 3.6 SDRTrunk (already supported)
**Status**: Already integrated

**Description**: Java-based trunking decoder.

**Pros**:
- ✅ Already supported
- ✅ Good GUI
- ✅ Multiple system support
- ✅ HTTP upload capability

**Cons**:
- ⚠️ Java dependency
- ⚠️ Resource-intensive

**Integration Notes**:
- Already integrated via HTTP upload endpoint
- Working solution

---

### 3.7 TrunkRecorder (already supported)
**Status**: Already integrated

**Description**: C++ trunking recorder with HTTP upload.

**Pros**:
- ✅ Already supported
- ✅ HTTP upload built-in
- ✅ Good performance
- ✅ Docker support

**Cons**:
- ⚠️ GPL-3.0 license (compatibility consideration)
- ⚠️ Requires compilation or Docker

**Integration Notes**:
- Primary integration method
- Already working

---

## Integration Priority Recommendations

### High Priority (Easy Drop-in)
1. **LocalAI** for LLM - Direct OpenAI API replacement
2. **Vosk** for transcription - Lightweight, offline alternative
3. **Keep existing** radio software (TrunkRecorder/SDRTrunk) - Already working

### Medium Priority (Moderate Effort)
1. **vLLM** for LLM - If GPU available and need speed
2. **AssemblyAI/Deepgram** for transcription - If cloud is acceptable
3. **Unitrunker** for radio - If Windows-only and need more protocol support

### Low Priority (Significant Development)
1. **Custom wrappers** for llama.cpp, Wav2Vec2
2. **File monitoring scripts** for Unitrunker/DSDPlus
3. **Plugin development** for SDR++

---

## Implementation Notes

### Adding LocalAI Support
1. Add `LOCALAI_URL` environment variable
2. Modify `geocoding.js` and `bot.js` to support LocalAI endpoint
3. Update installer to detect LocalAI service
4. Add LocalAI to Docker Compose builder

### Adding Vosk Support
1. Create `transcribe_vosk.py` wrapper
2. Add `TRANSCRIPTION_MODE=vosk` option
3. Update `bot.js` to support Vosk mode
4. Add Vosk model download to installer

### Adding Unitrunker Support
1. Create file watcher script for Unitrunker output directory
2. Add HTTP upload wrapper for Unitrunker files
3. Update installer to configure Unitrunker path
4. Add to service detection

---

## License Compatibility

### Current Project License
- Check project license (appears to be MIT based on package.json)

### Compatibility Notes
- **TrunkRecorder**: GPL-3.0 - May require license notice (already handled)
- **Most alternatives**: Compatible with MIT
- **Commercial options** (DSDPlus, AssemblyAI, Deepgram): Require separate licensing

---

## Performance Comparison

### LLM Inference Speed (approximate)
- **Ollama**: Medium (good balance)
- **LocalAI**: Medium-Fast (depends on backend)
- **vLLM**: Very Fast (GPU required)
- **llama.cpp**: Fast (CPU), Very Fast (GPU)

### Transcription Accuracy (radio audio)
- **Whisper**: Excellent
- **Vosk**: Good (may struggle with noisy audio)
- **Wav2Vec2**: Good
- **DeepSpeech**: Fair (English only)
- **AssemblyAI/Deepgram**: Excellent (cloud)

### Transcription Speed
- **faster-whisper**: Fast (GPU), Medium (CPU)
- **Vosk**: Very Fast
- **Wav2Vec2**: Medium
- **DeepSpeech**: Fast
- **Cloud APIs**: Very Fast (network dependent)

---

## Conclusion

### Recommended Drop-in Replacements

1. **LLM**: **LocalAI** - Best balance of compatibility and features
2. **Transcription**: **Vosk** - Best for lightweight/offline, **AssemblyAI** for cloud
3. **Radio**: **Keep existing** (TrunkRecorder/SDRTrunk) - Already well-integrated

### Next Steps
1. Test LocalAI integration with existing OpenAI API calls
2. Create Vosk transcription wrapper
3. Document integration process for each alternative
4. Update installer to support new options

---

*Last Updated: 2025-01-27*
*Research conducted for Scanner-Map project*

