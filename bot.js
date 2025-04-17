// bot.js - Main Discord bot application

require('dotenv').config();

// Get environment variables first, before any usage
const {
  BOT_PORT: PORT,  
  PUBLIC_DOMAIN,
  DISCORD_TOKEN,
  MAPPED_TALK_GROUPS: mappedTalkGroupsString, 
  TIMEZONE,
  API_KEY_FILE,
  OLLAMA_URL, 
  OLLAMA_MODEL,
  SUMMARY_LOOKBACK_HOURS  
} = process.env;

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
let summaryChannel;
const SUMMARY_INTERVAL = 5 * 60 * 1000; // 5 minutes in milliseconds
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

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: () => moment().tz(TIMEZONE).format('MM/DD/YYYY HH:mm:ss.SSS')
    }),
    winston.format.printf(({ timestamp, level, message }) => {
      // Define patterns that should be yellow
      if (message.includes('Talk Group') || 
          message.includes('Incoming Request')) {
        // ANSI yellow color code
        return `${timestamp} \x1b[33m[${level.toUpperCase()}] ${message}\x1b[0m`;
      }
      
      // Define patterns that should be green
      if (message.includes('Extracted Address') || 
          message.includes('Geocoded Address')) {
        // ANSI green color code
        return `${timestamp} \x1b[32m[${level.toUpperCase()}] ${message}\x1b[0m`;
      }
      
      // Cyan color only for the actual transcription text
      if (message.includes('Transcription process output')) {
        try {
          const jsonStartIndex = message.indexOf('{');
          if (jsonStartIndex !== -1) {
            const prefix = message.substring(0, jsonStartIndex);
            const jsonPart = message.substring(jsonStartIndex);
            const parsedJson = JSON.parse(jsonPart);
            
            if (parsedJson.transcription) {
              // Apply cyan color only to the transcription value
              return `${timestamp} [${level.toUpperCase()}] ${prefix}${jsonPart.replace(
                `"transcription": "${parsedJson.transcription}"`, 
                `"transcription": "\x1b[36m${parsedJson.transcription}\x1b[0m"`
              )}`;
            }
          }
        } catch (e) {
          // If there's an error parsing JSON, fall back to normal formatting
        }
      }
      
      // White color for other info messages
      if (level === 'info') {
        return `${timestamp} \x1b[37m[${level.toUpperCase()}] ${message}\x1b[0m`;
      }
      
      // Default colors for other log levels
      const colors = {
        error: '\x1b[31m', // red
        warn: '\x1b[33m',  // yellow
        debug: '\x1b[36m'  // cyan
      };
      const color = colors[level] || '\x1b[37m'; // default to white
      return `${timestamp} ${color}[${level.toUpperCase()}] ${message}\x1b[0m`;
    })
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console()
  ]
});

// Override logger.info to only allow specific messages
const originalInfo = logger.info.bind(logger);
const allowedPatterns = [
  // Core dispatch information
  /^--- Incoming Request ---$/,
  /^Talk Group: .+ - .+$/,
  /^Geocoded Address: ".+" with coordinates \(.+, .+\) in .+$/,
  
  // Startup & shutdown messages
  /^Shutting down gracefully...$/,
  /^Express server closed.$/,
  /^Discord bot disconnected.$/,
  /^Database connection closed.$/,
  /^Loaded \d+ talk groups from environment variables$/,
  /^Using upload directory: .+$/,
  /^Loaded \d+ API keys.$/,
  /^Starting persistent transcription process...$/,
  /^Transcription process spawned, waiting for ready signal...$/,
  /^Bot server is running on port \d+$/,
  /^Connected to SQLite database.$/,
  /^Using talk groups from environment variables. Found \d+ talk groups$/,
  /^Loaded \d+ talk groups for geocoding$/,
  /^Logged in as .+!$/,
  /^Started refreshing application \(\/\) commands.$/,
  /^Successfully reloaded application \(\/\) commands.$/,
  /^Summary channel is ready.$/
];

