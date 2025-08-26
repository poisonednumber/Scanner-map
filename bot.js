// bot.js - Main Discord bot application with integrated webserver and initialization

require('dotenv').config();

// Get environment variables first, before any usage
const {
  BOT_PORT: PORT,  
  PUBLIC_DOMAIN,
  DISCORD_TOKEN,
  MAPPED_TALK_GROUPS: mappedTalkGroupsString, 
  TIMEZONE,
  API_KEY_FILE,
  SUMMARY_LOOKBACK_HOURS,
  TRANSCRIPTION_MODE,
  FASTER_WHISPER_SERVER_URL,
  WHISPER_MODEL,
  STORAGE_MODE,
  S3_ENDPOINT,
  S3_BUCKET_NAME,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY,
  ASK_AI_LOOKBACK_HOURS,
  MAX_CONCURRENT_TRANSCRIPTIONS,
  // --- NEW: AI Provider Env Vars ---
  AI_PROVIDER,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  OLLAMA_URL,
  OLLAMA_MODEL,
  TRANSCRIPTION_DEVICE,
  // --- NEW: Python Command Override ---
  PYTHON_COMMAND,
  // --- NEW: Auto-update Control ---
  AUTO_UPDATE_PYTHON_PACKAGES = 'true',
  // --- NEW: ICAD Transcription Env Vars ---
  ICAD_URL,
  ICAD_PROFILE,
  ICAD_API_KEY,
  // --- Webserver Env Vars ---
  WEBSERVER_PORT = '3001',
  WEBSERVER_PASSWORD,
  ENABLE_AUTH = 'false',
  SESSION_DURATION_DAYS = '7',
  MAX_SESSIONS_PER_USER = '5',
  GOOGLE_MAPS_API_KEY
} = process.env;

// --- VALIDATE AI-RELATED ENV VARS ---
if (!AI_PROVIDER) {
  console.error("FATAL: AI_PROVIDER is not set in the .env file. Please specify 'ollama' or 'openai'.");
  process.exit(1);
}

if (AI_PROVIDER.toLowerCase() === 'openai') {
  if (!OPENAI_API_KEY || !OPENAI_MODEL) {
      console.error("FATAL: AI_PROVIDER is 'openai', but OPENAI_API_KEY or OPENAI_MODEL is missing in the .env file.");
      process.exit(1);
  }
} else if (AI_PROVIDER.toLowerCase() === 'ollama') {
  if (!OLLAMA_URL || !OLLAMA_MODEL) {
      console.error("FATAL: AI_PROVIDER is 'ollama', but OLLAMA_URL or OLLAMA_MODEL is missing in the .env file.");
      process.exit(1);
  }
} else {
  console.error(`FATAL: Invalid AI_PROVIDER specified in .env file: '${AI_PROVIDER}'. Must be 'openai' or 'ollama'.`);
  process.exit(1);
}
// --- END VALIDATION ---

// --- VALIDATE TRANSCRIPTION-RELATED ENV VARS ---
const effectiveTranscriptionMode = TRANSCRIPTION_MODE || 'local'; // Keep this to ensure a default
if (!['local', 'remote', 'openai', 'icad'].includes(effectiveTranscriptionMode)) {
  console.error(`FATAL: Invalid TRANSCRIPTION_MODE specified in .env file: '${TRANSCRIPTION_MODE}'. Must be 'local', 'remote', 'openai', or 'icad'.`);
  process.exit(1);
}
if (effectiveTranscriptionMode === 'local' && !TRANSCRIPTION_DEVICE) {
  console.error("FATAL: TRANSCRIPTION_MODE is 'local', but TRANSCRIPTION_DEVICE is missing in the .env file. Please set it to 'cuda' for a GPU or 'cpu' for CPU.");
  process.exit(1);
}
if (effectiveTranscriptionMode === 'remote' && !FASTER_WHISPER_SERVER_URL) {
  console.error("FATAL: TRANSCRIPTION_MODE is 'remote', but FASTER_WHISPER_SERVER_URL is missing in the .env file.");
  process.exit(1);
}
if (effectiveTranscriptionMode === 'openai' && !OPENAI_API_KEY) {
  console.error("FATAL: TRANSCRIPTION_MODE is 'openai', but OPENAI_API_KEY is missing in the .env file. This is required for OpenAI transcriptions.");
  process.exit(1);
}
if (effectiveTranscriptionMode === 'icad' && !ICAD_URL) {
  console.error("FATAL: TRANSCRIPTION_MODE is 'icad', but ICAD_URL is missing in the .env file. Please set it to your ICAD API endpoint URL.");
  process.exit(1);
}
// --- END VALIDATION ---

// Now initialize derived variables
const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const busboy = require('busboy');
const sqlite3 = require('sqlite3').verbose();
const { spawn } = require('child_process');
const { Readable } = require('stream');
const fetch = require('node-fetch');
const winston = require('winston');
const moment = require('moment-timezone');
const TALK_GROUPS = {};
const readline = require('readline');
const FormData = require('form-data');
const csv = require('csv-parser');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');
let summaryChannel;
const SUMMARY_INTERVAL = 10 * 60 * 1000; // Changed from 5 to 10 minutes in milliseconds
let lastSummaryUpdate = 0;
let summaryMessage = null;

// Parse lookback hours from environment with fallback to 1 hour
const parsedLookbackHours = parseFloat(SUMMARY_LOOKBACK_HOURS);
const LOOKBACK_HOURS = isNaN(parsedLookbackHours) ? 1 : parsedLookbackHours;
const LOOKBACK_PERIOD = LOOKBACK_HOURS * 60 * 60 * 1000; // Convert hours to milliseconds

// Parse the string into an array
const MAPPED_TALK_GROUPS = mappedTalkGroupsString
  ? mappedTalkGroupsString.split(',').map(id => id.trim())
  : [];

// Parse MAX_CONCURRENT_TRANSCRIPTIONS from env or use default
const parsedMaxConcurrent = parseInt(MAX_CONCURRENT_TRANSCRIPTIONS, 10);
const MAX_CONCURRENT_TRANSCRIPTIONS_VALUE = !isNaN(parsedMaxConcurrent) && parsedMaxConcurrent > 0 ? parsedMaxConcurrent : 3;

// High-volume system optimizations
const MAX_QUEUE_SIZE = 50; // Limit queue size to prevent memory issues
const QUEUE_DRAIN_THRESHOLD = 40; // Start warning when queue gets large
const PRIORITY_QUEUE_THRESHOLD = 30; // Start prioritizing newer items

// NOTE: For very busy systems with lots of concurrent calls, consider:
// 1. Increasing MAX_CONCURRENT_TRANSCRIPTIONS in .env (default is 3, try 5-8 for busy systems)
// 2. Using a faster GPU for local transcription or switching to 'remote' mode
// 3. Monitoring memory usage and adjusting MAX_QUEUE_SIZE if needed
// 4. Consider using 'openai' transcription mode for highest reliability under load

// Whitelist patterns for console INFO messages
const allowedPatterns = [
  // Core dispatch information
  /^--- Incoming Request ---$/,
  /^Talk Group: .+ - .+$/,
  /^Geocoded Address: ".+" with coordinates \(.+, .+\) in .+$/,
  /^Extracted Address:/,

  // Startup & shutdown messages
  /^Shutting down gracefully...$/,
  /^Express server closed.$/,
  /^Discord bot disconnected.$/,
  /^Database connection closed.$/,
  /^Loaded \d+ talk groups from environment variables$/,
  /^Using upload directory: .+$/,
  /^Loaded \d+ API keys.$/,
  /^Starting persistent transcription process \(local mode\)...$/,
  /^Local transcription process spawned, waiting for ready signal...$/,
  /^Local transcription service ready$/,
  /^Bot server is running on port \d+$/,
  /^Connected to SQLite database.$/,
  /^Using talk groups from environment variables. Found \d+ talk groups$/,
  /^Loaded \d+ talk groups for geocoding$/,
  /^Logged in as .+!$/,
  /^Started refreshing application \(\/\) commands.$/,
  /^Successfully reloaded application \(\/\) commands.$/,
  /^Summary channel is ready.$/,
  /^Initializing local transcription process...$/,
  /^Transcription mode set to 'remote'/,
  /^FATAL: TRANSCRIPTION_MODE is remote, but FASTER_WHISPER_SERVER_URL is not set!/,

  // Transcription Text - KEEP THIS
  /^Transcription Text:/,

  // Essential Processing Messages (Uncomment the ones you want to see)
  // /^Received SDRTrunk audio:/,
  // /^Received TrunkRecorder audio:/,
  // /^Saved audio blob for transcription ID/,
  // /^Initiating transcription for/, // <--- COMMENTED OUT THIS LINE
  // /^Updated DB transcription for ID/,
  // /^Successfully processed:/,
  // /^Sent alert message/,
  // /^Playing audio for talk group/,
  // /^Updated summary embed message/,
  // /^Created new summary embed message/,
  // /^Requesting remote model:/,
  // /^Sending remote transcription request for/,
  // /^Received remote transcription for/,

  // Add specific essential INFO messages you *do* want to see below:
  /^Example essential message pattern$/,

];

// Custom Winston format to filter INFO messages based on allowedPatterns
const infoFilter = winston.format((info, opts) => {
  // Only filter 'info' level messages
  if (info.level === 'info') {
    // Check if the message matches any allowed pattern
    const allow = opts.allowedPatterns.some(pattern => pattern.test(info.message));
    // If it doesn't match any pattern, filter it out by returning false
    if (!allow) {
      return false;
    }
  }
  // If it's not 'info' level OR it matched a pattern, pass it through
  return info;
});

// Logger setup
const logger = winston.createLogger({
  level: 'info', // Log info and above to files
  format: winston.format.combine(
    // Default format for files (timestamp + standard json/logfmt)
    winston.format.timestamp({
      format: () => moment().tz(TIMEZONE).format('MM/DD/YYYY HH:mm:ss.SSS')
    }),
    winston.format.errors({ stack: true }), // Log stack traces for errors
    winston.format.splat(),
    winston.format.json() // Log to files as JSON
  ),
  transports: [
    // File transports log everything (info and above) as JSON
    new winston.transports.File({
        filename: 'error.log',
        level: 'error', // Only errors
        format: winston.format.json()
    }),
    new winston.transports.File({
        filename: 'combined.log', // Info, warn, error
        format: winston.format.json()
     }),

    // Console transport has special filtering and coloring
    new winston.transports.Console({
      level: 'info', // Process info and above for the console
      format: winston.format.combine(
        // 1. Add timestamp
        winston.format.timestamp({
          format: () => moment().tz(TIMEZONE).format('MM/DD/YYYY HH:mm:ss.SSS')
        }),
        // 2. Apply the custom info whitelist filter *for console only*
        infoFilter({ allowedPatterns }), // Pass the patterns here
        // 3. Apply coloring/printf format
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
            let color = '\x1b[37m'; // Default white
            let formattedMessage = message;

            // Apply colors based on level first
             if (level === 'error') {
               color = '\x1b[31m'; // Red
             } else if (level === 'warn') {
               color = '\x1b[33m'; // Yellow
             } else if (level === 'debug') { // Debug messages will still be colored if level is set lower
               color = '\x1b[36m'; // Cyan
             }

            // Apply specific content colors (if message is a string)
            if (typeof message === 'string') {
                if (message.includes('Talk Group:') || message.includes('Incoming Request')) {
                    color = '\x1b[33m'; // Yellow overrides level color
                } else if (message.includes('Extracted Address') || message.includes('Geocoded Address')) {
                    color = '\x1b[32m'; // Green overrides level color
                }

                // Handle Transcription Text coloring separately
                const transcriptionPrefix = 'Transcription Text:';
                if (message.startsWith(transcriptionPrefix)) {
                    const actualText = message.substring(transcriptionPrefix.length).trim();
                    // Format: Timestamp [LEVEL] Prefix (Default Color) ActualText (Cyan)
                    formattedMessage = `\x1b[37m${transcriptionPrefix}\x1b[0m \x1b[36m${actualText}\x1b[0m`;
                    // Return directly without applying default level color to the whole line
                     return `${timestamp} [${level.toUpperCase()}] ${formattedMessage}`;
                }
            }

            // Fallback for other messages that passed the filter
            // If it's an error object, stringify it
            if (typeof formattedMessage !== 'string') {
                 formattedMessage = JSON.stringify(formattedMessage);
            }
            return `${timestamp} ${color}[${level.toUpperCase()}]\x1b[0m ${color}${formattedMessage}\x1b[0m`;
        })
      ) // End of combine for Console
    })
  ]
});

// --- NEW: Add S3 Client Setup --- 
const AWS = require('aws-sdk');
let s3 = null;
if (STORAGE_MODE === 's3') {
  if (!S3_ENDPOINT || !S3_BUCKET_NAME || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    logger.error('FATAL: STORAGE_MODE is s3, but required S3 environment variables are missing! Check bot .env');
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
  logger.info(`[Bot] Storage mode set to S3. Endpoint: ${S3_ENDPOINT}, Bucket: ${S3_BUCKET_NAME}`);
} else {
  logger.info('[Bot] Storage mode set to local.');
}
// --- END S3 Client Setup ---

// --- INITIALIZATION FUNCTIONS ---

// Function to check if talkgroups have been imported
function checkTalkGroupsImported() {
  return new Promise((resolve, reject) => {
    db.get('SELECT COUNT(*) as count FROM talk_groups', (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row.count > 0);
      }
    });
  });
}

// Function to import talkgroups from CSV
function importTalkGroups() {
  return new Promise((resolve, reject) => {
    const talkGroupsFile = path.join(__dirname, 'talkgroups.csv');
    
    if (!fs.existsSync(talkGroupsFile)) {
      logger.warn('talkgroups.csv not found. Skipping talkgroup import.');
      resolve();
      return;
    }

    logger.info('Importing talkgroups from CSV...');
    let importCount = 0;

    fs.createReadStream(talkGroupsFile)
      .pipe(csv({
        headers: ['DEC', 'HEX', 'Alpha Tag', 'Mode', 'Description', 'Tag', 'County'],
        skipLines: 0,
      }))
      .on('data', (row) => {
        const id = parseInt(row['DEC'], 10);
        const hex = row['HEX'];
        const alphaTag = row['Alpha Tag'];
        const mode = row['Mode'];
        const description = row['Description'];
        const tag = row['Tag'];
        const county = row['County'];

        db.run(
          `INSERT OR REPLACE INTO talk_groups (id, hex, alpha_tag, mode, description, tag, county) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, hex, alphaTag, mode, description, tag, county],
          (err) => {
            if (err) {
              logger.error('Error inserting talk group:', err.message);
            } else {
              importCount++;
            }
          }
        );
      })
      .on('end', () => {
        logger.info(`Successfully imported ${importCount} talkgroups.`);
        resolve();
      })
      .on('error', (err) => {
        logger.error('Error importing talkgroups:', err);
        reject(err);
      });
  });
}

// Function to ensure API key exists
function ensureApiKey() {
  return new Promise((resolve, reject) => {
    try {
      // Ensure directory exists
      const apiKeyDir = path.dirname(API_KEY_FILE);
      if (!fs.existsSync(apiKeyDir)) {
        fs.mkdirSync(apiKeyDir, { recursive: true });
      }

      if (!fs.existsSync(API_KEY_FILE)) {
        // Create a default API key
        const defaultKey = uuidv4();
        const hashedKey = bcrypt.hashSync(defaultKey, 10);
        const initialApiKeys = [{ 
          key: hashedKey, 
          name: 'Default', 
          disabled: false,
          created_at: new Date().toISOString(),
          description: 'Auto-generated API key for first boot'
        }];
        
        fs.writeFileSync(API_KEY_FILE, JSON.stringify(initialApiKeys, null, 2));
        
        logger.info(`Created default API key: ${defaultKey}`);
        logger.info(`API key saved to: ${API_KEY_FILE}`);
        logger.warn('IMPORTANT: Save this API key as it won\'t be shown again!');
        resolve(defaultKey);
      } else {
        logger.info('API key file already exists.');
        resolve(null);
      }
    } catch (err) {
      logger.error('Error ensuring API key:', err);
      reject(err);
    }
  });
}

// Function to initialize database tables
function initializeDatabase() {
  return new Promise((resolve, reject) => {
    logger.info('Initializing database tables...');
    
    db.serialize(() => {
      let tablesCreated = 0;
      let totalTables = ENABLE_AUTH?.toLowerCase() === 'true' ? 7 : 5;
      
      const tableCreated = (err, tableName) => {
        if (err) {
          logger.error(`Error creating ${tableName} table:`, err);
          reject(err);
          return;
        }
        tablesCreated++;
        if (tablesCreated === totalTables) {
          logger.info('Database tables initialized successfully.');
          resolve();
        }
      };

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
      )`, (err) => tableCreated(err, 'transcriptions'));

      db.run(`CREATE TABLE IF NOT EXISTS global_keywords (
        keyword TEXT UNIQUE,
        talk_group_id TEXT
      )`, (err) => tableCreated(err, 'global_keywords'));

      db.run(`CREATE TABLE IF NOT EXISTS talk_groups (
        id TEXT PRIMARY KEY,
        hex TEXT,
        alpha_tag TEXT,
        mode TEXT,
        description TEXT,
        tag TEXT,
        county TEXT
      )`, (err) => tableCreated(err, 'talk_groups'));

      db.run(`CREATE TABLE IF NOT EXISTS frequencies (
        id INTEGER PRIMARY KEY,
        frequency TEXT,
        description TEXT
      )`, (err) => tableCreated(err, 'frequencies'));

      db.run(`CREATE TABLE IF NOT EXISTS audio_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        transcription_id INTEGER,
        audio_data BLOB,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(transcription_id) REFERENCES transcriptions(id)
      )`, (err) => tableCreated(err, 'audio_files'));

      // Authentication tables (if auth is enabled)
      if (ENABLE_AUTH?.toLowerCase() === 'true') {
        db.run(`CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          salt TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`, (err) => tableCreated(err, 'users'));

        db.run(`CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token TEXT UNIQUE NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL,
          last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
          ip_address TEXT,
          user_agent TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )`, (err) => tableCreated(err, 'sessions'));
      }
    });
  });
}

// Function to create admin user if authentication is enabled
function createAdminUser() {
  return new Promise((resolve, reject) => {
    if (ENABLE_AUTH?.toLowerCase() !== 'true') {
      logger.info('Authentication disabled, skipping admin user creation.');
      resolve();
      return;
    }

    if (!WEBSERVER_PASSWORD) {
      logger.error('WEBSERVER_PASSWORD not set but authentication is enabled!');
      reject(new Error('WEBSERVER_PASSWORD required when ENABLE_AUTH=true'));
      return;
    }

    // Check if admin user already exists
    db.get('SELECT id FROM users WHERE username = ?', ['admin'], (err, row) => {
      if (err) {
        logger.error('Error checking for admin user:', err);
        reject(err);
        return;
      }

      if (row) {
        logger.info('Admin user already exists in database.');
        resolve();
        return;
      }

      // Create admin user
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = crypto
        .pbkdf2Sync(WEBSERVER_PASSWORD, salt, 10000, 64, 'sha512')
        .toString('hex');

      db.run(
        'INSERT INTO users (username, password_hash, salt) VALUES (?, ?, ?)',
        ['admin', passwordHash, salt],
        function(err) {
          if (err) {
            logger.error('Error creating admin user:', err);
            reject(err);
          } else {
            logger.info('Created admin user for webserver authentication.');
            logger.info(`Admin credentials: username=admin, password=${WEBSERVER_PASSWORD}`);
            resolve();
          }
        }
      );
    });
  });
}

// Function to start webserver as child process
function startWebserver() {
  return new Promise((resolve, reject) => {
    logger.info('Starting webserver...');
    
    const webserverProcess = spawn('node', ['webserver.js'], {
      stdio: 'inherit',
      env: { ...process.env }
    });

    webserverProcess.on('error', (err) => {
      logger.error('Failed to start webserver:', err);
      reject(err);
    });

    // Give the webserver a moment to start
    setTimeout(() => {
      logger.info(`Webserver started on port ${WEBSERVER_PORT}`);
      resolve(webserverProcess);
    }, 2000);
  });
}

// Main initialization function
async function initializeBot() {
  try {
    logger.info('Starting bot initialization...');

    // Step 1: Initialize database
    await initializeDatabase();

    // Step 2: Ensure API key exists
    const newApiKey = await ensureApiKey();
    if (newApiKey) {
      // Log the new API key one more time for visibility
      console.log('='.repeat(60));
      console.log('NEW API KEY GENERATED:');
      console.log(newApiKey);
      console.log('Please save this key - it will not be shown again!');
      console.log('='.repeat(60));
    }

    // Step 3: Check and import talkgroups if needed
    const talkGroupsExist = await checkTalkGroupsImported();
    if (!talkGroupsExist) {
      await importTalkGroups();
    } else {
      logger.info('Talkgroups already imported, skipping CSV import.');
    }

    // Step 4: Load talkgroups for geocoding
    const { loadTalkGroups } = require('./geocoding');
    const talkGroups = await loadTalkGroups(db);
    Object.assign(TALK_GROUPS, talkGroups);
    logger.info(`Loaded ${Object.keys(TALK_GROUPS).length} talk groups for geocoding`);

    // Step 5: Load API keys
    loadApiKeys();

    // Step 6: Create admin user for webserver if auth is enabled
    await createAdminUser();

    // Step 7: Start bot services (Discord and Express API)
    await startBotServices();

    // Step 8: Start webserver last
    if (WEBSERVER_PORT && GOOGLE_MAPS_API_KEY) {
      await startWebserver();
    } else {
      logger.warn('Webserver not started: WEBSERVER_PORT or GOOGLE_MAPS_API_KEY not configured');
    }

    logger.info('Bot initialization completed successfully!');
    return true;
  } catch (error) {
    logger.error('Bot initialization failed:', error);
    throw error;
  }
}

