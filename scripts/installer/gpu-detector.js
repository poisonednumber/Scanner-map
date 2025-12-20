/**
 * GPU Detection and Configuration
 * Detects GPUs from NVIDIA, AMD, and Intel
 * Supports Docker GPU acceleration (primarily NVIDIA via Container Toolkit)
 */

const { execSync, spawn } = require('child_process');
const os = require('os');

class GPUDetector {
  constructor() {
    this.platform = process.platform;
    this.isWindows = this.platform === 'win32';
    this.isLinux = this.platform === 'linux';
    this.isMac = this.platform === 'darwin';
  }

  /**
   * Detect all available GPUs (NVIDIA, AMD, Intel)
   * @returns {Promise<Object>} GPU information with brand, name, and capabilities
   */
  async detectAllGPUs() {
    const gpus = {
      nvidia: await this.detectNvidiaGPU(),
      amd: await this.detectAMDGPU(),
      intel: await this.detectIntelGPU()
    };

    // Determine primary GPU (prefer NVIDIA for CUDA support, then AMD, then Intel)
    let primary = null;
    if (gpus.nvidia.available) {
      primary = { ...gpus.nvidia, brand: 'nvidia' };
    } else if (gpus.amd.available) {
      primary = { ...gpus.amd, brand: 'amd' };
    } else if (gpus.intel.available) {
      primary = { ...gpus.intel, brand: 'intel' };
    }

    return {
      available: primary !== null,
      primary: primary,
      all: gpus,
      brands: {
        nvidia: gpus.nvidia.available,
        amd: gpus.amd.available,
        intel: gpus.intel.available
      }
    };
  }

  /**
   * Detect if NVIDIA GPU is available
   */
  /**
   * Check if running inside Docker container
   */
  isRunningInDocker() {
    try {
      const fs = require('fs');
      // Check for .dockerenv file
      if (fs.existsSync('/.dockerenv')) {
        return true;
      }
      // Check cgroup (Linux)
      if (fs.existsSync('/proc/self/cgroup')) {
        const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
        if (cgroup.includes('docker') || cgroup.includes('containerd')) {
          return true;
        }
      }
      // Check environment variables
      if (process.env.DOCKER_CONTAINER === 'true' || process.env.container === 'docker') {
        return true;
      }
      return false;
    } catch (err) {
      return false;
    }
  }

