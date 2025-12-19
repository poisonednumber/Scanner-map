/**
 * Docker Compose Builder
 * Programmatically builds docker-compose.yml based on service selections
 */

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');
const GPUDetector = require('./gpu-detector');

class DockerComposeBuilder {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.composePath = path.join(projectRoot, 'docker-compose.yml');
    this.gpuDetector = new GPUDetector();
  }

  /**
   * Build docker-compose.yml from base template and service selections
   */
  async build(services) {
    const {
      enableOllama = false,
      enableICAD = false,
      enableTrunkRecorder = false,
      enableRdioScanner = false,
      enableOP25 = false,
      radioSoftware = 'none',
      transcriptionMode = 'local',
      timezone = 'America/New_York',
      enableGPU = false,
      ollamaUrl = null,  // If provided, it's a remote URL - don't start local container
      icadUrl = null  // If provided, it's a remote URL - don't start local container
    } = services;
    
    // Only enable local containers if service is enabled AND no remote URL is provided
    // Check if URL is a remote URL (not localhost or Docker service name)
    const isRemoteOllama = ollamaUrl && !ollamaUrl.includes('localhost') && !ollamaUrl.includes('ollama:');
    const isRemoteICAD = icadUrl && !icadUrl.includes('localhost') && !icadUrl.includes('icad-transcribe:');
    
    const shouldStartOllamaContainer = enableOllama && !isRemoteOllama;
    const shouldStartICADContainer = enableICAD && !isRemoteICAD;

    // Check GPU availability if requested
    let gpuConfig = null;
    if (enableGPU) {
      const gpuInfo = await this.gpuDetector.detectNvidiaGPU();
      if (gpuInfo.available) {
        gpuConfig = this.gpuDetector.getDockerComposeGPUConfig();
      }
    }

    // Start with base scanner-map service
    // Always build scanner-map (contains app code), but build args control dependencies
    const compose = {
      services: {
        'scanner-map': {
          build: {
            context: '.',
            dockerfile: 'Dockerfile',
            args: {
              TRANSCRIPTION_MODE: transcriptionMode
            }
          },
          container_name: 'scanner-map',
          restart: 'unless-stopped',
          ports: [
            '${WEBSERVER_PORT:-3001}:3001',
            '${BOT_PORT:-3306}:3306'
          ],
          volumes: [
            './appdata/scanner-map/data:/app/data',
            './appdata/scanner-map/audio:/app/audio',
            './appdata/scanner-map/logs:/app/logs',
            './.env:/app/.env',
            './appdata/trunk-recorder/config:/app/appdata/trunk-recorder/config',
            './appdata/icad-transcribe:/app/appdata/icad-transcribe'
          ],
          environment: [
            'NODE_ENV=production'
          ],
          networks: [
            'scanner-network'
          ],
          healthcheck: {
            test: [
              'CMD',
              'node',
              '-e',
              "require('http').get('http://localhost:3001/api/test', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"
            ],
            interval: '30s',
            timeout: '10s',
            retries: 3,
            start_period: '40s'
          }
        }
      },
      networks: {
        'scanner-network': {
          driver: 'bridge'
        }
      }
    };

    // Build depends_on array
    const dependsOn = [];

    // Add Ollama service if enabled and not using remote URL
    if (shouldStartOllamaContainer) {
      compose.services.ollama = {
        image: 'ollama/ollama:latest',
        container_name: 'ollama',
        restart: 'unless-stopped',
        volumes: [
          './appdata/ollama:/root/.ollama'  // Models persist here
        ],
        ports: [
          '11434:11434'
        ],
        networks: [
          'scanner-network'
        ],
        environment: [
          'OLLAMA_KEEP_ALIVE=24h'  // Keep models loaded for 24 hours
        ]
      };
      
      // Add GPU support if available
      if (gpuConfig) {
        compose.services.ollama.deploy = gpuConfig.deploy;
      }
      
      dependsOn.push('ollama');
    } else if (enableOllama && isRemoteOllama) {
      // Remote Ollama - don't start container, but note it in header
    }

    // Add iCAD Transcribe service if enabled and not using remote URL
    if (shouldStartICADContainer) {
      compose.services['icad-transcribe'] = {
        image: 'thegreatcodeholio/icad_transcribe:1.0',
        container_name: 'icad-transcribe',
        restart: 'unless-stopped',
        user: '9911:9911',
        ports: [
          '9912:9912'
        ],
        volumes: [
          './appdata/icad-transcribe/log:/app/log',
          './appdata/icad-transcribe/var:/app/var',
          './appdata/icad-transcribe/.env:/app/.env',
          './appdata/icad-transcribe/models:/app/models'  // Persistent model storage
        ],
        networks: [
          'scanner-network'
        ],
        environment: [
          `TZ=${timezone}`
        ]
      };
      dependsOn.push('icad-transcribe');
    } else if (enableICAD && isRemoteICAD) {
      // Remote iCAD - don't start container, but note it in header
    }

    // Add TrunkRecorder service if enabled
    // Note: TrunkRecorder can use pre-built image from Docker Hub or be built locally
    if (enableTrunkRecorder || radioSoftware === 'trunk-recorder') {
      compose.services['trunk-recorder'] = {
        // Try to use pre-built image first, fallback to local build
        // Pre-built: robotastic/trunk-recorder:latest (from Docker Hub)
        // Local build: trunk-recorder:latest (if built locally)
        image: 'robotastic/trunk-recorder:latest',
        container_name: 'trunk-recorder',
        restart: 'unless-stopped',
        privileged: true,
        devices: [
          '/dev/bus/usb:/dev/bus/usb'
        ],
        volumes: [
          './appdata/trunk-recorder/config:/config',
          './appdata/trunk-recorder/config/config.json:/app/config.json',  // Also mount to /app/config.json if image expects it there
          './appdata/trunk-recorder/recordings:/recordings'
        ],
        environment: [
          `TZ=${timezone}`
        ],
        networks: [
          'scanner-network'
        ],
        // Don't fail if image doesn't exist - user can pull/build it separately
        pull_policy: 'missing'
      };
      // Don't add TrunkRecorder to depends_on - it may not be available yet
      // Users can start it separately after pulling/building the image
      // dependsOn.push('trunk-recorder');
    }

    // Add rdio-scanner service if enabled
    if (enableRdioScanner || radioSoftware === 'rdio-scanner') {
      compose.services['rdio-scanner'] = {
        // rdio-scanner Docker image (community maintained)
        // Note: Check Docker Hub for available images (e.g., rdioscanner/rdio-scanner:latest)
        image: 'rdioscanner/rdio-scanner:latest',
        container_name: 'rdio-scanner',
        restart: 'unless-stopped',
        ports: [
          '3000:3000'  // rdio-scanner web interface port
        ],
        volumes: [
          './appdata/rdio-scanner/config:/app/config',
          './appdata/rdio-scanner/data:/app/data'
        ],
        environment: [
          `TZ=${timezone}`
        ],
        networks: [
          'scanner-network'
        ],
        pull_policy: 'missing'
      };
      // rdio-scanner doesn't need to depend on scanner-map
    }

    // Add OP25 service if enabled
    if (enableOP25 || radioSoftware === 'op25') {
      compose.services['op25'] = {
        // OP25 Docker image (community maintained)
        // Note: Check Docker Hub for available images (e.g., op25/op25:latest)
        image: 'op25/op25:latest',
        container_name: 'op25',
        restart: 'unless-stopped',
        privileged: true,
        devices: [
          '/dev/bus/usb:/dev/bus/usb'
        ],
        volumes: [
          './appdata/op25/config:/app/config',
          './appdata/op25/recordings:/app/recordings'
        ],
        environment: [
          `TZ=${timezone}`
        ],
        networks: [
          'scanner-network'
        ],
        pull_policy: 'missing'
      };
      // OP25 doesn't need to depend on scanner-map
    }

    // Add depends_on to scanner-map if any services are enabled
    // Note: TrunkRecorder is NOT added to depends_on since it may not be built yet
    // Users can start it separately after building the image
    if (dependsOn.length > 0) {
      compose.services['scanner-map'].depends_on = dependsOn;
    }

    // Convert to YAML (without version field - it's obsolete)
    const yamlContent = yaml.dump(compose, {
      indent: 2,
      lineWidth: -1,
      noRefs: true
    });

    // Remove version field if present (it's obsolete in newer Docker Compose)
    // Try multiple patterns to catch different formats
    let cleanedYaml = yamlContent
      .replace(/^version:\s*['"]3\.8['"]\s*\n/m, '')
      .replace(/^version:\s*3\.8\s*\n/m, '')
      .replace(/^version:\s*['"]3\.8['"]\s*$/m, '')
      .replace(/^version:\s*3\.8\s*$/m, '');

    // Add header comment
    const header = `# Docker Compose configuration for Scanner Map
# Generated by installer on ${new Date().toISOString()}
# 
# Services enabled:
${enableOllama ? (isRemoteOllama ? `# - Ollama (Remote) - ${ollamaUrl}` : '# - Ollama (Local AI) - Models stored in ./appdata/ollama/') : ''}
${enableICAD ? (isRemoteICAD ? `# - iCAD Transcribe (Remote) - ${icadUrl}` : '# - iCAD Transcribe (Advanced Transcription) - Models stored in ./appdata/icad-transcribe/models/') : ''}
${enableTrunkRecorder || radioSoftware === 'trunk-recorder' ? '# - TrunkRecorder (Radio Recording) - Pull image: docker pull robotastic/trunk-recorder:latest' : ''}
${enableRdioScanner || radioSoftware === 'rdio-scanner' ? '# - rdio-scanner (Web-based Scanner) - Pull image: docker pull rdioscanner/rdio-scanner:latest' : ''}
${enableOP25 || radioSoftware === 'op25' ? '# - OP25 (Command-line Decoder) - Pull image: docker pull op25/op25:latest' : ''}
${radioSoftware === 'sdrtrunk' ? '# - SDRTrunk (Desktop App) - Config file generated in ./appdata/sdrtrunk/config/' : ''}
${gpuConfig ? '# - GPU acceleration enabled (NVIDIA)' : ''}
#
# Data Persistence:
# All data is stored in ./appdata/ directory with proper volume mounts:
# - scanner-map/ - Database, audio files, logs
${enableOllama ? '# - ollama/ - AI models (persistent)' : ''}
${enableICAD ? '# - icad-transcribe/ - Models, config, database (all persistent)' : ''}
${enableTrunkRecorder || radioSoftware === 'trunk-recorder' ? '# - trunk-recorder/ - Config and recordings' : ''}
${enableRdioScanner || radioSoftware === 'rdio-scanner' ? '# - rdio-scanner/ - Config and data' : ''}
${enableOP25 || radioSoftware === 'op25' ? '# - op25/ - Config and recordings' : ''}
${radioSoftware === 'sdrtrunk' ? '# - sdrtrunk/ - Config files (for desktop app)' : ''}
#
# To remove all data: rm -rf ./appdata
# To backup: Copy ./appdata directory
#
# Note: version field removed (obsolete in newer Docker Compose versions)

`;

    const finalContent = header + cleanedYaml;

    // Write to file
    await fs.writeFile(this.composePath, finalContent, 'utf8');

    // Store build info for later use
    this.lastBuild = {
      services: {
        ollama: enableOllama,
        icad: enableICAD,
        trunkRecorder: enableTrunkRecorder || radioSoftware === 'trunk-recorder',
        rdioScanner: enableRdioScanner || radioSoftware === 'rdio-scanner',
        op25: enableOP25 || radioSoftware === 'op25',
        sdrtrunk: radioSoftware === 'sdrtrunk',
        radioSoftware: radioSoftware
      }
    };

    return {
      path: this.composePath,
      services: {
        ollama: enableOllama,
        icad: enableICAD,
        trunkRecorder: enableTrunkRecorder || radioSoftware === 'trunk-recorder',
        rdioScanner: enableRdioScanner || radioSoftware === 'rdio-scanner',
        op25: enableOP25 || radioSoftware === 'op25',
        sdrtrunk: radioSoftware === 'sdrtrunk',
        radioSoftware: radioSoftware
      }
    };
  }

  /**
   * Backup existing docker-compose.yml
   */
  async backup() {
    if (await fs.pathExists(this.composePath)) {
      const backupPath = `${this.composePath}.backup.${Date.now()}`;
      await fs.copy(this.composePath, backupPath);
      return backupPath;
    }
    return null;
  }

  /**
   * Check if docker-compose.yml exists
   */
  async exists() {
    return await fs.pathExists(this.composePath);
  }
}

module.exports = DockerComposeBuilder;