// --- END INITIALIZATION FUNCTIONS ---

const {
  Client,
  IntentsBitField,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
  Collection,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,       // <-- Add this
  TextInputBuilder,   // <-- Add this
  TextInputStyle,     // <-- Add this
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
} = require('@discordjs/voice');
const prism = require('prism-media');
const { MessageFlags } = require('discord.js');

// Import the geocoding module
const { extractAddress, geocodeAddress, hyperlinkAddress, loadTalkGroups } = require('./geocoding');

// Express app setup
const app = express();
const PORT_NUM = parseInt(PORT, 10);

// Discord client setup
const client = new Client({
  intents: [
    IntentsBitField.Flags.Guilds,
    IntentsBitField.Flags.GuildMessages,
    IntentsBitField.Flags.MessageContent,
    IntentsBitField.Flags.GuildVoiceStates,
  ],
});

// Global variables
let alertChannel;
const UPLOAD_DIR = path.join(__dirname, 'audio');
let transcriptionQueue = [];
let activeTranscriptions = 0;
let isBootComplete = false;
const messageCache = new Map(); // Stores the latest message for each channel
const MESSAGE_COOLDOWN = 15000; // 15 seconds in milliseconds
let transcriptionProcess = null;
let isProcessingTranscription = false;
let currentTranscriptionId = null; // Track current transcription for timeout
let transcriptionTimeout = null; // Timeout for current transcription
const TRANSCRIPTION_TIMEOUT_MS = 90000; // 1.5 minutes timeout per transcription (reduced for busy systems)
let processHealthCheck = null; // Health check interval
let lastProcessActivity = Date.now(); // Track when we last heard from Python process
let queueWarningLogged = false; // Prevent spam logging of queue warnings
let lastQueueSizeLog = 0; // Track last queue size for change detection

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

logger.info(`Using upload directory: ${UPLOAD_DIR}`);

// Database setup (will be initialized properly in initializeBot function)
const db = new sqlite3.Database('./botdata.db', (err) => {
  if (err) {
    logger.error('Error opening database:', err.message);
    process.exit(1);
  } else {
    logger.info('Connected to SQLite database.');
    // Trigger initialization after database connection
    initializeBot().catch((error) => {
      logger.error('Fatal error during bot initialization:', error);
      process.exit(1);
    });
  }
});

// Load API keys (will be called from initialization)
let apiKeys = [];
const loadApiKeys = () => {
  try {
    if (fs.existsSync(API_KEY_FILE)) {
      const data = fs.readFileSync(API_KEY_FILE, 'utf8');
      apiKeys = JSON.parse(data);
      logger.info(`Loaded ${apiKeys.length} API keys.`);
    } else {
      logger.warn('API key file not found. This should have been created during initialization.');
      apiKeys = [];
    }
  } catch (err) {
    logger.error('Error loading API keys:', err);
    apiKeys = [];
  }
};

// Helper Functions
const validateApiKey = async (key) => {
  //logger.info(`Validating API key: ${key.substring(0, 3)}...`);
  for (let apiKey of apiKeys) {
    if (!apiKey.disabled) {
      const match = await bcrypt.compare(key, apiKey.key);
      if (match) {
        //logger.info('API key validation successful');
        return apiKey;
      }
    }
  }
  logger.error('API key validation failed');
  return null;
};

const generateCustomFilename = (fields, originalFilename) => {
  const date = new Date(parseInt(fields.dateTime) * 1000);
  const dateStr = date
    .toISOString()
    .replace(/[-:]/g, '')
    .split('.')[0]
    .replace('T', '_');
  const systemName = fields.systemLabel
    ? fields.systemLabel.replace(/[^a-zA-Z0-9]/g, '_')
    : 'Unknown_System';
  const talkgroupInfo = fields.talkgroupLabel
    ? fields.talkgroupLabel.replace(/[^a-zA-Z0-9]/g, '_')
    : 'Unknown_Talkgroup';
  const talkgroup = fields.talkgroup || 'Unknown';
  const source = fields.source || 'Unknown';
  
  // Get the file extension - either from the original file or use appropriate default
  // TrunkRecorder sends M4A files, others typically send MP3
  let extension;
  if (originalFilename) {
    extension = path.extname(originalFilename).toLowerCase();
    if (!extension || extension === '.') {
      // If we're missing a valid extension
      extension = fields.audioType === 'audio/mp4' ? '.m4a' : '.mp3';
    }
  } else {
    extension = fields.audioType === 'audio/mp4' ? '.m4a' : '.mp3';
  }
  
  // Force mp3 extension for PCM files
  if (isIgnoredFileType(originalFilename)) {
    extension = '.mp3';
  }

  return `${dateStr}_${systemName}_${talkgroupInfo}_TO_${talkgroup}_FROM_${source}${extension}`;
};

// Express Middleware
app.use(express.json());

app.use((req, res, next) => {
  logger.info(`\n--- Incoming Request ---`);
  logger.info(`Method: ${req.method}`);
  logger.info(`URL: ${req.url}`);
  logger.info(`Headers: ${JSON.stringify(req.headers, null, 2)}`);
  next();
});

const isIgnoredFileType = (filename) => {
  const extension = path.extname(filename).toLowerCase();
  return extension === '.pcm'; // Only ignore PCM files, allow MP3 and M4A
};

// Route: /api/call-upload
app.post('/api/call-upload', (req, res) => {
  logger.info(`Handling /api/call-upload`);
  
  // Create a simple flag to track if we've sent a response
  let hasResponded = false;
  
  // Function to safely send a response (prevents multiple response errors)
  const sendResponse = (status, message) => {
    if (!hasResponded) {
      hasResponded = true;
      res.status(status).send(message);
    }
  };
  
  // Create a very simple test request detector
  if (req.headers['user-agent'] === 'sdrtrunk') {
    // Set up a parser just for SDRTrunk requests
    const bb = busboy({ headers: req.headers });
    let isTestRequest = false;
    let hasFields = false;
    let hasFile = false;
    let fields = {};
    let fileInfo = null;
    let fileBuffer = null;
    
    // Fast detection of test field
    bb.on('field', (name, val) => {
      hasFields = true;
      fields[name] = val;
      
      if (name === 'test' && val === '1') {
        isTestRequest = true;
        // Immediately respond to test requests
        logger.info('SDRTrunk test request detected, sending response');
        sendResponse(200, 'incomplete call data: no talkgroup');
        bb.destroy(); // Stop parsing
      }
    });
    
    bb.on('file', (name, file, info) => {
      hasFile = true;
      fileInfo = { originalFilename: info.filename };
      
      if (isTestRequest) {
        file.resume(); // Skip processing for test requests
        return;
      }
      
      // ADD CHECK for field name
      if (name !== 'file' && name !== 'audio') {
          logger.warn(`Ignoring unexpected file part with fieldname: ${name}`);
          file.resume(); // Consume the stream but do nothing
          return;
      }
      // END ADD CHECK

      if (isIgnoredFileType(info.filename)) {
        logger.info(`Ignoring unsupported file type: ${info.filename}`);
        file.resume();
        return;
      }
      
      const chunks = [];
      file.on('data', (chunk) => {
        chunks.push(chunk);
      });
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });
    
    bb.on('close', async () => {
      // If we already responded to a test request, just return
      if (hasResponded) return;
      
      // If it's a test request or has no fields/file, respond with no talkgroup
      if (isTestRequest || !hasFields || !hasFile) {
        logger.info('SDRTrunk request without proper data, sending test response');
        return sendResponse(200, 'incomplete call data: no talkgroup');
      }
      
      // This is a real SDRTrunk upload, process it
      logger.info('Processing SDRTrunk audio upload');
      
      // Extract source from filename if it's in the SDRTrunk format
      if (fileInfo && fileInfo.originalFilename && fileInfo.originalFilename.includes('FROM_')) {
        const fromMatch = fileInfo.originalFilename.match(/FROM_(\d+)/);
        if (fromMatch && fromMatch[1]) {
          fields.source = fromMatch[1];
        }
      }
      
      // API key validation
      if (!fields.key) {
        return sendResponse(400, 'API key is missing.');
      }
      
      try {
        const apiKey = await validateApiKey(fields.key);
        if (!apiKey) {
          return sendResponse(401, 'Invalid or disabled API key.');
        }
        
        if (fileInfo && fileBuffer) {
          const customFilename = generateCustomFilename(fields, fileInfo.originalFilename);
          const saveTo = path.join(UPLOAD_DIR, customFilename);
          
          fs.writeFile(saveTo, fileBuffer, (err) => {
            if (err) {
              logger.error('Error saving file:', err);
              return sendResponse(500, 'Error saving file');
            }
            
            logger.info(`Received SDRTrunk audio: ${customFilename}`);
            
            handleNewAudio({
              filename: customFilename,
              path: saveTo,
              talkGroupID: fields.talkgroup,
              systemName: fields.systemLabel,
              talkGroupName: fields.talkgroupLabel,
              dateTime: fields.dateTime, // Pass the original fields.dateTime for SDRTrunk
              source: fields.source,
              frequency: fields.frequency,
              talkGroupGroup: fields.talkgroupGroup,
              isTrunkRecorder: false
            });
            
            return sendResponse(200, 'Call imported successfully.');
          });
        } else {
          return sendResponse(200, 'incomplete call data: no audio file');
        }
      } catch (error) {
        logger.error('Error processing SDRTrunk request:', error);
        return sendResponse(500, 'Error processing request');
      }
    });
    
    req.pipe(bb);
  } else {
    // Handle TrunkRecorder or other uploads
    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: 2 * 1024 * 1024 * 1024 }
    });
    
    let fields = {};
    let fileInfo = null;
    let fileBuffer = null;
    let isTrunkRecorder = true; // Default to TrunkRecorder for non-SDRTrunk requests
    
    bb.on('file', (name, file, info) => {
      fileInfo = { originalFilename: info.filename };
      
      if (isIgnoredFileType(info.filename)) {
        logger.info(`Ignoring unsupported file type: ${info.filename}`);
        file.resume();
        return;
      }
      
      const chunks = [];
      file.on('data', (chunk) => {
        chunks.push(chunk);
      });
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
      });
    });
    
    bb.on('field', (name, val) => {
      fields[name] = val;
      
      // Test for TrunkRecorder's sources JSON field for source ID
      if (name === 'sources' && val.trim() !== '[]') {
        try {
          const sources = JSON.parse(val);
          if (sources && sources.length > 0 && sources[0].src) {
            fields.source = sources[0].src.toString();
            logger.info(`Extracted source ID from TrunkRecorder: ${fields.source}`);
          }
        } catch (error) {
          logger.error('Error parsing TrunkRecorder sources JSON:', error);
        }
      }
    });
    
    bb.on('close', async () => {
      // API key validation
      if (!fields.key) {
        return sendResponse(400, 'API key is missing.');
      }
      
      try {
        const apiKey = await validateApiKey(fields.key);
        if (!apiKey) {
          return sendResponse(401, 'Invalid or disabled API key.');
        }

        // --- START: dateTime Parsing Logic ---
        let callDateTime;
        let inferredSourceSystem = 'TrunkRecorder'; // Default assumption
        if (fields.dateTime) {
            // Try parsing as Unix timestamp (seconds)
            const timestampSeconds = parseInt(fields.dateTime, 10);
            if (!isNaN(timestampSeconds) && timestampSeconds > 1000000000) { // Basic sanity check for Unix timestamp
                callDateTime = new Date(timestampSeconds * 1000);
                // Keep inferredSourceSystem as 'TrunkRecorder'
            } else {
                // Try parsing as ISO/RFC3339 string
                callDateTime = new Date(fields.dateTime);
                if (!isNaN(callDateTime.getTime())) {
                    // Successfully parsed as ISO string, likely rdio-scanner
                    inferredSourceSystem = 'rdio-scanner';
                }
            }
            // Final validation
            if (isNaN(callDateTime.getTime())) {
                logger.warn(`Could not parse dateTime field: ${fields.dateTime}. Using current time.`);
                callDateTime = new Date(); // Fallback to now if parsing fails
                inferredSourceSystem = 'Unknown (dateTime parse failed)'; // Update source if parsing failed
            }
        } else {
             logger.warn('dateTime field missing. Using current time.');
             callDateTime = new Date(); // Fallback if field is missing
             inferredSourceSystem = 'Unknown (dateTime missing)';
        }
        // --- END: dateTime Parsing Logic ---
        
        // Handle source field explicitly
        // ... (rest of the existing logic for source, audioName) ...
        // Map audioName to filename for TrunkRecorder if original isn't available
        if (fields.audioName && (!fileInfo || !fileInfo.originalFilename)) {
          fileInfo = fileInfo || {};
          fileInfo.originalFilename = fields.audioName;
        }
        
        if (fileInfo && fileBuffer) {
          // Use the parsed callDateTime when generating filename and calling handleNewAudio
          const customFilename = generateCustomFilename({...fields, dateTime: callDateTime.getTime() / 1000}, fileInfo.originalFilename); // Pass seconds for filename generator
          const saveTo = path.join(UPLOAD_DIR, customFilename);
          
          fs.writeFile(saveTo, fileBuffer, (err) => {
            if (err) {
              logger.error('Error saving file:', err);
              return sendResponse(500, 'Error saving file');
            }
            
            // Use the inferred source system for logging
            logger.info(`Received audio via ${inferredSourceSystem}: ${customFilename}`);
            
            handleNewAudio({
              filename: customFilename,
              path: saveTo,
              talkGroupID: fields.talkgroup,
              systemName: fields.systemLabel,
              talkGroupName: fields.talkgroupLabel,
              dateTime: Math.floor(callDateTime.getTime() / 1000), // Pass Unix timestamp (seconds)
              source: fields.source,
              frequency: fields.frequency,
              talkGroupGroup: fields.talkgroupGroup,
              isTrunkRecorder: inferredSourceSystem === 'TrunkRecorder', // Set based on inference
              frequencies: fields.frequencies // <-- Pass the frequencies field
            });
            
            return sendResponse(200, 'Call imported successfully.');
          });
        } else {
          return sendResponse(200, 'incomplete call data: no audio file');
        }
      } catch (error) {
        logger.error('Error processing TrunkRecorder request:', error);
        return sendResponse(500, 'Error processing request');
      }
    });
    
    req.pipe(bb);
  }
});

app.get('/audio/:id', (req, res) => {
  const audioId = req.params.id;
  db.get('SELECT audio_data, transcription_id FROM audio_files WHERE transcription_id = ?', [audioId], (err, row) => {
    if (err) {
      logger.error('Error fetching audio:', err);
      return res.status(500).send('Error fetching audio');
    }
    if (!row) {
      return res.status(404).send('Audio not found');
    }
    
    // Get the file extension from the original file path
    db.get('SELECT audio_file_path FROM transcriptions WHERE id = ?', [row.transcription_id], (err, pathRow) => {
      // Set the appropriate content type based on file extension
      const filePath = pathRow ? pathRow.audio_file_path : '';
      const extension = path.extname(filePath).toLowerCase();
      
      if (extension === '.m4a') {
        res.set('Content-Type', 'audio/mp4');
      } else {
        res.set('Content-Type', 'audio/mpeg');
      }
      
      res.send(row.audio_data);
    });
  });
});

