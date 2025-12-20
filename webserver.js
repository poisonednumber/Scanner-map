// webserver.js - Web interface for viewing and managing calls with optional authentication

// Load environment variables from .env file
// Use explicit path to ensure it works in Docker and local environments
const path = require('path');
const result = require('dotenv').config({ path: path.join(__dirname, '.env') });

if (result.error) {
  // Only warn if file doesn't exist (may be intentional in some setups)
  // Error will be caught later when validating required variables
  console.warn('[Webserver] Warning: Could not load .env file:', result.error.message);
  console.warn('[Webserver] Continuing with environment variables from system/container...');
}
const AWS = require('aws-sdk'); // Add AWS SDK

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs-extra');
const os = require('os');
const { execSync } = require('child_process');
const Busboy = require('busboy');
const csv = require('csv-parser');
const logsDir = path.join(__dirname, 'logs');
fs.ensureDirSync(logsDir);

// Environment variables
const {
  WEBSERVER_PORT,
  WEBSERVER_PASSWORD,
  PUBLIC_DOMAIN,
  TIMEZONE,
  ENABLE_AUTH, // New environment variable for toggling authentication
  SESSION_DURATION_DAYS = "7", // Default 7 days if not specified
  MAX_SESSIONS_PER_USER = "5", // Default 5 sessions if not specified
  GOOGLE_MAPS_API_KEY = null,
  // --- NEW: Geocoding API Keys ---
  LOCATIONIQ_API_KEY = null,
  // --- NEW: Storage Env Vars ---
  STORAGE_MODE = 'local', // Default to local if not set
  S3_ENDPOINT,
  S3_BUCKET_NAME,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  // --- NEW: AI Provider Env Vars ---
  AI_PROVIDER = 'ollama', // Can be 'ollama' or 'openai'
  OPENAI_API_KEY,
  OPENAI_MODEL = 'gpt-4o-mini', // A good, fast, and cheap model for this task
  OLLAMA_URL = 'http://localhost:11434',
  OLLAMA_MODEL = 'llama3.1:8b',
  // --- Transcription Env Vars ---
  TRANSCRIPTION_MODE = 'local',
  ICAD_URL = '',
  ICAD_API_KEY = '',
  // --- Bot Port ---
  BOT_PORT
} = process.env;

// Debug mode flag for verbose logging
const DEBUG_WEBSERVER = process.env.DEBUG_WEBSERVER === 'true' || process.env.DEBUG_ENV === 'true';

// Log environment variable status (for debugging)
if (DEBUG_WEBSERVER) {
  console.log('[Webserver] Environment variable check:');
  console.log(`[Webserver]   WEBSERVER_PORT: ${WEBSERVER_PORT ? `"${WEBSERVER_PORT}" (${typeof WEBSERVER_PORT})` : 'MISSING/UNDEFINED'}`);
  console.log(`[Webserver]   PUBLIC_DOMAIN: ${PUBLIC_DOMAIN ? `"${PUBLIC_DOMAIN}" (${typeof PUBLIC_DOMAIN})` : 'MISSING/UNDEFINED'}`);
  console.log(`[Webserver]   GEOCODING_PROVIDER: ${process.env.GEOCODING_PROVIDER ? `"${process.env.GEOCODING_PROVIDER}"` : 'MISSING/UNDEFINED'}`);
  console.log(`[Webserver]   GOOGLE_MAPS_API_KEY: ${GOOGLE_MAPS_API_KEY ? 'SET (hidden)' : 'NOT SET'}`);
  console.log(`[Webserver]   LOCATIONIQ_API_KEY: ${LOCATIONIQ_API_KEY ? 'SET (hidden)' : 'NOT SET'}`);
}

// Validate required environment variables
// Check for missing or empty string values
const requiredVars = ['WEBSERVER_PORT', 'PUBLIC_DOMAIN'];
const missingVars = requiredVars.filter(varName => {
  const value = process.env[varName];
  return !value || (typeof value === 'string' && value.trim() === '');
});

if (missingVars.length > 0) {
  console.error(`[Webserver] ERROR: Missing or empty required environment variables: ${missingVars.join(', ')}`);
  console.error(`[Webserver] Please check your .env file and ensure these variables are set with non-empty values.`);
  console.error(`[Webserver] For Docker installations, ensure .env file is mounted correctly.`);
  process.exit(1);
}

// Validate WEBSERVER_PORT is a valid number
const portNum = parseInt(WEBSERVER_PORT, 10);
if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
  console.error(`[Webserver] ERROR: WEBSERVER_PORT must be a valid port number (1-65535), got: "${WEBSERVER_PORT}"`);
  process.exit(1);
}

// Auto-configure service URLs on startup (async, non-blocking)
// This ensures services work correctly in Docker-to-Docker, Local-to-Docker, and Local-to-Local scenarios
setTimeout(() => {
  autoConfigureServiceUrls().catch(err => {
    console.warn('[Webserver] Service URL auto-configuration failed:', err.message);
  });
}, 2000); // Wait 2 seconds for services to be ready

// Check for geocoding service (Nominatim doesn't need API key)
const GEOCODING_PROVIDER = process.env.GEOCODING_PROVIDER || '';
// Handle case-insensitive comparison and empty strings
const geoProviderLower = GEOCODING_PROVIDER.toLowerCase().trim();
// Allow any provider to be set - geocoding.js will handle fallback to nominatim if API keys are missing
const hasGeocoding = geoProviderLower === 'nominatim' || 
                    geoProviderLower === 'locationiq' ||
                    geoProviderLower === 'google' ||
                    (GOOGLE_MAPS_API_KEY && typeof GOOGLE_MAPS_API_KEY === 'string' && GOOGLE_MAPS_API_KEY.trim() !== '') || 
                    (LOCATIONIQ_API_KEY && typeof LOCATIONIQ_API_KEY === 'string' && LOCATIONIQ_API_KEY.trim() !== '');

if (!hasGeocoding) {
  console.warn('[Webserver] WARNING: Geocoding service not configured.');
  console.warn('[Webserver] Defaulting to Nominatim (free, no API key required).');
  console.warn('[Webserver] To use a different provider, set one of the following:');
  console.warn('[Webserver]   - GEOCODING_PROVIDER=nominatim (free, recommended for testing)');
  console.warn('[Webserver]   - GEOCODING_PROVIDER=locationiq (requires LOCATIONIQ_API_KEY)');
  console.warn('[Webserver]   - GEOCODING_PROVIDER=google (requires GOOGLE_MAPS_API_KEY)');
  console.warn(`[Webserver] Current GEOCODING_PROVIDER value: "${GEOCODING_PROVIDER}"`);
  // Don't exit - just use nominatim as default
  // geocoding.js will handle the actual provider selection and fallback logic
}

// Log geocoding API availability
if (GOOGLE_MAPS_API_KEY) {
  console.log('[Webserver] Google Maps API key found - Google Places autocomplete will be available');
} else {
  console.log('[Webserver] Google Maps API key not found - Google Places autocomplete will be disabled');
}

if (LOCATIONIQ_API_KEY) {
  console.log('[Webserver] LocationIQ API key found - LocationIQ autocomplete will be available');
} else {
  console.log('[Webserver] LocationIQ API key not found - LocationIQ autocomplete will be disabled');
}

// Add endpoint to serve Google API key
const app = express();
app.use(express.json()); // Add this line to parse JSON bodies

app.get('/api/config/google-api-key', (req, res) => {
  res.json({ apiKey: GOOGLE_MAPS_API_KEY });
});

// Add endpoint to serve LocationIQ API key
app.get('/api/config/locationiq-api-key', (req, res) => {
  res.json({ apiKey: LOCATIONIQ_API_KEY });
});

// Add endpoint to serve all geocoding configuration
app.get('/api/config/geocoding', (req, res) => {
  res.json({
    google: {
      available: !!GOOGLE_MAPS_API_KEY,
      apiKey: GOOGLE_MAPS_API_KEY
    },
    locationiq: {
      available: !!LOCATIONIQ_API_KEY,
      apiKey: LOCATIONIQ_API_KEY
    }
  });
});

// Add endpoints for Ollama and iCAD configuration
app.get('/api/config/services', (req, res) => {
  res.json({
    ollama: {
      url: OLLAMA_URL || 'http://localhost:11434',
      model: OLLAMA_MODEL || 'llama3.1:8b',
      enabled: AI_PROVIDER === 'ollama'
    },
    icad: {
      url: ICAD_URL || '',
      enabled: TRANSCRIPTION_MODE === 'icad'
    }
  });
});

