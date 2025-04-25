// webserver.js - Web interface for viewing and managing calls with optional authentication

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');
const fetch = require('node-fetch');
const fs = require('fs');
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Environment variables
const {
  WEBSERVER_PORT,
  WEBSERVER_PASSWORD,
  PUBLIC_DOMAIN,
  TIMEZONE,
  ENABLE_AUTH, // New environment variable for toggling authentication
  SESSION_DURATION_DAYS = "7", // Default 7 days if not specified
  MAX_SESSIONS_PER_USER = "5", // Default 5 sessions if not specified
  GOOGLE_MAPS_API_KEY
} = process.env;

// Validate required environment variables
const requiredVars = ['WEBSERVER_PORT', 'PUBLIC_DOMAIN', 'GOOGLE_MAPS_API_KEY'];
const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`ERROR: Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

// Add endpoint to serve Google API key
const app = express();
app.use(express.json()); // Add this line to parse JSON bodies

app.get('/api/config/google-api-key', (req, res) => {
  res.json({ apiKey: GOOGLE_MAPS_API_KEY });
});

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
  } else {
    console.log('Connected to the SQLite database.');
  }
});

db.run(`ALTER TABLE transcriptions ADD COLUMN summary TEXT`, err => {
  // Ignore error if column already exists
  if (!err || err.message.includes('duplicate column name')) {
    console.log('Summary column exists or was created successfully');
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
    // --- NEW: Pre-check for ambiguity ---
    // List of keywords that likely indicate a specific event type
    const incidentKeywords = [
      'emergency', 'injured', 'person down', 'disturbance', 'collision', 'crash', 'mvc',
      'burglary', 'break in', 'assault', 'fire', 'smoke', 'flames', 'missing', 'medical',
      'stolen', 'stop', 'unconscious', 'reckless', 'gun', 'weapon', 'shots fired',
      'consciousness', 'breathing', 'difficulty breathing', 'fight', 'domestic',
      'carbon monoxide', 'co', 'abduction', 'kidnapping', 'passed out', 'hazmat',
      'alarm', 'hazard', 'intoxicated', 'drunk', 'bite', 'animal', 'assist', 'help',
      'down', 'sick', 'hurt', 'attack', 'robbery', 'theft', 'accident', 'overdose', 'od',
      'suspicious', 'trespassing', 'vehicle fire', 'cardiac', 'arrest', 'seizure'
      // This list can be expanded based on common dispatch terms
    ];

    // Convert transcript to lowercase for case-insensitive matching
    const lowerCaseTranscript = transcript.toLowerCase();

    // Check if the transcript contains any of the specific incident keywords
    const containsIncidentKeyword = incidentKeywords.some(keyword =>
      lowerCaseTranscript.includes(keyword)
    );

    // Also check for very short transcripts that might lack context
    // Adjust the word count threshold as needed
    const wordCount = transcript.trim().split(/\s+/).length;
    const isVeryShort = wordCount < 4;

    // If no incident keyword is found OR the transcript is very short, classify as OTHER
    if (!containsIncidentKeyword || isVeryShort) {
      console.log(`Transcript "${transcript}" lacks specific keywords or is too short (${wordCount} words), defaulting to OTHER.`);
      // Return 'OTHER' directly, bypassing the AI call
      return 'OTHER';
    }
    // --- END: Pre-check ---

    // Get environment variables for Ollama
    const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
    const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.1:8b'; // Or your preferred model

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

    // Refined prompt for the AI, explicitly mentioning the 'Other' case for ambiguity
    const prompt = `
You are an expert emergency service dispatcher categorizing radio transmissions.
Analyze the following first responder radio transmission and categorize it into EXACTLY ONE of the categories listed below.
Choose the category that best fits the main subject of the transmission.
Focus on the primary reason for the dispatch if multiple events are mentioned.

**IMPORTANT:** If the transmission primarily contains only location information (like an address and cross streets) OR if it lacks specific details to determine the nature of the event, respond with exactly 'Other'.

It is CRUCIAL that your response is ONLY one of the category names from this list and nothing else.

Categories:
${categories.map(cat => `- ${cat}`).join('\n')}
- Other (Use ONLY if no other category truly fits OR if the transmission lacks sufficient detail for specific categorization)

Transmission: "${transcript}"

