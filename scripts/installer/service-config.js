/**
 * Service configuration and auto-linking
 * Handles API key management and service interconnections
 */

const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class ServiceConfig {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.appdataPath = path.join(projectRoot, 'appdata');
  }

  /**
   * Generate a new API key (UUID v4)
   * @returns {string} Generated UUID
   */
  generateApiKey() {
    return uuidv4();
  }

  /**
   * Configure TrunkRecorder
   * @param {boolean} enabled - Whether TrunkRecorder is enabled
   * @param {string} installationType - 'docker' or 'local'
   * @param {string} apiKey - Optional pre-generated API key. If not provided, will generate one.
   * @returns {Promise<Object>} Configuration result with apiKey if generated
   */
  async configureTrunkRecorder(enabled, installationType = 'docker', apiKey = null) {
    if (!enabled) return null;

    const configDir = path.join(this.appdataPath, 'trunk-recorder', 'config');
    const configPath = path.join(configDir, 'config.json');
    
    await fs.ensureDir(configDir);
    await fs.ensureDir(path.join(this.appdataPath, 'trunk-recorder', 'recordings'));

    // Generate API key if not provided
    const generatedApiKey = apiKey || this.generateApiKey();

    // Determine upload URL based on installation type
    const uploadUrl = installationType === 'docker'
      ? 'http://scanner-map:3306/api/call-upload'
      : 'http://localhost:3306/api/call-upload';

    const config = {
      sources: [
        {
          type: 'rtl_sdr',
          device: 0,
          center: 850000000,
          rate: 2048000
        }
      ],
      systems: [
        {
          id: 1,
          name: 'Your System',
          control_channels: [851.0125, 851.5125],
          type: 'p25'
        }
      ],
      uploadServer: {
        type: 'rdio-scanner',
        url: uploadUrl,
        apiKey: generatedApiKey
      }
    };

    // Always ensure config.json exists and is valid JSON
    // If file doesn't exist, is empty, or is invalid, create/update it
    let shouldCreate = false;
    let shouldUpdate = false;
    
    if (!(await fs.pathExists(configPath))) {
      shouldCreate = true;
    } else {
      // Check if file is empty or invalid
      try {
        const fileContent = await fs.readFile(configPath, 'utf8');
        if (!fileContent || fileContent.trim().length === 0) {
          // File exists but is empty - recreate it
          shouldCreate = true;
        } else {
          const existing = await fs.readJSON(configPath);
          // Check if it needs the API key update
          if (existing.uploadServer && 
              (existing.uploadServer.apiKey === 'YOUR_API_KEY_HERE' || 
               existing.uploadServer.apiKey === 'AUTO_GENERATE_ON_STARTUP' ||
               !existing.uploadServer.apiKey)) {
            shouldUpdate = true;
          } else if (!existing.uploadServer) {
            // Missing uploadServer section
            shouldUpdate = true;
          }
        }
      } catch (err) {
        // File exists but is invalid JSON - recreate it
        console.warn(`Warning: TrunkRecorder config.json is invalid, recreating: ${err.message}`);
        shouldCreate = true;
      }
    }

    if (shouldCreate) {
      await fs.writeJSON(configPath, config, { spaces: 2 });
      return { created: true, path: configPath, apiKey: generatedApiKey };
    }

    if (shouldUpdate) {
      try {
        const existing = await fs.readJSON(configPath);
        if (!existing.uploadServer) {
          existing.uploadServer = {};
        }
        existing.uploadServer.apiKey = generatedApiKey;
        existing.uploadServer.url = uploadUrl;
        existing.uploadServer.type = 'rdio-scanner';
        await fs.writeJSON(configPath, existing, { spaces: 2 });
        return { updated: true, path: configPath, apiKey: generatedApiKey };
      } catch (err) {
        // If update fails, recreate the file
        console.warn(`Warning: Could not update TrunkRecorder config, recreating: ${err.message}`);
        await fs.writeJSON(configPath, config, { spaces: 2 });
        return { recreated: true, path: configPath, apiKey: generatedApiKey };
      }
    }

    // File exists and is valid - return existing API key if present
    try {
      const existing = await fs.readJSON(configPath);
      if (existing.uploadServer && existing.uploadServer.apiKey) {
        return { exists: true, path: configPath, apiKey: existing.uploadServer.apiKey };
      }
    } catch (err) {
      // Shouldn't happen, but handle it
    }

    return { exists: true, path: configPath, apiKey: generatedApiKey };
  }

  /**
   * Configure iCAD Transcribe
   * @param {boolean} enabled - Whether iCAD is enabled
   * @param {string} installationType - 'docker' or 'local'
   * @param {string} apiKey - Optional pre-generated API key. If not provided, will generate one.
   * @returns {Promise<Object>} Configuration result with apiKey if generated
   */
  async configureICAD(enabled, installationType = 'docker', apiKey = null) {
    if (!enabled) return null;

    const icadDir = path.join(this.appdataPath, 'icad-transcribe');
    const envPath = path.join(icadDir, '.env');
    const logDir = path.join(icadDir, 'log');
    const varDir = path.join(icadDir, 'var');
    const modelsDir = path.join(icadDir, 'models');

    // Ensure all directories exist
    await fs.ensureDir(icadDir);
    await fs.ensureDir(logDir);
    await fs.ensureDir(varDir);
    await fs.ensureDir(modelsDir);

    // Generate API key if not provided
    const generatedApiKey = apiKey || this.generateApiKey();

    // Determine base URL based on installation type
    const baseUrl = installationType === 'docker'
      ? 'http://localhost:9912'
      : 'http://localhost:9912';

    const envContent = `# iCAD Transcribe Configuration
LOG_LEVEL=2
DEBUG=False
BASE_URL=${baseUrl}
SESSION_COOKIE_SECURE=False
SESSION_COOKIE_DOMAIN=localhost
SESSION_COOKIE_NAME=icad_transcribe
SESSION_COOKIE_PATH=/
SQLITE_DATABASE_PATH=var/icad_transcribe.db
ROOT_USERNAME=admin
ROOT_PASSWORD=changeme123
# API key auto-generated and shared with Scanner Map
API_KEY=${generatedApiKey}
`;

    // Only create if doesn't exist (don't overwrite user config)
    if (!(await fs.pathExists(envPath))) {
      await fs.writeFile(envPath, envContent, 'utf8');
      return { created: true, path: envPath, apiKey: generatedApiKey, warning: 'Default password set - CHANGE IT!' };
    }

    // If exists, check if it needs the API key update
    try {
      const existing = await fs.readFile(envPath, 'utf8');
      if (existing.includes('API_KEY=AUTO_GENERATE_ON_STARTUP') || 
          !existing.includes('API_KEY=')) {
        // Update with generated key
        const updatedContent = existing.replace(/API_KEY=.*/g, `API_KEY=${generatedApiKey}`);
        if (!existing.includes('API_KEY=')) {
          // Add API key if missing
          const lines = existing.split('\n');
          lines.push(`API_KEY=${generatedApiKey}`);
          await fs.writeFile(envPath, lines.join('\n'), 'utf8');
        } else {
          await fs.writeFile(envPath, updatedContent, 'utf8');
        }
        return { updated: true, path: envPath, apiKey: generatedApiKey };
      }
      // Extract existing API key if present
      const apiKeyMatch = existing.match(/API_KEY=(.+)/);
      if (apiKeyMatch && apiKeyMatch[1]) {
        return { exists: true, path: envPath, apiKey: apiKeyMatch[1].trim() };
      }
    } catch (err) {
      console.warn(`Warning: Could not read iCAD .env: ${err.message}`);
    }

    return { exists: true, path: envPath, apiKey: generatedApiKey };
  }

  /**
   * Configure Ollama
   * @param {boolean} enabled - Whether Ollama is enabled
   * @param {string} installationType - 'docker' or 'local'
   * @returns {Promise<Object>} Configuration result
   */
  async configureOllama(enabled, installationType = 'docker') {
    if (!enabled) return null;

    // Ensure directory exists for both Docker and local
    // Docker uses this for volume mount, local uses it for model storage
    const ollamaDir = path.join(this.appdataPath, 'ollama');
    await fs.ensureDir(ollamaDir);
    
    if (installationType === 'docker') {
      // Docker installation handles Ollama via docker-compose
      // Just ensure directory exists for volume mount
      return { configured: true, path: ollamaDir, note: 'Docker service will be configured in docker-compose.yml' };
    }

    // For local installation, just ensure directory exists
    return { configured: true, path: ollamaDir };
  }

  /**
   * Configure SDRTrunk
   * @param {boolean} enabled - Whether SDRTrunk is enabled
   * @param {string} installationType - 'docker' or 'local'
   * @param {string} apiKey - Optional pre-generated API key. If not provided, will generate one.
   * @returns {Promise<Object>} Configuration result with apiKey if generated
   */
  async configureSDRTrunk(enabled, installationType = 'local', apiKey = null) {
    if (!enabled) return null;

    const configDir = path.join(this.appdataPath, 'sdrtrunk', 'config');
    const configPath = path.join(configDir, 'streaming-config.json');
    
    await fs.ensureDir(configDir);

    // Generate API key if not provided
    const generatedApiKey = apiKey || this.generateApiKey();

    // Determine upload URL based on installation type
    const uploadUrl = installationType === 'docker'
      ? 'http://scanner-map:3306/api/call-upload'
      : 'http://localhost:3306/api/call-upload';

    // Parse URL to get host and port
    const urlObj = new URL(uploadUrl);
    const host = urlObj.hostname;
    const port = parseInt(urlObj.port || '3306');
    const path = urlObj.pathname;

    const config = {
      name: 'Scanner Map',
      type: 'rdio-scanner',
      host: host,
      port: port,
      path: path,
      apiKey: generatedApiKey,
      systemId: 1
    };

    // Always ensure config exists and is valid
    let shouldCreate = false;
    
    if (!(await fs.pathExists(configPath))) {
      shouldCreate = true;
    } else {
      try {
        const fileContent = await fs.readFile(configPath, 'utf8');
        if (!fileContent || fileContent.trim().length === 0) {
          shouldCreate = true;
        } else {
          const existing = await fs.readJSON(configPath);
          // Update API key and URL if needed
          if (existing.apiKey !== generatedApiKey || existing.host !== host || existing.port !== port) {
            existing.apiKey = generatedApiKey;
            existing.host = host;
            existing.port = port;
            existing.path = path;
            await fs.writeJSON(configPath, existing, { spaces: 2 });
            return { updated: true, path: configPath, apiKey: generatedApiKey };
          }
        }
      } catch (err) {
        console.warn(`Warning: SDRTrunk config is invalid, recreating: ${err.message}`);
        shouldCreate = true;
      }
    }

    if (shouldCreate) {
      await fs.writeJSON(configPath, config, { spaces: 2 });
      return { created: true, path: configPath, apiKey: generatedApiKey };
    }

    return { exists: true, path: configPath, apiKey: generatedApiKey };
  }

  /**
   * Configure rdio-scanner
   * @param {boolean} enabled - Whether rdio-scanner is enabled
   * @param {string} installationType - 'docker' or 'local'
   * @param {string} apiKey - Optional pre-generated API key. If not provided, will generate one.
   * @returns {Promise<Object>} Configuration result with apiKey if generated
   */
  async configureRdioScanner(enabled, installationType = 'docker', apiKey = null) {
    if (!enabled) return null;

    const configDir = path.join(this.appdataPath, 'rdio-scanner', 'config');
    const configPath = path.join(configDir, 'config.json');
    
    await fs.ensureDir(configDir);

    // Generate API key if not provided
    const generatedApiKey = apiKey || this.generateApiKey();

    // Determine upload URL based on installation type
    const uploadUrl = installationType === 'docker'
      ? 'http://scanner-map:3306/api/call-upload'
      : 'http://localhost:3306/api/call-upload';

    const config = {
      downstream: [
        {
          url: uploadUrl,
          apiKey: generatedApiKey
        }
      ]
    };

    // Always ensure config exists and is valid
    let shouldCreate = false;
    let shouldUpdate = false;
    
    if (!(await fs.pathExists(configPath))) {
      shouldCreate = true;
    } else {
      try {
        const fileContent = await fs.readFile(configPath, 'utf8');
        if (!fileContent || fileContent.trim().length === 0) {
          shouldCreate = true;
        } else {
          const existing = await fs.readJSON(configPath);
          // Check if downstream config needs update
          if (!existing.downstream || !Array.isArray(existing.downstream) || existing.downstream.length === 0) {
            shouldUpdate = true;
          } else {
            const downstream = existing.downstream[0];
            if (downstream.url !== uploadUrl || downstream.apiKey !== generatedApiKey) {
              shouldUpdate = true;
            }
          }
        }
      } catch (err) {
        console.warn(`Warning: rdio-scanner config is invalid, recreating: ${err.message}`);
        shouldCreate = true;
      }
    }

    if (shouldCreate) {
      await fs.writeJSON(configPath, config, { spaces: 2 });
      return { created: true, path: configPath, apiKey: generatedApiKey };
    }

    if (shouldUpdate) {
      try {
        const existing = await fs.readJSON(configPath);
        if (!existing.downstream) {
          existing.downstream = [];
        }
        // Update or add Scanner Map downstream
        const existingIndex = existing.downstream.findIndex(d => d.url && d.url.includes('scanner-map'));
        if (existingIndex >= 0) {
          existing.downstream[existingIndex] = { url: uploadUrl, apiKey: generatedApiKey };
        } else {
          existing.downstream.push({ url: uploadUrl, apiKey: generatedApiKey });
        }
        await fs.writeJSON(configPath, existing, { spaces: 2 });
        return { updated: true, path: configPath, apiKey: generatedApiKey };
      } catch (err) {
        console.warn(`Warning: Could not update rdio-scanner config, recreating: ${err.message}`);
        await fs.writeJSON(configPath, config, { spaces: 2 });
        return { recreated: true, path: configPath, apiKey: generatedApiKey };
      }
    }

    return { exists: true, path: configPath, apiKey: generatedApiKey };
  }

  /**
   * Configure OP25
   * @param {boolean} enabled - Whether OP25 is enabled
   * @param {string} installationType - 'docker' or 'local'
   * @param {string} apiKey - Optional pre-generated API key. If not provided, will generate one.
   * @returns {Promise<Object>} Configuration result with apiKey if generated
   */
  async configureOP25(enabled, installationType = 'docker', apiKey = null) {
    if (!enabled) return null;

    const configDir = path.join(this.appdataPath, 'op25', 'config');
    const configPath = path.join(configDir, 'config.json');
    
    await fs.ensureDir(configDir);

    // Generate API key if not provided
    const generatedApiKey = apiKey || this.generateApiKey();

    // Determine upload URL based on installation type
    const uploadUrl = installationType === 'docker'
      ? 'http://scanner-map:3306/api/call-upload'
      : 'http://localhost:3306/api/call-upload';

    // OP25 typically uses a JSON config with upload server settings
    const config = {
      uploadServer: {
        url: uploadUrl,
        apiKey: generatedApiKey,
        type: 'rdio-scanner'
      }
    };

    // Always ensure config exists and is valid
    let shouldCreate = false;
    let shouldUpdate = false;
    
    if (!(await fs.pathExists(configPath))) {
      shouldCreate = true;
    } else {
      try {
        const fileContent = await fs.readFile(configPath, 'utf8');
        if (!fileContent || fileContent.trim().length === 0) {
          shouldCreate = true;
        } else {
          const existing = await fs.readJSON(configPath);
          // Check if uploadServer needs update
          if (!existing.uploadServer) {
            shouldUpdate = true;
          } else if (existing.uploadServer.url !== uploadUrl || existing.uploadServer.apiKey !== generatedApiKey) {
            shouldUpdate = true;
          }
        }
      } catch (err) {
        console.warn(`Warning: OP25 config is invalid, recreating: ${err.message}`);
        shouldCreate = true;
      }
    }

    if (shouldCreate) {
      await fs.writeJSON(configPath, config, { spaces: 2 });
      return { created: true, path: configPath, apiKey: generatedApiKey };
    }

    if (shouldUpdate) {
      try {
        const existing = await fs.readJSON(configPath);
        if (!existing.uploadServer) {
          existing.uploadServer = {};
        }
        existing.uploadServer.url = uploadUrl;
        existing.uploadServer.apiKey = generatedApiKey;
        existing.uploadServer.type = 'rdio-scanner';
        await fs.writeJSON(configPath, existing, { spaces: 2 });
        return { updated: true, path: configPath, apiKey: generatedApiKey };
      } catch (err) {
        console.warn(`Warning: Could not update OP25 config, recreating: ${err.message}`);
        await fs.writeJSON(configPath, config, { spaces: 2 });
        return { recreated: true, path: configPath, apiKey: generatedApiKey };
      }
    }

    return { exists: true, path: configPath, apiKey: generatedApiKey };
  }

  /**
   * Create appdata directory structure
   * Ensures all required directories exist for all services
   */
  async createAppdataStructure() {
    const directories = [
      // Scanner Map core directories
      'scanner-map/data',
      'scanner-map/audio',
      'scanner-map/logs',
      
      // Ollama directories (for model storage)
      'ollama',
      
      // iCAD Transcribe directories
      'icad-transcribe',
      'icad-transcribe/log',
      'icad-transcribe/var',
      'icad-transcribe/models',  // For persistent model storage
      
      // TrunkRecorder directories
      'trunk-recorder/config',
      'trunk-recorder/recordings',
      
      // SDRTrunk directories
      'sdrtrunk/config',
      
      // rdio-scanner directories
      'rdio-scanner/config',
      
      // OP25 directories
      'op25/config'
    ];

    for (const dir of directories) {
      await fs.ensureDir(path.join(this.appdataPath, dir));
    }

    return { created: true };
  }

  /**
   * Get service configuration summary
   */
  async getServiceSummary() {
    const summary = {
      trunkRecorder: {
        enabled: await fs.pathExists(path.join(this.appdataPath, 'trunk-recorder', 'config', 'config.json')),
        configPath: path.join(this.appdataPath, 'trunk-recorder', 'config', 'config.json')
      },
      icad: {
        enabled: await fs.pathExists(path.join(this.appdataPath, 'icad-transcribe', '.env')),
        envPath: path.join(this.appdataPath, 'icad-transcribe', '.env')
      },
      ollama: {
        enabled: await fs.pathExists(path.join(this.appdataPath, 'ollama'))
      }
    };

    return summary;
  }
}

module.exports = ServiceConfig;
