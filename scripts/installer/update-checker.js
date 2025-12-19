/**
 * Update Checker
 * Checks for updates from GitHub releases
 */

const https = require('https');
const { execSync } = require('child_process');
const fs = require('fs-extra');
const path = require('path');

class UpdateChecker {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.repoOwner = 'Dadud';
    this.repoName = 'Scanner-map';
  }

  /**
   * Get current version from package.json
   */
  getCurrentVersion() {
    try {
      const packageJson = require(path.join(this.projectRoot, 'package.json'));
      return packageJson.version || '0.0.0';
    } catch (err) {
      return '0.0.0';
    }
  }

  /**
   * Get latest version from GitHub releases
   */
  async getLatestVersion() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${this.repoOwner}/${this.repoName}/releases/latest`,
        headers: {
          'User-Agent': 'Scanner-Map-Installer'
        }
      };

      https.get(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const release = JSON.parse(data);
            // Extract version from tag (e.g., "v3.0.0" -> "3.0.0")
            const version = release.tag_name.replace(/^v/, '');
            resolve(version);
          } catch (err) {
            reject(new Error('Failed to parse GitHub API response'));
          }
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Compare versions (simple semver comparison)
   */
  compareVersions(current, latest) {
    const currentParts = current.split('.').map(Number);
    const latestParts = latest.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      if (latestParts[i] > currentParts[i]) {
        return 1; // Update available
      } else if (latestParts[i] < currentParts[i]) {
        return -1; // Current is newer (shouldn't happen)
      }
    }
    return 0; // Same version
  }

  /**
   * Check for updates
   */
  async checkForUpdates() {
    try {
      const current = this.getCurrentVersion();
      const latest = await this.getLatestVersion();
      const comparison = this.compareVersions(current, latest);

      if (comparison > 0) {
        return {
          updateAvailable: true,
          currentVersion: current,
          latestVersion: latest,
          downloadUrl: `https://github.com/${this.repoOwner}/${this.repoName}/releases/latest`
        };
      } else {
        return {
          updateAvailable: false,
          currentVersion: current,
          latestVersion: latest
        };
      }
    } catch (err) {
      return {
        updateAvailable: false,
        error: err.message
      };
    }
  }

  /**
   * Configure auto-update check on startup
   */
  async configureAutoUpdate(enabled) {
    try {
      const configPath = path.join(this.projectRoot, 'data', 'update-config.json');
      await fs.ensureDir(path.dirname(configPath));
      
      const config = {
        autoUpdateCheck: enabled,
        lastCheck: null,
        updateAvailable: false
      };

      await fs.writeJson(configPath, config, { spaces: 2 });
      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err.message
      };
    }
  }
}

module.exports = UpdateChecker;