// Update service URLs (writes to .env file)
app.post('/api/config/services', async (req, res) => {
  const { ollama, icad } = req.body;
  const envPath = path.join(__dirname, '.env');
  
  try {
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Update or add Ollama URL
    if (ollama && ollama.url !== undefined) {
      const urlValue = ollama.url || '';
      if (envContent.includes('OLLAMA_URL=')) {
        envContent = envContent.replace(/OLLAMA_URL=.*/g, `OLLAMA_URL=${urlValue}`);
      } else {
        envContent += `\nOLLAMA_URL=${urlValue}\n`;
      }
    }
    
    // Update or add iCAD URL
    if (icad && icad.url !== undefined) {
      const urlValue = icad.url || '';
      if (envContent.includes('ICAD_URL=')) {
        envContent = envContent.replace(/ICAD_URL=.*/g, `ICAD_URL=${urlValue}`);
      } else {
        envContent += `\nICAD_URL=${urlValue}\n`;
      }
    }
    
    fs.writeFileSync(envPath, envContent, 'utf8');
    res.json({ success: true, message: 'Configuration updated. Restart services for changes to take effect.' });
  } catch (error) {
    console.error('Error updating service config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Settings API Endpoints
// Get all settings
app.get('/api/settings', (req, res) => {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:219',message:'GET /api/settings called',data:{webserverPort:WEBSERVER_PORT,authEnabled:process.env.ENABLE_AUTH === 'true' || process.env.AUTH_ENABLED === 'true'},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-verify',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  try {
    const settings = {
      // General - Read from process.env to get latest values (may have been updated without restart)
      webserverPort: (() => {
        const val = process.env.WEBSERVER_PORT || WEBSERVER_PORT;
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:226',message:'GET webserverPort',data:{processEnv:process.env.WEBSERVER_PORT,constant:WEBSERVER_PORT,result:val},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-verify',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        return val;
      })(),
      botPort: process.env.BOT_PORT || BOT_PORT || '',
      publicDomain: (() => {
        // Always read from process.env first (may have been updated), then fallback to constant
        const val = process.env.PUBLIC_DOMAIN !== undefined ? process.env.PUBLIC_DOMAIN : PUBLIC_DOMAIN;
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:234',message:'GET publicDomain',data:{processEnv:process.env.PUBLIC_DOMAIN,constant:PUBLIC_DOMAIN,result:val,isUndefined:process.env.PUBLIC_DOMAIN===undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-verify',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        return val;
      })(),
      timezone: (() => {
        // Always read from process.env first (may have been updated), then fallback to constant, then default
        const tz = process.env.TIMEZONE !== undefined ? process.env.TIMEZONE : (TIMEZONE || 'America/New_York');
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:229',message:'GET timezone value',data:{timezone:tz,processEnvTimeZone:process.env.TIMEZONE,constant:TIMEZONE,isUndefined:process.env.TIMEZONE===undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-verify',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        return tz;
      })(),
      authEnabled: process.env.ENABLE_AUTH === 'true' || process.env.AUTH_ENABLED === 'true',
      
      // Map
      mapCenter: {
        lat: parseFloat(process.env.MAP_CENTER_LAT || '39.078925'),
        lng: parseFloat(process.env.MAP_CENTER_LNG || '-76.933018')
      },
      mapZoom: parseInt(process.env.MAP_ZOOM || '13'),
      defaultTimeRange: parseInt(process.env.DEFAULT_TIME_RANGE || '12'),
      trackNewCalls: process.env.TRACK_NEW_CALLS !== 'false',
      
      // Audio
      globalVolume: parseFloat(process.env.GLOBAL_VOLUME || '0.5'),
      muteNewCalls: process.env.MUTE_NEW_CALLS === 'true',
      autoplayEnabled: process.env.AUTOPLAY_ENABLED === 'true',
      
      // Geocoding - Read from process.env to get latest values
      geocodingProvider: (() => {
        // Always read from process.env first (may have been updated), then fallback to constant, then default
        const val = process.env.GEOCODING_PROVIDER !== undefined ? process.env.GEOCODING_PROVIDER : (GEOCODING_PROVIDER || 'nominatim');
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:266',message:'GET geocodingProvider',data:{processEnv:process.env.GEOCODING_PROVIDER,constant:GEOCODING_PROVIDER,result:val,isUndefined:process.env.GEOCODING_PROVIDER===undefined},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-verify',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        return val;
      })(),
      geocodingCity: process.env.GEOCODING_CITY || '',
      geocodingState: process.env.GEOCODING_STATE || '',
      geocodingCountry: process.env.GEOCODING_COUNTRY || 'us',
      geocodingCounties: process.env.GEOCODING_TARGET_COUNTIES || process.env.GEOCODING_COUNTIES || '',
      
      // Transcription - Read from process.env to get latest values
      transcriptionMode: process.env.TRANSCRIPTION_MODE !== undefined ? process.env.TRANSCRIPTION_MODE : (TRANSCRIPTION_MODE || 'local'),
      transcriptionEnabled: true, // Always enabled, but mode can vary
      icadUrl: (process.env.TRANSCRIPTION_MODE || TRANSCRIPTION_MODE) === 'icad' ? (process.env.ICAD_URL || 'http://localhost:9912') : '',
      icadPort: (() => {
        const mode = process.env.TRANSCRIPTION_MODE || TRANSCRIPTION_MODE;
        if (mode !== 'icad') return '9912';
        const url = process.env.ICAD_URL || 'http://localhost:9912';
        const match = url.match(/:(\d+)/);
        return match ? match[1] : '9912';
      })(),
      icadWebUI: (process.env.TRANSCRIPTION_MODE || TRANSCRIPTION_MODE) === 'icad' ? (process.env.ICAD_URL || 'http://localhost:9912') : null,
      fasterWhisperUrl: (process.env.TRANSCRIPTION_MODE || TRANSCRIPTION_MODE) === 'faster-whisper' ? (process.env.FASTER_WHISPER_URL || 'http://localhost:8000') : '',
      fasterWhisperPort: (() => {
        const mode = process.env.TRANSCRIPTION_MODE || TRANSCRIPTION_MODE;
        if (mode !== 'faster-whisper') return '8000';
        const url = process.env.FASTER_WHISPER_URL || 'http://localhost:8000';
        const match = url.match(/:(\d+)/);
        return match ? match[1] : '8000';
      })(),
      
      // AI - Read from process.env to get latest values
      aiProvider: process.env.AI_PROVIDER !== undefined ? process.env.AI_PROVIDER : (AI_PROVIDER || 'ollama'),
      aiEnabled: true, // Always enabled, but provider can vary
      ollamaUrl: (process.env.AI_PROVIDER || AI_PROVIDER) === 'ollama' ? (process.env.OLLAMA_URL || OLLAMA_URL || 'http://localhost:11434') : '',
      ollamaPort: (() => {
        const provider = process.env.AI_PROVIDER || AI_PROVIDER;
        if (provider !== 'ollama') return '11434';
        const url = process.env.OLLAMA_URL || OLLAMA_URL || 'http://localhost:11434';
        const match = url.match(/:(\d+)/);
        return match ? match[1] : '11434';
      })(),
      ollamaModel: ((process.env.AI_PROVIDER !== undefined ? process.env.AI_PROVIDER : AI_PROVIDER) || 'ollama') === 'ollama' ? (process.env.OLLAMA_MODEL !== undefined ? process.env.OLLAMA_MODEL : 'llama3.1:8b') : '',
      openaiModel: (process.env.AI_PROVIDER || AI_PROVIDER) === 'openai' ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : '',
      
      // Discord
      discordEnabled: process.env.DISCORD_ENABLED === 'true',
      discordChannel: process.env.DISCORD_CHANNEL_ID || '',
      discordAISummaries: process.env.DISCORD_AI_SUMMARIES === 'true',
      
      // Storage - Read from process.env to get latest values
      storageMode: process.env.STORAGE_MODE || STORAGE_MODE || 'local',
      s3Endpoint: process.env.S3_ENDPOINT || '',
      s3Bucket: process.env.S3_BUCKET_NAME || process.env.S3_BUCKET || '',
      s3Region: process.env.S3_REGION || '',
      
      // Display - Read from process.env to get latest values
      heatmapIntensity: parseInt(process.env.HEATMAP_INTENSITY || '5'),
      heatmapEnabled: process.env.HEATMAP_ENABLED === 'true',
      maxMarkers: parseInt(process.env.MAX_MARKERS || '1000'),
      clusterMarkers: process.env.CLUSTER_MARKERS !== 'false'
    };
    
    res.json({ success: true, settings });
  } catch (error) {
    console.error('Error loading settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Save settings
app.post('/api/settings', async (req, res) => {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:308',message:'POST /api/settings called',data:{category:req.body.category,settingsKeys:Object.keys(req.body.settings || {})},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-verify',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  try {
    const { category, settings } = req.body;
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';
    
    // Read existing .env file
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Update settings based on category
    const updates = [];
    if (category === 'general') {
      if (settings.webserverPort) updates.push({ key: 'WEBSERVER_PORT', value: settings.webserverPort });
      if (settings.botPort) updates.push({ key: 'BOT_PORT', value: settings.botPort });
      if (settings.publicDomain) updates.push({ key: 'PUBLIC_DOMAIN', value: settings.publicDomain });
      if (settings.timezone) {
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:334',message:'Timezone setting received',data:{timezone:settings.timezone,currentProcessEnv:process.env.TIMEZONE},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-verify',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        updates.push({ key: 'TIMEZONE', value: settings.timezone });
      }
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:326',message:'General settings processed',data:{authEnabled:settings.authEnabled,currentProcessEnv:process.env.ENABLE_AUTH},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-verify',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      updates.push({ key: 'ENABLE_AUTH', value: settings.authEnabled ? 'true' : 'false' });
    } else if (category === 'map') {
      if (settings.mapCenter) {
        updates.push({ key: 'MAP_CENTER_LAT', value: settings.mapCenter.lat });
        updates.push({ key: 'MAP_CENTER_LNG', value: settings.mapCenter.lng });
      }
      if (settings.mapZoom) updates.push({ key: 'MAP_ZOOM', value: settings.mapZoom });
      if (settings.defaultTimeRange) updates.push({ key: 'DEFAULT_TIME_RANGE', value: settings.defaultTimeRange });
      updates.push({ key: 'TRACK_NEW_CALLS', value: settings.trackNewCalls ? 'true' : 'false' });
    } else if (category === 'audio') {
      if (settings.globalVolume !== undefined) updates.push({ key: 'GLOBAL_VOLUME', value: settings.globalVolume });
      updates.push({ key: 'MUTE_NEW_CALLS', value: settings.muteNewCalls ? 'true' : 'false' });
      updates.push({ key: 'AUTOPLAY_ENABLED', value: settings.autoplayEnabled ? 'true' : 'false' });
    } else if (category === 'geocoding') {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:348',message:'Geocoding settings processed',data:{provider:settings.geocodingProvider,city:settings.geocodingCity,counties:settings.geocodingCounties},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-verify',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      if (settings.geocodingProvider) updates.push({ key: 'GEOCODING_PROVIDER', value: settings.geocodingProvider });
      if (settings.geocodingCity) updates.push({ key: 'GEOCODING_CITY', value: settings.geocodingCity });
      if (settings.geocodingState) updates.push({ key: 'GEOCODING_STATE', value: settings.geocodingState });
      if (settings.geocodingCountry) updates.push({ key: 'GEOCODING_COUNTRY', value: settings.geocodingCountry });
      if (settings.geocodingCounties) updates.push({ key: 'GEOCODING_TARGET_COUNTIES', value: settings.geocodingCounties });
    } else if (category === 'transcription') {
      if (settings.transcriptionMode) {
        const currentMode = process.env.TRANSCRIPTION_MODE || 'local';
        updates.push({ key: 'TRANSCRIPTION_MODE', value: settings.transcriptionMode });
        // Clear other transcription mode settings when switching
        if (settings.transcriptionMode !== currentMode) {
          if (settings.transcriptionMode !== 'icad') {
            updates.push({ key: 'ICAD_URL', value: '' });
            updates.push({ key: 'ICAD_API_KEY', value: '' });
          }
          if (settings.transcriptionMode !== 'faster-whisper') {
            updates.push({ key: 'FASTER_WHISPER_URL', value: '' });
          }
        }
      }
      // Only save settings for the selected mode
      if (settings.transcriptionMode === 'icad') {
        // Auto-detect iCAD URL if not provided or using default
        let icadUrl = settings.icadUrl;
        if (!icadUrl || icadUrl === '' || icadUrl.includes('localhost') || icadUrl.includes('icad-transcribe:')) {
          icadUrl = await detectServiceUrl('icad-transcribe', 9912, icadUrl);
        }
        if (icadUrl) updates.push({ key: 'ICAD_URL', value: icadUrl });
        if (settings.icadApiKey) updates.push({ key: 'ICAD_API_KEY', value: settings.icadApiKey });
      } else if (settings.transcriptionMode === 'faster-whisper') {
        if (settings.fasterWhisperUrl !== undefined) updates.push({ key: 'FASTER_WHISPER_URL', value: settings.fasterWhisperUrl });
      }
    } else if (category === 'ai') {
      if (settings.aiProvider) {
        const currentProvider = process.env.AI_PROVIDER || 'ollama';
        updates.push({ key: 'AI_PROVIDER', value: settings.aiProvider });
        // Clear settings for disabled provider when switching
        if (settings.aiProvider !== currentProvider) {
          if (settings.aiProvider !== 'ollama') {
            updates.push({ key: 'OLLAMA_URL', value: '' });
            updates.push({ key: 'OLLAMA_MODEL', value: '' });
          }
        }
      }
      // Only save settings for the selected provider
      if (settings.aiProvider === 'ollama') {
        // Auto-detect Ollama URL if not provided or using default
        let ollamaUrl = settings.ollamaUrl;
        if (!ollamaUrl || ollamaUrl === '' || ollamaUrl.includes('localhost') || ollamaUrl.includes('ollama:')) {
          ollamaUrl = await detectServiceUrl('ollama', 11434, ollamaUrl);
        }
        if (ollamaUrl) updates.push({ key: 'OLLAMA_URL', value: ollamaUrl });
        if (settings.ollamaModel) updates.push({ key: 'OLLAMA_MODEL', value: settings.ollamaModel });
      } else if (settings.aiProvider === 'openai') {
        if (settings.openaiModel) updates.push({ key: 'OPENAI_MODEL', value: settings.openaiModel });
        if (settings.openaiApiKey) updates.push({ key: 'OPENAI_API_KEY', value: settings.openaiApiKey });
      }
    } else if (category === 'services') {
      // Services settings (Ollama, iCAD URLs and models)
      if (settings.ollamaUrl) {
        let ollamaUrl = settings.ollamaUrl;
        if (!ollamaUrl || ollamaUrl === '' || ollamaUrl.includes('localhost') || ollamaUrl.includes('ollama:')) {
          ollamaUrl = await detectServiceUrl('ollama', 11434, ollamaUrl);
        }
        if (ollamaUrl) updates.push({ key: 'OLLAMA_URL', value: ollamaUrl });
      }
      if (settings.ollamaModel) updates.push({ key: 'OLLAMA_MODEL', value: settings.ollamaModel });
      if (settings.icadUrl) {
        let icadUrl = settings.icadUrl;
        if (!icadUrl || icadUrl === '' || icadUrl.includes('localhost') || icadUrl.includes('icad-transcribe:')) {
          icadUrl = await detectServiceUrl('icad-transcribe', 9912, icadUrl);
        }
        if (icadUrl) updates.push({ key: 'ICAD_URL', value: icadUrl });
      }
      if (settings.icadApiKey) updates.push({ key: 'ICAD_API_KEY', value: settings.icadApiKey });
    } else if (category === 'discord') {
      updates.push({ key: 'DISCORD_ENABLED', value: settings.discordEnabled ? 'true' : 'false' });
      if (settings.discordChannel) updates.push({ key: 'DISCORD_CHANNEL_ID', value: settings.discordChannel });
      updates.push({ key: 'DISCORD_AI_SUMMARIES', value: settings.discordAISummaries ? 'true' : 'false' });
      if (settings.discordToken) updates.push({ key: 'DISCORD_TOKEN', value: settings.discordToken });
    } else if (category === 'storage') {
      if (settings.storageMode) updates.push({ key: 'STORAGE_MODE', value: settings.storageMode });
      if (settings.s3Endpoint !== undefined) updates.push({ key: 'S3_ENDPOINT', value: settings.s3Endpoint });
      if (settings.s3Bucket !== undefined) updates.push({ key: 'S3_BUCKET_NAME', value: settings.s3Bucket });
      if (settings.s3Region !== undefined) updates.push({ key: 'S3_REGION', value: settings.s3Region });
      if (settings.s3AccessKey) updates.push({ key: 'S3_ACCESS_KEY_ID', value: settings.s3AccessKey });
      if (settings.s3SecretKey) updates.push({ key: 'S3_SECRET_ACCESS_KEY', value: settings.s3SecretKey });
    } else if (category === 'display') {
      if (settings.heatmapIntensity) updates.push({ key: 'HEATMAP_INTENSITY', value: settings.heatmapIntensity });
      updates.push({ key: 'HEATMAP_ENABLED', value: settings.heatmapEnabled ? 'true' : 'false' });
      if (settings.maxMarkers) updates.push({ key: 'MAX_MARKERS', value: settings.maxMarkers });
      updates.push({ key: 'CLUSTER_MARKERS', value: settings.clusterMarkers ? 'true' : 'false' });
    } else if (category === 'api-keys') {
      if (settings.googleMapsKey) updates.push({ key: 'GOOGLE_MAPS_API_KEY', value: settings.googleMapsKey });
      if (settings.locationiqKey) updates.push({ key: 'LOCATIONIQ_API_KEY', value: settings.locationiqKey });
    }
    
    // Update .env file
    updates.forEach(({ key, value }) => {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const beforeValue = process.env[key];
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}=${value}`);
      } else {
        envContent += `\n${key}=${value}`;
      }
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:420',message:'Updating env var in .env file',data:{key,newValue:value,oldProcessEnv:beforeValue},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-verify',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      // Update process.env immediately for settings that should take effect without restart
      // Note: Some settings like ports require restart to actually change behavior
      const immediateUpdateKeys = [
        'GEOCODING_PROVIDER', 'GEOCODING_CITY', 'GEOCODING_STATE', 'GEOCODING_COUNTRY', 
        'GEOCODING_TARGET_COUNTIES', 'GEOCODING_COUNTIES', 'ENABLE_AUTH', 'AUTH_ENABLED', 
        'TIMEZONE', 'PUBLIC_DOMAIN', 'WEBSERVER_PORT', 'BOT_PORT', 'AI_PROVIDER', 
        'TRANSCRIPTION_MODE', 'OLLAMA_URL', 'OLLAMA_MODEL', 'OPENAI_MODEL', 'ICAD_URL', 
        'ICAD_API_KEY', 'FASTER_WHISPER_URL', 'STORAGE_MODE', 'DISCORD_ENABLED', 
        'DISCORD_CHANNEL_ID', 'DISCORD_AI_SUMMARIES', 'DISCORD_TOKEN', 'S3_ENDPOINT',
        'S3_BUCKET_NAME', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY',
        'HEATMAP_INTENSITY', 'HEATMAP_ENABLED', 'MAX_MARKERS', 'CLUSTER_MARKERS'
      ];
      if (immediateUpdateKeys.includes(key)) {
        const oldValue = process.env[key];
        // Ensure value is a string (process.env values must be strings)
        const stringValue = String(value);
        process.env[key] = stringValue;
        console.log(`[Settings] Updated process.env[${key}] = "${stringValue}" (was: "${oldValue}")`);
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:512',message:'Updated process.env immediately',data:{key,oldValue,newValue:stringValue,wasInList:true,afterUpdate:process.env[key]},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-verify',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
      } else {
        console.log(`[Settings] Key "${key}" NOT in immediateUpdateKeys list`);
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:519',message:'Key NOT in immediateUpdateKeys',data:{key,value,immediateUpdateKeys:immediateUpdateKeys.slice(0,5)},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-verify',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
      }
    });
    
    fs.writeFileSync(envPath, envContent);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:429',message:'Settings saved to .env file',data:{category,updatesCount:updates.length,updates:updates.map(u=>u.key)},timestamp:Date.now(),sessionId:'debug-session',runId:'settings-verify',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    res.json({ success: true, message: `${category} settings saved. Restart required for some changes.` });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get API keys (masked)
app.get('/api/settings/api-keys', (req, res) => {
  try {
    const keys = {
      'Google Maps': GOOGLE_MAPS_API_KEY || null,
      'LocationIQ': LOCATIONIQ_API_KEY || null,
      'OpenAI': OPENAI_API_KEY || null,
      'Discord': process.env.DISCORD_TOKEN || null
    };
    
    res.json({ success: true, keys });
  } catch (error) {
    console.error('Error loading API keys:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Location Configuration API Endpoints
// Get current location configuration
app.get('/api/location/config', (req, res) => {
  try {
    res.json({
      city: process.env.GEOCODING_CITY || '',
      state: process.env.GEOCODING_STATE || '',
      country: process.env.GEOCODING_COUNTRY || '',
      targetCounties: process.env.GEOCODING_TARGET_COUNTIES || ''
    });
  } catch (error) {
    console.error('Error reading location config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update location configuration
app.post('/api/location/config', async (req, res) => {
  const { city, state, country, targetCounties } = req.body;
  const envPath = path.join(__dirname, '.env');
  
  try {
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Helper function to update or add env variable
    const updateEnvVar = (varName, value) => {
      const regex = new RegExp(`^${varName}=.*$`, 'm');
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${varName}=${value}`);
      } else {
        envContent += `\n${varName}=${value}\n`;
      }
    };
    
    if (city !== undefined) updateEnvVar('GEOCODING_CITY', city);
    if (state !== undefined) updateEnvVar('GEOCODING_STATE', state);
    if (country !== undefined) updateEnvVar('GEOCODING_COUNTRY', country);
    if (targetCounties !== undefined) updateEnvVar('GEOCODING_TARGET_COUNTIES', targetCounties);
    
    fs.writeFileSync(envPath, envContent, 'utf8');
    
    // Update process.env so changes take effect immediately (until restart)
    if (city !== undefined) process.env.GEOCODING_CITY = city;
    if (state !== undefined) process.env.GEOCODING_STATE = state;
    if (country !== undefined) process.env.GEOCODING_COUNTRY = country;
    if (targetCounties !== undefined) process.env.GEOCODING_TARGET_COUNTIES = targetCounties;
    
    res.json({ success: true, message: 'Location configuration updated. Some changes may require a restart.' });
  } catch (error) {
    console.error('Error updating location config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get location suggestions within radius (requires lat/lon)
app.get('/api/location/suggestions', async (req, res) => {
  const { lat, lon, radius = 50 } = req.query;
  
  if (!lat || !lon) {
    return res.status(400).json({ success: false, error: 'lat and lon query parameters are required' });
  }
  
  try {
    // Use Nominatim reverse geocoding to get location details
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`;
    const response = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'Scanner-Map/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Get nearby cities/towns within radius using Nominatim search
    // Note: Nominatim doesn't have a direct radius search, so we'll return the current location details
    // For a full implementation, you could use a geospatial search service
    const result = {
      currentLocation: {
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        address: data.address || {},
        displayName: data.display_name || ''
      },
      suggestions: [{
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        city: data.address?.city || data.address?.town || data.address?.village || '',
        state: data.address?.state || '',
        country: data.address?.country_code?.toUpperCase() || '',
        displayName: data.display_name || ''
      }]
    };
    
    res.json(result);
  } catch (error) {
    console.error('Error getting location suggestions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get counties for a given city/state
app.get('/api/location/counties', async (req, res) => {
  const { city, state, country = 'us' } = req.query;
  
  if (!city || !state) {
    return res.status(400).json({ success: false, error: 'city and state query parameters are required' });
  }
  
  try {
    // Use Nominatim to search for the city and get county information
    const searchQuery = `${city}, ${state}, ${country}`;
    const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`;
    
    const response = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'Scanner-Map/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    // Extract counties from results (counties are often in the display_name or address)
    const counties = new Set();
    data.forEach(result => {
      if (result.address?.county) {
        counties.add(result.address.county);
      }
    });
    
    res.json({ 
      counties: Array.from(counties),
      suggestions: data.map(r => ({
        displayName: r.display_name,
        lat: parseFloat(r.lat),
        lon: parseFloat(r.lon),
        county: r.address?.county || ''
      }))
    });
  } catch (error) {
    console.error('Error getting counties:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Detect location from browser geolocation (lat/lon)
app.post('/api/location/detect', async (req, res) => {
  const { lat, lon } = req.body;
  
  if (!lat || !lon) {
    return res.status(400).json({ success: false, error: 'lat and lon are required in request body' });
  }
  
  try {
    // Use Nominatim reverse geocoding
    const nominatimUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`;
    const response = await fetch(nominatimUrl, {
      headers: {
        'User-Agent': 'Scanner-Map/1.0'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Nominatim API error: ${response.status}`);
    }
    
    const data = await response.json();
    const address = data.address || {};
    
    res.json({
      success: true,
      location: {
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        city: address.city || address.town || address.village || '',
        state: address.state || '',
        country: address.country_code?.toUpperCase() || '',
        county: address.county || '',
        displayName: data.display_name || '',
        address: address
      }
    });
  } catch (error) {
    console.error('Error detecting location:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper function to check if running in Docker
function isRunningInDocker() {
  try {
    // Check for .dockerenv file
    if (fs.existsSync('/.dockerenv')) {
      return true;
    }
    // Check cgroup (Linux)
    if (fs.existsSync('/proc/self/cgroup')) {
      const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
      if (cgroup.includes('docker') || cgroup.includes('containerd')) {
        return true;
      }
    }
    // Check environment variables
    if (process.env.DOCKER_CONTAINER === 'true' || process.env.container === 'docker') {
      return true;
    }
    return false;
  } catch (err) {
    return false;
  }
}

/**
 * Detect service location and return appropriate URL
 * Handles: Docker-to-Docker, Local-to-Docker, Local-to-Local
 * @param {string} serviceName - 'ollama' or 'icad-transcribe'
 * @param {number} defaultPort - Default port (11434 for Ollama, 9912 for iCAD)
 * @param {string} currentUrl - Current configured URL (if any)
 * @returns {Promise<string>} Appropriate URL for the service
 */
async function detectServiceUrl(serviceName, defaultPort, currentUrl = null) {
  // If URL is explicitly provided and is remote, use it
  if (currentUrl && !currentUrl.includes('localhost') && !currentUrl.includes(serviceName + ':')) {
    return currentUrl;
  }
  
  const scannerMapInDocker = isRunningInDocker();
  
  // Check if service is running in Docker (same compose network)
  let serviceInDocker = false;
  if (scannerMapInDocker) {
    // We're in Docker, check if service container exists in same network
    try {
      const { execSync } = require('child_process');
      const os = require('os');
      // Try to resolve service name (works in Docker networks)
      if (os.platform() === 'win32') {
        // Windows: Try nslookup or ping
        try {
          execSync(`ping -n 1 ${serviceName}`, { 
            stdio: 'ignore',
            timeout: 2000
          });
          serviceInDocker = true;
        } catch (err) {
          // Try getent on WSL/Linux containers
          try {
            execSync(`getent hosts ${serviceName}`, { 
              stdio: 'ignore',
              timeout: 2000
            });
            serviceInDocker = true;
          } catch (err2) {
            serviceInDocker = false;
          }
        }
      } else {
        // Linux/Mac: Use getent
        try {
          execSync(`getent hosts ${serviceName}`, { 
            stdio: 'ignore',
            timeout: 2000
          });
          serviceInDocker = true;
        } catch (err) {
          serviceInDocker = false;
        }
      }
    } catch (err) {
      // Service not found in Docker network, might be local or different network
      serviceInDocker = false;
    }
  } else {
    // We're running locally, check if service is in Docker
    try {
      const { execSync } = require('child_process');
      // Check if Docker container exists and is running
      const containerName = execSync(`docker ps --filter "name=${serviceName}" --format "{{.Names}}"`, {
        stdio: 'pipe',
        timeout: 2000,
        encoding: 'utf8'
      }).trim();
      if (containerName && containerName.includes(serviceName)) {
        serviceInDocker = true;
      }
    } catch (err) {
      // Docker not available or container not running
      serviceInDocker = false;
    }
  }
  
  // Determine appropriate URL
  if (scannerMapInDocker && serviceInDocker) {
    // Docker-to-Docker: Use service name (Docker network DNS)
    return `http://${serviceName}:${defaultPort}`;
  } else if (!scannerMapInDocker && serviceInDocker) {
    // Local-to-Docker: Use localhost (Docker port mapping)
    return `http://localhost:${defaultPort}`;
  } else {
    // Local-to-Local or fallback: Use localhost
    return `http://localhost:${defaultPort}`;
  }
}

/**
 * Auto-configure service URLs based on detected environment
 * Updates .env file with appropriate URLs
 */
async function autoConfigureServiceUrls() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) {
      return; // No .env file to update
    }
    
    let envContent = fs.readFileSync(envPath, 'utf8');
    let updated = false;
    
    // Auto-configure Ollama URL if not set or using default
    if (process.env.AI_PROVIDER === 'ollama') {
      const currentOllamaUrl = process.env.OLLAMA_URL || '';
      if (!currentOllamaUrl || currentOllamaUrl.includes('localhost') || currentOllamaUrl.includes('ollama:')) {
        const detectedUrl = await detectServiceUrl('ollama', 11434, currentOllamaUrl);
        if (detectedUrl !== currentOllamaUrl) {
          envContent = envContent.replace(/^OLLAMA_URL=.*$/m, `OLLAMA_URL=${detectedUrl}`);
          if (!envContent.includes('OLLAMA_URL=')) {
            envContent += `\nOLLAMA_URL=${detectedUrl}\n`;
          }
          updated = true;
          process.env.OLLAMA_URL = detectedUrl;
        }
      }
    }
    
    // Auto-configure iCAD URL if not set or using default
    if (process.env.TRANSCRIPTION_MODE === 'icad') {
      const currentIcadUrl = process.env.ICAD_URL || '';
      if (!currentIcadUrl || currentIcadUrl.includes('localhost') || currentIcadUrl.includes('icad-transcribe:')) {
        const detectedUrl = await detectServiceUrl('icad-transcribe', 9912, currentIcadUrl);
        if (detectedUrl !== currentIcadUrl) {
          envContent = envContent.replace(/^ICAD_URL=.*$/m, `ICAD_URL=${detectedUrl}`);
          if (!envContent.includes('ICAD_URL=')) {
            envContent += `\nICAD_URL=${detectedUrl}\n`;
          }
          updated = true;
          process.env.ICAD_URL = detectedUrl;
        }
      }
    }
    
    if (updated) {
      fs.writeFileSync(envPath, envContent);
      console.log('[Webserver] Auto-configured service URLs based on detected environment');
    }
  } catch (error) {
    console.warn('[Webserver] Could not auto-configure service URLs:', error.message);
  }
}

// System Status API Endpoints
// Get system status (Docker, Node.js, Python availability)
app.get('/api/system/status', (req, res) => {
  try {
    const DependencyInstaller = require('./scripts/installer/dependency-installer');
    const dependencyInstaller = new DependencyInstaller();
    const runningInDocker = isRunningInDocker();
    
    const status = {
      docker: {
        installed: dependencyInstaller.isInstalled('docker'),
        dockerCompose: dependencyInstaller.isDockerComposeInstalled(),
        daemonRunning: dependencyInstaller.isDockerDaemonRunning(),
        // If running in Docker, we can't install Docker from inside the container
        canInstall: !runningInDocker
      },
      nodejs: {
        installed: dependencyInstaller.isNodeInstalled(),
        version: dependencyInstaller.isNodeInstalled() ? execSync('node --version', { encoding: 'utf8' }).trim() : null
      },
      npm: {
        installed: dependencyInstaller.isNpmInstalled(),
        version: dependencyInstaller.isNpmInstalled() ? execSync('npm --version', { encoding: 'utf8' }).trim() : null
      },
      python: {
        installed: dependencyInstaller.isPythonInstalled(),
        version: dependencyInstaller.isPythonInstalled() ? 
          (execSync('python3 --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || 
           execSync('python --version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) : null
      },
      runningInDocker: isRunningInDocker(),
      // Service status checks
      services: {
        ollama: {
          installed: false,
          running: false,
          url: null
        },
        fasterWhisper: {
          installed: false,
          running: false
        },
        icadTranscribe: {
          installed: false,
          running: false,
          url: null
        }
      }
    };
    
    // Check service status
    try {
      // Check Ollama
      try {
        const ollamaCheck = execSync('curl -s http://localhost:11434/api/tags || echo "not_running"', { 
          encoding: 'utf8', 
          timeout: 2000,
          stdio: ['ignore', 'pipe', 'ignore']
        });
        if (ollamaCheck && !ollamaCheck.includes('not_running')) {
          status.services.ollama.installed = true;
          status.services.ollama.running = true;
          status.services.ollama.url = 'http://localhost:11434';
        }
      } catch (err) {
        // Ollama not running locally
      }
      
      // Check iCAD Transcribe
      try {
        const icadCheck = execSync('curl -s http://localhost:9912/health || echo "not_running"', { 
          encoding: 'utf8', 
          timeout: 2000,
          stdio: ['ignore', 'pipe', 'ignore']
        });
        if (icadCheck && !icadCheck.includes('not_running')) {
          status.services.icadTranscribe.installed = true;
          status.services.icadTranscribe.running = true;
          status.services.icadTranscribe.url = 'http://localhost:9912';
        }
      } catch (err) {
        // iCAD not running locally
      }
      
      // Check faster-whisper (Python package)
      try {
        execSync('python3 -c "import faster_whisper" 2>/dev/null || python -c "import faster_whisper" 2>/dev/null', { 
          stdio: 'ignore',
          timeout: 2000
        });
        status.services.fasterWhisper.installed = true;
      } catch (err) {
        // faster-whisper not installed
      }
    } catch (err) {
      // Ignore service check errors
    }
    
    res.json({ success: true, status });
  } catch (error) {
    console.error('Error checking system status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get system information (OS, versions, platform)
app.get('/api/system/info', (req, res) => {
  try {
    const info = {
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname(),
      type: os.type(),
      release: os.release(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      nodeVersion: process.version,
      npmVersion: null
    };
    
    try {
      info.npmVersion = execSync('npm --version', { encoding: 'utf8' }).trim();
    } catch (err) {
      // npm not available
    }
    
    res.json({ success: true, info });
  } catch (error) {
    console.error('Error getting system info:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update Management API Endpoints
// Check for updates
app.get('/api/updates/check', async (req, res) => {
  try {
    const UpdateChecker = require('./scripts/installer/update-checker');
    const updateChecker = new UpdateChecker(__dirname);
    const result = await updateChecker.checkForUpdates();
    res.json(result);
  } catch (error) {
    console.error('Error checking for updates:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Install update (if possible via git pull)
app.post('/api/updates/install', async (req, res) => {
  try {
    // Check if we're in a git repository
    try {
      execSync('git rev-parse --git-dir', { cwd: __dirname, stdio: 'ignore' });
    } catch (gitErr) {
      return res.status(400).json({ 
        success: false, 
        error: 'Not a git repository. Cannot install updates automatically. Please update manually.' 
      });
    }
    
    // Pull latest changes
    const output = execSync('git pull', { cwd: __dirname, encoding: 'utf8' });
    res.json({ 
      success: true, 
      message: 'Update installed successfully. Please restart the application.',
      output: output
    });
  } catch (error) {
    console.error('Error installing update:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get auto-update config
app.get('/api/updates/config', (req, res) => {
  try {
    const configPath = path.join(__dirname, 'data', 'update-config.json');
    let config = { autoUpdateCheck: false };
    
    if (fs.existsSync(configPath)) {
      config = fs.readJSONSync(configPath);
    }
    
    res.json({ success: true, config });
  } catch (error) {
    console.error('Error reading update config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Set auto-update config
app.post('/api/updates/config', async (req, res) => {
  try {
    const { autoUpdateCheck } = req.body;
    const UpdateChecker = require('./scripts/installer/update-checker');
    const updateChecker = new UpdateChecker(__dirname);
    const result = await updateChecker.configureAutoUpdate(autoUpdateCheck === true);
    
    res.json(result);
  } catch (error) {
    console.error('Error setting update config:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Radio Configuration API Endpoints
// Get all talkgroups
app.get('/api/radio/talkgroups', (req, res) => {
  db.all('SELECT id, hex, alpha_tag, mode, description, tag, county FROM talk_groups ORDER BY id', [], (err, rows) => {
    if (err) {
      console.error('Error fetching talkgroups:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, talkgroups: rows || [] });
  });
});

// Add or update talkgroup
app.post('/api/radio/talkgroups', (req, res) => {
  const { id, hex, alpha_tag, mode, description, tag, county } = req.body;
  
  if (!id) {
    return res.status(400).json({ success: false, error: 'id (DEC) is required' });
  }
  
  db.run(
    `INSERT OR REPLACE INTO talk_groups (id, hex, alpha_tag, mode, description, tag, county) 
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id.toString(), hex || null, alpha_tag || null, mode || null, description || null, tag || null, county || null],
    function(err) {
      if (err) {
        console.error('Error saving talkgroup:', err);
        return res.status(500).json({ success: false, error: err.message });
      }
      res.json({ success: true, id: id });
    }
  );
});

// Delete talkgroup
app.delete('/api/radio/talkgroups/:id', (req, res) => {
  const { id } = req.params;
  
  db.run('DELETE FROM talk_groups WHERE id = ?', [id], function(err) {
    if (err) {
      console.error('Error deleting talkgroup:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ success: false, error: 'Talkgroup not found' });
    }
    res.json({ success: true, id: id });
  });
});

// Get all frequencies
app.get('/api/radio/frequencies', (req, res) => {
  db.all('SELECT id, frequency, description FROM frequencies ORDER BY id', [], (err, rows) => {
    if (err) {
      console.error('Error fetching frequencies:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
    res.json({ success: true, frequencies: rows || [] });
  });
});

// Add or update frequency
app.post('/api/radio/frequencies', (req, res) => {
  const { id, frequency, description } = req.body;
  
  if (!frequency) {
    return res.status(400).json({ success: false, error: 'frequency is required' });
  }
  
  // If id is provided, update; otherwise insert
  if (id !== undefined) {
    db.run(
      'UPDATE frequencies SET frequency = ?, description = ? WHERE id = ?',
      [frequency, description || null, id],
      function(err) {
        if (err) {
          console.error('Error updating frequency:', err);
          return res.status(500).json({ success: false, error: err.message });
        }
        if (this.changes === 0) {
          // If no rows updated, insert instead
          db.run(
            'INSERT INTO frequencies (id, frequency, description) VALUES (?, ?, ?)',
            [id, frequency, description || null],
            function(insertErr) {
              if (insertErr) {
                console.error('Error inserting frequency:', insertErr);
                return res.status(500).json({ success: false, error: insertErr.message });
              }
              res.json({ success: true, id: this.lastID });
            }
          );
        } else {
          res.json({ success: true, id: id });
        }
      }
    );
  } else {
    db.run(
      'INSERT INTO frequencies (frequency, description) VALUES (?, ?)',
      [frequency, description || null],
      function(err) {
        if (err) {
          console.error('Error inserting frequency:', err);
          return res.status(500).json({ success: false, error: err.message });
        }
        res.json({ success: true, id: this.lastID });
      }
    );
  }
});

// Delete frequency
app.delete('/api/radio/frequencies/:id', (req, res) => {
  const { id } = req.params;
  
  db.run('DELETE FROM frequencies WHERE id = ?', [id], function(err) {
    if (err) {
      console.error('Error deleting frequency:', err);
      return res.status(500).json({ success: false, error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ success: false, error: 'Frequency not found' });
    }
    res.json({ success: true, id: id });
  });
});

// CSV Import API Endpoints
// Preview CSV (parse and return first 10 rows without importing)
app.post('/api/radio/import-preview', (req, res) => {
  const busboy = Busboy({ headers: req.headers });
  const csvType = req.query.type || 'talkgroups';
  let csvText = '';
  
  busboy.on('file', (fieldname, file, filename) => {
    file.on('data', (data) => {
      csvText += data.toString();
    });
    
    file.on('end', () => {
      const lines = csvText.split('\n').filter(line => line.trim());
      const previewRows = lines.slice(0, 11);
      const previewText = previewRows.join('\n');
      
      const results = [];
      const errors = [];
      let rowCount = 0;
      
      require('stream').Readable.from(previewText)
        .pipe(csv())
        .on('data', (row) => {
          rowCount++;
          if (rowCount <= 10) {
            results.push(row);
            if (csvType === 'talkgroups' && !row.DEC && !row['DEC']) {
              errors.push(`Row ${rowCount}: Missing DEC field`);
            } else if (csvType === 'frequencies' && !row.Frequency && !row['Frequency']) {
              errors.push(`Row ${rowCount}: Missing Frequency field`);
            }
          }
        })
        .on('end', () => {
          res.json({ success: true, preview: results.slice(0, 10), totalRows: lines.length - 1, errors });
        })
        .on('error', (err) => {
          res.status(400).json({ success: false, error: `CSV parsing error: ${err.message}` });
        });
    });
  });
  
  busboy.on('finish', () => {
    if (!csvText) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
  });
  
  req.pipe(busboy);
});

// Import CSV (talkgroups or frequencies)
app.post('/api/radio/import-csv', (req, res) => {
  const busboy = Busboy({ headers: req.headers });
  const csvType = req.query.type || 'talkgroups';
  const mergeMode = req.query.merge === 'true';
  let csvText = '';
  
  busboy.on('file', (fieldname, file, filename) => {
    file.on('data', (data) => {
      csvText += data.toString();
    });
    
    file.on('end', () => {
      const results = { success: true, imported: 0, errors: [], skipped: 0 };
      
      const processRow = (row, rowNum) => {
        return new Promise((resolve) => {
          if (csvType === 'talkgroups') {
            const id = row.DEC || row['DEC'];
            if (!id) {
              results.errors.push(`Row ${rowNum}: Missing DEC field`);
              results.skipped++;
              return resolve();
            }
            const sql = mergeMode 
              ? 'INSERT OR REPLACE INTO talk_groups (id, hex, alpha_tag, mode, description, tag, county) VALUES (?, ?, ?, ?, ?, ?, ?)'
              : 'INSERT INTO talk_groups (id, hex, alpha_tag, mode, description, tag, county) VALUES (?, ?, ?, ?, ?, ?, ?)';
            db.run(sql, [id.toString(), row.HEX || row['HEX'] || null, row['Alpha Tag'] || row['alpha_tag'] || null, row.Mode || row['Mode'] || null, row.Description || row['Description'] || null, row.Tag || row['Tag'] || null, row.County || row['County'] || null], function(err) {
              if (err) {
                results.errors.push(`Row ${rowNum}: ${err.message}`);
                results.skipped++;
              } else {
                results.imported++;
              }
              resolve();
            });
          } else if (csvType === 'frequencies') {
            const frequency = row.Frequency || row['Frequency'];
            if (!frequency) {
              results.errors.push(`Row ${rowNum}: Missing Frequency field`);
              results.skipped++;
              return resolve();
            }
            const siteId = row['Site ID'] || row['site_id'];
            const sql = mergeMode && siteId
              ? 'INSERT OR REPLACE INTO frequencies (id, frequency, description) VALUES (?, ?, ?)'
              : 'INSERT INTO frequencies (frequency, description) VALUES (?, ?)';
            const params = siteId && mergeMode
              ? [parseInt(siteId), frequency, row.Description || row['Description'] || null]
              : [frequency, row.Description || row['Description'] || null];
            db.run(sql, params, function(err) {
              if (err) {
                results.errors.push(`Row ${rowNum}: ${err.message}`);
                results.skipped++;
              } else {
                results.imported++;
              }
              resolve();
            });
          }
        });
      };
      
      let rowNum = 1;
      const promises = [];
      require('stream').Readable.from(csvText)
        .pipe(csv())
        .on('data', (row) => {
          promises.push(processRow(row, rowNum++));
        })
        .on('end', async () => {
          await Promise.all(promises);
          res.json(results);
        })
        .on('error', (err) => {
          res.status(400).json({ success: false, error: `CSV parsing error: ${err.message}` });
        });
    });
  });
  
  busboy.on('finish', () => {
    if (!csvText) {
      return res.status(400).json({ success: false, error: 'No file uploaded' });
    }
  });
  
  req.pipe(busboy);
});

// Radio Software Detection API Endpoint
app.get('/api/radio/detect-software', (req, res) => {
  try {
    const detected = {
      trunkrecorder: false,
      sdtrunk: false,
      op25: false,
      rdioScanner: false,
      details: {}
    };
    
    // Check for TrunkRecorder (config.json in appdata/trunk-recorder/config/)
    const appdataPath = process.platform === 'win32' 
      ? path.join(os.homedir(), 'AppData', 'Local', 'trunk-recorder', 'config', 'config.json')
      : path.join(os.homedir(), '.config', 'trunk-recorder', 'config.json');
    
    if (fs.existsSync(appdataPath)) {
      detected.trunkrecorder = true;
      detected.details.trunkrecorder = {
        configPath: appdataPath,
        installed: true
      };
    }
    
    // Check for SDRTrunk (common installation paths)
    const sdrTrunkPaths = [
      process.platform === 'win32' ? 'C:\\Program Files\\SDRTrunk' : '/usr/local/bin/sdrtrunk',
      process.platform === 'win32' ? path.join(os.homedir(), 'SDRTrunk') : path.join(os.homedir(), '.sdrtrunk')
    ];
    
    for (const sdrPath of sdrTrunkPaths) {
      if (fs.existsSync(sdrPath)) {
        detected.sdtrunk = true;
        detected.details.sdtrunk = {
          installPath: sdrPath,
          installed: true
        };
        break;
      }
    }
    
    // Check for OP25 (check if op25 executable exists or Docker container)
    try {
      execSync('which op25', { stdio: 'ignore' });
      detected.op25 = true;
      detected.details.op25 = {
        installed: true,
        type: 'system'
      };
    } catch (err) {
      // Check for Docker container
      try {
        const dockerPs = execSync('docker ps --format "{{.Names}}"', { encoding: 'utf8' });
        if (dockerPs.includes('op25') || dockerPs.includes('op25-')) {
          detected.op25 = true;
          detected.details.op25 = {
            installed: true,
            type: 'docker'
          };
        }
      } catch (dockerErr) {
        // Docker not available or no op25 container
      }
    }
    
    // Check for rdio-scanner (Docker container)
    try {
      const dockerPs = execSync('docker ps --format "{{.Names}}"', { encoding: 'utf8' });
      if (dockerPs.includes('rdio-scanner') || dockerPs.includes('rdioscanner')) {
        detected.rdioScanner = true;
        detected.details.rdioScanner = {
          installed: true,
          type: 'docker'
        };
      }
      
      // Also check stopped containers
      const dockerPsAll = execSync('docker ps -a --format "{{.Names}}"', { encoding: 'utf8' });
      if ((dockerPsAll.includes('rdio-scanner') || dockerPsAll.includes('rdioscanner')) && !detected.rdioScanner) {
        detected.details.rdioScanner = {
          installed: true,
          type: 'docker',
          status: 'stopped'
        };
      }
    } catch (dockerErr) {
      // Docker not available
    }
    
    res.json({ success: true, detected });
  } catch (error) {
    console.error('Error detecting radio software:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// TrunkRecorder Auto-Configuration API Endpoint
app.post('/api/radio/configure-trunkrecorder', async (req, res) => {
  try {
    // Check SDR compatibility first
    const SDRDetector = require('./scripts/installer/sdr-detector');
    const sdrDetector = new SDRDetector();
    await sdrDetector.detectDevices();
    const recommendedDevice = sdrDetector.getRecommendedDevice();
    const sdrCompat = sdrDetector.getSDRCompatibility(recommendedDevice);
    
    if (!sdrCompat.supported && !recommendedDevice.isDefault) {
      return res.status(400).json({
        success: false,
        error: sdrCompat.reason || `Detected SDR device "${recommendedDevice.name}" is not supported by TrunkRecorder`
      });
    }
    
    const { preview = false } = req.body;
    
    // Determine config path (check both project root appdata and user appdata)
    const projectAppdataPath = path.join(__dirname, 'appdata');
    const userAppdataPath = process.platform === 'win32'
      ? path.join(os.homedir(), 'AppData', 'Local', 'trunk-recorder', 'config')
      : path.join(os.homedir(), '.config', 'trunk-recorder');
    
    let configDir, configPath;
    if (fs.existsSync(projectAppdataPath)) {
      configDir = path.join(projectAppdataPath, 'trunk-recorder', 'config');
      configPath = path.join(configDir, 'config.json');
    } else {
      configDir = process.platform === 'win32'
        ? path.join(os.homedir(), 'AppData', 'Local', 'trunk-recorder', 'config')
        : path.join(os.homedir(), '.config', 'trunk-recorder');
      configPath = path.join(configDir, 'config.json');
    }
    
    // Ensure directories exist
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    // Read frequencies and talkgroups from database
    const frequencies = await new Promise((resolve, reject) => {
      db.all('SELECT id, frequency, description FROM frequencies ORDER BY id', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    const talkgroups = await new Promise((resolve, reject) => {
      db.all('SELECT id, hex, alpha_tag, mode, description, tag, county FROM talk_groups ORDER BY id', [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });
    
    if (frequencies.length === 0 && talkgroups.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'No frequencies or talkgroups found. Please add frequencies and talkgroups before configuring TrunkRecorder.' 
      });
    }
    
    // Generate API key (reuse from existing config if available, otherwise generate new)
    let apiKey = null;
    if (fs.existsSync(configPath)) {
      try {
        const existing = fs.readJSONSync(configPath);
        if (existing.uploadServer && existing.uploadServer.apiKey) {
          apiKey = existing.uploadServer.apiKey;
        }
      } catch (err) {
        // Config exists but is invalid, will generate new
      }
    }
    
    if (!apiKey) {
      const crypto = require('crypto');
      apiKey = crypto.randomBytes(16).toString('hex');
    }
    
    // Determine installation type (default to docker)
    const installationType = 'docker'; // Could be made configurable
    const uploadUrl = installationType === 'docker'
      ? 'http://scanner-map:3306/api/call-upload'
      : 'http://localhost:3306/api/call-upload';
    
    // Group frequencies by proximity and determine control channels
    // For simplicity, use first frequency in each group as control channel
    // In a more sophisticated implementation, we could group by proximity
    const controlChannels = frequencies.slice(0, Math.min(5, frequencies.length)).map(f => {
      const freq = parseFloat(f.frequency);
      return isNaN(freq) ? null : freq;
    }).filter(f => f !== null);
    
    // Determine system type (default to P25 if mode not specified)
    // Group talkgroups by mode if available
    const systems = [];
    const modeGroups = {};
    
    talkgroups.forEach(tg => {
      const mode = (tg.mode || 'P25').toUpperCase();
      if (!modeGroups[mode]) {
        modeGroups[mode] = [];
      }
      modeGroups[mode].push(tg);
    });
    
    // If no talkgroups, create a single system from frequencies
    if (Object.keys(modeGroups).length === 0) {
      systems.push({
        shortName: 'System1',
        control_channels: controlChannels.length > 0 ? controlChannels : [851.0125],
        type: 'p25',
        modulation: 'qpsk',
        squelch: -50,
        audioGain: 1.0
      });
    } else {
      // Create systems for each mode group
      Object.keys(modeGroups).forEach((mode, index) => {
        const systemType = mode.includes('P25') ? 'p25' : mode.toLowerCase();
        systems.push({
          shortName: `System${index + 1}`,
          control_channels: controlChannels.length > 0 ? controlChannels.slice(0, 3) : [851.0125],
          type: systemType,
          modulation: 'qpsk',
          squelch: -50,
          audioGain: 1.0
        });
      });
    }
    
    // Calculate optimal center frequency from frequencies
    const freqValues = frequencies
      .map(f => parseFloat(f.frequency))
      .filter(f => !isNaN(f) && f > 0);
    
    const centerFreq = freqValues.length > 0
      ? Math.round(freqValues.reduce((a, b) => a + b, 0) / freqValues.length)
      : 850000000;
    
    // Auto-detect SDR device
    let deviceConfig = {
      driver: 'osmosdr',
      device: 'rtl=0',
      deviceString: 'rtl=0'
    };
    
    try {
      const SDRDetector = require('./scripts/installer/sdr-detector');
      const detector = new SDRDetector();
      const recommendedDevice = await detector.getRecommendedDevice();
      deviceConfig = recommendedDevice;
      console.log(`[TrunkRecorder Config] Auto-detected SDR device: ${recommendedDevice.name} (${recommendedDevice.driver}, ${recommendedDevice.device})`);
    } catch (err) {
      console.warn(`[TrunkRecorder Config] Could not auto-detect SDR device: ${err.message}, using default RTL-SDR`);
    }
    
    // Generate config
    const config = {
      ver: 2,
      sources: [
        {
          driver: deviceConfig.driver || 'osmosdr',
          device: deviceConfig.device || deviceConfig.deviceString || 'rtl=0',
          center: centerFreq,
          rate: 2048000,
          gain: 30,
          error: 0,
          digitalRecorders: Math.min(4, Math.max(1, Math.ceil(frequencies.length / 10)))
        }
      ],
      systems: systems,
      uploadServer: {
        type: 'rdio-scanner',
        url: uploadUrl,
        apiKey: apiKey
      }
    };
    
    if (preview) {
      // Return preview without saving
      return res.json({ success: true, config, preview: true });
    }
    
    // Write config file
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    
    res.json({ 
      success: true, 
      message: 'TrunkRecorder configuration generated successfully',
      configPath: configPath,
      apiKey: apiKey
    });
  } catch (error) {
    console.error('Error configuring TrunkRecorder:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// NLP Command Processing API Endpoints
// Command parsing prompt template
const PARSE_COMMAND_PROMPT_TEMPLATE = `You are a command parser for a radio scanner configuration system. Parse the following user command and extract the intent and parameters.

Available intents:
- add_talkgroup: Add a new talkgroup (requires: id or dec, optional: hex, alpha_tag, mode, description, tag, county)
- delete_talkgroup: Delete a talkgroup (requires: id or dec)
- add_frequency: Add a new frequency (requires: frequency, optional: description, site_id)
- delete_frequency: Delete a frequency (requires: frequency or id)
- list_talkgroups: List all talkgroups (no params)
- list_frequencies: List all frequencies (no params)
- multi: Multiple actions in one command

Return ONLY valid JSON in this exact format:
{
  "intent": "intent_name",
  "params": {
    "param1": "value1",
    "param2": "value2"
  },
  "confidence": 0.0-1.0,
  "suggestedActions": ["action1", "action2"]
}

User command: "{command}"

JSON response:`;

/**
 * Parse natural language command using AI provider
 */
async function parseCommand(command) {
  const prompt = PARSE_COMMAND_PROMPT_TEMPLATE.replace('{command}', command);
  
  try {
    if (AI_PROVIDER.toLowerCase() === 'openai' && OPENAI_API_KEY) {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: OPENAI_MODEL,
          messages: [
            { role: 'system', content: 'You are a JSON command parser. Always return valid JSON only.' },
            { role: 'user', content: prompt }
          ],
          temperature: 0.3,
          max_tokens: 500
        })
      });
      
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.statusText}`);
      }
      
      const data = await response.json();
      const content = data.choices[0].message.content.trim();
      
      // Extract JSON from response (might have markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(content);
      
    } else {
      // Ollama
      const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt: prompt,
          stream: false,
          options: {
            temperature: 0.3,
            num_predict: 500
          }
        })
      });
      
      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }
      
      const data = await response.json();
      const content = data.response.trim();
      
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return JSON.parse(content);
    }
  } catch (error) {
    console.error(`Error parsing command "${command}":`, error.message);
    return {
      intent: 'error',
      params: {},
      confidence: 0,
      error: error.message
    };
  }
}

/**
 * Execute parsed command by calling appropriate API endpoints
 */
async function executeCommand(intent, params) {
  try {
    switch (intent) {
      case 'add_talkgroup':
        const talkgroupData = {
          id: params.id || params.dec,
          hex: params.hex || null,
          alpha_tag: params.alpha_tag || null,
          mode: params.mode || null,
          description: params.description || null,
          tag: params.tag || null,
          county: params.county || null
        };
        // Call internal API (would need to make HTTP request or direct DB call)
        // For now, return structured response
        return { success: true, action: 'add_talkgroup', data: talkgroupData };
        
      case 'delete_talkgroup':
        return { success: true, action: 'delete_talkgroup', id: params.id || params.dec };
        
      case 'add_frequency':
        const frequencyData = {
          frequency: params.frequency,
          description: params.description || null,
          site_id: params.site_id || null
        };
        return { success: true, action: 'add_frequency', data: frequencyData };
        
      case 'delete_frequency':
        return { success: true, action: 'delete_frequency', frequency: params.frequency || params.id };
        
      case 'list_talkgroups':
        return { success: true, action: 'list_talkgroups' };
        
      case 'list_frequencies':
        return { success: true, action: 'list_frequencies' };
        
      default:
        return { success: false, error: `Unknown intent: ${intent}` };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Process natural language command
app.post('/api/ai/command', async (req, res) => {
  try {
    const { command } = req.body;
    
    if (!command || typeof command !== 'string') {
      return res.status(400).json({ 
        success: false, 
        error: 'Command is required and must be a string' 
      });
    }
    
    // Parse command using AI
    const parsed = await parseCommand(command);
    
    // Execute the command
    const executionResult = await executeCommand(parsed.intent, parsed.params || {});
    
    res.json({
      success: parsed.intent !== 'error',
      parsed: {
        intent: parsed.intent,
        params: parsed.params || {},
        confidence: parsed.confidence || 0,
        suggestedActions: parsed.suggestedActions || []
      },
      execution: executionResult,
      error: parsed.error || null
    });
  } catch (error) {
    console.error('Error processing command:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get command examples
app.get('/api/ai/command-examples', (req, res) => {
  const examples = {
    talkgroups: [
      { text: "Add talkgroup 1234 with description Fire Department", intent: "add_talkgroup" },
      { text: "Create a talkgroup for police with ID 5678", intent: "add_talkgroup" },
      { text: "Delete talkgroup 9999", intent: "delete_talkgroup" },
      { text: "Remove talkgroup 1234", intent: "delete_talkgroup" },
      { text: "Show me all talkgroups", intent: "list_talkgroups" },
      { text: "What talkgroups do I have?", intent: "list_talkgroups" }
    ],
    frequencies: [
      { text: "Add frequency 852.5125 for dispatch", intent: "add_frequency" },
      { text: "Add a frequency at 154.415 with description Ambulance", intent: "add_frequency" },
      { text: "Remove frequency 852.5125", intent: "delete_frequency" },
      { text: "Delete frequency 154.415", intent: "delete_frequency" },
      { text: "List all frequencies", intent: "list_frequencies" },
      { text: "Show me my frequencies", intent: "list_frequencies" }
    ],
    multi: [
      { text: "Add talkgroup 1234 and frequency 852.5125", intent: "multi" },
      { text: "Create talkgroup for fire and add frequency 154.415", intent: "multi" }
    ]
  };
  
  res.json({ success: true, examples });
});

// Dependency Installation API Endpoints
// Store for installation jobs (in-memory for now, could be persisted)
const installationJobs = new Map();

// Install Docker
app.post('/api/system/install-docker', async (req, res) => {
  try {
    const DependencyInstaller = require('./scripts/installer/dependency-installer');
    const dependencyInstaller = new DependencyInstaller();
    
    const jobId = `docker-${Date.now()}`;
    installationJobs.set(jobId, {
      id: jobId,
      type: 'docker',
      status: 'running',
      progress: 0,
      output: [],
      error: null,
      startedAt: new Date()
    });
    
    // Start installation asynchronously
    dependencyInstaller.installDocker()
      .then(result => {
        const job = installationJobs.get(jobId);
        if (job) {
          job.status = result.success ? 'completed' : 'failed';
          job.progress = 100;
          job.result = result;
          if (!result.success) {
            job.error = result.error;
          }
        }
      })
      .catch(error => {
        const job = installationJobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = error.message;
        }
      });
    
    res.json({ success: true, jobId });
  } catch (error) {
    console.error('Error starting Docker installation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Install Node.js
app.post('/api/system/install-nodejs', async (req, res) => {
  try {
    const DependencyInstaller = require('./scripts/installer/dependency-installer');
    const dependencyInstaller = new DependencyInstaller();
    
    const jobId = `nodejs-${Date.now()}`;
    installationJobs.set(jobId, {
      id: jobId,
      type: 'nodejs',
      status: 'running',
      progress: 0,
      output: [],
      error: null,
      startedAt: new Date()
    });
    
    // Start installation asynchronously
    dependencyInstaller.installNodejs()
      .then(result => {
        const job = installationJobs.get(jobId);
        if (job) {
          job.status = result.success ? 'completed' : 'failed';
          job.progress = 100;
          job.result = result;
          if (!result.success) {
            job.error = result.error;
          }
        }
      })
      .catch(error => {
        const job = installationJobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = error.message;
        }
      });
    
    res.json({ success: true, jobId });
  } catch (error) {
    console.error('Error starting Node.js installation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Install Python
app.post('/api/system/install-python', async (req, res) => {
  try {
    const DependencyInstaller = require('./scripts/installer/dependency-installer');
    const dependencyInstaller = new DependencyInstaller();
    
    const jobId = `python-${Date.now()}`;
    installationJobs.set(jobId, {
      id: jobId,
      type: 'python',
      status: 'running',
      progress: 0,
      output: [],
      error: null,
      startedAt: new Date()
    });
    
    // Start installation asynchronously
    dependencyInstaller.installPython()
      .then(result => {
        const job = installationJobs.get(jobId);
        if (job) {
          job.status = result.success ? 'completed' : 'failed';
          job.progress = 100;
          job.result = result;
          if (!result.success) {
            job.error = result.error;
          }
        }
      })
      .catch(error => {
        const job = installationJobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = error.message;
        }
      });
    
    res.json({ success: true, jobId });
  } catch (error) {
    console.error('Error starting Python installation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Install Ollama (non-Docker)
app.post('/api/system/install-ollama', async (req, res) => {
  try {
    // Check GPU compatibility first
    const GPUDetector = require('./scripts/installer/gpu-detector');
    const gpuDetector = new GPUDetector();
    const allGPUs = await gpuDetector.detectAllGPUs();
    
    if (allGPUs.primary) {
      const compat = gpuDetector.getServiceGPUCompatibility('ollama', allGPUs.primary.brand);
      const { useDocker = false } = req.body;
      const isDocker = isRunningInDocker() || useDocker;
      
      if (isDocker && !compat.docker) {
        return res.status(400).json({
          success: false,
          error: compat.reason || `Ollama Docker installation not supported with ${allGPUs.primary.brand.toUpperCase()} GPU`
        });
      }
      
      if (!isDocker && !compat.local) {
        return res.status(400).json({
          success: false,
          error: compat.reason || `Ollama local installation not supported with ${allGPUs.primary.brand.toUpperCase()} GPU`
        });
      }
    }
    
    const { useDocker = false } = req.body;
    const isDocker = isRunningInDocker() || useDocker;
    
    const jobId = `ollama-${Date.now()}`;
    installationJobs.set(jobId, {
      id: jobId,
      type: 'ollama',
      status: 'running',
      progress: 0,
      output: [],
      error: null,
      startedAt: new Date()
    });
    
    // Start installation asynchronously
    const installOllama = async () => {
      const job = installationJobs.get(jobId);
      try {
        if (isDocker) {
          // Update progress
          if (job) {
            job.progress = 10;
            job.output.push('Adding Ollama service to docker-compose.yml...');
          }
          
          // Add to docker-compose.yml
          const DockerComposeBuilder = require('./scripts/installer/docker-compose-builder');
          const composeBuilder = new DockerComposeBuilder(process.cwd());
          
          // Check if GPU should be enabled
          const envPath = path.join(process.cwd(), '.env');
          let enableGPU = false;
          if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            enableGPU = /DOCKER_GPU_ENABLED\s*=\s*true/i.test(envContent);
          }
          
          const addResult = await composeBuilder.addService('ollama', enableGPU);
          if (!addResult.success) {
            return { success: false, error: `Failed to add Ollama to docker-compose.yml: ${addResult.error}` };
          }
          
          if (job) {
            job.progress = 30;
            job.output.push('Pulling Ollama Docker image...');
          }
          
          // Pull Docker image with progress
          const { spawn } = require('child_process');
          const dockerCmd = process.platform === 'win32' ? 'docker' : 'docker';
          const pullProcess = spawn(dockerCmd, ['pull', 'ollama/ollama:latest'], {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe']
          });
          
          let pullOutput = '';
          pullProcess.stdout.on('data', (data) => {
            pullOutput += data.toString();
            if (job) {
              // Try to extract progress from Docker pull output
              const progressMatch = data.toString().match(/(\d+(\.\d+)?%)/);
              if (progressMatch) {
                const percent = parseFloat(progressMatch[1]);
                job.progress = Math.min(30 + (percent * 0.6), 90); // 30-90% for pull
              }
              job.output.push(data.toString().trim());
            }
          });
          
          pullProcess.stderr.on('data', (data) => {
            pullOutput += data.toString();
            if (job) {
              job.output.push(data.toString().trim());
            }
          });
          
          await new Promise((resolve, reject) => {
            pullProcess.on('close', (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`Docker pull failed with code ${code}`));
              }
            });
            pullProcess.on('error', reject);
          });
          
          if (job) {
            job.progress = 95;
            job.output.push('Starting Ollama container...');
          }
          
          // Start the service using docker compose
          // Use the same project name as scanner-map if it exists
          const composeCmd = process.platform === 'win32' ? 'docker' : 'docker';
          const composeProject = (await (async () => {
            try {
              const composePath = path.join(process.cwd(), 'docker-compose.yml');
              if (fs.existsSync(composePath)) {
                const composeContent = fs.readFileSync(composePath, 'utf8');
                const yaml = require('js-yaml');
                const compose = yaml.load(composeContent);
                return compose.name || 'scanner-map';
              }
            } catch (err) {
              // Ignore errors
            }
            return 'scanner-map';
          })());
          
          const startArgs = ['compose', 'up', '-d', 'ollama'];
          if (composeProject !== 'scanner-map') {
            startArgs.push('--project-name', composeProject);
          }
          
          const startProcess = spawn(composeCmd, startArgs, {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe']
          });
          
          await new Promise((resolve, reject) => {
            startProcess.on('close', (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`Failed to start Ollama container`));
              }
            });
            startProcess.on('error', reject);
          });
          
          return { success: true, message: 'Ollama installed and started successfully' };
        } else {
          // Install Ollama locally
          const { execSync } = require('child_process');
          const os = require('os');
          const platform = os.platform();
          
          if (platform === 'win32') {
            // Windows: Download and install Ollama
            execSync('powershell -Command "Invoke-WebRequest -Uri https://ollama.com/download/windows -OutFile ollama-installer.exe"', { stdio: 'inherit' });
            return { success: true, message: 'Ollama installer downloaded. Please run ollama-installer.exe to complete installation.' };
          } else if (platform === 'linux') {
            // Linux: Install via script
            execSync('curl -fsSL https://ollama.com/install.sh | sh', { stdio: 'inherit' });
            return { success: true, message: 'Ollama installed successfully. Start it with: ollama serve' };
          } else if (platform === 'darwin') {
            // macOS: Install via Homebrew or download
            try {
              execSync('brew install ollama', { stdio: 'inherit' });
              return { success: true, message: 'Ollama installed via Homebrew. Start it with: ollama serve' };
            } catch (err) {
              return { success: false, error: 'Please install Ollama manually from https://ollama.com/download' };
            }
          }
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
    };
    
    installOllama()
      .then(result => {
        const job = installationJobs.get(jobId);
        if (job) {
          job.status = result.success ? 'completed' : 'failed';
          job.progress = 100;
          job.result = result;
          if (!result.success) {
            job.error = result.error;
          }
        }
      })
      .catch(error => {
        const job = installationJobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = error.message;
        }
      });
    
    res.json({ success: true, jobId });
  } catch (error) {
    console.error('Error starting Ollama installation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Install faster-whisper (Python package)
app.post('/api/system/install-faster-whisper', async (req, res) => {
  try {
    // Check GPU compatibility first - faster-whisper works with NVIDIA or CPU
    const GPUDetector = require('./scripts/installer/gpu-detector');
    const gpuDetector = new GPUDetector();
    const allGPUs = await gpuDetector.detectAllGPUs();
    
    if (allGPUs.primary) {
      const compat = gpuDetector.getServiceGPUCompatibility('faster-whisper', allGPUs.primary.brand);
      
      if (!compat.supported) {
        return res.status(400).json({
          success: false,
          error: compat.reason || `faster-whisper requires NVIDIA GPU or CPU. Detected: ${allGPUs.primary.brand.toUpperCase()} ${allGPUs.primary.name}`
        });
      }
    }
    // Note: faster-whisper can work on CPU, so we don't require GPU
    
    const jobId = `faster-whisper-${Date.now()}`;
    installationJobs.set(jobId, {
      id: jobId,
      type: 'faster-whisper',
      status: 'running',
      progress: 0,
      output: [],
      error: null,
      startedAt: new Date()
    });
    
    // Start installation asynchronously
    const installFasterWhisper = async () => {
      const job = installationJobs.get(jobId);
      try {
        if (job) {
          job.progress = 10;
          job.output.push('Checking Python installation...');
        }
        
        const { spawn } = require('child_process');
        // Try python3 first, then python
        let pythonCmd = 'python3';
        try {
          execSync('python3 --version', { stdio: 'ignore' });
        } catch (err) {
          try {
            execSync('python --version', { stdio: 'ignore' });
            pythonCmd = 'python';
          } catch (err2) {
            return { success: false, error: 'Python not found. Please install Python 3.10+ first.' };
          }
        }
        
        if (job) {
          job.progress = 20;
          job.output.push(`Using Python: ${pythonCmd}`);
          job.output.push('Installing faster-whisper (this may take several minutes)...');
        }
        
        // Install faster-whisper with progress tracking
        return new Promise((resolve, reject) => {
          const installProcess = spawn(pythonCmd, ['-m', 'pip', 'install', 'faster-whisper'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            shell: process.platform === 'win32'
          });
          
          let output = '';
          installProcess.stdout.on('data', (data) => {
            output += data.toString();
            if (job) {
              job.output.push(data.toString().trim());
              // Estimate progress (pip install is hard to track precisely)
              if (job.progress < 80) {
                job.progress = Math.min(job.progress + 5, 80);
              }
            }
          });
          
          installProcess.stderr.on('data', (data) => {
            output += data.toString();
            if (job) {
              job.output.push(data.toString().trim());
            }
          });
          
          installProcess.on('close', (code) => {
            if (code === 0) {
              if (job) {
                job.progress = 100;
              }
              resolve({ success: true, message: 'faster-whisper installed successfully' });
            } else {
              reject(new Error(`Installation failed with code ${code}: ${output}`));
            }
          });
          
          installProcess.on('error', (err) => {
            reject(new Error(`Failed to start installation: ${err.message}`));
          });
        });
      } catch (error) {
        return { success: false, error: error.message };
      }
    };
    
    (async () => {
      try {
        const result = await installFasterWhisper();
        const job = installationJobs.get(jobId);
        if (job) {
          job.status = result.success ? 'completed' : 'failed';
          job.progress = 100;
          job.result = result;
          if (!result.success) {
            job.error = result.error;
          }
        }
      } catch (error) {
        const job = installationJobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.progress = 100;
          job.error = error.message;
        }
      }
    })();
    
    res.json({ success: true, jobId });
  } catch (error) {
    console.error('Error starting faster-whisper installation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Install iCAD Transcribe
app.post('/api/system/install-icad-transcribe', async (req, res) => {
  try {
    // Check GPU compatibility first - iCAD requires NVIDIA
    const GPUDetector = require('./scripts/installer/gpu-detector');
    const gpuDetector = new GPUDetector();
    const allGPUs = await gpuDetector.detectAllGPUs();
    
    if (allGPUs.primary) {
      const compat = gpuDetector.getServiceGPUCompatibility('icad', allGPUs.primary.brand);
      const { useDocker = false } = req.body;
      const isDocker = isRunningInDocker() || useDocker;
      
      if (!compat.supported) {
        return res.status(400).json({
          success: false,
          error: compat.reason || `iCAD Transcribe requires NVIDIA GPU. Detected: ${allGPUs.primary.brand.toUpperCase()} ${allGPUs.primary.name}`
        });
      }
      
      if (isDocker && !compat.docker) {
        return res.status(400).json({
          success: false,
          error: compat.reason || `iCAD Transcribe Docker installation not supported with ${allGPUs.primary.brand.toUpperCase()} GPU`
        });
      }
      
      if (!isDocker && !compat.local) {
        return res.status(400).json({
          success: false,
          error: compat.reason || `iCAD Transcribe local installation not supported with ${allGPUs.primary.brand.toUpperCase()} GPU`
        });
      }
    } else {
      return res.status(400).json({
        success: false,
        error: 'iCAD Transcribe requires NVIDIA GPU. No GPU detected.'
      });
    }
    
    const { useDocker = false } = req.body;
    const isDocker = isRunningInDocker() || useDocker;
    
    const jobId = `icad-transcribe-${Date.now()}`;
    installationJobs.set(jobId, {
      id: jobId,
      type: 'icad-transcribe',
      status: 'running',
      progress: 0,
      output: [],
      error: null,
      startedAt: new Date()
    });
    
    // Start installation asynchronously
    const installICAD = async () => {
      const job = installationJobs.get(jobId);
      try {
        if (isDocker) {
          // Update progress
          if (job) {
            job.progress = 10;
            job.output.push('Adding iCAD Transcribe service to docker-compose.yml...');
          }
          
          // Add to docker-compose.yml
          const DockerComposeBuilder = require('./scripts/installer/docker-compose-builder');
          const composeBuilder = new DockerComposeBuilder(process.cwd());
          
          // Check if GPU should be enabled
          const envPath = path.join(process.cwd(), '.env');
          let enableGPU = false;
          if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            enableGPU = /DOCKER_GPU_ENABLED\s*=\s*true/i.test(envContent);
          }
          
          const addResult = await composeBuilder.addService('icad-transcribe', enableGPU);
          if (!addResult.success) {
            return { success: false, error: `Failed to add iCAD Transcribe to docker-compose.yml: ${addResult.error}` };
          }
          
          if (job) {
            job.progress = 30;
            job.output.push('Pulling iCAD Transcribe Docker image...');
          }
          
          // Pull Docker image with progress
          const { spawn } = require('child_process');
          const dockerCmd = process.platform === 'win32' ? 'docker' : 'docker';
          const pullProcess = spawn(dockerCmd, ['pull', 'thegreatcodeholio/icad_transcribe:1.0'], {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe']
          });
          
          let pullOutput = '';
          pullProcess.stdout.on('data', (data) => {
            pullOutput += data.toString();
            if (job) {
              // Try to extract progress from Docker pull output
              const progressMatch = data.toString().match(/(\d+(\.\d+)?%)/);
              if (progressMatch) {
                const percent = parseFloat(progressMatch[1]);
                job.progress = Math.min(30 + (percent * 0.6), 90); // 30-90% for pull
              }
              job.output.push(data.toString().trim());
            }
          });
          
          pullProcess.stderr.on('data', (data) => {
            pullOutput += data.toString();
            if (job) {
              job.output.push(data.toString().trim());
            }
          });
          
          await new Promise((resolve, reject) => {
            pullProcess.on('close', (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`Docker pull failed with code ${code}`));
              }
            });
            pullProcess.on('error', reject);
          });
          
          if (job) {
            job.progress = 95;
            job.output.push('Starting iCAD Transcribe container...');
          }
          
          // Start the service using docker compose
          // Use the same project name as scanner-map if it exists
          const composeCmd = process.platform === 'win32' ? 'docker' : 'docker';
          const composeProject = (await (async () => {
            try {
              const composePath = path.join(process.cwd(), 'docker-compose.yml');
              if (fs.existsSync(composePath)) {
                const composeContent = fs.readFileSync(composePath, 'utf8');
                const yaml = require('js-yaml');
                const compose = yaml.load(composeContent);
                return compose.name || 'scanner-map';
              }
            } catch (err) {
              // Ignore errors
            }
            return 'scanner-map';
          })());
          
          const startArgs = ['compose', 'up', '-d', 'icad-transcribe'];
          if (composeProject !== 'scanner-map') {
            startArgs.push('--project-name', composeProject);
          }
          
          const startProcess = spawn(composeCmd, startArgs, {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe']
          });
          
          await new Promise((resolve, reject) => {
            startProcess.on('close', (code) => {
              if (code === 0) {
                resolve();
              } else {
                reject(new Error(`Failed to start iCAD Transcribe container`));
              }
            });
            startProcess.on('error', reject);
          });
          
          return { success: true, message: 'iCAD Transcribe installed and started successfully' };
        } else {
          // Install iCAD Transcribe locally (Python package)
          const { execSync } = require('child_process');
          let pythonCmd = 'python3';
          try {
            execSync('python3 --version', { stdio: 'ignore' });
          } catch (err) {
            try {
              execSync('python --version', { stdio: 'ignore' });
              pythonCmd = 'python';
            } catch (err2) {
              return { success: false, error: 'Python not found. Please install Python 3.10+ first.' };
            }
          }
          
          // Install icad-transcribe
          execSync(`${pythonCmd} -m pip install icad-transcribe`, { stdio: 'inherit' });
          return { success: true, message: 'iCAD Transcribe installed. Start it with: icad-transcribe serve' };
        }
      } catch (error) {
        return { success: false, error: error.message };
      }
    };
    
    installICAD()
      .then(result => {
        const job = installationJobs.get(jobId);
        if (job) {
          job.status = result.success ? 'completed' : 'failed';
          job.progress = 100;
          job.result = result;
          if (!result.success) {
            job.error = result.error;
          }
        }
      })
      .catch(error => {
        const job = installationJobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = error.message;
        }
      });
    
    res.json({ success: true, jobId });
  } catch (error) {
    console.error('Error starting iCAD Transcribe installation:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get installation status
app.get('/api/system/install-status/:jobId', (req, res) => {
  const { jobId } = req.params;
  const job = installationJobs.get(jobId);
  
  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }
  
  // Clean up old completed/failed jobs (older than 1 hour)
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  if ((job.status === 'completed' || job.status === 'failed') && job.startedAt.getTime() < oneHourAgo) {
    installationJobs.delete(jobId);
    return res.status(404).json({ success: false, error: 'Job expired' });
  }
  
  res.json({ success: true, job });
});

// Model Recommendations and Pulling API Endpoints
// Get model recommendations based on hardware
app.get('/api/models/recommendations', async (req, res) => {
  try {
    const GPUDetector = require('./scripts/installer/gpu-detector');
    const ModelRecommendations = require('./scripts/installer/model-recommendations');
    const gpuDetector = new GPUDetector();
    
    // Detect GPU and VRAM
    const allGPUs = await gpuDetector.detectAllGPUs();
    let vramGB = 0;
    let hasGPU = false;
    
    if (allGPUs.primary && allGPUs.primary.brand === 'nvidia') {
      hasGPU = true;
      try {
        vramGB = await ModelRecommendations.detectGPUMemory();
      } catch (err) {
        // Default to 8GB if can't detect
        vramGB = 8;
      }
    }
    
    const recommendations = ModelRecommendations.getCompleteRecommendations(vramGB, hasGPU);
    
    res.json({
      success: true,
      recommendations: recommendations,
      hardware: {
        hasGPU: hasGPU,
        gpuInfo: allGPUs.primary,
        vramGB: vramGB
      }
    });
  } catch (error) {
    console.error('Error getting model recommendations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Pull Ollama model
app.post('/api/models/pull-ollama', async (req, res) => {
  try {
    const { modelName } = req.body;
    if (!modelName) {
      return res.status(400).json({ success: false, error: 'Model name is required' });
    }
    
    const jobId = `ollama-pull-${Date.now()}`;
    installationJobs.set(jobId, {
      id: jobId,
      type: 'ollama-pull',
      model: modelName,
      status: 'running',
      progress: 0,
      output: [],
      error: null,
      startedAt: new Date()
    });
    
    // Start pulling asynchronously
    const pullModel = async () => {
      const job = installationJobs.get(jobId);
      try {
        if (job) {
          job.progress = 5;
          job.output.push(`Starting pull of Ollama model: ${modelName}`);
        }
        
        const isDocker = isRunningInDocker();
        let pullCommand;
        
        if (isDocker) {
          // Pull via Docker exec
          pullCommand = ['exec', '-i', 'ollama', 'ollama', 'pull', modelName];
        } else {
          // Pull locally
          pullCommand = ['pull', modelName];
        }
        
        const { spawn } = require('child_process');
        const ollamaCmd = isDocker ? 'docker' : 'ollama';
        const pullProcess = spawn(ollamaCmd, pullCommand, {
          stdio: ['ignore', 'pipe', 'pipe'],
          cwd: process.cwd()
        });
        
        let output = '';
        pullProcess.stdout.on('data', (data) => {
          output += data.toString();
          if (job) {
            const line = data.toString().trim();
            job.output.push(line);
            // Try to extract progress from Ollama output
            if (line.includes('%')) {
              const progressMatch = line.match(/(\d+(\.\d+)?)%/);
              if (progressMatch) {
                const percent = parseFloat(progressMatch[1]);
                job.progress = Math.min(5 + (percent * 0.9), 95);
              }
            }
          }
        });
        
        pullProcess.stderr.on('data', (data) => {
          output += data.toString();
          if (job) {
            job.output.push(data.toString().trim());
          }
        });
        
        await new Promise((resolve, reject) => {
          pullProcess.on('close', (code) => {
            if (code === 0) {
              if (job) {
                job.progress = 100;
                job.output.push('Model pulled successfully!');
              }
              resolve();
            } else {
              reject(new Error(`Pull failed with code ${code}: ${output}`));
            }
          });
          pullProcess.on('error', reject);
        });
        
        return { success: true, message: `Model ${modelName} pulled successfully` };
      } catch (error) {
        return { success: false, error: error.message };
      }
    };
    
    pullModel()
      .then(result => {
        const job = installationJobs.get(jobId);
        if (job) {
          job.status = result.success ? 'completed' : 'failed';
          job.progress = 100;
          job.result = result;
          if (!result.success) {
            job.error = result.error;
          }
        }
      })
      .catch(error => {
        const job = installationJobs.get(jobId);
        if (job) {
          job.status = 'failed';
          job.error = error.message;
        }
      });
    
    res.json({ success: true, jobId });
  } catch (error) {
    console.error('Error starting Ollama model pull:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get service status (running/stopped)
app.get('/api/services/status', async (req, res) => {
  try {
    const { spawn } = require('child_process');
    const status = {
      ollama: { running: false, url: null, models: [] },
      icad: { running: false, url: null },
      fasterWhisper: { installed: false }
    };
    
    // Check Ollama
    try {
      const isDocker = isRunningInDocker();
      let checkCmd;
      if (isDocker) {
        checkCmd = ['exec', 'ollama', 'ollama', 'list'];
      } else {
        checkCmd = ['list'];
      }
      
      const ollamaProcess = spawn(isDocker ? 'docker' : 'ollama', checkCmd, {
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 5000
      });
      
      let ollamaOutput = '';
      ollamaProcess.stdout.on('data', (data) => {
        ollamaOutput += data.toString();
      });
      
      await new Promise((resolve) => {
        ollamaProcess.on('close', (code) => {
          if (code === 0) {
            status.ollama.running = true;
            status.ollama.url = process.env.OLLAMA_URL || 'http://localhost:11434';
            // Parse models from output
            const lines = ollamaOutput.split('\n').filter(l => l.trim() && !l.includes('NAME'));
            status.ollama.models = lines.map(line => {
              const parts = line.trim().split(/\s+/);
              return parts[0];
            }).filter(m => m);
          }
          resolve();
        });
        ollamaProcess.on('error', () => resolve());
        setTimeout(() => resolve(), 6000);
      });
    } catch (err) {
      // Ollama not running
    }
    
    // Check iCAD Transcribe
    try {
      const icadUrl = process.env.ICAD_URL || 'http://localhost:9912';
      const response = await fetch(`${icadUrl}/api/health`, {
        method: 'GET',
        timeout: 3000
      });
      if (response.ok) {
        status.icad.running = true;
        status.icad.url = icadUrl;
      }
    } catch (err) {
      // iCAD not running
    }
    
    // Check faster-whisper (Python package)
    try {
      const { execSync } = require('child_process');
      execSync('python3 -c "import faster_whisper; print(\'OK\')"', { 
        stdio: 'ignore',
        timeout: 3000
      });
      status.fasterWhisper.installed = true;
    } catch (err) {
      // Not installed
    }
    
    res.json({ success: true, status });
  } catch (error) {
    console.error('Error checking service status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// GPU Configuration API Endpoints
// Get GPU status
app.get('/api/system/gpu-status', async (req, res) => {
  try {
    const GPUDetector = require('./scripts/installer/gpu-detector');
    const gpuDetector = new GPUDetector();
    const allGPUs = await gpuDetector.detectAllGPUs();
    
    let toolkitCheck = null;
    if (allGPUs.primary && allGPUs.primary.brand === 'nvidia' && process.platform === 'linux') {
      toolkitCheck = await gpuDetector.checkNvidiaContainerToolkit();
    }
    
    // Check service compatibility
    const serviceCompatibility = {};
    if (allGPUs.primary) {
      ['ollama', 'icad', 'faster-whisper'].forEach(service => {
        const compat = gpuDetector.getServiceGPUCompatibility(service, allGPUs.primary.brand);
        serviceCompatibility[service] = compat;
      });
    }
    
    res.json({
      success: true,
      available: allGPUs.available,
      primary: allGPUs.primary,
      brands: allGPUs.brands,
      toolkitInstalled: toolkitCheck?.installed || false,
      toolkitVersion: toolkitCheck?.version || null,
      serviceCompatibility: serviceCompatibility
    });
  } catch (error) {
    console.error('Error checking GPU status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configure GPU (enable/disable in .env and rebuild docker-compose)
app.post('/api/system/configure-gpu', async (req, res) => {
  try {
    const { enabled } = req.body;
    const envPath = path.join(__dirname, '.env');
    
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }
    
    // Update DOCKER_GPU_ENABLED
    const varName = 'DOCKER_GPU_ENABLED';
    const regex = new RegExp(`^${varName}=.*$`, 'm');
    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, `${varName}=${enabled ? 'true' : 'false'}`);
    } else {
      envContent += `\n${varName}=${enabled ? 'true' : 'false'}\n`;
    }
    
    // If GPU is enabled and TRANSCRIPTION_MODE is local, set TRANSCRIPTION_DEVICE to cuda
    // Only update if NVIDIA GPU is actually available (faster-whisper requires CUDA)
    if (enabled) {
      const GPUDetector = require('./scripts/installer/gpu-detector');
      const gpuDetector = new GPUDetector();
      const allGPUs = await gpuDetector.detectAllGPUs();
      
      // Only set CUDA if NVIDIA GPU is detected
      if (allGPUs.primary && allGPUs.primary.brand === 'nvidia') {
        // Check if TRANSCRIPTION_MODE is local
        const transcriptionModeMatch = envContent.match(/^TRANSCRIPTION_MODE=(.+)$/m);
        const transcriptionMode = transcriptionModeMatch ? transcriptionModeMatch[1].trim() : 'local';
        
        if (transcriptionMode === 'local') {
          // Update TRANSCRIPTION_DEVICE to cuda
          const deviceRegex = /^TRANSCRIPTION_DEVICE=.*$/m;
          if (deviceRegex.test(envContent)) {
            envContent = envContent.replace(deviceRegex, 'TRANSCRIPTION_DEVICE=cuda');
          } else {
            envContent += '\nTRANSCRIPTION_DEVICE=cuda\n';
          }
        }
      }
    } else {
      // If GPU is disabled and TRANSCRIPTION_DEVICE is cuda, set it back to cpu
      const deviceRegex = /^TRANSCRIPTION_DEVICE=.*$/m;
      if (deviceRegex.test(envContent)) {
        const currentDevice = envContent.match(/^TRANSCRIPTION_DEVICE=(.+)$/m);
        if (currentDevice && currentDevice[1].trim() === 'cuda') {
          envContent = envContent.replace(deviceRegex, 'TRANSCRIPTION_DEVICE=cpu');
        }
      }
    }
    
    fs.writeFileSync(envPath, envContent, 'utf8');
    
    // Rebuild docker-compose.yml if Docker is being used
    try {
      const dockerComposePath = path.join(__dirname, 'docker-compose.yml');
      if (fs.existsSync(dockerComposePath)) {
        const DockerComposeBuilder = require('./scripts/installer/docker-compose-builder');
        const builder = new DockerComposeBuilder(__dirname);
        
        // Read current .env to get service configuration
        const dotenv = require('dotenv');
        const envConfig = dotenv.parse(envContent);
        
        // Determine which services are enabled
        const services = {
          // Check if services should be enabled (local containers vs remote)
          enableOllama: envConfig.AI_PROVIDER === 'ollama' && (!envConfig.OLLAMA_URL || envConfig.OLLAMA_URL.includes('localhost') || envConfig.OLLAMA_URL.includes('ollama:')),
          enableICAD: envConfig.TRANSCRIPTION_MODE === 'icad' && (!envConfig.ICAD_URL || envConfig.ICAD_URL.includes('localhost') || envConfig.ICAD_URL.includes('icad-transcribe:')),
          // Auto-detect service URLs for web UI
          detectedOllamaUrl: envConfig.OLLAMA_URL ? null : (isRunningInDocker() ? 'http://ollama:11434' : 'http://localhost:11434'),
          detectedIcadUrl: envConfig.ICAD_URL ? null : (isRunningInDocker() ? 'http://icad-transcribe:9912' : 'http://localhost:9912'),
          enableTrunkRecorder: false, // Don't auto-enable TrunkRecorder
          enableRdioScanner: false,
          enableOP25: false,
          radioSoftware: 'none',
          transcriptionMode: envConfig.TRANSCRIPTION_MODE || 'local',
          timezone: envConfig.TIMEZONE || 'America/New_York',
          enableGPU: enabled,
          ollamaUrl: envConfig.OLLAMA_URL || null,
          icadUrl: envConfig.ICAD_URL || null
        };
        
        await builder.build(services);
        console.log('[GPU] Docker Compose rebuilt with GPU configuration');
      }
    } catch (rebuildError) {
      console.warn('[GPU] Could not rebuild docker-compose.yml:', rebuildError.message);
      // Don't fail the request if rebuild fails
    }
    
    res.json({ success: true, message: 'GPU configuration updated. Restart Docker services for changes to take effect.' });
  } catch (error) {
    console.error('Error configuring GPU:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Install NVIDIA Container Toolkit (Linux only)
app.post('/api/system/install-nvidia-toolkit', async (req, res) => {
  try {
    if (process.platform !== 'linux') {
      return res.status(400).json({ success: false, error: 'NVIDIA Container Toolkit installation is only available on Linux' });
    }
    
    const GPUDetector = require('./scripts/installer/gpu-detector');
    const gpuDetector = new GPUDetector();
    const result = await gpuDetector.installNvidiaContainerToolkit();
    
    res.json(result);
  } catch (error) {
    console.error('Error installing NVIDIA Container Toolkit:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Auto-Start Configuration API Endpoints
// Get auto-start status (check if configured)
app.get('/api/system/autostart-status', async (req, res) => {
  try {
    const os = require('os');
    const fs = require('fs');
    let enabled = false;
    
    // Check platform-specific auto-start configuration
    if (process.platform === 'win32') {
      const startupDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
      const batPath = path.join(startupDir, 'Scanner-Map.bat');
      enabled = fs.existsSync(batPath);
    } else if (process.platform === 'linux') {
      const servicePath = '/etc/systemd/system/scanner-map.service';
      enabled = fs.existsSync(servicePath);
    } else if (process.platform === 'darwin') {
      const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.scanner-map.plist');
      enabled = fs.existsSync(plistPath);
    }
    
    res.json({ success: true, enabled });
  } catch (error) {
    console.error('Error checking auto-start status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Configure auto-start
app.post('/api/system/configure-autostart', async (req, res) => {
  try {
    const { enabled, installationType = 'docker' } = req.body;
    const AutoStart = require('./scripts/installer/auto-start');
    const autoStart = new AutoStart(__dirname);
    
    if (enabled) {
      // Enable auto-start
      const result = await autoStart.configure(installationType, {});
      res.json(result);
    } else {
      // Disable auto-start (remove configuration files)
      const os = require('os');
      const fs = require('fs');
      let removed = false;
      
      if (process.platform === 'win32') {
        const startupDir = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
        const batPath = path.join(startupDir, 'Scanner-Map.bat');
        if (fs.existsSync(batPath)) {
          fs.unlinkSync(batPath);
          removed = true;
        }
      } else if (process.platform === 'linux') {
        const servicePath = '/etc/systemd/system/scanner-map.service';
        if (fs.existsSync(servicePath)) {
          try {
            execSync('sudo systemctl disable scanner-map.service', { stdio: 'ignore' });
            execSync('sudo rm /etc/systemd/system/scanner-map.service', { stdio: 'ignore' });
            execSync('sudo systemctl daemon-reload', { stdio: 'ignore' });
            removed = true;
          } catch (err) {
            // May require sudo, return error
            return res.status(403).json({ success: false, error: 'Auto-start removal requires administrator privileges' });
          }
        }
      } else if (process.platform === 'darwin') {
        const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.scanner-map.plist');
        if (fs.existsSync(plistPath)) {
          try {
            execSync(`launchctl unload ${plistPath}`, { stdio: 'ignore' });
            fs.unlinkSync(plistPath);
            removed = true;
          } catch (err) {
            // Ignore errors
          }
        }
      }
      
      res.json({ success: true, removed });
    }
  } catch (error) {
    console.error('Error configuring auto-start:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add endpoint to check if current user is admin
app.get('/api/auth/is-admin', async (req, res) => {
  if (!authEnabled) {
    return res.json({ isAdmin: false, authEnabled: false });
  }
  
  const authHeader = req.headers['authorization'];
  const adminStatus = await isAdminUser(authHeader);
  res.json({ isAdmin: adminStatus, authEnabled: true });
});

// Test endpoint to verify server is working
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working', timestamp: Date.now() });
});

// --- NEW: S3 Client Setup ---
let s3 = null;
if (STORAGE_MODE === 's3') {
  if (!S3_ENDPOINT || !S3_BUCKET_NAME || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    console.error('FATAL: STORAGE_MODE is s3, but required S3 environment variables are missing! Check webserver .env');
    process.exit(1); // Exit if S3 config is incomplete
  }
  AWS.config.update({
    accessKeyId: S3_ACCESS_KEY_ID,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
    endpoint: S3_ENDPOINT,
    s3ForcePathStyle: true, // Necessary for MinIO/non-AWS S3
    signatureVersion: 'v4'
  });
  s3 = new AWS.S3();
  console.log(`[Webserver] Storage mode set to S3. Endpoint: ${S3_ENDPOINT}, Bucket: ${S3_BUCKET_NAME}`);
} else {
  console.log('[Webserver] Storage mode set to local.');
}

// Authentication is enabled if ENABLE_AUTH=true
const authEnabled = ENABLE_AUTH?.toLowerCase() === 'true';

// Session configuration (used only if auth is enabled)
const SESSION_DURATION = parseInt(SESSION_DURATION_DAYS, 10) * 24 * 60 * 60 * 1000; // Convert days to milliseconds
const MAX_SESSIONS = parseInt(MAX_SESSIONS_PER_USER, 10);
const SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000; // Cleanup every hour

// Express app setup
const server = http.createServer(app);
const io = socketIo(server);

// Database setup
const db = new sqlite3.Database('./botdata.db', sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:3191',message:'Database open error',data:{error:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
  } else {
    console.log('Connected to the SQLite database.');
    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:3195',message:'Database connected successfully',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
  }
});

// Initialize core database tables (webserver may run independently)
db.serialize(() => {
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:3200',message:'Starting database table initialization',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'A'})}).catch(()=>{});
  // #endregion
  
  // Create transcriptions table
  db.run(`CREATE TABLE IF NOT EXISTS transcriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    talk_group_id TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    transcription TEXT,
    audio_file_path TEXT,
    address TEXT,
    lat REAL,
    lon REAL,
    category TEXT
  )`, (err) => {
    if (err) {
      console.error('Error creating transcriptions table:', err);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:3215',message:'Error creating transcriptions table',data:{error:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:3218',message:'transcriptions table created/verified',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    }
  });

  // Create talk_groups table (CRITICAL - this was missing!)
  db.run(`CREATE TABLE IF NOT EXISTS talk_groups (
    id TEXT PRIMARY KEY,
    hex TEXT,
    alpha_tag TEXT,
    mode TEXT,
    description TEXT,
    tag TEXT,
    county TEXT
  )`, (err) => {
    if (err) {
      console.error('Error creating talk_groups table:', err);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:3233',message:'Error creating talk_groups table',data:{error:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    } else {
      console.log('talk_groups table created/verified');
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:3236',message:'talk_groups table created/verified',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    }
  });

  // Create frequencies table
  db.run(`CREATE TABLE IF NOT EXISTS frequencies (
    id INTEGER PRIMARY KEY,
    frequency TEXT,
    description TEXT
  )`, (err) => {
    if (err) {
      console.error('Error creating frequencies table:', err);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:3247',message:'Error creating frequencies table',data:{error:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:3250',message:'frequencies table created/verified',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    }
  });

  // Create global_keywords table
  db.run(`CREATE TABLE IF NOT EXISTS global_keywords (
    keyword TEXT UNIQUE,
    talk_group_id TEXT
  )`, (err) => {
    if (err) {
      console.error('Error creating global_keywords table:', err);
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:3261',message:'Error creating global_keywords table',data:{error:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    } else {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:3264',message:'global_keywords table created/verified',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
    }
  });
});

db.run(`ALTER TABLE transcriptions ADD COLUMN category TEXT`, err => {
  // Ignore error if column already exists
  if (!err || err.message.includes('duplicate column name')) {
    console.log('Category column exists or was created successfully');
  }
});

// Create authentication tables if authentication is enabled
if (authEnabled) {
  db.serialize(() => {
    // Users table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Sessions table
    db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL,
        last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
        ip_address TEXT,
        user_agent TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
  });
}

// Helper Functions for Authentication
function hashPassword(password, salt) {
  return crypto
    .pbkdf2Sync(password, salt, 10000, 64, 'sha512')
    .toString('hex');
}

function generateSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Session Management Functions
async function createSession(userId, req) {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION);
  const ipAddress = req.ip;
  const userAgent = req.get('user-agent');

  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO sessions (user_id, token, expires_at, ip_address, user_agent) 
       VALUES (?, ?, datetime(?), ?, ?)`,
      [userId, token, expiresAt.toISOString(), ipAddress, userAgent],
      function(err) {
        if (err) reject(err);
        else resolve({ token, expiresAt });
      }
    );
  });
}

async function validateSession(token) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM sessions 
       WHERE token = ? AND expires_at > datetime('now')`,
      [token],
      (err, session) => {
        if (err) reject(err);
        else resolve(session);
      }
    );
  });
}

async function generateShortSummary(transcript) {
  try {
    // Original list of categories for the AI
    const categories = [
      'Medical Emergency', 'Injured Person', 'Disturbance', 'Vehicle Collision',
      'Burglary', 'Assault', 'Structure Fire', 'Missing Person', 'Medical Call',
      'Building Fire', 'Stolen Vehicle', 'Service Call', 'Vehicle Stop',
      'Unconscious Person', 'Reckless Driver', 'Person With A Gun',
      'Altered Level of Consciousness', 'Breathing Problems', 'Fight',
      'Carbon Monoxide', 'Abduction', 'Passed Out Person', 'Hazmat',
      'Fire Alarm', 'Traffic Hazard', 'Intoxicated Person', 'Mvc', // Note: Mvc is often redundant with Vehicle Collision
      'Animal Bite',
      'Assist'
    ];

    // This prompt works well for both Ollama and OpenAI's chat models
    const commonPrompt = `
You are an expert emergency service dispatcher categorizing radio transmissions.
Analyze the following first responder radio transmission and categorize it into EXACTLY ONE of the categories listed below.
Choose the category that best fits the main subject of the transmission.
Focus on the primary reason for the dispatch if multiple events are mentioned.

**PRIORITIZATION:**
- If a clear event type (like Vehicle Collision, Fire, Assault, Medical Emergency, etc.) is mentioned, **use that category even if the dispatcher says "no details"** or the information is minimal.
- Use the 'Other' category ONLY if the transmission primarily contains just location/unit information OR if no specific event type from the list is mentioned at all.

It is CRUCIAL that your response is ONLY one of the category names from this list and nothing else.

Categories:
${categories.map(cat => `- ${cat}`).join('\n')}
- Other

Transmission: "${transcript}"

Category:`;

    let category = 'OTHER'; // Default value

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.warn(`[Webserver] AI request timed out after 10 seconds during categorization.`);
        controller.abort();
    }, 10000); // 10-second timeout

    // --- AI Provider Logic ---
    if (AI_PROVIDER.toLowerCase() === 'openai') {
        if (!OPENAI_API_KEY) {
            console.error('[Webserver] FATAL: AI_PROVIDER is set to openai, but OPENAI_API_KEY is not configured!');
            return 'OTHER'; // Fallback if key is missing
        }
        console.log(`[Webserver] Categorizing with OpenAI model: ${OPENAI_MODEL}`);

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                messages: [{ role: 'user', content: commonPrompt }],
                temperature: 0.2, // Lower temp for more deterministic category
                max_tokens: 20    // A category name is short
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[Webserver] OpenAI API error! status: ${response.status}, transcript: ${transcript}, details: ${errorText}`);
          throw new Error(`OpenAI API error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.choices && result.choices.length > 0 && result.choices[0].message) {
            category = result.choices[0].message.content.trim();
        }

    } else { // Default to Ollama
        console.log(`[Webserver] Categorizing with Ollama model: ${OLLAMA_MODEL}`);

        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            prompt: commonPrompt, // The prompt is compatible
            stream: false,
            options: {
                temperature: 0.3
            }
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.error(`[Webserver] Ollama API error! status: ${response.status} for transcript: ${transcript}`);
          throw new Error(`Ollama API error! status: ${response.status}`);
        }

        const result = await response.json();
        category = result.response.trim();
    }
    // --- End AI Provider Logic ---


    // The existing post-processing logic is generic enough to work for both
    const thinkBlockRegex = /<think>[\s\S]*?<\/think>\s*/;
    category = category.replace(thinkBlockRegex, '').trim().toUpperCase();

    // Validate the AI's response against the known categories (including OTHER)
    const validCategoriesUppercase = categories.map(cat => cat.toUpperCase());
    validCategoriesUppercase.push('OTHER');

    if (!validCategoriesUppercase.includes(category)) {
       console.warn(`[Webserver] AI returned an unexpected or invalid category: "${category}". Defaulting to OTHER for transcript: "${transcript}"`);
       category = 'OTHER';
    }
    
    return category;

  } catch (error) {
    console.error(`[Webserver] Error categorizing call: "${transcript}". Error: ${error.message}`);
    if (error.name === 'AbortError') {
         console.error(`[Webserver] AI request timed out during categorization: ${error.message}`);
    }
    return 'OTHER'; // Fallback to 'OTHER' in case of any errors
  }
}

function cleanupExpiredSessions() {
  if (authEnabled) {
    db.run('DELETE FROM sessions WHERE expires_at <= datetime("now")', [], (err) => {
      if (err) {
        console.error('Error cleaning up expired sessions:', err);
      } else {
        console.log('Expired sessions cleaned up');
      }
    });
  }
}

// Start session cleanup interval if auth enabled
if (authEnabled) {
  setInterval(cleanupExpiredSessions, SESSION_CLEANUP_INTERVAL);
}

// Authentication Middleware - only applied when authentication is enabled
const basicAuth = async (req, res, next) => {
  // Skip authentication if disabled in .env
  if (!authEnabled) {
    return next();
  }

  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      res.set('WWW-Authenticate', 'Basic realm="Protected Area"');
      return res.status(401).send('Authentication required.');
    }

    // Check if it's a Bearer token (session-based auth)
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (!token) {
        return res.status(401).send('Invalid Bearer token format.');
      }

      // Validate the session token
      const session = await validateSession(token);
      if (!session) {
        return res.status(401).send('Invalid or expired session token.');
      }

      // Get the user from the session
      const user = await new Promise((resolve, reject) => {
        db.get('SELECT id, username FROM users WHERE id = ?', [session.user_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      if (!user) {
        return res.status(401).send('User not found for session.');
      }

      // Set user info in request for downstream use
      req.user = { id: user.id, username: user.username };
      req.session = session;
      return next();
    }

    // Check if it's Basic auth (username:password)
    if (authHeader.startsWith('Basic ')) {
      const base64Credentials = authHeader.split(' ')[1];
      if (!base64Credentials) {
        res.set('WWW-Authenticate', 'Basic realm="Protected Area"');
        return res.status(401).send('Invalid authentication format.');
      }

      const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
      const [username, password] = credentials.split(':');

      // Check credentials against database
      db.get(
        'SELECT id, password_hash, salt FROM users WHERE username = ?',
        [username],
        async (err, user) => {
          if (err) {
            console.error('Database error during authentication:', err);
            return res.status(500).send('Internal server error.');
          }

          if (!user) {
            res.set('WWW-Authenticate', 'Basic realm="Protected Area"');
            return res.status(401).send('Invalid credentials.');
          }

          const hashedPassword = hashPassword(password, user.salt);
          if (hashedPassword === user.password_hash) {
            // Get all active sessions for user, ordered by creation date
            db.all(
              `SELECT id, created_at, expires_at 
               FROM sessions 
               WHERE user_id = ? AND expires_at > datetime('now')
               ORDER BY created_at ASC`,
              [user.id],
              async (err, sessions) => {
                if (err) {
                  return res.status(500).send('Internal server error.');
                }

                // If at session limit, remove oldest session
                if (sessions.length >= MAX_SESSIONS) {
                  db.run(
                    'DELETE FROM sessions WHERE id = ?',
                    [sessions[0].id],
                    async (err) => {
                      if (err) {
                        console.error('Error removing oldest session:', err);
                        return res.status(500).send('Internal server error.');
                      }
                      console.log(`Removed oldest session for user ${username}`);
                      try {
                        const session = await createSession(user.id, req);
                        req.user = { id: user.id, username };
                        req.session = session;
                        next();
                      } catch (err) {
                        console.error('Error creating session:', err);
                        return res.status(500).send('Internal server error.');
                      }
                    }
                  );
                } else {
                  try {
                    const session = await createSession(user.id, req);
                    req.user = { id: user.id, username };
                    req.session = session;
                    next();
                  } catch (err) {
                    console.error('Error creating session:', err);
                    return res.status(500).send('Internal server error.');
                  }
                }
              }
            );
          } else {
            res.set('WWW-Authenticate', 'Basic realm="Protected Area"');
            return res.status(401).send('Invalid credentials.');
          }
        }
      );
    } else {
      return res.status(401).send('Unsupported authentication method. Use Basic or Bearer.');
    }
  } catch (err) {
    console.error('Authentication error:', err);
    return res.status(500).send('Internal server error.');
  }
};

// Admin Authentication Middleware
const adminAuth = (req, res, next) => {
  // Skip authentication if disabled in .env
  if (!authEnabled) {
    return next();
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).send('Admin authentication required.');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  if (username === 'admin' && password === WEBSERVER_PASSWORD) {
    next();
  } else {
    return res.status(401).send('Invalid admin credentials.');
  }
};

// Helper function to check if user is admin
async function isAdminUser(authHeader) {
  if (!authEnabled || !authHeader) {
    return false;
  }

  try {
    // Check if it's a Bearer token (session-based auth)
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (!token) {
        return false;
      }

      // Validate the session token
      const session = await validateSession(token);
      if (!session) {
        return false;
      }

      // Get the user from the session
      const user = await new Promise((resolve, reject) => {
        db.get('SELECT username FROM users WHERE id = ?', [session.user_id], (err, row) => {
          if (err) reject(err);
          else resolve(row);
        });
      });

      // Check if the user is admin
      return user && user.username === 'admin';
    }

    // Check if it's Basic auth (username:password)
    if (authHeader.startsWith('Basic ')) {
      const base64Credentials = authHeader.split(' ')[1];
      if (!base64Credentials) {
        return false;
      }

      const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
      const [username, password] = credentials.split(':');

      return username === 'admin' && password === WEBSERVER_PASSWORD;
    }

    return false;
  } catch (error) {
    console.error('Error in isAdminUser:', error);
    return false;
  }
}

// --- NEW HELPER FUNCTION ---
// Store the last purge operation details for undo functionality
let lastPurgeDetails = null;

// Function to store original coordinates before purging
async function storeOriginalCoordinates(talkgroupIds, categories, timeRangeStart, timeRangeEnd) {
  return new Promise((resolve, reject) => {
    // Build the WHERE clause to get calls that will be purged
    let whereConditions = ['lat IS NOT NULL AND lon IS NOT NULL'];
    let params = [];

    // If no talkgroups selected, it means "all talkgroups" (no filter applied)
    if (talkgroupIds && talkgroupIds.length > 0) {
      whereConditions.push(`talk_group_id IN (${talkgroupIds.map(() => '?').join(',')})`);
      params.push(...talkgroupIds);
    }
    // If no talkgroups selected, don't add any filter - this means "all talkgroups"

    if (categories && categories.length > 0) {
      whereConditions.push(`UPPER(category) IN (${categories.map(() => 'UPPER(?)').join(',')})`);
      params.push(...categories);
    }

    whereConditions.push('timestamp BETWEEN ? AND ?');
    params.push(timeRangeStart, timeRangeEnd);

    const whereClause = whereConditions.join(' AND ');
    const selectQuery = `SELECT id, lat, lon FROM transcriptions WHERE ${whereClause}`;

    db.all(selectQuery, params, (err, rows) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

async function serveAudioFromDb(res, transcriptionId) {
    console.log(`[Audio DB] Serving audio for ID ${transcriptionId} from database blob.`);
    try {
        const audioRow = await new Promise((resolve, reject) => {
            db.get('SELECT audio_data FROM audio_files WHERE transcription_id = ?', [transcriptionId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (audioRow && audioRow.audio_data) {
            const pathRow = await new Promise((resolve, reject) => {
                 db.get('SELECT audio_file_path FROM transcriptions WHERE id = ?', [transcriptionId], (err, row) => {
                    if (err) reject(err); else resolve(row);
                });
            });

            const filePath = pathRow ? pathRow.audio_file_path : '';
            const extension = path.extname(filePath).toLowerCase();
            const contentType = extension === '.m4a' ? 'audio/mp4' : 'audio/mpeg';
            
            res.setHeader('Content-Type', contentType);
            res.send(audioRow.audio_data);
        } else {
            console.error(`[Audio DB] Audio data not found in DB for ID: ${transcriptionId}`);
            if (!res.headersSent) {
                res.status(404).send('Audio not found in any storage location.');
            }
        }
    } catch (dbErr) {
        console.error(`[Audio DB] DB error for ID ${transcriptionId}:`, dbErr);
        if (!res.headersSent) {
            res.status(500).send('Internal Server Error during DB fallback.');
        }
    }
}

// Public Routes (No Auth Required)
app.get('/audio/:id', async (req, res) => {
  const transcriptionId = req.params.id;
  
  try {
    const transcriptionRow = await new Promise((resolve, reject) => {
        db.get('SELECT audio_file_path FROM transcriptions WHERE id = ?', [transcriptionId], (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });

    if (transcriptionRow && transcriptionRow.audio_file_path) {
        const audioStoragePath = transcriptionRow.audio_file_path;
        const extension = path.extname(audioStoragePath).toLowerCase();
        const contentType = extension === '.m4a' ? 'audio/mp4' : 'audio/mpeg';

        if (STORAGE_MODE === 's3') {
            const params = { Bucket: S3_BUCKET_NAME, Key: audioStoragePath };
            const s3Stream = s3.getObject(params).createReadStream();
            s3Stream.on('error', (s3Err) => {
                console.warn(`[Audio S3] S3 stream error for key ${audioStoragePath}: ${s3Err.code}. Falling back to DB.`);
                serveAudioFromDb(res, transcriptionId);
            });
            res.setHeader('Content-Type', contentType);
            s3Stream.pipe(res);
            return; 
        } else { // Local storage
            const localPath = path.join(__dirname, 'audio', audioStoragePath);
            if (fs.existsSync(localPath)) {
                res.setHeader('Content-Type', contentType);
                fs.createReadStream(localPath).pipe(res);
                return;
            } else {
                 console.warn(`[Audio Local] File not found at ${localPath}. Falling back to DB.`);
            }
        }
    }
    
    // Fallback to serving from the database blob if file not found or path missing.
    serveAudioFromDb(res, transcriptionId);

  } catch (dbErr) {
    console.error('[Audio Request] Database error:', dbErr);
    return res.status(500).send('Internal Server Error');
  }
});

// Apply authentication middleware to protected routes if auth is enabled
app.use(basicAuth);

// Serve static files from the 'public' directory with cache control
app.use(express.static(path.join(__dirname, 'public'), {
    setHeaders: (res, filePath) => {
        // Disable caching for HTML and JS files to ensure updates are loaded
        if (filePath.endsWith('.html') || filePath.endsWith('.js')) {
            res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
        } else {
            // Allow caching for CSS and other static assets
            res.setHeader('Cache-Control', 'public, max-age=3600');
        }
    }
}));

// Session Management Routes (Only relevant when auth is enabled)
app.get('/api/sessions/current', (req, res) => {
  if (authEnabled) {
    res.json({
      session: req.session || null,
      user: req.user || null
    });
  } else {
    res.json({
      session: { token: 'anonymous-session' },
      user: { username: 'anonymous' }
    });
  }
});

app.get('/api/sessions', adminAuth, (req, res) => {
  if (!authEnabled) {
    return res.json([]);
  }

  const userId = req.query.userId;
  let query = `
    SELECT s.*, u.username, s.ip_address, s.user_agent
    FROM sessions s 
    JOIN users u ON s.user_id = u.id 
    WHERE s.expires_at > datetime('now')
  `;
  const params = [];

  if (userId && userId !== 'all') {
    query += ' AND s.user_id = ?';
    params.push(userId);
  }

  query += ' ORDER BY s.created_at DESC';

  db.all(query, params, (err, sessions) => {
    if (err) {
      console.error('Error fetching sessions:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.json(sessions);
  });
});

app.delete('/api/sessions/:token', adminAuth, (req, res) => {
  if (!authEnabled) {
    return res.json({ message: 'Authentication is disabled' });
  }

  db.run(
    'DELETE FROM sessions WHERE token = ?',
    [req.params.token],
    function(err) {
      if (err) {
        console.error('Error deleting session:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.json({ message: 'Session terminated successfully' });
    }
  );
});

app.get('/api/sessions/me', (req, res) => {
  if (!authEnabled) {
    return res.json([]);
  }

  db.all(
    `SELECT id, created_at, expires_at, ip_address, user_agent 
     FROM sessions 
     WHERE user_id = ? AND expires_at > datetime('now')
     ORDER BY created_at DESC`,
    [req.user.id],
    (err, sessions) => {
      if (err) {
        console.error('Error fetching user sessions:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.json(sessions);
    }
  );
});

// User Management Routes (Admin Only when auth is enabled)
app.post('/api/users', adminAuth, async (req, res) => {
  if (!authEnabled) {
    return res.status(400).json({ error: 'Authentication is disabled' });
  }

  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const passwordHash = hashPassword(password, salt);

  try {
    const result = await new Promise((resolve, reject) => {
      db.run(
        'INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)',
        [username, passwordHash, salt],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });

    res.status(201).json({ 
      message: 'User created successfully',
      userId: result
    });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'Username already exists.' });
    } else {
      console.error('Error creating user:', err);
      res.status(500).json({ error: 'Internal server error.' });
    }
  }
});

app.get('/api/users', adminAuth, (req, res) => {
  if (!authEnabled) {
    return res.json([]);
  }

  db.all(
    `SELECT u.id, u.username, u.created_at,
            COUNT(s.id) as active_sessions
     FROM users u
     LEFT JOIN sessions s ON u.id = s.user_id 
        AND s.expires_at > datetime('now')
     GROUP BY u.id
     ORDER BY u.created_at DESC`,
    [],
    (err, users) => {
      if (err) {
        console.error('Error fetching users:', err);
        return res.status(500).json({ error: 'Internal server error.' });
      }
      res.json(users);
    }
  );
});

app.delete('/api/users/:id', adminAuth, (req, res) => {
  if (!authEnabled) {
    return res.status(400).json({ error: 'Authentication is disabled' });
  }

  const userId = parseInt(req.params.id, 10);
  
  if (isNaN(userId)) {
    return res.status(400).json({ error: 'Invalid user ID.' });
  }

  db.run('DELETE FROM users WHERE id = ?', [userId], function(err) {
    if (err) {
      console.error('Error deleting user:', err);
      return res.status(500).json({ error: 'Internal server error.' });
    }
    res.json({ message: 'User deleted successfully.' });
  });
});

// API Routes for call data
app.get('/api/calls', (req, res) => {
  const hours = parseInt(req.query.hours) || 12;
  // Convert hours to a Unix timestamp (seconds) for the WHERE clause
  const sinceTimestampUnix = Math.floor((Date.now() - hours * 60 * 60 * 1000) / 1000);

  console.log(`Fetching calls since Unix timestamp: ${sinceTimestampUnix} (${hours} hours ago)`);

  db.all(
    `
    SELECT t.*, tg.alpha_tag AS talk_group_name, tg.tag AS talk_group_tag
    FROM transcriptions t
    LEFT JOIN talk_groups tg ON t.talk_group_id = tg.id
    WHERE t.timestamp >= ? AND t.lat IS NOT NULL AND t.lon IS NOT NULL
    ORDER BY t.timestamp DESC
    `,
    [sinceTimestampUnix], // Use Unix timestamp for the query
    (err, rows) => {
      if (err) {
        console.error('Error fetching calls:', err);
        res.status(500).json({ error: err.message });
        return;
      }

      console.log(`Returning ${rows.length} calls`);
      // Timestamps are now already Unix seconds from the DB
      if (rows.length > 0) {
        console.log(`Oldest call in result (Unix ts): ${rows[rows.length - 1].timestamp}`);
        console.log(`Newest call in result (Unix ts): ${rows[0].timestamp}`);
      }
      res.json(rows); // Send rows directly as timestamps are already numeric
    }
  );
});

app.delete('/api/markers/:id', (req, res) => {
  const markerId = parseInt(req.params.id, 10);

  if (isNaN(markerId)) {
    return res.status(400).json({ error: 'Invalid marker ID' });
  }

  db.run(
    'DELETE FROM transcriptions WHERE id = ?',
    [markerId],
    function(err) {
      if (err) {
        console.error('Error deleting marker:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }

      res.json({ message: 'Marker deleted successfully' });
    }
  );
});

app.put('/api/markers/:id/location', (req, res) => {
  const markerId = parseInt(req.params.id);
  const { lat, lon } = req.body;

  if (isNaN(markerId) || typeof lat !== 'number' || typeof lon !== 'number') {
    return res.status(400).json({ error: 'Invalid parameters' });
  }

  db.run(
    'UPDATE transcriptions SET lat = ?, lon = ? WHERE id = ?',
    [lat, lon, markerId],
    function(err) {
      if (err) {
        console.error('Error updating marker location:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      res.json({ success: true });
    }
  );
});

app.get('/api/additional-transcriptions/:callId', (req, res) => {
  const callId = parseInt(req.params.callId, 10);
  const skip = parseInt(req.query.skip, 10) || 0;

  if (isNaN(callId)) {
    return res.status(400).send('Invalid call ID.');
  }

  db.get(
    'SELECT talk_group_id FROM transcriptions WHERE id = ?',
    [callId],
    (err, row) => {
      if (err) {
        console.error('Error fetching talk group ID:', err);
        return res.status(500).json({ error: 'Internal Server Error' });
      }

      if (!row) {
        return res.status(404).json({ error: 'Call not found' });
      }

      const talkGroupId = row.talk_group_id;

      db.all(
        `
        SELECT t.id, t.transcription, t.audio_file_path, t.timestamp, tg.alpha_tag AS talk_group_name
        FROM transcriptions t
        LEFT JOIN talk_groups tg ON t.talk_group_id = tg.id
        WHERE t.talk_group_id = ? AND t.id > ?
        ORDER BY t.id ASC
        LIMIT 3 OFFSET ?
        `,
        [talkGroupId, callId, skip],
        (err, rows) => {
          if (err) {
            console.error('Error fetching additional transcriptions:', err);
            return res.status(500).json({ error: 'Internal Server Error' });
          }
          // ADD LOGGING HERE
          console.log(`[/api/additional-transcriptions] Responding with ${rows.length} rows. First row ID: ${rows.length > 0 ? rows[0].id : 'N/A'}`);
          res.json(rows);
        }
      );
    }
  );
});

// NEW Endpoint for Talkgroup History
app.get('/api/talkgroup/:talkgroupId/calls', (req, res) => {
  const talkgroupId = parseInt(req.params.talkgroupId, 10);
  const sinceId = parseInt(req.query.sinceId, 10) || 0; // For polling
  const limit = parseInt(req.query.limit, 10) || 30; // Default limit 30
  const offset = parseInt(req.query.offset, 10) || 0; // Default offset 0

  if (isNaN(talkgroupId)) {
    return res.status(400).json({ error: 'Invalid talkgroup ID' });
  }

  let query;
  const params = [];

  if (sinceId > 0) {
    // Polling request: Get calls strictly newer than the last known ID (limit doesn't apply here)
    console.log(`Polling calls for talkgroup ${talkgroupId} since ID: ${sinceId}`);
    query = `
      SELECT t.id, t.transcription, t.timestamp, tg.alpha_tag AS talk_group_name
      FROM transcriptions t
      LEFT JOIN talk_groups tg ON t.talk_group_id = tg.id
      WHERE t.talk_group_id = ? AND t.id > ?
        AND t.transcription IS NOT NULL
      ORDER BY t.id ASC -- Fetch oldest first when polling since ID 
    `;
    params.push(talkgroupId, sinceId);
  } else {
    // Initial load or subsequent page request: Use LIMIT and OFFSET
    console.log(`Fetching calls for talkgroup ${talkgroupId} with limit: ${limit}, offset: ${offset}`);
    query = `
      SELECT t.id, t.transcription, t.timestamp, tg.alpha_tag AS talk_group_name
      FROM transcriptions t
      LEFT JOIN talk_groups tg ON t.talk_group_id = tg.id
      WHERE t.talk_group_id = ? 
        AND t.transcription IS NOT NULL
      ORDER BY t.timestamp DESC -- Show newest first overall
      LIMIT ? OFFSET ?
    `;
    params.push(talkgroupId, limit, offset);
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error(`Error fetching calls for talkgroup ${talkgroupId}:`, err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    if (sinceId > 0) {
       console.log(`Poll returned ${rows.length} calls for talkgroup ${talkgroupId} since ID ${sinceId}`); 
    } else {
       console.log(`Paginated load returned ${rows.length} calls for talkgroup ${talkgroupId}`);
    }
    res.json(rows);
  });
});
// END NEW Endpoint

// NEW Endpoint to get details for a single call (for live feed retries)
app.get('/api/call/:id/details', (req, res) => {
  const callId = parseInt(req.params.id, 10);

  if (isNaN(callId)) {
    return res.status(400).json({ error: 'Invalid call ID' });
  }

  db.get(
    `
    SELECT t.id, t.transcription, t.timestamp, t.talk_group_id, tg.alpha_tag AS talk_group_name
    FROM transcriptions t
    LEFT JOIN talk_groups tg ON t.talk_group_id = tg.id
    WHERE t.id = ?
    `,
    [callId],
    (err, row) => {
      if (err) {
        console.error(`Error fetching details for call ${callId}:`, err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      if (!row) {
        return res.status(404).json({ error: 'Call not found' });
      }
      // console.log(`[API Call Details] Returning details for ID: ${callId}`); // Optional: verbose log
      res.json(row);
    }
  );
});

// Socket.IO Setup
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// --- Start Polling Logic --- 

// State variables for polling
let lastCallId = 0; // For map updates
let lastLiveFeedCallId = 0; // For live feed updates

// Initialization functions
function initializeLastCallId() {
  db.get('SELECT MAX(id) AS maxId FROM transcriptions', (err, row) => {
    if (err) {
      console.error('Error initializing lastCallId:', err.message);
    } else {
      lastCallId = row.maxId || 0;
      console.log(`Initialized lastCallId (for map) to ${lastCallId}`);
    }
  });
}

function initializeLastLiveFeedCallId() {
  db.get('SELECT MAX(id) AS maxId FROM transcriptions', (err, row) => {
    if (err) {
      console.error('Error initializing lastLiveFeedCallId:', err.message);
    } else {
      lastLiveFeedCallId = row.maxId || 0;
      console.log(`Initialized lastLiveFeedCallId (for feed) to ${lastLiveFeedCallId}`);
    }
  });
}


// Polling function for MAP updates (requires lat/lon)
function checkForNewCalls() {
  db.all(
    `
    SELECT t.*, tg.alpha_tag AS talk_group_name, tg.tag AS talk_group_tag
    FROM transcriptions t
    LEFT JOIN talk_groups tg ON t.talk_group_id = tg.id
    WHERE t.id > ? 
      AND t.lat IS NOT NULL
      AND t.lon IS NOT NULL
      AND t.lat BETWEEN -90 AND 90 
      AND t.lon BETWEEN -180 AND 180
    ORDER BY t.id ASC
    LIMIT 10 -- Limit to prevent flooding
    `,
    [lastCallId],
    async (err, rows) => {
      if (err) {
        console.error('Error checking for new map calls:', err.message);
        return;
      }
      
      let updatedLastId = lastCallId;
      if (rows && rows.length > 0) {
          for (const row of rows) {
              if (row.id > updatedLastId) {
                  updatedLastId = row.id; // Track highest ID fetched
              }

              // --- Process Category --- 
              if (!row.category && row.transcription) {
                  try {
                      const category = await generateShortSummary(row.transcription);
                      if (category) {
                          console.log(`Generated category for map call ID ${row.id}: "${category}"`);
                          await new Promise((resolve, reject) => {
                              db.run(
                                  `UPDATE transcriptions SET category = ? WHERE id = ?`,
                                  [category, row.id],
                                  function(dbErr) {
                                      if (dbErr) reject(dbErr);
                                      else resolve();
                                  }
                              );
                          });
                          row.category = category;
                      }
                  } catch (categoryError) {
                      console.error(`Error generating category for map call ID ${row.id}:`, categoryError);
                  }
              }
              // --- End Category Processing ---

              // Timestamp from DB is now Unix seconds
              // const numericTimestamp = Math.floor(new Date(row.timestamp).getTime() / 1000);
              // if (isNaN(numericTimestamp)) {
              //  console.error(`Invalid timestamp in polling (newCall): ${row.timestamp} for call ID ${row.id}`);
              //  continue; // Skip this row
              // }
              // const processedRow = { ...row, timestamp: numericTimestamp };

              // --- Emission Logic with Timeout --- 
              if (row.transcription) {
                   // Has transcription, emit immediately
                  io.emit('newCall', row); // row.timestamp is already Unix seconds
              } else {
                  // No transcription yet, check age
                  // row.timestamp is Unix seconds, multiply by 1000 for JS Date
                  const callAgeMs = Date.now() - (row.timestamp * 1000);
                  if (callAgeMs > 10000) { // 10 second timeout
                      // Timeout exceeded, emit with placeholder
                      const rowWithPlaceholder = { ...row, transcription: "[Transcription Pending...]" };
                      io.emit('newCall', rowWithPlaceholder);
                  } else {
                      // Too new and no transcription, wait 
                  }
              }
              // --- End Emission Logic ---
          }
          // Update state variable *after* processing batch with highest ID *fetched*
          if (updatedLastId > lastCallId) {
              lastCallId = updatedLastId;
          }
      }
    }
  );
}

// Polling function specifically for the LIVE FEED (no location check)
function checkForLiveFeedCalls() {
  db.all(
    `
    SELECT t.id, t.talk_group_id, t.transcription, t.timestamp,
           t.audio_file_path, -- Added audio_file_path for potential use
           tg.alpha_tag AS talk_group_name
    FROM transcriptions t
    LEFT JOIN talk_groups tg ON t.talk_group_id = tg.id
    WHERE t.id > ? 
    ORDER BY t.id ASC
    LIMIT 10 -- Limit to prevent flooding
    `,
    [lastLiveFeedCallId],
    (err, rows) => {
      if (err) {
        console.error('Error checking for live feed calls:', err.message);
        return;
      }
      
      let highestEmittedId = lastLiveFeedCallId; // Track the highest ID we ACTUALLY emit

      if (rows && rows.length > 0) {
          rows.forEach(row => {
              // Timestamp from DB is now Unix seconds
              // const numericTimestamp = Math.floor(new Date(row.timestamp).getTime() / 1000);
              // if (isNaN(numericTimestamp)) {
              //  console.error(`Invalid timestamp in polling (liveFeedUpdate): ${row.timestamp} for call ID ${row.id}`);
              //  return; // Skip this iteration of forEach
              // }
              // const processedRow = { ...row, timestamp: numericTimestamp };

              let shouldEmit = false;
              // --- Emission Logic with Timeout ---
              if (row.transcription) {
                   // Has transcription, emit immediately
                   shouldEmit = true;
              } else {
                   // No transcription yet, check age
                   // row.timestamp is Unix seconds, multiply by 1000 for JS Date
                  const callAgeMs = Date.now() - (row.timestamp * 1000);
                  if (callAgeMs > 10000) { // 10 second timeout
                      // Timeout exceeded, emit with placeholder
                      // Create a new object for the row with placeholder to avoid modifying original row in loop
                      // const rowWithPlaceholder = { ...row, transcription: "[Transcription Pending...]" };
                      // io.emit('liveFeedUpdate', rowWithPlaceholder);
                      // shouldEmit = true; // This was incorrect, emission is handled below
                      row.transcription = "[Transcription Pending...]"; // Modify row for this emission
                      shouldEmit = true;
                  } else {
                      // Too new and no transcription, wait (DO NOTHING)
                  }
              }
              // --- End Emission Logic ---
              
              // Emit only if decided
              if (shouldEmit) {
                 io.emit('liveFeedUpdate', row); // row.timestamp is already Unix seconds
                 // Update highestEmittedId only when we actually emit
                 if (row.id > highestEmittedId) {
                    highestEmittedId = row.id;
                 }
              }
          });

          // Update state variable *after* processing batch using the highest EMITTED ID
          if (highestEmittedId > lastLiveFeedCallId) {
              lastLiveFeedCallId = highestEmittedId;
          }
      }
    }
  );
}

// Initialize last IDs and start polling intervals
initializeLastCallId();
initializeLastLiveFeedCallId();
setInterval(checkForNewCalls, 2000); // Poll for map updates every 2s
setInterval(checkForLiveFeedCalls, 2500); // Poll for live feed slightly offset, every 2.5s

// --- End Polling Logic ---

// Server Startup
console.log(`[Webserver] Starting server on port ${portNum}...`);
// #region agent log
fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:4374',message:'Server startup beginning',data:{port:portNum,publicDomain:PUBLIC_DOMAIN},timestamp:Date.now(),sessionId:'debug-session',runId:'server-startup',hypothesisId:'G'})}).catch(()=>{});
// #endregion

// Handle server errors (must be set before listen)
server.on('error', (err) => {
  console.error(`[Webserver] ERROR: Failed to start server on port ${portNum}:`, err.message);
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:4377',message:'Server error event',data:{error:err.message,code:err.code,port:portNum},timestamp:Date.now(),sessionId:'debug-session',runId:'server-startup',hypothesisId:'G'})}).catch(()=>{});
  // #endregion
  if (err.code === 'EADDRINUSE') {
    console.error(`[Webserver] Port ${portNum} is already in use. Please:`);
    console.error(`[Webserver]   1. Stop the process using port ${portNum}`);
    console.error(`[Webserver]   2. Or change WEBSERVER_PORT in .env file`);
  } else if (err.code === 'EACCES') {
    console.error(`[Webserver] Permission denied binding to port ${portNum}.`);
    console.error(`[Webserver] On Linux/macOS, ports <1024 require root privileges.`);
    console.error(`[Webserver] Please use a port >= 1024 or run with appropriate permissions.`);
  }
  process.exit(1);
});

server.listen(portNum, () => {
  console.log(`[Webserver] ✓ Web server running on port ${portNum}`);
  console.log(`[Webserver] ✓ Audio URL base: http://${PUBLIC_DOMAIN}:${portNum}/audio/`);
  console.log(`[Webserver] ✓ Web UI accessible at: http://${PUBLIC_DOMAIN}:${portNum}/`);
  // #region agent log
  fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:4391',message:'Server listening successfully',data:{port:portNum,publicDomain:PUBLIC_DOMAIN},timestamp:Date.now(),sessionId:'debug-session',runId:'server-startup',hypothesisId:'G'})}).catch(()=>{});
  // #endregion
  
  if (authEnabled) {
    console.log('[Webserver] Authentication: ENABLED');
    console.log(`[Webserver] Session duration: ${SESSION_DURATION / (24 * 60 * 60 * 1000)} days`);
    console.log(`[Webserver] Max sessions per user: ${MAX_SESSIONS}`);
  } else {
    console.log('[Webserver] Authentication: DISABLED');
  }
  
  // Log geocoding provider status
  if (geoProviderLower === 'nominatim') {
    console.log('[Webserver] Geocoding provider: Nominatim (free, public service)');
  } else if (GOOGLE_MAPS_API_KEY && typeof GOOGLE_MAPS_API_KEY === 'string' && GOOGLE_MAPS_API_KEY.trim() !== '') {
    console.log('[Webserver] Geocoding provider: Google Maps');
  } else if (LOCATIONIQ_API_KEY && typeof LOCATIONIQ_API_KEY === 'string' && LOCATIONIQ_API_KEY.trim() !== '') {
    console.log('[Webserver] Geocoding provider: LocationIQ');
  }
});

// Get application logs endpoint
app.get('/api/logs', (req, res) => {
  try {
    const filter = req.query.filter || 'all';
    let logContent = '';
    
    // Read log files from logs directory
    const logFiles = fs.readdirSync(logsDir).filter(file => file.endsWith('.log')).sort().reverse();
    
    // Get the most recent log file or filter by type
    let relevantFiles = logFiles;
    if (filter !== 'all') {
      relevantFiles = logFiles.filter(file => {
        const lowerFile = file.toLowerCase();
        if (filter === 'errors') {
          return lowerFile.includes('error') || lowerFile.includes('err');
        } else if (filter === 'webserver') {
          return lowerFile.includes('webserver') || lowerFile.includes('web');
        } else if (filter === 'bot') {
          return lowerFile.includes('bot') || lowerFile.includes('discord');
        } else if (filter === 'transcription') {
          return lowerFile.includes('transcription') || lowerFile.includes('transcribe');
        } else if (filter === 'geocoding') {
          return lowerFile.includes('geocod') || lowerFile.includes('geo');
        }
        return true;
      });
    }
    
    // Read last 1000 lines from relevant files
    const maxLines = 1000;
    let allLines = [];
    
    for (const file of relevantFiles.slice(0, 5)) { // Limit to 5 most recent files
      try {
        const filePath = path.join(logsDir, file);
        const content = fs.readFileSync(filePath, 'utf8');
        const lines = content.split('\n').filter(l => l.trim());
        allLines.push(...lines.map(line => `[${file}] ${line}`));
      } catch (err) {
        console.error(`Error reading log file ${file}:`, err);
      }
    }
    
    // Sort by timestamp if possible, otherwise reverse
    allLines = allLines.slice(-maxLines);
    logContent = allLines.join('\n');
    
    res.json({ success: true, logs: logContent || 'No logs available' });
  } catch (error) {
    console.error('Error reading logs:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add correction logging endpoint
app.post('/api/log/correction', (req, res) => {
  const { callId, originalAddress, newAddress } = req.body;

  if (!callId || !originalAddress || !newAddress) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const logData = {
    timestamp: new Date().toISOString(),
    callId,
    originalAddress,
    newAddress
  };

  const logFilePath = path.join(logsDir, `corrections_${new Date().toISOString().split('T')[0]}.json`);
  
  // Read existing logs
  let existingLogs = [];
  if (fs.existsSync(logFilePath)) {
    try {
      const fileContent = fs.readFileSync(logFilePath, 'utf8');
      existingLogs = JSON.parse(fileContent);
    } catch (err) {
      console.error('Error reading log file:', err);
    }
  }

  // Add new log entry
  existingLogs.push(logData);

  // Write back to file
  fs.writeFile(logFilePath, JSON.stringify(existingLogs, null, 2), (err) => {
    if (err) {
      console.error('Error writing to log file:', err);
      return res.status(500).json({ error: 'Failed to write to log' });
    }
    res.json({ success: true });
  });
});

// Setup Wizard API Endpoints
app.get('/api/wizard/detect-system', async (req, res) => {
  try {
    const os = require('os');
    const { execSync } = require('child_process');
    const fs = require('fs');
    
    // Default detections - will be populated with available info
    const detections = {
      os: 'unknown',
      arch: 'unknown',
      cpu: 'Unknown',
      cpuCores: 0,
      ram: 'Unknown',
      docker: false,
      runningInDocker: false,
      installationType: 'local',
      sdrDevices: []
    };
    
    // Safely get OS info
    try {
      detections.os = os.platform() || 'unknown';
      detections.arch = os.arch() || 'unknown';
      detections.cpu = os.cpus()[0]?.model || 'Unknown';
      detections.cpuCores = os.cpus().length || 0;
      detections.ram = `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`;
    } catch (err) {
      console.warn('[System Detection] Error getting OS info:', err.message);
    }
    
    // Check if running inside Docker container
    let runningInDocker = false;
    try {
      // Check for .dockerenv file
      if (fs.existsSync('/.dockerenv')) {
        runningInDocker = true;
      }
      // Check cgroup (Linux) - only if file exists
      if (!runningInDocker && fs.existsSync('/proc/self/cgroup')) {
        try {
          const cgroup = fs.readFileSync('/proc/self/cgroup', 'utf8');
          if (cgroup.includes('docker') || cgroup.includes('containerd')) {
            runningInDocker = true;
          }
        } catch (err) {
          // Can't read cgroup, continue
        }
      }
      // Check environment variables
      if (!runningInDocker && (process.env.DOCKER_CONTAINER === 'true' || process.env.container === 'docker')) {
        runningInDocker = true;
      }
      detections.runningInDocker = runningInDocker;
    } catch (err) {
      console.warn('[System Detection] Error detecting Docker environment:', err.message);
      // Continue with defaults
    }
    
    // Check if Docker CLI is available (for managing containers)
    let dockerAvailable = false;
    try {
      execSync('docker --version', { stdio: 'ignore', timeout: 2000 });
      dockerAvailable = true;
    } catch (err) {
      dockerAvailable = false;
    }
    detections.docker = dockerAvailable;
    
    // Auto-detect installation type
    detections.installationType = runningInDocker ? 'docker' : (dockerAvailable ? 'local' : 'local');
    
    // Detect GPU (optional, don't fail if this doesn't work)
    try {
      if (detections.docker) {
        try {
          const gpuInfo = execSync('docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi --query-gpu=name --format=csv,noheader', { 
            stdio: 'pipe',
            timeout: 5000 
          }).toString().trim();
          if (gpuInfo && !gpuInfo.includes('error')) {
            detections.gpu = { name: gpuInfo.split('\n')[0], vendor: 'NVIDIA' };
          }
        } catch (err) {
          // No GPU or NVIDIA toolkit not installed - this is fine
        }
      }
    } catch (err) {
      // GPU detection failed - this is fine, continue without GPU info
    }
    
    res.json({ success: true, systemInfo: detections, detections: detections });
  } catch (error) {
    console.warn('[System Detection] Error detecting system:', error.message);
    // Return defaults instead of error - don't fail the wizard
    const defaults = {
      os: process.platform || 'unknown',
      arch: process.arch || 'unknown',
      cpu: 'Unknown',
      cpuCores: 0,
      ram: 'Unknown',
      docker: false,
      runningInDocker: false,
      installationType: 'local',
      sdrDevices: []
    };
    res.json({ success: true, systemInfo: defaults, detections: defaults });
  }
});

app.get('/api/wizard/detect-sdr', async (req, res) => {
  try {
    const SDRDetector = require('./scripts/installer/sdr-detector');
    const detector = new SDRDetector();
    const devices = await detector.detectDevices();
    
    res.json({ success: true, devices });
  } catch (error) {
    console.error('Error detecting SDR devices:', error);
    res.json({ success: true, devices: [] }); // Return empty array on error
  }
});

app.get('/api/wizard/detect-service', async (req, res) => {
  try {
    const serviceName = req.query.service;
    const defaultPort = parseInt(req.query.port) || 11434;
    const currentUrl = req.query.currentUrl || null;
    
    const detectedUrl = await detectServiceUrl(serviceName, defaultPort, currentUrl);
    
    res.json({ success: true, url: detectedUrl });
  } catch (error) {
    console.error('Error detecting service:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/wizard/apply', async (req, res) => {
  try {
    const config = req.body;
    const envPath = path.join(process.cwd(), '.env');
    let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
    
    // Apply location configuration
    if (config.location) {
      envContent = updateEnvVar(envContent, 'GEOCODING_CITY', config.location.city);
      envContent = updateEnvVar(envContent, 'GEOCODING_STATE', config.location.state);
      envContent = updateEnvVar(envContent, 'GEOCODING_COUNTRY', config.location.country || 'us');
      if (config.location.counties) {
        envContent = updateEnvVar(envContent, 'GEOCODING_COUNTIES', config.location.counties);
      }
    }
    
    // Apply installation type
    if (config.installationType) {
      // This affects how services are configured
      // For now, we'll set appropriate defaults based on type
    }
    
    // Apply transcription mode
    if (config.transcriptionMode) {
      envContent = updateEnvVar(envContent, 'TRANSCRIPTION_MODE', config.transcriptionMode);
      if (config.transcriptionMode === 'icad' && config.icadUrl) {
        envContent = updateEnvVar(envContent, 'ICAD_URL', config.icadUrl);
      }
      if (config.transcriptionMode === 'openai' && config.openaiApiKey) {
        envContent = updateEnvVar(envContent, 'OPENAI_API_KEY', config.openaiApiKey);
      }
    }
    
    // Apply AI provider
    if (config.aiProvider) {
      envContent = updateEnvVar(envContent, 'AI_PROVIDER', config.aiProvider);
      if (config.aiProvider === 'ollama') {
        if (config.ollamaUrl) envContent = updateEnvVar(envContent, 'OLLAMA_URL', config.ollamaUrl);
        if (config.ollamaModel) envContent = updateEnvVar(envContent, 'OLLAMA_MODEL', config.ollamaModel);
      } else if (config.aiProvider === 'openai') {
        if (config.openaiAiApiKey) envContent = updateEnvVar(envContent, 'OPENAI_API_KEY', config.openaiAiApiKey);
        if (config.openaiModel) envContent = updateEnvVar(envContent, 'OPENAI_MODEL', config.openaiModel);
      }
    }
    
    // Import channels if provided
    if (config.importedChannels && config.importedChannels.length > 0) {
      // #region agent log
      fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:4703',message:'Starting talkgroups import',data:{count:config.importedChannels.length},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      
      // Import talkgroups to database - FIXED: use correct database path and table/column names
      const importDb = new sqlite3.Database('./botdata.db', sqlite3.OPEN_READWRITE, (err) => {
        if (err) {
          console.error('Error opening database for import:', err);
          // #region agent log
          fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:4708',message:'Database open error for import',data:{error:err.message},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
          return;
        }
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:4712',message:'Database opened for import',data:{path:'./botdata.db'},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
        
        // FIXED: Use correct table name (talk_groups) and column name (id instead of dec)
        const insertStmt = importDb.prepare(`INSERT OR REPLACE INTO talk_groups (id, hex, alpha_tag, mode, description, tag, county) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        
        let imported = 0;
        let errors = 0;
        
        for (const tg of config.importedChannels) {
          try {
            // FIXED: Use tg.dec as the id (convert to string if needed)
            insertStmt.run(
              String(tg.dec || tg.id || ''),
              tg.hex || '',
              tg.alphaTag || '',
              tg.mode || '',
              tg.description || '',
              tg.tag || '',
              tg.county || ''
            );
            imported++;
          } catch (err) {
            console.error('Error importing talkgroup:', err);
            errors++;
            // #region agent log
            fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:4733',message:'Error importing talkgroup',data:{error:err.message,tg:tg},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'B'})}).catch(()=>{});
            // #endregion
          }
        }
        
        insertStmt.finalize();
        importDb.close();
        
        console.log(`Imported ${imported} talkgroups${errors > 0 ? ` (${errors} errors)` : ''}`);
        // #region agent log
        fetch('http://127.0.0.1:7244/ingest/2b494bf2-d357-4b23-b8b5-608776efa70d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'webserver.js:4742',message:'Import completed',data:{imported,errors},timestamp:Date.now(),sessionId:'debug-session',runId:'db-init',hypothesisId:'B'})}).catch(()=>{});
        // #endregion
      });
    }
    
    // Write .env file
    fs.writeFileSync(envPath, envContent);
    
    res.json({ 
      success: true, 
      message: 'Configuration applied successfully. Please restart the application for changes to take effect.' 
    });
  } catch (error) {
    console.error('Error applying wizard configuration:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

function updateEnvVar(envContent, key, value) {
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(envContent)) {
    return envContent.replace(regex, `${key}=${value}`);
  } else {
    return envContent + (envContent.endsWith('\n') ? '' : '\n') + `${key}=${value}\n`;
  }
}

// NEW Endpoint for logging deletions
app.post('/api/log/deletion', (req, res) => {
  const { callId, category, transcription, location, address, action } = req.body;

  // Basic validation - check for essential fields
  if (!callId || action !== 'marker_deletion') {
    return res.status(400).json({ error: 'Missing required fields for deletion log' });
  }

  const logData = {
    timestamp: new Date().toISOString(),
    callId,
    category: category || 'UNKNOWN',
    transcription: transcription || 'N/A',
    location: location || null,
    address: address || 'N/A',
    action
  };

  const logFilePath = path.join(logsDir, `deletions_${new Date().toISOString().split('T')[0]}.json`);

  // Read existing logs for deletions
  let existingLogs = [];
  if (fs.existsSync(logFilePath)) {
    try {
      const fileContent = fs.readFileSync(logFilePath, 'utf8');
      if (fileContent) { // Check if file is not empty
           existingLogs = JSON.parse(fileContent);
           if (!Array.isArray(existingLogs)) { // Ensure it's an array
               console.warn('Deletion log file was not an array, resetting.');
               existingLogs = [];
           }
       } else {
           existingLogs = [];
       }
    } catch (err) {
      console.error('Error reading deletion log file:', err);
      existingLogs = []; // Reset if reading fails
    }
  }

  // Add new log entry
  existingLogs.push(logData);

  // Write back to file
  fs.writeFile(logFilePath, JSON.stringify(existingLogs, null, 2), (err) => {
    if (err) {
      console.error('Error writing to deletion log file:', err);
      // Still return success to client, as the main operation (deletion) likely succeeded
      // but log the server-side error.
      return res.status(500).json({ error: 'Failed to write to deletion log' });
    }
    console.log(`Deletion logged successfully for callId: ${callId}`);
    res.json({ success: true, message: 'Deletion logged.' });
  });
});

// Get all talkgroups for selection UI
app.get('/api/talkgroups', (req, res) => {
  db.all(
    `SELECT id, alpha_tag, tag 
     FROM talk_groups 
     ORDER BY alpha_tag ASC`, // Order alphabetically for easier browsing
    [], 
    (err, rows) => {
      if (err) {
        console.error('Error fetching talkgroups:', err);
        return res.status(500).json({ error: 'Internal server error' });
      }
      // Combine alpha_tag and tag for display if alpha_tag exists
      const talkgroups = rows.map(tg => ({
        id: tg.id,
        name: tg.alpha_tag ? `${tg.alpha_tag} (${tg.tag || tg.id})` : (tg.tag || `ID: ${tg.id}`)
      }));
      res.json(talkgroups);
    }
  );
});

// Get all available categories for selection UI
app.get('/api/categories', (req, res) => {
  const categories = [
    'Medical Emergency', 'Injured Person', 'Disturbance', 'Vehicle Collision',
    'Burglary', 'Assault', 'Structure Fire', 'Missing Person', 'Medical Call',
    'Building Fire', 'Stolen Vehicle', 'Service Call', 'Vehicle Stop',
    'Unconscious Person', 'Reckless Driver', 'Person With A Gun',
    'Altered Level of Consciousness', 'Breathing Problems', 'Fight',
    'Carbon Monoxide', 'Abduction', 'Passed Out Person', 'Hazmat',
    'Fire Alarm', 'Traffic Hazard', 'Intoxicated Person', 'Mvc',
    'Animal Bite', 'Assist', 'Other'
  ];
  
  res.json(categories);
});

// Get count of calls that would be purged (Admin Only when auth is enabled)
app.get('/api/calls/purge-count', async (req, res) => {
  // Check authentication if enabled
  if (ENABLE_AUTH?.toLowerCase() === 'true') {
    const authHeader = req.headers.authorization;
    if (!authHeader || !(await isAdminUser(authHeader))) {
      return res.status(403).json({ error: 'Admin access required' });
    }
  }

  // Parse query parameters - handle both array and single values
  const talkgroupIds = req.query.talkgroupIds ? 
    (Array.isArray(req.query.talkgroupIds) ? req.query.talkgroupIds : [req.query.talkgroupIds]) : [];
  const categories = req.query.categories ? 
    (Array.isArray(req.query.categories) ? req.query.categories : [req.query.categories]) : [];
  
  // Handle timeRange parameters from query string
  const timeRangeStart = req.query.timeRangeStart;
  const timeRangeEnd = req.query.timeRangeEnd;

  // Validate input
  if (!timeRangeStart || !timeRangeEnd) {
    return res.status(400).json({ error: 'Time range is required' });
  }

  // Build the WHERE clause dynamically
  let whereConditions = ['lat IS NOT NULL AND lon IS NOT NULL']; // Only count calls that have coordinates
  let params = [];

  // Add talkgroup filter if specified
  if (talkgroupIds.length > 0) {
    whereConditions.push(`talk_group_id IN (${talkgroupIds.map(() => '?').join(',')})`);
    params.push(...talkgroupIds);
  }

  // Add category filter if specified
  if (categories.length > 0) {
    // Use UPPER() to make case-insensitive comparison
    whereConditions.push(`UPPER(category) IN (${categories.map(() => 'UPPER(?)').join(',')})`);
    params.push(...categories);
  }

  // Add time range filter
  whereConditions.push('timestamp BETWEEN ? AND ?');
  const startTime = parseInt(timeRangeStart);
  const endTime = parseInt(timeRangeEnd);
  
  // Validate parsed timestamps
  if (isNaN(startTime) || isNaN(endTime)) {
    console.error(`[Purge Count] Invalid timestamps: start=${timeRangeStart} (parsed: ${startTime}), end=${timeRangeEnd} (parsed: ${endTime})`);
    return res.status(400).json({ error: 'Invalid timestamp format' });
  }
  
  params.push(startTime, endTime);

  const whereClause = whereConditions.join(' AND ');

  // Execute the count query
  const countQuery = `SELECT COUNT(*) as count FROM transcriptions WHERE ${whereClause}`;
  
  // Check if database is available
  if (!db) {
    console.error('[Purge Count] Database not available');
    return res.status(500).json({ error: 'Database not available' });
  }
  
  db.get(countQuery, params, (err, row) => {
    if (err) {
      console.error('Error counting calls:', err);
      return res.status(500).json({ error: 'Failed to count calls' });
    }

    if (!row) {
      console.error('[Purge Count] No result from count query');
      return res.status(500).json({ error: 'Failed to count calls - no result' });
    }

    res.json({ 
      success: true, 
      count: row.count
    });
  });
});

// Purge calls by setting coordinates to NULL (Admin Only when auth is enabled)
app.post('/api/calls/purge', async (req, res) => {
  try {
    // Check authentication if enabled
    if (ENABLE_AUTH?.toLowerCase() === 'true') {
      const authHeader = req.headers.authorization;
      if (!authHeader || !(await isAdminUser(authHeader))) {
        return res.status(403).json({ error: 'Admin access required' });
      }
    }

    const { talkgroupIds, categories, timeRangeStart, timeRangeEnd } = req.body;

    // Validate input
    if (!timeRangeStart || !timeRangeEnd) {
      return res.status(400).json({ error: 'Time range is required' });
    }

    // Build the WHERE clause dynamically
    let whereConditions = ['lat IS NOT NULL AND lon IS NOT NULL']; // Only purge calls that have coordinates
    let params = [];

      // Add talkgroup filter if specified
  // If no talkgroups selected, it means "all talkgroups" (no filter applied)
  if (talkgroupIds && talkgroupIds.length > 0) {
    whereConditions.push(`talk_group_id IN (${talkgroupIds.map(() => '?').join(',')})`);
    params.push(...talkgroupIds);
  }
  // If no talkgroups selected, don't add any filter - this means "all talkgroups"

    // Add category filter if specified
    if (categories && categories.length > 0) {
      // Use UPPER() to make case-insensitive comparison
      whereConditions.push(`UPPER(category) IN (${categories.map(() => 'UPPER(?)').join(',')})`);
      params.push(...categories);
    }

    // Add time range filter
    whereConditions.push('timestamp BETWEEN ? AND ?');
    const startTime = parseInt(timeRangeStart);
    const endTime = parseInt(timeRangeEnd);
    
    // Validate parsed timestamps
    if (isNaN(startTime) || isNaN(endTime)) {
      console.error(`[Purge] Invalid timestamps: start=${timeRangeStart} (parsed: ${startTime}), end=${timeRangeEnd} (parsed: ${endTime})`);
      return res.status(400).json({ error: 'Invalid timestamp format' });
    }
    
    params.push(startTime, endTime);

    const whereClause = whereConditions.join(' AND ');

    // Check if database is available
    if (!db) {
      console.error('[Purge] Database not available');
      return res.status(500).json({ error: 'Database not available' });
    }

    // Store original coordinates before purging
    try {
      const originalCoords = await storeOriginalCoordinates(talkgroupIds, categories, startTime, endTime);
      
      // Execute the purge query
      const purgeQuery = `UPDATE transcriptions SET lat = NULL, lon = NULL WHERE ${whereClause}`;
      
      db.run(purgeQuery, params, function(err) {
        if (err) {
          console.error('Error purging calls:', err);
          return res.status(500).json({ error: 'Failed to purge calls' });
        }

        // Store the last purge details for undo functionality
        lastPurgeDetails = {
          talkgroupIds: talkgroupIds || [],
          categories: categories || [],
          timeRangeStart: startTime,
          timeRangeEnd: endTime,
          purgedCount: this.changes,
          timestamp: Date.now(),
          originalCoordinates: originalCoords
        };

        res.json({ 
          success: true, 
          purgedCount: this.changes,
          message: `Successfully purged ${this.changes} calls from the map`
        });
      });
    } catch (coordError) {
      console.error('Error storing original coordinates:', coordError);
      return res.status(500).json({ error: 'Failed to store original coordinates for undo' });
    }
  } catch (error) {
    console.error('Unexpected error in purge endpoint:', error);
    res.status(500).json({ error: 'Internal server error during purge operation' });
  }
});

// Check if there's a purge operation that can be undone
app.get('/api/calls/can-undo-purge', async (req, res) => {
  // Check authentication if enabled
  if (ENABLE_AUTH?.toLowerCase() === 'true') {
    const authHeader = req.headers.authorization;
    if (!authHeader || !(await isAdminUser(authHeader))) {
      return res.status(403).json({ error: 'Admin access required' });
    }
  }

  if (!lastPurgeDetails) {
    return res.json({ canUndo: false, message: 'No purge operation to undo' });
  }

  // No time limit for undo operations

  res.json({ 
    canUndo: true, 
    message: `Can undo purge of ${lastPurgeDetails.purgedCount} calls`,
    purgeDetails: {
      categories: lastPurgeDetails.categories,
      talkgroups: lastPurgeDetails.talkgroupIds,
      timeRange: {
        start: new Date(lastPurgeDetails.timeRangeStart * 1000).toLocaleString(),
        end: new Date(lastPurgeDetails.timeRangeEnd * 1000).toLocaleString()
      },
      timestamp: new Date(lastPurgeDetails.timestamp).toLocaleString()
    }
  });
});

// Undo last purge operation (Admin Only when auth is enabled)
app.post('/api/calls/undo-last-purge', async (req, res) => {
  try {
    // Check authentication if enabled
    if (ENABLE_AUTH?.toLowerCase() === 'true') {
      const authHeader = req.headers.authorization;
      if (!authHeader || !(await isAdminUser(authHeader))) {
        return res.status(403).json({ error: 'Admin access required' });
      }
    }

    // Check if there's a last purge to undo
    if (!lastPurgeDetails) {
      return res.status(400).json({ error: 'No purge operation to undo' });
    }

    // No time limit for undo operations

    // Build the WHERE clause to restore coordinates
    let whereConditions = ['lat IS NULL AND lon IS NULL']; // Only restore calls that have no coordinates
    let params = [];

    // Add talkgroup filter if specified
    if (lastPurgeDetails.talkgroupIds && lastPurgeDetails.talkgroupIds.length > 0) {
      whereConditions.push(`talk_group_id IN (${lastPurgeDetails.talkgroupIds.map(() => '?').join(',')})`);
      params.push(...lastPurgeDetails.talkgroupIds);
    }

    // Add category filter if specified
    if (lastPurgeDetails.categories && lastPurgeDetails.categories.length > 0) {
      // Use UPPER() to make case-insensitive comparison
      whereConditions.push(`UPPER(category) IN (${lastPurgeDetails.categories.map(() => 'UPPER(?)').join(',')})`);
      params.push(...lastPurgeDetails.categories);
    }

    // Add time range filter
    whereConditions.push('timestamp BETWEEN ? AND ?');
    params.push(lastPurgeDetails.timeRangeStart, lastPurgeDetails.timeRangeEnd);

    const whereClause = whereConditions.join(' AND ');

    // Execute the restore query
    const restoreQuery = `UPDATE transcriptions SET lat = (SELECT lat FROM transcriptions_backup WHERE id = transcriptions.id), lon = (SELECT lon FROM transcriptions_backup WHERE id = transcriptions.id) WHERE ${whereClause}`;
    
    // Since we don't have a backup table, we'll need to restore from the original coordinates
    // For now, we'll use a different approach - restore based on the original query
    const restoreQuery2 = `UPDATE transcriptions SET lat = (SELECT lat FROM transcriptions WHERE id = transcriptions.id), lon = (SELECT lon FROM transcriptions WHERE id = transcriptions.id) WHERE ${whereClause}`;
    
    // Check if database is available
    if (!db) {
      console.error('[Undo Purge] Database not available');
      return res.status(500).json({ error: 'Database not available' });
    }

    // Check if we have the original coordinates stored
    if (!lastPurgeDetails.originalCoordinates || lastPurgeDetails.originalCoordinates.length === 0) {
      return res.status(400).json({ error: 'No original coordinates available for restoration' });
    }

    // Restore the original coordinates for each call
    let restoredCount = 0;
    let hasError = false;

    for (const coord of lastPurgeDetails.originalCoordinates) {
      const restoreQuery = `UPDATE transcriptions SET lat = ?, lon = ? WHERE id = ?`;
      
      db.run(restoreQuery, [coord.lat, coord.lon, coord.id], function(err) {
        if (err) {
          console.error(`Error restoring coordinates for call ${coord.id}:`, err);
          hasError = true;
        } else {
          restoredCount++;
        }
      });
    }

    // Wait a bit for all updates to complete, then respond
    setTimeout(() => {
      if (hasError) {
        return res.status(500).json({ error: 'Some calls could not be restored' });
      }

      // Clear the last purge details after successful undo
      const undonePurgeDetails = { ...lastPurgeDetails };
      lastPurgeDetails = null;

      res.json({ 
        success: true, 
        restoredCount: restoredCount,
        message: `Successfully restored ${restoredCount} calls to the map`,
        undonePurge: undonePurgeDetails
      });
    }, 100);

  } catch (error) {
    console.error('Unexpected error in undo purge endpoint:', error);
    res.status(500).json({ error: 'Internal server error during undo operation' });
  }
});

// General error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Graceful Shutdown
process.on('SIGINT', () => {
  console.log('Shutting down web server gracefully...');
  server.close(() => {
    console.log('Express server closed.');
    db.close((err) => {
      if (err) {
        console.error('Error closing database connection:', err);
      } else {
        console.log('Database connection closed.');
      }
      process.exit(0);
    });
  });
});