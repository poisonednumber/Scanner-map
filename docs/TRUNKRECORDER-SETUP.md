# TrunkRecorder Setup Guide

This guide covers the complete setup and configuration of TrunkRecorder with Scanner Map.

## Configuration Structure

TrunkRecorder uses a `config.json` file in version 2 format. The installer automatically generates and maintains this configuration.

### Required Configuration Fields

#### Version
- `ver: 2` - Must be set to 2 for TrunkRecorder v2 format

#### Sources
Each source defines an SDR device:

```json
{
  "driver": "osmosdr",        // Driver type: "osmosdr" for RTL-SDR, "usrp" for USRP, etc.
  "device": "rtl=0",          // Device specification: "rtl=0" for first RTL-SDR, "rtl=1" for second, etc.
  "center": 850000000,        // Center frequency in Hz
  "rate": 2048000,            // Sample rate in Hz
  "gain": 30,                 // Gain setting (0-49 for RTL-SDR)
  "error": 0,                 // Frequency error correction in Hz
  "digitalRecorders": 4       // Number of digital recorders to use
}
```

**Common Drivers:**
- `osmosdr` - For RTL-SDR, HackRF, BladeRF, etc.
- `usrp` - For USRP devices
- `airspy` - For Airspy devices

#### Systems
Each system defines a trunked radio system to monitor:

```json
{
  "shortName": "YourSystem",           // Short identifier (required)
  "control_channels": [851.0125],      // Array of control channel frequencies in MHz
  "type": "p25",                       // System type: "p25", "smartnet", "p25p2", etc.
  "modulation": "qpsk",                // Modulation type (moved to System in v2)
  "squelch": -50,                      // Squelch level in dB (moved to System in v2)
  "audioGain": 1.0                     // Audio gain multiplier (moved to System in v2)
}
```

#### Upload Server
Configuration for uploading recordings to Scanner Map:

```json
{
  "type": "rdio-scanner",
  "url": "http://scanner-map:3306/api/call-upload",
  "apiKey": "YOUR_API_KEY_HERE"
}
```

## Docker Setup

### Volume Mounts

The TrunkRecorder Docker container requires the following volume mounts:

1. **Config Directory**: `./appdata/trunk-recorder/config:/config`
   - Contains `config.json` configuration file
   - TrunkRecorder looks for config at `/config/config.json`

2. **Config File (Alternative)**: `./appdata/trunk-recorder/config/config.json:/app/config.json`
   - Some TrunkRecorder images expect config at `/app/config.json`
   - Both mounts are provided for compatibility

3. **Recordings Directory**: `./appdata/trunk-recorder/recordings:/recordings`
   - Stores recorded audio files
   - Persists across container restarts

### Required Permissions

- **Privileged Mode**: TrunkRecorder requires `privileged: true` to access USB devices
- **USB Device Access**: `/dev/bus/usb:/dev/bus/usb` must be mounted for RTL-SDR access

### Docker Compose Example

```yaml
trunk-recorder:
  image: robotastic/trunk-recorder:latest
  container_name: trunk-recorder
  restart: unless-stopped
  privileged: true
  devices:
    - /dev/bus/usb:/dev/bus/usb
  volumes:
    - ./appdata/trunk-recorder/config:/config
    - ./appdata/trunk-recorder/config/config.json:/app/config.json
    - ./appdata/trunk-recorder/recordings:/recordings
  environment:
    - TZ=America/New_York
  networks:
    - scanner-network
```

## Directory Structure

The installer automatically creates the following directory structure:

```
appdata/
└── trunk-recorder/
    ├── config/
    │   └── config.json          # Main configuration file
    └── recordings/              # Recorded audio files
```

## Auto-Configuration

The Scanner Map installer automatically:

1. **Generates API Key**: Creates a unique API key for TrunkRecorder
2. **Creates Config File**: Generates `config.json` with proper v2 format
3. **Configures Upload Server**: Sets up upload URL and API key
4. **Creates Directories**: Ensures all required directories exist
5. **Migrates Existing Configs**: Automatically upgrades old configs to v2 format

## Manual Configuration

If you need to manually edit the configuration:

1. Edit `appdata/trunk-recorder/config/config.json`
2. Update your system frequencies, control channels, and other settings
3. Restart the TrunkRecorder container: `docker restart trunk-recorder`

## Troubleshooting

### Config File Not Found
- **Error**: `Failed parsing Config: /app/config.json: cannot open file`
- **Solution**: Ensure the config file exists at `appdata/trunk-recorder/config/config.json`
- The installer should create this automatically

### Type Error
- **Error**: `type must be string, but is object`
- **Solution**: Ensure `ver: 2` is set and all fields use correct types
- Run the installer again to regenerate the config

### USB Device Not Found
- **Error**: RTL-SDR device not detected
- **Solution**: 
  - Ensure USB device is connected
  - Check `lsusb` (Linux) to verify device is detected
  - Verify `/dev/bus/usb` is mounted in Docker

### Container Won't Start
- **Check Logs**: `docker logs trunk-recorder`
- **Verify Config**: Ensure `config.json` is valid JSON
- **Check Permissions**: Ensure directories are writable

## Configuration Migration

The installer automatically migrates old configs to v2 format:

- Converts `sources[].type` → `sources[].driver`
- Converts RTL-SDR `type: 'rtl_sdr'` → `driver: 'osmosdr'` with `device: 'rtl=0'`
- Adds missing fields: `gain`, `error`, `digitalRecorders`
- Adds `shortName` to systems if missing
- Adds `modulation`, `squelch`, `audioGain` to systems

## Next Steps

After configuration:

1. **Pull Docker Image**: `docker pull robotastic/trunk-recorder:latest`
2. **Start Container**: `docker-compose up -d trunk-recorder`
3. **Check Logs**: `docker logs -f trunk-recorder`
4. **Verify Uploads**: Check Scanner Map web interface for incoming calls

## Additional Resources

- [TrunkRecorder Documentation](https://trunkrecorder.com/docs/CONFIGURE)
- [TrunkRecorder GitHub](https://github.com/TrunkRecorder/trunk-recorder)
- [RTL-SDR Setup Guide](https://www.rtl-sdr.com/)

