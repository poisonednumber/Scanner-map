/**
 * Dependency Installer
 * Automatically installs missing dependencies for Scanner Map
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const inquirer = require('inquirer');

class DependencyInstaller {
  constructor() {
    this.platform = process.platform;
    this.isWindows = this.platform === 'win32';
    this.isLinux = this.platform === 'linux';
    this.isMac = this.platform === 'darwin';
  }

  /**
   * Check and install missing dependencies
   */
  async checkAndInstall(installationType) {
    const missing = {
      docker: false,
      dockerCompose: false,
      dockerDaemon: false,
      nodejs: false,
      npm: false,
      python: false
    };

    // Check what's missing
    if (installationType === 'docker') {
      missing.docker = !this.isInstalled('docker');
      missing.dockerCompose = !this.isDockerComposeInstalled();
      missing.dockerDaemon = !this.isDockerDaemonRunning();
    } else {
      missing.nodejs = !this.isNodeInstalled();
      missing.npm = !this.isNpmInstalled();
      missing.python = !this.isPythonInstalled();
    }

    // Check if anything is missing
    const hasMissing = Object.values(missing).some(v => v);
    if (!hasMissing) {
      return { success: true, installed: [] };
    }

    // Show what's missing and ask to install
    const missingList = [];
    if (missing.docker) missingList.push('Docker');
    if (missing.dockerCompose) missingList.push('Docker Compose');
    if (missing.dockerDaemon) missingList.push('Docker Daemon (needs to be started)');
    if (missing.nodejs) missingList.push('Node.js');
    if (missing.npm) missingList.push('npm');
    if (missing.python) missingList.push('Python 3');

    console.log(chalk.yellow('\n⚠ Missing dependencies detected:\n'));
    missingList.forEach(item => console.log(chalk.yellow(`   • ${item}`)));
    console.log('');

    const { install } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'install',
        message: chalk.bold('Would you like to install missing dependencies automatically?'),
        default: true
      }
    ]);

    if (!install) {
      return {
        success: false,
        error: 'Missing dependencies must be installed to continue'
      };
    }

    // Install missing dependencies
    const installed = [];
    const errors = [];

    if (installationType === 'docker') {
      if (missing.docker) {
        const result = await this.installDocker();
        if (result.success) {
          installed.push('Docker');
        } else {
          errors.push(`Docker: ${result.error}`);
        }
      }

      if (missing.dockerCompose && !errors.length) {
        // Docker Compose usually comes with Docker Desktop
        // On Linux, we might need to install it separately
        if (this.isLinux) {
          const result = await this.installDockerCompose();
          if (result.success) {
            installed.push('Docker Compose');
          } else {
            errors.push(`Docker Compose: ${result.error}`);
          }
        }
      }

      if (missing.dockerDaemon && !errors.length) {
        const result = await this.startDockerDaemon();
        if (result.success) {
          installed.push('Docker Daemon started');
        } else {
          errors.push(`Docker Daemon: ${result.error}`);
        }
      }
    } else {
      if (missing.nodejs) {
        const result = await this.installNodejs();
        if (result.success) {
          installed.push('Node.js');
          // npm comes with Node.js, so mark it as installed too
          missing.npm = false;
        } else {
          errors.push(`Node.js: ${result.error}`);
        }
      }

      if (missing.npm && !errors.length) {
        const result = await this.installNpm();
        if (result.success) {
          installed.push('npm');
        } else {
          errors.push(`npm: ${result.error}`);
        }
      }

      if (missing.python) {
        const result = await this.installPython();
        if (result.success) {
          installed.push('Python 3');
        } else {
          // Python is optional, so just warn
          console.log(chalk.yellow(`⚠ Could not install Python: ${result.error}`));
          console.log(chalk.yellow('   You can install it manually later if needed.'));
        }
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        error: errors.join('; '),
        installed
      };
    }

    return {
      success: true,
      installed
    };
  }

  /**
   * Check if Docker is installed
   */
  isInstalled(command) {
    try {
      execSync(`${command} --version`, { stdio: 'ignore' });
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Check if Docker Compose is installed
   */
  isDockerComposeInstalled() {
    try {
      execSync('docker compose version', { stdio: 'ignore' });
      return true;
    } catch (err) {
      try {
        execSync('docker-compose --version', { stdio: 'ignore' });
        return true;
      } catch (err2) {
        return false;
      }
    }
  }

  /**
   * Check if Docker daemon is running
   */
  isDockerDaemonRunning() {
    try {
      execSync('docker ps', { stdio: 'ignore' });
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Check if Node.js is installed
   */
  isNodeInstalled() {
    try {
      const version = execSync('node --version', { encoding: 'utf8' }).trim();
      const majorVersion = parseInt(version.replace('v', '').split('.')[0]);
      return majorVersion >= 18;
    } catch (err) {
      return false;
    }
  }

  /**
   * Check if npm is installed
   */
  isNpmInstalled() {
    try {
      execSync('npm --version', { stdio: 'ignore' });
      return true;
    } catch (err) {
      return false;
    }
  }

  /**
   * Check if Python is installed
   */
  isPythonInstalled() {
    try {
      execSync('python3 --version', { stdio: 'ignore' });
      return true;
    } catch (err) {
      try {
        execSync('python --version', { stdio: 'ignore' });
        return true;
      } catch (err2) {
        return false;
      }
    }
  }

  /**
   * Install Docker
   */
  async installDocker() {
    console.log(chalk.blue('\nInstalling Docker...'));

    if (this.isWindows) {
      return await this.installDockerWindows();
    } else if (this.isMac) {
      return await this.installDockerMac();
    } else if (this.isLinux) {
      return await this.installDockerLinux();
    } else {
      return {
        success: false,
        error: 'Docker installation not supported on this platform'
      };
    }
  }

  /**
   * Install Docker on Windows
   */
  async installDockerWindows() {
    console.log(chalk.yellow('For Windows, Docker Desktop must be installed manually.'));
    console.log(chalk.blue('Opening Docker Desktop download page...'));

    try {
      // Try to open the download page
      const { exec } = require('child_process');
      exec('start https://www.docker.com/products/docker-desktop/');
    } catch (err) {
      // Ignore if we can't open browser
    }

    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Have you installed Docker Desktop? (The installer will check again)',
        default: false
      }
    ]);

    if (!proceed) {
      return {
        success: false,
        error: 'Docker Desktop installation required'
      };
    }

    // Wait a moment and check again
    await new Promise(resolve => setTimeout(resolve, 2000));

    if (this.isInstalled('docker')) {
      return { success: true };
    } else {
      return {
        success: false,
        error: 'Docker not found. Please install Docker Desktop and restart the installer.'
      };
    }
  }

  /**
   * Install Docker on macOS
   */
  async installDockerMac() {
    console.log(chalk.yellow('For macOS, Docker Desktop must be installed via Homebrew or manually.'));
    
    // Check if Homebrew is available
    try {
      execSync('brew --version', { stdio: 'ignore' });
      
      const { useHomebrew } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useHomebrew',
          message: 'Install Docker Desktop via Homebrew?',
          default: true
        }
      ]);

      if (useHomebrew) {
        console.log(chalk.blue('Installing Docker Desktop via Homebrew (this may take a while)...'));
        try {
          execSync('brew install --cask docker', { stdio: 'inherit' });
          
          // Try to start Docker Desktop
          try {
            execSync('open -a Docker', { stdio: 'ignore' });
            console.log(chalk.blue('Starting Docker Desktop...'));
            console.log(chalk.yellow('Please wait for Docker Desktop to start (this may take a minute).'));
            
            // Wait for Docker to start
            let attempts = 0;
            while (attempts < 30) {
              await new Promise(resolve => setTimeout(resolve, 2000));
              if (this.isDockerDaemonRunning()) {
                return { success: true };
              }
              attempts++;
            }
            
            return {
              success: false,
              error: 'Docker Desktop installed but daemon not running. Please start Docker Desktop manually.'
            };
          } catch (err) {
            return {
              success: false,
              error: 'Docker Desktop installed but could not be started. Please start it manually.'
            };
          }
        } catch (err) {
          return {
            success: false,
            error: `Homebrew installation failed: ${err.message}`
          };
        }
      }
    } catch (err) {
      // Homebrew not available
    }

    // Fallback to manual installation
    console.log(chalk.blue('Opening Docker Desktop download page...'));
    try {
      execSync('open https://www.docker.com/products/docker-desktop/');
    } catch (err) {
      // Ignore
    }

    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Have you installed Docker Desktop? (The installer will check again)',
        default: false
      }
    ]);

    if (!proceed) {
      return {
        success: false,
        error: 'Docker Desktop installation required'
      };
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    if (this.isInstalled('docker')) {
      return { success: true };
    } else {
      return {
        success: false,
        error: 'Docker not found. Please install Docker Desktop and restart the installer.'
      };
    }
  }

  /**
   * Install Docker on Linux
   */
  async installDockerLinux() {
    console.log(chalk.blue('Installing Docker on Linux...'));

    // Detect Linux distribution
    let distro = 'unknown';
    try {
      if (fs.existsSync('/etc/os-release')) {
        const osRelease = fs.readFileSync('/etc/os-release', 'utf8');
        if (osRelease.includes('Ubuntu') || osRelease.includes('Debian')) {
          distro = 'debian';
        } else if (osRelease.includes('Fedora') || osRelease.includes('CentOS') || osRelease.includes('RHEL')) {
          distro = 'rhel';
        } else if (osRelease.includes('Arch')) {
          distro = 'arch';
        }
      }
    } catch (err) {
      // Ignore
    }

    // Check if we need sudo
    let needsSudo = true;
    try {
      execSync('docker ps', { stdio: 'ignore' });
      needsSudo = false;
    } catch (err) {
      // Needs sudo
    }

    if (needsSudo) {
      console.log(chalk.yellow('This installation requires sudo privileges.'));
      const { proceed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'proceed',
          message: 'Continue with sudo installation?',
          default: true
        }
      ]);

      if (!proceed) {
        return {
          success: false,
          error: 'Docker installation requires sudo privileges'
        };
      }
    }

    try {
      if (distro === 'debian') {
        // Ubuntu/Debian installation
        console.log(chalk.blue('Installing Docker for Ubuntu/Debian...'));
        execSync('sudo apt-get update', { stdio: 'inherit' });
        execSync('sudo apt-get install -y ca-certificates curl gnupg lsb-release', { stdio: 'inherit' });
        execSync('sudo mkdir -p /etc/apt/keyrings', { stdio: 'inherit' });
        execSync('curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg', { stdio: 'inherit' });
        execSync('echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null', { stdio: 'inherit' });
        execSync('sudo apt-get update', { stdio: 'inherit' });
        execSync('sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin', { stdio: 'inherit' });
      } else if (distro === 'rhel') {
        // Fedora/CentOS/RHEL installation
        console.log(chalk.blue('Installing Docker for Fedora/CentOS/RHEL...'));
        execSync('sudo yum install -y yum-utils', { stdio: 'inherit' });
        execSync('sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo', { stdio: 'inherit' });
        execSync('sudo yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin', { stdio: 'inherit' });
      } else if (distro === 'arch') {
        // Arch Linux installation
        console.log(chalk.blue('Installing Docker for Arch Linux...'));
        execSync('sudo pacman -S --noconfirm docker docker-compose', { stdio: 'inherit' });
      } else {
        return {
          success: false,
          error: 'Unsupported Linux distribution. Please install Docker manually.'
        };
      }

      // Start Docker service
      console.log(chalk.blue('Starting Docker service...'));
      execSync('sudo systemctl start docker', { stdio: 'inherit' });
      execSync('sudo systemctl enable docker', { stdio: 'inherit' });

      // Add user to docker group (optional, but helpful)
      try {
        const username = process.env.USER || os.userInfo().username;
        execSync(`sudo usermod -aG docker ${username}`, { stdio: 'inherit' });
        console.log(chalk.yellow(`Added ${username} to docker group. You may need to log out and back in for this to take effect.`));
      } catch (err) {
        // Ignore if this fails
      }

      // Wait a moment for Docker to start
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check if Docker is working
      if (this.isInstalled('docker') && this.isDockerDaemonRunning()) {
        return { success: true };
      } else {
        return {
          success: false,
          error: 'Docker installed but daemon not running. Please start it manually: sudo systemctl start docker'
        };
      }
    } catch (err) {
      return {
        success: false,
        error: `Docker installation failed: ${err.message}`
      };
    }
  }

  /**
   * Install Docker Compose (Linux only, usually comes with Docker Desktop)
   */
  async installDockerCompose() {
    if (!this.isLinux) {
      return { success: true }; // Comes with Docker Desktop on Windows/Mac
    }

    console.log(chalk.blue('Docker Compose should be installed with Docker. Checking...'));
    
    // Wait a moment
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    if (this.isDockerComposeInstalled()) {
      return { success: true };
    }

    // Try to install docker-compose-plugin
    try {
      execSync('sudo apt-get install -y docker-compose-plugin', { stdio: 'inherit' });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: 'Docker Compose installation failed. Please install it manually.'
      };
    }
  }

  /**
   * Start Docker daemon
   */
  async startDockerDaemon() {
    if (this.isWindows || this.isMac) {
      console.log(chalk.blue('Starting Docker Desktop...'));
      try {
        if (this.isWindows) {
          execSync('start "" "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe"', { stdio: 'ignore' });
        } else {
          execSync('open -a Docker', { stdio: 'ignore' });
        }
        
        console.log(chalk.yellow('Waiting for Docker Desktop to start (this may take a minute)...'));
        
        // Wait for Docker to start
        let attempts = 0;
        while (attempts < 30) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          if (this.isDockerDaemonRunning()) {
            return { success: true };
          }
          attempts++;
        }
        
        return {
          success: false,
          error: 'Docker Desktop is starting. Please wait for it to fully start and try again.'
        };
      } catch (err) {
        return {
          success: false,
          error: 'Could not start Docker Desktop. Please start it manually.'
        };
      }
    } else if (this.isLinux) {
      try {
        execSync('sudo systemctl start docker', { stdio: 'inherit' });
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (this.isDockerDaemonRunning()) {
          return { success: true };
        } else {
          return {
            success: false,
            error: 'Docker service started but daemon not responding. Please check: sudo systemctl status docker'
          };
        }
      } catch (err) {
        return {
          success: false,
          error: `Could not start Docker service: ${err.message}`
        };
      }
    }

    return {
      success: false,
      error: 'Could not start Docker daemon on this platform'
    };
  }

  /**
   * Install Node.js
   */
  async installNodejs() {
    console.log(chalk.blue('\nInstalling Node.js...'));

    if (this.isWindows) {
      return await this.installNodejsWindows();
    } else if (this.isMac) {
      return await this.installNodejsMac();
    } else if (this.isLinux) {
      return await this.installNodejsLinux();
    } else {
      return {
        success: false,
        error: 'Node.js installation not supported on this platform'
      };
    }
  }

  /**
   * Install Node.js on Windows
   */
  async installNodejsWindows() {
    console.log(chalk.yellow('For Windows, Node.js must be installed via the official installer.'));
    console.log(chalk.blue('Opening Node.js download page...'));

    try {
      execSync('start https://nodejs.org/', { stdio: 'ignore' });
    } catch (err) {
      // Ignore
    }

    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Have you installed Node.js? (The installer will check again)',
        default: false
      }
    ]);

    if (!proceed) {
      return {
        success: false,
        error: 'Node.js installation required'
      };
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    if (this.isNodeInstalled()) {
      return { success: true };
    } else {
      return {
        success: false,
        error: 'Node.js not found. Please install Node.js and restart the installer.'
      };
    }
  }

  /**
   * Install Node.js on macOS
   */
  async installNodejsMac() {
    // Check if Homebrew is available
    try {
      execSync('brew --version', { stdio: 'ignore' });
      
      const { useHomebrew } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'useHomebrew',
          message: 'Install Node.js via Homebrew?',
          default: true
        }
      ]);

      if (useHomebrew) {
        console.log(chalk.blue('Installing Node.js via Homebrew...'));
        try {
          execSync('brew install node', { stdio: 'inherit' });
          
          // Wait a moment
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          if (this.isNodeInstalled()) {
            return { success: true };
          } else {
            return {
              success: false,
              error: 'Node.js installed but not found in PATH. You may need to restart your terminal.'
            };
          }
        } catch (err) {
          return {
            success: false,
            error: `Homebrew installation failed: ${err.message}`
          };
        }
      }
    } catch (err) {
      // Homebrew not available
    }

    // Fallback to manual installation
    console.log(chalk.blue('Opening Node.js download page...'));
    try {
      execSync('open https://nodejs.org/');
    } catch (err) {
      // Ignore
    }

    const { proceed } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'proceed',
        message: 'Have you installed Node.js? (The installer will check again)',
        default: false
      }
    ]);

    if (!proceed) {
      return {
        success: false,
        error: 'Node.js installation required'
      };
    }

    await new Promise(resolve => setTimeout(resolve, 2000));

    if (this.isNodeInstalled()) {
      return { success: true };
    } else {
      return {
        success: false,
        error: 'Node.js not found. Please install Node.js and restart the installer.'
      };
    }
  }

  /**
   * Install Node.js on Linux
   */
  async installNodejsLinux() {
    // Check if we need sudo
    let needsSudo = true;
    try {
      execSync('node --version', { stdio: 'ignore' });
      needsSudo = false;
    } catch (err) {
      // Needs sudo or not installed
    }

    // Try using NodeSource repository (works for most distros)
    try {
      console.log(chalk.blue('Installing Node.js via NodeSource...'));
      
      if (needsSudo) {
        execSync('curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -', { stdio: 'inherit' });
        execSync('sudo apt-get install -y nodejs', { stdio: 'inherit' });
      } else {
        // Try without sudo (might work if user has permissions)
        try {
          execSync('curl -fsSL https://deb.nodesource.com/setup_20.x | bash -', { stdio: 'inherit' });
          execSync('apt-get install -y nodejs', { stdio: 'inherit' });
        } catch (err) {
          // Fall back to sudo
          execSync('curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -', { stdio: 'inherit' });
          execSync('sudo apt-get install -y nodejs', { stdio: 'inherit' });
        }
      }

      await new Promise(resolve => setTimeout(resolve, 1000));

      if (this.isNodeInstalled()) {
        return { success: true };
      } else {
        return {
          success: false,
          error: 'Node.js installed but not found. You may need to restart your terminal.'
        };
      }
    } catch (err) {
      // Try alternative method
      try {
        console.log(chalk.blue('Trying alternative installation method...'));
        execSync('sudo apt-get update', { stdio: 'inherit' });
        execSync('sudo apt-get install -y nodejs npm', { stdio: 'inherit' });
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        if (this.isNodeInstalled()) {
          return { success: true };
        }
      } catch (err2) {
        // Ignore
      }

      return {
        success: false,
        error: `Node.js installation failed: ${err.message}. Please install Node.js manually.`
      };
    }
  }

  /**
   * Install npm (usually comes with Node.js)
   */
  async installNpm() {
    // npm usually comes with Node.js, but if it doesn't, we can try to install it
    if (this.isLinux) {
      try {
        execSync('sudo apt-get install -y npm', { stdio: 'inherit' });
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: 'npm installation failed. Please install npm manually.'
        };
      }
    }

    return {
      success: false,
      error: 'npm should come with Node.js. Please reinstall Node.js.'
    };
  }

  /**
   * Install Python
   */
  async installPython() {
    console.log(chalk.blue('\nInstalling Python 3...'));

    if (this.isWindows) {
      console.log(chalk.yellow('For Windows, Python must be installed via the official installer.'));
      console.log(chalk.blue('Opening Python download page...'));
      try {
        execSync('start https://www.python.org/downloads/', { stdio: 'ignore' });
      } catch (err) {
        // Ignore
      }
      return {
        success: false,
        error: 'Please install Python manually from python.org'
      };
    } else if (this.isMac) {
      // Check if Homebrew is available
      try {
        execSync('brew --version', { stdio: 'ignore' });
        console.log(chalk.blue('Installing Python via Homebrew...'));
        execSync('brew install python3', { stdio: 'inherit' });
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: 'Python installation failed. Please install Python manually.'
        };
      }
    } else if (this.isLinux) {
      try {
        execSync('sudo apt-get update', { stdio: 'inherit' });
        execSync('sudo apt-get install -y python3 python3-pip', { stdio: 'inherit' });
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: `Python installation failed: ${err.message}`
        };
      }
    }

    return {
      success: false,
      error: 'Python installation not supported on this platform'
    };
  }
}

module.exports = DependencyInstaller;

