# Changelog

All notable changes to Scanner Map will be documented in this file.

## [3.1.0] - 2024-12-19

### Major Release: Quick Start Web UI & Complete Refactor

This release represents a major overhaul, moving configuration from the command-line installer to a comprehensive web-based Quick Start interface, along with significant performance improvements, code modularization, and mobile optimization.

### Fixed

#### Web UI Startup & Reliability
- **Enhanced Environment Variable Validation** - Now properly detects and validates missing/empty environment variables with clear error messages
- **Improved Geocoding Provider Detection** - Case-insensitive validation, handles whitespace, supports all provider variations
- **Port Validation** - Validates port numbers are numeric and within valid range (1-65535)
- **Child Process Monitoring** - Properly detects webserver startup failures with detailed error reporting
- **Error Messages** - Clear, actionable error messages with remediation steps for common issues
- **Server Startup Error Handling** - Better handling of port binding errors (EADDRINUSE, EACCES) with platform-specific guidance
- **Debug Mode** - Added `DEBUG_WEBSERVER=true` flag for verbose environment variable logging

#### SDR Device Support
- **Multi-Device Detection** - Auto-detection for RTL-SDR, HackRF, BladeRF, Airspy, and SoapySDR-based devices
- **Cross-Platform SDR Detection** - Works on Windows (PowerShell/WMI), Linux (lsusb/rtl_test), and macOS (system_profiler)
- **Auto-Configuration** - TrunkRecorder config automatically uses detected SDR device with correct driver settings
- **Device Migration** - Improved migration from v1 to v2 config format preserving device configurations

#### Configuration Improvements
- **Environment Variable Loading** - Explicit path handling for .env file, works correctly in Docker and local environments
- **Graceful Degradation** - Application continues to function even if webserver fails to start (with proper warnings)
- **Better Logging** - Consistent `[Webserver]` prefixed messages, success indicators, startup status with accessible URLs

### Added

#### Quick Start Web UI - Core Features
- **Quick Start Modal** - Centralized configuration hub accessible from Settings menu
- **Location Configuration**
  - Interactive map with 50-mile radius visualization
  - Browser geolocation API integration
  - Location search with autocomplete suggestions
  - Manual entry with city/state/country/counties
  - Real-time map updates
- **System Status Dashboard**
  - Docker, Node.js, and Python installation status
  - System information (OS, versions, architecture)
  - One-click dependency installation with progress tracking
  - Real-time installation logs
- **Update Management**
  - Check for updates from web UI
  - Install updates with progress tracking
  - Auto-update configuration toggle
  - Version comparison display
- **GPU Configuration**
  - GPU detection and status display
  - Enable/disable Docker GPU support
  - NVIDIA Container Toolkit installation (Linux)
  - GPU test functionality
- **Auto-Start Configuration**
  - Platform-specific auto-start setup (Windows/Linux/macOS)
  - Enable/disable system service
  - Installation instructions per platform

#### Quick Start Web UI - Advanced Features
- **Radio Configuration**
  - Talkgroup management (add/edit/delete)
  - Frequency management (add/edit/delete)
  - Table-based display with search and filtering
  - Form validation and error handling
- **CSV Import System**
  - RadioReference CSV import for talkgroups and frequencies
  - Drag-and-drop file upload
  - CSV preview with validation
  - Merge/update options
  - Import progress tracking
  - Error reporting for invalid rows
- **Radio Software Auto-Configuration**
  - Automatic detection of TrunkRecorder, SDRTrunk, OP25, rdio-scanner
  - TrunkRecorder config.json auto-generation from database
  - Config preview before saving
  - Support for Docker and local installations
  - v2 format compatibility
- **Natural Language Configuration (NLP)**
  - AI-powered command parsing using configured provider (Ollama/OpenAI)
  - Text and voice input support
  - Command history and examples
  - Intent extraction and parameter parsing
  - Structured JSON response format
  - Voice input using Web Speech API

#### Web UI Performance & Modularization
- **Modular Code Architecture**
  - Extracted `public/map.js` - Map initialization and marker management
  - Extracted `public/audio.js` - WaveSurfer and audio playback
  - Extracted `public/modals.js` - Modal management
  - Extracted `public/api.js` - Centralized API calls with caching
  - Extracted `public/ui.js` - UI rendering and updates
  - Extracted `public/utils.js` - Pure utility functions
  - Extracted `public/memory.js` - Memory management and cleanup
  - Extracted `public/errors.js` - Error handling
  - Extracted `public/toast.js` - Toast notifications
  - Extracted `public/gestures.js` - Touch gesture handling
