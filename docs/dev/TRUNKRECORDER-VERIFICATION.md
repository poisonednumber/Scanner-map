# TrunkRecorder Configuration Verification

## ✅ Complete Setup Checklist

### Configuration File Structure
- [x] **Version Field**: `ver: 2` set correctly
- [x] **Sources Array**: Properly configured with:
  - [x] `driver: 'osmosdr'` (correct for RTL-SDR, not 'rtl_sdr' or 'type')
  - [x] `device: 'rtl=0'` (string format, not numeric)
  - [x] `center`, `rate`, `gain`, `error`, `digitalRecorders` fields present
- [x] **Systems Array**: Properly configured with:
  - [x] `shortName` field (required, not just `name` or `id`)
  - [x] `control_channels` array
  - [x] `type: 'p25'` (string)
  - [x] `modulation: 'qpsk'` (moved to System in v2)
  - [x] `squelch: -50` (moved to System in v2)
  - [x] `audioGain: 1.0` (moved to System in v2)
- [x] **Upload Server**: Properly configured with:
  - [x] `type: 'rdio-scanner'` (string)
  - [x] `url` pointing to Scanner Map API
  - [x] `apiKey` generated and set

### Directory Structure
- [x] `appdata/trunk-recorder/config/` - Created
- [x] `appdata/trunk-recorder/recordings/` - Created
- [x] `appdata/trunk-recorder/logs/` - Created (for future use)
- [x] `config.json` file created in config directory

### Docker Configuration
- [x] **Volume Mounts**:
  - [x] `./appdata/trunk-recorder/config:/config` - Main config mount
  - [x] `./appdata/trunk-recorder/config/config.json:/app/config.json` - Alternative path
  - [x] `./appdata/trunk-recorder/recordings:/recordings` - Recordings storage
- [x] **Permissions**:
  - [x] `privileged: true` - For USB device access
  - [x] `/dev/bus/usb:/dev/bus/usb` - USB device mount
- [x] **Network**: Connected to `scanner-network`
- [x] **Environment**: Timezone set

### Auto-Configuration Features
- [x] **API Key Generation**: Automatic UUID v4 generation
- [x] **Config Creation**: Automatic config.json generation
- [x] **Migration Logic**: Automatic upgrade from old formats:
  - [x] Converts `type` → `driver` in sources
  - [x] Converts RTL-SDR format (`rtl_sdr` → `osmosdr` with `rtl=0`)
  - [x] Adds missing fields (gain, error, digitalRecorders)
  - [x] Adds `shortName` to systems
  - [x] Adds v2 fields (modulation, squelch, audioGain) to systems
- [x] **Validation**: Checks for valid JSON and required fields

### Configuration Example

The installer generates this structure:

```json
{
  "ver": 2,
  "sources": [
    {
      "driver": "osmosdr",
      "device": "rtl=0",
      "center": 850000000,
      "rate": 2048000,
      "gain": 30,
      "error": 0,
      "digitalRecorders": 4
    }
  ],
  "systems": [
    {
      "shortName": "YourSystem",
      "control_channels": [851.0125, 851.5125],
      "type": "p25",
      "modulation": "qpsk",
      "squelch": -50,
      "audioGain": 1.0
    }
  ],
  "uploadServer": {
    "type": "rdio-scanner",
    "url": "http://scanner-map:3306/api/call-upload",
    "apiKey": "auto-generated-uuid"
  }
}
```

## 🔧 Key Fixes Applied

1. **Driver Field**: Changed from `type: 'rtl_sdr'` to `driver: 'osmosdr'`
2. **Device Format**: Changed from numeric `device: 0` to string `device: 'rtl=0'`
3. **Required Fields**: Added `gain`, `error`, `digitalRecorders` to sources
4. **System shortName**: Changed from `name` to `shortName` (required field)
5. **Migration Logic**: Enhanced to handle all v2 format conversions
6. **Directory Structure**: Added logs directory for completeness

## 📋 Next Steps for User

1. **Edit Configuration**: Update `appdata/trunk-recorder/config/config.json` with:
   - Your actual control channel frequencies
   - Your system's shortName
   - Adjust gain, squelch, and other settings as needed

2. **Pull Docker Image**: 
   ```bash
   docker pull robotastic/trunk-recorder:latest
   ```

3. **Start Container**:
   ```bash
   docker-compose up -d trunk-recorder
   ```

4. **Verify**:
   ```bash
   docker logs -f trunk-recorder
   ```

## ⚠️ Common Issues Resolved

- ✅ Config format v2 compliance
- ✅ Driver vs type field confusion
- ✅ Device format (string vs numeric)
- ✅ Missing required fields
- ✅ System shortName requirement
- ✅ Docker volume mount paths
- ✅ Automatic migration from old formats