// Function to start the transcription process
// Function to start the transcription process
async function startTranscriptionProcess() {
  // *** ADD THIS CHECK AT THE TOP ***
  if (effectiveTranscriptionMode !== 'local') {
    logger.info('Transcription mode is not local, skipping Python process start.');
    return; // Don't start if mode is remote
  }
  // *** END ADDED CHECK ***

  // Clean up existing process if it exists
  if (transcriptionProcess) {
    logger.info('Cleaning up existing transcription process before restart');
    cleanupTranscriptionProcess();
  }

  logger.info('🚀 Starting persistent transcription process (local mode)...');
  logger.info('⏳ Checking Python environment and packages...'); // Updated log message

  // Reset state variables
  isProcessingTranscription = false;
  currentTranscriptionId = null;
  if (transcriptionTimeout) {
    clearTimeout(transcriptionTimeout);
    transcriptionTimeout = null;
  }

  // Spawn the Python process with better error handling and version detection
  let pythonCommand = PYTHON_COMMAND || 'python';
  
  // If user specified a custom Python command, use it directly
  if (PYTHON_COMMAND) {
    logger.info(`Using user-specified Python command: ${PYTHON_COMMAND}`);
  } else {
    // Try different Python commands to find the right version
    // On Windows, also try the full path to Python 3.12
    const pythonCommands = [
      'python3.12', 
      'python3', 
      'C:\\Users\\maste\\AppData\\Local\\Programs\\Python\\Python312\\python.exe',
      'python'
    ];
    
    logger.info(`AUTO_UPDATE_PYTHON_PACKAGES is set to: ${AUTO_UPDATE_PYTHON_PACKAGES}`);
  
    // Function to test Python version and dependencies
    const testPythonVersion = (cmd) => {
      return new Promise((resolve) => {
        const testProcess = spawn(cmd, ['--version'], { stdio: 'pipe' });
        let output = '';
        
        testProcess.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        testProcess.stderr.on('data', (data) => {
          output += data.toString();
        });
        
        testProcess.on('close', (code) => {
          if (code === 0) {
            const versionMatch = output.match(/Python (\d+)\.(\d+)/);
            if (versionMatch) {
              const major = parseInt(versionMatch[1]);
              const minor = parseInt(versionMatch[2]);
              logger.info(`Detected ${cmd}: Python ${major}.${minor} (major: ${major}, minor: ${minor})`);
              resolve({ cmd, version: `${major}.${minor}`, major, minor });
            } else {
              logger.warn(`Could not parse version from output: ${output}`);
            }
          } else {
            logger.info(`Command ${cmd} failed with code ${code}`);
          }
          resolve(null);
        });
        
        testProcess.on('error', () => {
          resolve(null);
        });
      });
    };
    
    // Function to test if Python has required packages
    const testPythonPackages = (cmd) => {
      return new Promise((resolve) => {
        const testProcess = spawn(cmd, ['-c', 'import torch, pydub, faster_whisper; print("OK")'], { stdio: 'pipe' });
        let output = '';
        
        testProcess.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        testProcess.stderr.on('data', (data) => {
          output += data.toString();
        });
        
        testProcess.on('close', (code) => {
          if (code === 0 && output.includes('OK')) {
            logger.info(`✓ Package test passed for ${cmd}`);
            resolve(true);
          } else {
            logger.info(`✗ Package test failed for ${cmd} (code: ${code}, output: '${output.trim()}')`);
            resolve(false);
          }
        });
        
        testProcess.on('error', () => {
          resolve(false);
        });
      });
    };
    
    // Function to auto-install Python packages
    const autoInstallPythonPackages = (cmd) => {
      return new Promise((resolve) => {
        logger.info(`Installing required Python packages using ${cmd}...`);
        
        // Detect CUDA availability for appropriate PyTorch installation
        const commands = [
          // Try CUDA first (most common for transcription)
          `${cmd} -m pip install --upgrade pip`,
          // Try PyTorch nightly first for better RTX 5090 support, fallback to stable
          `${cmd} -m pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu121 || ${cmd} -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121`,
          `${cmd} -m pip install faster-whisper>=0.10.0`,
          `${cmd} -m pip install pydub>=0.25.0`,
          `${cmd} -m pip install python-dotenv>=1.0.0`,
          `${cmd} -m pip install numpy>=1.24.0`
        ];
        
        // If CUDA fails, fallback to CPU
        const fallbackCommands = [
          `${cmd} -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cpu`,
          `${cmd} -m pip install faster-whisper>=0.10.0`,
          `${cmd} -m pip install pydub>=0.25.0`,
          `${cmd} -m pip install python-dotenv>=1.0.0`,
          `${cmd} -m pip install numpy>=1.24.0`
        ];
        
        let currentCommandIndex = 0;
        let usingFallback = false;
        
        const runNextCommand = () => {
          const commandList = usingFallback ? fallbackCommands : commands;
          
          if (currentCommandIndex >= commandList.length) {
            // All commands completed, test if packages are now available
            testPythonPackages(cmd).then(hasPackages => {
              if (hasPackages) {
                logger.info(`✓ Successfully installed all required packages for ${cmd}`);
                resolve(true);
              } else if (!usingFallback) {
                // Try fallback to CPU-only PyTorch
                logger.warn('CUDA PyTorch installation may have failed, trying CPU version...');
                usingFallback = true;
                currentCommandIndex = 1; // Skip pip upgrade for fallback
                runNextCommand();
              } else {
                logger.error(`Failed to install required packages for ${cmd}`);
                resolve(false);
              }
            });
            return;
          }
          
          const command = commandList[currentCommandIndex];
          logger.info(`Running: ${command}`);
          
          const installProcess = spawn(command, { 
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
            timeout: 300000 // 5 minute timeout for each command
          });
          
          let output = '';
          let errorOutput = '';
          
          installProcess.stdout.on('data', (data) => {
            const text = data.toString();
            output += text;
            // Log installation progress for user feedback
            if (text.includes('Successfully installed') || text.includes('Requirement already satisfied')) {
              logger.info(`Package install progress: ${text.trim()}`);
            }
          });
          
          installProcess.stderr.on('data', (data) => {
            const text = data.toString();
            errorOutput += text;
            // Log important errors during installation
            if (text.includes('ERROR') || text.includes('FAILED')) {
              logger.warn(`Package install error: ${text.trim()}`);
            }
          });
          
          installProcess.on('close', (code) => {
            if (code === 0) {
              logger.info(`✓ Command completed successfully`);
            } else {
              logger.warn(`Command failed with code ${code}: ${errorOutput.slice(0, 200)}...`);
              if (currentCommandIndex === 1 && !usingFallback) {
                // PyTorch CUDA install failed, switch to fallback
                logger.warn('CUDA PyTorch installation failed, switching to CPU version...');
                usingFallback = true;
                currentCommandIndex = 0; // Reset to start fallback sequence
              }
            }
            currentCommandIndex++;
            setTimeout(runNextCommand, 2000); // Slightly longer delay between commands
          });
          
          installProcess.on('error', (err) => {
            logger.error(`Error running command: ${err.message}`);
            currentCommandIndex++;
            setTimeout(runNextCommand, 2000);
          });
        };
        
        runNextCommand();
      });
    };
    
    // Function to auto-update Python packages
    const autoUpdatePythonPackages = (cmd) => {
      return new Promise((resolve) => {
        logger.info(`🔄 Updating Python packages to latest versions using ${cmd}...`);
        
        const updateCommands = [
          `${cmd} -m pip install --upgrade pip`,
          // Try PyTorch nightly first for better RTX 5090 support, fallback to stable
          `${cmd} -m pip install --upgrade --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu121 || ${cmd} -m pip install --upgrade torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121`,
          `${cmd} -m pip install --upgrade faster-whisper`,
          `${cmd} -m pip install --upgrade pydub`,
          `${cmd} -m pip install --upgrade python-dotenv`,
          `${cmd} -m pip install --upgrade numpy`
        ];
        
        let currentCommandIndex = 0;
        
        const runNextUpdate = () => {
          if (currentCommandIndex >= updateCommands.length) {
            logger.info(`✅ Package updates completed for ${cmd}`);
            resolve(true);
            return;
          }
          
          const command = updateCommands[currentCommandIndex];
          logger.info(`Updating: ${command}`);
          
          const updateProcess = spawn(command, { 
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true 
          });
          
          updateProcess.on('close', (code) => {
            if (code === 0) {
              logger.info(`✅ Update step ${currentCommandIndex + 1}/${updateCommands.length} completed`);
            } else {
              logger.warn(`⚠️ Update step ${currentCommandIndex + 1}/${updateCommands.length} failed (code ${code}), continuing...`);
            }
            currentCommandIndex++;
            setTimeout(runNextUpdate, 1000);
          });
          
          updateProcess.on('error', (err) => {
            logger.error(`Error during update: ${err.message}`);
            currentCommandIndex++;
            setTimeout(runNextUpdate, 1000);
          });
        };
        
        runNextUpdate();
      });
    };
    
    // Find the best Python version and auto-install/update packages
    logger.info('Detecting Python version and checking packages...');
    let foundValidPython = false;
    
    for (const cmd of pythonCommands) {
      logger.info(`Checking Python command: ${cmd}`);
      const result = await testPythonVersion(cmd);
      if (result && result.major >= 3 && result.minor >= 8) {
        logger.info(`✓ Found compatible Python: ${result.cmd} (version ${result.version})`);
        logger.info(`Testing ${result.cmd} (version ${result.version}) for required packages...`);
        
        // Test if this Python has the required packages
        const hasPackages = await testPythonPackages(result.cmd);
        if (hasPackages) {
          pythonCommand = result.cmd;
          logger.info(`✓ Found Python with all required packages: ${pythonCommand} (version ${result.version})`);
          
          // Auto-update packages to latest versions (if enabled)
          if (AUTO_UPDATE_PYTHON_PACKAGES?.toLowerCase() === 'true') {
            logger.info('🔄 Checking for Python package updates (this may take a moment)...');
            await autoUpdatePythonPackages(result.cmd);
            logger.info('✅ Package update check completed');
          } else {
            logger.info('Auto-update disabled, skipping package updates');
          }
          
          foundValidPython = true;
          break;
        } else {
          logger.warn(`${result.cmd} (version ${result.version}) is missing required packages.`);
          
          // Try to auto-install packages (if enabled)
          if (AUTO_UPDATE_PYTHON_PACKAGES?.toLowerCase() === 'true') {
            logger.info('📦 Installing required Python packages (this will take several minutes)...');
            logger.info('⏳ Please wait while PyTorch, faster-whisper, and dependencies are downloaded...');
            const installed = await autoInstallPythonPackages(result.cmd);
            if (installed) {
              pythonCommand = result.cmd;
              logger.info(`✅ Successfully auto-installed all packages for: ${pythonCommand} (version ${result.version})`);
              foundValidPython = true;
              break;
            } else {
              logger.warn(`❌ Failed to auto-install packages for ${result.cmd}, trying next Python...`);
            }
          } else {
            logger.warn('Auto-install disabled, skipping package installation for this Python');
          }
        }
      } else if (result) {
        logger.warn(`Found ${result.cmd} version ${result.version} but need Python 3.8+`);
      } else {
        logger.info(`Command ${cmd} not found or failed to execute`);
      }
    }
    
    if (!foundValidPython) {
      logger.error('No suitable Python installation found and auto-installation failed!');
      logger.error('Please manually install Python 3.8+ and required packages.');
      logger.error('Or set PYTHON_COMMAND in .env to specify the correct Python executable');
    }
  }
  
  try {
    transcriptionProcess = spawn(pythonCommand, ['transcribe.py'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
      cwd: __dirname // Ensure we're in the right directory
    });
    
    logger.info(`Spawned Python process with PID: ${transcriptionProcess.pid} using command: ${pythonCommand}`);
  } catch (err) {
    logger.error(`Failed to spawn transcription process: ${err.message}`);
    transcriptionProcess = null;
    return;
  }

  // Set up process error handling first
  transcriptionProcess.on('error', (err) => {
    logger.error(`Failed to start local transcription process: ${err.message}`);
    cleanupTranscriptionProcess();
    if (effectiveTranscriptionMode === 'local') {
        logger.info('Will attempt to restart local transcription process in 10 seconds due to spawn error...');
        setTimeout(startTranscriptionProcess, 10000);
    }
  });

  // Create interface to read line-by-line from stdout
  const rl = readline.createInterface({
    input: transcriptionProcess.stdout,
    crlfDelay: Infinity
  });

  // Handle each line of output with improved error handling
  rl.on('line', (line) => {
    try {
      // Update activity timestamp
      lastProcessActivity = Date.now();
      
      // Check if line is empty or just whitespace before parsing
      if (!line || line.trim() === '') {
          return;
      }

      logger.info(`Local transcription process output: ${line}`);
      const response = JSON.parse(line);

      if (response.ready) {
        logger.info('Local transcription service ready');
        // Start health check monitoring after ready signal
        startProcessHealthCheck();
        processNextTranscription(); // Process queue on ready
      } else if (response.id && response.transcription !== undefined) {
        logger.info(`Received local transcription for ID: ${response.id}`);

        // Clear timeout if this is the current transcription
        if (currentTranscriptionId === response.id) {
          clearTranscriptionTimeout();
        }

        // Find the item and its callback in the queue
        const pendingItemIndex = transcriptionQueue.findIndex(item => item.id === response.id);

        if (pendingItemIndex !== -1) {
            const pendingItem = transcriptionQueue[pendingItemIndex];
            logger.info(`Found callback for local transcription ID: ${response.id}, executing`);

            // Execute the callback defined in handleNewAudio
            if (pendingItem.callback) {
                try {
                  pendingItem.callback(response.transcription);
                } catch (callbackError) {
                  logger.error(`Error executing callback for ID ${response.id}: ${callbackError.message}`);
                }
            } else {
                 logger.error(`No callback function found for local transcription ID: ${response.id}`);
            }

            // Remove this item from the queue
            transcriptionQueue.splice(pendingItemIndex, 1);

            // Reset processing state and process next item
            resetProcessingState();
            processNextTranscription();
        } else {
          logger.error(`No pending item found for local transcription ID: ${response.id}`);
          // Still allow queue to continue if an unexpected ID comes back
          resetProcessingState();
          processNextTranscription();
        }
      } else if (response.error) {
         logger.error(`Local transcription error for ID ${response.id}: ${response.error}`);

         // Clear timeout if this is the current transcription
         if (currentTranscriptionId === response.id) {
           clearTranscriptionTimeout();
         }

         const pendingItemIndex = transcriptionQueue.findIndex(item => item.id === response.id);
         if (pendingItemIndex !== -1) {
             const pendingItem = transcriptionQueue[pendingItemIndex];
             // Execute callback with empty string on error
             if (pendingItem.callback) {
                 try {
                   pendingItem.callback(""); // Indicate failure
                 } catch (callbackError) {
                   logger.error(`Error executing error callback for ID ${response.id}: ${callbackError.message}`);
                 }
             }
             // Remove problematic item from queue
             transcriptionQueue.splice(pendingItemIndex, 1);
             logger.info(`Removed item with error from local queue: ID ${response.id}`);
         } else {
              logger.error(`Received error for unknown local transcription ID: ${response.id}`);
         }

         // Reset processing state and allow queue to continue
         resetProcessingState();
         processNextTranscription();

      } else {
        logger.warn(`Unrecognized response from local transcription process: ${line}`);
        // Reset processing state just in case to prevent stall
        resetProcessingState();
        processNextTranscription();
      }
    } catch (err) {
      logger.error(`Error parsing local transcription process output: ${err.message}, line: ${line}`);
      // Reset processing state and allow queue to continue on parsing error
      resetProcessingState();
      processNextTranscription();
    }
  });

  // Handle stderr with selective logging - only show important messages
  transcriptionProcess.stderr.on('data', (data) => {
    const errorMsg = data.toString().trim();
    if (errorMsg) {
       // Only log important messages, not routine processing info
       const isImportant = errorMsg.includes('ERROR') || 
                          errorMsg.includes('FATAL') || 
                          errorMsg.includes('WARNING') ||
                          errorMsg.includes('WARN') ||
                          errorMsg.includes('Exception') ||
                          errorMsg.includes('Traceback') ||
                          errorMsg.includes('ModuleNotFoundError') ||
                          errorMsg.includes('ImportError') ||
                          errorMsg.includes('CUDA') ||
                          errorMsg.includes('torch') ||
                          errorMsg.includes('faster_whisper') ||
                          errorMsg.includes('Environment validation') ||
                          errorMsg.includes('available') ||
                          errorMsg.includes('Loaded model') ||
                          errorMsg.includes('Using device');
       
       if (isImportant) {
         logger.warn(`Local transcription process: ${errorMsg}`);
       }
       
       // Check for specific Python errors that indicate critical issues
       if (errorMsg.includes('ModuleNotFoundError') || errorMsg.includes('ImportError')) {
         logger.error('PYTHON IMPORT ERROR DETECTED - Missing required Python packages!');
       } else if (errorMsg.includes('CUDA') && errorMsg.includes('error')) {
         logger.error('CUDA ERROR DETECTED - GPU may not be available or drivers are outdated!');
       } else if (errorMsg.includes('torch') && errorMsg.includes('error')) {
         logger.error('PYTORCH ERROR DETECTED - Check PyTorch installation!');
       } else if (errorMsg.includes('faster_whisper') && errorMsg.includes('error')) {
         logger.error('FASTER-WHISPER ERROR DETECTED - Check faster-whisper installation!');
       }
    }
  });

  // Handle process exit with cleanup and better diagnostics
  transcriptionProcess.on('close', (code, signal) => {
    logger.error(`Local transcription process exited with code ${code}, signal: ${signal}`);
    
    // More specific error handling based on exit conditions
    if (code === null && signal) {
      logger.error(`Python process was killed by signal: ${signal}`);
    } else if (code === 1) {
      logger.error('Python process exited with error code 1 - likely a Python runtime error');
    } else if (code === null) {
      logger.error('Python process exited unexpectedly (code null) - likely crashed during startup');
      logger.error('This usually indicates missing dependencies or environment issues');
      logger.error('Check that Python, faster-whisper, torch, and other dependencies are properly installed');
    }
    
    cleanupTranscriptionProcess();

    // Only restart if not too many recent failures
    if (effectiveTranscriptionMode === 'local') {
      if (code === null) {
        // For null exit codes (startup crashes), wait longer and provide guidance
        logger.error('STARTUP CRASH DETECTED - Will NOT automatically restart to prevent loop');
        logger.error('Please check Python environment and dependencies manually');
        logger.error('Run "python transcribe.py" manually to see the full error');
      } else {
        logger.info('Will attempt to restart local transcription process in 15 seconds...');
        setTimeout(startTranscriptionProcess, 15000);
      }
    }
  });

  logger.info('🔄 Python transcription process started, loading AI model...');
  logger.info('⏳ Please wait while the large-v3 model loads (this takes 10-30 seconds)...');
  
  // Add a timeout to detect if Python process never sends ready signal
  const readyTimeout = setTimeout(() => {
    if (transcriptionProcess && transcriptionProcess.pid) {
      logger.error('TIMEOUT: Python process started but never sent ready signal after 30 seconds');
      logger.error('This indicates the Python process is stuck during model loading or initialization');
      logger.error('Common causes: GPU memory issues, model download problems, or dependency conflicts');
      logger.error('Try running: python transcribe.py manually to see detailed error output');
      cleanupTranscriptionProcess();
    }
  }, 60000); // 60 second timeout for ready signal (increased for busy systems)
  
  // Clear the timeout when we receive any valid JSON response (including ready signal)
  const originalHandler = rl.listeners('line')[0];
  if (originalHandler) {
    rl.removeListener('line', originalHandler);
    rl.on('line', (line) => {
      // Clear timeout on any valid JSON response from Python
      try {
        if (line && line.trim()) {
          const response = JSON.parse(line);
          if (response.ready || response.id) {
            clearTimeout(readyTimeout);
          }
        }
      } catch (e) {
        // Ignore JSON parse errors
      }
      // Call the original handler
      originalHandler(line);
    });
  }
}

// Helper function to cleanup transcription process and state
function cleanupTranscriptionProcess() {
  // Stop health check
  if (processHealthCheck) {
    clearInterval(processHealthCheck);
    processHealthCheck = null;
  }

  // Clear current transcription timeout
  clearTranscriptionTimeout();

  // Handle any pending items (call callbacks with empty string)
  if (transcriptionQueue.length > 0) {
      logger.warn(`${transcriptionQueue.length} local transcription requests were pending when process was cleaned up. Failing them.`);
      for (const item of transcriptionQueue) {
          if (item.callback) {
              try {
                  item.callback(""); // Indicate failure
              } catch (callbackError) {
                   logger.error(`Error executing pending callback on cleanup for ID ${item.id}: ${callbackError.message}`);
              }
          }
      }
      transcriptionQueue = []; // Clear the queue
  }

  // Reset all state variables
  resetProcessingState();
  
  // Clean up process reference
  if (transcriptionProcess) {
    try {
      transcriptionProcess.kill('SIGTERM');
    } catch (err) {
      logger.warn(`Error killing transcription process: ${err.message}`);
    }
    transcriptionProcess = null;
  }
}

// Helper function to reset processing state
function resetProcessingState() {
  isProcessingTranscription = false;
  currentTranscriptionId = null;
  clearTranscriptionTimeout();
}

// Helper function to clear transcription timeout
function clearTranscriptionTimeout() {
  if (transcriptionTimeout) {
    clearTimeout(transcriptionTimeout);
    transcriptionTimeout = null;
  }
}

// Helper function to start process health check
function startProcessHealthCheck() {
  if (processHealthCheck) {
    clearInterval(processHealthCheck);
  }
  
  processHealthCheck = setInterval(() => {
    const timeSinceActivity = Date.now() - lastProcessActivity;
    const queueSize = transcriptionQueue.length;
    
    // If no activity for 5 minutes, consider process dead
    if (timeSinceActivity > 300000) {
      logger.error('Transcription process appears to be dead (no activity for 5 minutes). Restarting...');
      cleanupTranscriptionProcess();
      if (effectiveTranscriptionMode === 'local') {
        setTimeout(startTranscriptionProcess, 5000);
      }
      return;
    }
    
    // High-volume system monitoring
    if (queueSize > QUEUE_DRAIN_THRESHOLD && !queueWarningLogged) {
      logger.warn(`HIGH VOLUME: Transcription queue is backing up with ${queueSize} items. Consider increasing MAX_CONCURRENT_TRANSCRIPTIONS or checking system resources.`);
      queueWarningLogged = true;
    } else if (queueSize <= QUEUE_DRAIN_THRESHOLD / 2) {
      queueWarningLogged = false; // Reset warning when queue drains
    }
    
    // Log queue status with more detail for busy systems
    if (queueSize > 0 && Math.abs(queueSize - lastQueueSizeLog) >= 5) {
      const oldestItem = transcriptionQueue[0];
      const queueAge = oldestItem ? Math.round((Date.now() - oldestItem.queuedAt) / 1000) : 0;
      logger.info(`Transcription queue: ${queueSize} items pending, processing: ${isProcessingTranscription}, oldest item: ${queueAge}s`);
      lastQueueSizeLog = queueSize;
    }
    
    // Force restart if queue is stuck with items but not processing
    if (queueSize > 10 && !isProcessingTranscription && timeSinceActivity > 120000) {
      logger.error(`Queue appears stuck with ${queueSize} items but not processing. Force restarting transcription process...`);
      cleanupTranscriptionProcess();
      if (effectiveTranscriptionMode === 'local') {
        setTimeout(startTranscriptionProcess, 2000);
      }
    }
  }, 30000); // Check every 30 seconds for busy systems
}

// Function to process the next transcription in the queue
function processNextTranscription() {
  // Add a check for the process existence early
  if (!transcriptionProcess) {
      logger.warn('Local transcription process not running. Cannot process queue.');
      return;
  }

  if (isProcessingTranscription || transcriptionQueue.length === 0) {
    return;
  }

  // Get the next item but don't remove it from the queue yet
  const nextItem = transcriptionQueue[0];

  // Additional validation for file-based transcriptions
  if (nextItem.payload && nextItem.payload.path) {
    if (!fs.existsSync(nextItem.payload.path)) {
      logger.error(`Audio file missing when processing queue: ${nextItem.payload.path}. Skipping item.`);
      // Remove the item and try next
      transcriptionQueue.shift();
      if (nextItem.callback) {
        try {
          nextItem.callback(""); // Indicate failure
        } catch (callbackError) {
          logger.error(`Error executing callback for missing file: ${callbackError.message}`);
        }
      }
      processNextTranscription(); // Try next item
      return;
    }
  }

  // Validate payload size for buffer-based transcriptions  
  if (nextItem.payload && nextItem.payload.audio_data_base64) {
    const estimatedSize = nextItem.payload.audio_data_base64.length * 0.75; // Rough base64 to binary size
    if (estimatedSize > 50 * 1024 * 1024) { // 50MB limit
      logger.error(`Audio buffer too large for transcription: ${Math.round(estimatedSize / 1024 / 1024)}MB. Skipping item.`);
      transcriptionQueue.shift();
      if (nextItem.callback) {
        try {
          nextItem.callback(""); // Indicate failure
        } catch (callbackError) {
          logger.error(`Error executing callback for oversized file: ${callbackError.message}`);
        }
      }
      processNextTranscription(); // Try next item
      return;
    }
  }

  // Mark as processing and set timeout
  isProcessingTranscription = true;
  currentTranscriptionId = nextItem.id;
  
  // Set timeout for this transcription
  transcriptionTimeout = setTimeout(() => {
    logger.error(`Transcription timeout for ID ${currentTranscriptionId}. Restarting process...`);
    // Force restart the process on timeout
    cleanupTranscriptionProcess();
    if (effectiveTranscriptionMode === 'local') {
      setTimeout(startTranscriptionProcess, 5000);
    }
  }, TRANSCRIPTION_TIMEOUT_MS);

  // Send the pre-constructed payload to the python process
  try {
    const payload = JSON.stringify(nextItem.payload) + '\n';
    transcriptionProcess.stdin.write(payload);
    logger.info(`Sent payload to local transcription process for ID: ${nextItem.id} (payload size: ${payload.length} chars)`);
    lastProcessActivity = Date.now(); // Update activity timestamp
  } catch (error) {
      logger.error(`Error writing to local transcription process stdin for ID ${nextItem.id}: ${error.message}`);
      // Clear timeout and reset state
      clearTranscriptionTimeout();
      resetProcessingState();
      
      // Remove the failed item from queue
      transcriptionQueue.shift();
      if (nextItem.callback) {
        try {
          nextItem.callback(""); // Indicate failure
        } catch (callbackError) {
          logger.error(`Error executing callback for stdin error: ${callbackError.message}`);
        }
      }
      
      // Try next item
      processNextTranscription();
  }
}

