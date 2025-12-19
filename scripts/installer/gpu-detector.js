/**
 * GPU Detection and Configuration
 * Detects NVIDIA GPUs and NVIDIA Container Toolkit for Docker GPU acceleration
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
   * Detect if NVIDIA GPU is available
   */
  async detectNvidiaGPU() {
    try {
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
              platform: 'windows'
            };
          }
        } catch (err) {
          // nvidia-smi not found or error
        }
      } else if (this.isLinux) {
        // Linux: Check for nvidia-smi
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
              platform: 'linux'
            };
          }
        } catch (err) {
          // nvidia-smi not found or error
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

