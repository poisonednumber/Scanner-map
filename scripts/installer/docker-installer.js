/**
 * Docker-specific installation logic
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');
const DockerComposeBuilder = require('./docker-compose-builder');
const ServiceConfig = require('./service-config');
const EnvGenerator = require('./env-generator');

// Debug logging helper
function debugLog(location, message, data, hypothesisId) {
  try {
    const logDir = path.join(__dirname, '../../.cursor');
    const logPath = path.join(logDir, 'debug.log');
    
    // Ensure directory exists
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const logEntry = {
      location,
      message,
      data,
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'run1',
      hypothesisId
    };
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
  } catch (err) {
    // Log to console as fallback
    console.error(`[DEBUG LOG ERROR] ${err.message}`);
  }
}

class DockerInstaller {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.composeBuilder = new DockerComposeBuilder(projectRoot);
    this.serviceConfig = new ServiceConfig(projectRoot);
    this.envGenerator = new EnvGenerator(projectRoot);
  }

  /**
   * Check Docker prerequisites
   */
  async checkPrerequisites() {
    const errors = [];

    try {
      execSync('docker --version', { stdio: 'ignore' });
    } catch (err) {
      errors.push('Docker is not installed or not in PATH');
    }

    try {
      execSync('docker compose version', { stdio: 'ignore' });
    } catch (err) {
      try {
        execSync('docker-compose --version', { stdio: 'ignore' });
      } catch (err2) {
        errors.push('Docker Compose is not installed or not in PATH');
      }
    }

    // Check if Docker daemon is running
    try {
      execSync('docker ps', { stdio: 'ignore' });
    } catch (err) {
      errors.push('Docker daemon is not running. Please start Docker Desktop or Docker service.');
    }

    return {
      success: errors.length === 0,
      errors
    };
  }

  /**
   * Install Docker services
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
      enableGPU = false,
      transcriptionMode = 'local',
      timezone = 'America/New_York',
      ...envConfig
    } = config;

    // Create appdata structure (ensures all directories exist before Docker mounts)
    await this.serviceConfig.createAppdataStructure();

    // Generate API keys for services that need them
    const { v4: uuidv4 } = require('uuid');
    const icadApiKey = enableICAD ? uuidv4() : null;
    
    // Generate a single API key for radio software (shared across all)
    const radioApiKey = (enableTrunkRecorder || enableRdioScanner || enableOP25 || enableSDRTrunk || radioSoftware !== 'none') 
      ? uuidv4() 
      : null;

    // Configure services with generated API keys
    // This also ensures service-specific directories are created
    const serviceResults = {
      trunkRecorder: (enableTrunkRecorder || radioSoftware === 'trunk-recorder')
        ? await this.serviceConfig.configureTrunkRecorder(true, 'docker', radioApiKey)
        : null,
      sdrtrunk: (enableSDRTrunk || radioSoftware === 'sdrtrunk')
        ? await this.serviceConfig.configureSDRTrunk(true, 'docker', radioApiKey)
        : null,
      rdioScanner: (enableRdioScanner || radioSoftware === 'rdio-scanner')
        ? await this.serviceConfig.configureRdioScanner(true, 'docker', radioApiKey)
        : null,
      op25: (enableOP25 || radioSoftware === 'op25')
        ? await this.serviceConfig.configureOP25(true, 'docker', radioApiKey)
        : null,
      icad: await this.serviceConfig.configureICAD(enableICAD, 'docker', icadApiKey),
      ollama: await this.serviceConfig.configureOllama(enableOllama, 'docker')
    };

    // Extract API keys from service results (in case they were already set)
    const finalICADApiKey = serviceResults.icad?.apiKey || icadApiKey;
    const finalRadioApiKey = serviceResults.trunkRecorder?.apiKey || 
                             serviceResults.sdrtrunk?.apiKey || 
                             serviceResults.rdioScanner?.apiKey || 
                             serviceResults.op25?.apiKey || 
                             radioApiKey;

    // Build docker-compose.yml
    // Pass service URLs so compose builder knows if services are remote
    const composeResult = await this.composeBuilder.build({
      enableOllama: enableOllama || !!envConfig.ollamaUrl,  // Enable if local or remote
      enableICAD: enableICAD || !!envConfig.icadUrl,  // Enable if local or remote
      enableTrunkRecorder: enableTrunkRecorder || radioSoftware === 'trunk-recorder',
      enableRdioScanner: enableRdioScanner || radioSoftware === 'rdio-scanner',
      enableOP25: enableOP25 || radioSoftware === 'op25',
      radioSoftware: radioSoftware,
      enableGPU,
      transcriptionMode,
      timezone,
      ollamaUrl: envConfig.ollamaUrl,  // Pass remote URL if provided
      icadUrl: envConfig.icadUrl  // Pass remote URL if provided
    });
    
    // Store enabled services for error handling
    this.enabledServices = {
      ollama: enableOllama,
      icad: enableICAD,
      trunkRecorder: enableTrunkRecorder || radioSoftware === 'trunk-recorder',
      rdioScanner: enableRdioScanner || radioSoftware === 'rdio-scanner',
      op25: enableOP25 || radioSoftware === 'op25',
      sdrtrunk: enableSDRTrunk || radioSoftware === 'sdrtrunk',
      radioSoftware: radioSoftware
    };

    // Generate .env file with API keys
    // Use provided ollamaUrl if it's a remote URL, otherwise use local Docker container URL
    const finalOllamaUrl = envConfig.ollamaUrl || (enableOllama ? 'http://ollama:11434' : undefined);
    
    const envPath = await this.envGenerator.generate({
      ...envConfig,
      installationType: 'docker',
      enableICAD,
      icadUrl: envConfig.icadUrl || (enableICAD ? 'http://icad-transcribe:9912' : undefined),
      icadApiKey: finalICADApiKey,
      trunkRecorderApiKey: finalRadioApiKey,
      radioApiKey: finalRadioApiKey,
      radioSoftware: radioSoftware,
      ollamaUrl: finalOllamaUrl
    });

    return {
      success: true,
      compose: composeResult,
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
   * Get next steps for user
   */
  getNextSteps(services) {
    const steps = [];

    steps.push('✅ API keys have been automatically generated and configured:');
    if (services.radioSoftware && services.radioSoftware !== 'none') {
      steps.push(`   • ${services.radioSoftware} API key: Set in config files and Scanner Map .env`);
    }
    steps.push('   • iCAD Transcribe API key: Set in .env files');
    steps.push('   • Review .env file for any additional API keys needed (OpenAI, geocoding, etc.)');
    
    steps.push('');
    steps.push('📦 All data directories have been created in ./appdata/:');
    steps.push('   • scanner-map/ - Main application data');
    if (services.enableOllama) {
      steps.push('   • ollama/ - AI model storage (persistent)');
    }
    if (services.enableICAD) {
      steps.push('   • icad-transcribe/ - Transcription service data and models');
    }
    if (services.enableTrunkRecorder || services.radioSoftware === 'trunk-recorder') {
      steps.push('   • trunk-recorder/ - Radio recording configuration and audio');
    }
    if (services.enableSDRTrunk || services.radioSoftware === 'sdrtrunk') {
      steps.push('   • sdrtrunk/ - Configuration files (for desktop app)');
    }
    if (services.enableRdioScanner || services.radioSoftware === 'rdio-scanner') {
      steps.push('   • rdio-scanner/ - Configuration and data');
    }
    if (services.enableOP25 || services.radioSoftware === 'op25') {
      steps.push('   • op25/ - Configuration and recordings');
    }
    
    steps.push('');
    steps.push('🚀 To start services:');
    steps.push('   docker-compose up -d');
    
    if (services.enableTrunkRecorder || services.radioSoftware === 'trunk-recorder') {
      steps.push('');
      steps.push('📡 TrunkRecorder setup:');
      steps.push('   1. Pull the image: docker pull robotastic/trunk-recorder:latest');
      steps.push('   2. Configure your radio system in appdata/trunk-recorder/config/config.json');
      steps.push('   3. API key is already configured automatically');
    }
    
    if (services.enableSDRTrunk || services.radioSoftware === 'sdrtrunk') {
      steps.push('');
      steps.push('📡 SDRTrunk setup:');
      steps.push('   1. Configuration file generated: appdata/sdrtrunk/config/streaming-config.json');
      steps.push('   2. Import this config into SDRTrunk desktop app');
      steps.push('   3. API key is already configured automatically');
      steps.push('   4. See docs/RADIO-SOFTWARE.md for detailed instructions');
    }
    
    if (services.enableRdioScanner || services.radioSoftware === 'rdio-scanner') {
      steps.push('');
      steps.push('🌐 rdio-scanner setup:');
      steps.push('   1. Pull the image: docker pull rdioscanner/rdio-scanner:latest');
      steps.push('   2. Configuration file generated: appdata/rdio-scanner/config/config.json');
      steps.push('   3. Downstream server is already configured');
      steps.push('   4. Access web interface: http://localhost:3000');
      steps.push('   5. See docs/RADIO-SOFTWARE.md for detailed instructions');
    }
    
    if (services.enableOP25 || services.radioSoftware === 'op25') {
      steps.push('');
      steps.push('🔧 OP25 setup:');
      steps.push('   1. Pull the image: docker pull op25/op25:latest');
      steps.push('   2. Configuration file generated: appdata/op25/config/config.json');
      steps.push('   3. Upload server is already configured');
      steps.push('   4. See docs/RADIO-SOFTWARE.md for detailed instructions');
    }
    
    if (services.enableOllama) {
      steps.push('');
      steps.push('🤖 Ollama setup:');
      steps.push('   1. After services start, pull your model:');
      steps.push('      docker exec ollama ollama pull <model-name>');
      steps.push('   2. Models are stored persistently in ./appdata/ollama/');
    }

    if (services.enableICAD) {
      steps.push('');
      steps.push('🎤 iCAD Transcribe setup:');
      steps.push('   1. Access web interface: http://localhost:9912');
      steps.push('   2. Default login: admin / changeme123 (CHANGE THIS IMMEDIATELY!)');
      steps.push('   3. Install models via the web interface');
      steps.push('   4. Models are stored persistently in ./appdata/icad-transcribe/models/');
      steps.push('   5. API key is already configured automatically');
    }

    steps.push('');
    steps.push('🌐 Access Scanner Map: http://localhost:3001');
    steps.push('📊 View logs: docker-compose logs -f scanner-map');

    return steps;
  }

  /**
   * Start Docker services
   */
  async startServices() {
    const chalk = require('chalk');
    try {
      // Ensure TrunkRecorder config exists if TrunkRecorder is enabled
      if (this.enabledServices?.trunkRecorder) {
        const configPath = path.join(this.projectRoot, 'appdata', 'trunk-recorder', 'config', 'config.json');
        const fs = require('fs-extra');
        
        // Check if config exists and is valid
        let needsConfig = false;
        if (!(await fs.pathExists(configPath))) {
          needsConfig = true;
        } else {
          try {
            const content = await fs.readFile(configPath, 'utf8');
            if (!content || content.trim().length === 0) {
              needsConfig = true;
            } else {
              // Try to parse as JSON
              JSON.parse(content);
            }
          } catch (err) {
            needsConfig = true;
          }
        }
        
        // Create config if needed
        if (needsConfig) {
          console.log(chalk.yellow('   ⚠️  TrunkRecorder config.json missing or invalid, creating default...'));
          await this.serviceConfig.configureTrunkRecorder(true, 'docker');
          console.log(chalk.green('   ✓ TrunkRecorder config.json created'));
        }
      }
      // #region agent log
      debugLog('docker-installer.js:165', 'startServices entry', { projectRoot: this.projectRoot, enabledServices: this.enabledServices }, 'D');
      // #endregion

      // Check if docker-compose or docker compose
      let composeCmd = 'docker compose';
      let composeArgs = ['compose']; // For spawn, we need to split "docker compose"
      try {
        execSync('docker compose version', { stdio: 'ignore' });
      } catch (err) {
        composeCmd = 'docker-compose';
        composeArgs = []; // docker-compose is a single command
      }

      // #region agent log
      debugLog('docker-installer.js:175', 'composeCmd determined', { composeCmd, composeArgs }, 'D');
      // #endregion

      // Check for running containers before starting (Hypothesis D)
      let runningContainers = [];
      try {
        const containerList = execSync('docker ps --format "{{.Names}}"', { 
          cwd: this.projectRoot,
          encoding: 'utf8',
          stdio: 'pipe'
        });
        runningContainers = containerList.trim().split('\n').filter(c => c);
      } catch (err) {
        // Ignore errors checking containers
      }

      // #region agent log
      debugLog('docker-installer.js:188', 'running containers check', { runningContainers }, 'A');
      // #endregion

      // Check for port conflicts (Hypothesis A, B, C)
      let portConflicts = [];
      const portsToCheck = { '11434': 'ollama', '9912': 'icad-transcribe', '3001': 'scanner-map', '3306': 'scanner-map' };
      for (const [port, service] of Object.entries(portsToCheck)) {
        try {
          if (process.platform === 'win32') {
            execSync(`netstat -an | findstr :${port}`, { stdio: 'ignore' });
            portConflicts.push({ port, service, reason: 'port_in_use' });
          } else {
            execSync(`lsof -i :${port}`, { stdio: 'ignore' });
            portConflicts.push({ port, service, reason: 'port_in_use' });
          }
        } catch (err) {
          // Port appears free
        }
      }

      // #region agent log
      debugLog('docker-installer.js:203', 'port conflicts check', { portConflicts }, 'A,B,C');
      // #endregion

      // Try to start services, but handle partial failures gracefully
      // If TrunkRecorder image doesn't exist (and TrunkRecorder was enabled), start other services anyway
      try {
        // #region agent log
        debugLog('docker-installer.js:209', 'attempting docker compose up', { composeCmd }, 'D');
        // #endregion

        // Note: scanner-map image will be built automatically if it doesn't exist
        // This is required because it contains the application code
        // Build is optimized based on transcription mode (local vs remote/iCAD/OpenAI)
        // Optional services (Ollama, iCAD) use pre-built images and don't require building
        execSync(`${composeCmd} up -d`, {
          cwd: this.projectRoot,
          stdio: 'pipe' // Use pipe to capture output
        });
      const result = { success: true };
      
      // Wait a moment for services to fully start
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      return result;
    } catch (err) {
      const errorOutput = err.stdout?.toString() || err.stderr?.toString() || err.message || '';
      
      // #region agent log
      debugLog('docker-installer.js:220', 'docker compose up failed', { 
        errorOutput: errorOutput.substring(0, 500), 
        hasPortError: errorOutput.includes('ports are not available') || errorOutput.includes('bind:'),
        hasTrunkRecorderError: errorOutput.includes('trunk-recorder')
      }, 'A,B,C,D');
      // #endregion
        
        // Check if it's a port conflict issue (Hypothesis A, B, C)
        if (errorOutput.includes('ports are not available') || 
            errorOutput.includes('bind:') ||
            errorOutput.includes('address already in use')) {
          // #region agent log
          debugLog('docker-installer.js:268', 'port conflict detected', { 
            errorOutput: errorOutput.substring(0, 300), 
            runningContainers, 
            portConflicts 
          }, 'A,B,C');
          // #endregion

          // Try to start services individually, skipping ones that are already running
          console.log(chalk.yellow('\n⚠ Port conflict detected. Checking running containers and starting services individually...'));
          
          // Build list of services to try, excluding already running ones
          const servicesToTry = [];
          
          // Always try scanner-map (it's the main service)
          if (!runningContainers.includes('scanner-map')) {
            servicesToTry.push('scanner-map');
          } else {
            console.log(chalk.blue('   scanner-map is already running, skipping'));
          }
          
          if (this.enabledServices) {
            if (this.enabledServices.ollama) {
              if (!runningContainers.includes('ollama')) {
                servicesToTry.push('ollama');
              } else {
                console.log(chalk.blue('   ollama is already running, skipping'));
              }
            }
            if (this.enabledServices.icad) {
              if (!runningContainers.includes('icad-transcribe')) {
                servicesToTry.push('icad-transcribe');
              } else {
                console.log(chalk.blue('   icad-transcribe is already running, skipping'));
              }
            }
          } else {
            // Fallback: try common services if enabledServices not set
            if (!runningContainers.includes('ollama')) servicesToTry.push('ollama');
            if (!runningContainers.includes('icad-transcribe')) servicesToTry.push('icad-transcribe');
          }
          
          if (servicesToTry.length === 0) {
            console.log(chalk.yellow('   All services are already running'));
            return { success: true, warning: 'All services are already running' };
          }

          // #region agent log
          debugLog('docker-installer.js:277', 'attempting individual service start', { servicesToTry, runningContainers }, 'A,B,C');
          // #endregion

          // Start services one by one
          const startedServices = [];
          const failedServices = [];
          for (const service of servicesToTry) {
            try {
              // Split command properly for spawn
              // Use --no-deps to prevent starting dependencies that might conflict
              const spawnCmd = composeCmd === 'docker compose' ? 'docker' : composeCmd;
              const spawnArgs = composeCmd === 'docker compose' 
                ? [...composeArgs, 'up', '-d', '--no-deps', service]
                : ['up', '-d', '--no-deps', service];
              
              // #region agent log
              debugLog('docker-installer.js:332', 'spawning service start', { spawnCmd, spawnArgs, service, usingNoDeps: true }, 'A,B,C');
              // #endregion
              
              const child = spawn(spawnCmd, spawnArgs, {
                cwd: this.projectRoot,
                stdio: 'inherit'
              });
              
              await new Promise((resolve, reject) => {
                child.on('close', (code) => {
                  if (code === 0) {
                    resolve();
                  } else {
                    reject(new Error(`Service ${service} exited with code ${code}`));
                  }
                });
                child.on('error', reject);
              });
              startedServices.push(service);
            } catch (serviceErr) {
              failedServices.push({ service, error: serviceErr.message });
            }
          }

          // #region agent log
          debugLog('docker-installer.js:300', 'individual service start results', { startedServices, failedServices }, 'A,B,C');
          // #endregion

          if (startedServices.length > 0) {
            let warning = `Some services started: ${startedServices.join(', ')}`;
            if (failedServices.length > 0) {
              warning += `. Failed: ${failedServices.map(f => f.service).join(', ')}. Check if ports are already in use.`;
            }
            return { success: true, warning };
          } else {
            return {
              success: false,
              error: `All services failed to start. Port conflicts detected. Try stopping existing containers: docker-compose down`
            };
          }
        }

        // Check if it's a TrunkRecorder image issue (only if TrunkRecorder was enabled)
        if (this.enabledServices?.trunkRecorder &&
            errorOutput.includes('trunk-recorder') && 
            (errorOutput.includes('does not exist') || 
             errorOutput.includes('pull access denied') ||
             errorOutput.includes('repository does not exist'))) {
          // Try starting services without TrunkRecorder
          console.log(chalk.yellow('\n⚠ TrunkRecorder image not found.'));
          console.log(chalk.blue('   Starting other services without TrunkRecorder...'));
          console.log(chalk.gray('   You can build the TrunkRecorder image later if needed.'));
          try {
            // Build list of services to start (excluding trunk-recorder and already running ones)
            const servicesToStart = [];
            
            // Check scanner-map
            if (!runningContainers.includes('scanner-map')) {
              servicesToStart.push('scanner-map');
            } else {
              console.log(chalk.blue('   scanner-map is already running, skipping'));
            }
            
            // Check which services were enabled and not already running
            if (this.enabledServices) {
              if (this.enabledServices.ollama && !runningContainers.includes('ollama')) {
                servicesToStart.push('ollama');
              } else if (this.enabledServices.ollama) {
                console.log(chalk.blue('   ollama is already running, skipping'));
              }
              if (this.enabledServices.icad && !runningContainers.includes('icad-transcribe')) {
                servicesToStart.push('icad-transcribe');
              } else if (this.enabledServices.icad) {
                console.log(chalk.blue('   icad-transcribe is already running, skipping'));
              }
            } else {
              // Fallback: try common services if not already running
              if (!runningContainers.includes('ollama')) servicesToStart.push('ollama');
              if (!runningContainers.includes('icad-transcribe')) servicesToStart.push('icad-transcribe');
            }
            
            if (servicesToStart.length === 0) {
              console.log(chalk.yellow('   All services are already running'));
              return { success: true, warning: 'All services are already running. TrunkRecorder image not built yet.' };
            }
            
            // #region agent log
            debugLog('docker-installer.js:228', 'starting services without trunk-recorder', { servicesToStart, runningContainers }, 'D');
            // #endregion

            // Use spawn instead of execSync to show real-time output
            // Fix deprecation warning: don't use shell:true with array args
            const child = spawn(composeCmd, ['up', '-d', ...servicesToStart], {
              cwd: this.projectRoot,
              stdio: 'inherit'
            });
            
            // Wait for process to complete
            await new Promise((resolve, reject) => {
              child.on('close', (code) => {
                // #region agent log
                debugLog('docker-installer.js:240', 'services start completed', { code, servicesToStart }, 'D');
                // #endregion
                if (code === 0) {
                  resolve();
                } else {
                  reject(new Error(`Docker compose exited with code ${code}`));
                }
              });
              child.on('error', (err) => {
                // #region agent log
                debugLog('docker-installer.js:248', 'services start error', { error: err.message }, 'D');
                // #endregion
                reject(err);
              });
            });
            
            return { 
              success: true, 
              warning: 'TrunkRecorder not started - image must be built first. Other services started successfully.'
            };
          } catch (err2) {
            // #region agent log
            debugLog('docker-installer.js:256', 'services start failed, trying scanner-map only', { error: err2.message }, 'A,B,C');
            // #endregion

            // If that fails, try just scanner-map
            console.log(chalk.yellow('   Some services failed, trying scanner-map only...'));
            try {
              // Split command properly for spawn
              // Use --no-deps to prevent starting dependencies that might conflict
              const spawnCmd = composeCmd === 'docker compose' ? 'docker' : composeCmd;
              const spawnArgs = composeCmd === 'docker compose' 
                ? [...composeArgs, 'up', '-d', '--no-deps', 'scanner-map']
                : ['up', '-d', '--no-deps', 'scanner-map'];
              
              // #region agent log
              debugLog('docker-installer.js:456', 'spawning scanner-map only', { spawnCmd, spawnArgs, usingNoDeps: true }, 'A,B,C');
              // #endregion
              
              const child = spawn(spawnCmd, spawnArgs, {
                cwd: this.projectRoot,
                stdio: 'inherit'
              });
              
              await new Promise((resolve, reject) => {
                child.on('close', (code) => {
                  if (code === 0) {
                    resolve();
                  } else {
                    reject(new Error(`Docker compose exited with code ${code}`));
                  }
                });
                child.on('error', reject);
              });
              
              return { 
                success: true, 
                warning: 'Some services failed to start. Check logs with: docker-compose logs' 
              };
            } catch (err3) {
              return {
                success: false,
                error: `Failed to start services: ${err3.message}`
              };
            }
          }
        }
        
        // For other errors, return the error
        return {
          success: false,
          error: errorOutput || err.message
        };
      }
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }

  /**
   * Build TrunkRecorder Docker image
   * Clones repository to temp directory, builds image, then cleans up
   */
  async buildTrunkRecorderImage() {
    const chalk = require('chalk');
    
    try {
      // Check if image already exists
      try {
        execSync('docker images trunk-recorder:latest --format "{{.Repository}}:{{.Tag}}"', { 
          stdio: 'pipe',
          encoding: 'utf8'
        });
        console.log(chalk.green('✓ TrunkRecorder image already exists, skipping build'));
        return { success: true, skipped: true };
      } catch (err) {
        // Image doesn't exist, proceed with build
      }

      // Check Docker daemon is running
      try {
        execSync('docker ps', { stdio: 'ignore' });
      } catch (err) {
        return {
          success: false,
          error: 'Docker daemon is not running. Please start Docker Desktop or Docker service.'
        };
      }

      // Create temp directory for cloning
      const tempDir = path.join(os.tmpdir(), `trunk-recorder-build-${Date.now()}`);
      console.log(chalk.blue(`\nBuilding TrunkRecorder Docker image...`));
      console.log(chalk.gray(`  Cloning repository to: ${tempDir}`));

      try {
        // Clone repository
        execSync(`git clone --depth 1 https://github.com/TrunkRecorder/trunk-recorder.git "${tempDir}"`, {
          stdio: 'inherit',
          timeout: 300000 // 5 minutes timeout for clone
        });

        console.log(chalk.gray(`  Building Docker image (this may take several minutes)...`));

        // Build Docker image
        const buildProcess = spawn('docker', ['build', '-t', 'trunk-recorder:latest', '.'], {
          cwd: tempDir,
          stdio: 'inherit',
          shell: true
        });

        // Wait for build to complete with timeout (30 minutes)
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            buildProcess.kill();
            reject(new Error('TrunkRecorder build timed out after 30 minutes'));
          }, 1800000); // 30 minutes

          buildProcess.on('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Docker build exited with code ${code}`));
            }
          });

          buildProcess.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
          });
        });

        console.log(chalk.green('✓ TrunkRecorder image built successfully'));

        return { success: true };
      } finally {
        // Clean up temp directory
        try {
          if (await fs.pathExists(tempDir)) {
            await fs.remove(tempDir);
            console.log(chalk.gray(`  Cleaned up temporary files`));
          }
        } catch (cleanupErr) {
          console.warn(chalk.yellow(`  Warning: Could not clean up temp directory: ${cleanupErr.message}`));
        }
      }
    } catch (err) {
      return {
        success: false,
        error: err.message || 'Failed to build TrunkRecorder image'
      };
    }
  }

  /**
   * Pull TrunkRecorder Docker image from Docker Hub
   * Uses the official image: robotastic/trunk-recorder:latest
   * Documentation: https://trunkrecorder.com/docs/Install/INSTALL-DOCKER
   */
  async pullTrunkRecorderImage() {
    const chalk = require('chalk');
    
    try {
      // Check if image already exists locally
      try {
        execSync('docker images robotastic/trunk-recorder:latest --format "{{.Repository}}:{{.Tag}}"', { 
          stdio: 'pipe',
          encoding: 'utf8'
        });
        console.log(chalk.green('✓ TrunkRecorder image already exists locally, skipping pull'));
        return { success: true, skipped: true };
      } catch (err) {
        // Image doesn't exist locally, will pull it
      }

      // Check Docker daemon is running
      try {
        execSync('docker ps', { stdio: 'ignore' });
      } catch (err) {
        return {
          success: false,
          error: 'Docker daemon is not running. Please start Docker Desktop or Docker service.'
        };
      }

      console.log(chalk.blue(`\nPulling TrunkRecorder Docker image from Docker Hub...`));
      console.log(chalk.gray(`  Image: robotastic/trunk-recorder:latest`));
      console.log(chalk.gray(`  This may take a few minutes depending on your internet connection...`));

      // Pull Docker image
      const pullProcess = spawn('docker', ['pull', 'robotastic/trunk-recorder:latest'], {
        stdio: 'inherit',
        shell: true
      });

      // Wait for pull to complete with timeout (15 minutes)
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pullProcess.kill();
          reject(new Error('TrunkRecorder pull timed out after 15 minutes'));
        }, 900000); // 15 minutes

        pullProcess.on('close', (code) => {
          clearTimeout(timeout);
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Docker pull exited with code ${code}`));
          }
        });

        pullProcess.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      console.log(chalk.green('✓ TrunkRecorder image pulled successfully'));

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err.message || 'Failed to pull TrunkRecorder image'
      };
    }
  }

  /**
   * Stop Docker services
   */
  async stopServices() {
    try {
      let composeCmd = 'docker compose';
      try {
        execSync('docker compose version', { stdio: 'ignore' });
      } catch (err) {
        composeCmd = 'docker-compose';
      }

      execSync(`${composeCmd} down`, {
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
   * Pull Ollama model automatically after services start
   */
  async pullOllamaModel(modelName) {
    const chalk = require('chalk');
    
    if (!modelName) {
      return { success: false, error: 'Model name is required' };
    }

    try {
      // Wait for Ollama container to be ready
      console.log(chalk.blue('   Waiting for Ollama to be ready...'));
      let retries = 30;
      let ready = false;
      
      while (retries > 0 && !ready) {
        try {
          execSync('docker exec ollama ollama list', { 
            stdio: 'ignore',
            timeout: 5000
          });
          ready = true;
        } catch (err) {
          retries--;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }

      if (!ready) {
        return { 
          success: false, 
          error: 'Ollama container not ready after 30 seconds',
          manualCommand: `docker exec ollama ollama pull ${modelName}`
        };
      }

      // Check if model already exists
      try {
        const listOutput = execSync('docker exec ollama ollama list', { 
          encoding: 'utf8',
          timeout: 10000
        });
        if (listOutput.includes(modelName)) {
          console.log(chalk.green(`   ✓ Model ${modelName} already exists`));
          return { success: true, alreadyExists: true };
        }
      } catch (err) {
        // Continue to pull if check fails
      }

      // Pull the model with progress display
      console.log(chalk.blue(`\n   📥 Pulling Ollama model: ${modelName}`));
      console.log(chalk.gray('   This may take several minutes depending on your internet speed.'));
      console.log(chalk.gray('   Progress will be shown below:\n'));
      
      const pullProcess = spawn('docker', ['exec', '-i', 'ollama', 'ollama', 'pull', modelName], {
        stdio: 'inherit',
        cwd: this.projectRoot
      });

      await new Promise((resolve, reject) => {
        pullProcess.on('close', (code) => {
          if (code === 0) {
            console.log(chalk.green(`\n   ✓ Model ${modelName} pulled successfully!\n`));
            resolve();
          } else {
            reject(new Error(`Ollama pull exited with code ${code}`));
          }
        });
        pullProcess.on('error', reject);
      });

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        manualCommand: `docker exec ollama ollama pull ${modelName}`
      };
    }
  }

  /**
   * Verify Docker installation status - shows images, containers, and health
   */
  async verifyInstallation(config) {
    const chalk = require('chalk');
    
    console.log(chalk.blue.bold('\n' + '='.repeat(60)));
    console.log(chalk.blue.bold('📊 Docker Installation Status Verification'));
    console.log(chalk.blue.bold('='.repeat(60) + '\n'));

    const status = {
      images: [],
      containers: [],
      volumes: [],
      networks: [],
      health: {},
      issues: []
    };

    try {
      // Check Docker images
      this.printHeader('Docker Images');
      try {
        const imagesOutput = execSync('docker images --format "{{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}"', {
          encoding: 'utf8',
          cwd: this.projectRoot
        });
        
        const imageLines = imagesOutput.trim().split('\n').filter(line => line.trim());
        const relevantImages = [];
        
        // Expected images based on configuration
        const expectedImages = ['scanner-map'];
        if (config.enableOllama && !config.ollamaUrl) {
          expectedImages.push('ollama');
        }
        if (config.enableICAD && !config.icadUrl) {
          expectedImages.push('icad-transcribe');
        }
        if (config.enableTrunkRecorder) {
          expectedImages.push('trunk-recorder');
        }

        if (imageLines.length === 0) {
          console.log(chalk.yellow('   ⚠️  No Docker images found'));
          status.issues.push('No Docker images found');
        } else {
          // Filter for relevant images
          imageLines.forEach(line => {
            const [image, size, created] = line.split('\t');
            const isRelevant = expectedImages.some(expected => 
              image.includes(expected.split('/')[0]) || image.includes(expected.split('/')[1] || '')
            );
            
            if (isRelevant || image.includes('scanner-map') || image.includes('ollama') || 
                image.includes('icad') || image.includes('trunk-recorder')) {
              relevantImages.push({ image, size, created });
              status.images.push({ image, size, created });
            }
          });

          if (relevantImages.length === 0) {
            console.log(chalk.yellow('   ⚠️  No relevant images found'));
            console.log(chalk.gray('   Expected images: ' + expectedImages.join(', ')));
          } else {
            relevantImages.forEach(({ image, size, created }) => {
              const isExpected = expectedImages.some(expected => 
                image.includes(expected.split('/')[0]) || image.includes(expected.split('/')[1] || '')
              );
              const icon = isExpected ? '✓' : 'ℹ️';
              const color = isExpected ? chalk.green : chalk.gray;
              console.log(color(`   ${icon} ${image.padEnd(40)} ${size}`));
            });
          }
        }
      } catch (err) {
        console.log(chalk.red(`   ✗ Error checking images: ${err.message}`));
        status.issues.push(`Error checking images: ${err.message}`);
      }

      console.log('');

      // Check Docker containers
      this.printHeader('Container Status');
      try {
        const containersOutput = execSync('docker ps -a --format "{{.Names}}\t{{.Status}}\t{{.Image}}\t{{.Ports}}"', {
          encoding: 'utf8',
          cwd: this.projectRoot
        });
        
        const containerLines = containersOutput.trim().split('\n').filter(line => line.trim());
        const relevantContainers = ['scanner-map'];
        
        if (config.enableOllama && !config.ollamaUrl) {
          relevantContainers.push('ollama');
        }
        if (config.enableICAD && !config.icadUrl) {
          relevantContainers.push('icad-transcribe');
        }
        if (config.enableTrunkRecorder) {
          relevantContainers.push('trunk-recorder');
        }

        if (containerLines.length === 0) {
          console.log(chalk.yellow('   ⚠️  No containers found'));
          status.issues.push('No containers found');
        } else {
          const foundContainers = [];
          containerLines.forEach(line => {
            const [name, statusText, image, ports] = line.split('\t');
            if (relevantContainers.includes(name)) {
              foundContainers.push({ name, status: statusText, image, ports });
              status.containers.push({ name, status: statusText, image, ports });
            }
          });

          if (foundContainers.length === 0) {
            console.log(chalk.yellow('   ⚠️  No relevant containers found'));
            console.log(chalk.gray('   Expected containers: ' + relevantContainers.join(', ')));
            status.issues.push('Expected containers not found');
          } else {
            foundContainers.forEach(({ name, status: statusText, image, ports }) => {
              const isRunning = statusText.includes('Up');
              const icon = isRunning ? '✓' : '⚠️';
              const color = isRunning ? chalk.green : chalk.yellow;
              const statusColor = isRunning ? chalk.green : chalk.yellow;
              
              console.log(color(`   ${icon} ${name.padEnd(20)} ${statusColor(statusText)}`));
              if (ports && ports.trim()) {
                console.log(chalk.gray(`      Ports: ${ports}`));
              }
              
              if (!isRunning) {
                status.issues.push(`Container ${name} is not running`);
              }
            });
          }
        }
      } catch (err) {
        console.log(chalk.red(`   ✗ Error checking containers: ${err.message}`));
        status.issues.push(`Error checking containers: ${err.message}`);
      }

      console.log('');

      // Check volumes
      this.printHeader('Volume Mounts');
      try {
        const volumesOutput = execSync('docker volume ls --format "{{.Name}}\t{{.Driver}}"', {
          encoding: 'utf8',
          cwd: this.projectRoot
        });
        
        // Also check appdata directory
        const appdataPath = path.join(this.projectRoot, 'appdata');
        if (fs.existsSync(appdataPath)) {
          const appdataDirs = fs.readdirSync(appdataPath, { withFileTypes: true })
            .filter(dirent => dirent.isDirectory())
            .map(dirent => dirent.name);
          
          if (appdataDirs.length > 0) {
            console.log(chalk.green('   ✓ appdata directory structure:'));
            appdataDirs.forEach(dir => {
              const dirPath = path.join(appdataPath, dir);
              const exists = fs.existsSync(dirPath);
              const icon = exists ? '✓' : '✗';
              const color = exists ? chalk.green : chalk.red;
              console.log(color(`      ${icon} ./appdata/${dir}/`));
              status.volumes.push(`./appdata/${dir}/`);
            });
          } else {
            console.log(chalk.yellow('   ⚠️  appdata directory is empty'));
            status.issues.push('appdata directory is empty');
          }
        } else {
          console.log(chalk.yellow('   ⚠️  appdata directory not found'));
          status.issues.push('appdata directory not found');
        }
      } catch (err) {
        console.log(chalk.red(`   ✗ Error checking volumes: ${err.message}`));
        status.issues.push(`Error checking volumes: ${err.message}`);
      }

      console.log('');

      // Check service health
      this.printHeader('Service Health');
      try {
        // Check scanner-map container
        try {
          execSync('docker exec scanner-map node -e "require(\'http\').get(\'http://localhost:3001/api/test\', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"', {
            stdio: 'ignore',
            timeout: 5000
          });
          console.log(chalk.green('   ✓ scanner-map: Healthy (API responding)'));
          status.health['scanner-map'] = 'healthy';
        } catch (err) {
          console.log(chalk.yellow('   ⚠️  scanner-map: Not responding (may still be starting)'));
          status.health['scanner-map'] = 'starting';
        }

        // Check Ollama if enabled locally
        if (config.enableOllama && !config.ollamaUrl) {
          try {
            execSync('docker exec ollama ollama list', {
              stdio: 'ignore',
              timeout: 5000
            });
            console.log(chalk.green('   ✓ ollama: Healthy (API responding)'));
            status.health['ollama'] = 'healthy';
          } catch (err) {
            console.log(chalk.yellow('   ⚠️  ollama: Not responding (may still be starting)'));
            status.health['ollama'] = 'starting';
          }
        } else if (config.ollamaUrl) {
          console.log(chalk.blue(`   ℹ️  ollama: Using remote URL (${config.ollamaUrl})`));
          status.health['ollama'] = 'remote';
        }

        // Check iCAD if enabled locally
        if (config.enableICAD && !config.icadUrl) {
          try {
            execSync('curl -f http://localhost:9912/api/health 2>/dev/null || echo "not-ready"', {
              stdio: 'ignore',
              timeout: 5000
            });
            console.log(chalk.green('   ✓ icad-transcribe: Healthy (web interface accessible)'));
            status.health['icad-transcribe'] = 'healthy';
          } catch (err) {
            console.log(chalk.yellow('   ⚠️  icad-transcribe: Not responding (may still be starting)'));
            status.health['icad-transcribe'] = 'starting';
          }
        } else if (config.icadUrl) {
          console.log(chalk.blue(`   ℹ️  icad-transcribe: Using remote URL (${config.icadUrl})`));
          status.health['icad-transcribe'] = 'remote';
        }

        // Check TrunkRecorder if enabled
        if (config.enableTrunkRecorder) {
          try {
            execSync('docker exec trunk-recorder echo "test" 2>/dev/null', {
              stdio: 'ignore',
              timeout: 5000
            });
            console.log(chalk.green('   ✓ trunk-recorder: Container running'));
            status.health['trunk-recorder'] = 'healthy';
          } catch (err) {
            console.log(chalk.yellow('   ⚠️  trunk-recorder: Container not running or not ready'));
            status.health['trunk-recorder'] = 'starting';
          }
        }
      } catch (err) {
        console.log(chalk.red(`   ✗ Error checking service health: ${err.message}`));
        status.issues.push(`Error checking service health: ${err.message}`);
      }

      console.log('');

      // Summary
      this.printHeader('Installation Summary');
      const totalIssues = status.issues.length;
      const runningContainers = status.containers.filter(c => c.status.includes('Up')).length;
      const totalExpectedContainers = status.containers.length;

      if (totalIssues === 0 && runningContainers === totalExpectedContainers) {
        console.log(chalk.green.bold('   ✅ All systems operational!'));
        console.log(chalk.green(`   ✓ ${runningContainers}/${totalExpectedContainers} containers running`));
        console.log(chalk.green(`   ✓ ${status.images.length} images available`));
        console.log(chalk.green(`   ✓ ${status.volumes.length} volumes mounted`));
      } else {
        console.log(chalk.yellow.bold(`   ⚠️  Installation complete with ${totalIssues} issue(s)`));
        console.log(chalk.yellow(`   ${runningContainers}/${totalExpectedContainers} containers running`));
        if (totalIssues > 0) {
          console.log(chalk.red(`   ${totalIssues} issue(s) detected:`));
          status.issues.forEach(issue => {
            console.log(chalk.red(`      • ${issue}`));
          });
        }
      }

      console.log('');
      console.log(chalk.blue.bold('='.repeat(60)));
      console.log('');

      return {
        success: totalIssues === 0,
        status,
        issues: status.issues
      };
    } catch (err) {
      console.log(chalk.red(`\n   ✗ Error during verification: ${err.message}\n`));
      return {
        success: false,
        error: err.message,
        status
      };
    }
  }

  /**
   * Helper to print section headers
   */
  printHeader(title) {
    const chalk = require('chalk');
    console.log(chalk.cyan.bold(`\n${title}:`));
    console.log(chalk.gray('─'.repeat(50)));
  }
}

module.exports = DockerInstaller;

