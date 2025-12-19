#!/usr/bin/env node

/**
 * Scanner Map CLI
 * Entry point for global npm installation (npx scanner-map)
 */

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const installerPath = path.join(projectRoot, 'scripts/installer/installer-core.js');

// Verify installer exists
if (!fs.existsSync(installerPath)) {
  console.error('Error: Installer not found at', installerPath);
  console.error('Please run this from within the Scanner Map directory.');
  process.exit(1);
}

// Pass through any command-line arguments
const args = [installerPath, ...process.argv.slice(2)];

const installer = spawn('node', args, {
  stdio: 'inherit',
  cwd: projectRoot
});

installer.on('close', (code) => {
  process.exit(code || 0);
});

installer.on('error', (err) => {
  console.error('Failed to start installer:', err.message);
  process.exit(1);
});

