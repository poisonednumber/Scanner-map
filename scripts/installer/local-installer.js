/**
 * Local (non-Docker) installation logic
 */

const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const ServiceConfig = require('./service-config');
const EnvGenerator = require('./env-generator');

class LocalInstaller {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.serviceConfig = new ServiceConfig(projectRoot);
    this.envGenerator = new EnvGenerator(projectRoot);
  }

  /**
   * Check prerequisites for local installation
   */
  async checkPrerequisites() {
    const errors = [];
    const warnings = [];

    // Check Node.js
    try {
      const nodeVersion = execSync('node --version', { encoding: 'utf8' }).trim();
      const majorVersion = parseInt(nodeVersion.replace('v', '').split('.')[0]);
      if (majorVersion < 18) {
        errors.push(`Node.js version ${nodeVersion} is too old. Requires Node.js 18 or higher.`);
      }
    } catch (err) {
      errors.push('Node.js is not installed or not in PATH');
    }

    // Check npm
    try {
      execSync('npm --version', { stdio: 'ignore' });
    } catch (err) {
      errors.push('npm is not installed or not in PATH');
    }

    // Check Python (for transcription)
    try {
      execSync('python3 --version', { stdio: 'ignore' });
    } catch (err) {
      warnings.push('Python 3 not found. Local transcription will not work without Python.');
    }

    // Check if ports are available
    const ports = [3001, 3306];
    for (const port of ports) {
      try {
        // Try to check if port is in use (platform-specific)
        if (process.platform === 'win32') {
          execSync(`netstat -an | findstr :${port}`, { stdio: 'ignore' });
          warnings.push(`Port ${port} may be in use. Please verify.`);
        } else {
          execSync(`lsof -i :${port}`, { stdio: 'ignore' });
          warnings.push(`Port ${port} may be in use. Please verify.`);
        }
      } catch (err) {
        // Port appears to be free
      }
    }

    return {
      success: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Install npm dependencies
   */
  async installDependencies() {
    try {
      execSync('npm install', {
        cwd: this.projectRoot,
        stdio: 'inherit'
      });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Install local services
   */
  async install(config) {
    const {
      enableOllama = false,
      enableICAD = false,
      enableTrunkRecorder = false,
      enableRdioScanner = false,
      enableOP25 = false,
      enableSDRTrunk = false,
      radioSoftware = 'none',
      ...envConfig
    } = config;

    // Install npm dependencies
    const depsResult = await this.installDependencies();
    if (!depsResult.success) {
      return {
        success: false,
        error: 'Failed to install npm dependencies',
        details: depsResult.error
      };
    }

    // Create appdata structure
    await this.serviceConfig.createAppdataStructure();

    // Generate a single API key for radio software (shared across all)
    const { v4: uuidv4 } = require('uuid');
    const radioApiKey = (enableTrunkRecorder || enableRdioScanner || enableOP25 || enableSDRTrunk || radioSoftware !== 'none') 
      ? uuidv4() 
      : null;

    // Configure services
    const serviceResults = {
      trunkRecorder: (enableTrunkRecorder || radioSoftware === 'trunk-recorder')
        ? await this.serviceConfig.configureTrunkRecorder(true, 'local', radioApiKey)
        : null,
      sdrtrunk: (enableSDRTrunk || radioSoftware === 'sdrtrunk')
        ? await this.serviceConfig.configureSDRTrunk(true, 'local', radioApiKey)
        : null,
      rdioScanner: (enableRdioScanner || radioSoftware === 'rdio-scanner')
        ? await this.serviceConfig.configureRdioScanner(true, 'local', radioApiKey)
        : null,
      op25: (enableOP25 || radioSoftware === 'op25')
        ? await this.serviceConfig.configureOP25(true, 'local', radioApiKey)
        : null,
      icad: await this.serviceConfig.configureICAD(enableICAD, 'local'),
      ollama: await this.serviceConfig.configureOllama(enableOllama, 'local')
    };

    // Extract API key from service results
    const finalRadioApiKey = serviceResults.trunkRecorder?.apiKey || 
                             serviceResults.sdrtrunk?.apiKey || 
                             serviceResults.rdioScanner?.apiKey || 
                             serviceResults.op25?.apiKey || 
                             radioApiKey;

    // Generate .env file with local URLs
    const envPath = await this.envGenerator.generate({
      ...envConfig,
      installationType: 'local',
      enableICAD,
      icadUrl: enableICAD ? 'http://localhost:9912' : undefined,
      ollamaUrl: enableOllama ? 'http://localhost:11434' : undefined,
      trunkRecorderApiKey: finalRadioApiKey,
      radioApiKey: finalRadioApiKey,
      radioSoftware: radioSoftware
    });

    return {
      success: true,
      services: serviceResults,
      env: envPath,
      nextSteps: this.getNextSteps({
        enableOllama,
        enableICAD,
        enableTrunkRecorder: enableTrunkRecorder || radioSoftware === 'trunk-recorder',
        enableRdioScanner: enableRdioScanner || radioSoftware === 'rdio-scanner',
        enableOP25: enableOP25 || radioSoftware === 'op25',
        enableSDRTrunk: enableSDRTrunk || radioSoftware === 'sdrtrunk',
        radioSoftware: radioSoftware
      })
    };
  }

  /**
   * Get next steps for local installation
   */
  getNextSteps(services) {
    const steps = [];

    steps.push('1. Review the generated .env file and add any missing API keys');

    if (services.enableOllama) {
      steps.push('2. Install Ollama:');
      steps.push('   - Visit: https://ollama.com');
      steps.push('   - Install and start Ollama service');
      steps.push('   - Pull model: ollama pull <model>');
      steps.push('   - Ensure Ollama is running on http://localhost:11434');
    }

    if (services.enableICAD) {
      steps.push('3. Install iCAD Transcribe:');
      steps.push('   - See: https://github.com/TheGreatCodeholio/icad_transcribe');
      steps.push('   - Install and start iCAD service');
      steps.push('   - Change default password in appdata/icad-transcribe/.env');
      steps.push('   - Ensure iCAD is running on http://localhost:9912');
    }

    if (services.enableTrunkRecorder || services.radioSoftware === 'trunk-recorder') {
      steps.push('4. Install TrunkRecorder:');
      steps.push('   - See: https://github.com/TrunkRecorder/trunk-recorder');
      steps.push('   - Install and configure TrunkRecorder');
      steps.push('   - Configure radio system in appdata/trunk-recorder/config/config.json');
      steps.push('   - API key is already configured automatically');
    }
    
    if (services.enableSDRTrunk || services.radioSoftware === 'sdrtrunk') {
      steps.push('4. SDRTrunk setup:');
      steps.push('   - Configuration file generated: appdata/sdrtrunk/config/streaming-config.json');
      steps.push('   - Import this config into SDRTrunk desktop app');
      steps.push('   - See docs/RADIO-SOFTWARE.md for detailed instructions');
    }
    
    if (services.enableRdioScanner || services.radioSoftware === 'rdio-scanner') {
      steps.push('4. rdio-scanner setup:');
      steps.push('   - Configuration file generated: appdata/rdio-scanner/config/config.json');
      steps.push('   - Downstream server is already configured');
      steps.push('   - See docs/RADIO-SOFTWARE.md for detailed instructions');
    }
    
    if (services.enableOP25 || services.radioSoftware === 'op25') {
      steps.push('4. OP25 setup:');
      steps.push('   - Configuration file generated: appdata/op25/config/config.json');
      steps.push('   - Upload server is already configured');
      steps.push('   - See docs/RADIO-SOFTWARE.md for detailed instructions');
    }

    steps.push('5. Start Scanner Map: npm start');
    steps.push('6. Access web interface: http://localhost:3001');

    return steps;
  }

  /**
   * Setup auto-start on boot (systemd/launchd/scheduled task)
   */
  async setupAutostart() {
    const platform = process.platform;
    const projectPath = this.projectRoot;

    if (platform === 'linux') {
      return this.setupSystemd(projectPath);
    } else if (platform === 'darwin') {
      return this.setupLaunchd(projectPath);
    } else if (platform === 'win32') {
      return this.setupScheduledTask(projectPath);
    } else {
      return {
        success: false,
        error: 'Auto-start not supported on this platform'
      };
    }
  }

  async setupSystemd(projectPath) {
    try {
      const serviceContent = `[Unit]
Description=Scanner Map Service
After=network.target

[Service]
Type=simple
User=${process.env.USER || 'root'}
WorkingDirectory=${projectPath}
ExecStart=/usr/bin/node ${projectPath}/bot.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
`;

      const servicePath = `/etc/systemd/system/scanner-map.service`;
      execSync(`echo '${serviceContent}' | sudo tee ${servicePath}`, { stdio: 'inherit' });
      execSync('sudo systemctl daemon-reload', { stdio: 'inherit' });
      execSync('sudo systemctl enable scanner-map.service', { stdio: 'inherit' });

      return {
        success: true,
        message: 'Systemd service created and enabled'
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  async setupLaunchd(projectPath) {
    try {
      const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.scanner-map</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>${projectPath}/bot.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${projectPath}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
`;

      const plistPath = path.join(process.env.HOME, 'Library/LaunchAgents/com.scanner-map.plist');
      await fs.writeFile(plistPath, plistContent);
      execSync(`launchctl load ${plistPath}`, { stdio: 'inherit' });

      return {
        success: true,
        message: 'Launchd service created and enabled'
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  async setupScheduledTask(projectPath) {
    try {
      const scriptPath = path.join(projectPath, 'start-scanner-map.bat');
      const scriptContent = `@echo off
cd /d "${projectPath}"
node bot.js
`;

      await fs.writeFile(scriptPath, scriptContent);

      const taskName = 'Scanner Map Auto-Start';
      const command = `schtasks /create /tn "${taskName}" /tr "\\"${scriptPath}\\"" /sc onstart /ru SYSTEM /f`;
      execSync(command, { stdio: 'inherit' });

      return {
        success: true,
        message: 'Scheduled task created'
      };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }
}

module.exports = LocalInstaller;






