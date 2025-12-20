// api.js - API Communication Module

// Cache for API responses
const apiCache = new Map();
const CACHE_TTL = 60000; // 1 minute default TTL

/**
 * Get auth headers if available
 */
function getAuthHeaders() {
    const headers = {
        'Content-Type': 'application/json'
    };
    
    // Get session token from localStorage or global variable
    const token = window.currentSessionToken || localStorage.getItem('sessionToken');
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    
    return headers;
}

/**
 * Batch API requests together
 * @param {Array} requests - Array of {url, options, resolve, reject}
 */
function processBatch() {
    if (requestBatch.length === 0) return;
    
    const batch = [...requestBatch];
    requestBatch.length = 0;
    batchTimeout = null;
    
    // Process batch - can use Promise.all for parallel requests
    batch.forEach(({ url, options, cacheTTL, resolve, reject }) => {
        apiFetchInternal(url, options, cacheTTL)
            .then(resolve)
            .catch(reject);
    });
}

/**
 * Internal fetch implementation
 * @param {String} url - API URL
 * @param {Object} options - Fetch options
 * @param {Number} cacheTTL - Cache TTL in milliseconds (0 = no cache)
 * @returns {Promise} - Fetch promise
 */
async function apiFetchInternal(url, options = {}, cacheTTL = 0) {
    // Check cache if enabled
    if (cacheTTL > 0) {
        const cached = apiCache.get(url);
        if (cached && (Date.now() - cached.timestamp) < cacheTTL) {
            return Promise.resolve(cached.data);
        }
    }
    
    const defaultOptions = {
        headers: getAuthHeaders()
    };
    
    const mergedOptions = {
        ...defaultOptions,
        ...options,
        headers: {
            ...defaultOptions.headers,
            ...(options.headers || {})
        }
    };
    
    try {
        const response = await fetch(url, mergedOptions);
        
        // Handle non-JSON responses
        const contentType = response.headers.get('content-type');
        let data;
        
        if (contentType && contentType.includes('application/json')) {
            data = await response.json();
        } else {
            data = await response.text();
        }
        
        if (!response.ok) {
            throw new Error(data.error || data.message || `HTTP ${response.status}`);
        }
        
        // Cache if enabled
        if (cacheTTL > 0) {
            apiCache.set(url, { data, timestamp: Date.now() });
        }
        
        return data;
    } catch (error) {
        console.error(`API fetch error for ${url}:`, error);
        throw error;
    }
}

/**
 * Generic fetch wrapper with error handling, batching, and debouncing
 * @param {String} url - API URL
 * @param {Object} options - Fetch options
 * @param {Number} cacheTTL - Cache TTL in milliseconds (0 = no cache)
 * @param {Boolean} useBatch - Whether to batch this request
 * @param {Number} debounceMs - Debounce delay in milliseconds (0 = no debounce)
 * @returns {Promise} - Fetch promise
 */
async function apiFetch(url, options = {}, cacheTTL = 0, useBatch = false, debounceMs = 0) {
    // Handle debouncing
    if (debounceMs > 0) {
        const debounceKey = `${url}:${JSON.stringify(options)}`;
        if (debounceMap.has(debounceKey)) {
            clearTimeout(debounceMap.get(debounceKey));
        }
        
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                debounceMap.delete(debounceKey);
                apiFetchInternal(url, options, cacheTTL)
                    .then(resolve)
                    .catch(reject);
            }, debounceMs);
            debounceMap.set(debounceKey, timeoutId);
        });
    }
    
    // Handle batching
    if (useBatch) {
        return new Promise((resolve, reject) => {
            requestBatch.push({ url, options, cacheTTL, resolve, reject });
            
            if (!batchTimeout) {
                batchTimeout = setTimeout(processBatch, BATCH_DELAY);
            }
        });
    }
    
    // Direct fetch
    return apiFetchInternal(url, options, cacheTTL);
}

/**
 * Clear API cache
 */
function clearApiCache() {
    apiCache.clear();
}

/**
 * Reduce polling frequency when tab is inactive
 */
function setupInactivePollingReduction() {
    let isActive = true;
    let originalPollingInterval = null;
    
    document.addEventListener('visibilitychange', function() {
        isActive = !document.hidden;
        // Can adjust polling intervals here if needed
    });
    
    return {
        isActive: () => isActive,
        shouldPoll: () => isActive || document.hasFocus()
    };
}

/**
 * Clear specific cache entry
 */
function clearCacheEntry(url) {
    apiCache.delete(url);
}

// API endpoint functions

// Calls API
async function getCalls(hours) {
    return apiFetch(`/api/calls?hours=${hours}`, {}, 0, false, 300); // Debounce 300ms for rapid calls
}

async function getCallDetails(callId) {
    return apiFetch(`/api/call/${callId}/details`, {}, 30000); // 30s cache
}

// Talkgroups API
async function getTalkgroups() {
    return apiFetch('/api/talkgroups', {}, 60000); // 1min cache
}

async function getTalkgroupCalls(talkgroupId, limit = 30, offset = 0) {
    return apiFetch(`/api/talkgroup/${talkgroupId}/calls?limit=${limit}&offset=${offset}`, {}, 0);
}

async function getTalkgroupCallsSince(talkgroupId, sinceId) {
    return apiFetch(`/api/talkgroup/${talkgroupId}/calls?sinceId=${sinceId}`, {}, 0, false, 500); // Debounce polling
}

