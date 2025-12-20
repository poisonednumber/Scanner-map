// utils.js - Utility Functions Module

/**
 * Format timestamp for display
 * @param {Number|String} timestamp - Unix timestamp or ISO string
 * @param {Object} appConfig - Application config (for timezone)
 * @returns {String} - Formatted timestamp string
 */
function formatTimestamp(timestamp, appConfig = null) {
    if (!timestamp) return 'Unknown';
    
    // Convert to Date object
    let date;
    if (typeof timestamp === 'number') {
        // Unix timestamp (seconds), convert to milliseconds
        date = new Date(timestamp * 1000);
    } else if (typeof timestamp === 'string') {
        date = new Date(timestamp);
    } else {
        date = timestamp;
    }
    
    if (isNaN(date.getTime())) {
        return 'Invalid date';
    }
    
    const now = new Date();
    const diffMs = now - date;
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    const timeZone = (appConfig && appConfig.map && appConfig.map.timeZone) || 'UTC';
    const simpleOptions = {
        timeZone: timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
    };
    const simpleTimestamp = date.toLocaleTimeString('en-US', simpleOptions);
    
    if (diffMinutes < 1) {
        return 'Just now';
    } else if (diffMinutes < 60) {
        return `${diffMinutes}m ago, ${simpleTimestamp}`;
    } else if (diffHours < 24) {
        return `${diffHours}h ago, ${simpleTimestamp}`;
    } else if (diffDays === 1) {
        return `Yesterday, ${simpleTimestamp}`;
    } else {
        const fullOptions = {
            timeZone: timeZone,
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        };
        return date.toLocaleString('en-US', fullOptions);
    }
}

/**
 * Format duration in seconds to human-readable string
 * @param {Number} seconds - Duration in seconds
 * @returns {String} - Formatted duration (e.g., "1m 30s")
 */
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0s';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

/**
 * Check if device is mobile
 * @returns {Boolean} - True if mobile device
 */
function isMobile() {
    return window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

/**
 * Debounce function calls
 * @param {Function} func - Function to debounce
 * @param {Number} wait - Wait time in milliseconds
 * @returns {Function} - Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function calls
 * @param {Function} func - Function to throttle
 * @param {Number} limit - Time limit in milliseconds
 * @returns {Function} - Throttled function
 */
function throttle(func, limit) {
    let inThrottle;
    return function(...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

/**
 * Clamp a number between min and max
 * @param {Number} value - Value to clamp
 * @param {Number} min - Minimum value
 * @param {Number} max - Maximum value
 * @returns {Number} - Clamped value
 */
function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * Generate a unique ID
 * @returns {String} - Unique ID string
 */
function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

/**
 * Deep clone an object
 * @param {*} obj - Object to clone
 * @returns {*} - Cloned object
 */
function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => deepClone(item));
    if (typeof obj === 'object') {
        const cloned = {};
        Object.keys(obj).forEach(key => {
            cloned[key] = deepClone(obj[key]);
        });
        return cloned;
    }
}

/**
 * Escape HTML to prevent XSS
 * @param {String} text - Text to escape
 * @returns {String} - Escaped HTML
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

// Export functions
if (typeof window !== 'undefined') {
    window.UtilsModule = {
        formatTimestamp,
        formatDuration,
        isMobile,
        debounce,
        throttle,
        clamp,
        generateId,
        deepClone,
        escapeHtml
    };
}