// *** NEW FUNCTION for Remote Transcription ***
async function transcribeAudioRemotely(filePath, callback) {
  // Ensure URL is configured for remote mode
  if (!FASTER_WHISPER_SERVER_URL) {
    logger.error('FATAL: FASTER_WHISPER_SERVER_URL is not configured for remote mode.');
    if (callback) callback(""); // Fail gracefully
    return;
  }

  // Check file existence
  if (!fs.existsSync(filePath)) {
    logger.warn(`Remote Transcription: Audio file does not exist: ${filePath}`);
    if (callback) callback("");
    return;
  }

  // Optional: Check file size (prevent sending tiny/empty files)
  try {
      const stats = fs.statSync(filePath);
      if (stats.size < 1000) { // Example threshold: 1KB
          logger.warn(`Remote Transcription: Audio file too small, skipping: ${filePath} (${stats.size} bytes)`);
          if (callback) callback("");
          return;
      }
  } catch (statError) {
       logger.error(`Remote Transcription: Error getting file stats for ${filePath}: ${statError.message}`);
       if (callback) callback(""); // Fail if stats cannot be read
       return;
  }


  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    // Append model if specified in environment
    if (WHISPER_MODEL) {
      form.append('model', WHISPER_MODEL);
      logger.info(`Requesting remote model: ${WHISPER_MODEL}`);
    }
    // Add other parameters if needed (e.g., language)
    // form.append('language', 'en');

    const apiEndpoint = `${FASTER_WHISPER_SERVER_URL}/v1/audio/transcriptions`;
    const filenameForLog = path.basename(filePath);
    logger.info(`Sending remote transcription request for ${filenameForLog} to ${apiEndpoint}`);

    // Configure fetch options, including timeout (e.g., 120 seconds)
    const fetchOptions = {
         method: 'POST',
         body: form,
         headers: {
             // Add Authorization header ONLY if your remote server requires it
             // 'Authorization': `Bearer YOUR_SERVER_API_KEY_IF_NEEDED`,
             ...form.getHeaders() // Necessary for form-data
         },
         // signal: AbortSignal.timeout(120000) // Requires Node 16+
    };

    // Use a manual timeout for broader Node version compatibility
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        logger.error(`Remote transcription request timed out after 120s for ${filenameForLog}`);
        controller.abort();
    }, 120000); // 120 seconds


    fetchOptions.signal = controller.signal; // Assign the signal

    const response = await fetch(apiEndpoint, fetchOptions);

    clearTimeout(timeoutId); // Clear the timeout if fetch completes

    if (!response.ok) {
      let errorBody = `Status: ${response.status} ${response.statusText}`;
      try {
          errorBody = await response.text();
      } catch (e) { /* ignore */ }
      logger.error(`Remote transcription server error for ${filenameForLog}: ${errorBody}`);
      if (callback) callback(""); // Indicate failure
      return;
    }

    const result = await response.json();
    // Assuming OpenAI compatible response { "text": "..." }
    const transcriptionText = result.text || "";

    logger.info(`Received remote transcription for ${filenameForLog} (${transcriptionText.length} chars)`);
    if (callback) {
      callback(transcriptionText);
    }

  } catch (error) {
     if (error.name === 'AbortError') {
         // Timeout already logged by the timeout handler
         if (callback) callback(""); // Indicate failure on timeout
     } else {
        const filenameForLog = path.basename(filePath);
        logger.error(`Error during remote transcription API call for ${filenameForLog}: ${error.message}`, { stack: error.stack });
        if (callback) callback(""); // Indicate failure on other errors
     }
  }
}

async function transcribeWithOpenAIAPI(filePath, callback) {
  // Check for API Key
  if (!OPENAI_API_KEY) {
    logger.error('FATAL: TRANSCRIPTION_MODE is openai, but OPENAI_API_KEY is not configured.');
    if (callback) callback(""); // Fail gracefully
    return;
  }

  // Check file existence
  if (!fs.existsSync(filePath)) {
    logger.warn(`OpenAI Transcription: Audio file does not exist: ${filePath}`);
    if (callback) callback("");
    return;
  }

  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    form.append('model', 'whisper-1'); // OpenAI's primary transcription model

    const apiEndpoint = `https://api.openai.com/v1/audio/transcriptions`;
    const filenameForLog = path.basename(filePath);
    logger.info(`Sending OpenAI transcription request for ${filenameForLog} to ${apiEndpoint}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        logger.error(`OpenAI transcription request timed out after 120s for ${filenameForLog}`);
        controller.abort();
    }, 120000); // 120 seconds

    const response = await fetch(apiEndpoint, {
         method: 'POST',
         body: form,
         headers: {
             'Authorization': `Bearer ${OPENAI_API_KEY}`,
             ...form.getHeaders()
         },
         signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorBody = `Status: ${response.status} ${response.statusText}`;
      try {
          errorBody = await response.text();
      } catch (e) { /* ignore */ }
      logger.error(`OpenAI transcription API error for ${filenameForLog}: ${errorBody}`);
      if (callback) callback("");
      return;
    }

    const result = await response.json();
    const transcriptionText = result.text || "";

    logger.info(`Received OpenAI transcription for ${filenameForLog} (${transcriptionText.length} chars)`);
    if (callback) {
      callback(transcriptionText);
    }

  } catch (error) {
     if (error.name === 'AbortError') {
         if (callback) callback("");
     } else {
        const filenameForLog = path.basename(filePath);
        logger.error(`Error during OpenAI transcription API call for ${filenameForLog}: ${error.message}`, { stack: error.stack });
        if (callback) callback("");
     }
  }
}

async function transcribeWithICADAPI(filePath, callback) {
  // Check for ICAD URL
  if (!ICAD_URL) {
    logger.error('FATAL: TRANSCRIPTION_MODE is icad, but ICAD_URL is not configured.');
    if (callback) callback(""); // Fail gracefully
    return;
  }

  // Check file existence
  if (!fs.existsSync(filePath)) {
    logger.warn(`ICAD Transcription: Audio file does not exist: ${filePath}`);
    if (callback) callback("");
    return;
  }

  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));
    
    // Set model based on ICAD_PROFILE if provided, otherwise use default
    const modelToUse = ICAD_PROFILE || 'whisper-1';
    form.append('model', modelToUse);
    
    // Add standard OpenAI Whisper API parameters that ICAD should understand
    form.append('response_format', 'json');
    form.append('language', 'en');
    
    // Explicitly disable clip_timestamps to override any profile settings
    form.append('clip_timestamps', '');

    const apiEndpoint = `${ICAD_URL}/v1/audio/transcriptions`;
    const filenameForLog = path.basename(filePath);
    const authStatus = ICAD_API_KEY ? 'with authentication' : 'without authentication';
    logger.info(`Sending ICAD transcription request for ${filenameForLog} to ${apiEndpoint} using model/profile: ${modelToUse} (${authStatus})`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        logger.error(`ICAD transcription request timed out after 120s for ${filenameForLog}`);
        controller.abort();
    }, 120000); // 120 seconds

    const headers = {
      ...form.getHeaders()
    };
    
    // Add authorization header if ICAD_API_KEY is provided
    if (ICAD_API_KEY) {
      headers['Authorization'] = `Bearer ${ICAD_API_KEY}`;
    }

    const response = await fetch(apiEndpoint, {
         method: 'POST',
         body: form,
         headers: headers,
         signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorBody = `Status: ${response.status} ${response.statusText}`;
      try {
          errorBody = await response.text();
      } catch (e) { /* ignore */ }
      logger.error(`ICAD transcription API error for ${filenameForLog}: ${errorBody}`);
      if (callback) callback("");
      return;
    }

    const result = await response.json();
    const transcriptionText = result.text || "";

    logger.info(`Received ICAD transcription for ${filenameForLog} (${transcriptionText.length} chars)`);
    if (callback) {
      callback(transcriptionText);
    }

  } catch (error) {
     if (error.name === 'AbortError') {
         if (callback) callback("");
     } else {
        const filenameForLog = path.basename(filePath);
        logger.error(`Error during ICAD transcription API call for ${filenameForLog}: ${error.message}`, { stack: error.stack });
        if (callback) callback("");
     }
  }
}

// Function to handle new audio (routes to local or remote transcription)
function handleNewAudio(audioData) {
  const {
    filename, // The custom generated filename (e.g., with timestamp)
    path: tempPath, // The temporary path where the file was saved (KEEP AS CONST)
    talkGroupID,
    systemName,
    talkGroupName,
    dateTime,
    source,
    frequency,
    talkGroupGroup,
    isTrunkRecorder
  } = audioData;

  // --- NEW: Parse Frequencies for Errors/Spikes (Trunk Recorder) --- 
  let totalErrors = 0;
  let totalSpikes = 0;
  // Make sure audioData.frequencies exists before trying to access it
  if (isTrunkRecorder && audioData.frequencies) { // <-- Check audioData.frequencies directly
    try {
      const frequenciesData = JSON.parse(audioData.frequencies);
      if (Array.isArray(frequenciesData)) {
        frequenciesData.forEach(freqInfo => {
          totalErrors += freqInfo.errorCount || 0;
          totalSpikes += freqInfo.spikeCount || 0;
        });
      }
      if (totalErrors > 0 || totalSpikes > 0) {
        logger.info(`Parsed signal quality from Trunk Recorder: ${totalErrors} errors, ${totalSpikes} spikes`);
      }
    } catch (parseError) {
      logger.warn(`Failed to parse frequencies JSON for ${filename}: ${parseError.message}`);
    }
  }
  // --- END NEW --- 

  // Double-check file extension before processing (keep this validation)
  if (isIgnoredFileType(filename)) {
    logger.info(`Skipping processing of unsupported file type: ${filename}`);
    fs.unlink(tempPath, (err) => {
      if (err) logger.error(`Error deleting unsupported file ${tempPath}:`, err);
      else logger.info(`Deleted unsupported file: ${filename}`);
    });
    return;
  }

  // Verify the file exists before proceeding (Moved here from processNextTranscription)
  if (!fs.existsSync(tempPath)) {
    logger.error(`Audio file doesn't exist when starting handleNewAudio: ${tempPath}`);
    return;
  }

  // Read file into buffer (This is needed for DB blob AND for S3->Local transcription)
  fs.readFile(tempPath, (err, fileBuffer) => {
    if (err) {
      logger.error(`Error reading audio file ${tempPath}:`, err);
      // Clean up temp file if read fails
       fs.unlink(tempPath, (errUnlink) => {
           if (errUnlink) logger.error(`Error deleting temp file after read error ${tempPath}:`, errUnlink);
       });
      return;
    }

    // --- Start DB Operations --- Miminized changes here
    // Determine the storage path/key based on STORAGE_MODE
    let storagePath;
    if (STORAGE_MODE === 's3') {
      // For S3, we store the filename as the key (assuming it's unique enough)
      // You might want a more structured path like 'audio/YYYY/MM/DD/filename'
      storagePath = filename;
      logger.info(`[S3 Storage] Using S3 key: ${storagePath} for transcription ID (to be determined)`);
    } else {
      // For local storage, we store the filename relative to the 'audio' directory
      storagePath = filename;
      logger.info(`[Local Storage] Using local path: ${storagePath} for transcription ID (to be determined)`);
    }

    // Insert initial record into transcriptions table
    const unixTimestampSeconds = Number(dateTime); // Directly use dateTime, ensuring it's a number
    if (isNaN(unixTimestampSeconds)) {
      logger.error(`Invalid dateTime encountered in handleNewAudio: ${dateTime} for filename ${filename}. Cannot insert into DB.`);
      // Clean up temp file if timestamp is invalid
      fs.unlink(tempPath, (errUnlink) => {
          if (errUnlink) logger.error(`Error deleting temp file after invalid dateTime ${tempPath}:`, errUnlink);
      });
      return;
    }

    db.run(
      `INSERT INTO transcriptions (talk_group_id, timestamp, transcription, audio_file_path, address, lat, lon) VALUES (?, ?, ?, ?, NULL, NULL, NULL)`,
      [talkGroupID, unixTimestampSeconds, '', storagePath], // Use the Unix timestamp
      function (err) {
        if (err) {
          logger.error(`Error inserting initial transcription record for ${filename}:`, err);
          // If DB insert fails, delete the temp file
          fs.unlink(tempPath, (errUnlink) => {
              if (errUnlink) logger.error(`Error deleting temp file after initial insert error ${tempPath}:`, errUnlink);
          });
          return;
        }

        const transcriptionId = this.lastID; // Get the ID from the database insert
        logger.info(`Created transcription record ID ${transcriptionId} using storage path: ${storagePath}`);

        // Conditionally insert audio blob for Listen Live feature (local storage only)
        if (STORAGE_MODE !== 's3') {
            db.run(
              `INSERT INTO audio_files (transcription_id, audio_data) VALUES (?, ?)`,
              [transcriptionId, fileBuffer],
              (err) => {
                if (err) {
                  logger.error(`Error inserting audio blob for transcription ID ${transcriptionId}:`, err);
                } else {
                  logger.info(`Saved audio blob for transcription ID ${transcriptionId}`);
                }
              }
            );
        }

        // --- NEW: Define function to handle transcription *after* storage is complete ---
        const afterStorageComplete = (finalPathIfLocal) => { // finalPathIfLocal is null for S3, path string for local

            // Define the common callback for processing transcription results
            const processingCallback = (transcriptionText) => {
                if (!transcriptionText) {
                  logger.warn(`No transcription obtained for ID ${transcriptionId} (${filename})`);
                  updateTranscription(transcriptionId, "", () => {
                    logger.info(`Updated DB with empty transcription for ID ${transcriptionId}`);
                    // Clean up temp file only if storage was S3
                    if (STORAGE_MODE === 's3') {
                      // Use setImmediate to avoid file handle race conditions
                      setImmediate(() => {
                         fs.unlink(tempPath, (errUnlink) => {
                           if (errUnlink && errUnlink.code !== 'ENOENT') {
                             logger.error(`Error deleting temp file (after empty transcription) ${tempPath}:`, errUnlink);
                           } else if (!errUnlink) {
                             logger.info(`Deleted temp file (after empty transcription): ${path.basename(tempPath)}`);
                           }
                         });
                      });
                    }
                  });
                  return;
                }

                logger.info(`Transcription Text: ${transcriptionText}`);
                // We got transcription text, update the database
                updateTranscription(transcriptionId, transcriptionText, () => {
                  logger.info(`Updated DB transcription for ID ${transcriptionId}`);

                  // Now handle the logic that uses the transcription
                  handleNewTranscription(
                    transcriptionId, transcriptionText, talkGroupID, systemName,
                    talkGroupName, source, talkGroupGroup, storagePath, // Pass storagePath
                    totalErrors, totalSpikes // <-- Pass new counts
                  );

                  // Clean up temp file only if storage was S3
                  if (STORAGE_MODE === 's3') {
                    // Use setImmediate to avoid file handle race conditions
                    setImmediate(() => {
                      fs.unlink(tempPath, (errUnlink) => {
                         if (errUnlink && errUnlink.code !== 'ENOENT') {
                           logger.error(`Error deleting temp file (after successful transcription) ${tempPath}:`, errUnlink);
                         } else if (!errUnlink) {
                           logger.info(`Deleted temp file (after successful transcription): ${path.basename(tempPath)}`);
                         }
                      });
                    });
                  }
                  logger.info(`Successfully processed: ${filename}`);
                });
            };
            // --- End common callback definition ---

            // --- Choose transcription method based on mode ---
            logger.info(`Initiating transcription for ID ${transcriptionId} using mode: ${effectiveTranscriptionMode}`);

            if (effectiveTranscriptionMode === 'openai') {
                // OpenAI API transcription mode
                const pathToUse = (STORAGE_MODE === 'local') ? finalPathIfLocal : tempPath;
                transcribeWithOpenAIAPI(pathToUse, processingCallback);
            } else if (effectiveTranscriptionMode === 'remote') {
                // Use the remote function for faster-whisper server
                const pathToUseForRemote = (STORAGE_MODE === 'local') ? finalPathIfLocal : tempPath;
                transcribeAudioRemotely(pathToUseForRemote, processingCallback);
            } else if (effectiveTranscriptionMode === 'icad') {
                // ICAD API transcription mode (OpenAI-compatible interface)
                const pathToUse = (STORAGE_MODE === 'local') ? finalPathIfLocal : tempPath;
                transcribeWithICADAPI(pathToUse, processingCallback);
            } else { // 'local' transcription mode
                const localRequestId = uuidv4();
                let payload;

                if (STORAGE_MODE === 's3') {
                    // S3 Storage + Local Transcription: Send buffer
                    logger.info(`Queueing local transcription (ID: ${localRequestId}) for DB ID ${transcriptionId} using BASE64 BUFFER`);
                    
                    // Check buffer size before encoding to prevent memory issues
                    const bufferSizeMB = fileBuffer.length / (1024 * 1024);
                    if (bufferSizeMB > 45) { // Leave some headroom under the 50MB limit
                      logger.error(`Audio buffer too large for local transcription: ${bufferSizeMB.toFixed(2)}MB. Failing transcription for ID ${transcriptionId}.`);
                      processingCallback(""); // Fail the transcription
                      return;
                    }
                    
                    payload = {
                        command: 'transcribe',
                        id: localRequestId,
                        audio_data_base64: fileBuffer.toString('base64') // Send the buffer directly
                    };
                    // NOTE: tempPath will be deleted later in processingCallback
                } else {
                    // Local Storage + Local Transcription: Send path
                    // Use the final path if available, otherwise use tempPath for local mode
                    const pathToUse = finalPathIfLocal || tempPath;
                    
                    // Double-check file exists before queuing (race condition protection)
                    if (!fs.existsSync(pathToUse)) {
                         logger.error(`Local audio file ${pathToUse} missing before queuing for local transcription (ID ${transcriptionId}). Aborting.`);
                         processingCallback(""); // Fail the transcription
                         return; // Don't queue
                    }
                    
                    // Verify file is readable
                    try {
                      fs.accessSync(pathToUse, fs.constants.R_OK);
                    } catch (accessError) {
                      logger.error(`Local audio file ${pathToUse} not readable before queuing: ${accessError.message}`);
                      processingCallback(""); // Fail the transcription
                      return;
                    }
                    
                    logger.info(`Queueing local transcription (ID: ${localRequestId}) for DB ID ${transcriptionId} using PATH: ${pathToUse}`);
                    payload = {
                        command: 'transcribe',
                        id: localRequestId,
                        path: pathToUse // Send the final path or temp path
                    };
                }

                // Check if queue is getting too large (high-volume protection)
                if (transcriptionQueue.length >= MAX_QUEUE_SIZE) {
                  logger.error(`Transcription queue full (${MAX_QUEUE_SIZE} items). Dropping oldest items to prevent memory issues.`);
                  
                  // Remove oldest items beyond threshold, keeping newer ones
                  const itemsToRemove = transcriptionQueue.length - PRIORITY_QUEUE_THRESHOLD;
                  for (let i = 0; i < itemsToRemove; i++) {
                    const droppedItem = transcriptionQueue.shift();
                    if (droppedItem && droppedItem.callback) {
                      try {
                        droppedItem.callback(""); // Fail the dropped transcription
                        logger.warn(`Dropped transcription ID ${droppedItem.dbTranscriptionId} due to queue overflow`);
                      } catch (callbackError) {
                        logger.error(`Error executing callback for dropped item: ${callbackError.message}`);
                      }
                    }
                  }
                }

                // Add the job with its specific payload to the queue
                const queueItem = {
                   id: localRequestId, // ID for matching response from Python
                   payload: payload, // Contains either path or base64 data
                   callback: processingCallback,
                   dbTranscriptionId: transcriptionId,
                   queuedAt: Date.now(), // Track when item was queued for debugging
                   priority: Date.now() // Use timestamp as priority (newer = higher priority for busy systems)
                };
                
                // For very busy systems, add to front if queue is large (prioritize recent calls)
                if (transcriptionQueue.length > PRIORITY_QUEUE_THRESHOLD) {
                  transcriptionQueue.unshift(queueItem); // Add to front
                  logger.info(`HIGH VOLUME: Added transcription to front of queue (current size: ${transcriptionQueue.length})`);
                } else {
                  transcriptionQueue.push(queueItem); // Normal operation
                }
                
                // Use setImmediate to avoid potential race conditions in queue processing
                setImmediate(() => {
                  processNextTranscription(); // Trigger the local queue processor
                });
            }
            // --- End mode choice ---
        };
        // --- End afterStorageComplete function definition ---

        // --- Handle Audio Storage based on Mode ---
        if (STORAGE_MODE === 's3') {
          // Upload the buffer to S3
          const s3Params = {
            Bucket: S3_BUCKET_NAME,
            Key: storagePath, // Use the determined S3 key
            Body: fileBuffer,
            // ContentType: 'audio/mpeg', // Or determine dynamically
          };
          s3.upload(s3Params, (s3Err, data) => {
            if (s3Err) {
              logger.error(`Error uploading audio to S3 for transcription ID ${transcriptionId} (key: ${storagePath}):`, s3Err);
              // If S3 upload fails, should we delete the DB record?
              db.run('DELETE FROM transcriptions WHERE id = ?', [transcriptionId], () => {});
              fs.unlink(tempPath, (errUnlink) => { // Delete temp file on S3 error
                  if (errUnlink) logger.error(`Error deleting temp file after S3 upload error ${tempPath}:`, errUnlink);
              });
              return;
            }
            logger.info(`Successfully uploaded audio to S3: ${data.Location}`);
            // Now that S3 upload is done, proceed with transcription choice
            afterStorageComplete(null);
          });
        } else {
          // Local storage: Move temp file to the final location
          const finalLocalPath = path.join(UPLOAD_DIR, storagePath);
          fs.rename(tempPath, finalLocalPath, (renameErr) => {
              if (renameErr) {
                  logger.error(`Error moving temp file ${tempPath} to final location ${finalLocalPath}:`, renameErr);
                  // If rename fails, delete DB record and original temp file
                  db.run('DELETE FROM transcriptions WHERE id = ?', [transcriptionId], () => {});
                  fs.unlink(tempPath, (errUnlink) => {
                      if (errUnlink) logger.error(`Error deleting temp file after rename error ${tempPath}:`, errUnlink);
                  });
                  return;
              }
              logger.info(`Moved audio file to permanent local storage: ${finalLocalPath}`);
              // REMOVED: Modify tempPath to point to the *new* final location for local/local transcription
              // tempPath = finalLocalPath;
              // Call the next step, passing the final local path
              afterStorageComplete(finalLocalPath);
          });
        }
        // --- End Storage Handling ---

        // REMOVED: Original transcription initiation logic moved inside handleStorageAndTranscription

      } // End of db.run callback for transcriptions insert
    ); // End of db.run call for transcriptions
  }); // End of fs.readFile
}

