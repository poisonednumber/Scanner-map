/**
 * Installation Path Selector
 * Provides OS-specific default installation paths and handles file relocation
 */

const path = require('path');
const os = require('os');
const fs = require('fs-extra');

class PathSelector {
  constructor(currentPath) {
    this.currentPath = currentPath;
    this.platform = process.platform;
  }

  /**
   * Get default installation paths for current OS
   */
  getDefaultPaths() {
    const paths = [];

    if (this.platform === 'win32') {
      // Windows paths
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const userProfile = os.homedir();

      paths.push({
        name: `📁 ${path.join(localAppData, 'Scanner-Map')} (User AppData - Recommended)`,
        value: path.join(localAppData, 'Scanner-Map'),
        description: 'User-specific location, no admin rights needed'
      });

      paths.push({
        name: `📁 ${path.join(userProfile, 'Scanner-Map')} (User Home)`,
        value: path.join(userProfile, 'Scanner-Map'),
        description: 'Simple location in your home folder'
      });

      paths.push({
        name: `📁 ${path.join(programFiles, 'Scanner-Map')} (Program Files)`,
        value: path.join(programFiles, 'Scanner-Map'),
        description: 'System-wide installation (requires admin)'
      });
    } else if (this.platform === 'darwin') {
      // macOS paths
      const userHome = os.homedir();
      const applications = path.join(userHome, 'Applications');

      paths.push({
        name: `📁 ${path.join(applications, 'Scanner-Map')} (Applications - Recommended)`,
        value: path.join(applications, 'Scanner-Map'),
        description: 'Standard macOS application location'
      });

      paths.push({
        name: `📁 ${path.join(userHome, 'Scanner-Map')} (User Home)`,
        value: path.join(userHome, 'Scanner-Map'),
        description: 'Simple location in your home folder'
      });

      paths.push({
        name: `📁 /usr/local/scanner-map (System-wide)`,
        value: '/usr/local/scanner-map',
        description: 'System-wide installation (requires sudo)'
      });
    } else {
      // Linux paths
      const userHome = os.homedir();

      paths.push({
        name: `📁 ${path.join(userHome, 'scanner-map')} (User Home - Recommended)`,
        value: path.join(userHome, 'scanner-map'),
        description: 'User-specific location, no sudo needed'
      });

      paths.push({
        name: `📁 /opt/scanner-map (System-wide)`,
        value: '/opt/scanner-map',
        description: 'System-wide installation (requires sudo)'
      });

      paths.push({
        name: `📁 /usr/local/scanner-map (System-wide)`,
        value: '/usr/local/scanner-map',
        description: 'Alternative system location (requires sudo)'
      });
    }

    // Always add current directory and manual entry
    paths.push({
      name: `📁 ${this.currentPath} (Current Directory)`,
      value: this.currentPath,
      description: 'Install in the current directory (where script is running)'
    });

    paths.push({
      name: '✏️  Enter custom path',
      value: 'custom',
      description: 'Specify a custom installation path'
    });

    return paths;
  }

  /**
   * Get the recommended default path
   */
  getRecommendedPath() {
    const paths = this.getDefaultPaths();
    // First path is always the recommended one
    return paths[0].value;
  }

  /**
   * Validate and normalize a path
   */
  validatePath(inputPath) {
    try {
      // Normalize the path
      const normalized = path.normalize(inputPath);
      
      // Check if it's absolute
      if (!path.isAbsolute(normalized)) {
        return {
          valid: false,
          error: 'Path must be absolute (e.g., C:\\Program Files\\Scanner-Map or /opt/scanner-map)'
        };
      }

      // Check if parent directory exists
      const parent = path.dirname(normalized);
      if (!fs.existsSync(parent)) {
        return {
          valid: false,
          error: `Parent directory does not exist: ${parent}`
        };
      }

      return {
        valid: true,
        path: normalized
      };
    } catch (err) {
      return {
        valid: false,
        error: err.message
      };
    }
  }

  /**
   * Check if path requires elevated permissions
   */
  requiresElevation(installPath) {
    if (this.platform === 'win32') {
      // Windows: Check if path is in Program Files or requires admin
      const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
      return installPath.toLowerCase().startsWith(programFiles.toLowerCase());
    } else {
      // Linux/macOS: Check if path is system-wide
      return installPath.startsWith('/usr') || installPath.startsWith('/opt');
    }
  }

  /**
   * Move files from current location to installation path
   */
  async moveToInstallPath(installPath) {
    const chalk = require('chalk');

    // If paths are the same, no move needed
    if (path.resolve(this.currentPath) === path.resolve(installPath)) {
      return {
        success: true,
        moved: false,
        message: 'Files already in target location'
      };
    }

    try {
      console.log(chalk.blue(`\n📦 Moving installation to: ${installPath}\n`));

      // Create target directory
      await fs.ensureDir(installPath);

      // List of files/directories to copy (exclude node_modules, .git, etc.)
      const itemsToCopy = [
        'bot.js',
        'webserver.js',
        'geocoding.js',
        'import_csv.js',
        'transcribe.py',
        'tone_detect.py',
        'package.json',
        'requirements.txt',
        'Dockerfile',
        'docker-compose.yml',
        'docker-compose.full.yml',
        'public',
        'scripts',
        'docs',
        '.env.example',
        'README.md',
        'LICENSE',
        'LICENSE_NOTICE.md',
        'TRUNKRECORDER_ATTRIBUTION.md'
      ];

      // Copy files
      for (const item of itemsToCopy) {
        const sourcePath = path.join(this.currentPath, item);
        const targetPath = path.join(installPath, item);

        if (fs.existsSync(sourcePath)) {
          const stat = await fs.stat(sourcePath);
          if (stat.isDirectory()) {
            await fs.copy(sourcePath, targetPath, {
              filter: (src) => {
                // Exclude common build/cache directories
                const relative = path.relative(sourcePath, src);
                return !relative.includes('node_modules') &&
                       !relative.includes('.git') &&
                       !relative.includes('__pycache__') &&
                       !relative.includes('.venv') &&
                       !relative.includes('venv') &&
                       !relative.includes('dist') &&
                       !relative.includes('build');
              }
            });
          } else {
            await fs.copy(sourcePath, targetPath);
          }
        }
      }

      // Create necessary directories
      const dirsToCreate = [
        'appdata',
        'data',
        'audio',
        'logs',
        'models'
      ];

      for (const dir of dirsToCreate) {
        await fs.ensureDir(path.join(installPath, dir));
      }

      console.log(chalk.green(`✓ Files moved successfully to: ${installPath}\n`));

      return {
        success: true,
        moved: true,
        installPath: installPath,
        message: 'Installation moved successfully'
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        message: `Failed to move files: ${err.message}`
      };
    }
  }
}

module.exports = PathSelector;

