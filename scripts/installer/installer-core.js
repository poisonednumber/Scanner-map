/**
 * Core installer for Scanner Map
 * Provides unified installation experience for both Docker and Local installations
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
  printStep(step, total, description) {
    console.log(chalk.cyan(`[${step}/${total}]`) + ' ' + chalk.white(description));
  }

  /**
   * Main installation flow
   */
  async run() {
    // Show welcome
    this.printSectionHeader('Scanner Map Installer');
    console.log(chalk.gray('Welcome! This installer will guide you through setting up Scanner Map.'));
    console.log(chalk.gray('You can press Ctrl+C at any time to cancel.\n'));

    // Check if running in interactive mode
    if (!this.isInteractive()) {
      console.log(chalk.red('\n❌ Error: Installer requires an interactive terminal.'));
      console.log(chalk.yellow('   Please run this script directly in a terminal, not through a batch file.'));
      console.log(chalk.yellow('   Or use environment variables for non-interactive installation.'));
      process.exit(1);
    }

    // Step 1: Choose installation type
    this.printStep(1, 8, 'Selecting installation method');
    const { installationType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'installationType',
        message: 'Choose installation type:',
        choices: [
          { 
            name: '🐳 Docker (Recommended) - Easier to manage, isolated services', 
            value: 'docker',
            short: 'Docker'
          },
          { 
            name: '💻 Local (Non-Docker) - Traditional installation, more control', 
            value: 'local',
            short: 'Local'
          }
        ],
        default: 'docker'
      }
    ]);
    console.log(chalk.green(`✓ Selected: ${installationType === 'docker' ? 'Docker' : 'Local'} installation\n`));

    // Step 2: Check prerequisites and install missing dependencies
    this.printStep(2, 8, 'Checking system requirements');
    process.stdout.write(chalk.gray('   Checking prerequisites...'));
    
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
        console.log(chalk.yellow('\n💡 Tip: Please install the missing dependencies manually and run the installer again.'));
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
        console.log(chalk.red('❌ Prerequisites check still failing:\n'));
        prerequisites.errors.forEach(err => console.log(chalk.red(`   • ${err}`)));
        if (prerequisites.warnings) {
          prerequisites.warnings.forEach(warn => console.log(chalk.yellow(`   ⚠ ${warn}`)));
        }
        console.log(chalk.yellow('\n💡 Tip: Some dependencies may require a system restart or terminal restart.'));
        console.log(chalk.yellow('   Please install missing dependencies manually and run the installer again.'));
        process.exit(1);
      }
    }

    if (prerequisites.warnings && prerequisites.warnings.length > 0) {
      console.log(chalk.yellow('⚠ Warnings:'));
      prerequisites.warnings.forEach(warn => console.log(chalk.yellow(`   • ${warn}`)));
      console.log('');
    }

    console.log(chalk.green('✓ All prerequisites met\n'));

    // Step 3: Configure services
    this.printStep(3, 8, 'Configuring optional services');
    const serviceConfig = await this.configureServices(installationType);
    console.log('');

    // Step 4: Configure core settings
    this.printStep(4, 8, 'Configuring core settings');
    const coreConfig = await this.configureCore();
    console.log('');

    // Step 5: Configure geocoding
    this.printStep(5, 8, 'Configuring geocoding service');
    const geocodingConfig = await this.configureGeocoding();
    console.log('');

    // Step 6: Configure AI provider
    this.printStep(6, 8, 'Configuring AI provider');
    const aiConfig = await this.configureAI(serviceConfig.enableOllama, installationType);
    console.log('');

    // Step 7: Configure Discord (optional)
    this.printStep(7, 8, 'Configuring Discord bot (optional)');
    const discordConfig = await this.configureDiscord();
    console.log('');

    // Step 8: Summary and confirm
    this.printStep(8, 8, 'Review configuration');
    const config = {
      ...serviceConfig,
      ...coreConfig,
      ...geocodingConfig,
      ...aiConfig,
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
      console.log(chalk.yellow('\n⚠ Installation cancelled by user.'));
      console.log(chalk.gray('   You can run the installer again anytime.\n'));
      process.exit(0);
    }

    // Step 9: Install
    console.log(chalk.blue.bold('\n🚀 Starting installation...\n'));
    let result;
    if (installationType === 'docker') {
      result = await this.dockerInstaller.install(config);
    } else {
      result = await this.localInstaller.install(config);
    }

    if (!result.success) {
      console.log(chalk.red(`\n❌ Installation failed: ${result.error}`));
      if (result.details) {
        console.log(chalk.red(`   Details: ${result.details}`));
      }
      process.exit(1);
    }

    // Step 9.5: Pull TrunkRecorder image if enabled (Docker only)
    if (installationType === 'docker' && config.enableTrunkRecorder) {
      process.stdout.write(chalk.gray('   Pulling TrunkRecorder image...'));
      const pullResult = await this.dockerInstaller.pullTrunkRecorderImage();
      process.stdout.write('\r' + ' '.repeat(50) + '\r');
      
      if (!pullResult.success) {
        console.log(chalk.yellow(`⚠ Warning: Could not pull TrunkRecorder image: ${pullResult.error}`));
        console.log(chalk.gray('   Docker Compose will attempt to pull it automatically when starting services.'));
        console.log(chalk.gray('   You can also pull it manually: docker pull robotastic/trunk-recorder:latest\n'));
      } else if (!pullResult.skipped) {
        console.log(chalk.green('✓ TrunkRecorder image pulled successfully\n'));
      }
    }

    // Step 10: Show success and next steps
    console.log(chalk.green.bold('✅ Installation completed successfully!\n'));
    this.printSectionHeader('Next Steps');
    result.nextSteps.forEach((step, index) => {
      console.log(chalk.white(`   ${step}`));
    });
    console.log('');

    // Step 11: Ask to start services
    if (installationType === 'docker') {
      const { startNow } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'startNow',
          message: 'Start Docker services now?',
          default: true
        }
      ]);

      if (startNow) {
        console.log(chalk.blue('🚀 Starting Docker services...\n'));
        const startResult = await this.dockerInstaller.startServices();
        if (startResult.success) {
          if (startResult.warning) {
            // If there's a warning, it means services were already running or had conflicts
            console.log(chalk.yellow(`⚠ ${startResult.warning}\n`));
          } else {
            // Services were actually started
            console.log(chalk.green('✓ Services started successfully!\n'));
          }
          console.log(chalk.cyan.bold('🌐 Access the web interface at: ') + chalk.underline('http://localhost:3001'));
        } else {
          console.log(chalk.yellow(`⚠ Could not start services: ${startResult.error}`));
          console.log(chalk.gray('   You can start them manually with: docker-compose up -d'));
          console.log(chalk.gray('   Or start individual services: docker-compose up -d scanner-map'));
        }
      } else {
        console.log(chalk.gray('   Services not started. Start them manually with: docker-compose up -d'));
      }
    }

    // Step 12: Ask about auto-start on boot
    if (installationType === 'local') {
      const { setupAutostart } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'setupAutostart',
          message: 'Set up auto-start on boot?',
          default: false
        }
      ]);

      if (setupAutostart) {
        console.log(chalk.blue('\nSetting up auto-start...'));
        const autostartResult = await this.localInstaller.setupAutostart();
        if (autostartResult.success) {
          console.log(chalk.green(`✓ ${autostartResult.message}`));
        } else {
          console.log(chalk.yellow(`⚠ Could not set up auto-start: ${autostartResult.error}`));
        }
      }
    }

    console.log(chalk.green.bold('\n✨ Installation complete! Happy scanning! ✨\n'));
    console.log(chalk.gray('   Need help? Check the documentation or open an issue on GitHub.\n'));
  }

  /**
   * Configure optional services
   */
  async configureServices(installationType) {
    console.log(chalk.gray('   These services are optional and can be enabled later if needed.\n'));
    
    const questions = [
      {
        type: 'confirm',
        name: 'enableOllama',
        message: 'Enable Ollama? (Local AI service for transcription)',
        default: false
      },
      {
        type: 'confirm',
        name: 'enableICAD',
        message: 'Enable iCAD Transcribe? (Advanced transcription with better accuracy)',
        default: false
      },
      {
        type: 'confirm',
        name: 'enableTrunkRecorder',
        message: 'Enable TrunkRecorder? (Radio recording and call capture)',
        default: false
      }
    ];

    return await inquirer.prompt(questions);
  }

  /**
   * Configure core settings
   */
  async configureCore() {
    console.log(chalk.gray('   Configure basic settings for Scanner Map.\n'));
    
    return await inquirer.prompt([
      {
        type: 'input',
        name: 'webserverPort',
        message: 'Web server port:',
        default: 3001,
        validate: (input) => {
          const port = parseInt(input);
          if (isNaN(port) || port <= 0 || port >= 65536) {
            return 'Please enter a valid port number (1-65535)';
          }
          return true;
        },
        filter: (input) => parseInt(input)
      },
      {
        type: 'input',
        name: 'botPort',
        message: 'API port (for call uploads):',
        default: 3306,
        validate: (input) => {
          const port = parseInt(input);
          if (isNaN(port) || port <= 0 || port >= 65536) {
            return 'Please enter a valid port number (1-65535)';
          }
          return true;
        },
        filter: (input) => parseInt(input)
      },
      {
        type: 'input',
        name: 'publicDomain',
        message: 'Public domain (for Discord embeds):',
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
        message: 'Timezone (e.g., America/New_York):',
        default: 'America/New_York',
        validate: (input) => {
          if (!input || input.trim().length === 0) {
            return 'Timezone cannot be empty';
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
    console.log(chalk.gray('   Geocoding converts addresses to coordinates for map display.\n'));
    
    const { provider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Choose geocoding provider:',
        choices: [
          { 
            name: '📍 Nominatim (OpenStreetMap) - FREE, no API key required', 
            value: 'nominatim',
            short: 'Nominatim'
          },
          { 
            name: '🌍 LocationIQ - FREE tier available (60,000 requests/day)', 
            value: 'locationiq',
            short: 'LocationIQ'
          },
          { 
            name: '🗺️  Google Maps - Paid service (most accurate)', 
            value: 'google',
            short: 'Google Maps'
          }
        ],
        default: 'nominatim'
      }
    ]);

    const config = {
      geocodingProvider: provider,
      geocodingState: 'MD',
      geocodingCountry: 'us',
      geocodingCity: 'Baltimore',
      geocodingTargetCounties: 'Baltimore,Baltimore City,Anne Arundel'
    };

    if (provider === 'locationiq') {
      const { apiKey } = await inquirer.prompt([
        {
          type: 'input',
          name: 'apiKey',
          message: 'LocationIQ API key (optional - get one at locationiq.com):',
          default: ''
        }
      ]);
      config.locationiqApiKey = apiKey;
    } else if (provider === 'google') {
      const { apiKey } = await inquirer.prompt([
        {
          type: 'input',
          name: 'apiKey',
          message: 'Google Maps API key (optional - get one at console.cloud.google.com):',
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
    
    console.log(chalk.gray('   AI is used for transcribing and processing radio calls.\n'));
    
    const { provider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Choose AI provider:',
        choices: [
          { 
            name: '🤖 OpenAI (ChatGPT) - Cloud-based, requires API key', 
            value: 'openai',
            short: 'OpenAI'
          },
          { 
            name: '🏠 Ollama (Local AI) - Runs on your machine, free', 
            value: 'ollama',
            short: 'Ollama'
          }
        ],
        default: defaultProvider
      }
    ]);

    const config = {
      aiProvider: provider
    };

    if (provider === 'openai') {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'apiKey',
          message: 'OpenAI API key (optional - get one at platform.openai.com):',
          default: ''
        },
        {
          type: 'input',
          name: 'model',
          message: 'OpenAI model name:',
          default: 'gpt-4o-mini',
          validate: (input) => {
            if (!input || input.trim().length === 0) {
              return 'Model name cannot be empty';
            }
            return true;
          }
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
          message: 'Ollama URL:',
          default: defaultOllamaUrl,
          validate: (input) => {
            if (!input || input.trim().length === 0) {
              return 'URL cannot be empty';
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
          name: 'model',
          message: 'Ollama model name:',
          default: 'llama3.1:8b',
          validate: (input) => {
            if (!input || input.trim().length === 0) {
              return 'Model name cannot be empty';
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
    console.log(chalk.gray('   Discord bot can send radio call notifications to Discord channels.\n'));
    
    const { enable } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enable',
        message: 'Configure Discord bot?',
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
        message: 'Discord bot token (get one at discord.com/developers):',
        mask: '*',
        validate: (input) => {
          if (!input || input.trim().length === 0) {
            return 'Discord token is required';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'clientId',
        message: 'Discord Client ID (optional - for slash commands):',
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
    console.log(chalk.blue.bold('\n📋 Installation Summary\n'));
    console.log(chalk.gray('   Review your configuration before proceeding:\n'));

    const formatValue = (value) => {
      if (typeof value === 'boolean') {
        return value ? chalk.green('✓ Enabled') : chalk.gray('Disabled');
      }
      return chalk.cyan(value);
    };

    console.log(chalk.white('   Installation Type: ') + formatValue(config.installationType));
    console.log(chalk.white('   Web Server Port: ') + formatValue(config.webserverPort));
    console.log(chalk.white('   API Port: ') + formatValue(config.botPort));
    console.log(chalk.white('   Timezone: ') + formatValue(config.timezone));
    console.log(chalk.white('   Geocoding: ') + formatValue(config.geocodingProvider));
    console.log(chalk.white('   AI Provider: ') + formatValue(config.aiProvider));
    console.log(chalk.white('   Discord Bot: ') + formatValue(config.enableDiscord));
    console.log(chalk.white('   Ollama: ') + formatValue(config.enableOllama));
    console.log(chalk.white('   iCAD Transcribe: ') + formatValue(config.enableICAD));
    console.log(chalk.white('   TrunkRecorder: ') + formatValue(config.enableTrunkRecorder));
    console.log('');
  }
}

// Run if called directly
if (require.main === module) {
  const projectRoot = process.cwd();
  const installer = new InstallerCore(projectRoot);
  installer.run().catch(err => {
    // Handle inquirer errors gracefully
    if (err.code === 'ERR_USE_AFTER_CLOSE' || err.message.includes('readline')) {
      console.error(chalk.red('\n❌ Installer requires an interactive terminal.'));
      console.error(chalk.yellow('   Please run this script directly in a terminal.'));
      console.error(chalk.yellow('   The installer cannot run in non-interactive mode.'));
    } else {
      console.error(chalk.red('\n❌ Installation error:'), err);
    }
    process.exit(1);
  });
}

module.exports = InstallerCore;
