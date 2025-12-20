/**
 * Pre-download Whisper models for local transcription
 * Uses faster-whisper's download mechanism
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs-extra');

class WhisperDownloader {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
  }

  /**
   * Pre-download Whisper model using Python
   */
  async downloadModel(modelName, device = 'cpu') {
    const chalk = require('chalk');
    
    if (!modelName) {
      return { success: false, error: 'Model name is required' };
    }

    try {
      // Check if Python is available
      let pythonCmd = 'python3';
      try {
        require('child_process').execSync('python3 --version', { stdio: 'ignore' });
      } catch (err) {
        try {
          require('child_process').execSync('python --version', { stdio: 'ignore' });
          pythonCmd = 'python';
        } catch (err2) {
          return {
            success: false,
            error: 'Python not found. Model will be downloaded on first use.',
            skip: true
          };
        }
      }

      // Check if faster-whisper is installed
      try {
        require('child_process').execSync(`${pythonCmd} -c "import faster_whisper"`, { stdio: 'ignore' });
      } catch (err) {
        return {
          success: false,
          error: 'faster-whisper not installed. Model will be downloaded on first use.',
          skip: true
        };
      }

      // Create models directory
      const modelsDir = path.join(this.projectRoot, 'models');
      await fs.ensureDir(modelsDir);

      console.log(chalk.blue(`   Pre-downloading Whisper model: ${modelName}...`));
      console.log(chalk.gray('   This may take a few minutes on first run.\n'));

      // Use Python to pre-download the model
      const downloadScript = `
import sys
from faster_whisper import WhisperModel
import os

model_name = "${modelName}"
device = "${device}"
models_dir = "${modelsDir.replace(/\\/g, '/')}"

try:
    print(f"Downloading model {model_name}...", file=sys.stderr)
    # This will download the model if not already cached
    model = WhisperModel(
        model_name,
        device=device,
        download_root=models_dir
    )
    print(f"✓ Model {model_name} ready", file=sys.stderr)
    sys.exit(0)
except Exception as e:
    print(f"Error: {e}", file=sys.stderr)
    sys.exit(1)
`;

      const pythonProcess = spawn(pythonCmd, ['-c', downloadScript], {
        stdio: 'inherit',
        cwd: this.projectRoot,
        shell: process.platform === 'win32'
      });

      await new Promise((resolve, reject) => {
        pythonProcess.on('close', (code) => {
          if (code === 0) {
            console.log(chalk.green(`\n   ✓ Whisper model ${modelName} ready!\n`));
            resolve();
          } else {
            reject(new Error(`Model download exited with code ${code}`));
          }
        });
        pythonProcess.on('error', reject);
      });

      return { success: true };
    } catch (err) {
      // Don't fail installation if model download fails - it will download on first use
      return {
        success: false,
        error: err.message,
        skip: true,
        message: 'Model will be downloaded automatically on first transcription'
      };
    }
  }
}

module.exports = WhisperDownloader;