logger.info = function (...args) {
  const message = args.join(' ');
  
  // Check for transcription output and simplify it
  if (message.startsWith('Transcription process output: {"id":')) {
    try {
      // Extract just the transcription part
      const match = message.match(/Transcription process output: {"id": "[^"]+", "transcription": "([^"]+)"}/);
      if (match && match[1]) {
        // Print the transcription text in cyan color
        const timestamp = new Date().toLocaleString('en-US', {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
          fractionalSecondDigits: 3
        }).replace(',', '');
        
        // Using ANSI cyan color code for the transcription text
        console.log(`${timestamp} [INFO] Transcription: \x1b[36m${match[1]}\x1b[0m`);
        return;
      }
    } catch (e) {
      // If parsing fails, fall back to normal logging behavior
    }
  }
  
  const shouldLog = allowedPatterns.some((pattern) => pattern.test(message));
  if (shouldLog) {
    originalInfo(...args);
  }
};

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
const MAX_CONCURRENT_TRANSCRIPTIONS = 3;
let isBootComplete = false;
const messageCache = new Map(); // Stores the latest message for each channel
const MESSAGE_COOLDOWN = 15000; // 15 seconds in milliseconds
let transcriptionProcess = null;
let isProcessingTranscription = false;

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

logger.info(`Using upload directory: ${UPLOAD_DIR}`);

// Database setup
const db = new sqlite3.Database('./botdata.db', (err) => {
  if (err) {
    logger.error('Error opening database:', err.message);
  } else {
    logger.info('Connected to SQLite database.');

    // Initialize geocoding module with the database
    loadTalkGroups(db).then(talkGroups => {
  Object.assign(TALK_GROUPS, talkGroups);
  logger.info(`Loaded ${Object.keys(TALK_GROUPS).length} talk groups for geocoding`);
});
  }
});

// Create necessary tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS transcriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    talk_group_id TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    transcription TEXT,
    audio_file_path TEXT,
    address TEXT,
    lat REAL,
    lon REAL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS global_keywords (
    keyword TEXT UNIQUE,
    talk_group_id TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS talk_groups (
    id TEXT PRIMARY KEY,
    hex TEXT,
    alpha_tag TEXT,
    mode TEXT,
    description TEXT,
    tag TEXT,
    county TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS frequencies (
    id INTEGER PRIMARY KEY,
    frequency TEXT,
    description TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS audio_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transcription_id INTEGER,
    audio_data BLOB,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(transcription_id) REFERENCES transcriptions(id)
  )`);
});

// Load API keys
let apiKeys = [];
const loadApiKeys = () => {
  try {
    if (!fs.existsSync(path.dirname(API_KEY_FILE))) {
      fs.mkdirSync(path.dirname(API_KEY_FILE), { recursive: true });
    }
    
    if (!fs.existsSync(API_KEY_FILE)) {
      // Create a default API key if none exists
      const defaultKey = uuidv4();
      const hashedKey = bcrypt.hashSync(defaultKey, 10);
      apiKeys = [{ key: hashedKey, name: 'Default', disabled: false }];
      fs.writeFileSync(API_KEY_FILE, JSON.stringify(apiKeys, null, 2));
      
      logger.info(`Created default API key: ${defaultKey}`);
      logger.info(`Please save this key as it won't be shown again!`);
    } else {
      const data = fs.readFileSync(API_KEY_FILE, 'utf8');
      apiKeys = JSON.parse(data);
      logger.info(`Loaded ${apiKeys.length} API keys.`);
    }
  } catch (err) {
    logger.error('Error loading API keys:', err);
    apiKeys = [];
  }
};
loadApiKeys();

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
              dateTime: fields.dateTime,
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
        
        // Handle TrunkRecorder specific fields
        if (!fields.source || fields.source === '') {
          fields.source = `TR-${Math.floor(Math.random() * 9000) + 1000}`;
        }
        
        // Map audioName to filename for TrunkRecorder if original isn't available
        if (fields.audioName && (!fileInfo || !fileInfo.originalFilename)) {
          fileInfo = fileInfo || {};
          fileInfo.originalFilename = fields.audioName;
        }
        
        if (fileInfo && fileBuffer) {
          const customFilename = generateCustomFilename(fields, fileInfo.originalFilename);
          const saveTo = path.join(UPLOAD_DIR, customFilename);
          
          fs.writeFile(saveTo, fileBuffer, (err) => {
            if (err) {
              logger.error('Error saving file:', err);
              return sendResponse(500, 'Error saving file');
            }
            
            logger.info(`Received TrunkRecorder audio: ${customFilename}`);
            
            handleNewAudio({
              filename: customFilename,
              path: saveTo,
              talkGroupID: fields.talkgroup,
              systemName: fields.systemLabel,
              talkGroupName: fields.talkgroupLabel,
              dateTime: fields.dateTime,
              source: fields.source,
              frequency: fields.frequency,
              talkGroupGroup: fields.talkgroupGroup,
              isTrunkRecorder: true
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
function startTranscriptionProcess() {
  if (transcriptionProcess) {
    // Process already running
    logger.info('Transcription process already running, reusing existing process');
    return;
  }

  logger.info('Starting persistent transcription process...');
  
  // Spawn the Python process
  transcriptionProcess = spawn('python', ['transcribe.py']);
  
  // Create interface to read line-by-line from stdout
  const rl = readline.createInterface({
    input: transcriptionProcess.stdout,
    crlfDelay: Infinity
  });
  
  // Handle each line of output
  rl.on('line', (line) => {
    try {
      logger.info(`Transcription process output: ${line}`);
      const response = JSON.parse(line);
      
      if (response.ready) {
        logger.info('Transcription service ready');
        // Process any waiting transcriptions
        processNextTranscription();
      } else if (response.id && response.transcription !== undefined) {
        logger.info(`Received transcription for ID: ${response.id} (${response.transcription.length} chars)`);
        
        // Find the callback for this ID
        const pendingItem = transcriptionQueue.find(item => item.id === response.id);
        if (pendingItem && pendingItem.callback) {
          logger.info(`Found callback for ID: ${response.id}, executing`);
          // Even if the transcription is empty, we still execute the callback
          pendingItem.callback(response.transcription);
          
          // Remove this item from the queue
          transcriptionQueue = transcriptionQueue.filter(item => item.id !== response.id);
          
          // Process next item - VERY IMPORTANT - this allows the queue to continue
          isProcessingTranscription = false;
          processNextTranscription();
        } else {
          logger.error(`No callback found for transcription ID: ${response.id}`);
          // Even if no callback, we should still reset the flag to allow processing to continue
          isProcessingTranscription = false;
          processNextTranscription();
        }
      } else if (response.error) {
        logger.error(`Transcription error: ${response.error}`);
        
        // If the error is about a file not existing, find and remove that item from the queue
        if (response.error.includes("does not exist") && response.id) {
          const pendingItem = transcriptionQueue.find(item => item.id === response.id);
          if (pendingItem && pendingItem.callback) {
            // Execute callback with empty string to continue the flow
            pendingItem.callback("");
            
            // Remove this item from the queue
            transcriptionQueue = transcriptionQueue.filter(item => item.id !== response.id);
            logger.info(`Removed non-existent file from queue: ID ${response.id}`);
          }
        }
        
        // Still allow queue to continue
        isProcessingTranscription = false;
        processNextTranscription();
      } else {
        logger.warn(`Unrecognized response from transcription process: ${line}`);
        // IMPORTANT: Reset the processing flag so we don't stall
        isProcessingTranscription = false;
        processNextTranscription();
      }
    } catch (err) {
      logger.error(`Error parsing transcription process output: ${err.message}, line: ${line}`);
      
      // Still allow queue to continue in case of parsing errors
      isProcessingTranscription = false;
      processNextTranscription();
    }
  });
  
  // Handle stderr
  transcriptionProcess.stderr.on('data', (data) => {
    // Convert Buffer to string - important for full message
    const errorMsg = data.toString().trim();
    //logger.error(`Transcription process stderr: ${errorMsg}`);
  });
  
  // Handle process exit
  transcriptionProcess.on('close', (code) => {
    logger.error(`Transcription process exited with code ${code}`);
    transcriptionProcess = null;
    
    // Clean up any pending items in the queue
    if (transcriptionQueue.length > 0) {
      logger.warn(`${transcriptionQueue.length} transcription requests were pending when process exited`);
      
      // Execute callbacks with empty strings to prevent deadlocks
      for (const item of transcriptionQueue) {
        if (item.callback) {
          item.callback("");
        }
      }
      transcriptionQueue = [];
    }
    
    // Reset the processing flag
    isProcessingTranscription = false;
    
    // Restart the process after a delay if it crashes
    if (code !== 0) {
      logger.info('Will attempt to restart transcription process in 5 seconds...');
      setTimeout(() => {
        startTranscriptionProcess();
      }, 5000);
    }
  });
  
  // Handle process errors
  transcriptionProcess.on('error', (err) => {
    logger.error(`Failed to start transcription process: ${err.message}`);
    transcriptionProcess = null;
    isProcessingTranscription = false;
  });
  
  // Log that we've successfully started the process
  logger.info('Transcription process spawned, waiting for ready signal...');
}

// Function to process the next transcription in the queue
function processNextTranscription() {
  if (isProcessingTranscription || transcriptionQueue.length === 0 || !transcriptionProcess) {
    return;
  }
  
  // Get the next item but don't remove it from the queue yet
  const nextItem = transcriptionQueue[0];
  
  // Check if the file exists before sending to Python process
  if (!fs.existsSync(nextItem.path)) {
    logger.warn(`File does not exist, skipping transcription: ${nextItem.path}`);
    
    // Execute callback with empty string
    if (nextItem.callback) {
      nextItem.callback("");
    }
    
    // Remove from queue and process next
    transcriptionQueue.shift();
    processNextTranscription();
    return;
  }
  
  // Mark as processing
  isProcessingTranscription = true;
  
  // Send the file path to the python process
  transcriptionProcess.stdin.write(JSON.stringify({
    command: 'transcribe',
    id: nextItem.id,
    path: nextItem.path
  }) + '\n');
}

// Function to handle new audio
function handleNewAudio(audioData) {
  const {
    filename,
    path: tempPath,
    talkGroupID,
    systemName,
    talkGroupName,
    dateTime,
    source,
    frequency,
    talkGroupGroup,
  } = audioData;

  // Double-check file extension before processing
  if (isIgnoredFileType(filename)) {
    logger.info(`Skipping processing of unsupported file: ${filename}`);
    
    // Delete the file to prevent it from taking up space
    fs.unlink(tempPath, (err) => {
      if (err) logger.error(`Error deleting unsupported file ${filename}:`, err);
      else logger.info(`Deleted unsupported file ${filename}`);
    });
    
    return;
  }
  
  // Verify the file exists before proceeding
  if (!fs.existsSync(tempPath)) {
    logger.error(`Audio file doesn't exist: ${tempPath}`);
    return;
  }

  fs.readFile(tempPath, (err, fileBuffer) => {
    if (err) {
      logger.error('Error reading audio file:', err);
      return;
    }

    db.run(
      `INSERT INTO transcriptions (talk_group_id, timestamp, transcription, audio_file_path, address, lat, lon) VALUES (?, ?, ?, ?, NULL, NULL, NULL)`,
      [talkGroupID, new Date(parseInt(dateTime) * 1000).toISOString(), '', filename],
      function (err) {
        if (err) {
          logger.error('Error inserting transcription:', err);
          return;
        }

        const transcriptionId = this.lastID;

        db.run(
          `INSERT INTO audio_files (transcription_id, audio_data) VALUES (?, ?)`,
          [transcriptionId, fileBuffer],
          (err) => {
            if (err) {
              logger.error('Error inserting audio data:', err);
              return;
            }

            logger.info(`Saved audio for transcription ID ${transcriptionId}`);

            // Use our new transcribeAudio function directly
            transcribeAudio(tempPath, (transcriptionText) => {
              if (!transcriptionText) {
                logger.warn(`No transcription obtained for ID ${transcriptionId}`);
                // Still update with empty transcription to avoid stalled records
                updateTranscription(transcriptionId, "", () => {
                  logger.info(`Updated with empty transcription for ID ${transcriptionId}`);
                  
                  // Clean up temp file even if transcription failed
                  fs.unlink(tempPath, (err) => {
                    if (err) logger.error('Error deleting temp file:', err);
                    else logger.info(`Deleted temp file: ${filename}`);
                  });
                });
                return;
              }

              updateTranscription(transcriptionId, transcriptionText, () => {
                logger.info(`Updated transcription for ID ${transcriptionId}`);

                handleNewTranscription(
                  transcriptionId,
                  transcriptionText,
                  talkGroupID,
                  systemName,
                  talkGroupName,
                  source,
                  talkGroupGroup,
                  filename
                );

                fs.unlink(tempPath, (err) => {
                  if (err) logger.error('Error deleting temp file:', err);
                  else logger.info(`Deleted temp file: ${filename}`);
                });

                logger.info(`Processed: ${filename}`);
              });
            });
          }
        );
      }
    );
  });
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

// Function to process transcription queue
/* function processTranscriptionQueue() {
  while (
    activeTranscriptions < MAX_CONCURRENT_TRANSCRIPTIONS &&
    transcriptionQueue.length > 0
  ) {
    const audioData = transcriptionQueue.shift();
    activeTranscriptions++;

    transcribeAudio(audioData.tempPath, (transcriptionText) => {
      activeTranscriptions--;

      if (!transcriptionText) {
        logger.warn(`No transcription obtained for ID ${audioData.transcriptionId}`);
        // Optionally, handle this case (e.g., notify)
        processTranscriptionQueue();
        return;
      }

      updateTranscription(audioData.transcriptionId, transcriptionText, () => {
        logger.info(`Updated transcription for ID ${audioData.transcriptionId}`);

        handleNewTranscription(
          audioData.transcriptionId,
          transcriptionText,
          audioData.talkGroupID,
          audioData.systemName,
          audioData.talkGroupName,
          audioData.source,
          audioData.talkGroupGroup,
          audioData.filename // Assuming this is your audioFilePath
        );

        fs.unlink(audioData.tempPath, (err) => {
          if (err) logger.error('Error deleting temp file:', err);
        });

        logger.info(`Processed: ${audioData.filename}`);
        processTranscriptionQueue();
      });
    });
  }
} */

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
  
  // Add to queue
  transcriptionQueue.push({
    id: requestId,
    path: filePath,
    callback: processCallback  // Use the wrapper callback
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
  audioFilePath
) {
  logger.info(`Starting handleNewTranscription for ID ${id}`);
  logger.info(`Transcription text length: ${transcriptionText.length} characters`);
  logger.info(`Talk Group: ${talkGroupID} - ${talkGroupName}`);

  const timeout = setTimeout(() => {
    logger.error(`Timeout occurred in handleNewTranscription for ID ${id}`);
  }, 15000); // 15 second timeout

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
  audioID,
  talkGroupGroup,
  callback
) {
  // Get the full talkgroup name and county from the database
  db.get(
    `SELECT alpha_tag, county FROM talk_groups WHERE id = ?`,
    [talkGroupID],
    (err, row) => {
      if (err) {
        logger.error('Error fetching talkgroup info:', err);
        if (callback) callback();
        return;
      }

      if (!row) {
        logger.error(`No talk group found for ID: ${talkGroupID}`);
        if (callback) callback();
        return;
      }

      const fullTalkGroupName = row.alpha_tag || talkGroupName;
      const categoryName = row.county || 'Uncategorized';

      // Determine the channel name (full talk group name)
      const channelName = getChannelName(fullTalkGroupName);

      // Get or create the category
      getOrCreateCategory(categoryName, (category) => {
        if (!category) {
          logger.error('Failed to get or create category.');
          if (callback) callback();
          return;
        }

        // Get or create the channel within the category
        getOrCreateChannel(channelName, category.id, (channel) => {
          if (!channel) {
            logger.error('Failed to get or create channel.');
            if (callback) callback();
            return;
          }

          // Look up the audio_id from the database for this transcription
          db.get('SELECT id FROM audio_files WHERE transcription_id = ?', [audioID], (err, row) => {
            // Use transcription ID as fallback if audio ID not found
            const actualAudioID = (err || !row) ? audioID : row.id;
            
            // Create a URL for the audio file using the domain from the environment variable
            const audioUrl = `http://${PUBLIC_DOMAIN}/audio/${actualAudioID}`;
            
            // Log the audioID and URL for debugging
            logger.info(`Transcription ID: ${audioID}, Audio ID: ${actualAudioID}, URL: ${audioUrl}`);

            // Format source display name based on source format
            let sourceDisplay;
            
            if (!source || source === 'Unknown') {
              sourceDisplay = 'User-Unknown';
            } else if (source.startsWith('TR-')) {
              // For our auto-generated TrunkRecorder IDs
              sourceDisplay = `TrunkRec-${source.substring(3)}`;
            } else if (/^\d+$/.test(source)) {
              // For numeric source IDs from TrunkRecorder
              sourceDisplay = `Unit-${source}`;
            } else {
              // Default format
              sourceDisplay = `ID-${source}`;
            }
            
            // Generate the transcription line with properly formatted source and explicit ID marker
            const transcriptionLine = `**${sourceDisplay}:** ${transcriptionText} [Audio](${audioUrl})`;

            // Check if we have a recent message for this channel
            const cacheKey = channel.id;
            const cachedMessage = messageCache.get(cacheKey);
            const currentTime = Date.now();

            if (cachedMessage && currentTime - cachedMessage.timestamp < MESSAGE_COOLDOWN) {
              // Update existing message
              // Add the new transcription to the existing content
              const updatedTranscription = cachedMessage.transcriptions + '\n\n' + transcriptionLine;
              
              // Update the embed with the new combined transcriptions
              const embed = cachedMessage.message.embeds[0];
              const newEmbed = EmbedBuilder.from(embed)
                .setDescription(updatedTranscription)
                .setTimestamp(); // Update timestamp to current time

              // Edit the message with the updated embed
              cachedMessage.message.edit({ embeds: [newEmbed] })
                .then((editedMsg) => {
                  // Create or update the transcription IDs array
                  const transcriptionIds = cachedMessage.transcriptionIds || [];
                  if (!transcriptionIds.includes(audioID)) {
                    transcriptionIds.push(audioID);
                  }
                  
                  // Update the cache with the new data
                  messageCache.set(cacheKey, {
                    message: editedMsg,
                    timestamp: currentTime,
                    transcriptions: updatedTranscription,
                    url: editedMsg.url,  // Store the message URL
                    transcriptionIds: transcriptionIds  // Keep a list of transcription IDs in this message
                  });
                  
                  logger.info(`Updated message with transcription ID ${audioID}, URL: ${editedMsg.url}`);
                  
                  if (callback) {
                    callback(editedMsg.url);  // Pass back the message URL
                  }
                })
                .catch((err) => {
                  logger.error('Error editing message:', err);
                  if (callback) callback();
                });
            } else {
              // Create a new message
              const listenLiveButton = new ButtonBuilder()
                .setCustomId(`listen_live_${talkGroupID}`)
                .setLabel('🎧 Listen Live')
                .setStyle(ButtonStyle.Primary);

              const row = new ActionRowBuilder().addComponents(listenLiveButton);

              // Create the embed for a new message
              const embed = new EmbedBuilder()
                .setTitle(fullTalkGroupName)
                .setDescription(transcriptionLine)
                .setTimestamp()
                .setColor(0x00ff00);

              // Send the new message
              channel.send({
                embeds: [embed],
                components: [row],
              })
                .then((msg) => {
                  // Cache the new message with transcription ID
                  messageCache.set(cacheKey, {
                    message: msg,
                    timestamp: currentTime,
                    transcriptions: transcriptionLine,
                    url: msg.url,  // Store the message URL
                    transcriptionIds: [audioID]  // Initialize with this transcription ID
                  });
                  
                  logger.info(`Created new message with transcription ID ${audioID}, URL: ${msg.url}`);
                  
                  if (callback) {
                    callback(msg.url);  // Pass back the message URL
                  }
                })
                .catch((err) => {
                  logger.error('Error sending transcription message:', err);
                  if (callback) callback();
                });
            }
          });
        });
      });
    }
  );
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
    const thirtyMinutesAgo = new Date(Date.now() - LOOKBACK_PERIOD);
    const thirtyMinutesAgoFormatted = thirtyMinutesAgo.toISOString();
    
    logger.info(`Fetching transcriptions from ${thirtyMinutesAgoFormatted} to now (lookback: ${LOOKBACK_HOURS} hours)`);
    
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
      [thirtyMinutesAgoFormatted],
      (err, rows) => {
        if (err) {
          logger.error('Error fetching recent transcriptions:', err);
          reject(err);
        } else {
          logger.info(`Retrieved ${rows.length} transcriptions spanning from ${thirtyMinutesAgoFormatted} to now`);
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
          resolve(rows);
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
        // Format timestamp for human readability
        const formattedTime = new Date(t.timestamp).toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
        
        // Add minutes ago for easier time reference
        const minutesAgo = Math.floor((Date.now() - new Date(t.timestamp).getTime()) / (60 * 1000));
        
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
      const minutesAgo = t.minutes_ago;
      const bucketIndex = Math.min(periodCount - 1, Math.floor(minutesAgo / periodLength));
      timeBuckets[bucketIndex].push(t);
    });
    
    // Get time range for the analyzed data
    const earliest = new Date(now.getTime() - LOOKBACK_PERIOD);
    const earliestTime = formattedTranscriptions.length > 0 ? 
      new Date(Math.min(...formattedTranscriptions.map(t => new Date(t.timestamp).getTime()))).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : 
      earliest.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    
    const latestTime = formattedTranscriptions.length > 0 ? 
      new Date(Math.max(...formattedTranscriptions.map(t => new Date(t.timestamp).getTime()))).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }) : 
      now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    
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
    const prompt = `You are an experienced emergency dispatch analyst for a police and fire department. 

First, write a concise summary (2-3 sentences long max) of notable activity in the past ${LOOKBACK_HOURS} ${LOOKBACK_HOURS === 1 ? 'hour' : 'hours'} (from ${earliestTime} to ${latestTime}).

Then, I've selected ${highlightSelections.length} important transmissions from different time periods for you to analyze. For EACH of these transmissions, provide:
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

    // Call the Ollama API with a timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    try {
      const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          stream: false
        }),
        signal: controller.signal
      });
      
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      const resultText = data.response;
      
      // Extract the JSON part from the response
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
          logger.error('Error parsing Ollama JSON response:', e);
          return { 
            summary: `Error processing summary for the past ${LOOKBACK_HOURS} ${LOOKBACK_HOURS === 1 ? 'hour' : 'hours'}.`, 
            highlights: [] 
          };
        }
      } else {
        logger.error('No JSON found in Ollama response');
        return { 
          summary: `Unable to generate a structured summary for the past ${LOOKBACK_HOURS} ${LOOKBACK_HOURS === 1 ? 'hour' : 'hours'}.`, 
          highlights: [] 
        };
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Request to Ollama timed out after 30 seconds');
      }
      throw error;
    }
  } catch (error) {
    logger.error(`Error generating summary with Ollama: ${error.message}`);
    
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
      // Get the timestamp from the original data
      let timestampDisplay;
      try {
        const originalTimestamp = new Date(highlight.timestamp);
        timestampDisplay = originalTimestamp.toLocaleTimeString('en-US', { 
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true
        });
      } catch (err) {
        logger.error(`Error formatting timestamp: ${err.message}`);
        timestampDisplay = new Date().toLocaleTimeString('en-US', {
          hour: 'numeric', 
          minute: '2-digit',
          hour12: true
        });
      }
      
      return {
        id: highlight.id,
        talk_group: highlight.talk_group,
        importance: highlight.importance,
        description: highlight.description,
        time: timestampDisplay
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
      const sortedTranscriptions = [...transcriptions].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const earliest = new Date(sortedTranscriptions[0].timestamp);
      const latest = new Date(sortedTranscriptions[sortedTranscriptions.length - 1].timestamp);
      
      const formatTime = (date) => date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit',
        hour12: true
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
      .setFooter({ text: 'Updates every 5 minutes • Powered by AI' });
    
    // Add highlights
    if (summary.highlights && summary.highlights.length > 0) {
      for (const highlight of summary.highlights) {
        // Get audio URL
        const audioUrl = `http://${PUBLIC_DOMAIN}/audio/${highlight.id}`;
        
        // Fix timestamp display - use timestamp directly from database
        let timestampDisplay;
        try {
          // Parse the timestamp from the database
          const originalTimestamp = new Date(highlight.timestamp);
          
          // Format the database timestamp directly
          timestampDisplay = originalTimestamp.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit',
            hour12: true
          });
        } catch (err) {
          logger.error(`Error formatting timestamp: ${err.message}`);
          // Simple fallback
          timestampDisplay = new Date().toLocaleTimeString();
          logger.warn('Failed to parse timestamp from database, using current time as fallback');
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
    
    // Add status field if there was an error with Ollama
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

  // Fetch audio data from the database
  db.get(
    'SELECT audio_data FROM audio_files WHERE transcription_id = ?',
    [transcriptionId],
    (err, row) => {
      if (err) {
        logger.error('Error fetching audio data:', err);
        processAudioQueue(talkGroupID);
        return;
      }

      if (!row) {
        logger.error('Audio data not found for transcription ID:', transcriptionId);
        processAudioQueue(talkGroupID);
        return;
      }

      const audioBuffer = Buffer.from(row.audio_data);

      // Updated FFmpeg args that handle both MP3 and M4A
      const transcoder = new prism.FFmpeg({
        args: [
          '-i',
          'pipe:0',
          '-analyzeduration',
          '0',
          '-loglevel',
          '0',
          '-f',
          's16le',
          '-ar',
          '48000',
          '-ac',
          '2',
        ],
      });

      const stream = new Readable();
      stream.push(audioBuffer);
      stream.push(null);
      stream.pipe(transcoder);

      const resource = createAudioResource(transcoder, {
        inputType: StreamType.Raw,
        inlineVolume: true,
      });

      resource.volume.setVolume(1.0);

      talkGroupData.player.play(resource);
      talkGroupData.lastActivity = Date.now();

      talkGroupData.player.once(AudioPlayerStatus.Idle, () => {
        processAudioQueue(talkGroupID);
      });

      talkGroupData.player.on('error', (error) => {
        logger.error(`Error playing audio for talk group ${talkGroupID}:`, error);
        processAudioQueue(talkGroupID);
      });
    }
  );
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
  
  isBootComplete = true;
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isCommand()) {
    const { commandName, options } = interaction;

    if (commandName === 'alert') {
      const subcommand = interaction.options.getSubcommand();
      const keyword = options.getString('keyword');
      const talkGroupInput = options.getString('talkgroup');

      if (subcommand === 'add') {
        if (!keyword) {
          return interaction.reply('Please provide a keyword to add.');
        }

        let talkGroupID = null;
        if (talkGroupInput) {
          // Try to find talk group ID by name
          db.get(
            `SELECT id FROM talk_groups WHERE alpha_tag = ?`,
            [talkGroupInput],
            (err, row) => {
              if (err) {
                logger.error('Database error:', err);
                return interaction.reply('Error adding keyword.');
              } else if (row) {
                talkGroupID = row.id;
                addGlobalKeyword(keyword, talkGroupID);
              } else {
                return interaction.reply(`Talk group "${talkGroupInput}" not found.`);
              }
            }
          );
        } else {
          addGlobalKeyword(keyword, talkGroupID);
        }

        function addGlobalKeyword(keyword, talkGroupID) {
          db.run(
            `INSERT OR IGNORE INTO global_keywords (keyword, talk_group_id) VALUES (?, ?)`,
            [keyword, talkGroupID],
            function (err) {
              if (err) {
                logger.error(err.message);
                return interaction.reply('Error adding keyword.');
              }
              interaction.reply(`✅ Keyword "${keyword}" added for alerts.`);
            }
          );
        }
      } else if (subcommand === 'remove') {
        if (!keyword) {
          return interaction.reply('Please provide a keyword to remove.');
        }

        let talkGroupID = null;
        if (talkGroupInput) {
          // Try to find talk group ID by name
          db.get(
            `SELECT id FROM talk_groups WHERE alpha_tag = ?`,
            [talkGroupInput],
            (err, row) => {
              if (err) {
                logger.error('Database error:', err);
                return interaction.reply('Error removing keyword.');
              } else if (row) {
                talkGroupID = row.id;
                removeGlobalKeyword(keyword, talkGroupID);
              } else {
                return interaction.reply(`Talk group "${talkGroupInput}" not found.`);
              }
            }
          );
        } else {
          removeGlobalKeyword(keyword, talkGroupID);
        }

        function removeGlobalKeyword(keyword, talkGroupID) {
          db.run(
            `DELETE FROM global_keywords WHERE keyword = ? AND (talk_group_id = ? OR talk_group_id IS NULL)`,
            [keyword, talkGroupID],
            function (err) {
              if (err) {
                logger.error(err.message);
                return interaction.reply('Error removing keyword.');
              }
              interaction.reply(`🗑️ Keyword "${keyword}" removed from alerts.`);
            }
          );
        }
      } else if (subcommand === 'list') {
        db.all(`SELECT keyword, talk_group_id FROM global_keywords`, [], (err, rows) => {
          if (err) {
            logger.error('Error fetching keywords:', err.message);
            return interaction.reply('Error fetching keywords.');
          }

          if (rows.length === 0) {
            return interaction.reply('❌ No global keywords set.');
          }

          let reply = '📝 **Global Keywords:**\n';
          let count = 0;
          rows.forEach((row) => {
            if (row.talk_group_id) {
              // Get talk group name
              db.get(
                `SELECT alpha_tag FROM talk_groups WHERE id = ?`,
                [row.talk_group_id],
                (err, tgRow) => {
                  if (tgRow) {
                    reply += `- **${row.keyword}** (Talk Group: ${tgRow.alpha_tag})\n`;
                  } else {
                    reply += `- **${row.keyword}**\n`;
                  }
                  count++;
                  if (count === rows.length) {
                    interaction.reply(reply);
                  }
                }
              );
            } else {
              reply += `- **${row.keyword}**\n`;
              count++;
              if (count === rows.length) {
                interaction.reply(reply);
              }
            }
          });
        });
      }
    } else if (commandName === 'summary') {
      const subcommand = interaction.options.getSubcommand();
      
      if (subcommand === 'refresh') {
        await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
        await updateSummaryEmbed();
        await interaction.editReply('✅ Summary has been refreshed!');
      }
    }
  } else if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId.startsWith('listen_live_')) {
      const talkGroupID = customId.replace('listen_live_', '');
      handleListenLive(interaction, talkGroupID);
    } else if (customId === 'refresh_summary') {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      await updateSummaryEmbed();
      await interaction.editReply('✅ Summary has been refreshed!');
    }
  }
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

// Start the Express server and Discord bot
const server = app.listen(PORT_NUM, () => {
  logger.info(`Bot server is running on port ${PORT_NUM}`);

  // Ensure the audio directory exists
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  client.login(DISCORD_TOKEN);
});

startTranscriptionProcess();

// Handle process termination
process.on('SIGINT', () => {
  logger.info('Shutting down gracefully...');
  server.close(() => {
    logger.info('Express server closed.');
    client.destroy();
    logger.info('Discord bot disconnected.');
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