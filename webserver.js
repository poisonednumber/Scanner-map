// webserver.js - Web interface for viewing and managing calls with optional authentication

require('dotenv').config();
const AWS = require('aws-sdk'); // Add AWS SDK

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
  GOOGLE_MAPS_API_KEY,
  // --- NEW: Storage Env Vars ---
  STORAGE_MODE = 'local', // Default to local if not set
  S3_ENDPOINT,
  S3_BUCKET_NAME,
  S3_ACCESS_KEY_ID,
  S3_SECRET_ACCESS_KEY
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
  } else {
    console.log('Connected to the SQLite database.');
  }
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

**PRIORITIZATION:**
- If a clear event type (like Vehicle Collision, Fire, Assault, Medical Emergency, etc.) is mentioned, **use that category even if the dispatcher says "no details"** or the information is minimal.
- Use the 'Other' category ONLY if the transmission primarily contains just location/unit information OR if no specific event type from the list is mentioned at all.

It is CRUCIAL that your response is ONLY one of the category names from this list and nothing else.

Categories:
${categories.map(cat => `- ${cat}`).join('\n')}
- Other

Transmission: "${transcript}"

Category:`;
    // --- END REFINED PROMPT ---

    // Call the Ollama API
    // Add AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        console.warn(`Ollama request timed out after 5 seconds during categorization.`);
        controller.abort();
    }, 5000); // 5-second timeout

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
      }),
      signal: controller.signal // Pass the signal here
    });

    clearTimeout(timeoutId); // Clear timeout if fetch completes

    if (!response.ok) {
      // Log the error and transcript for debugging, then throw
      console.error(`HTTP error! status: ${response.status} for transcript: ${transcript}`);
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();

    // Trim whitespace and convert to uppercase for consistency
    let category = result.response.trim(); // Changed to let

    // --- ADDED: Remove <think> block ---
    const thinkBlockRegex = /<think>[\s\S]*?<\/think>\s*/; // Corrected escaping
    category = category.replace(thinkBlockRegex, '').trim().toUpperCase(); // Apply replace and uppercase here
    // --- END ADDED ---

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
    // Check specifically for AbortError (timeout)
    if (error.name === 'AbortError') {
         console.error(`Ollama request timed out during categorization: ${error.message}`);
         // Return 'OTHER' on timeout as per existing fallback logic
    }
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
app.get('/audio/:id', async (req, res) => { // Added async
  const transcriptionId = req.params.id;
  // Commented out verbose logging
  // console.log(`[Audio Request] ID: ${transcriptionId}, Mode: ${STORAGE_MODE}`);

  try {
    // Fetch the audio file path/key from the transcriptions table
    const row = await new Promise((resolve, reject) => {
      db.get('SELECT audio_file_path FROM transcriptions WHERE id = ?', [transcriptionId], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });

    if (!row || !row.audio_file_path) {
      console.error(`[Audio Request] Audio path not found for ID: ${transcriptionId}`);
      return res.status(404).send('Audio record not found');
    }

    const audioStoragePath = row.audio_file_path;
    const extension = path.extname(audioStoragePath).toLowerCase();
    let contentType = 'audio/mpeg'; // Default to MP3
    if (extension === '.m4a') {
      contentType = 'audio/mp4';
    }

    if (STORAGE_MODE === 's3') {
      // --- S3 Streaming Logic ---
      // Commented out verbose logging
      // console.log(`[Audio S3] Streaming key: ${audioStoragePath}`);
      const params = {
        Bucket: S3_BUCKET_NAME,
        Key: audioStoragePath,
      };
      res.setHeader('Content-Type', contentType);

      // Create a readable stream from S3 and pipe it to the response
      const s3Stream = s3.getObject(params).createReadStream();

      s3Stream.on('error', (s3Err) => {
        console.error(`[Audio S3] Stream error for key ${audioStoragePath}:`, s3Err);
        // Try to send error status only if headers aren't already sent
        if (!res.headersSent) {
          res.status(500).send('Error streaming audio from S3');
        }
      });

      s3Stream.pipe(res);
      // --- End S3 Streaming Logic ---

    } else {
      // --- Local File Serving Logic ---
      const audioStoragePath = row.audio_file_path; // Re-declare here for clarity
      const localPath = path.join(__dirname, 'audio', audioStoragePath);
      console.log(`[Audio Local] Serving path: ${localPath}`); // Keep basic serving path log

      if (fs.existsSync(localPath)) {
        res.setHeader('Content-Type', contentType);
        const fileStream = fs.createReadStream(localPath);
        // Pipe directly, relying on outer try/catch for major errors
        fileStream.pipe(res); 
      } else {
        console.error(`[Audio Local] File not found: ${localPath}`);
        return res.status(404).send('Audio file not found locally');
      }
      // --- End Local File Serving Logic ---
    }

  } catch (dbErr) {
    console.error('[Audio Request] Database error:', dbErr);
    return res.status(500).send('Internal Server Error');
  }
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
  // Convert the ISO string timestamp to Unix timestamp (seconds)
  const sinceTimestampISO = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const sinceTimestampUnix = Math.floor(new Date(sinceTimestampISO).getTime() / 1000);

  console.log(`Fetching calls since: ${sinceTimestampISO} (${hours} hours ago) [Unix: ${sinceTimestampUnix}]`);

  db.all(
    `
    SELECT t.*, tg.alpha_tag AS talk_group_name, tg.tag AS talk_group_tag
    FROM transcriptions t
    LEFT JOIN talk_groups tg ON t.talk_group_id = tg.id
    WHERE t.timestamp >= ? AND t.lat IS NOT NULL AND t.lon IS NOT NULL
    ORDER BY t.timestamp DESC
    `,
    // Use the Unix timestamp for the query parameter
    [sinceTimestampUnix],
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
              let shouldEmit = false;
              // --- Emission Logic with Timeout ---
              if (row.transcription) {
                   // Has transcription, emit immediately
                   shouldEmit = true;
              } else {
                   // No transcription yet, check age
                  const callAgeMs = Date.now() - new Date(row.timestamp).getTime();
                  if (callAgeMs > 10000) { // 10 second timeout
                      // Timeout exceeded, emit with placeholder
                      row.transcription = "[Transcription Pending...]"; // Modify row
                      shouldEmit = true;
                  } else {
                      // Too new and no transcription, wait (DO NOTHING)
                  }
              }
              // --- End Emission Logic ---
              
              // Emit only if decided
              if (shouldEmit) {
                 // REMOVED LOGGING HERE
                 // console.log(`[LiveFeed Emit] Emitting call ID: ${row.id}, Transcription: ${row.transcription ? row.transcription.substring(0, 30) + '...' : '(empty)'}`); 
                 io.emit('liveFeedUpdate', row); 
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