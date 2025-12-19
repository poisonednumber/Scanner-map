#!/usr/bin/env node

/**
 * Scanner Map CLI
 * Entry point for global installation
 */

const path = require('path');
const { spawn } = require('child_process');

// Get the installer path
const installerPath = path.join(__dirname, '../scripts/installer/installer-core.js');

// Check if installer exists
const fs = require('fs');
if (!fs.existsSync(installerPath)) {
  console.error('Error: Installer not found. Please run this from the Scanner Map directory.');
  process.exit(1);
}

// Run the installer
const installer = spawn('node', [installerPath], {
  stdio: 'inherit',
  shell: true,
  cwd: path.join(__dirname, '..')
});

installer.on('close', (code) => {
  process.exit(code || 0);
});

installer.on('error', (err) => {
  console.error('Error running installer:', err.message);
  process.exit(1);
});

