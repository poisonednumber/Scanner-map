// bot.js - Main Discord bot application

require('dotenv').config();

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

// Get MAPPED_TALK_GROUPS as a string from environment variable
const {
  BOT_PORT: PORT,  
  PUBLIC_DOMAIN,
  DISCORD_TOKEN,
  MAPPED_TALK_GROUPS: mappedTalkGroupsString, 
  TIMEZONE,
  API_KEY_FILE
} = process.env;

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

// Override logger.info to suppress specific messages
const originalInfo = logger.info.bind(logger);
const suppressedPatterns = [
  /^Processed: .+\.mp3$/,
  /^Deleted audio file .+\.mp3$/,
  /^--- Incoming Request ---$/,
  /^Method: POST$/,
  /^URL: \/api\/call-upload$/,
  /^Headers: {[\s\S]+}$/,
  /^Handling \/api\/call-upload$/
];

logger.info = function (...args) {
  const message = args.join(' ');
  const shouldSuppress = suppressedPatterns.some((pattern) => pattern.test(message));
  if (!shouldSuppress) {
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
  for (let apiKey of apiKeys) {
    if (!apiKey.disabled) {
      const match = await bcrypt.compare(key, apiKey.key);
      if (match) {
        return apiKey;
      }
    }
  }
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
  
  // Force mp3 extension instead of using the original extension for PCM files
  const extension = isIgnoredFileType(originalFilename) ? '.mp3' : path.extname(originalFilename || '.mp3');

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
  return extension === '.pcm'; // Add more extensions to ignore if needed
};

// Route: /api/call-upload
app.post('/api/call-upload', (req, res) => {
  logger.info(`Handling /api/call-upload`);

  let fields = {};
  let fileInfo = null;
  let fileBuffer = null;

  const bb = busboy({
    headers: req.headers,
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB limit
  });

  bb.on('file', (name, file, info) => {
    fileInfo = { originalFilename: info.filename };
    
    // Check if the file type should be ignored
    if (isIgnoredFileType(info.filename)) {
      logger.info(`Ignoring unsupported file type: ${info.filename}`);
      // Skip collecting file data for ignored file types
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
  });

  bb.on('close', async () => {
    if (fields.test === '1') {
      return res.status(200).send('incomplete call data: no talkgroup');
    }

    if (!fields.key) {
      return res.status(400).send('API key is missing.');
    }

    const apiKey = await validateApiKey(fields.key);
    if (!apiKey) {
      return res.status(401).send('Invalid or disabled API key.');
    }

    // Check if the file was ignored due to file type
    if (fileInfo && isIgnoredFileType(fileInfo.originalFilename)) {
      return res.status(200).send('File type not supported. Skipping processing.');
    }

    if (fileInfo && fileBuffer) {
      const customFilename = generateCustomFilename(fields, fileInfo.originalFilename);
      const saveTo = path.join(UPLOAD_DIR, customFilename);
      fileInfo.saveTo = saveTo;

      fs.writeFile(saveTo, fileBuffer, (err) => {
        if (err) {
          logger.error('Error saving file:', err);
          return res.status(500).send('Error saving file');
        }

        logger.info(`Received: ${customFilename}`);

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
        });

        return res.status(200).send('Call imported successfully.');
      });
    } else {
      return res.status(200).send('incomplete call data: no talkgroup');
    }
  });

  req.pipe(bb);
});

app.get('/audio/:id', (req, res) => {
  const audioId = req.params.id;
  db.get('SELECT audio_data FROM audio_files WHERE transcription_id = ?', [audioId], (err, row) => {
    if (err) {
      logger.error('Error fetching audio:', err);
      return res.status(500).send('Error fetching audio');
    }
    if (!row) {
      return res.status(404).send('Audio not found');
    }
    res.set('Content-Type', 'audio/mpeg');
    res.send(row.audio_data);
  });
});

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

            // Add to transcription queue
            transcriptionQueue.push({
              tempPath,
              transcriptionId,
              talkGroupID,
              systemName,
              talkGroupName,
              source,
              talkGroupGroup,
              filename,
            });

            processTranscriptionQueue();
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
function processTranscriptionQueue() {
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
}

// Function to transcribe audio
function transcribeAudio(filePath, callback) {
  const pythonProcess = spawn('python', ['transcribe.py', filePath]);

  let transcriptionText = '';
  let errorOutput = '';

  pythonProcess.stdout.setEncoding('utf8');
  pythonProcess.stdout.on('data', (data) => {
    transcriptionText += data;
  });

  pythonProcess.stderr.setEncoding('utf8');
  pythonProcess.stderr.on('data', (data) => {
    errorOutput += data;
  });

  pythonProcess.on('close', (code) => {
    if (code !== 0) {
      logger.error(`Transcription failed for: ${path.basename(filePath)}. Error: ${errorOutput}`);
      callback(null);
    } else {
      try {
        const response = JSON.parse(transcriptionText.trim());
        if (response.error) {
          logger.error(`Transcription error: ${response.error}`);
          callback(null);
        } else {
          const transcription = response.transcription || '';
          callback(transcription.trim());
        }
      } catch (err) {
        logger.error(`Failed to parse transcription JSON: ${err.message}`);
        callback(null);
      }
    }
  });
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
  // Create a URL for the audio file
  const audioUrl = `http://${PUBLIC_DOMAIN}:${PORT_NUM}/audio/${audioID}`;
  
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

          // Create a URL for the audio file using the domain from the environment variable
          const audioUrl = `http://${PUBLIC_DOMAIN}:${PORT_NUM}/audio/${audioID}`;
          
          // Log the audioID and URL for debugging
          logger.info(`Audio ID: ${audioID}, URL: ${audioUrl}`);

          // Generate the transcription line with ID and properly formatted audio link
          const transcriptionLine = `**ID-${source}:** ${transcriptionText} [Audio](${audioUrl})`;

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
                // Update the cache with the new data
                messageCache.set(cacheKey, {
                  message: editedMsg,
                  timestamp: currentTime,
                  transcriptions: updatedTranscription,
                  url: editedMsg.url  // Store the message URL
                });
                
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
                // Cache the new message
                messageCache.set(cacheKey, {
                  message: msg,
                  timestamp: currentTime,
                  transcriptions: transcriptionLine,
                  url: msg.url  // Store the message URL
                });
                
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
  await interaction.deferReply({ ephemeral: true });

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
  } else {
    logger.error('Bot is not in any guilds.');
  }

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
    }
  } else if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId.startsWith('listen_live_')) {
      const talkGroupID = customId.replace('listen_live_', '');
      handleListenLive(interaction, talkGroupID);
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