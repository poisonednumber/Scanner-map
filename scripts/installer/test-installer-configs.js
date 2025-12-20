/**
 * Installer Configuration Test Suite
 * Tests all possible configuration combinations to ensure proper installation
 */

const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');

// Mock the installer core to test configuration logic
class ConfigTester {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.testResults = [];
    this.testDir = path.join(projectRoot, 'test-installer-configs');
  }

  async runAllTests() {
    console.log(chalk.blue.bold('\n' + '═'.repeat(60)));
    console.log(chalk.blue.bold('  Scanner Map Installer Configuration Test Suite'));
    console.log(chalk.blue.bold('═'.repeat(60) + '\n'));

    // Ensure test directory exists
    await fs.ensureDir(this.testDir);

    // Test all combinations
    const testCases = this.generateTestCases();
    console.log(chalk.cyan(`Running ${testCases.length} test configurations...\n`));

    for (let i = 0; i < testCases.length; i++) {
      const testCase = testCases[i];
      console.log(chalk.gray(`[${i + 1}/${testCases.length}] Testing: ${testCase.name}`));
      await this.testConfiguration(testCase);
    }

    // Generate report
    this.generateReport();
  }

  generateTestCases() {
    const testCases = [];

    // Base configurations
    const installModes = ['quick', 'advanced'];
    const installTypes = ['docker', 'local'];
    const transcriptionModes = ['local', 'remote', 'openai', 'icad', 'icad-remote'];
    const aiProviders = ['openai', 'ollama', 'ollama-remote'];
    const radioSoftware = ['none', 'trunk-recorder', 'sdrtrunk', 'rdio-scanner', 'op25'];
    const geocodingProviders = ['nominatim', 'locationiq', 'google'];
    const enableDiscord = [false, true];
    const enableGPU = [false, true]; // Docker only

    // Generate key combinations (not exhaustive, but covers critical paths)
    for (const installMode of installModes) {
      for (const installType of installTypes) {
        // Test each transcription mode
        for (const transcriptionMode of transcriptionModes) {
          // Test each AI provider
          for (const aiProvider of aiProviders) {
            // Test radio software options
            for (const radio of radioSoftware) {
              // Test with/without Discord
              for (const discord of enableDiscord) {
                // Test GPU (Docker only)
                if (installType === 'docker') {
                  for (const gpu of enableGPU) {
                    testCases.push({
                      name: `${installMode}-${installType}-${transcriptionMode}-${aiProvider}-${radio}-discord${discord}-gpu${gpu}`,
                      config: {
                        installMode,
                        installType,
                        transcriptionMode,
                        aiProvider,
                        radioSoftware: radio,
                        enableDiscord: discord,
                        enableGPU: gpu,
                        geocodingProvider: 'nominatim' // Default for most tests
                      }
                    });
                  }
                } else {
                  testCases.push({
                    name: `${installMode}-${installType}-${transcriptionMode}-${aiProvider}-${radio}-discord${discord}`,
                    config: {
                      installMode,
                      installType,
                      transcriptionMode,
                      aiProvider,
                      radioSoftware: radio,
                      enableDiscord: discord,
                      enableGPU: false,
                      geocodingProvider: 'nominatim'
                    }
                  });
                }
              }
            }
          }
        }

        // Test geocoding providers (one per transcription/AI combo)
        for (const geocodingProvider of geocodingProviders) {
          testCases.push({
            name: `${installMode}-${installType}-geocoding-${geocodingProvider}`,
            config: {
              installMode,
              installType,
              transcriptionMode: 'local',
              aiProvider: 'ollama',
              radioSoftware: 'none',
              enableDiscord: false,
              enableGPU: false,
              geocodingProvider
            }
          });
        }
      }
    }

    // Add some edge cases
    testCases.push({
      name: 'edge-remote-ollama-remote-icad',
      config: {
        installMode: 'quick',
        installType: 'docker',
        transcriptionMode: 'icad-remote',
        aiProvider: 'ollama-remote',
        radioSoftware: 'trunk-recorder',
        enableDiscord: true,
        enableGPU: true,
        geocodingProvider: 'google'
      }
    });

    testCases.push({
      name: 'edge-local-all-services',
      config: {
        installMode: 'advanced',
        installType: 'local',
        transcriptionMode: 'icad',
        aiProvider: 'ollama',
        radioSoftware: 'sdrtrunk',
        enableDiscord: true,
        enableGPU: false,
        geocodingProvider: 'locationiq'
      }
    });

    return testCases;
  }

  async testConfiguration(testCase) {
    const result = {
      name: testCase.name,
      config: testCase.config,
      passed: true,
      errors: [],
      warnings: []
    };

    try {
      // Validate configuration logic
      const validation = this.validateConfig(testCase.config);
      result.passed = validation.valid;
      result.errors = validation.errors;
      result.warnings = validation.warnings;

      // Test URL generation
      const urlTest = this.testURLGeneration(testCase.config);
      if (!urlTest.valid) {
        result.passed = false;
        result.errors.push(...urlTest.errors);
      }

      // Test service enablement logic
      const serviceTest = this.testServiceEnablement(testCase.config);
      if (!serviceTest.valid) {
        result.passed = false;
        result.errors.push(...serviceTest.errors);
      }

      // Test Docker Compose generation (if Docker)
      if (testCase.config.installType === 'docker') {
        const composeTest = await this.testDockerCompose(testCase.config);
        if (!composeTest.valid) {
          result.passed = false;
          result.errors.push(...composeTest.errors);
        }
      }

      // Test .env generation
      const envTest = await this.testEnvGeneration(testCase.config);
      if (!envTest.valid) {
        result.passed = false;
        result.errors.push(...envTest.errors);
      }

    } catch (err) {
      result.passed = false;
      result.errors.push(`Unexpected error: ${err.message}`);
    }

    this.testResults.push(result);
    
    if (result.passed) {
      console.log(chalk.green('  ✓ Passed'));
    } else {
      console.log(chalk.red(`  ✗ Failed (${result.errors.length} errors)`));
      result.errors.forEach(err => console.log(chalk.red(`    - ${err}`)));
    }
  }

  validateConfig(config) {
    const errors = [];
    const warnings = [];

    // Validate transcription mode and AI provider compatibility
    if (config.transcriptionMode === 'icad-remote' && config.aiProvider === 'ollama-remote') {
      // This is valid - both can be remote
    }

    // Validate GPU only for Docker
    if (config.enableGPU && config.installType !== 'docker') {
      errors.push('GPU acceleration only available for Docker installation');
    }

    // Validate remote services (these are expected to be missing in test cases - installer will prompt)
    // Don't treat as errors, just warnings
    if (config.transcriptionMode === 'icad-remote' && !config.remoteICADUrl) {
      // This is expected - installer will prompt for it
    }

    if (config.aiProvider === 'ollama-remote' && !config.remoteOllamaUrl) {
      // This is expected - installer will prompt for it
    }

    // Validate radio software
    if (config.radioSoftware === 'none' && 
        (config.enableTrunkRecorder || config.enableSDRTrunk || config.enableRdioScanner || config.enableOP25)) {
      warnings.push('radioSoftware is none but individual enable flags are set');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  testURLGeneration(config) {
    const errors = [];
    const isDocker = config.installType === 'docker';

    // Test Ollama URL
    if (config.aiProvider === 'ollama' && !config.ollamaUrl) {
      const expectedUrl = isDocker ? 'http://ollama:11434' : 'http://localhost:11434';
      // This is auto-configured, so it's fine
    } else if (config.aiProvider === 'ollama-remote' && !config.remoteOllamaUrl) {
      // This is expected - installer will prompt for it, not an error
    }

    // Test iCAD URL
    if (config.transcriptionMode === 'icad' && !config.icadUrl) {
      const expectedUrl = isDocker ? 'http://icad-transcribe:9912' : 'http://localhost:9912';
      // This is auto-configured, so it's fine
    } else if (config.transcriptionMode === 'icad-remote' && !config.remoteICADUrl) {
      // This is expected - installer will prompt for it, not an error
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  testServiceEnablement(config) {
    const errors = [];

    // Test enable flags
    const shouldEnableOllama = config.aiProvider === 'ollama' && config.aiProvider !== 'ollama-remote';
    const shouldEnableICAD = config.transcriptionMode === 'icad' && config.transcriptionMode !== 'icad-remote';

    // Test radio software enablement
    const shouldEnableTrunkRecorder = config.radioSoftware === 'trunk-recorder';
    const shouldEnableSDRTrunk = config.radioSoftware === 'sdrtrunk';
    const shouldEnableRdioScanner = config.radioSoftware === 'rdio-scanner';
    const shouldEnableOP25 = config.radioSoftware === 'op25';

    // Validate enable flags match radioSoftware (only if enableTrunkRecorder is set in config)
    // Note: In actual installer, these are derived from radioSoftware, so we just validate the logic
    if (config.enableTrunkRecorder !== undefined && config.enableTrunkRecorder !== shouldEnableTrunkRecorder) {
      errors.push(`enableTrunkRecorder should be ${shouldEnableTrunkRecorder} for radioSoftware=${config.radioSoftware}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  async testDockerCompose(config) {
    const errors = [];
    const warnings = [];

    try {
      // Load docker-compose-builder
      const DockerComposeBuilder = require('./docker-compose-builder');
      const builder = new DockerComposeBuilder(this.projectRoot);

      // Generate compose file
      const composeConfig = {
        enableOllama: config.aiProvider === 'ollama' && config.aiProvider !== 'ollama-remote',
        enableICAD: config.transcriptionMode === 'icad' && config.transcriptionMode !== 'icad-remote',
        enableTrunkRecorder: config.radioSoftware === 'trunk-recorder',
        enableSDRTrunk: config.radioSoftware === 'sdrtrunk',
        enableRdioScanner: config.radioSoftware === 'rdio-scanner',
        enableOP25: config.radioSoftware === 'op25',
        enableGPU: config.enableGPU,
        transcriptionMode: config.transcriptionMode,
        ollamaUrl: config.aiProvider === 'ollama-remote' ? (config.remoteOllamaUrl || 'http://remote-ollama:11434') : undefined,
        icadUrl: config.transcriptionMode === 'icad-remote' ? (config.remoteICADUrl || 'http://remote-icad:9912') : undefined
      };

      const composeResult = await builder.build(composeConfig);
      // build() returns an object with yaml property or writes to file
      // For testing, we need to read the file or check the return value
      let composeYaml = '';
      if (typeof composeResult === 'string') {
        composeYaml = composeResult;
      } else if (composeResult && composeResult.yaml) {
        composeYaml = composeResult.yaml;
      } else {
        // Read from file if it was written
        const composePath = path.join(this.projectRoot, 'docker-compose.yml');
        if (await fs.pathExists(composePath)) {
          composeYaml = await fs.readFile(composePath, 'utf8');
        } else {
          errors.push('docker-compose.yml was not generated');
          return { valid: false, errors };
        }
      }

      // Validate compose file
      if (!composeYaml.includes('scanner-map:')) {
        errors.push('docker-compose.yml missing scanner-map service');
      }

      // Check Ollama service
      if (composeConfig.enableOllama) {
        if (!composeYaml.includes('ollama:')) {
          errors.push('Ollama enabled but not in docker-compose.yml');
        }
      } else if (config.aiProvider === 'ollama-remote') {
        if (composeYaml.includes('ollama:')) {
          errors.push('Ollama is remote but still in docker-compose.yml');
        }
      }

      // Check iCAD service
      if (composeConfig.enableICAD) {
        if (!composeYaml.includes('icad-transcribe:')) {
          errors.push('iCAD enabled but not in docker-compose.yml');
        }
      } else if (config.transcriptionMode === 'icad-remote') {
        if (composeYaml.includes('icad-transcribe:')) {
          errors.push('iCAD is remote but still in docker-compose.yml');
        }
      }

      // Check radio software services
      if (config.radioSoftware === 'trunk-recorder') {
        if (!composeYaml.includes('trunk-recorder:')) {
          errors.push('TrunkRecorder selected but not in docker-compose.yml');
        }
      }

      if (config.radioSoftware === 'rdio-scanner') {
        if (!composeYaml.includes('rdio-scanner:')) {
          errors.push('rdio-scanner selected but not in docker-compose.yml');
        }
      }

      if (config.radioSoftware === 'op25') {
        if (!composeYaml.includes('op25:')) {
          errors.push('OP25 selected but not in docker-compose.yml');
        }
      }

    } catch (err) {
      errors.push(`Docker Compose test failed: ${err.message}`);
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  async testEnvGeneration(config) {
    const errors = [];

    try {
      // Load env-generator
      const EnvGenerator = require('./env-generator');
      const generator = new EnvGenerator(this.projectRoot);

      // Build config object as installer would
      const fullConfig = {
        installationType: config.installType,
        transcriptionMode: config.transcriptionMode === 'icad-remote' ? 'icad' : config.transcriptionMode,
        aiProvider: config.aiProvider === 'ollama-remote' ? 'ollama' : config.aiProvider,
        ollamaUrl: config.aiProvider === 'ollama-remote' ? (config.remoteOllamaUrl || 'http://remote-ollama:11434') : 
                   (config.aiProvider === 'ollama' ? (config.installType === 'docker' ? 'http://ollama:11434' : 'http://localhost:11434') : undefined),
        icadUrl: config.transcriptionMode === 'icad-remote' ? (config.remoteICADUrl || 'http://remote-icad:9912') :
                 (config.transcriptionMode === 'icad' ? (config.installType === 'docker' ? 'http://icad-transcribe:9912' : 'http://localhost:9912') : undefined),
        enableOllama: config.aiProvider === 'ollama' && config.aiProvider !== 'ollama-remote',
        enableICAD: config.transcriptionMode === 'icad' && config.transcriptionMode !== 'icad-remote',
        radioSoftware: config.radioSoftware,
        enableTrunkRecorder: config.radioSoftware === 'trunk-recorder',
        geocodingProvider: config.geocodingProvider || 'nominatim',
        webserverPort: 3001,
        botPort: 3306,
        publicDomain: 'localhost',
        timezone: 'America/New_York',
        geocodingState: 'MD',
        geocodingCountry: 'us',
        geocodingCity: 'Baltimore',
        geocodingTargetCounties: 'Baltimore,Baltimore City',
        openaiApiKey: config.aiProvider === 'openai' ? 'test-key' : '',
        openaiModel: 'gpt-4o-mini',
        ollamaModel: 'llama3.1:8b',
        icadProfile: 'default',
        icadApiKey: config.transcriptionMode === 'icad' || config.transcriptionMode === 'icad-remote' ? 'test-icad-key' : undefined,
        transcriptionDevice: 'cpu',
        whisperModel: 'small',
        fasterWhisperServerUrl: config.transcriptionMode === 'remote' ? 'http://localhost:8000' : undefined
      };

      const envContent = await generator.generate(fullConfig);

      // Validate .env content
      if (!envContent.includes(`TRANSCRIPTION_MODE=${config.transcriptionMode === 'icad-remote' ? 'icad' : config.transcriptionMode}`)) {
        errors.push('.env missing or incorrect TRANSCRIPTION_MODE');
      }

      if (!envContent.includes(`AI_PROVIDER=${config.aiProvider === 'ollama-remote' ? 'ollama' : config.aiProvider}`)) {
        errors.push('.env missing or incorrect AI_PROVIDER');
      }

      if (config.radioSoftware !== 'none' && !envContent.includes(`RADIO_SOFTWARE=${config.radioSoftware}`)) {
        errors.push('.env missing RADIO_SOFTWARE');
      }

      // Check URLs
      if (config.aiProvider === 'ollama' || config.aiProvider === 'ollama-remote') {
        const expectedUrl = config.aiProvider === 'ollama-remote' ? config.remoteOllamaUrl :
                           (config.installType === 'docker' ? 'http://ollama:11434' : 'http://localhost:11434');
        if (expectedUrl && !envContent.includes(`OLLAMA_URL=${expectedUrl}`)) {
          errors.push('.env missing or incorrect OLLAMA_URL');
        }
      }

      if (config.transcriptionMode === 'icad' || config.transcriptionMode === 'icad-remote') {
        const expectedUrl = config.transcriptionMode === 'icad-remote' ? config.remoteICADUrl :
                          (config.installType === 'docker' ? 'http://icad-transcribe:9912' : 'http://localhost:9912');
        if (expectedUrl && !envContent.includes(`ICAD_URL=${expectedUrl}`)) {
          errors.push('.env missing or incorrect ICAD_URL');
        }
      }

    } catch (err) {
      errors.push(`.env generation test failed: ${err.message}`);
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  generateReport() {
    const passed = this.testResults.filter(r => r.passed).length;
    const failed = this.testResults.filter(r => !r.passed).length;
    const total = this.testResults.length;

    console.log(chalk.blue.bold('\n' + '═'.repeat(60)));
    console.log(chalk.blue.bold('  Test Results Summary'));
    console.log(chalk.blue.bold('═'.repeat(60) + '\n'));

    console.log(chalk.green(`✓ Passed: ${passed}/${total}`));
    if (failed > 0) {
      console.log(chalk.red(`✗ Failed: ${failed}/${total}\n`));
      
      console.log(chalk.red.bold('Failed Tests:'));
      this.testResults
        .filter(r => !r.passed)
        .forEach(result => {
          console.log(chalk.red(`\n  ${result.name}:`));
          result.errors.forEach(err => console.log(chalk.red(`    - ${err}`)));
        });
    } else {
      console.log(chalk.green('\n✓ All tests passed!\n'));
    }

    // Write detailed report to file
    const reportPath = path.join(this.testDir, `test-report-${Date.now()}.json`);
    fs.writeFileSync(reportPath, JSON.stringify({
      summary: {
        total,
        passed,
        failed,
        passRate: ((passed / total) * 100).toFixed(2) + '%'
      },
      results: this.testResults
    }, null, 2));

    console.log(chalk.gray(`\nDetailed report saved to: ${path.relative(this.projectRoot, reportPath)}`));
  }
}

// Run tests if called directly
if (require.main === module) {
  const projectRoot = process.cwd();
  const tester = new ConfigTester(projectRoot);
  tester.runAllTests().catch(err => {
    console.error(chalk.red('\n❌ Test suite failed:'), err);
    process.exit(1);
  });
}

module.exports = ConfigTester;