- **Performance Optimizations**
  - Map marker clustering for better rendering
  - Audio instance reuse and cleanup
  - Audio playback queue system
  - Request batching and API response caching
  - Memory management with automatic cleanup
  - Optimized map tile loading for slow networks
- **Tone Detection Integration**
  - API endpoint for two-tone pager detection
  - Integration with audio playback
  - Skip/cut tone options

#### Web UI Polish & Mobile Optimization
- **Smooth Transitions & Animations**
  - CSS transitions for modals and buttons
  - Loading animations and skeleton loaders
  - Smooth marker animations on map
- **Improved Loading States**
  - Skeleton loaders for call lists
  - Loading spinners for all async operations
  - Progress indicators for long-running tasks
- **Enhanced Error Messages**
  - User-friendly error messages with actionable steps
  - Consistent error styling
  - Detailed error information for debugging
- **Responsive Design**
  - Media queries for mobile devices
  - Responsive modals and layouts
  - Touch-optimized controls (minimum 44x44px)
  - Stack vertically on small screens
- **Accessibility Improvements**
  - ARIA labels on interactive elements
  - Keyboard navigation (Tab/Enter/Escape)
  - Focus management
  - Screen reader support
- **Toast Notification System**
  - Success, error, and info notifications
  - Auto-dismiss with manual dismissal option
  - Non-intrusive positioning
- **Progressive Web App (PWA)**
  - Web App Manifest (`manifest.json`)
  - Service Worker for offline support (`sw.js`)
  - PWA install prompt
  - Caching of static assets and map tiles
  - Offline fallback handling
- **Mobile-Optimized Features**
  - Mobile-responsive layout overhaul
  - Bottom sheet modals for mobile
  - Mobile-friendly audio controls
  - FAB (Floating Action Button) for AI commands
  - Full-screen AI command interface on mobile
  - Large voice input button (60x60px)
  - Swipe gestures for navigation (left/right/up/down)
  - Long press for context menus
  - Touch feedback with ripple effects
  - Haptic feedback support
  - Optimized map for mobile (lower tile quality on slow networks)

#### Installer Improvements
- **Installer Restart Prompt**
  - Added "Press Enter to restart" prompt after npm dependency installation
  - Allows installer to restart cleanly after PATH updates
  - Works on both Windows (`install.bat`) and Linux/macOS (`install.sh`)
- **npm Dependency Overrides**
  - Added overrides for `rimraf@^5.0.0` and `glob@^10.0.0` to reduce deprecation warnings
  - Helps force newer versions of transitive dependencies

### Changed

#### Installer Streamlining
- **Reduced Installer Steps** - From 9-11 steps down to 5-6 core steps
- **Removed from Installer** (moved to web UI):
  - Update checking
  - Dependency installation (Docker, Node.js, Python)
  - GPU configuration
  - Location configuration
  - Optional dependencies configuration
  - Post-installation options
