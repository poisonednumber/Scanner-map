/**
 * Installer Logger
 * Logs all installer activities to a file while preserving console output
 */

const fs = require('fs-extra');
const path = require('path');
const { Writable } = require('stream');

class InstallerLogger {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.logDir = path.join(projectRoot, 'logs');
    this.logFile = path.join(this.logDir, `installer-${new Date().toISOString().replace(/[:.]/g, '-').split('T')[0]}-${Date.now()}.log`);
    this.logStream = null;
    this.originalConsoleLog = null;
    this.originalConsoleError = null;
    this.originalConsoleWarn = null;
    this.startTime = Date.now();
    
    this.initialize();
  }

  initialize() {
    try {
      // Ensure logs directory exists
      fs.ensureDirSync(this.logDir);
      
      // Create log file with header
      const header = `========================================
Scanner Map Installer Log
Started: ${new Date().toISOString()}
========================================\n\n`;
      fs.writeFileSync(this.logFile, header);
      
      // Create write stream for appending
      this.logStream = fs.createWriteStream(this.logFile, { flags: 'a' });
      
      // Intercept console methods
      this.interceptConsole();
      
      // Log initialization
      this.log('info', 'Installer logger initialized', { logFile: this.logFile });
    } catch (err) {
      // If logging fails, continue without it
      console.error('Failed to initialize installer logger:', err.message);
    }
  }

  interceptConsole() {
    // Store original methods
    this.originalConsoleLog = console.log.bind(console);
    this.originalConsoleError = console.error.bind(console);
    this.originalConsoleWarn = console.warn.bind(console);

    // Override console.log
    console.log = (...args) => {
      this.writeToLog('info', args);
      this.originalConsoleLog(...args);
    };

    // Override console.error
    console.error = (...args) => {
      this.writeToLog('error', args);
      this.originalConsoleError(...args);
    };

    // Override console.warn
    console.warn = (...args) => {
      this.writeToLog('warn', args);
      this.originalConsoleWarn(...args);
    };
  }

  writeToLog(level, args) {
    if (!this.logStream) return;

    try {
      const timestamp = new Date().toISOString();
      const message = args
        .map(arg => {
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          }
          // Strip ANSI color codes for file logging
          return String(arg).replace(/\x1b\[[0-9;]*m/g, '');
        })
        .join(' ');

      const logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
      this.logStream.write(logEntry);
    } catch (err) {
      // Silently fail if logging fails
    }
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    let logEntry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    if (data) {
      try {
        logEntry += `\n${JSON.stringify(data, null, 2)}`;
      } catch {
        logEntry += `\n${String(data)}`;
      }
    }
    logEntry += '\n';

    if (this.logStream) {
      this.logStream.write(logEntry);
    }
  }

  logStep(step, total, description) {
    this.log('info', `Step ${step}/${total}: ${description}`);
  }

  logError(error, context = '') {
    const errorInfo = {
      message: error.message,
      stack: error.stack,
      context
    };
    this.log('error', `Error${context ? ` in ${context}` : ''}`, errorInfo);
  }

  logConfig(config) {
    // Log configuration but sanitize sensitive data
    const sanitizedConfig = { ...config };
    if (sanitizedConfig.discordToken) sanitizedConfig.discordToken = '***REDACTED***';
    if (sanitizedConfig.openaiApiKey) sanitizedConfig.openaiApiKey = '***REDACTED***';
    if (sanitizedConfig.webserverPassword) sanitizedConfig.webserverPassword = '***REDACTED***';
    if (sanitizedConfig.s3SecretAccessKey) sanitizedConfig.s3SecretAccessKey = '***REDACTED***';
    if (sanitizedConfig.locationiqApiKey) sanitizedConfig.locationiqApiKey = '***REDACTED***';
    if (sanitizedConfig.googleMapsApiKey) sanitizedConfig.googleMapsApiKey = '***REDACTED***';
    
    this.log('info', 'Installation configuration', sanitizedConfig);
  }

  logInstallationResult(result) {
    this.log('info', 'Installation result', {
      success: result.success,
      error: result.error || null,
      services: result.services || null
    });
  }

  finalize() {
    if (!this.logStream) return;

    try {
      const duration = ((Date.now() - this.startTime) / 1000).toFixed(2);
      const footer = `\n========================================
Installer completed
Duration: ${duration} seconds
Ended: ${new Date().toISOString()}
========================================\n`;
      this.logStream.write(footer);
      this.logStream.end();
      
      // Restore original console methods
      if (this.originalConsoleLog) console.log = this.originalConsoleLog;
      if (this.originalConsoleError) console.error = this.originalConsoleError;
      if (this.originalConsoleWarn) console.warn = this.originalConsoleWarn;
      
      return this.logFile;
    } catch (err) {
      console.error('Error finalizing installer log:', err.message);
      return null;
    }
  }

  getLogPath() {
    return this.logFile;
  }
}

module.exports = InstallerLogger;

