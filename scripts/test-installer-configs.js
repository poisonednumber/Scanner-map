/**
 * Comprehensive Installer Configuration Test
 * Tests all possible configuration combinations to ensure everything works correctly
 */

const path = require('path');
const fs = require('fs-extra');
const chalk = require('chalk');

// Import installer modules
const EnvGenerator = require('./installer/env-generator');
const DockerComposeBuilder = require('./installer/docker-compose-builder');
const ServiceConfig = require('./installer/service-config');

// Test configurations to validate
const TEST_CONFIGS = [
  // === DOCKER CONFIGURATIONS ===
  
  // 1. Docker - Quick Setup - Local Whisper - Ollama - TrunkRecorder
  {
    name: 'Docker Quick: Local Whisper + Ollama + TrunkRecorder',
    installationType: 'docker',
    transcriptionMode: 'local',
    transcriptionDevice: 'cpu',
    whisperModel: 'small',
    aiProvider: 'ollama',
    enableOllama: true,
    ollamaUrl: 'http://ollama:11434',
    ollamaModel: 'llama3.1:8b',
    enableICAD: false,
    radioSoftware: 'trunk-recorder',
    enableTrunkRecorder: true,
    enableDiscord: false,
    enableGPU: false
  },
  
  // 2. Docker - Quick Setup - iCAD - Ollama Remote - SDRTrunk
  {
    name: 'Docker Quick: iCAD + Remote Ollama + SDRTrunk',
    installationType: 'docker',
    transcriptionMode: 'icad',
    enableICAD: true,
    icadUrl: 'http://icad-transcribe:9912',
    aiProvider: 'ollama',
    enableOllama: false,
    ollamaUrl: 'http://remote-ollama:11434',
    ollamaModel: 'llama3.1:8b',
    radioSoftware: 'sdrtrunk',
    enableSDRTrunk: true,
    enableDiscord: true,
    enableGPU: false
  },
  
  // 3. Docker - Quick Setup - OpenAI Transcription - OpenAI AI - rdio-scanner
  {
    name: 'Docker Quick: OpenAI Transcription + OpenAI AI + rdio-scanner',
    installationType: 'docker',
    transcriptionMode: 'openai',
    aiProvider: 'openai',
    openaiApiKey: 'test-key',
    openaiModel: 'gpt-4o-mini',
    enableOllama: false,
    enableICAD: false,
    radioSoftware: 'rdio-scanner',
    enableRdioScanner: true,
    enableDiscord: false,
    enableGPU: true
  },
  
  // 4. Docker - Quick Setup - Remote Transcription - None AI - OP25
  {
    name: 'Docker Quick: Remote Transcription + No AI + OP25',
    installationType: 'docker',
    transcriptionMode: 'remote',
    fasterWhisperServerUrl: 'http://remote-whisper:8000',
    aiProvider: 'none',
    enableOllama: false,
    enableICAD: false,
    radioSoftware: 'op25',
    enableOP25: true,
    enableDiscord: false,
    enableGPU: false
  },
  
  // 5. Docker - Quick Setup - iCAD Remote - Ollama - None Radio
  {
    name: 'Docker Quick: Remote iCAD + Ollama + No Radio',
    installationType: 'docker',
    transcriptionMode: 'icad',
    enableICAD: false,
    icadUrl: 'http://remote-icad:9912',
    aiProvider: 'ollama',
    enableOllama: true,
    ollamaUrl: 'http://ollama:11434',
    radioSoftware: 'none',
    enableDiscord: false,
    enableGPU: false
  },
  
  // === LOCAL CONFIGURATIONS ===
  
  // 6. Local - Quick Setup - Local Whisper - OpenAI - TrunkRecorder
  {
    name: 'Local Quick: Local Whisper + OpenAI + TrunkRecorder',
    installationType: 'local',
    transcriptionMode: 'local',
    transcriptionDevice: 'cpu',
    whisperModel: 'small',
    aiProvider: 'openai',
    openaiApiKey: 'test-key',
    enableOllama: false,
    enableICAD: false,
    radioSoftware: 'trunk-recorder',
    enableTrunkRecorder: true,
    enableDiscord: true,
    enableGPU: false
  },
  
  // 7. Local - Quick Setup - Remote Transcription - Ollama Remote - None Radio
  {
    name: 'Local Quick: Remote Transcription + Remote Ollama + No Radio',
    installationType: 'local',
    transcriptionMode: 'remote',
    fasterWhisperServerUrl: 'http://localhost:8000',
    aiProvider: 'ollama',
    enableOllama: false,
    ollamaUrl: 'http://remote-ollama:11434',
    enableICAD: false,
    radioSoftware: 'none',
    enableDiscord: false,
    enableGPU: false
  },
  
  // 8. Local - Quick Setup - OpenAI Transcription - None AI - SDRTrunk
  {
    name: 'Local Quick: OpenAI Transcription + No AI + SDRTrunk',
    installationType: 'local',
    transcriptionMode: 'openai',
    aiProvider: 'none',
    enableOllama: false,
    enableICAD: false,
    radioSoftware: 'sdrtrunk',
    enableSDRTrunk: true,
    enableDiscord: false,
    enableGPU: false
  },
  
  // === ADVANCED CONFIGURATIONS ===
  
  // 9. Docker - Advanced - All Services - GPU - S3 Storage
  {
    name: 'Docker Advanced: All Services + GPU + S3',
    installationType: 'docker',
    transcriptionMode: 'icad',
    enableICAD: true,
    icadUrl: 'http://icad-transcribe:9912',
    aiProvider: 'ollama',
    enableOllama: true,
    ollamaUrl: 'http://ollama:11434',
    radioSoftware: 'trunk-recorder',
    enableTrunkRecorder: true,
    enableDiscord: true,
    enableGPU: true,
    storageMode: 's3',
    s3Endpoint: 'http://minio:9000',
    s3BucketName: 'scanner-map',
    s3AccessKeyId: 'test-key',
    s3SecretAccessKey: 'test-secret',
    geocodingProvider: 'locationiq',
    locationiqApiKey: 'test-locationiq-key',
    enableAuth: true,
    webserverPassword: 'test-password'
  },
  
  // 10. Local - Advanced - Custom Ports - Google Maps - Auth
  {
    name: 'Local Advanced: Custom Ports + Google Maps + Auth',
    installationType: 'local',
    transcriptionMode: 'local',
    transcriptionDevice: 'cuda',
    whisperModel: 'large-v3',
    aiProvider: 'openai',
    openaiApiKey: 'test-key',
    enableOllama: false,
    enableICAD: false,
    radioSoftware: 'rdio-scanner',
    enableRdioScanner: true,
    enableDiscord: true,
    webserverPort: 8080,
    botPort: 9090,
    geocodingProvider: 'google',
    googleMapsApiKey: 'test-google-key',
    enableAuth: true,
    webserverPassword: 'test-password',
    enableGPU: false
  }
];