// Helper function to validate individual fields
function isValidField(name, value) {
  return typeof name === 'string' && name.trim() !== '' &&
         typeof value === 'string' && value.trim() !== '';
}

// Function to validate and add fields to the embed
function validateAndAddFields(embed, fields) {
  // Maximum length for field values in Discord embeds is 1024 characters
  const MAX_FIELD_LENGTH = 1024;

  fields.forEach(field => {
    // Ensure name and value are strings and not empty
    const name = String(field.name || 'Unnamed Field').trim();
    let value = String(field.value || 'No information available').trim();
    
    // Truncate value if it exceeds Discord's limit
    if (value.length > MAX_FIELD_LENGTH) {
      value = value.substring(0, MAX_FIELD_LENGTH - 3) + '...';
    }

    // Only add field if both name and value are non-empty
    if (name && value) {
      try {
        embed.addFields({
          name: name,
          value: value,
          inline: Boolean(field.inline)
        });
      } catch (error) {
        console.error(`Failed to add field: ${name}`, error);
      }
    }
  });

  return embed;
}

// Function to update transcription
function updateTranscription(id, transcriptionText, callback) {
  logger.info(`Calling updateTranscription for ID ${id}`);
  db.run(
    `UPDATE transcriptions SET transcription = ? WHERE id = ?`,
    [transcriptionText, id],
    (err) => {
      if (err) {
        logger.error('Error updating transcription:', err);
      } else {
        logger.info(`Updated transcription for ID ${id}`);
      }
      if (callback) callback();
    }
  );
}

// Function to cleanup old audio files
function cleanupOldAudioFiles() {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  db.run(`DELETE FROM audio_files WHERE created_at < ?`, [sevenDaysAgo], (err) => {
    if (err) {
      logger.error('Error cleaning up old audio files:', err);
    } else {
      logger.info('Cleaned up old audio files');
    }
  });
}

// Run cleanup every day
setInterval(cleanupOldAudioFiles, 24 * 60 * 60 * 1000);

// Function to transcribe audio
function transcribeAudio(filePath, callback) {
  // First check if the file exists before attempting transcription
  if (!fs.existsSync(filePath)) {
    logger.warn(`Audio file does not exist when starting transcription: ${filePath}`);
    if (callback) {
      callback(""); // Return empty string for non-existent files
    }
    return;
  }
  
  // Add file validation step
  try {
    // Check file size - skip files that are too small or too large
    const stats = fs.statSync(filePath);
    if (stats.size < 1000) { // Less than 1KB
      logger.warn(`Audio file too small, likely corrupted: ${filePath} (${stats.size} bytes)`);
      if (callback) callback("");
      return;
    }
    
    // You could add additional validation here if needed
  } catch (error) {
    logger.error(`Error validating audio file: ${error.message}`);
    if (callback) callback("");
    return;
  }
  
  if (!transcriptionProcess) {
    startTranscriptionProcess();
  }
  
  const requestId = uuidv4();
  
  // Create a wrapper callback to match your existing flow
  const processCallback = (transcriptionText) => {
    if (callback) {
      callback(transcriptionText);
    }
  };
  
  // Add to queue with retry mechanism
  transcriptionQueue.push({
    id: requestId,
    path: filePath,
    callback: processCallback,  // Use the wrapper callback
    retries: 0,    // Track retry attempts
    maxRetries: 2  // Maximum number of retries
  });
  
  // Try to process
  processNextTranscription();
}

// Function to get category name based on talkgroupGroup or systemName
function getCategoryName(systemName, talkgroupGroup) {
  if (talkgroupGroup) {
    return talkgroupGroup.trim();
  }

  if (systemName) {
    return systemName.trim();
  }

  return 'Other';
}

// Function to handle new transcription
async function handleNewTranscription(
  id,
  transcriptionText,
  talkGroupID,
  systemName,
  talkGroupName,
  source,
  talkGroupGroup,
  audioFilePath,
  totalErrors,
  totalSpikes
) {
  logger.info(`Starting handleNewTranscription for ID ${id}`);
  logger.info(`Transcription text length: ${transcriptionText.length} characters`);
  logger.info(`Talk Group: ${talkGroupID} - ${talkGroupName}`);

  const timeout = setTimeout(() => {
    logger.error(`Timeout occurred in handleNewTranscription for ID ${id}`);
  }, 40000); // Increased timeout from 15 to 40 seconds

  try {
    if (transcriptionText.length >= 15 && MAPPED_TALK_GROUPS.includes(talkGroupID)) {
      await extractAndProcessAddress(id, transcriptionText, talkGroupID);
    } else if (transcriptionText.length < 15) {
      logger.info(`Skipping address extraction for short transcription (ID ${id}): ${transcriptionText.length} characters`);
    } else {
      logger.info(`Skipping address extraction for non-whitelisted talk group: ${talkGroupID}`);
    }

    // Store the message URL
    let messageUrl = null;
    
    // Update to capture the URL from the callback
    // IMPORTANT: Pass the numeric ID for the audio URL, not talkGroupName
    await new Promise((resolve) => {
      sendTranscriptionMessage(
        talkGroupID, 
        talkGroupName, 
        transcriptionText, 
        systemName, 
        source, 
        id,  // This is the actual numeric ID that should be used for the audio URL
        talkGroupGroup, 
        totalErrors, // <-- Add parameter
        totalSpikes, // <-- Add parameter
        (url) => {
          messageUrl = url;
          resolve();
        }
      );
    });

    // Check for keywords and send alert with the message URL
    const matchedKeywords = await new Promise((resolve, reject) => {
      checkForKeywords(talkGroupID, transcriptionText, (keywords) => {
        if (keywords) resolve(keywords);
        else reject(new Error('Error checking keywords'));
      });
    });

    logger.info(`Matched keywords for ID ${id}: ${matchedKeywords.join(', ') || 'None'}`);

    if (matchedKeywords.length > 0 && alertChannel) {
      logger.info(`Sending alert message for ID ${id}`);
      await sendAlertMessage(
        talkGroupID,
        talkGroupName,
        transcriptionText,
        systemName,
        source,
        id,  // Pass the numeric ID here too
        matchedKeywords,
        messageUrl
      );
    }

    if (activeVoiceChannels.has(talkGroupID)) {
      logger.info(`Playing audio for talk group ${talkGroupID}`);
      playAudioForTalkGroup(talkGroupID, id);
    }

    logger.info(`Finished handling transcription for ID ${id}`);
  } catch (error) {
    logger.error(`Error in handleNewTranscription for ID ${id}: ${error.message}`, { stack: error.stack });
  } finally {
    clearTimeout(timeout);
  }
}

async function extractAndProcessAddress(id, transcriptionText, talkGroupID) {
  logger.info(`Starting address extraction for ID ${id}`);
  
  try {
    const extractedAddress = await extractAddress(transcriptionText, talkGroupID);

    if (extractedAddress) {
      logger.info(`Extracted Address for ID ${id}: ${extractedAddress}`);
      const geocodeResult = await geocodeAddress(extractedAddress);
      
      if (geocodeResult) {
        await updateDatabaseWithCoordinates(id, geocodeResult);
        logger.info(`Successfully geocoded address for ID ${id}: ${geocodeResult.formatted_address}`);
        
        const linkedTranscriptionText = hyperlinkAddress(transcriptionText, geocodeResult.formatted_address);
        await updateTranscriptionWithLinkedText(id, linkedTranscriptionText);
      } else {
        logger.info(`Failed to geocode address for ID ${id}: ${extractedAddress}`);
        await updateDatabaseWithNullCoordinates(id);
      }
    } else {
      logger.info(`No address found for ID ${id}. Skipping geocoding.`);
      await updateDatabaseWithNullCoordinates(id);
    }
  } catch (error) {
    logger.error(`Error in address extraction for ID ${id}: ${error.message}`, {
      stack: error.stack,
      transcriptionTextLength: transcriptionText.length,
      transcriptionTextSample: transcriptionText.substring(0, 100)
    });
    await updateDatabaseWithNullCoordinates(id);
  }

  logger.info(`Finished address extraction and processing for ID ${id}`);
}

async function updateDatabaseWithCoordinates(id, geocodeResult) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE transcriptions SET lat = ?, lon = ?, address = ? WHERE id = ?`,
      [geocodeResult.lat, geocodeResult.lng, geocodeResult.formatted_address, id],
      (err) => {
        if (err) {
          logger.error('Error updating transcription with coordinates:', err);
          reject(err);
        } else {
          logger.info(`Updated transcription ID ${id} with coordinates`);
          resolve();
        }
      }
    );
  });
}

async function updateDatabaseWithNullCoordinates(id) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE transcriptions SET address = NULL, lat = NULL, lon = NULL WHERE id = ?`,
      [id],
      (err) => {
        if (err) {
          logger.error('Error updating transcription to null coordinates:', err);
          reject(err);
        } else {
          logger.info(`Updated transcription ID ${id} with null coordinates`);
          resolve();
        }
      }
    );
  });
}

async function updateTranscriptionWithLinkedText(id, linkedText) {
  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE transcriptions SET transcription = ? WHERE id = ?`,
      [linkedText, id],
      (err) => {
        if (err) {
          logger.error('Error updating transcription with linked text:', err);
          reject(err);
        } else {
          logger.info(`Updated transcription ID ${id} with linked text`);
          resolve();
        }
      }
    );
  });
}

function checkForKeywords(talkGroupID, transcriptionText, callback) {
  db.all(
    `SELECT keyword FROM global_keywords WHERE talk_group_id = ? OR talk_group_id IS NULL`,
    [talkGroupID],
    (err, rows) => {
      if (err) {
        logger.error('Error fetching global keywords', err.message);
        callback([]);
      } else {
        const matchedKeywords = rows
          .map((row) => row.keyword)
          .filter((keyword) =>
            transcriptionText.toLowerCase().includes(keyword.toLowerCase())
          );
        callback(matchedKeywords);
      }
    }
  );
}

function sendAlertMessage(
  talkGroupID,
  talkGroupName,
  transcriptionText,
  systemName,
  source,
  audioID,
  matchedKeywords,
  messageUrl,
  callback
) {
  // Look up the audio_id from the database for this transcription
  db.get('SELECT id FROM audio_files WHERE transcription_id = ?', [audioID], (err, row) => {
    // Use transcription ID as fallback if audio ID not found
    const actualAudioID = (err || !row) ? audioID : row.id;
    
    // Create a URL for the audio file
    const audioUrl = `http://${PUBLIC_DOMAIN}/audio/${actualAudioID}`;
    
    // Log the IDs for debugging
    logger.info(`Alert - Transcription ID: ${audioID}, Audio ID: ${actualAudioID}, URL: ${audioUrl}`);
    
    const formattedTranscription = `**User-${source}**\n${transcriptionText}`;
    
    const embed = new EmbedBuilder()
      .setTitle(`🚨 Alert from ${talkGroupName}`)
      .setDescription(`**Matched Keywords:** ${matchedKeywords.join(', ')}`)
      .setTimestamp()
      .setColor(0xff0000);
    
    // Prepare the fields to be added
    const fields = [
      { name: 'Transcription', value: formattedTranscription },
      { name: 'System', value: systemName || 'Unknown', inline: true },
      { 
        name: 'Links', 
        value: `[🔊 Listen to Audio](${audioUrl})\n[↗️ Jump to Message](${messageUrl})`, 
        inline: false
      }
    ];
    
    // Validate and add the fields
    validateAndAddFields(embed, fields);
    
    // Send the embed message
    alertChannel
      .send({ embeds: [embed] })
      .then(() => {
        logger.info('Alert message sent successfully');
        if (callback) callback();
      })
      .catch((err) => {
        logger.error('Error sending alert message:', err);
        if (callback) callback();
      });
  });
}

function sendTranscriptionMessage(
  talkGroupID,
  talkGroupName,
  transcriptionText,
  systemName,
  source,
  audioID, // This is the transcription ID
  talkGroupGroup,
  totalErrors, // <-- Add parameter
  totalSpikes, // <-- Add parameter
  callback // Callback to pass the message URL back
) {
  // Get the full talkgroup name and county from the database
  db.get(
    `SELECT alpha_tag, county FROM talk_groups WHERE id = ?`,
    [talkGroupID],
    (err, row) => {
      if (err) {
        logger.error('Error fetching talkgroup info:', err);
        if (callback) callback(); // Ensure callback is called even on error
        return;
      }

      if (!row) {
        logger.error(`No talk group found for ID: ${talkGroupID}`);
        if (callback) callback(); // Ensure callback is called even on error
        return;
      }

      const fullTalkGroupName = row.alpha_tag || talkGroupName || `TG ${talkGroupID}`; // Use provided name as fallback
      const categoryName = row.county || 'Uncategorized'; // Use county for category

      // Determine the channel name (full talk group name, sanitized)
      const channelName = getChannelName(fullTalkGroupName);

      // Get or create the category
      getOrCreateCategory(categoryName, (category) => {
        if (!category) {
          logger.error('Failed to get or create category.');
          if (callback) callback(); // Ensure callback is called even on error
          return;
        }

        // Get or create the channel within the category
        getOrCreateChannel(channelName, category.id, (channel) => {
          if (!channel) {
            logger.error('Failed to get or create channel.');
            if (callback) callback(); // Ensure callback is called even on error
            return;
          }

          // Look up the audio_id from the database for this transcription
          // Note: We use transcription ID (`audioID` parameter) for the URL now
          // as audio_files might get cleaned up.
          // The audio server route /audio/:id expects the transcription ID.
          const audioUrl = `http://${PUBLIC_DOMAIN}/audio/${audioID}`;

          // Log the ID and URL for debugging
          logger.info(`Creating link for Transcription ID: ${audioID}, Audio URL: ${audioUrl}`);

          // Format source display name based on source format
          let sourceDisplay;
          if (!source || source === 'Unknown') {
            sourceDisplay = 'User-Unknown';
          } else if (source.startsWith('TR-')) {
            sourceDisplay = `TrunkRec-${source.substring(3)}`;
          } else if (/^\d+$/.test(source)) {
            sourceDisplay = `Unit-${source}`;
          } else {
            sourceDisplay = `ID-${source}`;
          }

          // --- Add Signal Quality if available --- 
          let signalQualityInfo = '';
          if (totalErrors > 0 || totalSpikes > 0) {
            // Format as italicized string with space before and after
            signalQualityInfo = ` _(SQ: ${totalErrors}E/${totalSpikes}S)_ `;
          }
          // --- End Signal Quality --- 

          // Generate the transcription line with properly formatted source and audio link
          // Place signalQualityInfo immediately after the source display
          const transcriptionLine = `**${sourceDisplay}**${signalQualityInfo}: ${transcriptionText} [Audio](${audioUrl})`;

          // --- Start Modified Block for Length Check ---

          const cacheKey = channel.id;
          const cachedMessage = messageCache.get(cacheKey);
          const currentTime = Date.now();
          const MAX_DESC_LENGTH = 4096; // Discord embed description limit

          // Check if we have a recent message for this channel
          if (cachedMessage && currentTime - cachedMessage.timestamp < MESSAGE_COOLDOWN) {
            // Calculate potential new length BEFORE concatenating
            const potentialNewTranscription = cachedMessage.transcriptions + '\n\n' + transcriptionLine;

            if (potentialNewTranscription.length <= MAX_DESC_LENGTH) {
              // It fits! Update the existing message
              const updatedTranscription = potentialNewTranscription;
              const embed = cachedMessage.message.embeds[0];

              // Use try-catch around embed modification as belt-and-suspenders
              try {
                const newEmbed = EmbedBuilder.from(embed)
                  .setDescription(updatedTranscription) // Safe to set now
                  .setTimestamp();

                cachedMessage.message.edit({ embeds: [newEmbed] })
                  .then((editedMsg) => {
                    // Update the cache with the new combined data
                    const transcriptionIds = cachedMessage.transcriptionIds || [];
                    if (!transcriptionIds.includes(audioID)) {
                      transcriptionIds.push(audioID);
                    }
                    messageCache.set(cacheKey, {
                      message: editedMsg,
                      timestamp: currentTime,
                      transcriptions: updatedTranscription, // Store the combined text
                      url: editedMsg.url,
                      transcriptionIds: transcriptionIds
                    });
                    logger.info(`Updated message with transcription ID ${audioID}, URL: ${editedMsg.url}`);
                    if (callback) {
                      callback(editedMsg.url); // Pass back the message URL
                    }
                  })
                  .catch((err) => {
                    logger.error('Error editing message:', err);
                    // If editing fails, clear cache and send a new message as fallback
                    messageCache.delete(cacheKey);
                    sendNewTranscriptionMessage(channel, fullTalkGroupName, transcriptionLine, talkGroupID, audioID, callback);
                  });

              } catch (embedError) {
                 // This catch block handles potential errors during .from() or .setDescription() itself
                 logger.error('Error modifying embed description (pre-edit):', embedError);
                 messageCache.delete(cacheKey); // Clear cache entry
                 sendNewTranscriptionMessage(channel, fullTalkGroupName, transcriptionLine, talkGroupID, audioID, callback);
              }

            } else {
              // Combined content is too long, send a NEW message instead of editing
              logger.info(`Combined description too long (${potentialNewTranscription.length} > ${MAX_DESC_LENGTH}). Sending new message.`);
              // Invalidate the cache for this channel so the next message *is* new
              messageCache.delete(cacheKey);
              // Call the refactored function to send a new message
              sendNewTranscriptionMessage(channel, fullTalkGroupName, transcriptionLine, talkGroupID, audioID, callback);
            }
          } else {
             // No recent cached message OR the previous attempt decided to send a new one
             // Call the refactored function to send a new message
             sendNewTranscriptionMessage(channel, fullTalkGroupName, transcriptionLine, talkGroupID, audioID, callback);
          }

          // --- End Modified Block ---
        });
      });
    }
  );
}

//function to handle sending a fresh message
function sendNewTranscriptionMessage(channel, fullTalkGroupName, transcriptionLine, talkGroupID, audioID, callback) {
    const listenLiveButton = new ButtonBuilder()
      .setCustomId(`listen_live_${talkGroupID}`)
      .setLabel('🎧 Listen Live')
      .setStyle(ButtonStyle.Primary);

    const askAIButton = new ButtonBuilder() // <-- Add this button
      .setCustomId(`ask_ai_${talkGroupID}`)
      .setLabel('🤖 Ask AI')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(listenLiveButton, askAIButton); // <-- Add the new button here

    // Create the embed for a new message
    const embed = new EmbedBuilder()
      .setTitle(fullTalkGroupName)
      .setDescription(transcriptionLine) // Description is just the single new line here
      .setTimestamp()
      .setColor(0x00ff00);

    // Send the new message
    channel.send({
      embeds: [embed],
      components: [row], // Use the row with both buttons
    })
      .then((msg) => {
        const cacheKey = channel.id;
        const currentTime = Date.now();
        // Cache the new message, starting fresh
        messageCache.set(cacheKey, {
          message: msg,
          timestamp: currentTime,
          transcriptions: transcriptionLine, // Start with just the new line
          url: msg.url,
          transcriptionIds: [audioID] // Initialize with this transcription ID
        });
        logger.info(`Created new message with transcription ID ${audioID}, URL: ${msg.url}`);
        if (callback) {
          callback(msg.url); // Pass back the message URL
        }
      })
      .catch((err) => {
        logger.error('Error sending new transcription message:', err);
        if (callback) callback();
      });
}

