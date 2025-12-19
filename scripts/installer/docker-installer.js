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
      enableGPU = false,
      timezone = 'America/New_York',
      ...envConfig
    } = config;

    // Create appdata structure
    await this.serviceConfig.createAppdataStructure();

    // Generate API keys for services that need them
    const { v4: uuidv4 } = require('uuid');
    const icadApiKey = enableICAD ? uuidv4() : null;
    const trunkRecorderApiKey = enableTrunkRecorder ? uuidv4() : null;

    // Configure services with generated API keys
    const serviceResults = {
      trunkRecorder: await this.serviceConfig.configureTrunkRecorder(enableTrunkRecorder, 'docker', trunkRecorderApiKey),
      icad: await this.serviceConfig.configureICAD(enableICAD, 'docker', icadApiKey),
      ollama: await this.serviceConfig.configureOllama(enableOllama, 'docker')
    };

    // Extract API keys from service results (in case they were already set)
    const finalICADApiKey = serviceResults.icad?.apiKey || icadApiKey;
    const finalTrunkRecorderApiKey = serviceResults.trunkRecorder?.apiKey || trunkRecorderApiKey;

    // Build docker-compose.yml
    const composeResult = await this.composeBuilder.build({
      enableOllama,
      enableICAD,
      enableTrunkRecorder,
      enableGPU,
      timezone
    });
    
    // Store enabled services for error handling
    this.enabledServices = {
      ollama: enableOllama,
      icad: enableICAD,
      trunkRecorder: enableTrunkRecorder
    };

    // Generate .env file with API keys
    const envPath = await this.envGenerator.generate({
      ...envConfig,
      installationType: 'docker',
      enableICAD,
      icadUrl: enableICAD ? 'http://icad-transcribe:9912' : undefined,
      icadApiKey: finalICADApiKey,
      trunkRecorderApiKey: finalTrunkRecorderApiKey,
      ollamaUrl: enableOllama ? 'http://ollama:11434' : undefined
    });

    return {
      success: true,
      compose: composeResult,
      services: serviceResults,
      env: envPath,
      nextSteps: this.getNextSteps({
        enableOllama,
        enableICAD,
        enableTrunkRecorder
      })
    };
  }

  /**
   * Get next steps for user
   */
  getNextSteps(services) {
    const steps = [];

    steps.push('1. API keys have been automatically generated and configured:');
    steps.push('   - TrunkRecorder API key: Set in config.json and Scanner Map .env');
    steps.push('   - iCAD Transcribe API key: Set in .env files');
    steps.push('   - Review .env file for any additional API keys needed (OpenAI, geocoding, etc.)');
    
    if (services.enableOllama) {
      steps.push('2. Ollama: After starting, pull the model: docker exec -it ollama ollama pull <model>');
    }

    if (services.enableICAD) {
      steps.push('3. iCAD Transcribe: Change the default password in appdata/icad-transcribe/.env');
      steps.push('   - Access web interface: http://localhost:9912');
      steps.push('   - Install models via web interface');
      steps.push('   - API key is already configured automatically');
    }

    if (services.enableTrunkRecorder) {
      steps.push('4. TrunkRecorder:');
      steps.push('   - Docker image has been built automatically');
      steps.push('   - Configure your radio system in appdata/trunk-recorder/config/config.json');
      steps.push('   - API key is already configured automatically');
    }

    steps.push('5. Start services: docker-compose up -d');
    steps.push('6. View logs: docker-compose logs -f scanner-map');
    steps.push('7. Access web interface: http://localhost:3001');

    return steps;
  }

  /**
   * Start Docker services
   */
  async startServices() {
    const chalk = require('chalk');
    try {
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
      // If TrunkRecorder image doesn't exist, start other services anyway
      try {
        // #region agent log
        debugLog('docker-installer.js:209', 'attempting docker compose up', { composeCmd }, 'D');
        // #endregion

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

        // Check if it's a TrunkRecorder image issue
        if (errorOutput.includes('trunk-recorder') && 
            (errorOutput.includes('does not exist') || 
             errorOutput.includes('pull access denied') ||
             errorOutput.includes('repository does not exist'))) {
          // Try starting services without TrunkRecorder
          console.log(chalk.yellow('\n⚠ TrunkRecorder image not found. Starting other services...'));
          console.log(chalk.blue('   This may take a few minutes if images need to be built...'));
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
              warning: 'TrunkRecorder not started - image must be built first. Build it with: git clone https://github.com/TrunkRecorder/trunk-recorder.git && cd trunk-recorder && docker build -t trunk-recorder:latest .' 
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

      // Pull the model
      console.log(chalk.blue(`   Pulling Ollama model: ${modelName}...`));
      console.log(chalk.gray('   This may take several minutes depending on your internet speed.\n'));
      
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
}

module.exports = DockerInstaller;

