# Changelog

All notable changes to Scanner Map will be documented in this file.

## [Unreleased] - 2024-12-XX

### Docker & Installation Improvements

### Added
- **Docker Hub Publishing Infrastructure**
  - Created `docker-compose.prod.yml` for production use with pre-built Docker Hub images
  - Added GitHub Actions workflow (`.github/workflows/docker-publish.yml`) for automated publishing
  - Created `DOCKER_HUB_PUBLISH.md` with complete publishing instructions
  - Created `README_DOCKER.md` explaining both build methods (local vs Docker Hub)
  - All optional services (Ollama, iCAD Transcribe, TrunkRecorder) already pull from Docker Hub
  - Scanner Map currently builds locally, but infrastructure ready for Docker Hub publishing
  - Auto-configuration works identically with both build methods
- Docker containerization support (Dockerfile + docker-compose.yml)
- **Unified multi-platform installer** (`install.sh` for Linux/macOS, `install.bat` for Windows)
- **Pre-configured API links** between Scanner Map and optional services
  - iCAD Transcribe: Auto-configured to use Docker service name (`http://icad-transcribe:9912`)
  - TrunkRecorder: Pre-configured `config.json` with upload URL (`http://scanner-map:3306/api/call-upload`)
- **Automated API key generation and sharing**
  - Scanner Map automatically generates API key on first boot
  - Auto-updates TrunkRecorder `config.json` with the generated key
  - Manual key generation script: `npm run generate-trunkrecorder-key`
  - Plaintext key saved to `data/trunk-recorder-api-key.txt` for reference
- **Ollama Docker integration**
  - Ollama can now be installed via Docker (optional service)
  - Auto-configured to use Docker service name (`http://ollama:11434`)
  - Persistent model storage via Docker volume
  - GPU support available (NVIDIA)
  - Installer prompts for Docker vs manual installation
- **Centralized appdata directory structure**
  - All data now organized in `./appdata/` directory
  - Structure: `appdata/scanner-map/`, `appdata/ollama/`, `appdata/icad-transcribe/`, `appdata/trunk-recorder/`
  - Easy cleanup: `rm -rf ./appdata` removes all data
  - Better organization and portability
  - Installer automatically creates all required directories
- TrunkRecorder integration in Docker setup (OPTIONAL, disabled by default)
- iCAD Transcribe integration in Docker setup (OPTIONAL, can be enabled via installer)
- package.json for proper Node.js dependency management
- requirements.txt for Python dependency management
- CHANGELOG.md for tracking all changes
- docker-compose.README.md with Docker setup instructions
- docker-compose.with-trunk-recorder.yml example file
- docker-compose.full.yml example with all optional services
- LICENSE_NOTICE.md documenting TrunkRecorder GPL-3.0 license
- TRUNKRECORDER_ATTRIBUTION.md with proper attribution and links
- Health check endpoint for Docker health monitoring

### Changed
- Removed Ollama installation from installers (Windows and Linux)
- Ollama is no longer automatically installed during setup
- Users can still use Ollama by installing it manually and configuring it in .env

### Removed
- Ollama installation steps from `install_scanner_map.ps1`
- Ollama installation steps from `linux_install_scanner_map.sh`
- Ollama service from Docker Compose (users must run Ollama separately if needed)

### Notes
- Ollama support remains in the codebase - users can still use it by:
  1. Installing Ollama manually (https://ollama.com)
  2. Setting `AI_PROVIDER=ollama` in .env
  3. Configuring `OLLAMA_URL` and `OLLAMA_MODEL` in .env
- Docker setup defaults to OpenAI only (Ollama must be run as separate container/service)
- **TrunkRecorder is OPTIONAL and DISABLED by default** in docker-compose.yml
  - TrunkRecorder is licensed under GPL-3.0
  - Users can enable it by uncommenting the service
  - Scanner Map works without TrunkRecorder (supports SDRTrunk, rdio-scanner, etc.)
  - Official Repository: https://github.com/TrunkRecorder/trunk-recorder
  - See LICENSE_NOTICE.md for license compliance information

