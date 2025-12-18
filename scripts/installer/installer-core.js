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
   * Main installation flow
   */
  async run() {
    console.log(chalk.blue.bold('\n════════════════════════════════════════'));
    console.log(chalk.blue.bold('  Scanner Map Installer'));
    console.log(chalk.blue.bold('════════════════════════════════════════\n'));

    // Check if running in interactive mode
    if (!this.isInteractive()) {
      console.log(chalk.red('\n❌ Error: Installer requires an interactive terminal.'));
      console.log(chalk.yellow('   Please run this script directly in a terminal, not through a batch file.'));
      console.log(chalk.yellow('   Or use environment variables for non-interactive installation.'));
      process.exit(1);
    }

    // Step 1: Choose installation type
    const { installationType } = await inquirer.prompt([
      {
        type: 'list',
        name: 'installationType',
        message: 'Choose installation type:',
        choices: [
          { name: 'Docker (Recommended)', value: 'docker' },
          { name: 'Local (Non-Docker)', value: 'local' }
        ],
        default: 'docker'
      }
    ]);

    // Step 2: Check prerequisites and install missing dependencies
    console.log(chalk.yellow('\nChecking prerequisites...'));
    let prerequisites;
    if (installationType === 'docker') {
      prerequisites = await this.dockerInstaller.checkPrerequisites();
    } else {
      prerequisites = await this.localInstaller.checkPrerequisites();
    }

    // If prerequisites failed, try to install missing dependencies
    if (!prerequisites.success) {
      console.log(chalk.yellow('\nSome prerequisites are missing.'));
      
      // Attempt to install missing dependencies
      const installResult = await this.dependencyInstaller.checkAndInstall(installationType);
      
      if (!installResult.success) {
        console.log(chalk.red('\n❌ Could not install missing dependencies:'));
        console.log(chalk.red(`   ${installResult.error}`));
        if (installResult.installed && installResult.installed.length > 0) {
          console.log(chalk.green('\n✓ Successfully installed:'));
          installResult.installed.forEach(item => console.log(chalk.green(`   - ${item}`)));
        }
        console.log(chalk.yellow('\nPlease install the missing dependencies manually and run the installer again.'));
        process.exit(1);
      }

      if (installResult.installed && installResult.installed.length > 0) {
        console.log(chalk.green('\n✓ Successfully installed:'));
        installResult.installed.forEach(item => console.log(chalk.green(`   - ${item}`)));
      }

      // Re-check prerequisites after installation
      console.log(chalk.yellow('\nRe-checking prerequisites...'));
      if (installationType === 'docker') {
        prerequisites = await this.dockerInstaller.checkPrerequisites();
      } else {
        prerequisites = await this.localInstaller.checkPrerequisites();
      }

      // If still failing after installation attempt, show errors
      if (!prerequisites.success) {
        console.log(chalk.red('\n❌ Prerequisites check still failing:'));
        prerequisites.errors.forEach(err => console.log(chalk.red(`   - ${err}`)));
        if (prerequisites.warnings) {
          prerequisites.warnings.forEach(warn => console.log(chalk.yellow(`   ⚠ ${warn}`)));
        }
        console.log(chalk.yellow('\nSome dependencies may require a system restart or terminal restart.'));
        console.log(chalk.yellow('Please install missing dependencies manually and run the installer again.'));
        process.exit(1);
      }
    }

    if (prerequisites.warnings && prerequisites.warnings.length > 0) {
      prerequisites.warnings.forEach(warn => console.log(chalk.yellow(`   ⚠ ${warn}`)));
    }

    console.log(chalk.green('✓ Prerequisites check passed\n'));

    // Step 3: Configure services
    const serviceConfig = await this.configureServices(installationType);

    // Step 4: Configure core settings
    const coreConfig = await this.configureCore();

    // Step 5: Configure geocoding
    const geocodingConfig = await this.configureGeocoding();

    // Step 6: Configure AI provider
    const aiConfig = await this.configureAI(serviceConfig.enableOllama);

    // Step 7: Configure Discord (optional)
    const discordConfig = await this.configureDiscord();

    // Step 8: Summary and confirm
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
        message: 'Proceed with installation?',
        default: true
      }
    ]);

    if (!confirm) {
      console.log(chalk.yellow('\nInstallation cancelled.'));
      process.exit(0);
    }

    // Step 9: Install
    console.log(chalk.blue('\nStarting installation...\n'));
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
      const pullResult = await this.dockerInstaller.pullTrunkRecorderImage();
      if (!pullResult.success) {
        console.log(chalk.yellow(`\n⚠ Warning: Could not pull TrunkRecorder image: ${pullResult.error}`));
        console.log(chalk.yellow('   Docker Compose will attempt to pull it automatically when starting services.'));
        console.log(chalk.yellow('   You can also pull it manually with: docker pull robotastic/trunk-recorder:latest'));
      } else if (!pullResult.skipped) {
        console.log(chalk.green('✓ TrunkRecorder image pulled successfully'));
      }
    }

    // Step 10: Show success and next steps
    console.log(chalk.green('\n✓ Installation completed successfully!\n'));
    console.log(chalk.blue('Next steps:'));
    result.nextSteps.forEach((step, index) => {
      console.log(chalk.white(`   ${step}`));
    });

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
        console.log(chalk.blue('\nStarting Docker services...'));
        const startResult = await this.dockerInstaller.startServices();
        if (startResult.success) {
          if (startResult.warning) {
            // If there's a warning, it means services were already running or had conflicts
            console.log(chalk.yellow(`⚠ ${startResult.warning}`));
            console.log(chalk.blue('\nAccess the web interface at: http://localhost:3001'));
          } else {
            // Services were actually started
            console.log(chalk.green('✓ Services started successfully!'));
            console.log(chalk.blue('\nAccess the web interface at: http://localhost:3001'));
          }
        } else {
          console.log(chalk.yellow(`⚠ Could not start services: ${startResult.error}`));
          console.log(chalk.yellow('   You can start them manually with: docker-compose up -d'));
          console.log(chalk.yellow('   Or start individual services: docker-compose up -d scanner-map'));
        }
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

    console.log(chalk.green('\n✨ Installation complete! Happy scanning!\n'));
  }

  /**
   * Configure optional services
   */
  async configureServices(installationType) {
    const questions = [
      {
        type: 'confirm',
        name: 'enableOllama',
        message: 'Enable Ollama (Local AI service)?',
        default: false
      },
      {
        type: 'confirm',
        name: 'enableICAD',
        message: 'Enable iCAD Transcribe (Advanced transcription)?',
        default: false
      },
      {
        type: 'confirm',
        name: 'enableTrunkRecorder',
        message: 'Enable TrunkRecorder (Radio recording)?',
        default: false
      }
    ];

    return await inquirer.prompt(questions);
  }

  /**
   * Configure core settings
   */
  async configureCore() {
    return await inquirer.prompt([
      {
        type: 'input',
        name: 'webserverPort',
        message: 'Web server port:',
        default: 3001,
        validate: (input) => {
          const port = parseInt(input);
          return port > 0 && port < 65536 ? true : 'Please enter a valid port number (1-65535)';
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
          return port > 0 && port < 65536 ? true : 'Please enter a valid port number (1-65535)';
        },
        filter: (input) => parseInt(input)
      },
      {
        type: 'input',
        name: 'publicDomain',
        message: 'Public domain (for Discord embeds):',
        default: 'localhost'
      },
      {
        type: 'input',
        name: 'timezone',
        message: 'Timezone:',
        default: 'America/New_York'
      }
    ]);
  }

  /**
   * Configure geocoding service
   */
  async configureGeocoding() {
    const { provider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Choose geocoding provider:',
        choices: [
          { name: 'Nominatim (OpenStreetMap) - FREE, no API key', value: 'nominatim' },
          { name: 'LocationIQ - FREE tier available', value: 'locationiq' },
          { name: 'Google Maps - Paid service', value: 'google' }
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
          message: 'LocationIQ API key (optional, press Enter to skip):',
          default: ''
        }
      ]);
      config.locationiqApiKey = apiKey;
    } else if (provider === 'google') {
      const { apiKey } = await inquirer.prompt([
        {
          type: 'input',
          name: 'apiKey',
          message: 'Google Maps API key (optional, press Enter to skip):',
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
  async configureAI(ollamaEnabled) {
    const defaultProvider = ollamaEnabled ? 'ollama' : 'openai';
    
    const { provider } = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Choose AI provider:',
        choices: [
          { name: 'OpenAI (ChatGPT)', value: 'openai' },
          { name: 'Ollama (Local AI)', value: 'ollama' }
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
          message: 'OpenAI API key (optional, press Enter to skip):',
          default: ''
        },
        {
          type: 'input',
          name: 'model',
          message: 'OpenAI model:',
          default: 'gpt-4o-mini'
        }
      ]);
      config.openaiApiKey = answers.apiKey;
      config.openaiModel = answers.model;
    } else {
      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'url',
          message: 'Ollama URL:',
          default: 'http://localhost:11434'
        },
        {
          type: 'input',
          name: 'model',
          message: 'Ollama model:',
          default: 'llama3.1:8b'
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
        type: 'input',
        name: 'token',
        message: 'Discord bot token:',
        validate: (input) => input.length > 0 || 'Discord token is required'
      },
      {
        type: 'input',
        name: 'clientId',
        message: 'Discord Client ID (optional):',
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
    console.log(chalk.blue('\n════════════════════════════════════════'));
    console.log(chalk.blue('  Installation Summary'));
    console.log(chalk.blue('════════════════════════════════════════\n'));

    console.log(chalk.white(`Installation Type: ${chalk.cyan(config.installationType)}`));
    console.log(chalk.white(`Web Server Port: ${chalk.cyan(config.webserverPort)}`));
    console.log(chalk.white(`API Port: ${chalk.cyan(config.botPort)}`));
    console.log(chalk.white(`Timezone: ${chalk.cyan(config.timezone)}`));
    console.log(chalk.white(`Geocoding: ${chalk.cyan(config.geocodingProvider)}`));
    console.log(chalk.white(`AI Provider: ${chalk.cyan(config.aiProvider)}`));
    console.log(chalk.white(`Discord Bot: ${chalk.cyan(config.enableDiscord ? 'Enabled' : 'Disabled')}`));
    console.log(chalk.white(`Ollama: ${chalk.cyan(config.enableOllama ? 'Enabled' : 'Disabled')}`));
    console.log(chalk.white(`iCAD Transcribe: ${chalk.cyan(config.enableICAD ? 'Enabled' : 'Disabled')}`));
    console.log(chalk.white(`TrunkRecorder: ${chalk.cyan(config.enableTrunkRecorder ? 'Enabled' : 'Disabled')}`));
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
