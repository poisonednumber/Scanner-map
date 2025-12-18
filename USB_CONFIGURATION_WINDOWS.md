# USB Device Configuration for Windows Docker

This guide explains how to configure USB devices (like RTL-SDR dongles) for use with Docker containers on Windows.

## ⚠️ Important Note

**Windows Docker Desktop uses WSL 2**, which does not natively support USB passthrough. For most users, we recommend running SDR software (SDRTrunk, TrunkRecorder) on the Windows host and configuring them to upload to Scanner Map via HTTP API.

## Recommended Approach: Windows Host + Docker API

This is the **easiest and most reliable** method:

1. **Install SDR software on Windows:**
   - SDRTrunk: https://github.com/DSheirer/sdrtrunk
   - TrunkRecorder: https://github.com/TrunkRecorder/trunk-recorder (Windows build)

2. **Configure to upload to Scanner Map:**
   - SDRTrunk: Streaming → Rdio Scanner → `http://localhost:3306/api/call-upload`
   - TrunkRecorder: Edit config to use `http://localhost:3306/api/call-upload`

3. **Get API key:**
   - After starting Scanner Map, check: `appdata\scanner-map\data\apikeys.json`
   - Or: `appdata\scanner-map\data\trunk-recorder-api-key.txt` (for TrunkRecorder)

4. **No USB configuration needed** - Everything runs on Windows host!

## Alternative: USB/IP (Advanced)

If you must use USB devices inside Docker containers, you can use USB/IP:

### Prerequisites

- Windows 10/11
- WSL 2 installed
- Administrator access

### Step 1: Install USB/IP Tools

**In Windows PowerShell (as Administrator):**

```powershell
# Install USB/IP Windows tools
winget install usbipd
# Or download from: https://github.com/dorssel/usbipd-win/releases
```

**In WSL 2:**

```bash
wsl
sudo apt-get update
sudo apt-get install linux-tools-generic hwdata
sudo update-alternatives --install /usr/local/bin/usbip usbip /usr/lib/linux-tools/*/usbip 20
```

### Step 2: Share USB Device from Windows

**In Windows PowerShell (as Administrator):**

```powershell
# List USB devices
usbipd list

# Share your RTL-SDR device (replace BUSID with actual bus ID)
usbipd bind --busid <BUSID>

# Example output:
# usbipd list
# BUSID  VID:PID    DEVICE                                                        STATE
# 1-1    0bda:2838  Realtek RTL2838UHIDIR, USB\VID_0BDA&PID_2838&MI_00          Not shared
# 
# usbipd bind --busid 1-1
```

### Step 3: Attach Device in WSL

**In WSL 2:**

```bash
# Attach the shared device
sudo usbip attach -r localhost -b <BUSID>

# Verify device is attached
lsusb
# You should see your RTL-SDR device
```

### Step 4: Configure Docker Compose

Update `docker-compose.yml`:

```yaml
services:
  trunk-recorder:
    devices:
      - /dev/bus/usb:/dev/bus/usb
    privileged: true  # May be required for USB access
    volumes:
      - ./appdata/trunk-recorder/config:/config
      - ./appdata/trunk-recorder/recordings:/recordings
```

### Step 5: Start Services

```bash
# In WSL, start Docker services
docker-compose up -d trunk-recorder
```

### Troubleshooting USB/IP

**Device not showing in WSL:**
```bash
# Check if usbipd is running
sudo usbip list -r localhost

# Re-attach if needed
sudo usbip attach -r localhost -b <BUSID>
```

**Permission denied:**
```bash
# Add user to dialout group
sudo usermod -aG dialout $USER
newgrp dialout
```

**Device disappears after reboot:**
- You'll need to re-bind and re-attach after each reboot
- Consider creating a startup script

## Method 3: Linux VM or Dual Boot

For the best USB support:

1. **Install Linux** (Ubuntu recommended)
2. **Install Docker** on Linux
3. **Run Scanner Map** in Linux Docker
4. **USB devices work natively** in Linux

This is the most reliable method for USB-heavy setups.

## Method 4: Network-Based SDR

Some SDR solutions work over the network:

- **RTL-TCP**: Streams RTL-SDR data over network
- **SoapyRemote**: Network-based SDR interface
- **Remote SDR servers**: Dedicated SDR server hardware

Configure these to stream to your Scanner Map instance.

## Quick Reference

| Method | Difficulty | Reliability | USB Support |
|--------|-----------|-------------|-------------|
| Windows Host + API | ⭐ Easy | ⭐⭐⭐ Excellent | ✅ Native |
| USB/IP | ⭐⭐⭐ Hard | ⭐⭐ Good | ⚠️ Requires setup |
| Linux VM/Dual Boot | ⭐⭐ Medium | ⭐⭐⭐ Excellent | ✅ Native |
| Network SDR | ⭐⭐ Medium | ⭐⭐⭐ Excellent | ✅ Remote |

## Recommended Configuration

For Windows users, we recommend:

1. **Scanner Map** → Docker (easy installation, auto-updates)
2. **SDR Software** → Windows host (native USB support)
3. **Communication** → HTTP API (reliable, no USB needed)

This gives you the best of both worlds: easy Docker management and native USB support.

## Getting Help

If you need help with USB configuration:

1. Check [Discord community](https://discord.gg/X7vej75zZy)
2. Review Docker Desktop WSL 2 documentation
3. Check USB/IP project: https://github.com/dorssel/usbipd-win

