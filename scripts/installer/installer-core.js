/**
 * Scanner Map - Interactive Installer
 * Unified setup for both Docker and Local installations
 */

const inquirer = require('inquirer');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs-extra');
const DockerInstaller = require('./docker-installer');
const LocalInstaller = require('./local-installer');
const DependencyInstaller = require('./dependency-installer');

class InstallerCore {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.dockerInstaller = new DockerInstaller(projectRoot);
    this.localInstaller = new LocalInstaller(projectRoot);
    this.dependencyInstaller = new DependencyInstaller();
    this.totalSteps = 9;
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
  printSectionHeader(title) {
    console.log(chalk.blue.bold('\n' + '═'.repeat(50)));
    console.log(chalk.blue.bold(`  ${title}`));
    console.log(chalk.blue.bold('═'.repeat(50) + '\n'));
  }

  /**
   * Print a step indicator
   */
  printStep(step, description) {
    console.log(chalk.cyan(`[${step}/${this.totalSteps}]`) + ' ' + chalk.white(description));
  }

  /**
   * Main installation flow
   */
  async run() {
    // Show welcome
    this.printSectionHeader('Scanner Map Setup');
    console.log(chalk.gray('Welcome! This installer will guide you through setting up Scanner Map.'));
    console.log(chalk.gray('Press Ctrl+C at any time to cancel.\n'));

    // Check if running in interactive mode
    if (!this.isInteractive()) {
      console.log(chalk.red('\n❌ Error: This installer requires an interactive terminal.'));
      console.log(chalk.yellow('   Run this script directly in a terminal window.'));
      console.log(chalk.yellow('   For non-interactive setup, configure the .env file manually.'));
      process.exit(1);
    }

    // Step 1: Choose installation type
    this.printStep(1, 'Choose installation method');
    const { installationType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'installationType',
        message: 'How would you like to install Scanner Map?',
        choices: [
          { 
            name: '🐳 Docker (Recommended) - Isolated containers, easier updates', 
            value: 'docker',
            short: 'Docker'
          },
          { 
            name: '💻 Local - Run directly on your system, more control', 
            value: 'local',
            short: 'Local'
          }
        ],
        default: 'docker'
      }
    ]);
    console.log(chalk.green(`✓ ${installationType === 'docker' ? 'Docker' : 'Local'} installation selected\n`));

    // Step 2: Check prerequisites and install missing dependencies
    this.printStep(2, 'Checking system requirements');
    process.stdout.write(chalk.gray('   Verifying prerequisites...'));
    
    let prerequisites;
    if (installationType === 'docker') {
      prerequisites = await this.dockerInstaller.checkPrerequisites();
    } else {
      prerequisites = await this.localInstaller.checkPrerequisites();
    }

    // Clear the checking message
    process.stdout.write('\r' + ' '.repeat(50) + '\r');

    // If prerequisites failed, try to install missing dependencies
    if (!prerequisites.success) {
      console.log(chalk.yellow('⚠ Some prerequisites are missing.\n'));
      
      // Attempt to install missing dependencies
      const installResult = await this.dependencyInstaller.checkAndInstall(installationType);
      
      if (!installResult.success) {
        console.log(chalk.red('\n❌ Could not install missing dependencies:'));
        console.log(chalk.red(`   ${installResult.error}`));
        if (installResult.installed && installResult.installed.length > 0) {
          console.log(chalk.green('\n✓ Successfully installed:'));
          installResult.installed.forEach(item => console.log(chalk.green(`   - ${item}`)));
        }
        console.log(chalk.yellow('\n💡 Install the missing dependencies manually and run this installer again.'));
        process.exit(1);
      }

      if (installResult.installed && installResult.installed.length > 0) {
        console.log(chalk.green('✓ Successfully installed:'));
        installResult.installed.forEach(item => console.log(chalk.green(`   - ${item}`)));
        console.log('');
      }

      // Re-check prerequisites after installation
      process.stdout.write(chalk.gray('   Re-checking prerequisites...'));
      if (installationType === 'docker') {
        prerequisites = await this.dockerInstaller.checkPrerequisites();
      } else {
        prerequisites = await this.localInstaller.checkPrerequisites();
      }
      process.stdout.write('\r' + ' '.repeat(50) + '\r');

      // If still failing after installation attempt, show errors
      if (!prerequisites.success) {
        console.log(chalk.red('❌ Prerequisites still missing:\n'));
        prerequisites.errors.forEach(err => console.log(chalk.red(`   • ${err}`)));
        if (prerequisites.warnings) {
          prerequisites.warnings.forEach(warn => console.log(chalk.yellow(`   ⚠ ${warn}`)));
        }
        console.log(chalk.yellow('\n💡 You may need to restart your terminal after installing dependencies.'));
        process.exit(1);
      }
    }

    if (prerequisites.warnings && prerequisites.warnings.length > 0) {
      console.log(chalk.yellow('⚠ Warnings:'));
      prerequisites.warnings.forEach(warn => console.log(chalk.yellow(`   • ${warn}`)));
      console.log('');
    }

    console.log(chalk.green('✓ All prerequisites met\n'));

    // Step 3: Configure core settings
    this.printStep(3, 'Configure basic settings');
    const coreConfig = await this.configureCore();
    console.log('');

    // Step 4: Configure geocoding
    this.printStep(4, 'Configure geocoding (address to coordinates)');
    const geocodingConfig = await this.configureGeocoding();
    console.log('');

    // Step 5: Configure transcription
    this.printStep(5, 'Configure audio transcription');
    const transcriptionConfig = await this.configureTranscription(installationType);
    console.log('');

    // Step 6: Configure AI provider
    this.printStep(6, 'Configure AI provider (for call analysis)');
    const aiConfig = await this.configureAI(transcriptionConfig.enableOllama, installationType);
    console.log('');

    // Step 7: Configure optional services
    this.printStep(7, 'Configure optional services');
    const serviceConfig = await this.configureServices(installationType);
    console.log('');

    // Step 8: Configure Discord (optional)
    this.printStep(8, 'Configure Discord integration (optional)');
    const discordConfig = await this.configureDiscord();
    console.log('');

    // Step 9: Summary and confirm
    this.printStep(9, 'Review and confirm');
    const config = {
      ...coreConfig,
      ...geocodingConfig,
      ...transcriptionConfig,
      ...aiConfig,
      ...serviceConfig,
      ...discordConfig,
      installationType
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
      console.log(chalk.gray('   Run this installer again when you\'re ready.\n'));
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
      if (result.details) {
        console.log(chalk.red(`   ${result.details}`));
      }
      process.exit(1);
    }

    // Pull TrunkRecorder image if enabled (Docker only)
    if (installationType === 'docker' && config.enableTrunkRecorder) {
      process.stdout.write(chalk.gray('   Pulling TrunkRecorder image...'));
      const pullResult = await this.dockerInstaller.pullTrunkRecorderImage();
      process.stdout.write('\r' + ' '.repeat(50) + '\r');
      
      if (!pullResult.success) {
        console.log(chalk.yellow(`⚠ Could not pull TrunkRecorder image: ${pullResult.error}`));
        console.log(chalk.gray('   It will be pulled automatically when starting services.'));
        console.log(chalk.gray('   Or pull manually: docker pull robotastic/trunk-recorder:latest\n'));
      } else if (!pullResult.skipped) {
        console.log(chalk.green('✓ TrunkRecorder image ready\n'));
      }
    }

    // Show success and next steps
    console.log(chalk.green.bold('✅ Setup completed successfully!\n'));
    this.printSectionHeader('Next Steps');
    result.nextSteps.forEach((step, index) => {
      console.log(chalk.white(`   ${step}`));
    });
    console.log('');

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
          if (startResult.warning) {
            console.log(chalk.yellow(`⚠ ${startResult.warning}\n`));
          } else {
            console.log(chalk.green('✓ Services started!\n'));
          }
          const port = config.webserverPort || 3001;
          console.log(chalk.cyan.bold('🌐 Web interface: ') + chalk.underline(`http://localhost:${port}`));
        } else {
          console.log(chalk.yellow(`⚠ Could not start services: ${startResult.error}`));
          console.log(chalk.gray('   Start manually with: docker-compose up -d'));
        }
      } else {
        console.log(chalk.gray('\n   Start services later with: docker-compose up -d'));
      }
    }

    // Ask about auto-start on boot (Local)
    if (installationType === 'local') {
      const { setupAutostart } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'setupAutostart',
          message: 'Configure auto-start on system boot?',
          default: false
        }
      ]);

      if (setupAutostart) {
        console.log(chalk.blue('\nConfiguring auto-start...'));
        const autostartResult = await this.localInstaller.setupAutostart();
        if (autostartResult.success) {
          console.log(chalk.green(`✓ ${autostartResult.message}`));
        } else {
          console.log(chalk.yellow(`⚠ Auto-start setup failed: ${autostartResult.error}`));
        }
      }

      const port = config.webserverPort || 3001;
      console.log(chalk.gray(`\n   Start Scanner Map with: node bot.js`));
      console.log(chalk.cyan.bold('🌐 Web interface: ') + chalk.underline(`http://localhost:${port}`));
    }

    console.log(chalk.green.bold('\n✨ Setup complete! Happy scanning! ✨\n'));
    console.log(chalk.gray('   Documentation: https://github.com/poisonednumber/Scanner-map\n'));
  }

  /**
   * Configure optional services
   */
  async configureServices(installationType) {
    console.log(chalk.gray('   These are optional add-on services.\n'));
    
    const questions = [
      {
        type: 'confirm',
        name: 'enableTrunkRecorder',
        message: 'Enable TrunkRecorder? (Capture radio calls from SDR hardware)',
        default: false
      }
    ];

    return await inquirer.prompt(questions);
  }

  /**
   * Configure transcription settings
   */
  async configureTranscription(installationType) {
    console.log(chalk.gray('   Transcription converts audio to text for display and analysis.\n'));
    
    const { mode } = await inquirer.prompt([
      {
        type: 'list',
        name: 'mode',
        message: 'Choose transcription method:',
        choices: [
          { 
            name: '🏠 Local (Whisper) - Runs on your machine, requires Python', 
            value: 'local',
            short: 'Local'
          },
          { 
            name: '☁️  OpenAI Whisper API - Cloud-based, requires API key', 
            value: 'openai',
            short: 'OpenAI'
          },
          { 
            name: '🌐 Remote Faster-Whisper Server - Use an external Whisper server', 
            value: 'remote',
            short: 'Remote'
          },
          { 
            name: '📡 iCAD Transcribe - Use iCAD transcription service', 
            value: 'icad',
            short: 'iCAD'
          }
        ],
        default: 'local'
      }
    ]);

    const config = {
      transcriptionMode: mode,
      enableOllama: false
    };

    if (mode === 'local') {
      const answers = await inquirer.prompt([
        {
          type: 'list',
          name: 'device',
          message: 'Transcription hardware:',
          choices: [
            { name: '🖥️  CPU - Works on any machine, slower', value: 'cpu', short: 'CPU' },
            { name: '🎮 CUDA (NVIDIA GPU) - Much faster, requires NVIDIA GPU', value: 'cuda', short: 'CUDA' }
          ],
          default: 'cpu'
        },
        {
          type: 'list',
          name: 'model',
          message: 'Whisper model size:',
          choices: [
            { name: 'tiny - Fastest, lowest accuracy', value: 'tiny', short: 'tiny' },
            { name: 'base - Good balance for low-end hardware', value: 'base', short: 'base' },
            { name: 'small - Recommended for most users', value: 'small', short: 'small' },
            { name: 'medium - Better accuracy, more resources', value: 'medium', short: 'medium' },
            { name: 'large-v3 - Best accuracy, requires powerful hardware', value: 'large-v3', short: 'large-v3' }
          ],
          default: 'small'
        }
      ]);
      config.transcriptionDevice = answers.device;
      config.whisperModel = answers.model;
    } else if (mode === 'openai') {
      // OpenAI API key will be collected in the AI provider step
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'model',
          message: 'OpenAI transcription model:',
          default: 'whisper-1'
        }
      ]);
      config.openaiTranscriptionModel = answers.model;
    } else if (mode === 'remote') {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'url',
          message: 'Faster-Whisper server URL:',
          default: 'http://localhost:8000',
          validate: (input) => {
            if (!input || input.trim().length === 0) {
              return 'URL is required';
            }
            try {
              new URL(input);
              return true;
            } catch {
              return 'Please enter a valid URL';
            }
          }
        }
      ]);
      config.fasterWhisperServerUrl = answers.url;
    } else if (mode === 'icad') {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'url',
          message: 'iCAD API URL:',
          validate: (input) => {
            if (!input || input.trim().length === 0) {
              return 'URL is required';
            }
            try {
              new URL(input);
              return true;
            } catch {
              return 'Please enter a valid URL';
            }
          }
        },
        {
          type: 'input',
          name: 'profile',
          message: 'iCAD profile name (optional):',
          default: ''
        },
        {
          type: 'input',
          name: 'apiKey',
          message: 'iCAD API key (optional):',
          default: ''
        }
      ]);
      config.icadUrl = answers.url;
      config.icadProfile = answers.profile;
      config.icadApiKey = answers.apiKey;
    }

    return config;
  }

  /**
   * Configure core settings
   */
  async configureCore() {
    console.log(chalk.gray('   Set up ports, domain, and timezone.\n'));
    
    return await inquirer.prompt([
      {
        type: 'input',
        name: 'webserverPort',
        message: 'Web interface port:',
        default: 3001,
        validate: (input) => {
          const port = parseInt(input);
          if (isNaN(port) || port <= 0 || port >= 65536) {
            return 'Enter a valid port number (1-65535)';
          }
          return true;
        },
        filter: (input) => parseInt(input)
      },
      {
        type: 'input',
        name: 'botPort',
        message: 'API port (receives audio uploads):',
        default: 3306,
        validate: (input) => {
          const port = parseInt(input);
          if (isNaN(port) || port <= 0 || port >= 65536) {
            return 'Enter a valid port number (1-65535)';
          }
          return true;
        },
        filter: (input) => parseInt(input)
      },
      {
        type: 'input',
        name: 'publicDomain',
        message: 'Public domain or IP (for Discord links):',
        default: 'localhost',
        validate: (input) => {
          if (!input || input.trim().length === 0) {
            return 'Domain cannot be empty';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'timezone',
        message: 'Your timezone:',
        default: 'America/New_York',
        validate: (input) => {
          if (!input || input.trim().length === 0) {
            return 'Timezone is required';
          }
          return true;
        }
      }
    ]);
  }

  /**
   * Configure geocoding service
   */
  async configureGeocoding() {
    console.log(chalk.gray('   Geocoding converts addresses to map coordinates.\n'));
    
    // First, get location info to help with geocoding accuracy
    const locationAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'city',
        message: 'Primary city/area name:',
        default: 'Baltimore',
        validate: (input) => input.trim().length > 0 || 'City is required'
      },
      {
        type: 'input',
        name: 'state',
        message: 'State/province code (e.g., MD, CA, NY):',
        default: 'MD',
        validate: (input) => input.trim().length > 0 || 'State is required'
      },
      {
        type: 'input',
        name: 'country',
        message: 'Country code (e.g., us, uk, ca):',
        default: 'us',
        validate: (input) => input.trim().length > 0 || 'Country is required'
      },
      {
        type: 'input',
        name: 'counties',
        message: 'Target counties (comma-separated):',
        default: 'Baltimore,Baltimore City,Anne Arundel'
      }
    ]);

    const { provider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Geocoding provider:',
        choices: [
          { 
            name: '📍 Nominatim (OpenStreetMap) - Free, no API key needed', 
            value: 'nominatim',
            short: 'Nominatim'
          },
          { 
            name: '🌍 LocationIQ - Free tier (60k requests/day)', 
            value: 'locationiq',
            short: 'LocationIQ'
          },
          { 
            name: '🗺️  Google Maps - Paid, most accurate', 
            value: 'google',
            short: 'Google Maps'
          }
        ],
        default: 'nominatim'
      }
    ]);

    const config = {
      geocodingProvider: provider,
      geocodingCity: locationAnswers.city,
      geocodingState: locationAnswers.state.toUpperCase(),
      geocodingCountry: locationAnswers.country.toLowerCase(),
      geocodingTargetCounties: locationAnswers.counties
    };

    if (provider === 'locationiq') {
      const { apiKey } = await inquirer.prompt([
        {
          type: 'input',
          name: 'apiKey',
          message: 'LocationIQ API key (get one at locationiq.com):',
          default: ''
        }
      ]);
      config.locationiqApiKey = apiKey;
    } else if (provider === 'google') {
      const { apiKey } = await inquirer.prompt([
        {
          type: 'input',
          name: 'apiKey',
          message: 'Google Maps API key (get one at console.cloud.google.com):',
          default: ''
        }
      ]);
      config.googleMapsApiKey = apiKey;
    }

    return config;
  }

  /**
   * Configure AI provider
   */
  async configureAI(ollamaEnabled, installationType = 'docker') {
    const defaultProvider = ollamaEnabled ? 'ollama' : 'openai';
    
    console.log(chalk.gray('   AI analyzes transcribed calls to extract addresses and summaries.\n'));
    
    const { provider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'AI provider for call analysis:',
        choices: [
          { 
            name: '🤖 OpenAI (GPT) - Cloud-based, requires API key', 
            value: 'openai',
            short: 'OpenAI'
          },
          { 
            name: '🏠 Ollama - Run AI locally, free but needs good hardware', 
            value: 'ollama',
            short: 'Ollama'
          }
        ],
        default: defaultProvider
      }
    ]);

    const config = {
      aiProvider: provider,
      enableOllama: provider === 'ollama'
    };

    if (provider === 'openai') {
      const answers = await inquirer.prompt([
        {
          type: 'password',
          name: 'apiKey',
          message: 'OpenAI API key (get one at platform.openai.com):',
          mask: '*',
          default: ''
        },
        {
          type: 'list',
          name: 'model',
          message: 'OpenAI model:',
          choices: [
            { name: 'gpt-4o-mini - Fast, affordable, good quality', value: 'gpt-4o-mini' },
            { name: 'gpt-4o - Best quality, higher cost', value: 'gpt-4o' },
            { name: 'gpt-3.5-turbo - Cheapest, lower quality', value: 'gpt-3.5-turbo' }
          ],
          default: 'gpt-4o-mini'
        }
      ]);
      config.openaiApiKey = answers.apiKey;
      config.openaiModel = answers.model;
    } else {
      const defaultOllamaUrl = installationType === 'docker' ? 'http://ollama:11434' : 'http://localhost:11434';
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'url',
          message: 'Ollama server URL:',
          default: defaultOllamaUrl,
          validate: (input) => {
            if (!input || input.trim().length === 0) {
              return 'URL is required';
            }
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
          name: 'model',
          message: 'Ollama model (e.g., llama3.1:8b, mistral):',
          default: 'llama3.1:8b',
          validate: (input) => {
            if (!input || input.trim().length === 0) {
              return 'Model name is required';
            }
            return true;
          }
        }
      ]);
      config.ollamaUrl = answers.url;
      config.ollamaModel = answers.model;
    }

    return config;
  }

  /**
   * Configure Discord bot
   */
  async configureDiscord() {
    console.log(chalk.gray('   Discord bot sends call notifications to your server.\n'));
    
    const { enable } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enable',
        message: 'Enable Discord bot integration?',
        default: false
      }
    ]);

    if (!enable) {
      return {
        enableDiscord: false,
        discordToken: '',
        clientId: ''
      };
    }

    const answers = await inquirer.prompt([
      {
        type: 'password',
        name: 'token',
        message: 'Discord bot token (from discord.com/developers):',
        mask: '*',
        validate: (input) => {
          if (!input || input.trim().length === 0) {
            return 'Bot token is required';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'clientId',
        message: 'Discord Client ID (for slash commands, optional):',
        default: ''
      }
    ]);

    return {
      enableDiscord: true,
      discordToken: answers.token,
      clientId: answers.clientId || ''
    };
  }

  /**
   * Show installation summary
   */
  async showSummary(config) {
    console.log(chalk.blue.bold('\n📋 Configuration Summary\n'));
    console.log(chalk.gray('   Review your settings before proceeding:\n'));

    const formatValue = (value) => {
      if (typeof value === 'boolean') {
        return value ? chalk.green('✓ Yes') : chalk.gray('No');
      }
      if (value === undefined || value === null || value === '') {
        return chalk.gray('Not set');
      }
      return chalk.cyan(value);
    };

    // Installation
    console.log(chalk.white.bold('   Installation'));
    console.log(chalk.white('     Type: ') + formatValue(config.installationType === 'docker' ? 'Docker' : 'Local'));
    console.log(chalk.white('     Web Port: ') + formatValue(config.webserverPort));
    console.log(chalk.white('     API Port: ') + formatValue(config.botPort));
    console.log(chalk.white('     Timezone: ') + formatValue(config.timezone));
    console.log('');

    // Location & Geocoding
    console.log(chalk.white.bold('   Location'));
    console.log(chalk.white('     City: ') + formatValue(config.geocodingCity));
    console.log(chalk.white('     State: ') + formatValue(config.geocodingState));
    console.log(chalk.white('     Provider: ') + formatValue(config.geocodingProvider));
    console.log('');

    // Transcription
    console.log(chalk.white.bold('   Transcription'));
    console.log(chalk.white('     Mode: ') + formatValue(config.transcriptionMode));
    if (config.transcriptionMode === 'local') {
      console.log(chalk.white('     Device: ') + formatValue(config.transcriptionDevice));
      console.log(chalk.white('     Model: ') + formatValue(config.whisperModel));
    }
    console.log('');

    // AI
    console.log(chalk.white.bold('   AI Provider'));
    console.log(chalk.white('     Provider: ') + formatValue(config.aiProvider));
    if (config.aiProvider === 'openai') {
      console.log(chalk.white('     Model: ') + formatValue(config.openaiModel));
      console.log(chalk.white('     API Key: ') + formatValue(config.openaiApiKey ? '••••••••' : 'Not set'));
    } else {
      console.log(chalk.white('     Model: ') + formatValue(config.ollamaModel));
    }
    console.log('');

    // Integrations
    console.log(chalk.white.bold('   Integrations'));
    console.log(chalk.white('     Discord Bot: ') + formatValue(config.enableDiscord));
    console.log(chalk.white('     TrunkRecorder: ') + formatValue(config.enableTrunkRecorder));
    console.log('');
  }
}

// Run if called directly
if (require.main === module) {
  const projectRoot = process.cwd();
  const installer = new InstallerCore(projectRoot);
  installer.run().catch(err => {
    // Handle inquirer errors gracefully
    if (err.code === 'ERR_USE_AFTER_CLOSE' || err.message?.includes('readline')) {
      console.error(chalk.red('\n❌ This installer requires an interactive terminal.'));
      console.error(chalk.yellow('   Run this script directly in a terminal window.'));
    } else {
      console.error(chalk.red('\n❌ Setup error:'), err.message || err);
    }
    process.exit(1);
  });
}

module.exports = InstallerCore;
