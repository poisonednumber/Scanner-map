# Scanner Map Release Notes

## Version 3.1.0 - Stable Release

**Release Date:** December 2024

### 🎉 What's New

This release introduces a **complete web-based configuration interface**, making Scanner Map easier to set up and configure than ever before. All configuration that previously required command-line interaction is now available through an intuitive web interface.

### ✨ Major Features

#### Quick Start Web UI
- **Centralized Configuration Hub** - Configure everything from your browser
- **Interactive Location Setup** - Map-based location selection with 50-mile radius visualization
- **System Status Dashboard** - Check Docker, Node.js, and Python installation status
- **One-Click Dependency Installation** - Install missing dependencies directly from the web UI
- **Update Management** - Check for and install updates from the web interface
- **GPU Configuration** - Enable/disable Docker GPU support with automatic NVIDIA toolkit installation
- **Auto-Start Setup** - Configure system services for automatic startup

#### Radio Software Configuration
- **Talkgroup & Frequency Management** - Add, edit, and delete talkgroups and frequencies via web UI
- **CSV Import System** - Import RadioReference CSV files with drag-and-drop
- **Radio Software Auto-Configuration** - Automatic detection and configuration for:
  - TrunkRecorder
  - SDRTrunk
  - rdio-scanner
  - OP25
- **Natural Language Configuration** - Use AI-powered commands to configure the system

#### Performance & Mobile Optimization
- **Modular Code Architecture** - Improved code organization and maintainability
- **Map Marker Clustering** - Better performance with many markers
- **Audio Playback Queue** - Smooth audio playback without interruption
- **Progressive Web App (PWA)** - Install Scanner Map as a native app
- **Mobile-Optimized Interface** - Touch gestures, responsive design, and mobile-friendly controls

### 🔧 Improvements

- **Enhanced Error Messages** - Clear, actionable error messages with remediation steps
- **Better Startup Reliability** - Improved environment variable validation and error handling
- **Cross-Platform SDR Detection** - Automatic detection of RTL-SDR, HackRF, BladeRF, Airspy, and SoapySDR devices
- **Simplified Installer** - Reduced from 9-11 steps to 5-6 core steps
- **60+ New API Endpoints** - Complete REST API for all configuration options

### 🐛 Bug Fixes

- Fixed web UI failing to load after installation
- Fixed environment variable validation issues
- Fixed geocoding provider detection (case-insensitive)
- Fixed port validation and error handling
- Fixed TrunkRecorder config format v2 compatibility
- Fixed Docker compose command handling
- Fixed installer hanging during Docker builds

### 📚 Documentation

- Complete documentation restructure in `docs/` folder
- Installation guides for Windows, Linux, and macOS
- Configuration reference for all `.env` settings
- Radio software integration guides
- Troubleshooting guide

### 🚀 Getting Started

1. **Download** the latest release from GitHub
2. **Run the installer** (`install.bat` on Windows, `install.sh` on Linux/macOS)
3. **Follow the prompts** - The installer will guide you through basic setup
4. **Open the web UI** - Access `http://localhost:3001` after installation
5. **Complete configuration** - Use the Quick Start interface to configure everything

### 📋 System Requirements

- **Node.js 18+** (up to Node.js 24)
- **Docker** (recommended) or local installation
- **Python 3.10+** (for local transcription mode)

### 🔄 Upgrade Notes

If you're upgrading from a previous version:

1. **Backup your `.env` file** - Your configuration will be preserved
2. **Run the installer** - It will detect your existing installation
3. **Review new settings** - Some new configuration options may be available
4. **Check the web UI** - New features are accessible from the Settings menu

### 📝 Full Changelog

See [CHANGELOG.md](CHANGELOG.md) for a complete list of all changes, including patch releases.

### 🤝 Support

- **[Discord Server](https://discord.gg/X7vej75zZy)** - Community help and discussion
- **[GitHub Issues](https://github.com/Dadud/Scanner-map/issues)** - Bug reports and feature requests

---

**Note:** This is a stable release suitable for production use. All features have been tested across Windows, Linux, and macOS platforms.