Category:`;
    // --- END REFINED PROMPT ---

    // Call the Ollama API
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false,
        options: {
            // Lower temperature might make the AI less likely to guess creative categories
            temperature: 0.3
        }
      })
    });

    if (!response.ok) {
      // Log the error and transcript for debugging, then throw
      console.error(`HTTP error! status: ${response.status} for transcript: ${transcript}`);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    // Trim whitespace and convert to uppercase for consistency
    let category = result.response.trim().toUpperCase();

    // Validate the AI's response against the known categories (including OTHER)
    const validCategoriesUppercase = categories.map(cat => cat.toUpperCase());
    validCategoriesUppercase.push('OTHER'); // Ensure 'OTHER' is always valid

    if (!validCategoriesUppercase.includes(category)) {
       // Log the unexpected response from the AI before defaulting
       console.warn(`Ollama returned an unexpected or invalid category: "${result.response}". Defaulting to OTHER for transcript: "${transcript}"`);
       category = 'OTHER';
    }

    //console.log(`Categorized call "${transcript}" as: "${category}"`);
    // Return the determined category (uppercase)
    return category;

  } catch (error) {
    // Log the error along with the transcript that caused it
    console.error(`Error categorizing call: "${transcript}". Error: ${error.message}`);
    // Fallback to 'OTHER' in case of any errors during the process
    return 'OTHER';
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

// Public Routes (No Auth Required)
app.get('/audio/:id', (req, res) => {
  const requestedId = req.params.id;
  
  // First try to get audio directly by audio_id
  db.get('SELECT audio_data FROM audio_files WHERE id = ?', [requestedId], (err, row) => {
    if (err) {
      console.error('Error fetching audio by ID:', err);
      return res.status(500).send('Internal Server Error');
    }
    
    if (row) {
      // Found by audio_id
      //console.log(`Found audio using direct ID match: ${requestedId}`);
      res.set('Content-Type', 'audio/mpeg');
      return res.send(row.audio_data);
    }
    
    // If not found, try by transcription_id
    db.get('SELECT audio_data FROM audio_files WHERE transcription_id = ?', [requestedId], (err, row) => {
      if (err) {
        console.error('Error fetching audio by transcription_id:', err);
        return res.status(500).send('Internal Server Error');
      }
      
      if (row) {
        // Found by transcription_id
        //console.log(`Found audio using transcription_id: ${requestedId}`);
        res.set('Content-Type', 'audio/mpeg');
        return res.send(row.audio_data);
      }
      
      // Not found by either method
      return res.status(404).send('Audio file not found');
    });
  });
});

// Apply authentication middleware to protected routes if auth is enabled
app.use(basicAuth);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

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
  const sinceTimestamp = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  console.log(`Fetching calls since: ${sinceTimestamp} (${hours} hours ago)`);

  db.all(
    `
    SELECT t.*, a.id AS audio_id, tg.alpha_tag AS talk_group_name, tg.tag AS talk_group_tag
    FROM transcriptions t
    LEFT JOIN audio_files a ON t.id = a.transcription_id
    LEFT JOIN talk_groups tg ON t.talk_group_id = tg.id
    WHERE t.timestamp >= ? AND t.lat IS NOT NULL AND t.lon IS NOT NULL
    ORDER BY t.timestamp DESC
    `,
    [sinceTimestamp],
    (err, rows) => {
      if (err) {
        console.error('Error fetching calls:', err);
        res.status(500).json({ error: err.message });
        return;
      }

      console.log(`Returning ${rows.length} calls`);
      if (rows.length > 0) {
        console.log(`Oldest call in result: ${rows[rows.length - 1].timestamp}`);
        console.log(`Newest call in result: ${rows[0].timestamp}`);
      }
      res.json(rows);
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

      db.run('DELETE FROM audio_files WHERE transcription_id = ?', [markerId]);
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
        SELECT t.id, t.transcription, a.id AS audio_id, t.timestamp, tg.alpha_tag AS talk_group_name
        FROM transcriptions t
        LEFT JOIN audio_files a ON t.id = a.transcription_id
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

          res.json(rows);
        }
      );
    }
  );
});

// NEW Endpoint for Talkgroup History
app.get('/api/talkgroup/:talkgroupId/calls', (req, res) => {
  const talkgroupId = parseInt(req.params.talkgroupId, 10);
  const hours = parseInt(req.query.hours) || 12; // Default hours for initial load
  const sinceId = parseInt(req.query.sinceId, 10) || 0; // Get the ID to fetch calls newer than

  if (isNaN(talkgroupId)) {
    return res.status(400).json({ error: 'Invalid talkgroup ID' });
  }

  let query;
  const params = [];

  if (sinceId > 0) {
    // Polling request: Get calls strictly newer than the last known ID for this talkgroup
    // console.log(`Polling calls for talkgroup ${talkgroupId} since ID: ${sinceId}`); // Reduced logging
    query = `
      SELECT t.*, a.id AS audio_id, tg.alpha_tag AS talk_group_name
      FROM transcriptions t
      LEFT JOIN audio_files a ON t.id = a.transcription_id
      LEFT JOIN talk_groups tg ON t.talk_group_id = tg.id
      WHERE t.talk_group_id = ? AND t.id > ?
        AND t.transcription IS NOT NULL -- ADDED: Ensure transcription exists
      ORDER BY t.timestamp DESC -- Still return newest first for consistency
    `;
    params.push(talkgroupId, sinceId);
  } else {
    // Initial load request: Get calls within the time range
    const sinceTimestamp = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    console.log(`Fetching initial calls for talkgroup ${talkgroupId} since: ${sinceTimestamp} (${hours} hours ago)`);
    query = `
      SELECT t.*, a.id AS audio_id, tg.alpha_tag AS talk_group_name
      FROM transcriptions t
      LEFT JOIN audio_files a ON t.id = a.transcription_id
      LEFT JOIN talk_groups tg ON t.talk_group_id = tg.id
      WHERE t.talk_group_id = ? AND t.timestamp >= ?
        AND t.transcription IS NOT NULL -- ADDED: Ensure transcription exists
      ORDER BY t.timestamp DESC
    `;
    params.push(talkgroupId, sinceTimestamp);
  }

  db.all(query, params, (err, rows) => {
    if (err) {
      console.error(`Error fetching calls for talkgroup ${talkgroupId}:`, err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // For polling requests, rows might be empty, which is normal
    if (sinceId > 0) {
       // console.log(`Poll returned ${rows.length} calls for talkgroup ${talkgroupId} since ID ${sinceId}`); // Reduced logging
    } else {
       console.log(`Initial load returned ${rows.length} calls for talkgroup ${talkgroupId}`);
    }
    res.json(rows);
  });
});
// END NEW Endpoint

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
    SELECT t.*, a.id AS audio_id, tg.alpha_tag AS talk_group_name, tg.tag AS talk_group_tag
    FROM transcriptions t
    LEFT JOIN audio_files a ON t.id = a.transcription_id
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

              // --- Emission Logic with Timeout --- 
              if (row.transcription) {
                   // Has transcription, emit immediately
                  io.emit('newCall', row);
              } else {
                  // No transcription yet, check age
                  const callAgeMs = Date.now() - new Date(row.timestamp).getTime();
                  if (callAgeMs > 10000) { // 10 second timeout
                      // Timeout exceeded, emit with placeholder
                      row.transcription = "[Transcription Pending...]"; // Modify row
                      io.emit('newCall', row);
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
           a.id AS audio_id, 
           tg.alpha_tag AS talk_group_name
    FROM transcriptions t
    LEFT JOIN audio_files a ON t.id = a.transcription_id
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
      
      let updatedLastFeedId = lastLiveFeedCallId;
      if (rows && rows.length > 0) {
          rows.forEach(row => {
              if (row.id > updatedLastFeedId) {
                  updatedLastFeedId = row.id; // Track highest ID fetched
              }
              
              // --- Emission Logic with Timeout ---
              if (row.transcription) {
                   // Has transcription, emit immediately
                  io.emit('liveFeedUpdate', row); 
              } else {
                   // No transcription yet, check age
                  const callAgeMs = Date.now() - new Date(row.timestamp).getTime();
                  if (callAgeMs > 10000) { // 10 second timeout
                      // Timeout exceeded, emit with placeholder
                      row.transcription = "[Transcription Pending...]"; // Modify row
                      io.emit('liveFeedUpdate', row);
                  } else {
                      // Too new and no transcription, wait
                  }
              }
              // --- End Emission Logic ---
          });
          // Update state variable *after* processing batch with highest ID *fetched*
          if (updatedLastFeedId > lastLiveFeedCallId) {
              lastLiveFeedCallId = updatedLastFeedId;
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
server.listen(WEBSERVER_PORT, () => {
  console.log(`Web server running on port ${WEBSERVER_PORT}`);
  console.log(`Audio URL base: http://${PUBLIC_DOMAIN}:${WEBSERVER_PORT}/audio/`);
  
  if (authEnabled) {
    console.log('Authentication: ENABLED');
    console.log(`Session duration: ${SESSION_DURATION / (24 * 60 * 60 * 1000)} days`);
    console.log(`Max sessions per user: ${MAX_SESSIONS}`);
  } else {
    console.log('Authentication: DISABLED');
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