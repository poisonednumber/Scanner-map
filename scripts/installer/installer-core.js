/**
 * Scanner Map - Interactive Installer
 * Unified setup for both Docker and Local installations
 * 
 * Auto-configures all service URLs and ports based on installation type.
 * No manual port/URL configuration required.
 * 
 * Note: Many configuration options (location, GPU, dependencies, auto-start, etc.)
 * have been moved to the web UI for easier management after installation.
 * This installer focuses on initial setup only.
 */

const inquirer = require('inquirer');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const DockerInstaller = require('./docker-installer');
const LocalInstaller = require('./local-installer');
const DependencyInstaller = require('./dependency-installer');
const GPUDetector = require('./gpu-detector');
const ModelRecommendations = require('./model-recommendations');
const WhisperDownloader = require('./whisper-downloader');
const AutoStart = require('./auto-start');
const UpdateChecker = require('./update-checker');
const PathSelector = require('./path-selector');

// Default configurations for all services
const DEFAULTS = {
  // Scanner Map ports
  WEBSERVER_PORT: 3001,
  BOT_PORT: 3306,
  
  // Ollama - Local AI service
  OLLAMA_PORT: 11434,
  OLLAMA_MODEL: 'llama3.1:8b',
  
  // iCAD Transcribe - Advanced transcription
  ICAD_PORT: 9912,
  ICAD_PROFILE: 'default',
  
  // Faster Whisper Server (remote transcription)
  WHISPER_SERVER_PORT: 8000,
  
  // Default Whisper model for local transcription
  WHISPER_MODEL: 'small',
  
  // OpenAI defaults
  OPENAI_MODEL: 'gpt-4o-mini',
  OPENAI_TRANSCRIPTION_MODEL: 'whisper-1'
};

// Service URLs based on installation type
const SERVICE_URLS = {
  docker: {
    ollama: `http://ollama:${DEFAULTS.OLLAMA_PORT}`,
    icad: `http://icad-transcribe:${DEFAULTS.ICAD_PORT}`,
    scannerMap: `http://scanner-map:${DEFAULTS.BOT_PORT}`
  },
  local: {
    ollama: `http://localhost:${DEFAULTS.OLLAMA_PORT}`,
    icad: `http://localhost:${DEFAULTS.ICAD_PORT}`,
    scannerMap: `http://localhost:${DEFAULTS.BOT_PORT}`
  }
};

class InstallerCore {
  constructor(projectRoot) {
    this.originalProjectRoot = projectRoot;
    this.projectRoot = projectRoot;
    this.pathSelector = new PathSelector(projectRoot);
    this.dockerInstaller = new DockerInstaller(projectRoot);
    this.localInstaller = new LocalInstaller(projectRoot);
    this.dependencyInstaller = new DependencyInstaller();
    this.gpuDetector = new GPUDetector();
    this.whisperDownloader = new WhisperDownloader(projectRoot);
    this.autoStart = new AutoStart(projectRoot);
    this.updateChecker = new UpdateChecker(projectRoot);
  }

  /**
   * Update project root after path selection
   */
  updateProjectRoot(newRoot) {
    this.projectRoot = newRoot;
    this.dockerInstaller = new DockerInstaller(newRoot);
    this.localInstaller = new LocalInstaller(newRoot);
    this.whisperDownloader = new WhisperDownloader(newRoot);
    this.autoStart = new AutoStart(newRoot);
    this.updateChecker = new UpdateChecker(newRoot);
  }

  /**
   * Check if running in interactive mode
   */
  isInteractive() {
    return process.stdin.isTTY && process.stdout.isTTY;
  }

  /**
   * Print a section header
   */
  printHeader(title) {
    console.log(chalk.blue.bold('\n' + '═'.repeat(50)));
    console.log(chalk.blue.bold(`  ${title}`));
    console.log(chalk.blue.bold('═'.repeat(50) + '\n'));
  }

  /**
   * Print a step indicator
   */
  printStep(step, total, description) {
    console.log(chalk.cyan(`[${step}/${total}]`) + ' ' + chalk.white(description));
  }

  /**
   * Generate a random API key
   */
  generateApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = '';
    for (let i = 0; i < 32; i++) {
      key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
  }

  /**
   * Detect public domain/IP (for Discord links)
   */
  detectPublicDomain() {
    // Default to localhost - most users run locally
    // For remote access, users can edit .env
    try {
      // Try to get local network IP (for LAN access)
      const os = require('os');
      const networkInterfaces = os.networkInterfaces();
      
      for (const interfaceName of Object.keys(networkInterfaces)) {
        const addresses = networkInterfaces[interfaceName];
        for (const addr of addresses) {
          // Skip internal and IPv6
          if (addr.family === 'IPv4' && !addr.internal) {
            // Prefer 192.168.x.x or 10.x.x.x (common LAN ranges)
            if (addr.address.startsWith('192.168.') || addr.address.startsWith('10.')) {
              return addr.address;
            }
          }
        }
      }
    } catch (err) {
      // Ignore errors, fall back to localhost
    }
    
    return 'localhost';
  }