// Add a cleanup function to prevent memory leaks
function cleanupMessageCache() {
  const currentTime = Date.now();
  for (const [key, value] of messageCache.entries()) {
    if (currentTime - value.timestamp > MESSAGE_COOLDOWN * 2) {
      messageCache.delete(key);
    }
  }
}

// Function to create or get the summary channel
async function getOrCreateSummaryChannel(guild) {
  let channel = guild.channels.cache.find(
    (channel) => channel.name === 'dispatch-summary' && channel.type === ChannelType.GuildText
  );

  if (!channel) {
    try {
      channel = await guild.channels.create({
        name: 'dispatch-summary',
        type: ChannelType.GuildText,
        topic: 'AI-generated summary of recent interesting transmissions',
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            allow: ['ViewChannel', 'ReadMessageHistory'],
            deny: ['SendMessages'],
          },
        ],
      });
      logger.info('Created dispatch-summary channel.');
    } catch (err) {
      logger.error('Error creating summary channel:', err);
      return null;
    }
  }

  return channel;
}

// Function to fetch recent transcriptions from the database
function getRecentTranscriptions() {
  return new Promise((resolve, reject) => {
    const thirtyMinutesAgoMs = Date.now() - LOOKBACK_PERIOD;
    // Convert to Unix timestamp (seconds) for the query
    const thirtyMinutesAgoUnix = Math.floor(thirtyMinutesAgoMs / 1000);
    
    logger.info(`Fetching transcriptions since Unix timestamp ${thirtyMinutesAgoUnix} (lookback: ${LOOKBACK_HOURS} hours)`);
    
    // Add some debug output
    logger.info(`LOOKBACK_PERIOD in milliseconds: ${LOOKBACK_PERIOD}`);
    
    db.all(
      `SELECT t.id, t.talk_group_id, t.timestamp, t.transcription, t.address, t.lat, t.lon, 
              tg.alpha_tag as talk_group_name, tg.description as talk_group_description, tg.county
       FROM transcriptions t
       LEFT JOIN talk_groups tg ON t.talk_group_id = tg.id
       WHERE t.timestamp > ?
       AND t.transcription != ''
       ORDER BY t.timestamp DESC`,
      // Use the Unix timestamp in the query parameter
      [thirtyMinutesAgoUnix],
      (err, rows) => {
        if (err) {
          logger.error('Error fetching recent transcriptions:', err);
          reject(err);
        } else {
          logger.info(`Retrieved ${rows.length} transcriptions spanning from ${thirtyMinutesAgoUnix} to now`);
          // Add some sample data to debug
          if (rows.length > 0) {
            logger.info(`Earliest transcription: ${rows[rows.length-1].timestamp}`);
            logger.info(`Latest transcription: ${rows[0].timestamp}`);
            logger.info(`Sample timestamp format in DB: ${rows[0].timestamp}`);
          } else {
            // Debug by querying without time filter to see what's in the database
            db.get('SELECT COUNT(*) AS count, MIN(timestamp) AS oldest, MAX(timestamp) AS newest FROM transcriptions WHERE transcription != ""', [], (err, info) => {
              if (!err && info) {
                logger.info(`Database has ${info.count} total transcriptions from ${info.oldest} to ${info.newest}`);
              }
            });
          }
          // Convert timestamp strings to Unix timestamps (seconds)
           const processedRows = rows.map(row => {
             let numericTimestampSeconds;
             if (typeof row.timestamp === 'string') {
                 const tsDate = new Date(row.timestamp);
                 if (!isNaN(tsDate.getTime())) {
                     numericTimestampSeconds = Math.floor(tsDate.getTime() / 1000);
                 } else {
                     logger.warn(`[getRecentTranscriptions] Failed to parse timestamp string: '${row.timestamp}' for row ID: ${row.id}. Setting to 0.`);
                     numericTimestampSeconds = 0;
                 }
             } else if (typeof row.timestamp === 'number') {
                 // If the number is very large (e.g. > 100000000000, which is roughly year 5138 in seconds), assume it's milliseconds.
                 // A more common threshold might be around 30_000_000_000 (year 2920 in seconds) if only expecting up to ms.
                 // For this context, timestamps from DB are expected to be seconds primarily.
                 // If a number is much larger than typical seconds timestamps (e.g. > 3 * 10^9, roughly year 2065), it might be ms.
                 if (row.timestamp > 4000000000) { // Heuristic: if it's a large number (e.g. > year 2096 in secs), likely ms
                      numericTimestampSeconds = Math.floor(row.timestamp / 1000);
                 } else { // Assumed to be seconds
                      numericTimestampSeconds = row.timestamp;
                 }
             } else {
                 logger.warn(`[getRecentTranscriptions] Unexpected timestamp type for row ID ${row.id}: ${typeof row.timestamp} value: ${row.timestamp}. Setting to 0.`);
                 numericTimestampSeconds = 0;
             }
             return { ...row, timestamp: numericTimestampSeconds };
           });
           resolve(processedRows);
        }
      }
    );
  });
}

function getMessageUrlForTranscription(transcriptionId, suppressWarnings = false) {
  return new Promise((resolve) => {
    // First try to find the URL directly from the database
    db.get(
      `SELECT t.talk_group_id, tg.alpha_tag
       FROM transcriptions t
       LEFT JOIN talk_groups tg ON t.talk_group_id = tg.id
       WHERE t.id = ?`,
      [transcriptionId],
      async (err, row) => {
        if (err || !row) {
          if (!suppressWarnings) {
            logger.error(`Error or no results fetching talk group for transcription ${transcriptionId}:`, err);
          }
          resolve(null);
          return;
        }
        
        // Got the talk group, now try to find a message in that talk group's channel
        const talkGroupID = row.talk_group_id;
        const talkGroupName = row.alpha_tag || `TG ${talkGroupID}`;
        const channelName = getChannelName(talkGroupName);
        
        // Try to find the channel
        const guild = client.guilds.cache.first();
        const channel = guild?.channels.cache.find(
          ch => ch.name === channelName && ch.type === ChannelType.GuildText
        );
        
        if (!channel) {
          if (!suppressWarnings) {
            logger.warn(`Couldn't find channel for talk group ${talkGroupName}`);
          }
          resolve(null);
          return;
        }
        
        // Look through cached messages for this channel
        for (const [channelId, cachedData] of messageCache.entries()) {
          if (channelId === channel.id && 
              cachedData.transcriptions && 
              cachedData.url) {
            // Check if this message contains our transcription ID
            if (cachedData.transcriptionIds && cachedData.transcriptionIds.includes(transcriptionId)) {
              logger.info(`Found message URL for transcription ${transcriptionId} in channel cache`);
              resolve(cachedData.url);
              return;
            }
          }
        }
        
        // If not found in cache, try fetching recent messages from the channel
        try {
          const messages = await channel.messages.fetch({ limit: 10 });
          for (const [_, message] of messages) {
            if (message.author.id === client.user.id && 
                message.embeds.length > 0) {
              // Use the transcriptionIds array we store in the cache
              const cachedData = messageCache.get(channel.id);
              if (cachedData && cachedData.transcriptionIds && cachedData.transcriptionIds.includes(transcriptionId)) {
                logger.info(`Found message URL for transcription ${transcriptionId} in channel history`);
                resolve(message.url);
                return;
              }
            }
          }
        } catch (error) {
          if (!suppressWarnings) {
            logger.error(`Error fetching messages for transcription ${transcriptionId}:`, error);
          }
        }
        
        // If we still haven't found it, return null
        if (!suppressWarnings) {
          logger.warn(`Couldn't find message URL for transcription ${transcriptionId}`);
        }
        resolve(null);
      }
    );
  });
}

// Function to send data to Ollama and get summary
async function generateSummary(transcriptions) {
  try {
    if (transcriptions.length === 0) {
      return { 
        summary: `No notable transmissions in the past ${LOOKBACK_HOURS} ${LOOKBACK_HOURS === 1 ? 'hour' : 'hours'}.`, 
        highlights: [] 
      };
    }
    
    // Prepare the transcriptions in a format useful for the AI
    const formattedTranscriptions = transcriptions
      .map(t => {
        // Format timestamp for human readability - Multiply by 1000
        const callDate = new Date(t.timestamp * 1000);
        const formattedTime = callDate.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone: TIMEZONE
        });
        
        // Add minutes ago for easier time reference - Multiply by 1000
        const minutesAgo = Math.floor((Date.now() - (t.timestamp * 1000)) / (60 * 1000));
        
        // Extract more meaningful information
        return {
          id: t.id,
          talk_group_id: t.talk_group_id,
          talk_group: t.talk_group_name || `TG ${t.talk_group_id}`,
          county: t.county || 'Unknown',
          timestamp: t.timestamp,
          formatted_time: formattedTime,
          minutes_ago: minutesAgo,
          transcription: t.transcription,
          location: t.address ? `${t.address} (${t.lat}, ${t.lon})` : 'Unknown'
        };
      });
    
    // Group transmissions by time periods to ensure distribution
    const now = new Date();
    const periodCount = 4; // Divide the hour into 4 quarters
    const periodLength = LOOKBACK_HOURS * 60 / periodCount; // in minutes
    
    const timeBuckets = Array(periodCount).fill().map(() => []);
    
    // Sort transcriptions into time buckets
    formattedTranscriptions.forEach(t => {
      // Assign minutes_ago to the object if it wasn't already done (it is done earlier)
      const minutesAgo = t.minutes_ago;
      
      const bucketIndex = Math.min(periodCount - 1, Math.floor(minutesAgo / periodLength));

      // --- DEBUG LOGGING ---
      // Use debug level for potentially verbose logs
      logger.debug(`[SummaryBucket] TS: ${t.timestamp}, MinutesAgo: ${minutesAgo}, PeriodLength: ${periodLength}, BucketIndex: ${bucketIndex}`);
      // --- END DEBUG LOGGING ---

      // --- GUARD CONDITION ---
      if (bucketIndex >= 0 && bucketIndex < periodCount && timeBuckets[bucketIndex]) {
        timeBuckets[bucketIndex].push(t);
      } else {
        logger.warn(`[SummaryBucket] Invalid bucketIndex (${bucketIndex}) or undefined bucket for timestamp ${t.timestamp}. Skipping push.`);
        // Optionally log the problematic transcription object:
        // logger.warn(`Problematic transcription object: ${JSON.stringify(t)}`);
      }
      // --- END GUARD CONDITION ---
    });
    
    // Get time range for the analyzed data
    const earliest = new Date(now.getTime() - LOOKBACK_PERIOD);
    const earliestTime = formattedTranscriptions.length > 0 ? 
      // Multiply by 1000
      new Date(Math.min(...formattedTranscriptions.map(t => t.timestamp * 1000))).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TIMEZONE }) : 
      new Date(Date.now() - LOOKBACK_PERIOD).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TIMEZONE });
    
    const latestTime = formattedTranscriptions.length > 0 ? 
      // Multiply by 1000
      new Date(Math.max(...formattedTranscriptions.map(t => t.timestamp * 1000))).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TIMEZONE }) : 
      new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TIMEZONE });
    
    // Generate time period descriptions for the AI
    const timePeriodsInfo = timeBuckets.map((bucket, index) => {
      const startMinutes = index * periodLength;
      const endMinutes = (index + 1) * periodLength;
      return {
        period: `Period ${index+1}: ${startMinutes}-${endMinutes} minutes ago`,
        count: bucket.length,
        sample_time: bucket.length > 0 ? bucket[0].formatted_time : 'none'
      };
    });
    
    logger.info(`Generating summary for ${formattedTranscriptions.length} transmissions from ${earliestTime} to ${latestTime}`);
    logger.info(`Time periods: ${JSON.stringify(timePeriodsInfo)}`);
    
    // Pre-select highlights from each time period to ensure distribution
    const preSelectedHighlights = [];
    
    // Try to select one from each time bucket
    timeBuckets.forEach((bucket, index) => {
      if (bucket.length > 0) {
        // Sort bucket by transcription length as a simple heuristic for "interestingness"
        bucket.sort((a, b) => b.transcription.length - a.transcription.length);
        
        // Take the longest transcription from each bucket (if available)
        const selection = bucket[0];
        preSelectedHighlights.push(selection);
        
        logger.info(`Selected highlight from Period ${index+1}: ID ${selection.id} at ${selection.formatted_time} (${selection.minutes_ago} min ago)`);
      }
    });
    
    // Limit to 5 highlights max, prioritizing newer ones if we have too many
    if (preSelectedHighlights.length > 5) {
      preSelectedHighlights.sort((a, b) => a.minutes_ago - b.minutes_ago);
      preSelectedHighlights.splice(5);
    }
    
    // Log our pre-selections
    logger.info(`Pre-selected ${preSelectedHighlights.length} highlights with timestamps: ${preSelectedHighlights.map(h => h.formatted_time).join(', ')}`);
    
    // Format for the AI to only analyze these specific transmissions
    const highlightSelections = preSelectedHighlights.map(h => ({
      id: h.id,
      talk_group: h.talk_group,
      timestamp: h.timestamp,
      formatted_time: h.formatted_time,
      minutes_ago: h.minutes_ago,
      transcription: h.transcription,
      location: h.location
    }));
    
    // Create the prompt for the AI - focus only on summarizing, not selecting
    const commonPrompt = `You are an experienced emergency dispatch analyst for a police and fire department. 

First, write a concise summary (2-3 sentences long max) of notable activity in the past ${LOOKBACK_HOURS} ${LOOKBACK_HOURS === 1 ? 'hour' : 'hours'} (from ${earliestTime} to ${latestTime}).

Then, I'veselected ${highlightSelections.length} important transmissions from different time periods for you to analyze. For EACH of these transmissions, provide:
1) A clear, detailed description of what's happening (1 sentence long max)
2) An importance rating (High/Medium/Low)

The transmissions I've selected span across the hour to give a representative view:
${JSON.stringify(highlightSelections)}

Return ONLY a JSON object with this format:
{
  "summary": "Brief overall summary of notable activity covering the full time period",
  "highlights": [
    {
      "id": transcription_id (use the exact id I provided),
      "talk_group": "Talk group name (use what I provided)",
      "importance": "High/Medium/Low based on urgency and public safety impact",
      "description": "Clear, detailed description of what's happening in this transmission and why it matters",
      "timestamp": "original timestamp (use what I provided)"
    }
  ]
}

Focus on providing insightful analysis of each transmission. The "description" field should help someone understand exactly what's happening without needing to listen to the audio.
Include no other text besides this JSON.`;

    // Call the AI provider with a timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    let resultText = '';
    
    try {
      if (AI_PROVIDER.toLowerCase() === 'openai') {
        if (!OPENAI_API_KEY) {
            logger.error("[Bot] FATAL: AI_PROVIDER is set to openai, but OPENAI_API_KEY is not configured!");
            throw new Error("OpenAI API key is not configured.");
        }
        logger.info(`[Bot] Generating summary with OpenAI model: ${OPENAI_MODEL}`);

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                messages: [{ role: 'user', content: commonPrompt }],
                temperature: 0.3,
                response_format: { type: "json_object" } // Request JSON output
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`OpenAI API error! status: ${response.status}. Body: ${errorBody}`);
        }
        const result = await response.json();
        if (result.choices && result.choices.length > 0 && result.choices[0].message) {
            resultText = result.choices[0].message.content;
        }

      } else { // Default to Ollama
        logger.info(`[Bot] Generating summary with Ollama model: ${OLLAMA_MODEL}`);

        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            prompt: commonPrompt,
            stream: false
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Ollama API error! status: ${response.status}`);
        }
        
        const data = await response.json();
        resultText = data.response;
      }
      
      clearTimeout(timeout);
      
      // Extract the JSON part from the response (works for both providers)
      const jsonMatch = resultText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsedJson = JSON.parse(jsonMatch[0]);
          
          // Ensure summary reflects the correct time period
          if (parsedJson.summary && !parsedJson.summary.includes(`${LOOKBACK_HOURS}`)) {
            parsedJson.summary = parsedJson.summary.replace(
              /past hour|last hour|recent hour/, 
              `past ${LOOKBACK_HOURS} ${LOOKBACK_HOURS === 1 ? 'hour' : 'hours'}`
            );
          }
          
          // --- ADD THIS: Ensure timestamps in highlights are numbers ---
          if (parsedJson.highlights && Array.isArray(parsedJson.highlights)) {
            parsedJson.highlights.forEach(highlight => {
              if (highlight.timestamp && typeof highlight.timestamp === 'string') {
                const numericTimestamp = parseFloat(highlight.timestamp);
                if (!isNaN(numericTimestamp)) {
                  highlight.timestamp = numericTimestamp;
                } else {
                  logger.warn(`[generateSummary] Could not convert timestamp string "${highlight.timestamp}" to number for highlight ID ${highlight.id}. Leaving as is.`);
                }
              } else if (typeof highlight.timestamp !== 'number') {
                // If it's not a string and not a number, log a warning and attempt to parse or set to a default
                logger.warn(`[generateSummary] Timestamp for highlight ID ${highlight.id} is not a string or number: ${typeof highlight.timestamp}, value: ${highlight.timestamp}. Attempting to parse or default.`);
                const numericTimestamp = parseFloat(highlight.timestamp); // Attempt to parse whatever it is
                highlight.timestamp = !isNaN(numericTimestamp) ? numericTimestamp : 0; // Default to 0 if unparseable
              }
            });
          }
          // --- END ADDED CODE ---

          // Log summary creation success with time details
          logger.info(`Successfully generated summary with ${parsedJson.highlights?.length || 0} highlights`);
          
          // Add a check to verify time distribution
          if (parsedJson.highlights && parsedJson.highlights.length > 0) {
            const timestamps = parsedJson.highlights.map(h => new Date(h.timestamp).toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            }));
            logger.info(`Highlight timestamps: ${timestamps.join(', ')}`);
          }
          
          return parsedJson;
        } catch (e) {
          logger.error('Error parsing AI provider JSON response:', e);
          return { 
            summary: `Error processing summary for the past ${LOOKBACK_HOURS} ${LOOKBACK_HOURS === 1 ? 'hour' : 'hours'}.`, 
            highlights: [] 
          };
        }
      } else {
        logger.error('No JSON found in AI provider response');
        return { 
          summary: `Unable to generate a structured summary for the past ${LOOKBACK_HOURS} ${LOOKBACK_HOURS === 1 ? 'hour' : 'hours'}.`, 
          highlights: [] 
        };
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request to AI provider timed out after 30 seconds');
      }
      throw error;
    }
  } catch (error) {
    logger.error(`Error generating summary with AI provider: ${error.message}`);
    
    // Create a basic fallback summary
    const timeframe = `${LOOKBACK_HOURS} ${LOOKBACK_HOURS === 1 ? 'hour' : 'hours'}`;
    
    // If we have transcriptions, create a simple highlight of the most recent ones
    if (transcriptions.length > 0) {
      // Select highlights across different time periods for fallback
      const fallbackHighlights = [];
      
      // Sort by timestamp
      const sortedTranscriptions = [...transcriptions].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      // Try to get one from each quarter of the time period
      const totalItems = sortedTranscriptions.length;
      if (totalItems > 0) {
        for (let i = 0; i < Math.min(5, totalItems); i++) {
          // Get index that's distributed across the array
          const index = Math.floor(i * totalItems / 5);
          fallbackHighlights.push({
            id: sortedTranscriptions[index].id,
            talk_group: sortedTranscriptions[index].talk_group_name || `TG ${sortedTranscriptions[index].talk_group_id}`,
            importance: "Medium",
            description: sortedTranscriptions[index].transcription.length > 100 ? 
              sortedTranscriptions[index].transcription.substring(0, 97) + '...' : 
              sortedTranscriptions[index].transcription,
            timestamp: sortedTranscriptions[index].timestamp
          });
        }
      }
      
      return { 
        summary: `There were ${transcriptions.length} transmissions in the past ${timeframe}. AI summary unavailable: ${error.message}`, 
        highlights: fallbackHighlights 
      };
    }
    
    return { 
      summary: `Failed to generate summary for the past ${timeframe}: ${error.message}`, 
      highlights: [] 
    };
  }
}

// Add this function to save the summary to a JSON file
function saveSummaryToJson(summary, highlights) {
  try {
    // Make sure the directory exists
    const publicDir = path.join(__dirname, 'public');
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }
    
    // Format highlights for the website (omitting audio links)
    const formattedHighlights = highlights.map(highlight => {
      let timestampDisplay;
      // Ensure highlight.timestamp is a number and not NaN
      if (typeof highlight.timestamp === 'number' && !isNaN(highlight.timestamp)) {
        try {
          const originalTimestamp = new Date(highlight.timestamp * 1000); // Multiply by 1000
          timestampDisplay = originalTimestamp.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
          });

          if (timestampDisplay === 'Invalid Date') {
            logger.warn(`[saveSummaryToJson] Formatted time is \'Invalid Date\' for highlight ID ${highlight.id} (timestamp value: ${highlight.timestamp}). Original Date obj was: ${originalTimestamp.toISOString()}`);
            timestampDisplay = 'Time N/A';
          }
        } catch (err) {
          logger.error(`[saveSummaryToJson] Error formatting timestamp for highlight ID ${highlight.id} (timestamp value: ${highlight.timestamp}): ${err.message}`);
          timestampDisplay = 'Time N/A';
        }
      } else {
        logger.warn(`[saveSummaryToJson] highlight.timestamp (\'${highlight.timestamp}\') is invalid or missing for highlight ID ${highlight.id}. Full highlight: ${JSON.stringify(highlight)}`);
        timestampDisplay = 'Time N/A';
      }
      
      return {
        id: highlight.id,
        talk_group: highlight.talk_group,
        importance: highlight.importance,
        description: highlight.description,
        time: timestampDisplay // Use the processed timestampDisplay
      };
    });
    
    // Create the JSON object with timestamp
    const jsonData = {
      summary: summary,
      highlights: formattedHighlights,
      updated: new Date().toISOString(),
      time_range: `Past ${LOOKBACK_HOURS} ${LOOKBACK_HOURS === 1 ? 'Hour' : 'Hours'}`
    };
    
    // Write to file
    const jsonPath = path.join(publicDir, 'summary.json');
    fs.writeFileSync(jsonPath, JSON.stringify(jsonData, null, 2));
    
    logger.info(`Saved summary to ${jsonPath}`);
  } catch (error) {
    logger.error(`Error saving summary to JSON file: ${error.message}`);
  }
}

