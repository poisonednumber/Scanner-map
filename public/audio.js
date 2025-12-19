// audio.js - Audio Playback Module using WaveSurfer

// Audio state
const wavesurfers = {};
let globalVolumeLevel = 0.5; // Default to 50% volume
let audioContext = null;

/**
 * Initialize WaveSurfer instance for an audio file
 * @param {String} callId - Call ID
 * @param {String} audioUrl - Audio URL
 * @param {Object} wavesurferStore - Store for WaveSurfer instances (typically wavesurfers or talkgroupModalWavesurfers)
 * @param {Function} onReadyCallback - Callback when WaveSurfer is ready
 * @param {String} containerSelector - Optional container selector
 */
function initWaveSurfer(callId, audioUrl, wavesurferStore, onReadyCallback, containerSelector = null) {
    const containerId = containerSelector ? containerSelector.replace('#', '') : `waveform-${callId}`;
    const containerElement = document.getElementById(containerId);
    
    if (!containerElement) {
        console.warn(`WaveSurfer container #${containerId} not found for callId ${callId}. Skipping init.`);
        return;
    }

    // Clean up existing instance if present
    if (wavesurferStore[callId]) {
        try {
            wavesurferStore[callId].destroy();
        } catch (e) {
            if (e.name !== 'AbortError') {
                console.warn(`Error destroying previous wavesurfer for ${callId}:`, e);
            }
        }
        delete wavesurferStore[callId];
    }

    try {
        // Create WaveSurfer instance
        wavesurferStore[callId] = WaveSurfer.create({
            container: `#${containerId}`,
            waveColor: '#00ff00',
            progressColor: '#008000',
            cursorColor: '#ffffff',
            height: containerId.startsWith('tg-') ? 25 : 30,
            normalize: true,
            backend: 'webaudio',
            volume: globalVolumeLevel,
        });

        // Load audio file
        wavesurferStore[callId].load(audioUrl);

        // Find controls container
        let controlsContainer = containerElement.closest('.talkgroup-list-item, .custom-popup');
        if (!controlsContainer) {
            controlsContainer = containerElement.parentElement.querySelector('.audio-controls') 
                ? containerElement.parentElement 
                : null;
        }
        
        if (!controlsContainer) {
            console.warn(`Could not find controls container for wavesurfer ${callId}`);
        }

        // Setup event listeners
        const wsInstance = wavesurferStore[callId];
        
        wsInstance.on('ready', function() {
            console.log(`WaveSurfer ready for callId: ${callId}`);
            if (onReadyCallback) {
                onReadyCallback();
            }
        });

        wsInstance.on('play', function() {
            const playPauseButton = controlsContainer 
                ? controlsContainer.querySelector(`.play-pause[data-call-id="${callId}"]`)
                : null;
            if (playPauseButton) {
                playPauseButton.textContent = 'Pause';
            }
        });

        wsInstance.on('pause', function() {
            const playPauseButton = controlsContainer 
                ? controlsContainer.querySelector(`.play-pause[data-call-id="${callId}"]`)
                : null;
            if (playPauseButton) {
                playPauseButton.textContent = 'Play';
            }
        });

        wsInstance.on('finish', function() {
            const playPauseButton = controlsContainer 
                ? controlsContainer.querySelector(`.play-pause[data-call-id="${callId}"]`)
                : null;
            if (playPauseButton) {
                playPauseButton.textContent = 'Play';
            }
        });

        wsInstance.on('error', function(error) {
            if (error && error.name === 'AbortError') {
                // Ignore AbortError as it's likely due to rapid cleanup/re-init
                return;
            }
            console.error(`WaveSurfer error for callId ${callId}:`, error);
        });

        // Setup play/pause button handler
        if (controlsContainer) {
            const playPauseButton = controlsContainer.querySelector(`.play-pause[data-call-id="${callId}"]`);
            if (playPauseButton) {
                playPauseButton.onclick = function() {
                    if (wsInstance.isPlaying()) {
                        wsInstance.pause();
                    } else {
                        playWaveSurferAudio(callId, wavesurferStore);
                    }
                };
            }
        }

    } catch (e) {
        console.error(`Failed to initialize WaveSurfer for callId ${callId}:`, e);
    }
}

/**
 * Play audio for a specific call ID
 * @param {String} callId - Call ID
 * @param {Object} wavesurferStore - Store for WaveSurfer instances
 * @param {Object} marker - Optional marker object
 */
