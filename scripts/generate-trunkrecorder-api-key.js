#!/usr/bin/env node

/**
 * Generate API key for TrunkRecorder and update configuration
 * This script:
 * 1. Generates a new API key (UUID)
 * 2. Hashes it with bcrypt (same as Scanner Map)
 * 3. Creates/updates data/apikeys.json
 * 4. Writes plaintext key to data/trunk-recorder-api-key.txt
 * 5. Updates trunk-recorder/config/config.json with the key
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Configuration
const API_KEY_FILE = process.env.API_KEY_FILE || './appdata/scanner-map/data/apikeys.json';
const TRUNKRECORDER_KEY_FILE = './appdata/scanner-map/data/trunk-recorder-api-key.txt';
// Try appdata structure first (new), fallback to old structure
const fs = require('fs');
let TRUNKRECORDER_CONFIG = './appdata/trunk-recorder/config/config.json';
if (!fs.existsSync(TRUNKRECORDER_CONFIG)) {
  TRUNKRECORDER_CONFIG = './trunk-recorder/config/config.json';
}

// Generate UUID v4 (same as Scanner Map uses)
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Main function
async function main() {
  try {
    console.log('Generating API key for TrunkRecorder...');
    
    // Generate new API key
    const apiKey = generateUUID();
    console.log(`Generated API key: ${apiKey}`);
    
    // Hash the key (same as Scanner Map does)
    const hashedKey = bcrypt.hashSync(apiKey, 10);
    
    // Ensure data directory exists
    const dataDir = path.dirname(API_KEY_FILE);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log(`Created directory: ${dataDir}`);
    }
    
    // Load existing API keys or create new array
    let apiKeys = [];
    if (fs.existsSync(API_KEY_FILE)) {
      try {
        const data = fs.readFileSync(API_KEY_FILE, 'utf8');
        apiKeys = JSON.parse(data);
        console.log(`Loaded ${apiKeys.length} existing API key(s)`);
      } catch (err) {
        console.warn(`Warning: Could not parse existing API key file: ${err.message}`);
        console.log('Creating new API key file...');
      }
    }
    
    // Check if TrunkRecorder key already exists
    const existingTrunkRecorderKey = apiKeys.find(k => k.name === 'TrunkRecorder');
    if (existingTrunkRecorderKey) {
      console.log('TrunkRecorder API key already exists. Updating...');
      existingTrunkRecorderKey.key = hashedKey;
      existingTrunkRecorderKey.updated_at = new Date().toISOString();
    } else {
      // Add new TrunkRecorder key
      apiKeys.push({
        key: hashedKey,
        name: 'TrunkRecorder',
        disabled: false,
        created_at: new Date().toISOString(),
        description: 'Auto-generated API key for TrunkRecorder integration'
      });
      console.log('Added new TrunkRecorder API key');
    }
    
    // Save API keys file
    fs.writeFileSync(API_KEY_FILE, JSON.stringify(apiKeys, null, 2));
    console.log(`Saved API keys to: ${API_KEY_FILE}`);
    
    // Write plaintext key to shared file (for TrunkRecorder config)
    fs.writeFileSync(TRUNKRECORDER_KEY_FILE, apiKey);
    console.log(`Saved plaintext key to: ${TRUNKRECORDER_KEY_FILE}`);
    
    // Update TrunkRecorder config.json if it exists
    if (fs.existsSync(TRUNKRECORDER_CONFIG)) {
      try {
        const configData = fs.readFileSync(TRUNKRECORDER_CONFIG, 'utf8');
        const config = JSON.parse(configData);
        
        // Update uploadServer.apiKey
        if (!config.uploadServer) {
          config.uploadServer = {};
        }
        config.uploadServer.apiKey = apiKey;
        
        // Save updated config
        fs.writeFileSync(TRUNKRECORDER_CONFIG, JSON.stringify(config, null, 2));
        console.log(`Updated TrunkRecorder config: ${TRUNKRECORDER_CONFIG}`);
      } catch (err) {
        console.warn(`Warning: Could not update TrunkRecorder config: ${err.message}`);
        console.log(`Please manually set apiKey in ${TRUNKRECORDER_CONFIG} to: ${apiKey}`);
      }
    } else {
      console.log(`TrunkRecorder config not found: ${TRUNKRECORDER_CONFIG}`);
      console.log(`Please create it and set apiKey to: ${apiKey}`);
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('API KEY GENERATED SUCCESSFULLY!');
    console.log('='.repeat(60));
    console.log(`API Key: ${apiKey}`);
    console.log(`\nThis key has been:`);
    console.log(`  ✓ Added to ${API_KEY_FILE}`);
    console.log(`  ✓ Saved to ${TRUNKRECORDER_KEY_FILE}`);
    if (fs.existsSync(TRUNKRECORDER_CONFIG)) {
      console.log(`  ✓ Updated in ${TRUNKRECORDER_CONFIG}`);
    }
    console.log('\nTrunkRecorder is now configured to use this API key!');
    console.log('='.repeat(60));
    
  } catch (error) {
    console.error('Error generating API key:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { main, generateUUID };