// Radio Configuration API
async function getRadioTalkgroups() {
    return apiFetch('/api/radio/talkgroups', {}, 30000);
}

async function addRadioTalkgroup(data) {
    return apiFetch('/api/radio/talkgroups', {
        method: 'POST',
        body: JSON.stringify(data)
    }, 0);
}

async function deleteRadioTalkgroup(id) {
    return apiFetch(`/api/radio/talkgroups/${id}`, {
        method: 'DELETE'
    }, 0);
}

async function getRadioFrequencies() {
    return apiFetch('/api/radio/frequencies', {}, 30000);
}

async function addRadioFrequency(data) {
    return apiFetch('/api/radio/frequencies', {
        method: 'POST',
        body: JSON.stringify(data)
    }, 0);
}

async function deleteRadioFrequency(id) {
    return apiFetch(`/api/radio/frequencies/${id}`, {
        method: 'DELETE'
    }, 0);
}

// Markers API
async function updateMarkerLocation(callId, lat, lon) {
    return apiFetch(`/api/markers/${callId}/location`, {
        method: 'PUT',
        body: JSON.stringify({ lat, lon })
    }, 0);
}

async function deleteMarker(callId) {
    return apiFetch(`/api/markers/${callId}`, {
        method: 'DELETE'
    }, 0);
}

// Categories API
async function getCategories() {
    return apiFetch('/api/categories', {}, 300000); // 5min cache
}

// System API
async function getSystemStatus() {
    return apiFetch('/api/system/status', {}, 60000);
}

async function getSystemInfo() {
    return apiFetch('/api/system/info', {}, 300000);
}

async function getGpuStatus() {
    return apiFetch('/api/system/gpu-status', {}, 60000);
}

async function configureGpu(enabled) {
    return apiFetch('/api/system/configure-gpu', {
        method: 'POST',
        body: JSON.stringify({ enabled })
    }, 0);
}

async function getAutostartStatus() {
    return apiFetch('/api/system/autostart-status', {}, 60000);
}

async function configureAutostart(enabled) {
    return apiFetch('/api/system/configure-autostart', {
        method: 'POST',
        body: JSON.stringify({ enabled })
    }, 0);
}

// Location API
async function getLocationConfig() {
    return apiFetch('/api/location/config', {}, 60000);
}

async function updateLocationConfig(data) {
    return apiFetch('/api/location/config', {
        method: 'POST',
        body: JSON.stringify(data)
    }, 0);
}

async function detectLocation(lat, lon) {
    return apiFetch('/api/location/detect', {
        method: 'POST',
        body: JSON.stringify({ lat, lon })
    }, 0);
}

// Updates API
async function checkUpdates() {
    return apiFetch('/api/updates/check', {}, 60000);
}

async function installUpdate() {
    return apiFetch('/api/updates/install', {
        method: 'POST'
    }, 0);
}

// Radio Software API
async function detectRadioSoftware() {
    return apiFetch('/api/radio/detect-software', {}, 60000);
}

async function configureTrunkRecorder(preview = false) {
    return apiFetch('/api/radio/configure-trunkrecorder', {
        method: 'POST',
        body: JSON.stringify({ preview })
    }, 0);
}

// AI Commands API
async function processAICommand(command) {
    return apiFetch('/api/ai/command', {
        method: 'POST',
        body: JSON.stringify({ command })
    }, 0);
}

async function getAICommandExamples() {
    return apiFetch('/api/ai/command-examples', {}, 300000); // 5min cache
}

// Purge API
async function getPurgeCount(params) {
    const queryString = new URLSearchParams(params).toString();
    return apiFetch(`/api/calls/purge-count?${queryString}`, {}, 0);
}

async function executePurge(data) {
    return apiFetch('/api/calls/purge', {
        method: 'POST',
        body: JSON.stringify(data)
    }, 0);
}

async function canUndoPurge() {
    return apiFetch('/api/calls/can-undo-purge', {}, 0);
}

async function undoLastPurge() {
    return apiFetch('/api/calls/undo-last-purge', {
        method: 'POST'
    }, 0);
}

// Export all functions
if (typeof window !== 'undefined') {
    window.APIModule = {
        // Core functions
        apiFetch,
        getAuthHeaders,
        clearApiCache,
        clearCacheEntry,
        
        // Calls
        getCalls,
        getCallDetails,
        
        // Talkgroups
        getTalkgroups,
        getTalkgroupCalls,
        getTalkgroupCallsSince,
        
        // Radio Config
        getRadioTalkgroups,
        addRadioTalkgroup,
        deleteRadioTalkgroup,
        getRadioFrequencies,
        addRadioFrequency,
        deleteRadioFrequency,
        
        // Markers
        updateMarkerLocation,
        deleteMarker,
        
        // Categories
        getCategories,
        
        // System
        getSystemStatus,
        getSystemInfo,
        getGpuStatus,
        configureGpu,
        getAutostartStatus,
        configureAutostart,
        
        // Location
        getLocationConfig,
        updateLocationConfig,
        detectLocation,
        
        // Updates
        checkUpdates,
        installUpdate,
        
        // Radio Software
        detectRadioSoftware,
        configureTrunkRecorder,
        
        // AI
        processAICommand,
        getAICommandExamples,
        
        // Purge
        getPurgeCount,
        executePurge,
        canUndoPurge,
        undoLastPurge
    };
}