  async detectNvidiaGPU() {
    try {
      const inDocker = this.isRunningInDocker();
      
      if (this.isWindows) {
        // Windows: Check for nvidia-smi
        try {
          const output = execSync('nvidia-smi --query-gpu=name --format=csv,noheader', { 
            encoding: 'utf8',
            timeout: 5000
          });
          const gpuName = output.trim();
          if (gpuName && gpuName.length > 0) {
            return {
              available: true,
              name: gpuName,
              platform: 'windows',
              inDocker: inDocker
            };
          }
        } catch (err) {
          // nvidia-smi not found or error
        }
      } else if (this.isLinux) {
        // Linux: Check for nvidia-smi (works in Docker if GPU is passed through)
        try {
          const output = execSync('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', { 
            encoding: 'utf8',
            timeout: 5000
          });
          const lines = output.trim().split('\n');
          if (lines.length > 0 && lines[0].trim().length > 0) {
            const parts = lines[0].split(',');
            const gpuName = parts[0].trim();
            const memoryMB = parts[1] ? parseInt(parts[1].trim()) : null;
            const memoryGB = memoryMB ? Math.round(memoryMB / 1024) : null;
            
            // If in Docker and nvidia-smi works, GPU is accessible
            if (inDocker) {
              return {
                available: true,
                name: gpuName,
                platform: 'linux',
                inDocker: true,
                memoryGB: memoryGB,
                toolkitRequired: true,
                toolkitInstalled: true, // If nvidia-smi works in Docker, toolkit is installed
                note: 'GPU accessible in Docker - NVIDIA Container Toolkit is configured correctly'
              };
            }
            
            return {
              available: true,
              name: gpuName,
              platform: 'linux',
              inDocker: false,
              memoryGB: memoryGB
            };
          }
        } catch (err) {
          // nvidia-smi not found or error
          // If in Docker, try alternative detection methods
          if (inDocker) {
            // Check if /dev/nvidia* devices exist (indicates GPU passthrough)
            try {
              const devCheck = execSync('ls /dev/nvidia* 2>/dev/null | head -1', {
                encoding: 'utf8',
                timeout: 2000,
                stdio: 'pipe'
              });
              if (devCheck && devCheck.trim()) {
                // GPU devices exist but nvidia-smi doesn't work - toolkit might not be fully configured
                return {
                  available: false,
                  reason: 'GPU devices detected but nvidia-smi not accessible. NVIDIA Container Toolkit may need configuration or the container needs --gpus flag.',
                  inDocker: true,
                  toolkitRequired: true,
                  toolkitInstalled: false
                };
              }
            } catch (devErr) {
              // No GPU devices
            }
            
            return {
              available: false,
              reason: 'NVIDIA GPU not accessible in Docker. Ensure NVIDIA Container Toolkit is installed and container is started with --gpus flag or deploy.resources.reservations.devices in docker-compose.',
              inDocker: true,
              toolkitRequired: true,
              toolkitInstalled: false
            };
          }
        }
      } else if (this.isMac) {
        // macOS: Check for Metal (Apple Silicon/AMD GPUs)
        // Note: Docker GPU support on Mac is limited, but we can detect Metal
        try {
          const output = execSync('system_profiler SPDisplaysDataType | grep "Chipset Model"', {
            encoding: 'utf8',
            timeout: 5000
          });
          if (output && output.length > 0) {
            return {
              available: true,
              name: 'Apple GPU (Metal)',
              platform: 'macos',
              note: 'Docker GPU acceleration not available on macOS'
            };
          }
        } catch (err) {
          // No GPU info
        }
      }

      return {
        available: false,
        reason: 'No NVIDIA GPU detected or nvidia-smi not available'
      };
    } catch (err) {
      return {
        available: false,
        reason: `Detection error: ${err.message}`
      };
    }
  }

