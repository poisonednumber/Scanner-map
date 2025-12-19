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
    this.projectRoot = projectRoot;
    this.dockerInstaller = new DockerInstaller(projectRoot);
    this.localInstaller = new LocalInstaller(projectRoot);
    this.dependencyInstaller = new DependencyInstaller();
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

    // Step 1: Choose installation type
    this.printStep(1, 6, 'Choose installation method');
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

    // Step 2: Check prerequisites
    this.printStep(2, 6, 'Checking system requirements');
    const prereqResult = await this.checkPrerequisites(installationType);
    if (!prereqResult.success) {
      process.exit(1);
    }
    console.log(chalk.green('✓ All prerequisites met\n'));

    // Step 3: Location setup (for geocoding)
    this.printStep(3, 6, 'Configure your location');
    const locationConfig = await this.configureLocation();
    console.log('');

    // Step 4: Choose services and transcription
    this.printStep(4, 6, 'Configure transcription and AI');
    const serviceConfig = await this.configureServices(installationType);
    console.log('');

    // Step 5: Optional integrations
    this.printStep(5, 6, 'Optional integrations');
    const integrationConfig = await this.configureIntegrations(installationType);
    console.log('');

    // Step 6: Review and install
    this.printStep(6, 6, 'Review and install');
    
    // Build final configuration with auto-configured URLs
    const urls = SERVICE_URLS[installationType];
    const config = {
      // Installation type
      installationType,
      
      // Core settings (auto-configured)
      webserverPort: DEFAULTS.WEBSERVER_PORT,
      botPort: DEFAULTS.BOT_PORT,
      publicDomain: 'localhost',
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
      
      // Auto-generated API key for TrunkRecorder/SDRTrunk
      trunkRecorderApiKey: this.generateApiKey(),
      
      // Geocoding (auto-configured)
      geocodingProvider: 'nominatim',
      
      // Defaults
      storageMode: 'local',
      enableAuth: false,
      enableMappedTalkGroups: true,
      mappedTalkGroups: ''
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
   * Configure location for geocoding
   */
  async configureLocation() {
    console.log(chalk.gray('   Your location helps accurately geocode addresses from radio calls.\n'));
    
    return await inquirer.prompt([
      {
        type: 'input',
        name: 'geocodingCity',
        message: 'Primary city/area:',
        default: 'Baltimore',
        validate: input => input.trim().length > 0 || 'City is required'
      },
      {
        type: 'input',
        name: 'geocodingState',
        message: 'State/province code (e.g., MD, CA, NY):',
        default: 'MD',
        filter: input => input.toUpperCase(),
        validate: input => input.trim().length > 0 || 'State is required'
      },
      {
        type: 'input',
        name: 'geocodingCountry',
        message: 'Country code (e.g., us, uk, ca):',
        default: 'us',
        filter: input => input.toLowerCase(),
        validate: input => input.trim().length > 0 || 'Country is required'
      },
      {
        type: 'input',
        name: 'geocodingTargetCounties',
        message: 'Target counties (comma-separated, for filtering):',
        default: 'Baltimore,Baltimore City,Anne Arundel'
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
      const localAnswers = await inquirer.prompt([
        {
          type: 'list',
          name: 'transcriptionDevice',
          message: 'Hardware:',
          choices: [
            { name: '🖥️  CPU - Works everywhere, slower', value: 'cpu' },
            { name: '🎮 CUDA - Much faster (NVIDIA GPU required)', value: 'cuda' }
          ],
          default: 'cpu'
        },
        {
          type: 'list',
          name: 'whisperModel',
          message: 'Model size:',
          choices: [
            { name: 'tiny - Fastest, basic accuracy', value: 'tiny' },
            { name: 'base - Good for low-end hardware', value: 'base' },
            { name: 'small - Recommended (default)', value: 'small' },
            { name: 'medium - Better accuracy, needs 5GB+ RAM', value: 'medium' },
            { name: 'large-v3 - Best accuracy, needs 10GB+ RAM', value: 'large-v3' }
          ],
          default: 'small'
        }
      ]);
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
      const ollamaAnswers = await inquirer.prompt([
        {
          type: 'input',
          name: 'ollamaModel',
          message: 'Ollama model:',
          default: DEFAULTS.OLLAMA_MODEL
        }
      ]);
      Object.assign(config, ollamaAnswers);
      
      console.log(chalk.gray(`\n   📝 Ollama will be available at: ${SERVICE_URLS[installationType].ollama}`));
      if (installationType === 'docker') {
        console.log(chalk.gray(`   📝 Ollama container included - pull model after startup:`));
        console.log(chalk.gray(`      docker exec ollama ollama pull ${ollamaAnswers.ollamaModel}`));
      }
    }

    return config;
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

    // Integrations
    console.log(chalk.white.bold('   🔗 Integrations'));
    console.log(chalk.white(`     Discord: ${formatValue(config.enableDiscord)}`));
    console.log(chalk.white(`     TrunkRecorder: ${formatValue(config.enableTrunkRecorder)}`));
    console.log('');
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

      if (config.aiProvider === 'ollama') {
        console.log(chalk.white('   Pull Ollama model (first time only):'));
        console.log(chalk.cyan(`     docker exec ollama ollama pull ${config.ollamaModel}\n`));
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
          console.log(chalk.cyan.bold('🌐 Open Scanner Map: ') + chalk.underline(`http://localhost:${config.webserverPort}`));
          if (config.transcriptionMode === 'icad' || config.enableICAD) {
            console.log(chalk.cyan.bold('🎤 Open iCAD:        ') + chalk.underline(`http://localhost:${DEFAULTS.ICAD_PORT}`));
          }
        } else {
          console.log(chalk.yellow(`⚠ Could not start services: ${startResult.error}`));
          console.log(chalk.gray('   Start manually: docker-compose up -d'));
        }
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