- **Frictionless Installer Flow**
  - "Start services now?" now defaults to `false` (was `true`)
  - Installation verification now defaults to `false` (optional)
  - Clearer guidance about using web UI for configuration
  - Better progress feedback with real-time Docker output
  - Prerequisites check now only warns (doesn't install)
- **Simplified Configuration**
  - Installer focuses on core setup only (installation method, path, services, integrations)
  - Advanced configuration (network, storage, auth) remains in installer
  - All runtime configuration moved to web UI

#### API Endpoints (60+ new endpoints)
- **Location API**: `/api/location/config`, `/api/location/suggestions`, `/api/location/detect`
- **System API**: `/api/system/status`, `/api/system/info`, `/api/system/install-*`, `/api/system/install-status/:jobId`
- **Updates API**: `/api/updates/check`, `/api/updates/install`, `/api/updates/config`
- **GPU API**: `/api/system/gpu-status`, `/api/system/configure-gpu`, `/api/system/install-nvidia-toolkit`
- **Auto-Start API**: `/api/system/autostart-status`, `/api/system/configure-autostart`
- **Radio API**: `/api/radio/talkgroups`, `/api/radio/frequencies`, `/api/radio/import-csv`, `/api/radio/import-preview`, `/api/radio/detect-software`, `/api/radio/configure-trunkrecorder`
- **AI API**: `/api/ai/command`, `/api/ai/command-examples`
- **Audio API**: `/api/audio/detect-tones`

#### Dependency Updates
- `fs-extra`: `^11.2.0` → `^11.3.3`
- `moment-timezone`: `^0.5.45` → `^0.6.0`
- `@discordjs/opus`: `^0.9.0` → `^0.10.0`
- `@discordjs/voice`: `^0.16.0` → `^0.18.0`
- Node.js v24 support (updated engine constraints from `<24.0.0` to `<25.0.0`)

#### Code Optimizations
- Migrated `bot.js` and `webserver.js` to use `fs-extra` instead of native `fs`
- Replaced `fs.existsSync` + `fs.mkdirSync` with `fs.ensureDirSync` (5 locations)
- Replaced manual `JSON.parse(fs.readFileSync())` with `fs.readJSONSync` (5 locations)
- Cached timezone formatter functions in logger configurations (bot.js, geocoding.js)
- Parallel directory operations using `Promise.all` in service-config.js
- Batched API requests with caching to reduce server load
- Optimized map rendering with marker clustering
- Audio instance reuse and cleanup

#### Service Configuration
- Enhanced `service-config.js` with radio software detection
- Added `detectRadioSoftware()` method
- Added `configureTrunkRecorderFromDb()` method for auto-configuration
- Improved Docker compose command handling (`docker compose` vs `docker-compose`)

### Fixed
- **Installer Hanging Issue**
  - Fixed Docker compose commands hanging silently during image builds
  - Changed from `execSync` with hidden output to `spawn` with real-time output
  - Users now see Docker build progress instead of apparent freezes
- **Dependency Conflict**
  - Fixed `opusscript` peer dependency conflict with `prism-media`
  - Reverted `opusscript` to `^0.0.8` for compatibility (it's an optional dependency)
- **npm Installer Warnings**
  - Removed deprecated `--ignore-optional` flag from npm install commands
  - Updated `@discordjs/voice` to `^0.18.0` (fixes deprecated encryption warning)
  - Reduced npm deprecation warnings during installation
- **Docker Compose Command Handling**
  - Fixed detection of `docker compose` vs `docker-compose` commands
  - Proper handling of both syntaxes across platforms

### Enhanced
- **Performance Improvements**
  - More efficient directory creation using atomic `fs.ensureDirSync`
  - Cleaner JSON file handling with `fs.readJSONSync`
  - Cached timezone formatters reduce overhead on high-frequency logging
  - Parallel directory operations for faster initialization
  - Map marker clustering for better performance with many markers
  - Audio playback queue prevents interruption
  - API response caching reduces server load
- **Code Quality**
  - Modular architecture improves maintainability
  - More consistent codebase using fs-extra patterns
  - Better error handling throughout
  - JSDoc comments added to utility functions
  - Consistent code style across modules
- **User Experience**
  - All configuration now accessible from web UI
  - Real-time feedback for all operations
  - Better error messages with actionable steps
  - Mobile-optimized interface
  - PWA support for app-like experience
  - Touch-optimized controls
  - Swipe gestures for mobile navigation

### Documentation
- Added `OPTIMIZATION_OPPORTUNITIES.md` - Detailed optimization guide
- Added `OPTIMIZATIONS_COMPLETED.md` - Summary of implemented optimizations
- Updated `DEPENDENCY_WARNINGS.md` - Explanation of npm deprecation warnings

### Technical Details
- **Async Job Execution**: Implemented async job system for long-running operations (dependency installation) with progress tracking
- **File Upload**: Enhanced multipart/form-data handling with Busboy for CSV imports
- **CSV Parsing**: Robust CSV parser with validation and error reporting
- **Map Integration**: Leaflet.js with marker clustering plugin
- **Audio Playback**: WaveSurfer.js with instance management and queue system
- **Service Worker**: Basic caching strategy for offline support
- **Web Speech API**: Voice input integration for NLP commands

---

## [3.0.11] - 2024-12-20

### Installer Parity and Verification

### Fixed
- **Linux Installer Parity**
  - Added missing `--ignore-optional` flag to npm install commands in Linux installer
  - Added Node.js v23+ warning to Linux installer (matches Windows)
  - Added Node.js v23+ mention in error troubleshooting messages
  - Ensured all npm install commands use identical flags across both platforms

### Enhanced
- **Installer Consistency**
  - Both Windows and Linux installers now have identical functionality
  - All prerequisite checks, dependency installation, and error handling are equivalent
  - Added comments explaining npm install flags in Linux installer

### Added
- **Installer Comparison Documentation**
  - Created `INSTALLER_COMPARISON.md` documenting feature parity between installers
  - Verification checklist for all installer features

---

## [3.0.10] - 2024-12-20

### TrunkRecorder Configuration Fix

### Fixed
- **TrunkRecorder Config Format v2**
  - Fixed TrunkRecorder Docker container not starting due to missing `"ver": 2` field
  - Updated config structure to comply with TrunkRecorder v2 format requirements
  - Moved `modulation`, `squelch`, and `audioGain` from Source to System (v2 requirement)
  - Added automatic migration logic to upgrade existing configs to v2 format
  - Updated example config file to v2 format

### Changed
- **TrunkRecorder Config Generation**
  - All new configs now include `"ver": 2` at the top
  - System objects now include `modulation: 'qpsk'`, `squelch: -50`, and `audioGain: 1.0` by default
  - Existing configs are automatically migrated to v2 format when updated
  - Config validation ensures v2 format compliance

---

## [3.0.9] - 2024-12-20

### Installer Logging and Comprehensive Testing

### Added
- **Installer Logging System**
  - Complete logging of all installer activities to `logs/installer-YYYY-MM-DD-TIMESTAMP.log`
  - Automatic capture of console output (log, error, warn) while preserving display
  - Sanitization of sensitive data (API keys, tokens, passwords) in logs
  - Timestamp tracking and installation duration measurement
  - Log file path displayed at end of installation
  - Error details logged for troubleshooting

- **Comprehensive Configuration Testing**
  - New test suite (`scripts/test-installer-configs.js`) to validate all configuration combinations
  - Tests 10+ different configuration scenarios covering:
    - Docker and Local installations
    - All transcription modes (local, remote, openai, icad, icad-remote)
    - All AI providers (openai, ollama, ollama-remote, none)
    - All radio software options (trunk-recorder, sdrtrunk, rdio-scanner, op25, none)
    - Advanced configurations (S3 storage, custom ports, authentication)
  - Validates .env file generation, docker-compose.yml generation, and service config files
  - Configuration consistency validation
  - Test results saved to JSON for analysis
  - Run with `npm run test-installer`

### Fixed
- **RADIO_SOFTWARE Environment Variable**
  - Fixed issue where `RADIO_SOFTWARE` was not being written to `.env` file
  - Now correctly included in generated environment files

- **Variable Shadowing Bug**
  - Fixed "Cannot access 'path' before initialization" error in service-config.js
  - Renamed local variable to avoid shadowing imported `path` module

### Enhanced
- **Installer Error Handling**
  - Improved error logging with context
  - Log file path displayed on errors for easier troubleshooting
  - Better error messages with stack traces in logs

### Changed
- **Installer Flow**
  - All installer steps now logged with timestamps
  - Configuration logged (with sensitive data redacted) before installation
  - Installation results logged with success/failure status

---

## [3.0.8] - 2024-12-20

### Installer Fixes and Improvements

### Fixed
- **Radio Software Display Issue**
  - Fixed "Radio Software: undefined" showing in installer summary
  - Added proper merging of `radioSoftware` and related flags from integration config
  - Added safety checks to prevent undefined values in display
- **Ollama/iCAD Remote Detection**
  - Fixed health checks incorrectly showing Ollama/iCAD as remote when Docker is selected
  - Improved logic to distinguish local Docker containers from remote URLs
  - Fixed summary display to correctly show "(auto)" for local Docker vs "(remote)" for remote services
- **TrunkRecorder Health Check**
  - Fixed health check to work with both `enableTrunkRecorder` flag and `radioSoftware` selection
  - Now properly detects TrunkRecorder when selected via radio software option
- **Model Pulling**
  - Verified and ensured Ollama model auto-pulling works when Docker Ollama is enabled
  - Model pulling condition now correctly checks `enableOllama` flag

### Enhanced
- **iCAD Model Installation Guidance**
  - Added clearer instructions for accessing iCAD web UI to install models
  - Improved messaging about model installation process
- **Health Check Logic**
  - Refined Ollama and iCAD health check conditions for better accuracy
  - Improved detection of local vs remote service configurations

### Changed
- **Installer Configuration Flow**
  - Radio software selection now properly flows through entire installation process
  - All enable flags correctly set based on user selections
  - Config object construction improved for better consistency

---

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