// Common config values for all tests
const COMMON_CONFIG = {
  webserverPort: 3001,
  botPort: 3306,
  publicDomain: 'localhost',
  timezone: 'America/New_York',
  geocodingState: 'MD',
  geocodingCountry: 'us',
  geocodingCity: 'Baltimore',
  geocodingTargetCounties: 'Baltimore,Baltimore City',
  geocodingProvider: 'nominatim',
  icadProfile: 'default',
  icadApiKey: 'test-icad-key',
  trunkRecorderApiKey: 'test-radio-key',
  enableMappedTalkGroups: true,
  mappedTalkGroups: '',
  enableTwoToneMode: false,
  twoToneTalkGroups: '',
  openaiTranscriptionPrompt: '',
  openaiTranscriptionModel: 'whisper-1',
  openaiTranscriptionTemperature: 0,
  storageMode: 'local',
  sessionDurationDays: 7,
  maxSessionsPerUser: 5,
  openWebUI: false,
  enableAutoStart: false,
  enableAutoUpdate: false
};

class ConfigTester {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.testDir = path.join(projectRoot, 'test-installer-output');
    this.envGenerator = new EnvGenerator(projectRoot);
    this.dockerComposeBuilder = new DockerComposeBuilder(projectRoot);
    this.serviceConfig = new ServiceConfig(projectRoot);
    this.results = [];
  }

  async runTests() {
    console.log(chalk.blue.bold('\n' + '═'.repeat(60)));
    console.log(chalk.blue.bold('  Installer Configuration Test Suite'));
    console.log(chalk.blue.bold('═'.repeat(60) + '\n'));

    // Clean test directory
    await fs.ensureDir(this.testDir);
    await fs.emptyDir(this.testDir);

    let passed = 0;
    let failed = 0;

    for (let i = 0; i < TEST_CONFIGS.length; i++) {
      const testConfig = TEST_CONFIGS[i];
      console.log(chalk.cyan(`\n[${i + 1}/${TEST_CONFIGS.length}] Testing: ${testConfig.name}`));
      
      try {
        const result = await this.testConfiguration(testConfig, i + 1);
        if (result.success) {
          console.log(chalk.green('  ✓ PASSED'));
          passed++;
        } else {
          console.log(chalk.red(`  ✗ FAILED: ${result.error}`));
          failed++;
        }
        this.results.push(result);
      } catch (err) {
        console.log(chalk.red(`  ✗ ERROR: ${err.message}`));
        failed++;
        this.results.push({
          name: testConfig.name,
          success: false,
          error: err.message,
          stack: err.stack
        });
      }
    }

    // Print summary
    console.log(chalk.blue.bold('\n' + '═'.repeat(60)));
    console.log(chalk.blue.bold('  Test Summary'));
    console.log(chalk.blue.bold('═'.repeat(60)));
    console.log(chalk.green(`\n  Passed: ${passed}`));
    console.log(chalk.red(`  Failed: ${failed}`));
    console.log(chalk.white(`  Total:  ${TEST_CONFIGS.length}\n`));

    // Print detailed results
    if (failed > 0) {
      console.log(chalk.yellow('\nFailed Tests:'));
      this.results.forEach((result, idx) => {
        if (!result.success) {
          console.log(chalk.red(`  ${idx + 1}. ${result.name}`));
          console.log(chalk.gray(`     Error: ${result.error}`));
        }
      });
    }

    // Save results to file
    const resultsFile = path.join(this.testDir, 'test-results.json');
    await fs.writeJson(resultsFile, {
      timestamp: new Date().toISOString(),
      total: TEST_CONFIGS.length,
      passed,
      failed,
      results: this.results
    }, { spaces: 2 });

    console.log(chalk.gray(`\n  Detailed results saved to: ${path.relative(this.projectRoot, resultsFile)}`));

    return { passed, failed, total: TEST_CONFIGS.length };
  }

  async testConfiguration(testConfig, testNumber) {
    const testDir = path.join(this.testDir, `test-${testNumber}`);
    await fs.ensureDir(testDir);

    const fullConfig = { ...COMMON_CONFIG, ...testConfig };
    const errors = [];

    try {
      // Test 1: Environment file generation
      try {
        const envContent = await this.testEnvGeneration(fullConfig, testDir);
        if (!envContent) {
          errors.push('Failed to generate .env file');
        } else {
          // Validate critical env vars
          const envErrors = this.validateEnvFile(envContent, fullConfig);
          errors.push(...envErrors);
        }
      } catch (err) {
        errors.push(`Env generation error: ${err.message}`);
      }

      // Test 2: Docker Compose generation (Docker only)
      if (fullConfig.installationType === 'docker') {
        try {
          const composeContent = await this.testDockerComposeGeneration(fullConfig, testDir);
          if (!composeContent) {
            errors.push('Failed to generate docker-compose.yml');
          } else {
            const composeErrors = this.validateDockerCompose(composeContent, fullConfig);
            errors.push(...composeErrors);
          }
        } catch (err) {
          errors.push(`Docker Compose generation error: ${err.message}`);
        }
      }

      // Test 3: Service configuration files
      try {
        const serviceErrors = await this.testServiceConfigs(fullConfig, testDir);
        errors.push(...serviceErrors);
      } catch (err) {
        errors.push(`Service config error: ${err.message}`);
      }

      // Test 4: Configuration consistency
      const consistencyErrors = this.validateConfigConsistency(fullConfig);
      errors.push(...consistencyErrors);

      return {
        name: testConfig.name,
        success: errors.length === 0,
        error: errors.length > 0 ? errors.join('; ') : null,
        errors: errors.length > 0 ? errors : []
      };
    } catch (err) {
      return {
        name: testConfig.name,
        success: false,
        error: `Unexpected error: ${err.message}`,
        stack: err.stack
      };
    }
  }

  async testEnvGeneration(config, testDir) {
    // Create a new EnvGenerator with test directory as project root
    const testEnvGenerator = new EnvGenerator(testDir);
    
    try {
      await testEnvGenerator.generate(config);
      const envPath = path.join(testDir, '.env');
      if (await fs.pathExists(envPath)) {
        // Read the file after generation (RADIO_SOFTWARE is appended)
        const content = await fs.readFile(envPath, 'utf8');
        return content;
      }
      return null;
    } catch (err) {
      throw new Error(`Env generation failed: ${err.message}`);
    }
  }

  async testDockerComposeGeneration(config, testDir) {
    // Create a new DockerComposeBuilder with test directory as project root
    const testComposeBuilder = new DockerComposeBuilder(testDir);
    
    try {
      await testComposeBuilder.build({
        enableOllama: config.enableOllama || false,
        enableICAD: config.enableICAD || false,
        enableTrunkRecorder: config.enableTrunkRecorder || false,
        enableSDRTrunk: config.enableSDRTrunk || false,
        enableRdioScanner: config.enableRdioScanner || false,
        enableOP25: config.enableOP25 || false,
        enableGPU: config.enableGPU || false,
        transcriptionMode: config.transcriptionMode || 'local',
        timezone: config.timezone || 'America/New_York',
        ollamaUrl: config.ollamaUrl,
        icadUrl: config.icadUrl,
        radioSoftware: config.radioSoftware || 'none'
      });

      const composePath = path.join(testDir, 'docker-compose.yml');
      if (await fs.pathExists(composePath)) {
        return await fs.readFile(composePath, 'utf8');
      }
      return null;
    } catch (err) {
      throw new Error(`Docker Compose generation failed: ${err.message}`);
    }
  }

  async testServiceConfigs(config, testDir) {
    const errors = [];
    // Create a new ServiceConfig with test directory as project root
    const testServiceConfig = new ServiceConfig(testDir);

    try {
      // Test TrunkRecorder config
      if (config.enableTrunkRecorder || config.radioSoftware === 'trunk-recorder') {
        const result = await testServiceConfig.configureTrunkRecorder(
          true,
          config.installationType,
          config.trunkRecorderApiKey
        );
        if (!result || !result.apiKey) {
          errors.push('TrunkRecorder config generation failed');
        }
      }

      // Test SDRTrunk config
      if (config.enableSDRTrunk || config.radioSoftware === 'sdrtrunk') {
        const result = await testServiceConfig.configureSDRTrunk(
          true,
          config.installationType,
          config.trunkRecorderApiKey
        );
        if (!result || !result.apiKey) {
          errors.push('SDRTrunk config generation failed');
        }
      }

      // Test rdio-scanner config
      if (config.enableRdioScanner || config.radioSoftware === 'rdio-scanner') {
        const result = await testServiceConfig.configureRdioScanner(
          true,
          config.installationType,
          config.trunkRecorderApiKey
        );
        if (!result || !result.apiKey) {
          errors.push('rdio-scanner config generation failed');
        }
      }

      // Test OP25 config
      if (config.enableOP25 || config.radioSoftware === 'op25') {
        const result = await testServiceConfig.configureOP25(
          true,
          config.installationType,
          config.trunkRecorderApiKey
        );
        if (!result || !result.apiKey) {
          errors.push('OP25 config generation failed');
        }
      }

      // Test iCAD config
      if (config.enableICAD) {
        const result = await testServiceConfig.configureICAD(
          true,
          config.installationType,
          config.icadApiKey
        );
        if (!result || !result.apiKey) {
          errors.push('iCAD config generation failed');
        }
      }

      // Test Ollama config
      if (config.enableOllama) {
        const result = await testServiceConfig.configureOllama(
          true,
          config.installationType
        );
        if (!result) {
          errors.push('Ollama config generation failed');
        }
      }
    } catch (err) {
      errors.push(`Service config error: ${err.message}`);
    }

    return errors;
  }

  validateEnvFile(envContent, config) {
    const errors = [];

    // Check transcription mode
    if (!envContent.includes(`TRANSCRIPTION_MODE=${config.transcriptionMode}`)) {
      errors.push('TRANSCRIPTION_MODE not set correctly');
    }

    // Check AI provider
    if (!envContent.includes(`AI_PROVIDER=${config.aiProvider}`)) {
      errors.push('AI_PROVIDER not set correctly');
    }

    // Check radio software
    if (config.radioSoftware && config.radioSoftware !== 'none') {
      if (!envContent.includes(`RADIO_SOFTWARE=${config.radioSoftware}`)) {
        errors.push('RADIO_SOFTWARE not set correctly');
      }
    }

    // Check Ollama URL
    if (config.enableOllama || config.aiProvider === 'ollama') {
      if (config.ollamaUrl && !envContent.includes(`OLLAMA_URL=${config.ollamaUrl}`)) {
        errors.push('OLLAMA_URL not set correctly');
      }
    }

    // Check iCAD URL
    if (config.enableICAD || config.transcriptionMode === 'icad') {
      if (config.icadUrl && !envContent.includes(`ICAD_URL=${config.icadUrl}`)) {
        errors.push('ICAD_URL not set correctly');
      }
    }

    return errors;
  }

  validateDockerCompose(composeContent, config) {
    const errors = [];

    // Check if scanner-map service exists
    if (!composeContent.includes('scanner-map:')) {
      errors.push('scanner-map service missing from docker-compose.yml');
    }

    // Check Ollama service
    if (config.enableOllama && !config.ollamaUrl?.includes('remote')) {
      if (!composeContent.includes('ollama:')) {
        errors.push('Ollama service missing when enabled');
      }
    } else if (config.enableOllama && config.ollamaUrl?.includes('remote')) {
      if (composeContent.includes('ollama:')) {
        errors.push('Ollama service present when remote URL configured');
      }
    }

    // Check iCAD service
    if (config.enableICAD && !config.icadUrl?.includes('remote')) {
      if (!composeContent.includes('icad-transcribe:')) {
        errors.push('iCAD service missing when enabled');
      }
    } else if (config.enableICAD && config.icadUrl?.includes('remote')) {
      if (composeContent.includes('icad-transcribe:')) {
        errors.push('iCAD service present when remote URL configured');
      }
    }

    // Check radio software services
    if (config.enableTrunkRecorder || config.radioSoftware === 'trunk-recorder') {
      if (!composeContent.includes('trunk-recorder:')) {
        errors.push('TrunkRecorder service missing when enabled');
      }
    }

    if (config.enableRdioScanner || config.radioSoftware === 'rdio-scanner') {
      if (!composeContent.includes('rdio-scanner:')) {
        errors.push('rdio-scanner service missing when enabled');
      }
    }

    if (config.enableOP25 || config.radioSoftware === 'op25') {
      if (!composeContent.includes('op25:')) {
        errors.push('OP25 service missing when enabled');
      }
    }

    return errors;
  }

  validateConfigConsistency(config) {
    const errors = [];

    // Check transcription mode consistency
    if (config.transcriptionMode === 'icad' && !config.enableICAD && !config.icadUrl?.includes('remote')) {
      errors.push('Transcription mode is icad but iCAD not enabled and no remote URL');
    }

    // Check AI provider consistency
    if (config.aiProvider === 'ollama' && !config.enableOllama && !config.ollamaUrl?.includes('remote')) {
      errors.push('AI provider is ollama but Ollama not enabled and no remote URL');
    }

    // Check radio software consistency
    if (config.radioSoftware === 'trunk-recorder' && !config.enableTrunkRecorder) {
      errors.push('Radio software is trunk-recorder but enableTrunkRecorder is false');
    }

    if (config.radioSoftware === 'sdrtrunk' && !config.enableSDRTrunk) {
      errors.push('Radio software is sdrtrunk but enableSDRTrunk is false');
    }

    if (config.radioSoftware === 'rdio-scanner' && !config.enableRdioScanner) {
      errors.push('Radio software is rdio-scanner but enableRdioScanner is false');
    }

    if (config.radioSoftware === 'op25' && !config.enableOP25) {
      errors.push('Radio software is op25 but enableOP25 is false');
    }

    return errors;
  }
}

// Run tests if called directly
if (require.main === module) {
  const projectRoot = process.cwd();
  const tester = new ConfigTester(projectRoot);
  
  tester.runTests().then(({ passed, failed }) => {
    process.exit(failed > 0 ? 1 : 0);
  }).catch(err => {
    console.error(chalk.red('\nFatal test error:'), err);
    process.exit(1);
  });
}

module.exports = ConfigTester;

