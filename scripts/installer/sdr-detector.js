/**
 * SDR Device Detector
 * Detects available SDR devices across different platforms and device types
 * Supports: RTL-SDR, HackRF, BladeRF, Airspy, SoapySDR-based devices
 */

const { execSync, spawn } = require('child_process');
const os = require('os');
const fs = require('fs-extra');
const path = require('path');

class SDRDetector {
  constructor() {
    this.platform = os.platform();
    this.detectedDevices = [];
  }

  /**
   * Detect all available SDR devices
   * @returns {Promise<Array>} Array of detected device objects
   */
  async detectDevices() {
    this.detectedDevices = [];
    
    // Detect RTL-SDR devices
    await this.detectRTLSDR();
    
    // Detect HackRF devices
    await this.detectHackRF();
    
    // Detect BladeRF devices
    await this.detectBladeRF();
    
    // Detect Airspy devices
    await this.detectAirspy();
    
    // Detect SoapySDR devices (catch-all for other devices)
    await this.detectSoapySDR();
    
    // Detect additional common SDRs
    await this.detectLimeSDR();
    await this.detectPlutoSDR();
    await this.detectUSRP();
    await this.detectSDRPlay();
    
    return this.detectedDevices;
  }

  /**
   * Detect RTL-SDR devices using rtl_test or lsusb (Linux) / USB device list (Windows/macOS)
   */
  async detectRTLSDR() {
    try {
      if (this.platform === 'linux') {
        // Linux: Use lsusb to find RTL2832U devices
        try {
          const lsusbOutput = execSync('lsusb', { encoding: 'utf8', timeout: 5000 });
          const rtlDevices = lsusbOutput.split('\n').filter(line => 
            line.includes('RTL2832U') || 
            line.includes('Realtek') && line.includes('RTL2838')
          );
          
          rtlDevices.forEach((line, index) => {
            this.detectedDevices.push({
              type: 'rtl-sdr',
              driver: 'osmosdr',
              device: `rtl=${index}`,
              deviceString: `rtl=${index}`,
              name: `RTL-SDR #${index}`,
              description: line.trim(),
              index: index
            });
          });
        } catch (err) {
          // lsusb not available or failed, try rtl_test
          try {
            execSync('rtl_test --help', { stdio: 'ignore', timeout: 2000 });
            // rtl_test exists, check for devices
            const testOutput = execSync('timeout 2 rtl_test -t 2>/dev/null || echo ""', {
              encoding: 'utf8',
              timeout: 5000,
              shell: true
            });
            
            // Parse rtl_test output to count devices
            const deviceMatches = testOutput.match(/Found \d+ device/i);
            if (deviceMatches) {
              const count = parseInt(deviceMatches[0].match(/\d+/)[0]);
              for (let i = 0; i < count; i++) {
                this.detectedDevices.push({
                  type: 'rtl-sdr',
                  driver: 'osmosdr',
                  device: `rtl=${i}`,
                  deviceString: `rtl=${i}`,
                  name: `RTL-SDR #${i}`,
                  description: `RTL-SDR Device ${i}`,
                  index: i
                });
              }
            } else {
              // Assume at least one device if rtl_test exists
              this.detectedDevices.push({
                type: 'rtl-sdr',
                driver: 'osmosdr',
                device: 'rtl=0',
                deviceString: 'rtl=0',
                name: 'RTL-SDR #0',
                description: 'RTL-SDR Device (assumed)',
                index: 0
              });
            }
          } catch (rtlErr) {
            // Neither method worked
          }
        }
      } else if (this.platform === 'win32') {
        // Windows: Check for RTL-SDR in device manager or use registry/USB devices
        // Try to detect via USB device enumeration
        try {
          // Use PowerShell to check USB devices
          const psScript = `
            Get-WmiObject Win32_USBControllerDevice | ForEach-Object {
              $device = [wmi]$_.Dependent
              if ($device.Description -like '*RTL2832*' -or $device.Description -like '*RTL-SDR*') {
                Write-Output $device.Description
              }
            }
          `;
          const output = execSync(`powershell -Command "${psScript}"`, {
            encoding: 'utf8',
            timeout: 5000
          });
          
          const devices = output.trim().split('\n').filter(l => l.trim());
          devices.forEach((desc, index) => {
            this.detectedDevices.push({
              type: 'rtl-sdr',
              driver: 'osmosdr',
              device: `rtl=${index}`,
              deviceString: `rtl=${index}`,
              name: `RTL-SDR #${index}`,
              description: desc.trim(),
              index: index
            });
          });
        } catch (err) {
          // Fallback: assume one RTL-SDR if we can't detect
          this.detectedDevices.push({
            type: 'rtl-sdr',
            driver: 'osmosdr',
            device: 'rtl=0',
            deviceString: 'rtl=0',
            name: 'RTL-SDR #0',
            description: 'RTL-SDR Device (default)',
            index: 0
          });
        }
      } else if (this.platform === 'darwin') {
        // macOS: Use system_profiler to detect USB devices
        try {
          const output = execSync('system_profiler SPUSBDataType | grep -A 10 -i "rtl2832\\|RTL-SDR"', {
            encoding: 'utf8',
            timeout: 5000,
            shell: true
          });
          
          if (output.trim()) {
            this.detectedDevices.push({
              type: 'rtl-sdr',
              driver: 'osmosdr',
              device: 'rtl=0',
              deviceString: 'rtl=0',
              name: 'RTL-SDR #0',
              description: 'RTL-SDR Device',
              index: 0
            });
          }
        } catch (err) {
          // No RTL-SDR detected or system_profiler failed
        }
      }
    } catch (err) {
      // Detection failed, but don't throw - just skip this device type
    }
  }

