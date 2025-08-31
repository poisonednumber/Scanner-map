const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const csv = require('csv-parser');

// Initialize the SQLite database
const db = new sqlite3.Database('./botdata.db', (err) => {
  if (err) {
    console.error('Error opening database', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Create necessary tables if they don't exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS talk_groups (
    id INTEGER PRIMARY KEY,      -- DEC
    hex TEXT,                    -- HEX
    alpha_tag TEXT,              -- Alpha Tag
    mode TEXT,                   -- Mode
    description TEXT,            -- Description
    tag TEXT,                    -- Tag
    county TEXT                  -- County
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS frequencies (
    id INTEGER PRIMARY KEY,
    frequency TEXT,
    description TEXT
  )`);
});

// Function to import talk groups from CSV
function importTalkGroups() {
  const talkGroupsFile = path.join(__dirname, 'talkgroups.csv');
  fs.createReadStream(talkGroupsFile)
    .pipe(csv({
      headers: ['DEC', 'HEX', 'Alpha Tag', 'Mode', 'Description', 'Tag', 'County'],
      skipLines: 0, // Adjust if your CSV has a header row
    }))
    .on('data', (row) => {
      // Parse fields from the CSV row
      const id = parseInt(row['DEC'], 10);
      const hex = row['HEX'];
      const alphaTag = row['Alpha Tag'];
      const mode = row['Mode'];
      const description = row['Description'];
      const tag = row['Tag'];
      const county = row['County'];

      // Insert into the database
      db.run(
        `INSERT OR REPLACE INTO talk_groups (id, hex, alpha_tag, mode, description, tag, county) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, hex, alphaTag, mode, description, tag, county],
        (err) => {
          if (err) {
            console.error('Error inserting talk group:', err.message);
          }
        }
      );
    })
    .on('end', () => {
      console.log('Talk groups imported successfully.');
    });
}

// Function to import frequencies from CSV
function importFrequencies() {
  const frequenciesFile = path.join(__dirname, 'frequencies.csv');
  fs.createReadStream(frequenciesFile)
    .pipe(csv({
      headers: ['Site ID', 'Frequency', 'Description'],
      skipLines: 0, // Adjust if your CSV has a header row
    }))
    .on('data', (row) => {
      const id = parseInt(row['Site ID'], 10);
      const frequency = row['Frequency'];
      const description = row['Description'];

      db.run(
        `INSERT OR REPLACE INTO frequencies (id, frequency, description) VALUES (?, ?, ?)`,
        [id, frequency, description],
        (err) => {
          if (err) {
            console.error('Error inserting frequency:', err.message);
          }
        }
      );
    })
    .on('end', () => {
      console.log('Frequencies imported successfully.');
    });
}

// Run the import functions
importTalkGroups();
// importFrequencies(); // Commented out as frequencies.csv is optional
