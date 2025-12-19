# Changelog

All notable changes to Scanner Map will be documented in this file.

## [3.0.7] - 2024-12-20

### Radio Software Alternatives with Complete Auto-Configuration

### Added
- **Auto-Restart After Node.js Installation**
  - Installer automatically detects when Node.js/npm was just installed
  - Prompts user to restart installer automatically when PATH needs updating
  - Optional installer update from repository before restarting
  - Graceful fallback to manual restart instructions if auto-restart fails
- **Enhanced npm Detection**
  - Better detection of npm availability before attempting installation
  - Clear error messages when npm is not found in PATH
  - Automatic detection of PATH-related issues after Node.js installation
- **Radio Software Selection in Installer**
  - New installer step to select radio recording software
  - Options: TrunkRecorder, SDRTrunk, rdio-scanner, OP25, or None
  - All options fully auto-configured with API keys and URLs
- **SDRTrunk Support**
  - Auto-generates streaming configuration file
  - Config file: `appdata/sdrtrunk/config/streaming-config.json`
  - Ready to import into SDRTrunk desktop app
  - API key and upload URL pre-configured
- **rdio-scanner Support**
  - Docker container support (if image available)
  - Auto-generates downstream server configuration
  - Config file: `appdata/rdio-scanner/config/config.json`
  - Web interface accessible at http://localhost:3000
- **OP25 Support**
  - Docker container support (if image available)
  - Auto-generates upload server configuration
  - Config file: `appdata/op25/config/config.json`
  - Command-line decoder integration
- **Unified API Key Management**
  - Single API key shared across all radio software options
  - Auto-generated and configured in all config files
  - Stored in `.env` as `RADIO_SOFTWARE` and `RADIO_API_KEY`
- **Enhanced Documentation**
  - Updated `docs/RADIO-SOFTWARE.md` with all alternatives
  - Auto-configuration instructions for each option
  - Docker setup instructions where applicable

### Changed
- **Installer Flow**
  - Replaced TrunkRecorder enable/disable with radio software selection
  - All radio software options now have complete auto-configuration
  - Improved user guidance and next steps for each option
- **Docker Compose Builder**
  - Added rdio-scanner and OP25 Docker service definitions
  - Updated volume mounts for all radio software options
  - Enhanced service detection and health checking
- **Service Configuration**
  - New methods: `configureSDRTrunk()`, `configureRdioScanner()`, `configureOP25()`
  - All methods handle empty/invalid config files gracefully
  - Automatic API key injection into all config files
- **Directory Structure**
  - Added `appdata/sdrtrunk/config/` for SDRTrunk configs
  - Added `appdata/rdio-scanner/config/` for rdio-scanner configs
  - Added `appdata/op25/config/` for OP25 configs
  - All directories auto-created by installer

### Fixed
- TrunkRecorder config.json creation now handles empty files
- Improved config file validation and recreation logic
- Better error handling for invalid JSON configs

---

## [3.0.6] - 2024-12-20

### Testing Release

- Version bump for testing auto-update functionality

---

## [3.0.5] - 2024-12-20

### Installer Enhancements & Docker Improvements

### Added
- **Docker Installation Status Verification Page**
  - Comprehensive status check at end of installer
  - Verifies Docker images, container status, volume mounts, and service health
  - Shows detailed summary with color-coded status indicators
  - Handles edge cases (services starting, remote services, missing components)
- **Remote Service Configuration**
  - Remote Ollama URL configuration option in installer (similar to iCAD)
  - Remote iCAD URL configuration option in installer
  - Both services can now be configured to use external/remote instances
  - Web UI configuration page for runtime service URL updates
- **Progress Display for Model Pulling**
  - Real-time progress output when pulling Ollama models
  - Shows download progress and status during model installation
- **Installer Auto-Update Check**
  - Non-blocking update check on installer startup
  - Notifies users when new installer versions are available
  - Provides download links for updates

### Changed
- **Installer Polish Pass**
  - Ensured all Docker volume mounts are properly configured for optional services
  - Improved installer messaging and user guidance
  - Better handling of remote vs local service configurations
  - Enhanced data persistence information and next steps