  /**
   * Detect HackRF devices
   */
  async detectHackRF() {
    try {
      if (this.platform === 'linux') {
        const lsusbOutput = execSync('lsusb', { encoding: 'utf8', timeout: 5000 });
        const hackrfDevices = lsusbOutput.split('\n').filter(line => 
          line.includes('HackRF') || line.includes('1d50:6089')
        );
        
        hackrfDevices.forEach((line, index) => {
          this.detectedDevices.push({
            type: 'hackrf',
            driver: 'osmosdr',
            device: `hackrf=${index}`,
            deviceString: `hackrf=${index}`,
            name: `HackRF #${index}`,
            description: line.trim(),
            index: index
          });
        });
      } else if (this.platform === 'win32') {
        try {
          const psScript = `
            Get-WmiObject Win32_USBControllerDevice | ForEach-Object {
              $device = [wmi]$_.Dependent
              if ($device.Description -like '*HackRF*') {
                Write-Output $device.Description
              }
            }
          `;
          const output = execSync(`powershell -Command "${psScript}"`, {
            encoding: 'utf8',
            timeout: 5000
          });
          
          const devices = output.trim().split('\n').filter(l => l.trim());
          devices.forEach((desc, index) => {
            this.detectedDevices.push({
              type: 'hackrf',
              driver: 'osmosdr',
              device: `hackrf=${index}`,
              deviceString: `hackrf=${index}`,
              name: `HackRF #${index}`,
              description: desc.trim(),
              index: index
            });
          });
        } catch (err) {
          // Detection failed
        }
      } else if (this.platform === 'darwin') {
        try {
          const output = execSync('system_profiler SPUSBDataType | grep -A 10 -i "HackRF"', {
            encoding: 'utf8',
            timeout: 5000,
            shell: true
          });
          
          if (output.trim()) {
            this.detectedDevices.push({
              type: 'hackrf',
              driver: 'osmosdr',
              device: 'hackrf=0',
              deviceString: 'hackrf=0',
              name: 'HackRF #0',
              description: 'HackRF One',
              index: 0
            });
          }
        } catch (err) {
          // No HackRF detected
        }
      }
    } catch (err) {
      // Detection failed
    }
  }