  /**
   * Main installation flow
   */
  async run() {
    this.printHeader('Scanner Map Setup');
    console.log(chalk.gray('Welcome! This installer will guide you through initial setup.'));
    console.log(chalk.gray('Service URLs and ports are auto-configured.'));
    console.log(chalk.blue('💡 After installation, use the web UI to configure location, GPU, dependencies, and more.\n'));

    if (!this.isInteractive()) {
      console.log(chalk.red('\n❌ Error: This installer requires an interactive terminal.'));
      console.log(chalk.yellow('   Run this script directly in a terminal window.'));
      process.exit(1);
    }

    // Step 1: Choose installation mode (before location in simple mode)
    this.printStep(1, 6, 'Choose installation mode');
    const { installMode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'installMode',
        message: 'Installation mode:',
        choices: [
          { 
            name: '🚀 Simple Mode (One-Click) - Minimal prompts, get to web UI fast', 
            value: 'simple',
            short: 'Simple'
          },
          { 
            name: '⚙️  Advanced Mode - Configure all options manually', 
            value: 'advanced',
            short: 'Advanced'
          }
        ],
        default: 'simple'
      }
    ]);
    const isSimpleMode = installMode === 'simple';
    const isAdvancedMode = installMode === 'advanced';
    console.log(chalk.green(`✓ ${isSimpleMode ? 'Simple' : 'Advanced'} mode selected\n`));

    // Calculate total steps based on mode
    const totalSteps = isSimpleMode ? 2 : (isAdvancedMode ? 6 : 5);

    // Location selection (skip in simple mode, use current directory)
    let locationResult = { success: true, moved: false, installPath: this.projectRoot };
    if (!isSimpleMode) {
      this.printStep(2, totalSteps, 'Choose installation location');
      locationResult = await this.configureInstallLocation();
      if (!locationResult.success) {
        console.log(chalk.red(`\n❌ ${locationResult.error}\n`));
        process.exit(1);
      }
      
      // Update project root if moved
      if (locationResult.moved) {
        this.updateProjectRoot(locationResult.installPath);
        // Change to new directory
        process.chdir(locationResult.installPath);
        console.log(chalk.green(`✓ Changed working directory to: ${locationResult.installPath}\n`));
      }
      console.log('');
    } else {
      // Simple mode: Use current directory automatically
      console.log(chalk.gray(`   Using current directory: ${this.projectRoot}\n`));
    }

    // Step 2 (simple) or 3 (advanced): Choose installation type
    this.printStep(isSimpleMode ? 2 : 3, totalSteps, 'Choose installation method');
    const { installationType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'installationType',
        message: 'How would you like to install Scanner Map?',
        choices: [
          { 
            name: '🐳 Docker (Recommended) - Isolated containers, includes all services', 
            value: 'docker',
            short: 'Docker'
          },
          { 
            name: '💻 Local - Run directly on your system', 
            value: 'local',
            short: 'Local'
          }
        ],
        default: 'docker'
      }
    ]);
    console.log(chalk.green(`✓ ${installationType === 'docker' ? 'Docker' : 'Local'} installation selected\n`));

    let currentStep = 4;
    let integrationConfig = {};
    let advancedConfig = {};
    let serviceConfig = {};

    if (isSimpleMode) {
      // Simple mode: Skip all configuration, use defaults
      console.log(chalk.blue('💡 Simple Mode: Using default settings. Configure everything via web UI after installation.\n'));
      
      // Use all defaults (ollama for AI since it doesn't require API key)
      serviceConfig = {
        transcriptionMode: 'local',
        transcriptionDevice: 'cpu',
        whisperModel: 'small',
        aiProvider: 'ollama' // Use ollama by default - can be changed via web UI
      };
      
      // No integrations in simple mode
      integrationConfig = {
        enableDiscord: false,
        discordToken: '',
        clientId: '',
        radioSoftware: 'none',
        enableTrunkRecorder: false,
        enableSDRTrunk: false,
        enableRdioScanner: false,
        enableOP25: false
      };
      
      // No advanced config
      advancedConfig = {};
      
      // Quick prerequisites check (non-blocking)
      console.log(chalk.gray('   Checking system requirements...'));
      const prereqResult = await this.checkPrerequisites(installationType);
      if (!prereqResult.success) {
        console.log(chalk.yellow('   ⚠️  Some requirements may be missing. Install them via the web UI after installation.\n'));
      } else {
        console.log(chalk.green('   ✓ System requirements OK\n'));
      }
    } else {
      // Advanced/Quick mode: Keep existing flow
      // Step 4: Check prerequisites (warn only - installation via web UI)
      this.printStep(currentStep++, totalSteps, 'Checking system requirements');
      const prereqResult = await this.checkPrerequisites(installationType);
      if (!prereqResult.success) {
        // Don't exit - just warn, dependencies can be installed via web UI
      }
      console.log(chalk.green('✓ Prerequisites checked\n'));
      console.log(chalk.gray('💡 Missing dependencies can be installed via the web UI after installation.\n'));

      // Step 5: Skip transcription and AI configuration (configured via web UI)
      // Transcription and AI services are configured via the web UI after installation
      // Use safe defaults that can be changed later
      serviceConfig = {
        transcriptionMode: 'local', // Default, can be changed in web UI
        transcriptionDevice: 'cpu', // Default, can be changed in web UI
        whisperModel: 'small', // Default, can be changed in web UI
        aiProvider: 'openai' // Default, can be changed in web UI (requires API key via web UI)
      };
      console.log(chalk.gray('💡 Transcription and AI services will be configured via the web UI after installation.\n'));

      // Step 6: Optional integrations (Discord, radio software)
      this.printStep(currentStep++, totalSteps, 'Optional integrations');
      integrationConfig = await this.configureIntegrations(installationType);
      console.log('');

      // Step 7: Advanced configuration (only in advanced mode)
      // Note: Location, GPU, and other settings are configured via web UI
      if (isAdvancedMode) {
        this.printStep(currentStep++, totalSteps, 'Advanced configuration');
        advancedConfig = await this.configureAdvanced(installationType, serviceConfig);
        console.log('');
      }
    }

    // Final step: Review and install
    this.printStep(currentStep++, totalSteps, 'Review and install');
    
    // Build final configuration with auto-configured URLs
    const urls = SERVICE_URLS[installationType];
    const config = {
      // Installation type
      installationType,
      
      // Core settings (auto-configured or manual in advanced mode)
      webserverPort: advancedConfig.webserverPort || DEFAULTS.WEBSERVER_PORT,
      botPort: advancedConfig.botPort || DEFAULTS.BOT_PORT,
      publicDomain: advancedConfig.publicDomain || this.detectPublicDomain(),
      timezone: advancedConfig.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
      
      // Transcription (defaults - configured via web UI)
      transcriptionMode: serviceConfig.transcriptionMode || 'local',
      transcriptionDevice: serviceConfig.transcriptionDevice || 'cpu',
      whisperModel: serviceConfig.whisperModel || DEFAULTS.WHISPER_MODEL,
      fasterWhisperServerUrl: undefined, // Configured via web UI
      
      // iCAD (not enabled by default - configure via web UI)
      enableICAD: false, // User enables via web UI if needed
      icadUrl: installationType === 'docker' ? urls.icad : undefined,
      icadProfile: DEFAULTS.ICAD_PROFILE,
      icadApiKey: this.generateApiKey(), // Generated for when user enables iCAD via web UI
      
      // AI Provider (defaults - API keys configured via web UI)
      // Use ollama by default for simple mode (works without API key), openai for advanced mode
      aiProvider: serviceConfig.aiProvider || (isSimpleMode ? 'ollama' : 'openai'),
      openaiApiKey: undefined, // User configures via web UI
      openaiModel: DEFAULTS.OPENAI_MODEL,
      ollamaUrl: urls.ollama, // Always set based on installation type (docker or local)
      ollamaModel: DEFAULTS.OLLAMA_MODEL,
      enableOllama: false, // User enables via web UI if needed
      
      // Integrations
      enableDiscord: integrationConfig.enableDiscord,
      discordToken: integrationConfig.discordToken || '',
      clientId: integrationConfig.clientId || '',
      radioSoftware: integrationConfig.radioSoftware || 'none',
      enableTrunkRecorder: integrationConfig.enableTrunkRecorder || false,
      enableSDRTrunk: integrationConfig.enableSDRTrunk || false,
      enableRdioScanner: integrationConfig.enableRdioScanner || false,
      enableOP25: integrationConfig.enableOP25 || false,
      
      // GPU acceleration (Docker only) - configured via web UI after installation
      enableGPU: false,
      
      // Auto-generated API key for TrunkRecorder/SDRTrunk
      trunkRecorderApiKey: this.generateApiKey(),
      
      // Geocoding (auto-configured or manual in advanced mode)
      // Note: Location configuration is done via web UI after installation
      geocodingProvider: advancedConfig.geocodingProvider || 'nominatim',
      googleMapsApiKey: advancedConfig.googleMapsApiKey || '',
      locationiqApiKey: advancedConfig.locationiqApiKey || '',
      
      // Storage (advanced mode only)
      storageMode: advancedConfig.storageMode || 'local',
      s3Endpoint: advancedConfig.s3Endpoint || '',
      s3BucketName: advancedConfig.s3BucketName || '',
      s3AccessKeyId: advancedConfig.s3AccessKeyId || '',
      s3SecretAccessKey: advancedConfig.s3SecretAccessKey || '',
      
      // Authentication (advanced mode only)
      enableAuth: advancedConfig.enableAuth || false,
      webserverPassword: advancedConfig.webserverPassword || '',
      sessionDurationDays: advancedConfig.sessionDurationDays || 7,
      maxSessionsPerUser: advancedConfig.maxSessionsPerUser || 5,
      
      // Talk Groups (advanced mode only)
      enableMappedTalkGroups: advancedConfig.enableMappedTalkGroups !== undefined ? advancedConfig.enableMappedTalkGroups : true,
      mappedTalkGroups: advancedConfig.mappedTalkGroups || '',
      
      // Two-Tone Detection (advanced mode only)
      enableTwoToneMode: advancedConfig.enableTwoToneMode || false,
      twoToneTalkGroups: advancedConfig.twoToneTalkGroups || '',
      
      // OpenAI Transcription (advanced mode only)
      openaiTranscriptionPrompt: advancedConfig.openaiTranscriptionPrompt || '',
      openaiTranscriptionModel: advancedConfig.openaiTranscriptionModel || 'whisper-1',
      openaiTranscriptionTemperature: advancedConfig.openaiTranscriptionTemperature || 0,
      
      // Post-installation options (always open web UI, auto-start/auto-update configured via web UI)
      openWebUI: true,
      enableAutoStart: false,
      enableAutoUpdate: false
    };

    // Show summary (simplified for simple mode)
    if (!isSimpleMode) {
      await this.showSummary(config, isSimpleMode);
    } else {
      // Simple mode: Just show a brief summary
      console.log(chalk.blue.bold('\n📋 Installation Summary\n'));
      console.log(chalk.gray('   Installation Type:') + ` ${config.installationType === 'docker' ? 'Docker' : 'Local'}`);
      console.log(chalk.gray('   Web UI Port:') + ` ${config.webserverPort}`);
      console.log(chalk.gray('   API Port:') + ` ${config.botPort}`);
      console.log(chalk.gray('   Geocoding:') + ` ${config.geocodingProvider} (free)`);
      console.log(chalk.blue('\n   💡 All other settings use defaults. Configure via web UI after installation.\n'));
    }
    
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: chalk.bold(isSimpleMode ? 'Ready to install? This will take a few minutes.' : 'Proceed with installation?'),
        default: true
      }
    ]);

    if (!confirm) {
      console.log(chalk.yellow('\n⚠ Setup cancelled.'));
      process.exit(0);
    }

    // Install
    console.log(chalk.blue.bold('\n🚀 Installing...\n'));
    let result;
    if (installationType === 'docker') {
      result = await this.dockerInstaller.install(config);
    } else {
      result = await this.localInstaller.install(config);
      
      // Pre-download Whisper model for local installations
      if (config.transcriptionMode === 'local' && config.whisperModel) {
        console.log(chalk.blue('\n📥 Pre-downloading Whisper model...\n'));
        const downloadResult = await this.whisperDownloader.downloadModel(
          config.whisperModel,
          config.transcriptionDevice || 'cpu'
        );
        if (!downloadResult.success && !downloadResult.skip) {
          console.log(chalk.yellow(`⚠ Could not pre-download model: ${downloadResult.error}`));
          console.log(chalk.gray('   Model will be downloaded automatically on first transcription.\n'));
        }
      }
    }

    if (!result.success) {
      console.log(chalk.red(`\n❌ Setup failed: ${result.error}`));
      
      // If npm install failed due to PATH issue, offer to restart
      if (result.needsRestart || (result.details && result.details.includes('restart'))) {
        console.log(chalk.blue.bold('\n🔄 Node.js/npm was just installed.'));
        console.log(chalk.blue('   The installer needs to be restarted for the new PATH to take effect.\n'));
        
        const { restart } = await inquirer.prompt([{
          type: 'confirm',
          name: 'restart',
          message: chalk.bold('Would you like to restart the installer now?'),
          default: true
        }]);
        
        if (restart) {
          // Ask if user wants to update installer from repo before restarting
          const { updateInstaller } = await inquirer.prompt([{
            type: 'confirm',
            name: 'updateInstaller',
            message: chalk.bold('Update installer from repository before restarting?'),
            default: true
          }]);
          
          if (updateInstaller) {
            console.log(chalk.blue('\n📥 Updating installer from repository...\n'));
            try {
              const { execSync } = require('child_process');
              // Check if we're in a git repository
              try {
                execSync('git rev-parse --git-dir', { 
                  cwd: this.projectRoot, 
                  stdio: 'ignore' 
                });
                
                // Pull latest changes
                console.log(chalk.gray('   Pulling latest changes...'));
                execSync('git pull', {
                  cwd: this.projectRoot,
                  stdio: 'inherit'
                });
                console.log(chalk.green('   ✓ Installer updated successfully\n'));
              } catch (gitErr) {
                console.log(chalk.yellow('   ⚠ Not a git repository or git pull failed'));
                console.log(chalk.gray('   Continuing with restart...\n'));
              }
            } catch (err) {
              console.log(chalk.yellow(`   ⚠ Update failed: ${err.message}`));
              console.log(chalk.gray('   Continuing with restart...\n'));
            }
          }
          
          console.log(chalk.blue('🔄 Restarting installer...\n'));
          console.log(chalk.gray('   Please wait a moment for Node.js to be available in PATH...\n'));
          
          // Wait a bit for PATH to update (especially on Windows)
          await new Promise(resolve => setTimeout(resolve, 3000));
          
          // Try to restart the installer
          const path = require('path');
          const { spawn } = require('child_process');
          
          // On Windows, try to use cmd.exe to get fresh PATH
          if (process.platform === 'win32') {
            const installerScript = path.join(__dirname, 'installer-core.js');
            const child = spawn('cmd.exe', ['/c', 'node', installerScript], {
              cwd: this.projectRoot,
              stdio: 'inherit',
              detached: true,
              shell: true
            });
            child.unref();
          } else {
            // On Unix-like systems, try to refresh PATH
            const installerScript = path.join(__dirname, 'installer-core.js');
            const child = spawn('bash', ['-c', `source ~/.bashrc 2>/dev/null || true; node "${installerScript}"`], {
              cwd: this.projectRoot,
              stdio: 'inherit',
              detached: true
            });
            child.unref();
          }
          
          process.exit(0);
        } else {
          console.log(chalk.yellow('\n⚠️  Please restart the installer manually after Node.js is available in your PATH.'));
          console.log(chalk.cyan('   Run the installer again:'));
          if (process.platform === 'win32') {
            console.log(chalk.cyan('      install.bat'));
          } else {
            console.log(chalk.cyan('      bash install.sh'));
          }
        }
      }
      
      process.exit(1);
    }

    // Show success
    await this.showSuccess(config, installationType, result);
  }

  /**
   * Check prerequisites (warn only, no installation)
   */
  async checkPrerequisites(installationType) {
    process.stdout.write(chalk.gray('   Verifying prerequisites...'));
    
    let prerequisites;
    if (installationType === 'docker') {
      prerequisites = await this.dockerInstaller.checkPrerequisites();
    } else {
      prerequisites = await this.localInstaller.checkPrerequisites();
    }

    process.stdout.write('\r' + ' '.repeat(50) + '\r');

    if (!prerequisites.success) {
      console.log(chalk.yellow('⚠ Some prerequisites are missing:\n'));
      prerequisites.errors.forEach(err => console.log(chalk.yellow(`   • ${err}`)));
      if (prerequisites.warnings && prerequisites.warnings.length > 0) {
        prerequisites.warnings.forEach(warn => console.log(chalk.yellow(`   • ${warn}`)));
      }
      console.log(chalk.gray('\n💡 You can install missing dependencies via the web UI after installation.'));
      console.log(chalk.gray('   The installer will continue, but some features may not work until dependencies are installed.\n'));
    }

    return { success: true };
  }

  /**
   * Configure installation location
   */
  async configureInstallLocation() {
    console.log(chalk.gray('   Choose where to install Scanner Map.\n'));

    const defaultPaths = this.pathSelector.getDefaultPaths();
    const recommendedPath = this.pathSelector.getRecommendedPath();

    const { installPath } = await inquirer.prompt([
      {
        type: 'list',
        name: 'installPath',
        message: 'Installation location:',
        choices: defaultPaths.map(p => ({
          name: p.name,
          value: p.value,
          description: p.description
        })),
        default: recommendedPath
      }
    ]);

    let finalPath = installPath;

    // Handle custom path input
    if (installPath === 'custom') {
      const { customPath } = await inquirer.prompt([
        {
          type: 'input',
          name: 'customPath',
          message: 'Enter installation path:',
          validate: (input) => {
            const validation = this.pathSelector.validatePath(input.trim());
            if (!validation.valid) {
              return validation.error;
            }
            return true;
          },
          filter: (input) => input.trim()
        }
      ]);
      finalPath = this.pathSelector.validatePath(customPath).path;
    }

    // Check if elevation is needed
    const needsElevation = this.pathSelector.requiresElevation(finalPath);
    if (needsElevation) {
      console.log(chalk.yellow(`\n   ⚠️  This location may require administrator/sudo privileges.`));
      console.log(chalk.gray(`   You may be prompted for elevation during installation.\n`));
    }

    // Move files if needed
    if (path.resolve(finalPath) !== path.resolve(this.originalProjectRoot)) {
      const moveResult = await this.pathSelector.moveToInstallPath(finalPath);
      if (!moveResult.success) {
        return {
          success: false,
          error: moveResult.error || 'Failed to move installation files'
        };
      }
      return {
        success: true,
        installPath: finalPath,
        moved: moveResult.moved,
        needsElevation: needsElevation
      };
    }

    return {
      success: true,
      installPath: finalPath,
      moved: false,
      needsElevation: needsElevation
    };
  }

  /**
   * Configure location for geocoding
   * @deprecated This method is kept for web UI use. Location configuration is now done via web UI.
   */
  async configureLocation() {
    console.log(chalk.gray('   Your location helps accurately geocode addresses from radio calls.\n'));

    // Try to detect location from timezone
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    let detectedCity = 'Baltimore';
    let detectedState = 'MD';
    let detectedCountry = 'us';
    
    // Simple timezone-based detection
    if (timezone.includes('New_York') || timezone.includes('America/New_York')) {
      detectedCity = 'New York';
      detectedState = 'NY';
    } else if (timezone.includes('Los_Angeles') || timezone.includes('America/Los_Angeles')) {
      detectedCity = 'Los Angeles';
      detectedState = 'CA';
    } else if (timezone.includes('Chicago') || timezone.includes('America/Chicago')) {
      detectedCity = 'Chicago';
      detectedState = 'IL';
    } else if (timezone.includes('Denver') || timezone.includes('America/Denver')) {
      detectedCity = 'Denver';
      detectedState = 'CO';
    } else if (timezone.includes('Phoenix') || timezone.includes('America/Phoenix')) {
      detectedCity = 'Phoenix';
      detectedState = 'AZ';
    } else if (timezone.includes('Toronto') || timezone.includes('America/Toronto')) {
      detectedCity = 'Toronto';
      detectedState = 'ON';
      detectedCountry = 'ca';
    } else if (timezone.includes('London') || timezone.includes('Europe/London')) {
      detectedCity = 'London';
      detectedState = 'England';
      detectedCountry = 'uk';
    }
    
    // Detect country from timezone
    if (timezone.startsWith('America/')) {
      detectedCountry = 'us';
    } else if (timezone.startsWith('Europe/')) {
      detectedCountry = 'uk';
    } else if (timezone.startsWith('Australia/')) {
      detectedCountry = 'au';
    } else if (timezone.startsWith('Asia/')) {
      detectedCountry = 'us'; // Default, user can change
    }

    console.log(chalk.gray(`   Detected timezone: ${timezone}`));
    if (detectedCity !== 'Baltimore') {
      console.log(chalk.gray(`   Suggested location: ${detectedCity}, ${detectedState}\n`));
    } else {
      console.log('');
    }
    
    return await inquirer.prompt([
      {
        type: 'input',
        name: 'geocodingCity',
        message: 'Primary city/area:',
        default: detectedCity,
        validate: input => input.trim().length > 0 || 'City is required'
      },
      {
        type: 'input',
        name: 'geocodingState',
        message: 'State/province code (e.g., MD, CA, NY):',
        default: detectedState,
        filter: input => input.toUpperCase(),
        validate: input => input.trim().length > 0 || 'State is required'
      },
      {
        type: 'input',
        name: 'geocodingCountry',
        message: 'Country code (e.g., us, uk, ca):',
        default: detectedCountry,
        filter: input => input.toLowerCase(),
        validate: input => input.trim().length > 0 || 'Country is required'
      },
      {
        type: 'input',
        name: 'geocodingTargetCounties',
        message: 'Target counties (comma-separated, for filtering):',
        default: detectedCity === 'Baltimore' ? 'Baltimore,Baltimore City,Anne Arundel' : `${detectedCity} County`
      }
    ]);
  }

  /**
   * Configure transcription and AI services
   */
  async configureServices(installationType) {
    console.log(chalk.gray('   Choose how to transcribe audio and analyze calls.\n'));
    
    // Transcription method
    const transcriptionChoices = [
      { 
        name: '🏠 Local Whisper - Free, runs on your machine', 
        value: 'local',
        short: 'Local'
      },
      { 
        name: '☁️  OpenAI Whisper - Fast cloud transcription ($0.006/min)', 
        value: 'openai',
        short: 'OpenAI'
      }
    ];

    // Add Docker-specific options
    if (installationType === 'docker') {
      transcriptionChoices.push({ 
        name: '📡 iCAD Transcribe - Included in Docker, optimized for radio', 
        value: 'icad',
        short: 'iCAD'
      });
      transcriptionChoices.push({ 
        name: '🌐 Remote iCAD - Connect to remote iCAD server', 
        value: 'icad-remote',
        short: 'Remote iCAD'
      });
    }

    transcriptionChoices.push({ 
      name: '🌐 Remote Server - Use external Whisper server', 
      value: 'remote',
      short: 'Remote'
    });

    const { transcriptionMode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'transcriptionMode',
        message: 'Transcription method:',
        choices: transcriptionChoices,
        default: installationType === 'docker' ? 'icad' : 'local'
      }
    ]);

    const config = { transcriptionMode };

    // Local transcription options
    if (transcriptionMode === 'local') {
      // Detect GPU and recommend model
      const gpuInfo = await this.gpuDetector.detectNvidiaGPU();
      let vramGB = 8; // Default
      let recommendedWhisper = 'small';
      
      if (gpuInfo.available) {
        vramGB = await ModelRecommendations.detectGPUMemory();
        const whisperRec = ModelRecommendations.getWhisperModel(vramGB);
        recommendedWhisper = whisperRec.recommended;
        console.log(chalk.blue(`   💡 Detected ${vramGB}GB GPU - Recommended: ${whisperRec.recommended} model`));
        console.log(chalk.gray(`      ${whisperRec.description} (${whisperRec.vramUsage} VRAM)\n`));
      }

      const localAnswers = await inquirer.prompt([
        {
          type: 'list',
          name: 'transcriptionDevice',
          message: 'Hardware:',
          choices: [
            { name: '🖥️  CPU - Works everywhere, slower', value: 'cpu' },
            { name: '🎮 CUDA - Much faster (NVIDIA GPU required)', value: 'cuda', disabled: !gpuInfo.available && 'No NVIDIA GPU detected' }
          ],
          default: gpuInfo.available ? 'cuda' : 'cpu'
        },
        {
          type: 'list',
          name: 'whisperModel',
          message: `Whisper model size ${gpuInfo.available ? `(${vramGB}GB VRAM detected)` : ''}:`,
          choices: [
            { name: `tiny - Fastest, basic accuracy (${gpuInfo.available ? '~1GB VRAM' : '~1GB RAM'})`, value: 'tiny' },
            { name: `base - Good for low-end hardware (${gpuInfo.available ? '~1GB VRAM' : '~1GB RAM'})`, value: 'base' },
            { name: `small - ${gpuInfo.available && vramGB >= 6 ? '⭐ Recommended' : 'Good balance'} (${gpuInfo.available ? '~2-3GB VRAM' : '~2GB RAM'})`, value: 'small' },
            { name: `medium - Better accuracy (${gpuInfo.available ? '~5-6GB VRAM' : '~5GB RAM'})`, value: 'medium', disabled: vramGB < 8 && gpuInfo.available && `Needs 8GB+ VRAM (you have ${vramGB}GB)` },
            { name: `large-v3 - Best accuracy (${gpuInfo.available ? '~10GB+ VRAM' : '~10GB+ RAM'})`, value: 'large-v3', disabled: vramGB < 16 && gpuInfo.available && `Needs 16GB+ VRAM (you have ${vramGB}GB)` },
            { name: '📝 Enter custom model name', value: 'custom' }
          ],
          default: recommendedWhisper
        }
      ]);

      // Handle custom model input
      if (localAnswers.whisperModel === 'custom') {
        const { customModel } = await inquirer.prompt([
          {
            type: 'input',
            name: 'customModel',
            message: 'Enter Whisper model name (e.g., small, medium, large-v3):',
            default: recommendedWhisper,
            validate: input => input.trim().length > 0 || 'Model name is required'
          }
        ]);
        localAnswers.whisperModel = customModel;
      }

      Object.assign(config, localAnswers);
    }

    // Remote server URL
    if (transcriptionMode === 'remote') {
      const { remoteUrl } = await inquirer.prompt([
        {
          type: 'input',
          name: 'remoteUrl',
          message: 'Whisper server URL:',
          default: `http://localhost:${DEFAULTS.WHISPER_SERVER_PORT}`,
          validate: input => {
            try {
              new URL(input);
              return true;
            } catch {
              return 'Enter a valid URL';
            }
          }
        }
      ]);
      config.remoteUrl = remoteUrl;
    }
    
    // Remote iCAD URL
    if (transcriptionMode === 'icad-remote') {
      const { remoteICADUrl } = await inquirer.prompt([
        {
          type: 'input',
          name: 'remoteICADUrl',
          message: 'Remote iCAD Transcribe server URL:',
          default: 'http://localhost:9912',
          validate: input => {
            try {
              new URL(input);
              return true;
            } catch {
              return 'Enter a valid URL (e.g., http://remote-server:9912)';
            }
          }
        }
      ]);
      config.icadUrl = remoteICADUrl;
      config.transcriptionMode = 'icad'; // Use icad mode but with remote URL
      config.enableICAD = false; // Don't start local iCAD container
      console.log(chalk.gray(`\n   📝 Using remote iCAD at: ${remoteICADUrl}`));
    }

    console.log('');

    // AI Provider for address extraction
    console.log(chalk.gray('   AI extracts addresses from transcriptions and categorizes calls.\n'));

    const aiChoices = [
      { 
        name: '🤖 OpenAI GPT - Best accuracy, requires API key', 
        value: 'openai',
        short: 'OpenAI'
      },
      { 
        name: '🏠 Ollama - Free local AI, needs good hardware', 
        value: 'ollama',
        short: 'Ollama'
      },
      { 
        name: '🌐 Remote Ollama - Connect to remote Ollama server', 
        value: 'ollama-remote',
        short: 'Remote Ollama'
      }
    ];

    const { aiProvider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'aiProvider',
        message: 'AI provider for call analysis:',
        choices: aiChoices,
        default: 'openai'
      }
    ]);

    config.aiProvider = aiProvider;

    if (aiProvider === 'openai') {
      const openaiAnswers = await inquirer.prompt([
        {
          type: 'password',
          name: 'openaiApiKey',
          message: 'OpenAI API key (from platform.openai.com):',
          mask: '*'
        },
        {
          type: 'list',
          name: 'openaiModel',
          message: 'Model:',
          choices: [
            { name: 'gpt-4o-mini - Fast & affordable (recommended)', value: 'gpt-4o-mini' },
            { name: 'gpt-4o - Best quality, higher cost', value: 'gpt-4o' },
            { name: 'gpt-3.5-turbo - Cheapest, basic quality', value: 'gpt-3.5-turbo' }
          ],
          default: 'gpt-4o-mini'
        }
      ]);
      Object.assign(config, openaiAnswers);
    } else if (aiProvider === 'ollama-remote') {
      // Remote Ollama configuration
      const { remoteOllamaUrl } = await inquirer.prompt([
        {
          type: 'input',
          name: 'remoteOllamaUrl',
          message: 'Remote Ollama server URL:',
          default: 'http://localhost:11434',
          validate: input => {
            try {
              new URL(input);
              return true;
            } catch {
              return 'Enter a valid URL (e.g., http://remote-server:11434)';
            }
          }
        }
      ]);
      
      const { ollamaModel } = await inquirer.prompt([
        {
          type: 'input',
          name: 'ollamaModel',
          message: 'Ollama model name:',
          default: DEFAULTS.OLLAMA_MODEL,
          validate: input => input.trim().length > 0 || 'Model name is required'
        }
      ]);
      
      config.ollamaUrl = remoteOllamaUrl;
      config.ollamaModel = ollamaModel;
      config.enableOllama = false; // Don't start local Ollama container
      
      console.log(chalk.gray(`\n   📝 Using remote Ollama at: ${remoteOllamaUrl}`));
      console.log(chalk.gray(`   📝 Model: ${ollamaModel}`));
    } else {
      // Local Ollama - Detect GPU and recommend Ollama model
      const gpuInfo = await this.gpuDetector.detectNvidiaGPU();
      let vramGB = 8; // Default
      let recommendedOllama = DEFAULTS.OLLAMA_MODEL;
      
      if (gpuInfo.available) {
        vramGB = await ModelRecommendations.detectGPUMemory();
        const ollamaRec = ModelRecommendations.getOllamaModel(vramGB);
        recommendedOllama = ollamaRec.recommended;
        console.log(chalk.blue(`   💡 Detected ${vramGB}GB GPU - Recommended: ${ollamaRec.recommended}`));
        console.log(chalk.gray(`      ${ollamaRec.description} (${ollamaRec.vramUsage} VRAM, ${ollamaRec.speed} speed)\n`));
      }

      // Build dynamic choices based on VRAM
      const ollamaChoices = [];
      
      if (vramGB >= 24) {
        ollamaChoices.push(
          { name: `llama3.1:70b - Best quality (${gpuInfo.available ? '~12-14GB VRAM' : '~70GB RAM'}) ⭐`, value: 'llama3.1:70b' },
          { name: `llama3.1:8b - Fast alternative (${gpuInfo.available ? '~6-7GB VRAM' : '~8GB RAM'})`, value: 'llama3.1:8b' },
          { name: `mistral:7b - Faster (${gpuInfo.available ? '~5GB VRAM' : '~7GB RAM'})`, value: 'mistral:7b' }
        );
      } else if (vramGB >= 16) {
        ollamaChoices.push(
          { name: `llama3.1:70b - Best quality (${gpuInfo.available ? '~12-14GB VRAM' : '~70GB RAM'}) ⭐`, value: 'llama3.1:70b' },
          { name: `llama3.1:8b - Fast alternative (${gpuInfo.available ? '~6-7GB VRAM' : '~8GB RAM'})`, value: 'llama3.1:8b' },
          { name: `mistral:7b - Faster (${gpuInfo.available ? '~5GB VRAM' : '~7GB RAM'})`, value: 'mistral:7b' }
        );
      } else if (vramGB >= 12) {
        ollamaChoices.push(
          { name: `llama3.1:8b - Best for ${vramGB}GB GPU (${gpuInfo.available ? '~6-7GB VRAM' : '~8GB RAM'}) ⭐`, value: 'llama3.1:8b' },
          { name: `mistral:7b - Faster, smaller (${gpuInfo.available ? '~5GB VRAM' : '~7GB RAM'})`, value: 'mistral:7b' },
          { name: `llama3.1:70b - Best quality (${gpuInfo.available ? '~12-14GB VRAM' : '~70GB RAM'})`, value: 'llama3.1:70b', disabled: 'Needs 16GB+ VRAM' }
        );
      } else if (vramGB >= 8) {
        ollamaChoices.push(
          { name: `llama3.1:8b - Best for ${vramGB}GB GPU (${gpuInfo.available ? '~6-7GB VRAM' : '~8GB RAM'}) ⭐`, value: 'llama3.1:8b' },
          { name: `mistral:7b - Faster, smaller (${gpuInfo.available ? '~5GB VRAM' : '~7GB RAM'})`, value: 'mistral:7b' },
          { name: `llama3.1:70b - Best quality (${gpuInfo.available ? '~12-14GB VRAM' : '~70GB RAM'})`, value: 'llama3.1:70b', disabled: 'Needs 16GB+ VRAM' }
        );
      } else if (vramGB >= 6) {
        ollamaChoices.push(
          { name: `mistral:7b - Best for ${vramGB}GB GPU (${gpuInfo.available ? '~4-5GB VRAM' : '~7GB RAM'}) ⭐`, value: 'mistral:7b' },
          { name: `llama3.1:8b - May be tight (${gpuInfo.available ? '~6-7GB VRAM' : '~8GB RAM'})`, value: 'llama3.1:8b' },
          { name: `llama3.1:70b - Best quality (${gpuInfo.available ? '~12-14GB VRAM' : '~70GB RAM'})`, value: 'llama3.1:70b', disabled: 'Needs 16GB+ VRAM' }
        );
      } else {
        ollamaChoices.push(
          { name: `mistral:7b - Recommended (${gpuInfo.available ? '~4-5GB VRAM' : '~7GB RAM'}) ⭐`, value: 'mistral:7b' },
          { name: `llama3.1:8b - May not fit (${gpuInfo.available ? '~6-7GB VRAM' : '~8GB RAM'})`, value: 'llama3.1:8b', disabled: gpuInfo.available && `Needs 8GB+ VRAM (you have ${vramGB}GB)` },
          { name: `llama3.1:70b - Best quality (${gpuInfo.available ? '~12-14GB VRAM' : '~70GB RAM'})`, value: 'llama3.1:70b', disabled: 'Needs 16GB+ VRAM' }
        );
      }
      
      ollamaChoices.push({ name: '📝 Enter custom model name', value: 'custom' });

      const ollamaAnswers = await inquirer.prompt([
        {
          type: 'list',
          name: 'ollamaModel',
          message: `Ollama model ${gpuInfo.available ? `(${vramGB}GB VRAM detected)` : ''}:`,
          choices: ollamaChoices,
          default: recommendedOllama
        }
      ]);

      if (ollamaAnswers.ollamaModel === 'custom') {
        const { customModel } = await inquirer.prompt([
          {
            type: 'input',
            name: 'customModel',
            message: 'Enter Ollama model name (e.g., llama3.1:8b):',
            default: DEFAULTS.OLLAMA_MODEL,
            validate: input => input.trim().length > 0 || 'Model name is required'
          }
        ]);
        ollamaAnswers.ollamaModel = customModel;
      }

      Object.assign(config, ollamaAnswers);
      
      console.log(chalk.gray(`\n   📝 Ollama will be available at: ${SERVICE_URLS[installationType].ollama}`));
      if (installationType === 'docker') {
        console.log(chalk.gray(`   📝 Model will be automatically pulled after installation.`));
      }
    }

    return config;
  }

  /**
   * Configure GPU acceleration for Docker
   * @deprecated This method is kept for web UI use. GPU configuration is now done via web UI.
   */
  async configureGPU(serviceConfig) {
    console.log(chalk.gray('   GPU acceleration speeds up AI models (Ollama) and transcription.\n'));

    // Detect GPU
    process.stdout.write(chalk.gray('   Detecting GPU...'));
    const gpuInfo = await this.gpuDetector.detectNvidiaGPU();
    process.stdout.write('\r' + ' '.repeat(50) + '\r');

    if (!gpuInfo.available) {
      console.log(chalk.yellow('   ⚠️  No NVIDIA GPU detected'));
      console.log(chalk.gray('   GPU acceleration will not be available.\n'));
      return { enableGPU: false };
    }

    console.log(chalk.green(`   ✓ NVIDIA GPU detected: ${gpuInfo.name}\n`));

    // Check if GPU is useful for selected services
    const needsGPU = false; // GPU configuration moved to web UI
    if (!needsGPU) {
      console.log(chalk.gray('   GPU acceleration is only useful when using Ollama for AI.\n'));
      const { enable } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'enable',
          message: 'Enable GPU acceleration anyway? (For future use)',
          default: false
        }
      ]);
      return { enableGPU: enable };
    }

    // Check NVIDIA Container Toolkit (Linux only)
    if (process.platform === 'linux') {
      const toolkitCheck = await this.gpuDetector.checkNvidiaContainerToolkit();
      if (!toolkitCheck.installed) {
        console.log(chalk.yellow('   ⚠️  NVIDIA Container Toolkit not installed'));
        console.log(chalk.gray('   Required for Docker GPU acceleration on Linux.\n'));

        const { install } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'install',
            message: 'Install NVIDIA Container Toolkit automatically?',
            default: true
          }
        ]);

        if (install) {
          console.log('');
          const result = await this.gpuDetector.installNvidiaContainerToolkit();
          if (!result.success) {
            console.log(chalk.yellow(`   ⚠️  ${result.error}`));
            console.log(chalk.gray('   You can install it manually later.\n'));
            const { proceed } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'proceed',
                message: 'Continue without GPU acceleration?',
                default: true
              }
            ]);
            return { enableGPU: !proceed };
          }
          console.log(chalk.green('   ✓ NVIDIA Container Toolkit installed\n'));
        } else {
          const { proceed } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'proceed',
              message: 'Continue without GPU acceleration?',
              default: true
            }
          ]);
          return { enableGPU: !proceed };
        }
      } else {
        console.log(chalk.green(`   ✓ NVIDIA Container Toolkit installed (${toolkitCheck.version})\n`));
      }
    } else if (process.platform === 'win32') {
      console.log(chalk.gray('   Windows: GPU support requires WSL2 backend in Docker Desktop.\n'));
      console.log(chalk.gray('   Make sure Docker Desktop is using WSL2 backend.\n'));
    } else if (process.platform === 'darwin') {
      console.log(chalk.yellow('   ⚠️  macOS: Docker GPU acceleration is not supported.\n'));
      return { enableGPU: false };
    }

    // Test Docker GPU access
    console.log(chalk.gray('   Testing Docker GPU access...'));
    const gpuTest = await this.gpuDetector.testDockerGPU();
    if (!gpuTest.working) {
      console.log(chalk.yellow(`   ⚠️  GPU test failed: ${gpuTest.reason}`));
      console.log(chalk.gray('   GPU acceleration may not work. Continuing anyway...\n'));
    } else {
      console.log(chalk.green('   ✓ Docker GPU access confirmed\n'));
    }

    const { enable } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enable',
        message: 'Enable GPU acceleration for Docker services?',
        default: true
      }
    ]);

    return { enableGPU: enable };
  }

  /**
   * Configure optional dependencies based on selected services
   * Only installs dependencies that are actually needed by selected options
   * @deprecated This method is kept for web UI use. Optional dependencies are now installed via web UI.
   */
  async configureOptionalDependencies(installationType, serviceConfig, integrationConfig = {}) {
    console.log(chalk.gray('   Install dependencies required by your selected options.\n'));

    const options = [];
    const results = {};

    // Python for local transcription (only if local transcription is selected)
    if (installationType === 'local' && serviceConfig.transcriptionMode === 'local') {
      const hasPython = await this.dependencyInstaller.isPythonInstalled();
      if (!hasPython) {
        options.push({
          name: '🐍 Python 3 - Required for local Whisper transcription',
          value: 'python',
          required: true
        });
      }
    }

    // Visual Studio Build Tools for Windows (only if building native modules is needed)
    // Only needed if using local installation with native npm modules
    if (process.platform === 'win32' && installationType === 'local') {
      // Check if any native modules might be built (e.g., whisper, faster-whisper)
      const needsNativeBuild = serviceConfig.transcriptionMode === 'local' || 
                               serviceConfig.transcriptionMode === 'faster-whisper';
      if (needsNativeBuild) {
        const hasBuildTools = await this.checkBuildTools();
        if (!hasBuildTools) {
          options.push({
            name: '🔧 Visual Studio Build Tools - Required for building native transcription modules',
            value: 'buildtools',
            required: true
          });
        }
      }
    }

    // Git - only needed if cloning repositories (not needed for basic installation)
    // Skip Git check - it's not required for basic operation

    if (options.length === 0) {
      console.log(chalk.green('   ✓ No additional dependencies needed for your selected options.\n'));
      return { installed: [] };
    }

    // Show which options require these dependencies
    console.log(chalk.gray('   The following dependencies are needed based on your selections:\n'));
    options.forEach(opt => {
      const required = opt.required ? chalk.red('(Required)') : chalk.yellow('(Optional)');
      console.log(chalk.gray(`   • ${opt.name} ${required}`));
    });
    console.log('');

    const { toInstall } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'toInstall',
        message: 'Select dependencies to install:',
        choices: options.map(opt => ({
          name: opt.name,
          value: opt.value,
          checked: opt.required
        })),
        validate: (input) => {
          const required = options.filter(o => o.required).map(o => o.value);
          const missing = required.filter(r => !input.includes(r));
          if (missing.length > 0) {
            return `Required dependencies must be installed: ${missing.join(', ')}`;
          }
          return true;
        }
      }
    ]);

    if (toInstall.length === 0) {
      return { installed: [] };
    }

    console.log('');
    const installed = [];

    for (const dep of toInstall) {
      if (dep === 'python') {
        console.log(chalk.blue('   Installing Python 3...'));
        const result = await this.dependencyInstaller.installPython();
        if (result.success) {
          installed.push('Python 3');
          console.log(chalk.green('   ✓ Python 3 installed\n'));
        } else {
          console.log(chalk.yellow(`   ⚠ Could not install Python: ${result.error}\n`));
        }
      } else if (dep === 'buildtools') {
        console.log(chalk.blue('   Installing Visual Studio Build Tools...'));
        const result = await this.installBuildTools();
        if (result.success) {
          installed.push('Visual Studio Build Tools');
          console.log(chalk.green('   ✓ Build Tools installed\n'));
        } else {
          console.log(chalk.yellow(`   ⚠ Could not install Build Tools: ${result.error}\n`));
        }
      } else if (dep === 'git') {
        console.log(chalk.blue('   Installing Git...'));
        const result = await this.installGit();
        if (result.success) {
          installed.push('Git');
          console.log(chalk.green('   ✓ Git installed\n'));
        } else {
          console.log(chalk.yellow(`   ⚠ Could not install Git: ${result.error}\n`));
        }
      }
    }

    return { installed };
  }

  /**
   * Check if Visual Studio Build Tools are installed
   */
  async checkBuildTools() {
    try {
      const { execSync } = require('child_process');
      // Check for vswhere (Visual Studio installer)
      execSync('vswhere -latest', { stdio: 'ignore' });
      return true;
    } catch (err) {
      // Check common installation paths
      const fs = require('fs');
      const paths = [
        'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools',
        'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools',
        'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
        'C:\\Program Files\\Microsoft Visual Studio\\2019\\Community'
      ];
      return paths.some(p => fs.existsSync(p));
    }
  }

  /**
   * Install Visual Studio Build Tools on Windows
   */
  async installBuildTools() {
    if (process.platform !== 'win32') {
      return { success: false, error: 'Build Tools only available on Windows' };
    }

    const chalk = require('chalk');
    const { execSync } = require('child_process');

    // Try winget first (Windows 10/11)
    try {
      execSync('winget --version', { stdio: 'ignore' });
      console.log(chalk.blue('   Using winget to install Build Tools...'));
      execSync('winget install Microsoft.VisualStudio.2022.BuildTools --silent --accept-package-agreements --accept-source-agreements', { stdio: 'inherit' });
      return { success: true };
    } catch (err) {
      // Try chocolatey
      try {
        execSync('choco --version', { stdio: 'ignore' });
        console.log(chalk.blue('   Using Chocolatey to install Build Tools...'));
        execSync('choco install visualstudio2022buildtools -y', { stdio: 'inherit' });
        return { success: true };
      } catch (err2) {
        // Fallback to manual installation
        console.log(chalk.yellow('   Opening Build Tools download page...'));
        try {
          execSync('start https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022', { stdio: 'ignore' });
        } catch (err3) {
          // Ignore
        }
        return {
          success: false,
          error: 'Please install Visual Studio Build Tools manually from visualstudio.microsoft.com'
        };
      }
    }
  }

  /**
   * Install Git
   */
  async installGit() {
    const chalk = require('chalk');
    const { execSync } = require('child_process');

    if (process.platform === 'win32') {
      // Try winget
      try {
        execSync('winget --version', { stdio: 'ignore' });
        execSync('winget install Git.Git --silent', { stdio: 'inherit' });
        return { success: true };
      } catch (err) {
        // Try chocolatey
        try {
          execSync('choco --version', { stdio: 'ignore' });
          execSync('choco install git -y', { stdio: 'inherit' });
          return { success: true };
        } catch (err2) {
          // Fallback
          try {
            execSync('start https://git-scm.com/downloads/win', { stdio: 'ignore' });
          } catch (err3) {
            // Ignore
          }
          return {
            success: false,
            error: 'Please install Git manually from git-scm.com'
          };
        }
      }
    } else if (process.platform === 'darwin') {
      // macOS - try Homebrew
      try {
        execSync('brew --version', { stdio: 'ignore' });
        execSync('brew install git', { stdio: 'inherit' });
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: 'Please install Git manually or install Homebrew first'
        };
      }
    } else {
      // Linux
      try {
        execSync('sudo apt-get update', { stdio: 'inherit' });
        execSync('sudo apt-get install -y git', { stdio: 'inherit' });
        return { success: true };
      } catch (err) {
        return {
          success: false,
          error: `Git installation failed: ${err.message}`
        };
      }
    }
  }

  /**
   * Configure optional integrations
   */
  async configureIntegrations(installationType) {
    console.log(chalk.gray('   Optional features you can enable.\n'));

    const config = {};

    // Discord
    const { enableDiscord } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enableDiscord',
        message: 'Enable Discord bot? (Posts call notifications)',
        default: false
      }
    ]);

    config.enableDiscord = enableDiscord;

    if (enableDiscord) {
      const discordAnswers = await inquirer.prompt([
        {
          type: 'password',
          name: 'discordToken',
          message: 'Discord bot token:',
          mask: '*',
          validate: input => input.trim().length > 0 || 'Token is required'
        },
        {
          type: 'input',
          name: 'clientId',
          message: 'Discord Client ID (for slash commands):',
          default: ''
        }
      ]);
      Object.assign(config, discordAnswers);
    }

    // Radio Software Selection
    console.log(chalk.gray('   Choose which radio recording software to use (or skip for manual setup).\n'));
    
    const radioChoices = [
      { 
        name: '📻 TrunkRecorder - Docker container, Linux only (USB passthrough)', 
        value: 'trunk-recorder',
        short: 'TrunkRecorder'
      },
      { 
        name: '📡 SDRTrunk - Desktop app, all platforms (config file generated)', 
        value: 'sdrtrunk',
        short: 'SDRTrunk'
      },
      { 
        name: '🌐 rdio-scanner - Web-based scanner (Docker + config)', 
        value: 'rdio-scanner',
        short: 'rdio-scanner'
      },
      { 
        name: '🔧 OP25 - Command-line decoder (Docker + config)', 
        value: 'op25',
        short: 'OP25'
      },
      { 
        name: '⏭️  Skip - Configure manually later', 
        value: 'none',
        short: 'None'
      }
    ];

    const { radioSoftware } = await inquirer.prompt([
      {
        type: 'list',
        name: 'radioSoftware',
        message: 'Radio recording software:',
        choices: radioChoices,
        default: 'none'
      }
    ]);

    config.radioSoftware = radioSoftware;
    
    // Set enable flags for backward compatibility
    config.enableTrunkRecorder = radioSoftware === 'trunk-recorder';
    config.enableSDRTrunk = radioSoftware === 'sdrtrunk';
    config.enableRdioScanner = radioSoftware === 'rdio-scanner';
    config.enableOP25 = radioSoftware === 'op25';

    if (radioSoftware !== 'none') {
      console.log(chalk.gray(`\n   📝 ${radioChoices.find(c => c.value === radioSoftware)?.short} will be auto-configured`));
      
      if (radioSoftware === 'trunk-recorder') {
        console.log(chalk.yellow('   ⚠️  TrunkRecorder notes:'));
        console.log(chalk.gray('   • USB passthrough only works on Linux'));
        console.log(chalk.gray('   • Image will be pulled from Docker Hub: robotastic/trunk-recorder:latest'));
        if (installationType !== 'docker') {
          console.log(chalk.gray('   • Docker installation recommended for TrunkRecorder'));
        }
      } else if (radioSoftware === 'sdrtrunk') {
        console.log(chalk.gray('   • Configuration file will be generated'));
        console.log(chalk.gray('   • Import config into SDRTrunk desktop app'));
      } else if (radioSoftware === 'rdio-scanner') {
        if (installationType === 'docker') {
          console.log(chalk.gray('   • Docker container will be started'));
        }
        console.log(chalk.gray('   • Configuration file will be generated'));
      } else if (radioSoftware === 'op25') {
        if (installationType === 'docker') {
          console.log(chalk.gray('   • Docker container will be started'));
        }
        console.log(chalk.gray('   • Configuration file will be generated'));
      }
      console.log(chalk.gray('   • See docs/RADIO-SOFTWARE.md for detailed setup\n'));
    }

    return config;
  }

  /**
   * Configure post-installation options
   * @deprecated This method is kept for web UI use. Post-installation options are now configured via web UI.
   */
  async configurePostInstall(installationType, config) {
    console.log(chalk.gray('   Configure what happens after installation.\n'));

    const postInstallConfig = {};

    // Auto-open web UI
    const { openWebUI } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'openWebUI',
        message: 'Open web UI in browser after installation?',
        default: true
      }
    ]);
    postInstallConfig.openWebUI = openWebUI;

    // Auto-start configuration
    const { enableAutoStart } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enableAutoStart',
        message: 'Start Scanner Map automatically on system boot?',
        default: false
      }
    ]);
    postInstallConfig.enableAutoStart = enableAutoStart;

    // Auto-update check
    const { enableAutoUpdate } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enableAutoUpdate',
        message: 'Check for updates automatically? (checks on startup)',
        default: true
      }
    ]);
    postInstallConfig.enableAutoUpdate = enableAutoUpdate;

    return postInstallConfig;
  }

  /**
   * Configure advanced options (ports, authentication, storage, etc.)
   * Note: Location, GPU, and dependency installation are handled via web UI
   */
  async configureAdvanced(installationType, serviceConfig) {
    console.log(chalk.gray('   Configure advanced network and system settings.\n'));
    console.log(chalk.blue('   💡 Note: Location, GPU, and dependencies are configured via web UI.\n'));

    const advanced = {};

    // Ports
    console.log(chalk.blue('   Network Configuration\n'));
    const portAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'webserverPort',
        message: 'Web server port:',
        default: DEFAULTS.WEBSERVER_PORT.toString(),
        validate: (input) => {
          const port = parseInt(input);
          return (port > 0 && port < 65536) || 'Port must be between 1 and 65535';
        },
        filter: (input) => parseInt(input)
      },
      {
        type: 'input',
        name: 'botPort',
        message: 'API port (for TrunkRecorder/SDRTrunk):',
        default: DEFAULTS.BOT_PORT.toString(),
        validate: (input) => {
          const port = parseInt(input);
          return (port > 0 && port < 65536) || 'Port must be between 1 and 65535';
        },
        filter: (input) => parseInt(input)
      },
      {
        type: 'input',
        name: 'publicDomain',
        message: 'Public domain/IP (for audio links):',
        default: this.detectPublicDomain(),
        validate: (input) => input.trim().length > 0 || 'Domain/IP is required'
      },
      {
        type: 'input',
        name: 'timezone',
        message: 'Timezone:',
        default: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
      }
    ]);
    Object.assign(advanced, portAnswers);
    console.log('');

    // Geocoding provider
    console.log(chalk.blue('   Geocoding Configuration\n'));
    const geocodingAnswers = await inquirer.prompt([
      {
        type: 'list',
        name: 'geocodingProvider',
        message: 'Geocoding provider:',
        choices: [
          { name: 'Nominatim (Free, no API key)', value: 'nominatim' },
          { name: 'LocationIQ (Free tier available)', value: 'locationiq' },
          { name: 'Google Maps (Requires API key)', value: 'google' }
        ],
        default: 'nominatim'
      }
    ]);
    Object.assign(advanced, geocodingAnswers);

    if (geocodingAnswers.geocodingProvider === 'locationiq') {
      const { locationiqApiKey } = await inquirer.prompt([
        {
          type: 'input',
          name: 'locationiqApiKey',
          message: 'LocationIQ API key (get from locationiq.com):',
          default: ''
        }
      ]);
      advanced.locationiqApiKey = locationiqApiKey;
    } else if (geocodingAnswers.geocodingProvider === 'google') {
      const { googleMapsApiKey } = await inquirer.prompt([
        {
          type: 'input',
          name: 'googleMapsApiKey',
          message: 'Google Maps API key (get from console.cloud.google.com):',
          default: ''
        }
      ]);
      advanced.googleMapsApiKey = googleMapsApiKey;
    }
    console.log('');

    // Storage
    console.log(chalk.blue('   Storage Configuration\n'));
    const storageAnswers = await inquirer.prompt([
      {
        type: 'list',
        name: 'storageMode',
        message: 'Storage mode:',
        choices: [
          { name: 'Local filesystem', value: 'local' },
          { name: 'S3-compatible storage', value: 's3' }
        ],
        default: 'local'
      }
    ]);
    Object.assign(advanced, storageAnswers);

    if (storageAnswers.storageMode === 's3') {
      const s3Answers = await inquirer.prompt([
        {
          type: 'input',
          name: 's3Endpoint',
          message: 'S3 endpoint URL:',
          default: 'https://s3.amazonaws.com',
          validate: (input) => {
            try {
              new URL(input);
              return true;
            } catch {
              return 'Enter a valid URL';
            }
          }
        },
        {
          type: 'input',
          name: 's3BucketName',
          message: 'S3 bucket name:',
          validate: (input) => input.trim().length > 0 || 'Bucket name is required'
        },
        {
          type: 'input',
          name: 's3AccessKeyId',
          message: 'S3 access key ID:',
          validate: (input) => input.trim().length > 0 || 'Access key is required'
        },
        {
          type: 'password',
          name: 's3SecretAccessKey',
          message: 'S3 secret access key:',
          mask: '*',
          validate: (input) => input.trim().length > 0 || 'Secret key is required'
        }
      ]);
      Object.assign(advanced, s3Answers);
    }
    console.log('');

    // Authentication
    console.log(chalk.blue('   Authentication Configuration\n'));
    const authAnswers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enableAuth',
        message: 'Enable web interface authentication?',
        default: false
      }
    ]);
    Object.assign(advanced, authAnswers);

    if (authAnswers.enableAuth) {
      const authDetails = await inquirer.prompt([
        {
          type: 'password',
          name: 'webserverPassword',
          message: 'Admin password:',
          mask: '*',
          validate: (input) => input.length >= 8 || 'Password must be at least 8 characters'
        },
        {
          type: 'input',
          name: 'sessionDurationDays',
          message: 'Session duration (days):',
          default: '7',
          validate: (input) => {
            const days = parseInt(input);
            return (days > 0 && days <= 365) || 'Must be between 1 and 365 days';
          },
          filter: (input) => parseInt(input)
        },
        {
          type: 'input',
          name: 'maxSessionsPerUser',
          message: 'Max sessions per user:',
          default: '5',
          validate: (input) => {
            const max = parseInt(input);
            return (max > 0 && max <= 20) || 'Must be between 1 and 20';
          },
          filter: (input) => parseInt(input)
        }
      ]);
      Object.assign(advanced, authDetails);
    }
    console.log('');

    // Talk Groups
    console.log(chalk.blue('   Talk Groups Configuration\n'));
    const talkGroupAnswers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enableMappedTalkGroups',
        message: 'Enable mapped talk groups filtering?',
        default: true
      },
      {
        type: 'input',
        name: 'mappedTalkGroups',
        message: 'Mapped talk groups (comma-separated IDs, leave empty for all):',
        default: '',
        when: (answers) => answers.enableMappedTalkGroups
      }
    ]);
    Object.assign(advanced, talkGroupAnswers);
    console.log('');

    // Two-Tone Detection
    console.log(chalk.blue('   Two-Tone Detection Configuration\n'));
    const toneAnswers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enableTwoToneMode',
        message: 'Enable two-tone pager detection?',
        default: false
      },
      {
        type: 'input',
        name: 'twoToneTalkGroups',
        message: 'Talk groups for two-tone detection (comma-separated IDs):',
        default: '',
        when: (answers) => answers.enableTwoToneMode
      }
    ]);
    Object.assign(advanced, toneAnswers);
    console.log('');

    // OpenAI Transcription (if using OpenAI)
    if (serviceConfig.transcriptionMode === 'openai' || serviceConfig.aiProvider === 'openai') {
      console.log(chalk.blue('   OpenAI Transcription Configuration\n'));
      const openaiAnswers = await inquirer.prompt([
        {
          type: 'input',
          name: 'openaiTranscriptionPrompt',
          message: 'OpenAI transcription prompt (optional, for better accuracy):',
          default: ''
        },
        {
          type: 'input',
          name: 'openaiTranscriptionModel',
          message: 'OpenAI transcription model:',
          default: 'whisper-1'
        },
        {
          type: 'input',
          name: 'openaiTranscriptionTemperature',
          message: 'Transcription temperature (0-1):',
          default: '0',
          validate: (input) => {
            const temp = parseFloat(input);
            return (temp >= 0 && temp <= 1) || 'Temperature must be between 0 and 1';
          },
          filter: (input) => parseFloat(input)
        }
      ]);
      Object.assign(advanced, openaiAnswers);
      console.log('');
    }

    return advanced;
  }

  /**
   * Show configuration summary
   */
  async showSummary(config, isSimpleMode = false) {
    console.log(chalk.blue.bold('\n📋 Configuration Summary\n'));

    const formatValue = (value, secret = false) => {
      if (typeof value === 'boolean') return value ? chalk.green('✓ Yes') : chalk.gray('No');
      if (value === undefined || value === null || value === '') return chalk.gray('Not set');
      if (secret && value) return chalk.cyan('••••••••');
      return chalk.cyan(value);
    };

    // Auto-configured message
    console.log(chalk.green('   ✨ All service URLs and ports auto-configured!\n'));

    // Core
    console.log(chalk.white.bold('   📦 Installation'));
    console.log(chalk.white(`     Type: ${formatValue(config.installationType === 'docker' ? 'Docker' : 'Local')}`));
    console.log(chalk.white(`     Web UI: ${formatValue(`http://localhost:${config.webserverPort}`)}`));
    console.log(chalk.white(`     API: ${formatValue(`http://localhost:${config.botPort}`)}`));
    console.log('');

    // Transcription (configured via web UI)
    console.log(chalk.white.bold('   🎤 Transcription'));
    console.log(chalk.white(`     Mode: ${formatValue(config.transcriptionMode)} (default, configure via web UI)`));
    console.log(chalk.gray(`     💡 Configure transcription service via web UI after installation`));
    console.log('');

    // AI (configured via web UI)
    console.log(chalk.white.bold('   🤖 AI Provider'));
    console.log(chalk.white(`     Provider: ${formatValue(config.aiProvider)} (default, configure via web UI)`));
    console.log(chalk.gray(`     💡 Configure AI provider and API keys via web UI after installation`));
    console.log('');

    // GPU (Docker only)
    if (config.installationType === 'docker') {
      console.log(chalk.white.bold('   🎮 GPU Acceleration'));
      console.log(chalk.white(`     Enabled: ${formatValue(config.enableGPU)}`));
      if (config.enableGPU) {
        const gpuInfo = await this.gpuDetector.detectNvidiaGPU();
        if (gpuInfo.available) {
          console.log(chalk.white(`     GPU: ${formatValue(gpuInfo.name)}`));
        }
      }
      console.log('');
    }

    // Integrations
    console.log(chalk.white.bold('   🔗 Integrations'));
    console.log(chalk.white(`     Discord: ${formatValue(config.enableDiscord)}`));
    const radioSoftwareDisplay = config.radioSoftware || 'none';
    console.log(chalk.white(`     Radio Software: ${radioSoftwareDisplay === 'none' ? 'None (manual setup)' : radioSoftwareDisplay}`));
    if (radioSoftwareDisplay !== 'none' && radioSoftwareDisplay !== undefined) {
      console.log(chalk.gray(`       (Config files generated in appdata/${radioSoftwareDisplay}/config/)`));
    }
    console.log('');
  }

  /**
   * Open web UI in browser
   */
  async openWebUI(port, showQuickStart = false) {
    const { exec } = require('child_process');
    const url = showQuickStart ? `http://localhost:${port}?quickstart=1` : `http://localhost:${port}`;
    
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        exec(`start ${url}`, (err) => {
          if (err) {
            console.log(chalk.yellow(`   ⚠ Could not open browser automatically. Open manually: ${url}`));
          }
          resolve();
        });
      } else if (process.platform === 'darwin') {
        exec(`open ${url}`, (err) => {
          if (err) {
            console.log(chalk.yellow(`   ⚠ Could not open browser automatically. Open manually: ${url}`));
          }
          resolve();
        });
      } else {
        // Linux
        exec(`xdg-open ${url}`, (err) => {
          if (err) {
            console.log(chalk.yellow(`   ⚠ Could not open browser automatically. Open manually: ${url}`));
          }
          resolve();
        });
      }
    });
  }

  /**
   * Show success message and next steps
   */
  async showSuccess(config, installationType, result) {
    console.log(chalk.green.bold('\n✅ Setup completed successfully!\n'));
    console.log(chalk.blue.bold('📱 Next Steps: Configure via Web UI\n'));
    console.log(chalk.white('   The web UI provides easy configuration for:'));
    console.log(chalk.gray('   • Location settings (geocoding city/state/country)'));
    console.log(chalk.gray('   • GPU acceleration (if available)'));
    console.log(chalk.gray('   • Installing missing dependencies'));
    console.log(chalk.gray('   • Auto-start and auto-update settings'));
    console.log(chalk.gray('   • Radio configuration (frequencies, talkgroups)'));
    console.log(chalk.gray('   • System status and monitoring'));
    console.log('');

    this.printHeader('Quick Start');

    if (installationType === 'docker') {
      console.log(chalk.white('   Start Scanner Map:'));
      console.log(chalk.cyan('     docker-compose up -d\n'));

      // Model pulling is now automatic, but show command as reference
      if (config.aiProvider === 'ollama') {
        console.log(chalk.white('   Ollama model will be pulled automatically after services start.'));
        console.log(chalk.gray(`   (Manual: docker exec ollama ollama pull ${config.ollamaModel})\n`));
      }
    } else {
      console.log(chalk.white('   Start Scanner Map:'));
      console.log(chalk.cyan('     npm start\n'));
    }

    // Show all web interfaces
    this.printHeader('Web Interfaces');

    console.log(chalk.white('   📍 Scanner Map (Main Interface):'));
    console.log(chalk.cyan(`      http://localhost:${config.webserverPort}\n`));

    console.log(chalk.gray('   💡 Optional services (iCAD, Ollama) are configured via web UI'));
    console.log(chalk.gray(`      After configuration, access them via the web UI or directly:\n`));

    // API endpoints
    this.printHeader('API Endpoints');

    const radioSoftwareName = config.radioSoftware && config.radioSoftware !== 'none' 
      ? config.radioSoftware.charAt(0).toUpperCase() + config.radioSoftware.slice(1).replace('-', ' ')
      : 'SDRTrunk/TrunkRecorder';
    console.log(chalk.white(`   📡 Audio Upload (${radioSoftwareName}):`));
    console.log(chalk.cyan(`      http://localhost:${config.botPort}/api/call-upload\n`));

    if (config.radioSoftware && config.radioSoftware !== 'none') {
      console.log(chalk.white('   🔑 API Key:'));
      const apiKey = config.radioApiKey || config.trunkRecorderApiKey || 'Auto-generated on first run';
      console.log(chalk.cyan(`      ${apiKey}`));
      console.log(chalk.gray('      (Saved to data/api-key.txt)\n'));
    }

    if (config.transcriptionMode === 'icad' || config.enableICAD) {
      console.log(chalk.white('   🎤 iCAD Transcribe API:'));
      console.log(chalk.cyan(`      http://localhost:${DEFAULTS.ICAD_PORT}/api/transcribe\n`));
    }

    console.log(chalk.gray('   See docs/RADIO-SOFTWARE.md for detailed setup.\n'));

    // Data persistence info
    if (installationType === 'docker') {
      this.printHeader('Data Persistence');
      console.log(chalk.white('   All data is stored in ./appdata/ directory:'));
      console.log(chalk.gray('   • scanner-map/ - Database, audio files, logs'));
      if (config.aiProvider === 'ollama' || config.enableOllama) {
        console.log(chalk.gray('   • ollama/ - AI models (persistent across restarts)'));
      }
      if (config.transcriptionMode === 'icad' || config.enableICAD) {
        console.log(chalk.gray('   • icad-transcribe/ - Models, config, database'));
      }
      if (config.enableTrunkRecorder || config.radioSoftware === 'trunk-recorder') {
        console.log(chalk.gray('   • trunk-recorder/ - Config and recordings'));
      }
      if (config.enableSDRTrunk || config.radioSoftware === 'sdrtrunk') {
        console.log(chalk.gray('   • sdrtrunk/ - Config files (for desktop app)'));
      }
      if (config.enableRdioScanner || config.radioSoftware === 'rdio-scanner') {
        console.log(chalk.gray('   • rdio-scanner/ - Config and data'));
      }
      if (config.enableOP25 || config.radioSoftware === 'op25') {
        console.log(chalk.gray('   • op25/ - Config and recordings'));
      }
      console.log(chalk.gray('\n   All volumes are properly mounted and persistent.\n'));
    }

    // Port summary
    this.printHeader('Port Summary');
    console.log(chalk.gray('   ┌─────────────────────────────────────────────────┐'));
    console.log(chalk.gray('   │  Service                      Port             │'));
    console.log(chalk.gray('   ├─────────────────────────────────────────────────┤'));
    console.log(chalk.gray(`   │  Scanner Map Web UI           ${config.webserverPort}              │`));
    console.log(chalk.gray(`   │  Scanner Map API              ${config.botPort}              │`));
    if (config.transcriptionMode === 'icad' || config.enableICAD) {
      console.log(chalk.gray(`   │  iCAD Transcribe Web UI      ${DEFAULTS.ICAD_PORT}              │`));
    }
    if (config.aiProvider === 'ollama' || config.enableOllama) {
      console.log(chalk.gray(`   │  Ollama API                  ${DEFAULTS.OLLAMA_PORT}             │`));
    }
    console.log(chalk.gray('   └─────────────────────────────────────────────────┘\n'));

    // Ask to start services (Docker) - default to false since web UI can handle this
    if (installationType === 'docker') {
      const { startNow } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'startNow',
          message: 'Start services now? (You can also start via web UI or manually)',
          default: false
        }
      ]);

      if (startNow) {
        console.log(chalk.blue('\n🚀 Starting services...\n'));
        
        // Clean up old Docker builds and containers
        await this.dockerInstaller.cleanupOldBuilds();
        
        console.log(chalk.gray('   Note: scanner-map image will be rebuilt (contains app code)'));
        console.log(chalk.gray('   Optional services (Ollama, iCAD) use pre-built images'));
        console.log(chalk.gray('   This may take a few minutes...\n'));
        const startResult = await this.dockerInstaller.startServices();
        if (startResult.success) {
          console.log(chalk.green('✓ Services started!\n'));
          
          // Automatically pull Ollama model if using local Ollama (not remote)
          if (config.aiProvider === 'ollama' && config.ollamaModel && config.enableOllama) {
            console.log(chalk.blue('📥 Pulling Ollama model (this may take a few minutes)...\n'));
            const pullResult = await this.dockerInstaller.pullOllamaModel(config.ollamaModel);
            if (!pullResult.success) {
              console.log(chalk.yellow(`⚠ Could not auto-pull model: ${pullResult.error}`));
              if (pullResult.manualCommand) {
                console.log(chalk.gray(`   Run manually: ${pullResult.manualCommand}`));
              }
            }
          } else if (config.aiProvider === 'ollama' && !config.enableOllama) {
            console.log(chalk.gray(`\n   ℹ️  Using remote Ollama at: ${config.ollamaUrl}`));
            console.log(chalk.gray(`   ℹ️  Make sure model ${config.ollamaModel} is available on the remote server.\n`));
          }
          
          // Wait a moment for services to initialize
          console.log(chalk.blue('   Waiting for services to initialize...\n'));
          await new Promise(resolve => setTimeout(resolve, 5000));
          
          // Verify installation status
          const verifyResult = await this.dockerInstaller.verifyInstallation(config);
          
          // Open web UI if requested (always show Quick Start modal after installation)
          if (config.openWebUI) {
            await this.openWebUI(config.webserverPort, true);
          }
          
          console.log(chalk.green('\n✓ Installation complete!\n'));
          console.log(chalk.cyan.bold('🌐 Open Scanner Map: ') + chalk.underline(`http://localhost:${config.webserverPort}`));
          console.log(chalk.gray('   Use the "Quick Start" menu in the web UI to configure location, GPU, and more.\n'));
          if (config.transcriptionMode === 'icad' || config.enableICAD) {
            console.log(chalk.cyan.bold('🎤 Open iCAD:        ') + chalk.underline(`http://localhost:${DEFAULTS.ICAD_PORT}\n`));
          }
        } else {
          console.log(chalk.yellow(`⚠ Could not start services: ${startResult.error}`));
          console.log(chalk.gray('\n   Troubleshooting steps:'));
          console.log(chalk.gray('   1. Check Docker is running: docker ps'));
          console.log(chalk.gray('   2. Check for port conflicts'));
          console.log(chalk.gray('   3. Start manually: docker-compose up -d'));
          if (config.enableTrunkRecorder || config.radioSoftware === 'trunk-recorder') {
            console.log(chalk.gray('   4. For TrunkRecorder, pull image first:'));
            console.log(chalk.cyan('      docker pull robotastic/trunk-recorder:latest'));
          }
          if (config.enableRdioScanner || config.radioSoftware === 'rdio-scanner') {
            console.log(chalk.gray('   4. For rdio-scanner, pull image first:'));
            console.log(chalk.cyan('      docker pull rdioscanner/rdio-scanner:latest'));
          }
          if (config.enableOP25 || config.radioSoftware === 'op25') {
            console.log(chalk.gray('   4. For OP25, pull image first:'));
            console.log(chalk.cyan('      docker pull op25/op25:latest'));
          }
          if (config.enableSDRTrunk || config.radioSoftware === 'sdrtrunk') {
            console.log(chalk.gray('   4. SDRTrunk config file generated in appdata/sdrtrunk/config/'));
            console.log(chalk.gray('      Import into SDRTrunk desktop app'));
          }
          if (config.aiProvider === 'ollama' && config.ollamaModel) {
            console.log(chalk.gray(`   5. Pull Ollama model: docker exec ollama ollama pull ${config.ollamaModel}`));
          }
          console.log('');
        }
      } else {
        // Still show next steps if not starting now - simplified since web UI handles most config
        console.log(chalk.blue('\n📋 Next Steps:\n'));
        console.log(chalk.white('   1. Start services:'));
        console.log(chalk.cyan('      docker-compose up -d'));
        console.log(chalk.gray('      (Or use the web UI "Quick Start" menu after starting)\n'));
        
        if (config.enableTrunkRecorder || config.radioSoftware === 'trunk-recorder') {
          console.log(chalk.white('   2. Pull TrunkRecorder image (if not already pulled):'));
          console.log(chalk.cyan('      docker pull robotastic/trunk-recorder:latest\n'));
        }
        if (config.enableRdioScanner || config.radioSoftware === 'rdio-scanner') {
          console.log(chalk.white('   2. Pull rdio-scanner image (if not already pulled):'));
          console.log(chalk.cyan('      docker pull rdioscanner/rdio-scanner:latest\n'));
        }
        if (config.enableOP25 || config.radioSoftware === 'op25') {
          console.log(chalk.white('   2. Pull OP25 image (if not already pulled):'));
          console.log(chalk.cyan('      docker pull op25/op25:latest\n'));
        }
        if (config.enableSDRTrunk || config.radioSoftware === 'sdrtrunk') {
          console.log(chalk.white('   2. SDRTrunk config file generated in appdata/sdrtrunk/config/'));
          console.log(chalk.gray('      Import streaming-config.json into SDRTrunk desktop app\n'));
        }
        
        if (config.aiProvider === 'ollama' && config.ollamaModel) {
          console.log(chalk.white('   3. Pull Ollama model (after services start):'));
          console.log(chalk.cyan(`      docker exec ollama ollama pull ${config.ollamaModel}\n`));
        }
        
        if (config.transcriptionMode === 'icad' || config.enableICAD) {
          console.log(chalk.white('   4. Access iCAD Transcribe to install models:'));
          console.log(chalk.cyan(`      http://localhost:${DEFAULTS.ICAD_PORT}`));
          console.log(chalk.gray('      Default login: admin / changeme123 (CHANGE THIS!)'));
          console.log(chalk.gray('      After logging in, go to Models section to download transcription models\n'));
        }
      }
    } else {
      // Local installation - always open web UI
      // Always show Quick Start modal after installation
      await this.openWebUI(config.webserverPort, true);
    }

    // Final verification for Docker installations (optional, default to false for faster flow)
    if (installationType === 'docker') {
      const { verifyNow } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'verifyNow',
          message: 'Run installation verification now? (Optional - can be done later)',
          default: false
        }
      ]);

      if (verifyNow) {
        await this.dockerInstaller.verifyInstallation(config);
      }
    }

    console.log(chalk.green.bold('\n✨ Installation complete! ✨\n'));
    console.log(chalk.blue('💡 Tip: Use the web UI "Quick Start" menu to configure location, GPU, and more.\n'));
  }

}

// Run if called directly
if (require.main === module) {
  const projectRoot = process.cwd();
  const installer = new InstallerCore(projectRoot);
  installer.run().catch(err => {
    if (err.code === 'ERR_USE_AFTER_CLOSE' || err.message?.includes('readline')) {
      console.error(chalk.red('\n❌ This installer requires an interactive terminal.'));
    } else {
      console.error(chalk.red('\n❌ Setup error:'), err.message || err);
    }
    process.exit(1);
  });
}

module.exports = InstallerCore;
