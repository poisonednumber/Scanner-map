require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const crypto = require('crypto');

// Express app setup
const app = express();
const PORT = process.env.WEBSERVER_PORT || 3000;

app.use(express.json());

// Create HTTP server and setup Socket.IO
const server = http.createServer(app);
const io = socketIo(server);

// Session configuration
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds
const MAX_SESSIONS_PER_USER = 5; // Maximum concurrent sessions per user
const SESSION_CLEANUP_INTERVAL = 60 * 60 * 1000; // Cleanup every hour

// Database setup
const db = new sqlite3.Database('./botdata.db', sqlite3.OPEN_READWRITE, (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to the SQLite database.');
  }
});

// Create necessary tables
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

// Helper Functions
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

function cleanupExpiredSessions() {
  db.run('DELETE FROM sessions WHERE expires_at <= datetime("now")', [], (err) => {
    if (err) {
      console.error('Error cleaning up expired sessions:', err);
    } else {
      console.log('Expired sessions cleaned up');
    }
  });
}

// Start session cleanup interval
setInterval(cleanupExpiredSessions, SESSION_CLEANUP_INTERVAL);

// Authentication Middleware
const basicAuth = async (req, res, next) => {
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
              if (sessions.length >= MAX_SESSIONS_PER_USER) {
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
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).send('Admin authentication required.');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('ascii');
  const [username, password] = credentials.split(':');

  if (username === 'admin' && password === process.env.WEBSERVER_PASSWORD) {
    next();
  } else {
    return res.status(401).send('Invalid admin credentials.');
  }
};

// Public Routes (No Auth Required)
app.get('/audio/:id', (req, res) => {
  const audioId = parseInt(req.params.id, 10);

  if (isNaN(audioId)) {
    return res.status(400).send('Invalid audio ID.');
  }

  db.get(
    'SELECT audio_data FROM audio_files WHERE id = ?',
    [audioId],
    (err, row) => {
      if (err) {
        console.error('Error fetching audio data:', err);
        return res.status(500).send('Internal Server Error.');
      }

      if (!row) {
        return res.status(404).send('Audio file not found.');
      }

      res.set('Content-Type', 'audio/mpeg');
      res.send(row.audio_data);
    }
  );
});

// Apply authentication middleware to all subsequent routes
app.use(basicAuth);

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Session Management Routes
app.get('/api/sessions/current', (req, res) => {
  res.json({
    session: req.session,
    user: req.user
  });
});

app.get('/api/sessions', adminAuth, (req, res) => {
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

// User Management Routes (Admin Only)
app.post('/api/users', adminAuth, async (req, res) => {
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

/**
 * 4. Protected API Routes
 */

// Get calls within the specified hours
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

// Delete a marker
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

// Update marker location
app.put('/api/markers/:id/location', (req, res) => {
  const markerId = parseInt(req.params.id, 10);
  
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const { lat, lon } = req.body;

  if (isNaN(markerId) || typeof lat !== 'number' || typeof lon !== 'number') {
    return res.status(400).json({ 
      error: 'Invalid parameters',
      details: {
        markerId: isNaN(markerId) ? 'Invalid ID' : markerId,
        lat: typeof lat !== 'number' ? 'Invalid latitude' : lat,
        lon: typeof lon !== 'number' ? 'Invalid longitude' : lon
      }
    });
  }

  db.run(
    'UPDATE transcriptions SET lat = ?, lon = ? WHERE id = ?',
    [lat, lon, markerId],
    function(err) {
      if (err) {
        console.error('Error updating marker location:', err);
        return res.status(500).json({ error: 'Internal server error', details: err.message });
      }

      res.json({ message: 'Marker location updated successfully' });
    }
  );
});

// Get additional transcriptions from the same talk group
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

/**
 * 5. Socket.IO Setup
 */

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});

/**
 * 6. Database Polling
 */

let lastCallId = 0;

function initializeLastCallId() {
  db.get('SELECT MAX(id) AS maxId FROM transcriptions', (err, row) => {
    if (err) {
      console.error('Error initializing lastCallId:', err.message);
    } else {
      lastCallId = row.maxId || 0;
      console.log(`Initialized lastCallId to ${lastCallId}`);
    }
  });
}

function checkForNewCalls() {
  db.all(
    `
    SELECT t.*, a.id AS audio_id, a.audio_data, tg.alpha_tag AS talk_group_name
    FROM transcriptions t
    LEFT JOIN audio_files a ON t.id = a.transcription_id
    LEFT JOIN talk_groups tg ON t.talk_group_id = tg.id
    WHERE t.id > ? 
      AND t.lat IS NOT NULL 
      AND t.lon IS NOT NULL 
      AND t.lat BETWEEN -90 AND 90 
      AND t.lon BETWEEN -180 AND 180
    ORDER BY t.id ASC
    `,
    [lastCallId],
    (err, rows) => {
      if (err) {
        console.error('Error checking for new calls:', err.message);
        return;
      }
      if (rows && rows.length > 0) {
        rows.forEach((row) => {
          if (row.id > lastCallId) {
            lastCallId = row.id;
          }
          io.emit('newCall', row);
          console.log('Emitted newCall event for call ID:', row.id);
        });
      }
    }
  );
}

// Initialize lastCallId and start polling
initializeLastCallId();
setInterval(checkForNewCalls, 2000);

/**
 * 7. Server Startup and Shutdown
 */

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Session duration: ${SESSION_DURATION / (24 * 60 * 60 * 1000)} days`);
  console.log(`Max sessions per user: ${MAX_SESSIONS_PER_USER}`);
});

process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
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