function playWaveSurferAudio(callId, wavesurferStore, marker = null) {
    if (!wavesurferStore[callId]) {
        console.warn(`No WaveSurfer instance found for callId ${callId} in the provided store.`);
        return;
    }
    
    try {
        const wsInstance = wavesurferStore[callId];
        
        // Ensure the volume is set correctly before playing
        wsInstance.setVolume(globalVolumeLevel);
        console.log(`[VOLUME] Set volume for wavesurfer ${callId} to ${globalVolumeLevel} before playing`);
        
        // Ensure audio context is running (required after user interaction)
        if (wsInstance.backend && typeof wsInstance.backend.getAudioContext === 'function') {
            const audioContext = wsInstance.backend.getAudioContext();
            if (audioContext.state === 'suspended') {
                audioContext.resume().then(() => {
                    console.log('AudioContext resumed for playing');
                    wsInstance.play();
                }).catch(e => console.error('AudioContext resume failed:', e));
            } else {
                wsInstance.play();
            }
        } else {
            wsInstance.play(); // Fallback if context check fails
        }

        const controlsContainer = document.querySelector(`.talkgroup-list-item[data-call-id="${callId}"], .custom-popup`);
        if (controlsContainer) {
            const playPauseButton = controlsContainer.querySelector(`.play-pause[data-call-id="${callId}"]`);
            if (playPauseButton) {
                playPauseButton.textContent = 'Pause';
            }
        }

        if (marker) {
            marker.shouldPlayAudio = false; // Mark as played if triggered from marker
        }
        console.log(`Audio played for callId: ${callId}`);
    } catch (e) {
        console.error(`Failed to play audio for callId ${callId}:`, e);
    }
}

/**
 * Pause audio for a specific call ID
 * @param {String} callId - Call ID
 * @param {Object} wavesurferStore - Store for WaveSurfer instances
 */
function pauseWaveSurferAudio(callId, wavesurferStore) {
    if (wavesurferStore[callId]) {
        wavesurferStore[callId].pause();
    }
}

/**
 * Stop and destroy WaveSurfer instance
 * @param {String} callId - Call ID
 * @param {Object} wavesurferStore - Store for WaveSurfer instances
 */
function destroyWaveSurfer(callId, wavesurferStore) {
    if (wavesurferStore[callId]) {
        try {
            wavesurferStore[callId].destroy();
        } catch (e) {
            console.warn(`Error destroying wavesurfer for ${callId}:`, e);
        }
        delete wavesurferStore[callId];
    }
}

/**
 * Set global volume level
 * @param {Number} volume - Volume level (0.0 to 1.0)
 */
function setGlobalVolume(volume) {
    globalVolumeLevel = Math.max(0, Math.min(1, volume)); // Clamp between 0 and 1
    
    // Update all existing WaveSurfer instances
    Object.values(wavesurfers).forEach(ws => {
        if (ws && typeof ws.setVolume === 'function') {
            ws.setVolume(globalVolumeLevel);
        }
    });
}

/**
 * Get global volume level
 * @returns {Number} - Current global volume level
 */
function getGlobalVolume() {
    return globalVolumeLevel;
}

/**
 * Clean up all WaveSurfer instances in a store
 * @param {Object} wavesurferStore - Store for WaveSurfer instances
 */
function cleanupAllWaveSurfers(wavesurferStore) {
    Object.keys(wavesurferStore).forEach(callId => {
        destroyWaveSurfer(callId, wavesurferStore);
    });
}

/**
 * Preload audio for next call in queue
 * @param {String} callId - Call ID to preload
 * @param {String} audioUrl - Audio URL
 * @param {Object} wavesurferStore - Store for WaveSurfer instances
 */
function preloadAudio(callId, audioUrl, wavesurferStore) {
    // Only preload if not already loaded and not currently playing
    if (!wavesurferStore[callId]) {
        // Create hidden container for preloading
        const preloadContainer = document.createElement('div');
        preloadContainer.id = `preload-waveform-${callId}`;
        preloadContainer.style.display = 'none';
        document.body.appendChild(preloadContainer);
        
        // Initialize WaveSurfer for preloading
        initWaveSurfer(callId, audioUrl, wavesurferStore, null, `preload-waveform-${callId}`);
    }
}

// Export functions
if (typeof window !== 'undefined') {
    window.AudioModule = {
        initWaveSurfer,
        playWaveSurferAudio,
        pauseWaveSurferAudio,
        destroyWaveSurfer,
        setGlobalVolume,
        getGlobalVolume,
        cleanupAllWaveSurfers,
        getWavesurfers: () => wavesurfers
    };
}

