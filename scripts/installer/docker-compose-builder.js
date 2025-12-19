/**
 * Docker Compose Builder
 * Programmatically builds docker-compose.yml based on service selections
 */

const fs = require('fs-extra');
const path = require('path');
const yaml = require('js-yaml');

class DockerComposeBuilder {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.composePath = path.join(projectRoot, 'docker-compose.yml');
  }

  /**
   * Build docker-compose.yml from base template and service selections
   */
  async build(services) {
    const {
      enableOllama = false,
      enableICAD = false,
      enableTrunkRecorder = false,
      timezone = 'America/New_York'
    } = services;

    // Start with base scanner-map service
    const compose = {
      services: {
        'scanner-map': {
          build: {
            context: '.',
            dockerfile: 'Dockerfile'
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

    // Add Ollama service if enabled
    if (enableOllama) {
      compose.services.ollama = {
        image: 'ollama/ollama:latest',
        container_name: 'ollama',
        restart: 'unless-stopped',
        volumes: [
          './appdata/ollama:/root/.ollama'
        ],
        ports: [
          '11434:11434'
        ],
        networks: [
          'scanner-network'
        ]
      };
      dependsOn.push('ollama');
    }

    // Add iCAD Transcribe service if enabled
    if (enableICAD) {
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
          './appdata/icad-transcribe/.env:/app/.env'
        ],
        networks: [
          'scanner-network'
        ],
        environment: [
          `TZ=${timezone}`
        ]
      };
      dependsOn.push('icad-transcribe');
    }

    // Add TrunkRecorder service if enabled
    // Note: TrunkRecorder must be built from source - there is no official pre-built Docker image
    // Official repo: https://github.com/TrunkRecorder/trunk-recorder
    // Users need to build the image themselves or run TrunkRecorder outside Docker
    if (enableTrunkRecorder) {
      compose.services['trunk-recorder'] = {
        // IMPORTANT: Users must build TrunkRecorder image first:
        // 1. Clone: git clone https://github.com/TrunkRecorder/trunk-recorder.git
        // 2. Build: cd trunk-recorder && docker build -t trunk-recorder:latest .
        // 3. Then this service will use the locally built image
        image: 'trunk-recorder:latest',
        container_name: 'trunk-recorder',
        restart: 'unless-stopped',
        privileged: true,
        devices: [
          '/dev/bus/usb:/dev/bus/usb'
        ],
        volumes: [
          './appdata/trunk-recorder/config:/config',
          './appdata/trunk-recorder/recordings:/recordings'
        ],
        environment: [
          `TZ=${timezone}`
        ],
        networks: [
          'scanner-network'
        ]
      };
      // Don't add TrunkRecorder to depends_on - it may not be built yet
      // Users can start it separately after building the image
      // dependsOn.push('trunk-recorder');
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
${enableOllama ? '# - Ollama (Local AI)' : ''}
${enableICAD ? '# - iCAD Transcribe (Advanced Transcription)' : ''}
${enableTrunkRecorder ? '# - TrunkRecorder (Radio Recording) - MUST BUILD IMAGE FIRST' : ''}
#
# All data is stored in ./appdata/ directory
# To remove all data: rm -rf ./appdata
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
        trunkRecorder: enableTrunkRecorder
      }
    };

    return {
      path: this.composePath,
      services: {
        ollama: enableOllama,
        icad: enableICAD,
        trunkRecorder: enableTrunkRecorder
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