  /**
   * Detect BladeRF devices
   */
  async detectBladeRF() {
    try {
      // BladeRF uses its own driver
      if (this.platform === 'linux') {
        const lsusbOutput = execSync('lsusb', { encoding: 'utf8', timeout: 5000 });
        const bladeDevices = lsusbOutput.split('\n').filter(line => 
          line.includes('BladeRF') || line.includes('2cf0')
        );
        
        bladeDevices.forEach((line, index) => {
          this.detectedDevices.push({
            type: 'bladerf',
            driver: 'bladerf',
            device: `bladerf=${index}`,
            deviceString: `bladerf=${index}`,
            name: `BladeRF #${index}`,
            description: line.trim(),
            index: index
          });
        });
      } else if (this.platform === 'win32') {
        try {
          const psScript = `
            Get-WmiObject Win32_USBControllerDevice | ForEach-Object {
              $device = [wmi]$_.Dependent
              if ($device.Description -like '*BladeRF*') {
                Write-Output $device.Description
              }
            }
          `;
          const output = execSync(`powershell -Command "${psScript}"`, {
            encoding: 'utf8',
            timeout: 5000
          });
          
          const devices = output.trim().split('\n').filter(l => l.trim());
          devices.forEach((desc, index) => {
            this.detectedDevices.push({
              type: 'bladerf',
              driver: 'bladerf',
              device: `bladerf=${index}`,
              deviceString: `bladerf=${index}`,
              name: `BladeRF #${index}`,
              description: desc.trim(),
              index: index
            });
          });
        } catch (err) {
          // Detection failed
        }
      } else if (this.platform === 'darwin') {
        try {
          const output = execSync('system_profiler SPUSBDataType | grep -A 10 -i "BladeRF"', {
            encoding: 'utf8',
            timeout: 5000,
            shell: true
          });
          
          if (output.trim()) {
            this.detectedDevices.push({
              type: 'bladerf',
              driver: 'bladerf',
              device: 'bladerf=0',
              deviceString: 'bladerf=0',
              name: 'BladeRF #0',
              description: 'BladeRF',
              index: 0
            });
          }
        } catch (err) {
          // No BladeRF detected
        }
      }
    } catch (err) {
      // Detection failed
    }
  }

  /**
   * Detect Airspy devices
   */
  async detectAirspy() {
    try {
      if (this.platform === 'linux') {
        const lsusbOutput = execSync('lsusb', { encoding: 'utf8', timeout: 5000 });
        const airspyDevices = lsusbOutput.split('\n').filter(line => 
          line.includes('Airspy') || line.includes('1d50:60a1')
        );
        
        airspyDevices.forEach((line, index) => {
          this.detectedDevices.push({
            type: 'airspy',
            driver: 'osmosdr',
            device: `airspy=${index}`,
            deviceString: `airspy=${index}`,
            name: `Airspy #${index}`,
            description: line.trim(),
            index: index
          });
        });
      } else if (this.platform === 'win32') {
        try {
          const psScript = `
            Get-WmiObject Win32_USBControllerDevice | ForEach-Object {
              $device = [wmi]$_.Dependent
              if ($device.Description -like '*Airspy*') {
                Write-Output $device.Description
              }
            }
          `;
          const output = execSync(`powershell -Command "${psScript}"`, {
            encoding: 'utf8',
            timeout: 5000
          });
          
          const devices = output.trim().split('\n').filter(l => l.trim());
          devices.forEach((desc, index) => {
            this.detectedDevices.push({
              type: 'airspy',
              driver: 'osmosdr',
              device: `airspy=${index}`,
              deviceString: `airspy=${index}`,
              name: `Airspy #${index}`,
              description: desc.trim(),
              index: index
            });
          });
        } catch (err) {
          // Detection failed
        }
      } else if (this.platform === 'darwin') {
        try {
          const output = execSync('system_profiler SPUSBDataType | grep -A 10 -i "Airspy"', {
            encoding: 'utf8',
            timeout: 5000,
            shell: true
          });
          
          if (output.trim()) {
            this.detectedDevices.push({
              type: 'airspy',
              driver: 'osmosdr',
              device: 'airspy=0',
              deviceString: 'airspy=0',
              name: 'Airspy #0',
              description: 'Airspy',
              index: 0
            });
          }
        } catch (err) {
          // No Airspy detected
        }
      }
    } catch (err) {
      // Detection failed
    }
  }

  /**
   * Detect SoapySDR devices (catch-all for other SDR types)
   */
  async detectSoapySDR() {
    try {
      // Try to use SoapySDRUtil to detect devices
      try {
        const output = execSync('SoapySDRUtil --find', {
          encoding: 'utf8',
          timeout: 5000
        });
        
        // Parse SoapySDRUtil output
        const lines = output.split('\n');
        let currentDevice = null;
        let deviceIndex = 0;
        
        lines.forEach(line => {
          if (line.trim().startsWith('Found device')) {
            // Save previous device if exists
            if (currentDevice) {
              this.detectedDevices.push(currentDevice);
            }
            
            // Extract device string
            const match = line.match(/device=([^,]+)/);
            if (match) {
              currentDevice = {
                type: 'soapysdr',
                driver: 'soapysdr',
                device: match[1],
                deviceString: match[1],
                name: `SoapySDR Device #${deviceIndex}`,
                description: line.trim(),
                index: deviceIndex++
              };
            }
          } else if (currentDevice && line.trim()) {
            // Add additional info to description
            currentDevice.description += ' ' + line.trim();
          }
        });
        
        // Add last device
        if (currentDevice) {
          this.detectedDevices.push(currentDevice);
        }
      } catch (err) {
        // SoapySDRUtil not available or failed
      }
    } catch (err) {
      // Detection failed
    }
  }

