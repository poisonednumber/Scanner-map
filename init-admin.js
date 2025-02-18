const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
require('dotenv').config();

const db = new sqlite3.Database('./botdata.db', sqlite3.OPEN_READWRITE, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('Connected to the SQLite database.');
});

// Create users table if it doesn't exist
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            salt TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `, (err) => {
        if (err) {
            console.error('Error creating users table:', err);
            process.exit(1);
        }

        // Generate salt and hash password
        const salt = crypto.randomBytes(16).toString('hex');
        const password = process.env.WEBSERVER_PASSWORD;
        const hash = crypto
            .pbkdf2Sync(password, salt, 10000, 64, 'sha512')
            .toString('hex');

        // Insert admin user
        const stmt = db.prepare('INSERT OR REPLACE INTO users (username, password_hash, salt) VALUES (?, ?, ?)');
        stmt.run('admin', hash, salt, function(err) {
            if (err) {
                console.error('Error inserting admin user:', err);
            } else {
                console.log('Admin user created successfully!');
                console.log('Username: admin');
                console.log('Password:', password);
            }
            
            // Close the database connection
            db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err);
                }
                process.exit(0);
            });
        });
    });
});