  /**
   * Detect if AMD GPU is available
   */
  async detectAMDGPU() {
    try {
      if (this.isWindows) {
        // Windows: Check for AMD GPU via PowerShell
        try {
          const psScript = `
            Get-WmiObject Win32_VideoController | Where-Object {
              $_.Name -like '*AMD*' -or $_.Name -like '*Radeon*' -or $_.PNPDeviceID -like '*VEN_1002*'
            } | Select-Object -First 1 -ExpandProperty Name
          `;
          const output = execSync(`powershell -Command "${psScript}"`, {
            encoding: 'utf8',
            timeout: 5000
          });
          const gpuName = output.trim();
          if (gpuName && gpuName.length > 0) {
            return {
              available: true,
              name: gpuName,
              platform: 'windows',
              rocmAvailable: false, // ROCm not typically available on Windows
              note: 'AMD GPU detected. ROCm support limited on Windows.'
            };
          }
        } catch (err) {
          // Detection failed
        }
      } else if (this.isLinux) {
        // Linux: Check for AMD GPU via lspci or rocm-smi
        try {
          // Try rocm-smi first (if ROCm is installed)
          try {
            const rocmOutput = execSync('rocm-smi --showproductname', {
              encoding: 'utf8',
              timeout: 5000,
              stdio: 'pipe'
            });
            const gpuName = rocmOutput.trim();
            if (gpuName && gpuName.length > 0) {
              return {
                available: true,
                name: gpuName,
                platform: 'linux',
                rocmAvailable: true,
                note: 'AMD GPU with ROCm support detected'
              };
            }
          } catch (rocmErr) {
            // ROCm not installed, try lspci
          }

          // Try lspci to detect AMD GPU
          const lspciOutput = execSync('lspci | grep -i "vga\\|3d\\|display" | grep -i "amd\\|radeon\\|ati"', {
            encoding: 'utf8',
            timeout: 5000,
            stdio: 'pipe',
            shell: true
          });
          if (lspciOutput && lspciOutput.trim().length > 0) {
            const match = lspciOutput.match(/:\s*(.+?)(?:\s*\[|$)/);
            const gpuName = match ? match[1].trim() : 'AMD GPU';
            return {
              available: true,
              name: gpuName,
              platform: 'linux',
              rocmAvailable: false,
              note: 'AMD GPU detected. Install ROCm for GPU acceleration.'
            };
          }
        } catch (err) {
          // Detection failed
        }
      } else if (this.isMac) {
        // macOS: Check for AMD GPU (common in older Macs)
        try {
          const output = execSync('system_profiler SPDisplaysDataType | grep -i "amd\\|radeon"', {
            encoding: 'utf8',
            timeout: 5000,
            shell: true
          });
          if (output && output.length > 0) {
            const match = output.match(/Chipset Model:\s*(.+)/i);
            const gpuName = match ? match[1].trim() : 'AMD GPU';
            return {
              available: true,
              name: gpuName,
              platform: 'macos',
              rocmAvailable: false,
              note: 'AMD GPU detected. Docker GPU acceleration not available on macOS.'
            };
          }
        } catch (err) {
          // No AMD GPU
        }
      }

      return {
        available: false,
        reason: 'No AMD GPU detected'
      };
    } catch (err) {
      return {
        available: false,
        reason: `Detection error: ${err.message}`
      };
    }
  }

  /**
   * Detect if Intel GPU is available
   */
  async detectIntelGPU() {
    try {
      if (this.isWindows) {
        // Windows: Check for Intel GPU via PowerShell
        try {
          const psScript = `
            Get-WmiObject Win32_VideoController | Where-Object {
              $_.Name -like '*Intel*' -or $_.PNPDeviceID -like '*VEN_8086*'
            } | Select-Object -First 1 -ExpandProperty Name
          `;
          const output = execSync(`powershell -Command "${psScript}"`, {
            encoding: 'utf8',
            timeout: 5000
          });
          const gpuName = output.trim();
          if (gpuName && gpuName.length > 0) {
            return {
              available: true,
              name: gpuName,
              platform: 'windows',
              oneapiAvailable: false,
              note: 'Intel GPU detected. oneAPI support limited on Windows.'
            };
          }
        } catch (err) {
          // Detection failed
        }
      } else if (this.isLinux) {
        // Linux: Check for Intel GPU via lspci
        try {
          const lspciOutput = execSync('lspci | grep -i "vga\\|3d\\|display" | grep -i "intel"', {
            encoding: 'utf8',
            timeout: 5000,
            stdio: 'pipe',
            shell: true
          });
          if (lspciOutput && lspciOutput.trim().length > 0) {
            const match = lspciOutput.match(/:\s*(.+?)(?:\s*\[|$)/);
            const gpuName = match ? match[1].trim() : 'Intel GPU';
            return {
              available: true,
              name: gpuName,
              platform: 'linux',
              oneapiAvailable: false,
              note: 'Intel GPU detected. Install Intel oneAPI for GPU acceleration.'
            };
          }
        } catch (err) {
          // Detection failed
        }
      } else if (this.isMac) {
        // macOS: Intel GPUs in older Macs, but Apple Silicon uses integrated GPU
        try {
          const output = execSync('system_profiler SPDisplaysDataType | grep -i "intel"', {
            encoding: 'utf8',
            timeout: 5000,
            shell: true
          });
          if (output && output.length > 0) {
            const match = output.match(/Chipset Model:\s*(.+)/i);
            const gpuName = match ? match[1].trim() : 'Intel GPU';
            return {
              available: true,
              name: gpuName,
              platform: 'macos',
              oneapiAvailable: false,
              note: 'Intel GPU detected. Docker GPU acceleration not available on macOS.'
            };
          }
        } catch (err) {
          // No Intel GPU
        }
      }

      return {
        available: false,
        reason: 'No Intel GPU detected'
      };
    } catch (err) {
      return {
        available: false,
        reason: `Detection error: ${err.message}`
      };
    }
  }

  /**
   * Check if a specific GPU brand is supported by a service
   * @param {string} service - Service name (ollama, icad, faster-whisper)
   * @param {string} brand - GPU brand (nvidia, amd, intel)
   * @returns {Object} Compatibility information
   */
  getServiceGPUCompatibility(service, brand) {
    const compatibility = {
      'ollama': {
        'nvidia': { supported: true, docker: true, local: true, reason: null },
        'amd': { supported: true, docker: false, local: true, reason: 'AMD GPU requires ROCm (not available in Docker)' },
        'intel': { supported: false, docker: false, local: false, reason: 'Intel GPU not supported by Ollama' }
      },
      'icad': {
        'nvidia': { supported: true, docker: true, local: true, reason: null },
        'amd': { supported: false, docker: false, local: false, reason: 'iCAD Transcribe requires NVIDIA CUDA' },
        'intel': { supported: false, docker: false, local: false, reason: 'iCAD Transcribe requires NVIDIA CUDA' }
      },
      'faster-whisper': {
        'nvidia': { supported: true, docker: false, local: true, reason: null },
        'amd': { supported: false, docker: false, local: false, reason: 'faster-whisper requires NVIDIA CUDA or CPU' },
        'intel': { supported: false, docker: false, local: false, reason: 'faster-whisper requires NVIDIA CUDA or CPU' }
      }
    };

    return compatibility[service]?.[brand] || {
      supported: false,
      docker: false,
      local: false,
      reason: `Unknown service or GPU brand combination`
    };
  }

  /**
   * Check if NVIDIA Container Toolkit is installed (Linux only)
   */
  async checkNvidiaContainerToolkit() {
    if (!this.isLinux) {
      // Windows and Mac use different methods
      return {
        installed: false,
        reason: 'NVIDIA Container Toolkit is Linux-only. Windows/Mac use different GPU support.'
      };
    }

    try {
      // Check if nvidia-container-toolkit is installed
      execSync('nvidia-container-toolkit --version', { stdio: 'ignore', timeout: 5000 });
      return {
        installed: true,
        version: execSync('nvidia-container-toolkit --version', { encoding: 'utf8' }).trim()
      };
    } catch (err) {
      // Check if nvidia-docker2 is installed (older method)
      try {
        execSync('dpkg -l | grep nvidia-docker2', { stdio: 'ignore', timeout: 5000 });
        return {
          installed: true,
          version: 'nvidia-docker2 (legacy)'
        };
      } catch (err2) {
        return {
          installed: false,
          reason: 'NVIDIA Container Toolkit not found'
        };
      }
    }
  }

  /**
   * Check if Docker can use GPU (test with nvidia-docker or --gpus flag)
   */
  async testDockerGPU() {
    // On Windows, GPU support requires WSL2 and is more complex
    // Skip the test on Windows and just report GPU availability
    if (this.isWindows) {
      const gpuInfo = await this.detectNvidiaGPU();
      if (gpuInfo.available) {
        return {
          working: true,
          method: 'windows-wsl2',
          note: 'Windows GPU support requires WSL2 backend. Test skipped - GPU may work if WSL2 is configured.'
        };
      } else {
        return {
          working: false,
          reason: 'No NVIDIA GPU detected on Windows'
        };
      }
    }

    try {
      // On Linux, test with --gpus flag
      const testCmd = 'docker run --rm --gpus all nvidia/cuda:11.0.3-base-ubuntu20.04 nvidia-smi';
      
      execSync(testCmd, { 
        stdio: 'ignore',
        timeout: 30000
      });
      
      return {
        working: true,
        method: '--gpus all'
      };
    } catch (err) {
      // If test fails, check if GPU is available anyway
      const gpuInfo = await this.detectNvidiaGPU();
      if (gpuInfo.available) {
        return {
          working: false,
          reason: `GPU detected but Docker test failed: ${err.message}. You may need to install NVIDIA Container Toolkit.`,
          gpuAvailable: true
        };
      }
      
      return {
        working: false,
        reason: err.message || 'GPU test failed'
      };
    }
  }

  /**
   * Install NVIDIA Container Toolkit (Linux only)
   */
  async installNvidiaContainerToolkit() {
    if (!this.isLinux) {
      return {
        success: false,
        error: 'NVIDIA Container Toolkit installation is only supported on Linux'
      };
    }

    const chalk = require('chalk');
    console.log(chalk.blue('Installing NVIDIA Container Toolkit...'));

    try {
      // Detect distribution
      let distro = 'ubuntu';
      try {
        const osRelease = require('fs').readFileSync('/etc/os-release', 'utf8');
        if (osRelease.includes('Debian')) {
          distro = 'debian';
        } else if (osRelease.includes('Ubuntu')) {
          distro = 'ubuntu';
        } else {
          return {
            success: false,
            error: 'Unsupported Linux distribution. Please install NVIDIA Container Toolkit manually.'
          };
        }
      } catch (err) {
        // Default to Ubuntu
      }

      console.log(chalk.blue(`   Detected ${distro === 'ubuntu' ? 'Ubuntu' : 'Debian'}`));
      console.log(chalk.blue('   Adding NVIDIA repository...'));

      // Install prerequisites
      execSync('sudo apt-get update', { stdio: 'inherit' });
      execSync('sudo apt-get install -y ca-certificates curl gnupg', { stdio: 'inherit' });

      // Add NVIDIA GPG key
      const distroName = distro === 'ubuntu' ? 'ubuntu' : 'debian';
      execSync(
        'curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg',
        { stdio: 'inherit' }
      );

      // Add repository
      const distroVersion = distro === 'ubuntu' ? 'ubuntu22.04' : 'debian11';
      execSync(
        `echo "deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://nvidia.github.io/libnvidia-container/stable/${distroName}22.04/$(dpkg --print-architecture) /" | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list`,
        { stdio: 'inherit' }
      );

      console.log(chalk.blue('   Installing NVIDIA Container Toolkit...'));
      execSync('sudo apt-get update', { stdio: 'inherit' });
      execSync('sudo apt-get install -y nvidia-container-toolkit', { stdio: 'inherit' });

      console.log(chalk.blue('   Configuring Docker...'));
      execSync('sudo nvidia-ctk runtime configure --runtime=docker', { stdio: 'inherit' });
      execSync('sudo systemctl restart docker', { stdio: 'inherit' });

      // Wait for Docker to restart
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify installation
      const toolkitCheck = await this.checkNvidiaContainerToolkit();
      if (toolkitCheck.installed) {
        return { success: true };
      } else {
        return {
          success: false,
          error: 'Installation completed but verification failed. Please restart Docker manually.'
        };
      }
    } catch (err) {
      return {
        success: false,
        error: `Installation failed: ${err.message}`
      };
    }
  }

  /**
   * Get GPU configuration for docker-compose
   */
  getDockerComposeGPUConfig() {
    if (this.isLinux) {
      return {
        deploy: {
          resources: {
            reservations: {
              devices: [
                {
                  driver: 'nvidia',
                  count: 'all',
                  capabilities: ['gpu']
                }
              ]
            }
          }
        }
      };
    } else if (this.isWindows) {
      // Windows Docker Desktop with WSL2 backend supports GPU passthrough
      // But it's more complex and requires WSL2 CUDA support
      return {
        deploy: {
          resources: {
            reservations: {
              devices: [
                {
                  driver: 'nvidia',
                  count: 'all',
                  capabilities: ['gpu']
                }
              ]
            }
          }
        }
      };
    } else {
      // macOS doesn't support Docker GPU acceleration
      return null;
    }
  }
}

module.exports = GPUDetector;

