/**
 * Model Recommendations for Different Hardware Configurations
 * Optimized for Public Safety: Transcription, Geolocation, and Summarization
 * Provides recommended models for Ollama, Whisper, and iCAD based on GPU VRAM
 */

const MODEL_RECOMMENDATIONS = {
  // Ollama models (for AI/address extraction, geolocation, summarization)
  // Optimized for public safety radio calls
  ollama: {
    '8gb': {
      recommended: 'llama3.1:8b',
      alternatives: ['mistral:7b', 'llama3.1:8b-instruct-q4_K_M'],
      description: 'Excellent for address extraction and call summarization. Fast responses.',
      vramUsage: '~6-7GB',
      speed: 'Fast',
      quality: 'Excellent',
      useCases: ['Address extraction', 'Call summarization', 'Geolocation parsing'],
      publicSafetyScore: 9
    },
    '16gb': {
      recommended: 'llama3.1:70b',
      alternatives: ['llama3.1:8b', 'mistral:7b', 'qwen2.5:72b'],
      description: 'Best accuracy for complex address parsing and detailed summaries',
      vramUsage: '~12-14GB',
      speed: 'Medium',
      quality: 'Best',
      useCases: ['Complex address extraction', 'Detailed call analysis', 'Multi-location parsing'],
      publicSafetyScore: 10
    },
    'cpu': {
      recommended: 'llama3.1:8b',
      alternatives: ['mistral:7b', 'phi3:mini', 'qwen2.5:3b'],
      description: 'Good for basic address extraction on CPU-only systems',
      vramUsage: 'RAM-based (~8-12GB)',
      speed: 'Slow',
      quality: 'Good',
      useCases: ['Basic address extraction', 'Simple summarization'],
      publicSafetyScore: 7
    }
  },
  
  // Whisper/faster-whisper models (for transcription)
  // Optimized for public safety radio audio (often noisy, technical terminology)
  whisper: {
    '8gb': {
      recommended: 'small',
      alternatives: ['base', 'medium'],
      description: 'Good balance for public safety audio. Handles technical terms well.',
      vramUsage: '~2-3GB',
      speed: 'Fast',
      accuracy: 'Good',
      publicSafetyScore: 8,
      bestFor: 'Real-time transcription, noisy environments'
    },
    '16gb': {
      recommended: 'medium',
      alternatives: ['small', 'large-v3'],
      description: 'Excellent accuracy for technical terminology and noisy radio audio',
      vramUsage: '~5-6GB',
      speed: 'Medium',
      accuracy: 'Very Good',
      publicSafetyScore: 9,
      bestFor: 'High-accuracy transcription, complex terminology'
    },
    '24gb+': {
      recommended: 'large-v3',
      alternatives: ['medium', 'large-v2'],
      description: 'Best accuracy for public safety. Handles accents, noise, and technical terms excellently',
      vramUsage: '~10-12GB',
      speed: 'Medium-Slow',
      accuracy: 'Excellent',
      publicSafetyScore: 10,
      bestFor: 'Maximum accuracy, complex scenarios'
    },
    'cpu': {
      recommended: 'base',
      alternatives: ['tiny', 'small'],
      description: 'Basic transcription for CPU-only systems',
      vramUsage: 'RAM-based (~2-4GB)',
      speed: 'Slow',
      accuracy: 'Basic',
      publicSafetyScore: 6,
      bestFor: 'Basic transcription needs'
    }
  },
  
  // iCAD Transcribe models (specialized for public safety)
  icad: {
    '8gb': {
      recommended: 'icad-transcribe-base',
      alternatives: ['icad-transcribe-small'],
      description: 'Specialized public safety model. Excellent for radio terminology.',
      vramUsage: '~3-4GB',
      speed: 'Fast',
      accuracy: 'Excellent (public safety optimized)',
      publicSafetyScore: 10,
      bestFor: 'Public safety radio, emergency services terminology'
    },
    '16gb': {
      recommended: 'icad-transcribe-large',
      alternatives: ['icad-transcribe-base'],
      description: 'Best public safety accuracy. Handles all emergency service terminology.',
      vramUsage: '~6-8GB',
      speed: 'Medium',
      accuracy: 'Best (public safety optimized)',
      publicSafetyScore: 10,
      bestFor: 'Maximum public safety accuracy'
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
   * Get recommended Whisper model for GPU VRAM (public safety optimized)
   */
  static getWhisperModel(vramGB = 8) {
    if (vramGB >= 24) {
      return MODEL_RECOMMENDATIONS.whisper['24gb+'];
    } else if (vramGB >= 16) {
      return MODEL_RECOMMENDATIONS.whisper['16gb'];
    } else if (vramGB >= 12) {
      // 12GB - can handle medium comfortably
      return {
        recommended: 'medium',
        alternatives: ['small', 'large-v3'],
        description: 'Better accuracy with 12GB VRAM. Good for technical terminology.',
        vramUsage: '~5-6GB',
        speed: 'Medium',
        accuracy: 'Very Good',
        publicSafetyScore: 9,
        bestFor: 'High-accuracy public safety transcription'
      };
    } else if (vramGB >= 8) {
      return MODEL_RECOMMENDATIONS.whisper['8gb'];
    } else if (vramGB >= 6) {
      // 6GB - small model
      return {
        recommended: 'small',
        alternatives: ['base', 'medium'],
        description: 'Good for 6GB VRAM. Handles public safety audio well.',
        vramUsage: '~2-3GB',
        speed: 'Fast',
        accuracy: 'Good',
        publicSafetyScore: 8,
        bestFor: 'Real-time public safety transcription'
      };
    } else if (vramGB >= 4) {
      // 4GB - base model
      return {
        recommended: 'base',
        alternatives: ['tiny', 'small'],
        description: 'Optimized for 4GB VRAM. Basic public safety support.',
        vramUsage: '~1GB',
        speed: 'Fast',
        accuracy: 'Medium',
        publicSafetyScore: 7,
        bestFor: 'Basic public safety transcription'
      };
    } else {
      return MODEL_RECOMMENDATIONS.whisper['cpu'];
    }
  }

  /**
   * Get recommended iCAD Transcribe model for GPU VRAM
   */
  static getICADModel(vramGB = 8) {
    if (vramGB >= 16) {
      return MODEL_RECOMMENDATIONS.icad['16gb'];
    } else if (vramGB >= 8) {
      return MODEL_RECOMMENDATIONS.icad['8gb'];
    } else {
      // Less than 8GB - recommend base model but warn
      return {
        recommended: 'icad-transcribe-base',
        alternatives: [],
        description: 'Minimum for iCAD. Consider upgrading GPU for better performance.',
        vramUsage: '~3-4GB',
        speed: 'Medium',
        accuracy: 'Good (public safety optimized)',
        publicSafetyScore: 9,
        bestFor: 'Public safety radio (minimum requirements)',
        warning: 'GPU with 8GB+ VRAM recommended'
      };
    }
  }

  /**
   * Get comprehensive recommendations for all services based on hardware
   * @param {number} vramGB - GPU VRAM in GB (0 for CPU-only)
   * @param {boolean} hasGPU - Whether GPU is available
   * @returns {Object} Complete recommendations for all services
   */
  static getCompleteRecommendations(vramGB = 8, hasGPU = true) {
    const recommendations = {
      hardware: {
        vramGB: vramGB || 0,
        hasGPU: hasGPU,
        type: vramGB === 0 ? 'CPU-only' : (vramGB >= 24 ? 'High-end GPU' : vramGB >= 16 ? 'Mid-high GPU' : vramGB >= 8 ? 'Mid-range GPU' : 'Entry-level GPU')
      },
      ollama: hasGPU ? this.getOllamaModel(vramGB) : this.getOllamaModel(0),
      whisper: hasGPU ? this.getWhisperModel(vramGB) : this.getWhisperModel(0),
      icad: hasGPU && vramGB >= 8 ? this.getICADModel(vramGB) : null,
      summary: {
        bestFor: vramGB >= 24 ? 'Maximum accuracy for all public safety tasks' :
                vramGB >= 16 ? 'Excellent accuracy for transcription and AI tasks' :
                vramGB >= 8 ? 'Good balance of speed and accuracy' :
                'Basic functionality, consider GPU upgrade for better performance'
      }
    };
    
    return recommendations;
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