  /**
   * Detect LimeSDR devices
   */
  async detectLimeSDR() {
    try {
      if (this.platform === 'linux') {
        const lsusbOutput = execSync('lsusb', { encoding: 'utf8', timeout: 5000 });
        const limeDevices = lsusbOutput.split('\n').filter(line => 
          line.includes('Lime') || line.includes('1d50:6108') || line.includes('0403:601f')
        );
        
        limeDevices.forEach((line, index) => {
          this.detectedDevices.push({
            type: 'limesdr',
            driver: 'soapysdr',
            device: `driver=lime,soapy=${index}`,
            deviceString: `driver=lime,soapy=${index}`,
            name: `LimeSDR #${index}`,
            description: line.trim(),
            index: index
          });
        });
      } else if (this.platform === 'win32') {
        try {
          const psScript = `
            Get-WmiObject Win32_USBControllerDevice | ForEach-Object {
              $device = [wmi]$_.Dependent
              if ($device.Description -like '*Lime*') {
                Write-Output $device.Description
              }
            }
          `;
          const output = execSync(`powershell -Command "${psScript}"`, {
            encoding: 'utf8',
            timeout: 5000
          });
          const devices = output.trim().split('\n').filter(l => l.trim());
          devices.forEach((desc, index) => {
            this.detectedDevices.push({
              type: 'limesdr',
              driver: 'soapysdr',
              device: `driver=lime,soapy=${index}`,
              deviceString: `driver=lime,soapy=${index}`,
              name: `LimeSDR #${index}`,
              description: desc.trim(),
              index: index
            });
          });
        } catch (err) {
          // Detection failed
        }
      }
    } catch (err) {
      // Detection failed
    }
  }

  /**
   * Detect PlutoSDR devices
   */
  async detectPlutoSDR() {
    try {
      if (this.platform === 'linux') {
        const lsusbOutput = execSync('lsusb', { encoding: 'utf8', timeout: 5000 });
        const plutoDevices = lsusbOutput.split('\n').filter(line => 
          line.includes('Pluto') || line.includes('0456:b673')
        );
        
        plutoDevices.forEach((line, index) => {
          this.detectedDevices.push({
            type: 'plutosdr',
            driver: 'plutosdr',
            device: `pluto=${index}`,
            deviceString: `pluto=${index}`,
            name: `PlutoSDR #${index}`,
            description: line.trim(),
            index: index
          });
        });
      } else if (this.platform === 'win32') {
        try {
          const psScript = `
            Get-WmiObject Win32_USBControllerDevice | ForEach-Object {
              $device = [wmi]$_.Dependent
              if ($device.Description -like '*Pluto*') {
                Write-Output $device.Description
              }
            }
          `;
          const output = execSync(`powershell -Command "${psScript}"`, {
            encoding: 'utf8',
            timeout: 5000
          });
          const devices = output.trim().split('\n').filter(l => l.trim());
          devices.forEach((desc, index) => {
            this.detectedDevices.push({
              type: 'plutosdr',
              driver: 'plutosdr',
              device: `pluto=${index}`,
              deviceString: `pluto=${index}`,
              name: `PlutoSDR #${index}`,
              description: desc.trim(),
              index: index
            });
          });
        } catch (err) {
          // Detection failed
        }
      }
    } catch (err) {
      // Detection failed
    }
  }