// Function to create or update the summary embed
async function updateSummaryEmbed() {
  try {
    const guild = client.guilds.cache.first();
    if (!guild) {
      logger.error('No guild found for the bot.');
      return;
    }
    
    // Get or create the summary channel
    if (!summaryChannel) {
      summaryChannel = await getOrCreateSummaryChannel(guild);
      if (!summaryChannel) {
        logger.error('Failed to get or create summary channel.');
        return;
      }
    }
    
    // Get recent transcriptions
    const transcriptions = await getRecentTranscriptions();
    logger.info(`Found ${transcriptions.length} recent transcriptions for summary spanning past ${LOOKBACK_HOURS} hour(s).`);
    
    // Add time span information
    let timeSpanInfo = "";
    if (transcriptions.length > 0) {
      const sortedTranscriptions = [...transcriptions].sort((a, b) => new Date(a.timestamp * 1000) - new Date(b.timestamp * 1000)); // Multiply by 1000
      const earliest = new Date(sortedTranscriptions[0].timestamp * 1000); // Multiply by 1000
      const latest = new Date(sortedTranscriptions[sortedTranscriptions.length - 1].timestamp * 1000); // Multiply by 1000
      
      const formatTime = (date) => date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true,
        timeZone: TIMEZONE
      });
      
      timeSpanInfo = `(${formatTime(earliest)} to ${formatTime(latest)})`;
      logger.info(`Summary time span: ${timeSpanInfo}`);
    }
    
    // Generate summary
    let summary;
    try {
      summary = await generateSummary(transcriptions);
    } catch (summaryError) {
      logger.error(`Error in summary generation: ${summaryError.message}`);
      summary = {
        summary: `Error generating summary: ${summaryError.message}. Please try again later.`,
        highlights: []
      };
    }
    
    // Save the summary to JSON file for the website
    saveSummaryToJson(summary.summary, summary.highlights);
    
    // Create the embed with time span info
    const embed = new EmbedBuilder()
      .setTitle(`📻 Dispatch Summary - Past ${LOOKBACK_HOURS} ${LOOKBACK_HOURS === 1 ? 'Hour' : 'Hours'} ${timeSpanInfo}`)
      .setDescription(summary.summary)
      .setTimestamp()
      .setColor(0x3498db)
      .setFooter({ text: 'Updates every 10 minutes • Powered by AI' });
    
    // Add highlights
    if (summary.highlights && summary.highlights.length > 0) {
      for (const highlight of summary.highlights) {
        // Get audio URL
        const audioUrl = `http://${PUBLIC_DOMAIN}/audio/${highlight.id}`;
        
        // Fix timestamp display - use timestamp directly from database
        let timestampDisplay;
        // Ensure highlight.timestamp is a number and not NaN
        if (typeof highlight.timestamp === 'number' && !isNaN(highlight.timestamp)) {
          try {
            const originalTimestamp = new Date(highlight.timestamp * 1000); // Multiply by 1000

            // Format the database timestamp directly
            timestampDisplay = originalTimestamp.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
              timeZone: TIMEZONE
            });

            // Explicitly check if toLocaleTimeString returned "Invalid Date"
            if (timestampDisplay === 'Invalid Date') {
              logger.warn(`[updateSummaryEmbed] Formatted time is \'Invalid Date\' for highlight ID ${highlight.id} (timestamp value: ${highlight.timestamp}). Original Date obj was: ${originalTimestamp.toISOString()}`);
              timestampDisplay = 'Time N/A'; // Fallback for "Invalid Date" string
            }
          } catch (err) {
            logger.error(`[updateSummaryEmbed] Error formatting timestamp for highlight ID ${highlight.id} (timestamp value: ${highlight.timestamp}): ${err.message}`);
            timestampDisplay = 'Time N/A'; // Fallback for other errors during date processing
          }
        } else {
          logger.warn(`[updateSummaryEmbed] highlight.timestamp (\'${highlight.timestamp}\') is invalid or missing for highlight ID ${highlight.id}. Full highlight: ${JSON.stringify(highlight)}`);
          timestampDisplay = 'Time N/A'; // Fallback if timestamp is not a valid number
        }
        
        // Format the field
        let fieldValue = `**${highlight.description}**\n`;
        fieldValue += `*${timestampDisplay} • Importance: ${highlight.importance}*\n`;
        
        // Only add the audio link - NO message URL for summary
        fieldValue += `[🔊 Listen](${audioUrl})`;
        
        embed.addFields({
          name: highlight.talk_group,
          value: fieldValue,
          inline: false
        });
      }
    } else {
      embed.addFields({
        name: 'No Highlights',
        value: 'No significant transmissions detected in the past hour.',
        inline: false
      });
    }
    
    // Add status field if there was an error with AI provider
    if (summary.summary.includes('Error') || summary.summary.includes('unavailable')) {
      embed.addFields({
        name: '⚠️ AI Service Status',
        value: 'The AI summary service is currently experiencing issues. Please check the server logs for more information.',
        inline: false
      });
    }
    
    // Create refresh button
    const refreshButton = new ButtonBuilder()
      .setCustomId('refresh_summary')
      .setLabel('🔄 Refresh Now')
      .setStyle(ButtonStyle.Secondary);
    
    const row = new ActionRowBuilder().addComponents(refreshButton);
    
    // Update or send the message
    if (summaryMessage) {
      try {
        await summaryMessage.edit({ embeds: [embed], components: [row] });
        logger.info('Updated summary embed message.');
      } catch (err) {
        logger.error('Error updating summary message, will create new one:', err);
        summaryMessage = await summaryChannel.send({ embeds: [embed], components: [row] });
      }
    } else {
      // Find the most recent message in the channel
      const messages = await summaryChannel.messages.fetch({ limit: 1 });
      if (messages.size > 0 && messages.first().author.id === client.user.id) {
        summaryMessage = messages.first();
        await summaryMessage.edit({ embeds: [embed], components: [row] });
        logger.info('Updated existing summary message found in channel.');
      } else {
        // Create a new message
        summaryMessage = await summaryChannel.send({ embeds: [embed], components: [row] });
        logger.info('Created new summary embed message.');
      }
    }
    
    lastSummaryUpdate = Date.now();
    
  } catch (error) {
    logger.error('Error updating summary embed:', error);
  }
}
// Scheduler to update summary
function startSummaryScheduler() {
  // Run initial summary
  updateSummaryEmbed();
  
  // Set up the interval
  setInterval(async () => {
    const timeSinceLastUpdate = Date.now() - lastSummaryUpdate;
    if (timeSinceLastUpdate >= SUMMARY_INTERVAL) {
      logger.info('Running scheduled summary update...');
      await updateSummaryEmbed();
    }
  }, 60000); // Check every minute
}

// Add this to your existing interval cleanups
setInterval(cleanupMessageCache, 3600000); // Clean up every hour

function getChannelName(talkGroupName) {
  // Use the full Talk Group Name as the channel name, sanitized
  return talkGroupName.toLowerCase()
    .replace(/\s+/g, '-')  // Replace spaces with hyphens
    .replace(/[^a-z0-9\-]/g, '')  // Remove any characters that aren't lowercase letters, numbers, or hyphens
    .substring(0, 32);  // Discord has a 32 character limit on channel names
}

const categoryCache = new Map();

function getOrCreateCategory(categoryName, callback) {
  const guild = client.guilds.cache.first();
  if (!guild) {
    logger.error('No guild found for the bot.');
    callback(null);
    return;
  }

  let category = guild.channels.cache.find(
    (channel) => channel.name === categoryName && channel.type === ChannelType.GuildCategory
  );

  if (category) {
    callback(category);
  } else {
    guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
    })
      .then((newCategory) => {
        callback(newCategory);
      })
      .catch((err) => {
        logger.error('Error creating category:', err);
        callback(null);
      });
  }
}

const channelCache = new Map();

function getOrCreateChannel(channelName, categoryId, callback) {
  const cacheKey = `${categoryId}-${channelName}`;
  if (channelCache.has(cacheKey)) {
    callback(channelCache.get(cacheKey));
  } else {
    const guild = client.guilds.cache.first();
    if (!guild) {
      logger.error('No guild found for the bot.');
      callback(null);
      return;
    }

    let channel = guild.channels.cache.find(
      (ch) =>
        ch.name === channelName && ch.parentId === categoryId && ch.type === ChannelType.GuildText
    );

    if (channel) {
      channelCache.set(cacheKey, channel);
      callback(channel);
    } else {
      guild.channels
        .create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: categoryId,
          topic: `Transcriptions for ${channelName.replace(/-/g, ' ')}`,
          permissionOverwrites: [
            {
              id: guild.roles.everyone.id,
              allow: ['ViewChannel', 'ReadMessageHistory'],
              deny: ['SendMessages'],
            },
          ],
        })
        .then((newChannel) => {
          channelCache.set(cacheKey, newChannel);
          callback(newChannel);
        })
        .catch((err) => {
          logger.error('Error creating channel:', err);
          callback(null);
        });
    }
  }
}

// Voice channel and audio playback management
const activeVoiceChannels = new Map();
const audioFilesInUse = new Set();

function playAudioForTalkGroup(talkGroupID, transcriptionId) {
  talkGroupID = talkGroupID.toString();
  const talkGroupData = activeVoiceChannels.get(talkGroupID);
  if (!talkGroupData || !talkGroupData.player) {
    logger.error('No active player for talk group:', talkGroupID);
    return;
  }

  if (!talkGroupData.queue) {
    talkGroupData.queue = [];
  }

  talkGroupData.queue.push(transcriptionId);

  if (talkGroupData.player.state.status !== AudioPlayerStatus.Playing) {
    processAudioQueue(talkGroupID);
  } else {
    logger.info(`Added audio to queue for talk group ${talkGroupID}`);
  }
}

function processAudioQueue(talkGroupID) {
  talkGroupID = talkGroupID.toString();
  const talkGroupData = activeVoiceChannels.get(talkGroupID);
  if (!talkGroupData || !talkGroupData.player || !talkGroupData.queue) {
    logger.error('Invalid talk group data while processing queue.');
    return;
  }

  if (talkGroupData.queue.length === 0) {
    logger.info(`Audio queue for talk group ${talkGroupID} is empty.`);
    return;
  }

  const transcriptionId = talkGroupData.queue.shift();
  logger.info(`Now playing audio for talk group ${talkGroupID}: ${transcriptionId}`);

  // --- NEW: Unified audio playing logic ---
  const playStream = (inputStream) => {
    // Common logic to transcode and play a stream
    const transcoder = new prism.FFmpeg({
      args: [
        '-i', 'pipe:0', '-analyzeduration', '0', '-loglevel', '0',
        '-f', 's16le', '-ar', '48000', '-ac', '2',
      ],
    });

    inputStream.pipe(transcoder);

    const resource = createAudioResource(transcoder, {
      inputType: StreamType.Raw,
      inlineVolume: true,
    });
    
    resource.volume.setVolume(1.0);

    talkGroupData.player.play(resource);
    talkGroupData.lastActivity = Date.now();
    
    talkGroupData.player.once(AudioPlayerStatus.Idle, () => processAudioQueue(talkGroupID));
    
    talkGroupData.player.once('error', (error) => {
      logger.error(`Player error for talk group ${talkGroupID}:`, error);
      processAudioQueue(talkGroupID);
    });
  };

  if (STORAGE_MODE === 's3') {
    db.get('SELECT audio_file_path FROM transcriptions WHERE id = ?', [transcriptionId], (err, row) => {
        if (err || !row || !row.audio_file_path) {
            logger.error(`S3 Mode: Could not find audio_file_path for transcription ID ${transcriptionId}`, err);
            processAudioQueue(talkGroupID);
            return;
        }
        const s3Stream = s3.getObject({ Bucket: S3_BUCKET_NAME, Key: row.audio_file_path }).createReadStream();
        s3Stream.on('error', s3Err => {
            logger.error(`Error streaming from S3 for Discord playback (ID ${transcriptionId}):`, s3Err);
            processAudioQueue(talkGroupID);
        });
        playStream(s3Stream);
    });
  } else { // Local mode fallback to DB blob
    db.get('SELECT audio_data FROM audio_files WHERE transcription_id = ?', [transcriptionId], (err, row) => {
        if (err || !row) {
          logger.error('Audio data not found in DB for transcription ID:', transcriptionId);
          processAudioQueue(talkGroupID);
          return;
        }
        const audioBuffer = Buffer.from(row.audio_data);
        const stream = new Readable();
        stream.push(audioBuffer);
        stream.push(null);
        playStream(stream);
      }
    );
  }
}


function deleteAudioFile(transcriptionId) {
  db.run('DELETE FROM audio_files WHERE transcription_id = ?', [transcriptionId], (err) => {
    if (err) {
      logger.error(`Error deleting audio data for transcription ID ${transcriptionId}:`, err.message);
    } else {
      logger.info(`Deleted audio data for transcription ID ${transcriptionId}`);
    }
  });
}

function markAudioFileAsNotNeeded(transcriptionId) {
  audioFilesInUse.delete(transcriptionId);
  if (!audioFilesInUse.has(transcriptionId)) {
    deleteAudioFile(transcriptionId);
  }
}

async function handleListenLive(interaction, talkGroupID) {
  talkGroupID = talkGroupID.toString();
  await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

  const guild = interaction.guild;
  const talkGroupInfo = await getTalkGroupName(talkGroupID);

  let voiceChannel;
  if (activeVoiceChannels.has(talkGroupID)) {
    voiceChannel = activeVoiceChannels.get(talkGroupID).voiceChannel;
  } else {
    voiceChannel = await getOrCreateVoiceChannel(guild, talkGroupID, talkGroupInfo.name);
  }

  if (!voiceChannel) {
    await interaction.editReply('❌ Failed to create or find voice channel.');
    return;
  }

  startStreamingAudio(talkGroupID);
  monitorVoiceChannel(voiceChannel, talkGroupID);

  await interaction.editReply(
    `🎧 Please join the voice channel: ${voiceChannel}\nTalk Group: ${talkGroupInfo.name}`
  );
}

function getTalkGroupName(talkGroupID) {
  return new Promise((resolve) => {
    db.get(
      `SELECT alpha_tag FROM talk_groups WHERE id = ?`,
      [talkGroupID],
      (err, row) => {
        if (err) {
          logger.error('Database error:', err);
          resolve({ name: `TG ${talkGroupID}`, group: 'Unknown' });
        } else if (row) {
          resolve({ name: row.alpha_tag || `TG ${talkGroupID}`, group: 'Unknown' });
        } else {
          logger.error(`No data found for talk group ID ${talkGroupID}`);
          resolve({ name: `TG ${talkGroupID}`, group: 'Unknown' });
        }
      }
    );
  });
}

async function getOrCreateVoiceChannel(guild, talkGroupID, talkGroupName) {
  talkGroupID = talkGroupID.toString();

  if (activeVoiceChannels.has(talkGroupID)) {
    return activeVoiceChannels.get(talkGroupID).voiceChannel;
  } else {
    try {
      const voiceChannel = await guild.channels.create({
        name: `🔊 ${talkGroupName}`,
        type: ChannelType.GuildVoice,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            allow: ['ViewChannel', 'Connect', 'Speak'],
          },
        ],
      });

      const player = createAudioPlayer();
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false,
      });

      connection.subscribe(player);

      connection.on(VoiceConnectionStatus.Disconnected, () => {
        cleanupVoiceChannel(talkGroupID);
      });

      activeVoiceChannels.set(talkGroupID, {
        voiceChannel,
        connection,
        player,
        lastActivity: Date.now(),
        queue: [],
      });

      return voiceChannel;
    } catch (err) {
      logger.error('Error creating voice channel:', err);
      return null;
    }
  }
}

function startStreamingAudio(talkGroupID) {
  talkGroupID = talkGroupID.toString();

  const talkGroupData = activeVoiceChannels.get(talkGroupID);
  if (!talkGroupData) {
    logger.error('No active voice channel data for talk group:', talkGroupID);
    return;
  }

  if (
    talkGroupData.connection &&
    talkGroupData.connection.state.status !== VoiceConnectionStatus.Destroyed
  ) {
    return;
  }

  const { voiceChannel } = talkGroupData;

  try {
    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
    });

    const player = createAudioPlayer();

    connection.subscribe(player);

    talkGroupData.connection = connection;
    talkGroupData.player = player;

    connection.on(VoiceConnectionStatus.Disconnected, async (oldState, newState) => {
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch (error) {
        cleanupVoiceChannel(talkGroupID);
      }
    });
  } catch (error) {
    logger.error(`Error starting audio stream for talk group ${talkGroupID}:`, error.message);
  }
}

function monitorVoiceChannel(voiceChannel, talkGroupID) {
  const interval = setInterval(() => {
    const talkGroupData = activeVoiceChannels.get(talkGroupID);
    if (!talkGroupData) {
      clearInterval(interval);
      return;
    }

    const channelMembers = voiceChannel.members.filter((member) => !member.user.bot);

    if (channelMembers.size === 0) {
      const timeSinceLastActivity = Date.now() - talkGroupData.lastActivity;
      if (timeSinceLastActivity >= 2 * 60 * 1000) { // 2 minutes
        cleanupVoiceChannel(talkGroupID);
        clearInterval(interval);
      }
    } else {
      talkGroupData.lastActivity = Date.now();
    }
  }, 30 * 1000); // Check every 30 seconds
}

function cleanupVoiceChannel(talkGroupID) {
  talkGroupID = talkGroupID.toString();

  const talkGroupData = activeVoiceChannels.get(talkGroupID);
  if (!talkGroupData) {
    return;
  }

  const { voiceChannel, connection, player, queue } = talkGroupData;

  if (connection) {
    try {
      connection.destroy();
    } catch (error) {
      logger.error(`Error destroying connection for talk group ${talkGroupID}:`, error.message);
    }
  }

  if (player) {
    try {
      player.stop();
    } catch (error) {
      logger.error(`Error stopping player for talk group ${talkGroupID}:`, error.message);
    }
  }

  if (queue && queue.length > 0) {
    queue.forEach((transcriptionId) => {
      markAudioFileAsNotNeeded(transcriptionId);
    });
  }

  if (voiceChannel) {
    voiceChannel
      .delete()
      .then(() => {
        logger.info(`Deleted voice channel for talk group ${talkGroupID}`);
      })
      .catch((err) => logger.error('Error deleting voice channel:', err));
  }

  activeVoiceChannels.delete(talkGroupID);
}

// Define the slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('alert')
    .setDescription('Manage alert keywords')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('add')
        .setDescription('Add a keyword for alerts')
        .addStringOption((option) =>
          option.setName('keyword').setDescription('The keyword to add').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('talkgroup').setDescription('Optional talk group name').setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('remove')
        .setDescription('Remove a keyword from alerts')
        .addStringOption((option) =>
          option.setName('keyword').setDescription('The keyword to remove').setRequired(true)
        )
        .addStringOption((option) =>
          option.setName('talkgroup').setDescription('Optional talk group name').setRequired(false)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('list').setDescription('List all alert keywords')
    ),
  
  // New summary command
  new SlashCommandBuilder()
    .setName('summary')
    .setDescription('Manage the dispatch summary')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('refresh')
        .setDescription('Refresh the summary now')
    )
];

