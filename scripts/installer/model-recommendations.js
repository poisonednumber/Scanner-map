/**
 * Model Recommendations for Different Hardware Configurations
 * Provides recommended models for Ollama and Whisper based on GPU VRAM
 */

const MODEL_RECOMMENDATIONS = {
  // Ollama models (for AI/address extraction)
  ollama: {
    '8gb': {
      recommended: 'llama3.1:8b',
      alternatives: ['mistral:7b', 'llama3.1:8b-instruct-q4_K_M'],
      description: 'Best balance of quality and speed for 8GB VRAM',
      vramUsage: '~6-7GB',
      speed: 'Fast',
      quality: 'Excellent'
    },
    '16gb': {
      recommended: 'llama3.1:70b',
      alternatives: ['llama3.1:8b', 'mistral:7b'],
      description: 'Larger models for better accuracy',
      vramUsage: '~12-14GB',
      speed: 'Medium',
      quality: 'Best'
    },
    'cpu': {
      recommended: 'llama3.1:8b',
      alternatives: ['mistral:7b', 'phi3:mini'],
      description: 'Smaller models that work on CPU',
      vramUsage: 'RAM-based',
      speed: 'Slow',
      quality: 'Good'
    }
  },
  
  // Whisper models (for transcription)
  whisper: {
    '8gb': {
      recommended: 'small',
      alternatives: ['base', 'medium'],
      description: 'Good balance of accuracy and speed for 8GB VRAM',
      vramUsage: '~2-3GB',
      speed: 'Fast',
      accuracy: 'Good'
    },
    '16gb': {
      recommended: 'medium',
      alternatives: ['small', 'large-v3'],
      description: 'Better accuracy with more VRAM',
      vramUsage: '~5-6GB',
      speed: 'Medium',
      accuracy: 'Very Good'
    },
    'cpu': {
      recommended: 'base',
      alternatives: ['tiny', 'small'],
      description: 'Smaller models for CPU-only systems',
      vramUsage: 'RAM-based',
      speed: 'Slow',
      accuracy: 'Basic'
    }
  }
};

class ModelRecommendations {
  /**
   * Get recommended Ollama model for GPU VRAM
   */
  static getOllamaModel(vramGB = 8) {
    if (vramGB >= 24) {
      // 24GB+ - can handle largest models
      return {
        recommended: 'llama3.1:70b',
        alternatives: ['llama3.1:8b', 'mistral:7b'],
        description: 'Largest models for maximum accuracy',
        vramUsage: '~12-14GB',
        speed: 'Medium',
        quality: 'Best'
      };
    } else if (vramGB >= 16) {
      return MODEL_RECOMMENDATIONS.ollama['16gb'];
    } else if (vramGB >= 12) {
      // 12GB - can handle 8b models comfortably
      return {
        recommended: 'llama3.1:8b',
        alternatives: ['mistral:7b', 'llama3.1:8b-instruct-q4_K_M'],
        description: 'Best balance for 12GB VRAM',
        vramUsage: '~6-7GB',
        speed: 'Fast',
        quality: 'Excellent'
      };
    } else if (vramGB >= 8) {
      return MODEL_RECOMMENDATIONS.ollama['8gb'];
    } else if (vramGB >= 6) {
      // 6GB - smaller quantized models
      return {
        recommended: 'mistral:7b',
        alternatives: ['llama3.1:8b-instruct-q4_K_M', 'phi3:mini'],
        description: 'Optimized for 6GB VRAM',
        vramUsage: '~4-5GB',
        speed: 'Fast',
        quality: 'Good'
      };
    } else {
      return MODEL_RECOMMENDATIONS.ollama['cpu'];
    }
  }

  /**
   * Get recommended Whisper model for GPU VRAM
   */
  static getWhisperModel(vramGB = 8) {
    if (vramGB >= 16) {
      return MODEL_RECOMMENDATIONS.whisper['16gb'];
    } else if (vramGB >= 12) {
      // 12GB - can handle medium comfortably
      return {
        recommended: 'medium',
        alternatives: ['small', 'large-v3'],
        description: 'Better accuracy with 12GB VRAM',
        vramUsage: '~5-6GB',
        speed: 'Medium',
        accuracy: 'Very Good'
      };
    } else if (vramGB >= 8) {
      return MODEL_RECOMMENDATIONS.whisper['8gb'];
    } else if (vramGB >= 6) {
      // 6GB - small model
      return {
        recommended: 'small',
        alternatives: ['base', 'medium'],
        description: 'Good for 6GB VRAM',
        vramUsage: '~2-3GB',
        speed: 'Fast',
        accuracy: 'Good'
      };
    } else if (vramGB >= 4) {
      // 4GB - base model
      return {
        recommended: 'base',
        alternatives: ['tiny', 'small'],
        description: 'Optimized for 4GB VRAM',
        vramUsage: '~1GB',
        speed: 'Fast',
        accuracy: 'Medium'
      };
    } else {
      return MODEL_RECOMMENDATIONS.whisper['cpu'];
    }
  }

  /**
   * Detect GPU VRAM (approximate)
   */
  static async detectGPUMemory() {
    try {
      const { execSync } = require('child_process');
      // Try nvidia-smi to get VRAM
      const output = execSync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits', {
        encoding: 'utf8',
        timeout: 5000
      });
      const vramMB = parseInt(output.trim());
      const vramGB = Math.round(vramMB / 1024);
      return vramGB;
    } catch (err) {
      // Can't detect, assume 8GB as default
      return 8;
    }
  }

  /**
   * Format model recommendation for display
   */
  static formatRecommendation(type, vramGB) {
    const rec = type === 'ollama' 
      ? this.getOllamaModel(vramGB)
      : this.getWhisperModel(vramGB);
    
    return {
      model: rec.recommended,
      description: rec.description,
      vramUsage: rec.vramUsage,
      speed: rec.speed,
      quality: rec.quality || rec.accuracy,
      alternatives: rec.alternatives
    };
  }
}

module.exports = ModelRecommendations;
module.exports.MODEL_RECOMMENDATIONS = MODEL_RECOMMENDATIONS;