  /**
   * Detect USRP devices
   */
  async detectUSRP() {
    try {
      if (this.platform === 'linux') {
        const lsusbOutput = execSync('lsusb', { encoding: 'utf8', timeout: 5000 });
        const usrpDevices = lsusbOutput.split('\n').filter(line => 
          line.includes('USRP') || line.includes('2500:0020') || line.includes('2500:0021')
        );
        
        usrpDevices.forEach((line, index) => {
          this.detectedDevices.push({
            type: 'usrp',
            driver: 'uhd',
            device: `uhd=${index}`,
            deviceString: `uhd=${index}`,
            name: `USRP #${index}`,
            description: line.trim(),
            index: index
          });
        });
      } else if (this.platform === 'win32') {
        try {
          const psScript = `
            Get-WmiObject Win32_USBControllerDevice | ForEach-Object {
              $device = [wmi]$_.Dependent
              if ($device.Description -like '*USRP*') {
                Write-Output $device.Description
              }
            }
          `;
          const output = execSync(`powershell -Command "${psScript}"`, {
            encoding: 'utf8',
            timeout: 5000
          });
          const devices = output.trim().split('\n').filter(l => l.trim());
          devices.forEach((desc, index) => {
            this.detectedDevices.push({
              type: 'usrp',
              driver: 'uhd',
              device: `uhd=${index}`,
              deviceString: `uhd=${index}`,
              name: `USRP #${index}`,
              description: desc.trim(),
              index: index
            });
          });
        } catch (err) {
          // Detection failed
        }
      }
    } catch (err) {
      // Detection failed
    }
  }

  /**
   * Detect SDRplay devices
   */
  async detectSDRPlay() {
    try {
      if (this.platform === 'linux') {
        const lsusbOutput = execSync('lsusb', { encoding: 'utf8', timeout: 5000 });
        const sdrplayDevices = lsusbOutput.split('\n').filter(line => 
          line.includes('SDRplay') || line.includes('1df7:2500') || line.includes('1df7:3000')
        );
        
        sdrplayDevices.forEach((line, index) => {
          this.detectedDevices.push({
            type: 'sdrplay',
            driver: 'soapysdr',
            device: `driver=sdrplay,soapy=${index}`,
            deviceString: `driver=sdrplay,soapy=${index}`,
            name: `SDRplay #${index}`,
            description: line.trim(),
            index: index
          });
        });
      } else if (this.platform === 'win32') {
        try {
          const psScript = `
            Get-WmiObject Win32_USBControllerDevice | ForEach-Object {
              $device = [wmi]$_.Dependent
              if ($device.Description -like '*SDRplay*') {
                Write-Output $device.Description
              }
            }
          `;
          const output = execSync(`powershell -Command "${psScript}"`, {
            encoding: 'utf8',
            timeout: 5000
          });
          const devices = output.trim().split('\n').filter(l => l.trim());
          devices.forEach((desc, index) => {
            this.detectedDevices.push({
              type: 'sdrplay',
              driver: 'soapysdr',
              device: `driver=sdrplay,soapy=${index}`,
              deviceString: `driver=sdrplay,soapy=${index}`,
              name: `SDRplay #${index}`,
              description: desc.trim(),
              index: index
            });
          });
        } catch (err) {
          // Detection failed
        }
      }
    } catch (err) {
      // Detection failed
    }
  }

  /**
   * Check if an SDR device is supported by TrunkRecorder
   * @param {Object} device - SDR device object
   * @returns {Object} Compatibility information
   */
  getSDRCompatibility(device) {
    const supportedTypes = ['rtl-sdr', 'hackrf', 'bladerf', 'airspy', 'limesdr', 'plutosdr', 'usrp', 'sdrplay', 'soapysdr'];
    const supported = supportedTypes.includes(device.type);
    
    return {
      supported: supported,
      reason: supported ? null : `SDR type "${device.type}" is not supported by TrunkRecorder. Supported types: ${supportedTypes.join(', ')}`
    };
  }

  /**
   * Get recommended device configuration for TrunkRecorder
   * Returns the first detected device, or default RTL-SDR if none found
   */
  getRecommendedDevice() {
    if (this.detectedDevices.length > 0) {
      return this.detectedDevices[0];
    }
    
    // Default to RTL-SDR if no devices detected
    return {
      type: 'rtl-sdr',
      driver: 'osmosdr',
      device: 'rtl=0',
      deviceString: 'rtl=0',
      name: 'RTL-SDR #0 (default)',
      description: 'Default RTL-SDR configuration',
      index: 0,
      isDefault: true
    };
  }

  /**
   * Get all detected devices as a formatted list
   */
  getDeviceList() {
    if (this.detectedDevices.length === 0) {
      return [this.getRecommendedDevice()];
    }
    return this.detectedDevices;
  }
}

module.exports = SDRDetector;

