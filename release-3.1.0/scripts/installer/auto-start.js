/**
 * Auto-start Configuration
 * Sets up Scanner Map to start automatically on system boot
 */

const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');
const chalk = require('chalk');

class AutoStart {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.platform = process.platform;
  }

  /**
   * Configure auto-start based on platform
   */
  async configure(installationType, config) {
    if (this.platform === 'win32') {
      return this.configureWindows(installationType, config);
    } else if (this.platform === 'linux') {
      return this.configureLinux(installationType, config);
    } else if (this.platform === 'darwin') {
      return this.configureMacOS(installationType, config);
    } else {
      return {
        success: false,
        error: 'Auto-start not supported on this platform'
      };
    }
  }

  /**
   * Windows: Create scheduled task or startup shortcut
   */
  async configureWindows(installationType, config) {
    try {
      const startupDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
      await fs.ensureDir(startupDir);

      if (installationType === 'docker') {
        // Create batch file for Docker
        const batPath = path.join(startupDir, 'Scanner-Map.bat');
        const batContent = `@echo off
cd /d "${this.projectRoot}"
docker-compose up -d
`;
        await fs.writeFile(batPath, batContent);
      } else {
        // Create batch file for local
        const batPath = path.join(startupDir, 'Scanner-Map.bat');
        const batContent = `@echo off
cd /d "${this.projectRoot}"
start "Scanner Map" cmd /k "npm start"
`;
        await fs.writeFile(batPath, batContent);
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Linux: Create systemd service
   */
  async configureLinux(installationType, config) {
    try {
      const serviceName = 'scanner-map.service';
      const servicePath = `/etc/systemd/system/${serviceName}`;
      
      let serviceContent;
      if (installationType === 'docker') {
        serviceContent = `[Unit]
Description=Scanner Map Docker Services
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${this.projectRoot}
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
User=${os.userInfo().username}

[Install]
WantedBy=multi-user.target
`;
      } else {
        const nodePath = execSync('which node', { encoding: 'utf8' }).trim();
        const npmPath = execSync('which npm', { encoding: 'utf8' }).trim();
        
        serviceContent = `[Unit]
Description=Scanner Map
After=network.target

[Service]
Type=simple
User=${os.userInfo().username}
WorkingDirectory=${this.projectRoot}
ExecStart=${nodePath} ${this.projectRoot}/bot.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
`;
      }

      // Write service file (requires sudo)
      const tempPath = path.join(this.projectRoot, serviceName);
      await fs.writeFile(tempPath, serviceContent);
      
      console.log(chalk.yellow('   ⚠️  Auto-start requires sudo privileges.'));
      console.log(chalk.gray('   Run this command to enable:'));
      console.log(chalk.cyan(`     sudo cp ${tempPath} ${servicePath}`));
      console.log(chalk.cyan(`     sudo systemctl daemon-reload`));
      console.log(chalk.cyan(`     sudo systemctl enable ${serviceName}`));
      console.log(chalk.cyan(`     sudo systemctl start ${serviceName}\n`));

      return {
        success: true,
        requiresSudo: true,
        commands: [
          `sudo cp ${tempPath} ${servicePath}`,
          `sudo systemctl daemon-reload`,
          `sudo systemctl enable ${serviceName}`,
          `sudo systemctl start ${serviceName}`
        ]
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * macOS: Create launchd plist
   */
  async configureMacOS(installationType, config) {
    try {
      const plistName = 'com.scannermap.plist';
      const plistDir = path.join(os.homedir(), 'Library', 'LaunchAgents');
      await fs.ensureDir(plistDir);
      const plistPath = path.join(plistDir, plistName);

      let plistContent;
      if (installationType === 'docker') {
        plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.scannermap</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/docker</string>
    <string>compose</string>
    <string>-f</string>
    <string>${path.join(this.projectRoot, 'docker-compose.yml')}</string>
    <string>up</string>
    <string>-d</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${this.projectRoot}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
</dict>
</plist>
`;
      } else {
        const nodePath = execSync('which node', { encoding: 'utf8' }).trim();
        plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.scannermap</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${path.join(this.projectRoot, 'bot.js')}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${this.projectRoot}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
`;
      }

      await fs.writeFile(plistPath, plistContent);
      
      // Load the launchd service
      try {
        execSync(`launchctl load ${plistPath}`, { stdio: 'ignore' });
      } catch (err) {
        // May already be loaded
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }
}

module.exports = AutoStart;