- **Docker Compose Builder**
  - Updated to handle remote Ollama/iCAD URLs (doesn't start local containers if remote URL provided)
  - Improved volume mount configuration for iCAD model persistence
  - Updated TrunkRecorder image reference to use pre-built image
- **Service Configuration**
  - Added API endpoints for runtime service URL configuration
  - Added Service Configuration modal in web UI
  - Improved service detection and health checking

### Fixed
- Docker containers now properly load pulled images for iCAD and Ollama
- TrunkRecorder image now starts correctly
- Volume mounts verified and properly configured for all optional services
- Remote service configuration properly prevents local container startup

---

## [3.0.2] - 2024-12-20

### Installer & Startup Script Improvements

### Added
- Transcription configuration step in interactive installer
  - Support for Local Whisper (CPU/CUDA with model selection)
  - OpenAI Whisper API configuration
  - Remote Faster-Whisper server setup
  - iCAD Transcribe integration
- Configurable geocoding location settings (city, state, country, counties)
- Node.js version check for very new versions (v23+) with compatibility warning
- Better error handling and user feedback throughout installer

### Changed
- **Reorganized installer flow** into 9 logical steps:
  1. Installation method selection
  2. System requirements check
  3. Basic settings (ports, timezone)
  4. Geocoding configuration
  5. Transcription setup (NEW)
  6. AI provider configuration
  7. Optional services (TrunkRecorder)
  8. Discord integration
  9. Review and confirm
- **Improved Windows installer (`install.bat`)**:
  - Added Git prerequisite check
  - Fixed Node.js version detection and validation
  - Added warning for Node.js v23+ compatibility
  - Improved npm dependency installation with better error handling
  - Enhanced error messages with troubleshooting tips
- **Improved Linux/macOS installer (`install.sh`)**:
  - Fixed redundant directory check logic
  - Refactored into cleaner, more maintainable functions
  - Now offers to clone repository if not found
  - Better status indicators and error messages
- **Enhanced CLI entry point (`bin/scanner-map.js`)**:
  - Removed unnecessary `shell: true` flag (security improvement)
  - Now passes through command-line arguments to installer
- **Improved interactive installer (`installer-core.js`)**:
  - Better step descriptions and user guidance
  - Enhanced summary display with grouped configuration sections
  - OpenAI API key input now masked for security
  - OpenAI model selection uses dropdown instead of free text
  - Improved error handling and user feedback messages
  - Fixed geocoding defaults (now prompts for location instead of hardcoded)

### Fixed
- Typos and awkward wording throughout all installer scripts
- Redundant directory check logic in `install.sh`
- Missing Git check in Windows installer
- Inconsistent error message formatting
- Hardcoded geocoding location (Baltimore, MD) - now user-configurable

---

## [3.0.0] - 2024-12-18

### Major Documentation Overhaul

Complete restructure of documentation and repository cleanup.

### Added
- **Modular documentation structure** in `docs/` folder:
  - `INSTALLATION.md` - Detailed setup for all platforms
  - `CONFIGURATION.md` - Complete `.env` settings reference
  - `DOCKER.md` - Docker Compose and service configuration
  - `TRANSCRIPTION.md` - Local, remote, OpenAI, iCAD modes
  - `GEOCODING.md` - Nominatim, LocationIQ, Google Maps setup
  - `DISCORD.md` - Bot creation and configuration
  - `RADIO-SOFTWARE.md` - SDRTrunk & TrunkRecorder integration
  - `TROUBLESHOOTING.md` - Common issues and solutions
- `.env.example` - Complete configuration template with all options documented
- `.cursorignore` and `.cursorrules` - Development workflow optimization
- `.dockerignore` - Optimized Docker builds
- `bin/scanner-map.js` - CLI entry point for npm global install

### Changed
- **README.md** completely rewritten as clean landing page with quick start
- Version bumped to 3.0.0

### Removed
- `INSTALLATION_METHODS.md` (merged into docs/)
- `INSTALLER_IMPROVEMENTS.md` (development notes)
- `INSTALLER_WALKTHROUGH.md` (merged into docs/)
- `SERVICE_SETUP_GUIDES.md` (merged into docs/)
- `TESTING_GUIDE.md` (development notes)
- `USB_CONFIGURATION_WINDOWS.md` (merged into docs/)
- `TRUNKRECORDER_ATTRIBUTION.md` (moved to README acknowledgments)
- `Windows installer/` folder (replaced by unified installer)
- `Linux installer/` folder (replaced by unified installer)
- `install-test/` folder (test directory)
- `Scanner-map/` folder (duplicate)
- Backup files (`*-fixed.js`)

---

## [2.9.1] - Previous Release

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