// Discord client setup
client.commands = new Collection();

client.once('ready', async () => {
  logger.info(`Logged in as ${client.user.tag}!`);

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  try {
    logger.info('Started refreshing application (/) commands.');

    await rest.put(Routes.applicationCommands(client.user.id), {
      body: commands.map((command) => command.toJSON()),
    });

    logger.info('Successfully reloaded application (/) commands.');
  } catch (error) {
    logger.error(error);
  }

  const guild = client.guilds.cache.first(); // Adjust if needed

  // Set up the alert channel
  if (guild) {
    alertChannel = guild.channels.cache.find(
      (channel) => channel.name === 'alerts' && channel.isTextBased()
    );
    if (!alertChannel) {
      alertChannel = await guild.channels.create({
        name: 'alerts',
        type: ChannelType.GuildText,
        permissionOverwrites: [
          {
            id: guild.roles.everyone.id,
            allow: ['ViewChannel', 'ReadMessageHistory'],
            deny: ['SendMessages'],
          },
        ],
      });
      logger.info('Created alerts channel.');
    }
    
    // Set up the summary channel
    summaryChannel = await getOrCreateSummaryChannel(guild);
    if (summaryChannel) {
      logger.info('Summary channel is ready.');
    }
  } else {
    logger.error('Bot is not in any guilds.');
  }

  // Start the summary scheduler
  startSummaryScheduler();
  
  // Start transcription process if needed
  if (effectiveTranscriptionMode === 'local') {
    logger.info('Initializing local transcription process...');
    startTranscriptionProcess();
  } else {
    logger.info(`Transcription mode set to '${effectiveTranscriptionMode}'. Local Python process will not be started.`);
  }
  
  isBootComplete = true;
});

client.on('interactionCreate', async (interaction) => {
  // Handle Slash Commands
  if (interaction.isCommand()) {
    const { commandName, options } = interaction;

    if (commandName === 'alert') {
      // --- Start Alert Command Logic ---
      const subcommand = interaction.options.getSubcommand();
      const keyword = options.getString('keyword');
      const talkGroupInput = options.getString('talkgroup');

      if (subcommand === 'add') {
        if (!keyword) {
          // Use flags instead of ephemeral: true
          return interaction.reply({ content: 'Please provide a keyword to add.', flags: [MessageFlags.Ephemeral] });
        }

        let talkGroupID = null;
        if (talkGroupInput) {
          db.get(
            `SELECT id FROM talk_groups WHERE alpha_tag = ?`,
            [talkGroupInput],
            (err, row) => {
              if (err) {
                logger.error('Database error adding keyword:', err);
                // Use flags instead of ephemeral: true
                return interaction.reply({ content: 'Error adding keyword due to database issue.', flags: [MessageFlags.Ephemeral] });
              } else if (row) {
                talkGroupID = row.id;
                addGlobalKeyword(keyword, talkGroupID, interaction);
              } else {
                // Use flags instead of ephemeral: true
                return interaction.reply({ content: `Talk group \\"${talkGroupInput}\\" not found.`, flags: [MessageFlags.Ephemeral] });
              }
            }
          );
        } else {
          addGlobalKeyword(keyword, talkGroupID, interaction);
        }

        function addGlobalKeyword(keyword, talkGroupID, interaction) {
          db.run(
            `INSERT OR IGNORE INTO global_keywords (keyword, talk_group_id) VALUES (?, ?)`,
            [keyword, talkGroupID],
            function (err) {
              if (err) {
                logger.error('Error inserting keyword:', err.message);
                // Use flags instead of ephemeral: true
                return interaction.reply({ content: 'Error adding keyword.', flags: [MessageFlags.Ephemeral] });
              }
              // Use flags instead of ephemeral: true
              interaction.reply({ content: `✅ Keyword \\"${keyword}\\" added for alerts${talkGroupID ? ` (for TG ${talkGroupID})` : ''}.`, flags: [MessageFlags.Ephemeral] });
            }
          );
        }
      } else if (subcommand === 'remove') {
        if (!keyword) {
          // Use flags instead of ephemeral: true
          return interaction.reply({ content: 'Please provide a keyword to remove.', flags: [MessageFlags.Ephemeral] });
        }

        let talkGroupID = null;
        if (talkGroupInput) {
          db.get(
            `SELECT id FROM talk_groups WHERE alpha_tag = ?`,
            [talkGroupInput],
            (err, row) => {
              if (err) {
                logger.error('Database error removing keyword:', err);
                // Use flags instead of ephemeral: true
                return interaction.reply({ content: 'Error removing keyword due to database issue.', flags: [MessageFlags.Ephemeral] });
              } else if (row) {
                talkGroupID = row.id;
                removeGlobalKeyword(keyword, talkGroupID, interaction);
              } else {
                // Use flags instead of ephemeral: true
                return interaction.reply({ content: `Talk group \\"${talkGroupInput}\\" not found.`, flags: [MessageFlags.Ephemeral] });
              }
            }
          );
        } else {
          removeGlobalKeyword(keyword, null, interaction);
        }

        function removeGlobalKeyword(keyword, talkGroupID, interaction) {
          const sql = talkGroupID
            ? `DELETE FROM global_keywords WHERE keyword = ? AND talk_group_id = ?`
            : `DELETE FROM global_keywords WHERE keyword = ? AND talk_group_id IS NULL`;
          const params = talkGroupID ? [keyword, talkGroupID] : [keyword];

          db.run(sql, params, function (err) {
            if (err) {
              logger.error('Error deleting keyword:', err.message);
              // Use flags instead of ephemeral: true
              return interaction.reply({ content: 'Error removing keyword.', flags: [MessageFlags.Ephemeral] });
            }
            if (this.changes > 0) {
               // Use flags instead of ephemeral: true
               interaction.reply({ content: `🗑️ Keyword \\"${keyword}\\" removed from alerts${talkGroupID ? ` (for TG ${talkGroupID})` : ' (global)'}.`, flags: [MessageFlags.Ephemeral] });
            } else {
               // Use flags instead of ephemeral: true
               interaction.reply({ content: `Keyword \\"${keyword}\\" not found for the specified scope.`, flags: [MessageFlags.Ephemeral]});
            }
          });
        }
      } else if (subcommand === 'list') {
        db.all(`SELECT keyword, talk_group_id FROM global_keywords ORDER BY talk_group_id, keyword`, [], (err, rows) => {
          if (err) {
            logger.error('Error fetching keywords:', err.message);
            // Use flags instead of ephemeral: true
            return interaction.reply({ content: 'Error fetching keywords.', flags: [MessageFlags.Ephemeral] });
          }

          if (rows.length === 0) {
            // Use flags instead of ephemeral: true
            return interaction.reply({ content: '❌ No global keywords set.', flags: [MessageFlags.Ephemeral] });
          }

          // Use Promise.all to handle async talk group lookups cleanly
          Promise.all(rows.map(async (row) => {
            // ... (inner promise logic remains the same)
            if (row.talk_group_id) {
              try {
                const tgRow = await new Promise((resolve, reject) => {
                  db.get(`SELECT alpha_tag FROM talk_groups WHERE id = ?`, [row.talk_group_id], (err, tgRow) => {
                    if (err) reject(err);
                    else resolve(tgRow);
                  });
                });
                const tgName = tgRow ? tgRow.alpha_tag : `TG ${row.talk_group_id} (Not Found)`;
                return `- **${row.keyword}** (Talk Group: ${tgName})`;
              } catch (dbErr) {
                 logger.error('Error fetching talk group name during list:', dbErr);
                 return `- **${row.keyword}** (Talk Group ID: ${row.talk_group_id} - Error looking up name)`;
              }
            } else {
              return `- **${row.keyword}** (Global)`;
            }
          })).then(lines => {
             // Fix: Use single backslash for newline
             const reply = '📝 **Global Keywords:\n' + lines.join('\n');
             // Handle potential message length limits
             if (reply.length > 2000) {
                 // Use flags instead of ephemeral: true
                 interaction.reply({ content: 'Too many keywords to display. Please refine your query or manage via database.', flags: [MessageFlags.Ephemeral] });
             } else {
                 // Use flags instead of ephemeral: true
                 interaction.reply({ content: reply, flags: [MessageFlags.Ephemeral] });
             }
          });
        });
      }
      // --- End Alert Command Logic ---

    } else if (commandName === 'summary') {
      // --- Start Summary Command Logic ---
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === 'refresh') {
        // Use flags instead of ephemeral: true
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        try {
            await updateSummaryEmbed();
            await interaction.editReply('✅ Summary has been refreshed!');
        } catch (error) {
            logger.error("Error during manual summary refresh:", error);
            await interaction.editReply('❌ Failed to refresh summary. Please check logs.').catch(console.error);
        }
      }
      // --- End Summary Command Logic ---
    }

  // Handle Button Interactions
  } else if (interaction.isButton()) {
    const customId = interaction.customId;

    try {
      if (customId.startsWith('listen_live_')) {
        const talkGroupID = customId.replace('listen_live_', '');
        // Assuming handleListenLive already uses flags correctly based on user comment
        await handleListenLive(interaction, talkGroupID);

      } else if (customId === 'refresh_summary') {
        // Use flags instead of ephemeral: true
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        await updateSummaryEmbed();
        await interaction.editReply('✅ Summary has been refreshed!');
      
      } else if (customId.startsWith('ask_ai_')) {
        const talkGroupID = customId.replace('ask_ai_', '');
        const modal = new ModalBuilder()
          .setCustomId(`ask_ai_modal_${talkGroupID}`)
          .setTitle(`Ask AI about TG ${talkGroupID}`);
        
        // Create the text input component
        const questionInput = new TextInputBuilder()
          .setCustomId('ai_question')
          .setLabel("Your question about this talk group:") // Shortened label
          .setPlaceholder('e.g., "Were there any fire-related incidents?", "List major events."')
          .setStyle(TextInputStyle.Paragraph) // Use Paragraph for potentially longer questions
          .setRequired(true);

        // Add the input to an action row and add to the modal
        const firstActionRow = new ActionRowBuilder().addComponents(questionInput);
        modal.addComponents(firstActionRow);
        
        // Show the modal to the user
        await interaction.showModal(modal);
      }

    } catch (error) {
      logger.error(`Error handling button interaction ${customId}:`, error);
      try {
        const errorMessage = (error.code === 10062)
         ? '❌ This interaction has expired. Please try the command again or use a newer message.'
         : '❌ There was an error processing your request.';

        if (interaction.deferred || interaction.replied) {
          // Use flags instead of ephemeral: true
          await interaction.followUp({ content: errorMessage, flags: [MessageFlags.Ephemeral] });
        } else {
          // Use flags instead of ephemeral: true
          await interaction.reply({ content: errorMessage, flags: [MessageFlags.Ephemeral] });
        }
      } catch (followUpError) {
        logger.error(`Failed to send error follow-up/reply for interaction ${interaction.id}:`, followUpError);
      }
    }
  // Handle Modal Submissions
  } else if (interaction.isModalSubmit()) {
    const customId = interaction.customId;

    if (customId.startsWith('ask_ai_modal_')) {
      // Make the reply PUBLIC by removing ephemeral flag/option
      await interaction.deferReply(); // No ephemeral flag needed here
      const talkGroupID = customId.replace('ask_ai_modal_', '');
      const userQuestion = interaction.fields.getTextInputValue('ai_question');

      try {
        // --- Read lookback from .env, default to 8 hours --- 
        const askAiLookbackHours = parseFloat(ASK_AI_LOOKBACK_HOURS) || 8;
        const now = new Date(); 
        const queryStartDate = new Date(now.getTime() - askAiLookbackHours * 60 * 60 * 1000); 
        // Convert start date to Unix seconds for the query
        const startTimeUnix = Math.floor(queryStartDate.getTime() / 1000);
        
        // --- End Time Window Change --- 

        // 1. Fetch transcriptions using the configured window
        logger.info(`Ask AI: Fetching last ${askAiLookbackHours} hours transcriptions for TG ${talkGroupID} (since ${startTimeUnix})`); // Updated log
        const transcriptions = await new Promise((resolve, reject) => {
          db.all(
            `SELECT timestamp, transcription 
             FROM transcriptions 
             WHERE talk_group_id = ? AND timestamp > ? AND transcription != '' 
             ORDER BY timestamp ASC`, 
            // Use Unix timestamp for query parameter
            [talkGroupID, startTimeUnix], 
            (err, rows) => {
              if (err) {
                logger.error(`Error fetching transcriptions for Ask AI (TG: ${talkGroupID}):`, err);
                reject(err);
              } else {
                logger.info(`Ask AI: Retrieved ${rows.length} transcriptions for TG ${talkGroupID}.`);
                if (rows.length > 0) {
                    logger.info(` -> First timestamp: ${rows[0].timestamp}`);
                    logger.info(` -> Last timestamp: ${rows[rows.length - 1].timestamp}`);
                }
                resolve(rows);
              }
            }
          );
        });

        // Format the actual start/end time of the *fetched data* for user message
        const actualStartTime = transcriptions.length > 0 ? new Date(transcriptions[0].timestamp * 1000) : queryStartDate;
        const actualEndTime = transcriptions.length > 0 ? new Date(transcriptions[transcriptions.length - 1].timestamp * 1000) : now; // End time is now
        
        if (transcriptions.length === 0) {
            // Updated message to use variable
            await interaction.editReply(`No transcriptions found for talk group ${talkGroupID} in the last ${askAiLookbackHours} hours (since ${queryStartDate.toLocaleString('en-US', {timeZone: TIMEZONE})}).`);
            return;
        }
        
        // 2. Get Talk Group Name for context
        const talkGroupInfo = await getTalkGroupName(talkGroupID);
        const talkGroupName = talkGroupInfo.name || `TG ${talkGroupID}`;

        // Format start/end times for the prompt (using actual data times)
        const promptStartTimeFormatted = actualStartTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TIMEZONE });
        const promptEndTimeFormatted = actualEndTime.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TIMEZONE });
        
        // 3. Format transcriptions using simple toLocaleString
        const formattedTranscriptions = transcriptions.map(t => {
          const formattedDateTime = new Date(t.timestamp * 1000).toLocaleString('en-US', {
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: '2-digit', second: '2-digit',
            hour12: true,
            timeZone: TIMEZONE 
          });
          return `[${formattedDateTime}] ${t.transcription}`; 
        }).join('\n'); // Join with newline
        
        // 4. Create the simplified prompt for AI
        // Get timezone abbreviation 
        let tzAbbreviation = '';
        try {
            const dateFormatter = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, timeZoneName: 'short' });
            const parts = dateFormatter.formatToParts(new Date());
            const tzPart = parts.find(part => part.type === 'timeZoneName');
            tzAbbreviation = tzPart ? tzPart.value : moment.tz(TIMEZONE).format('z');
        } catch (e) {
            logger.warn(`Could not get timezone abbreviation for ${TIMEZONE}, using moment fallback: ${e.message}`);
            tzAbbreviation = moment.tz(TIMEZONE).format('z');
        }

        // Prompt updated to use variable lookback period
        const commonPrompt = `You are an AI assistant analyzing radio transcriptions for the talk group "${talkGroupName}".

The following is a log of radio transmissions from the last ${askAiLookbackHours} hours (approximately ${promptStartTimeFormatted} to ${promptEndTimeFormatted} ${tzAbbreviation}):
---
${formattedTranscriptions}
---

Using only the transcriptions provided above, please answer the user's question concisely:
User Question: ${userQuestion}

**Instructions:**
- Answer concisely based *only* on the provided transcriptions.
- Focus on events and details directly relevant to the user's question.
- Avoid including minor details or unrelated events unless specifically asked.
- If you cannot find a relevant information for the question within the provided log, state that clearly.`;

        logger.info(`Ask AI Prompt for TG ${talkGroupID} (Length: ${commonPrompt.length}, First 100 chars): ${commonPrompt.substring(0, 100)}...`);

        // 5. Call AI Provider
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000); 

        let aiResponseText = 'Error: Could not get response from AI.';
        try {
            if (AI_PROVIDER.toLowerCase() === 'openai') {
                if (!OPENAI_API_KEY) {
                    throw new Error("OpenAI API key is not configured.");
                }
                logger.info(`[Bot] Answering question with OpenAI model: ${OPENAI_MODEL}`);

                const response = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${OPENAI_API_KEY}`
                    },
                    body: JSON.stringify({
                        model: OPENAI_MODEL,
                        messages: [{ role: 'user', content: commonPrompt }],
                        temperature: 0.5,
                        max_tokens: 500
                    }),
                    signal: controller.signal
                });
                if (!response.ok) {
                    const errorBody = await response.text();
                    throw new Error(`OpenAI API error! status: ${response.status}. Body: ${errorBody}`);
                }
                const result = await response.json();
                if (result.choices && result.choices.length > 0 && result.choices[0].message) {
                    aiResponseText = result.choices[0].message.content;
                }

            } else { // Default to Ollama
                logger.info(`[Bot] Answering question with Ollama model: ${OLLAMA_MODEL}`);

                const response = await fetch(`${OLLAMA_URL}/api/generate`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({
                      model: OLLAMA_MODEL,
                      prompt: commonPrompt,
                      stream: false,
                      options: { num_ctx: 35000 }
                    }),
                    signal: controller.signal
                });
                if (!response.ok) {
                    throw new Error(`Ollama API error! status: ${response.status}`);
                }
                const data = await response.json();
                aiResponseText = data.response || 'Error: AI returned an empty response.';
            }

            clearTimeout(timeout); 

            // --- ADDED: Remove <think> block from both providers ---
            const thinkBlockRegex = /<think>[\s\S]*?<\/think>\s*/;
            aiResponseText = aiResponseText.replace(thinkBlockRegex, '').trim();
            // --- END ADDED ---

        } catch (fetchError) {
            clearTimeout(timeout); 
            if (fetchError.name === 'AbortError') {
                logger.error(`Ask AI Error: Request timed out (60s) for TG ${talkGroupID}`);
                aiResponseText = 'Error: The request to the AI timed out.';
            } else {
                logger.error(`Ask AI Fetch Error for TG ${talkGroupID}:`, fetchError);
                aiResponseText = 'Error: Could not connect to the AI service.';
            }
        }

        // 6. Send the response back to the user (publicly, in an embed)
        const replyEmbed = new EmbedBuilder()
          .setTitle(`AI Analysis for ${talkGroupName}`)
          .setColor(0x5865F2) // Discord blurple color
          // Updated description to use variable
          .setDescription(`**Your Question:**\n${userQuestion}\n\n**AI Answer (based on last ${askAiLookbackHours} hours):**\n>>> ${aiResponseText}`)
          .setTimestamp();

        // Truncate description if too long for Discord embed
        if (replyEmbed.data.description.length > 4096) {
            const truncatedDesc = replyEmbed.data.description.substring(0, 4093) + '...';
            replyEmbed.setDescription(truncatedDesc);
        }

        await interaction.editReply({ embeds: [replyEmbed] });

      } catch (error) {
        logger.error(`Error handling Ask AI modal submission for TG ${talkGroupID}:`, error);
        // Keep error message ephemeral
        await interaction.followUp({ content: '❌ An error occurred while processing your request. Please check the bot logs.', flags: [MessageFlags.Ephemeral] });
      }
    }
  }
  // Handle other interaction types (select menus, modals) if needed...
});

// Global Error Handler for Express
app.use((err, req, res, next) => {
  logger.error('Global Error Handler:', { 
    error: err.message, 
    stack: err.stack,
    method: req.method,
    url: req.url,
    headers: req.headers
  });
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).send('File size is too large.');
  }
  return res.status(500).send('Internal Server Error.');
});

// Start the Express server and Discord bot (only after initialization is complete)
let server;
let discordClientReady = false;

async function startBotServices() {
  try {
    // Start the Express server for bot API endpoints
    server = app.listen(PORT_NUM, () => {
      logger.info(`Bot server is running on port ${PORT_NUM}`);
    });

    // Login to Discord
    await client.login(DISCORD_TOKEN);
    discordClientReady = true;
    logger.info('Discord bot logged in successfully.');

  } catch (error) {
    logger.error('Error starting bot services:', error);
    throw error;
  }
}

// Transcription process will be started in the Discord ready event

// Handle process termination
process.on('SIGINT', () => {
  logger.info('Shutting down gracefully...');
  
  const shutdownPromises = [];
  
  // Clean up transcription process first
  if (transcriptionProcess) {
    logger.info('Cleaning up transcription process...');
    cleanupTranscriptionProcess();
  }
  
  // Close bot server if it exists
  if (server) {
    shutdownPromises.push(new Promise((resolve) => {
      server.close(() => {
        logger.info('Bot Express server closed.');
        resolve();
      });
    }));
  }
  
  // Disconnect Discord client if ready
  if (discordClientReady) {
    client.destroy();
    logger.info('Discord bot disconnected.');
  }
  
  // Wait for server shutdown, then close database
  Promise.all(shutdownPromises).then(() => {
    db.close((err) => {
      if (err) {
        logger.error('Error closing database connection:', err);
      } else {
        logger.info('Database connection closed.');
      }
      process.exit(0);
    });
  });
});