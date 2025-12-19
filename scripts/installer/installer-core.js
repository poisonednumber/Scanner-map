/**
 * Scanner Map - Interactive Installer
 * Unified setup for both Docker and Local installations
 * 
 * Auto-configures all service URLs and ports based on installation type.
 * No manual port/URL configuration required.
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
    console.log(chalk.gray('Welcome! This installer will guide you through setting up Scanner Map.'));
    console.log(chalk.gray('All service URLs and ports are auto-configured for you.\n'));

    if (!this.isInteractive()) {
      console.log(chalk.red('\n❌ Error: This installer requires an interactive terminal.'));
      console.log(chalk.yellow('   Run this script directly in a terminal window.'));
      process.exit(1);
    }

    // Step 1: Choose installation location
    this.printStep(1, 9, 'Choose installation location');
    const locationResult = await this.configureInstallLocation();
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

    // Step 2: Choose installation type
    this.printStep(2, 9, 'Choose installation method');
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

    // Calculate total steps based on installation type
    const totalSteps = installationType === 'docker' ? 9 : 8;
    let currentStep = 3;

    // Step 3: Check prerequisites and install missing dependencies
    this.printStep(currentStep++, totalSteps, 'Checking system requirements');
    const prereqResult = await this.checkPrerequisites(installationType);
    if (!prereqResult.success) {
      process.exit(1);
    }
    console.log(chalk.green('✓ All prerequisites met\n'));

    // Step 4: Location setup (for geocoding)
    this.printStep(currentStep++, totalSteps, 'Configure your location');
    const locationConfig = await this.configureLocation();
    console.log('');

    // Step 5: Choose services and transcription
    this.printStep(currentStep++, totalSteps, 'Configure transcription and AI');
    const serviceConfig = await this.configureServices(installationType);
    console.log('');

    // Step 6: GPU acceleration (Docker only)
    let gpuConfig = { enableGPU: false };
    if (installationType === 'docker') {
      this.printStep(currentStep++, totalSteps, 'GPU acceleration (optional)');
      gpuConfig = await this.configureGPU(serviceConfig);
      console.log('');
    }

    // Step 7: Optional dependencies (based on selected services)
    this.printStep(currentStep++, totalSteps, 'Optional dependencies');
    const optionalDeps = await this.configureOptionalDependencies(installationType, serviceConfig);
    console.log('');

    // Step 8: Optional integrations
    this.printStep(currentStep++, totalSteps, 'Optional integrations');
    const integrationConfig = await this.configureIntegrations(installationType);
    console.log('');

    // Step 9: Post-installation options
    this.printStep(currentStep++, totalSteps, 'Post-installation options');
    const postInstallConfig = await this.configurePostInstall(installationType, {});
    console.log('');

    // Step 10: Review and install
    this.printStep(currentStep++, totalSteps, 'Review and install');
    
    // Build final configuration with auto-configured URLs
    const urls = SERVICE_URLS[installationType];
    const config = {
      // Installation type
      installationType,
      
      // Core settings (auto-configured)
      webserverPort: DEFAULTS.WEBSERVER_PORT,
      botPort: DEFAULTS.BOT_PORT,
      publicDomain: this.detectPublicDomain(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
      
      // Location
      ...locationConfig,
      
      // Transcription (auto-configured URLs)
      transcriptionMode: serviceConfig.transcriptionMode,
      transcriptionDevice: serviceConfig.transcriptionDevice || 'cpu',
      whisperModel: serviceConfig.whisperModel || DEFAULTS.WHISPER_MODEL,
      fasterWhisperServerUrl: serviceConfig.transcriptionMode === 'remote' 
        ? (serviceConfig.remoteUrl || `http://localhost:${DEFAULTS.WHISPER_SERVER_PORT}`)
        : undefined,
      
      // iCAD (auto-configured)
      enableICAD: serviceConfig.transcriptionMode === 'icad',
      icadUrl: urls.icad,
      icadProfile: DEFAULTS.ICAD_PROFILE,
      icadApiKey: this.generateApiKey(),
      
      // AI Provider (auto-configured URLs)
      aiProvider: serviceConfig.aiProvider,
      openaiApiKey: serviceConfig.openaiApiKey || '',
      openaiModel: serviceConfig.openaiModel || DEFAULTS.OPENAI_MODEL,
      ollamaUrl: urls.ollama,
      ollamaModel: serviceConfig.ollamaModel || DEFAULTS.OLLAMA_MODEL,
      enableOllama: serviceConfig.aiProvider === 'ollama',
      
      // Integrations
      enableDiscord: integrationConfig.enableDiscord,
      discordToken: integrationConfig.discordToken || '',
      clientId: integrationConfig.clientId || '',
      enableTrunkRecorder: integrationConfig.enableTrunkRecorder,
      
      // GPU acceleration (Docker only)
      enableGPU: gpuConfig.enableGPU,
      
      // Auto-generated API key for TrunkRecorder/SDRTrunk
      trunkRecorderApiKey: this.generateApiKey(),
      
      // Geocoding (auto-configured)
      geocodingProvider: 'nominatim',
      
      // Defaults
      storageMode: 'local',
      enableAuth: false,
      enableMappedTalkGroups: true,
      mappedTalkGroups: '',
      
      // Post-installation options
      openWebUI: postInstallConfig.openWebUI,
      enableAutoStart: postInstallConfig.enableAutoStart,
      enableAutoUpdate: postInstallConfig.enableAutoUpdate
    };

    await this.showSummary(config);
    
    const { confirm } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'confirm',
        message: chalk.bold('Proceed with installation?'),
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
      process.exit(1);
    }

    // Show success
    await this.showSuccess(config, installationType, result);
  }

  /**
   * Check prerequisites and install missing dependencies
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
      console.log(chalk.yellow('⚠ Some prerequisites are missing.\n'));
      
      const installResult = await this.dependencyInstaller.checkAndInstall(installationType);
      
      if (!installResult.success) {
        console.log(chalk.red('\n❌ Could not install missing dependencies:'));
        console.log(chalk.red(`   ${installResult.error}`));
        console.log(chalk.yellow('\n💡 Install the missing dependencies manually and run this installer again.'));
        return { success: false };
      }

      // Re-check
      process.stdout.write(chalk.gray('   Re-checking prerequisites...'));
      if (installationType === 'docker') {
        prerequisites = await this.dockerInstaller.checkPrerequisites();
      } else {
        prerequisites = await this.localInstaller.checkPrerequisites();
      }
      process.stdout.write('\r' + ' '.repeat(50) + '\r');

      if (!prerequisites.success) {
        console.log(chalk.red('❌ Prerequisites still missing:\n'));
        prerequisites.errors.forEach(err => console.log(chalk.red(`   • ${err}`)));
        console.log(chalk.yellow('\n💡 You may need to restart your terminal after installing dependencies.'));
        return { success: false };
      }
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
    } else {
      // Detect GPU and recommend Ollama model
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
    const needsGPU = serviceConfig.aiProvider === 'ollama';
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
   */
  async configureOptionalDependencies(installationType, serviceConfig) {
    console.log(chalk.gray('   Install optional dependencies to improve compatibility.\n'));

    const options = [];
    const results = {};

    // Python for local transcription
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

    // Visual Studio Build Tools for Windows (for native modules)
    if (process.platform === 'win32') {
      const hasBuildTools = await this.checkBuildTools();
      if (!hasBuildTools) {
        options.push({
          name: '🔧 Visual Studio Build Tools - Helps build native modules (optional)',
          value: 'buildtools',
          required: false
        });
      }
    }

    // Git (if not installed, though it should be checked earlier)
    const hasGit = this.dependencyInstaller.isInstalled('git');
    if (!hasGit) {
      options.push({
        name: '📦 Git - Version control (usually already installed)',
        value: 'git',
        required: false
      });
    }

    if (options.length === 0) {
      console.log(chalk.green('   ✓ All optional dependencies are already installed.\n'));
      return { installed: [] };
    }

    const { toInstall } = await inquirer.prompt([
      {
        type: 'checkbox',
        name: 'toInstall',
        message: 'Select optional dependencies to install:',
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

    // TrunkRecorder (Docker only - needs USB passthrough which only works on Linux)
    if (installationType === 'docker') {
      const { enableTrunkRecorder } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'enableTrunkRecorder',
          message: 'Enable TrunkRecorder? (Requires Linux + SDR hardware)',
          default: false
        }
      ]);
      config.enableTrunkRecorder = enableTrunkRecorder;

      if (enableTrunkRecorder) {
        console.log(chalk.yellow('\n   ⚠️  TrunkRecorder notes:'));
        console.log(chalk.gray('   • USB passthrough only works on Linux'));
        console.log(chalk.gray('   • Requires building the Docker image first'));
        console.log(chalk.gray('   • See docs/RADIO-SOFTWARE.md for setup\n'));
      }
    } else {
      config.enableTrunkRecorder = false;
    }

    return config;
  }

  /**
   * Configure post-installation options
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
   * Show configuration summary
   */
  async showSummary(config) {
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

    // Location
    console.log(chalk.white.bold('   📍 Location'));
    console.log(chalk.white(`     Area: ${formatValue(`${config.geocodingCity}, ${config.geocodingState}`)}`));
    console.log('');

    // Transcription
    console.log(chalk.white.bold('   🎤 Transcription'));
    console.log(chalk.white(`     Mode: ${formatValue(config.transcriptionMode)}`));
    if (config.transcriptionMode === 'local') {
      console.log(chalk.white(`     Device: ${formatValue(config.transcriptionDevice)}`));
      console.log(chalk.white(`     Model: ${formatValue(config.whisperModel)}`));
    } else if (config.transcriptionMode === 'icad') {
      console.log(chalk.white(`     URL: ${formatValue(config.icadUrl)} (auto)`));
    }
    console.log('');

    // AI
    console.log(chalk.white.bold('   🤖 AI Provider'));
    console.log(chalk.white(`     Provider: ${formatValue(config.aiProvider)}`));
    if (config.aiProvider === 'openai') {
      console.log(chalk.white(`     Model: ${formatValue(config.openaiModel)}`));
      console.log(chalk.white(`     API Key: ${formatValue(config.openaiApiKey, true)}`));
    } else {
      console.log(chalk.white(`     URL: ${formatValue(config.ollamaUrl)} (auto)`));
      console.log(chalk.white(`     Model: ${formatValue(config.ollamaModel)}`));
    }
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
    console.log(chalk.white(`     TrunkRecorder: ${formatValue(config.enableTrunkRecorder)}`));
    console.log('');
  }

  /**
   * Open web UI in browser
   */
  async openWebUI(port) {
    const { exec } = require('child_process');
    const url = `http://localhost:${port}`;
    
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

    if (config.transcriptionMode === 'icad' || config.enableICAD) {
      console.log(chalk.white('   🎤 iCAD Transcribe (Transcription Manager):'));
      console.log(chalk.cyan(`      http://localhost:${DEFAULTS.ICAD_PORT}`));
      console.log(chalk.gray('      Default login: admin / changeme123\n'));
    }

    if (config.aiProvider === 'ollama' || config.enableOllama) {
      console.log(chalk.white('   🤖 Ollama (Local AI - API only):'));
      console.log(chalk.cyan(`      http://localhost:${DEFAULTS.OLLAMA_PORT}\n`));
    }

    // API endpoints
    this.printHeader('API Endpoints');

    console.log(chalk.white('   📡 Audio Upload (SDRTrunk/TrunkRecorder):'));
    console.log(chalk.cyan(`      http://localhost:${config.botPort}/api/call-upload\n`));

    console.log(chalk.white('   🔑 API Key:'));
    console.log(chalk.cyan(`      ${config.trunkRecorderApiKey}`));
    console.log(chalk.gray('      (Saved to data/api-key.txt)\n'));

    if (config.transcriptionMode === 'icad' || config.enableICAD) {
      console.log(chalk.white('   🎤 iCAD Transcribe API:'));
      console.log(chalk.cyan(`      http://localhost:${DEFAULTS.ICAD_PORT}/api/transcribe\n`));
    }

    console.log(chalk.gray('   See docs/RADIO-SOFTWARE.md for detailed setup.\n'));

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

    // Ask to start services (Docker)
    if (installationType === 'docker') {
      const { startNow } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'startNow',
          message: 'Start services now?',
          default: true
        }
      ]);

      if (startNow) {
        console.log(chalk.blue('\n🚀 Starting services...\n'));
        const startResult = await this.dockerInstaller.startServices();
        if (startResult.success) {
          console.log(chalk.green('✓ Services started!\n'));
          
          // Automatically pull Ollama model if using Ollama
          if (config.aiProvider === 'ollama' && config.ollamaModel) {
            console.log(chalk.blue('📥 Pulling Ollama model (this may take a few minutes)...\n'));
            const pullResult = await this.dockerInstaller.pullOllamaModel(config.ollamaModel);
            if (!pullResult.success) {
              console.log(chalk.yellow(`⚠ Could not auto-pull model: ${pullResult.error}`));
              if (pullResult.manualCommand) {
                console.log(chalk.gray(`   Run manually: ${pullResult.manualCommand}`));
              }
            }
          }
          
          // Open web UI if requested
          if (config.openWebUI) {
            await this.openWebUI(config.webserverPort);
          }
          
          console.log(chalk.cyan.bold('🌐 Open Scanner Map: ') + chalk.underline(`http://localhost:${config.webserverPort}`));
          if (config.transcriptionMode === 'icad' || config.enableICAD) {
            console.log(chalk.cyan.bold('🎤 Open iCAD:        ') + chalk.underline(`http://localhost:${DEFAULTS.ICAD_PORT}`));
          }
        } else {
          console.log(chalk.yellow(`⚠ Could not start services: ${startResult.error}`));
          console.log(chalk.gray('   Start manually: docker-compose up -d'));
          if (config.aiProvider === 'ollama' && config.ollamaModel) {
            console.log(chalk.gray(`   Then pull model: docker exec ollama ollama pull ${config.ollamaModel}`));
          }
        }
      } else {
        // Still show model pull command if not starting now
        if (config.aiProvider === 'ollama' && config.ollamaModel) {
          console.log(chalk.white('\n   After starting services, pull the Ollama model:'));
          console.log(chalk.cyan(`     docker exec ollama ollama pull ${config.ollamaModel}\n`));
        }
      }
    } else {
      // Local installation - open web UI if requested
      if (config.openWebUI) {
        await this.openWebUI(config.webserverPort);
      }
    }

    // Configure auto-start
    if (config.enableAutoStart) {
      console.log(chalk.blue('\n⚙️  Configuring auto-start...\n'));
      const autoStartResult = await this.autoStart.configure(installationType, config);
      if (autoStartResult.success) {
        if (autoStartResult.requiresSudo) {
          console.log(chalk.yellow('   ⚠️  Auto-start requires sudo. Run these commands:'));
          autoStartResult.commands.forEach(cmd => console.log(chalk.cyan(`     ${cmd}`)));
          console.log('');
        } else {
          console.log(chalk.green('   ✓ Auto-start configured!\n'));
        }
      } else {
        console.log(chalk.yellow(`   ⚠ Could not configure auto-start: ${autoStartResult.error}\n`));
      }
    }

    // Configure auto-update check
    if (config.enableAutoUpdate) {
      console.log(chalk.blue('⚙️  Configuring auto-update check...\n'));
      const updateConfigResult = await this.updateChecker.configureAutoUpdate(true);
      if (updateConfigResult.success) {
        console.log(chalk.green('   ✓ Auto-update check enabled!\n'));
      } else {
        console.log(chalk.yellow(`   ⚠ Could not configure auto-update: ${updateConfigResult.error}\n`));
      }
    }

    console.log(chalk.green.bold('\n✨ Happy scanning! ✨\n'));
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
