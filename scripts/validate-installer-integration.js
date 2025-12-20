#!/usr/bin/env node
/**
 * Validates that all dependencies and configurations are integrated into the installer
 * Run this before committing to ensure nothing is missing
 */

const fs = require('fs-extra');
const path = require('path');

const projectRoot = path.join(__dirname, '../');
const errors = [];
const warnings = [];

console.log('🔍 Validating installer integration...\n');

// Check package.json dependencies
console.log('Checking npm dependencies...');
const packageJson = require(path.join(projectRoot, 'package.json'));
const installerCore = fs.readFileSync(path.join(projectRoot, 'scripts/installer/installer-core.js'), 'utf8');
const dependencyInstaller = fs.readFileSync(path.join(projectRoot, 'scripts/installer/dependency-installer.js'), 'utf8');

// Check if critical dependencies are mentioned in installer
const criticalDeps = ['inquirer', 'chalk', 'fs-extra', 'yaml'];
criticalDeps.forEach(dep => {
  if (packageJson.dependencies[dep] && !installerCore.includes(dep)) {
    warnings.push(`⚠️  Dependency "${dep}" in package.json but not referenced in installer-core.js`);
  }
});

// Check requirements.txt
console.log('Checking Python dependencies...');
const requirements = fs.readFileSync(path.join(projectRoot, 'requirements.txt'), 'utf8');
const pythonPackages = requirements.split('\n')
  .filter(line => line.trim() && !line.startsWith('#'))
  .map(line => line.split('>=')[0].split('==')[0].trim());

pythonPackages.forEach(pkg => {
  if (!dependencyInstaller.includes('python') && !dependencyInstaller.includes('Python')) {
    warnings.push(`⚠️  Python package "${pkg}" in requirements.txt - ensure Python installation is checked`);
  }
});

// Check .env.example vs env-generator.js
console.log('Checking environment variables...');
const envExamplePath = path.join(projectRoot, '.env.example');
const envGenerator = fs.readFileSync(path.join(projectRoot, 'scripts/installer/env-generator.js'), 'utf8');

if (fs.existsSync(envExamplePath)) {
  const envExample = fs.readFileSync(envExamplePath, 'utf8');
  
  // Extract env vars from .env.example (lines like KEY=value)
  const envVars = envExample.split('\n')
    .filter(line => line.trim() && !line.startsWith('#') && line.includes('='))
    .map(line => line.split('=')[0].trim())
    .filter(key => key.length > 0);

  envVars.forEach(envVar => {
    // Check if it's in env-generator.js (either as variable or in template)
    if (!envGenerator.includes(envVar) && !envGenerator.includes(envVar.toLowerCase())) {
      // Some vars might be auto-generated, so this is a warning
      warnings.push(`⚠️  Environment variable "${envVar}" in .env.example but not found in env-generator.js`);
    }
  });
} else {
  // .env.example is optional - installer generates .env directly
  warnings.push(`⚠️  .env.example file not found (optional - installer generates .env automatically)`);
}

// Check docker-compose-builder.js for service consistency
console.log('Checking Docker services...');
const dockerComposeBuilder = fs.readFileSync(path.join(projectRoot, 'scripts/installer/docker-compose-builder.js'), 'utf8');
const dockerInstaller = fs.readFileSync(path.join(projectRoot, 'scripts/installer/docker-installer.js'), 'utf8');

// Check if services mentioned in docker-compose-builder are in docker-installer
if (dockerComposeBuilder.includes('enableOllama') && !dockerInstaller.includes('enableOllama')) {
  errors.push(`❌ Ollama service in docker-compose-builder.js but not in docker-installer.js`);
}
if (dockerComposeBuilder.includes('enableICAD') && !dockerInstaller.includes('enableICAD')) {
  errors.push(`❌ iCAD service in docker-compose-builder.js but not in docker-installer.js`);
}
if (dockerComposeBuilder.includes('enableTrunkRecorder') && !dockerInstaller.includes('enableTrunkRecorder')) {
  errors.push(`❌ TrunkRecorder service in docker-compose-builder.js but not in docker-installer.js`);
}

// Check for hardcoded ports that should be in DEFAULTS
console.log('Checking for hardcoded values...');
const installerCoreContent = fs.readFileSync(path.join(projectRoot, 'scripts/installer/installer-core.js'), 'utf8');
if (installerCoreContent.includes('3001') && !installerCoreContent.includes('DEFAULTS.WEBSERVER_PORT')) {
  warnings.push(`⚠️  Port 3001 hardcoded - should use DEFAULTS.WEBSERVER_PORT`);
}
if (installerCoreContent.includes('3306') && !installerCoreContent.includes('DEFAULTS.BOT_PORT')) {
  warnings.push(`⚠️  Port 3306 hardcoded - should use DEFAULTS.BOT_PORT`);
}

// Summary
console.log('\n' + '='.repeat(50));
if (errors.length === 0 && warnings.length === 0) {
  console.log('✅ All checks passed! Installer integration looks good.\n');
  process.exit(0);
} else {
  if (errors.length > 0) {
    console.log('\n❌ ERRORS (must fix):\n');
    errors.forEach(err => console.log(`   ${err}`));
  }
  if (warnings.length > 0) {
    console.log('\n⚠️  WARNINGS (should review):\n');
    warnings.forEach(warn => console.log(`   ${warn}`));
  }
  console.log('\n💡 See DEVELOPMENT_CHECKLIST.md for integration steps.\n');
  process.exit(errors.length > 0 ? 1 : 0);
}

