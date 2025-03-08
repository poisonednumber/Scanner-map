// app.js

// Global variables
let map, markerGroups;
const markers = {};
const allMarkers = {}; // Store all markers for filtering
let timeRangeHours = 12; // Default time range
let currentMapMode = 'day'; // Possible values: 'day', 'night', 'satellite'
let dayLayer, nightLayer, satelliteLayer; // Declare layers globally
let socket; // Socket.IO
let isNewCallAudioMuted = false;
let currentSearchTerm = ''; // Current search term
const wavesurfers = {}; // Store WaveSurfer instances
let audioContext;
let heatmapLayer; // Heatmap layer
let heatmapIntensity = 5; // Default intensity for heatmap
let toggleModeButton; // Button to toggle map modes
let liveAudioStream = null;
let isLiveStreamPlaying = false;
let audioContainer = null;
let currentSessionToken = null;

// Animation Queue Variables
const animationQueue = [];
let isAnimating = false;
const houseIcon = L.icon({
    iconUrl: 'house.png',  // Make sure this image exists on your server
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
});
// Custom icons
const pdIcon = L.icon({
    iconUrl: 'pd.png',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
});

const fireIcon = L.icon({
    iconUrl: 'fire.png',
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
});

const defaultIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
});
function addPermanentHouseMarkers() {
    // Array of house locations - just coordinates
    const houseLocations = [
        { lat: 39.078635, lng: -76.932249 },
        // Add more locations as needed
        // { lat: 38.9907, lng: -77.0261 },
    ];

    // Create a separate layer group for permanent markers
    const houseMarkersGroup = L.layerGroup();

    // Add each house to the map
    houseLocations.forEach(location => {
        // Create marker
        const marker = L.marker([location.lat, location.lng], { 
            icon: houseIcon,
            zIndexOffset: 1000,  // Ensure houses appear above other markers
            interactive: false   // This makes the marker non-interactive (no click events)
        });
        
        // Add the marker to the permanent layer group
        houseMarkersGroup.addLayer(marker);
    });

    // Add the permanent markers layer to the map
    map.addLayer(houseMarkersGroup);
    
    // Store the layer group in a global variable to avoid it being garbage collected
    window.houseMarkersGroup = houseMarkersGroup;
}
function setupTimeFilter() {
    const timeFilterSelect = document.getElementById('time-filter');
    timeFilterSelect.addEventListener('change', handleTimeFilterChange);
}

function handleTimeFilterChange(event) {
    const selectedValue = event.target.value;
    if (selectedValue === 'custom') {
        showCustomTimeModal();
    } else {
        timeRangeHours = parseInt(selectedValue, 10);
        console.log(`Time range changed to ${timeRangeHours} hours`);
        loadCalls(timeRangeHours);
    }
}

function showCustomTimeModal() {
    const modal = document.getElementById('custom-time-modal');
    modal.style.display = 'block';
}

function setupLiveStreamButton() {
    const liveStreamButton = document.createElement('button');
    liveStreamButton.id = 'live-stream-button';
    liveStreamButton.textContent = 'Listen Live';
    liveStreamButton.className = 'cyberpunk-button';
    
    // Insert the button after the toggle mode button
    const toggleModeButton = document.getElementById('toggle-mode');
    if (toggleModeButton && toggleModeButton.parentNode) {
        toggleModeButton.parentNode.insertBefore(liveStreamButton, toggleModeButton.nextSibling);
    }
    
    // Create hidden audio container
    audioContainer = document.createElement('div');
    audioContainer.id = 'audio-container';
    audioContainer.style.display = 'none';
    document.body.appendChild(audioContainer);
    
    liveStreamButton.addEventListener('click', toggleLiveStream);
}

function toggleLiveStream() {
    const button = document.getElementById('live-stream-button');
    
    if (!isLiveStreamPlaying) {
        // Start playing
        audioContainer.innerHTML = `
            <audio id="live-stream-audio" autoplay>
                <source src="http://alex11226.ddns.net:666" type="audio/mp3">
                <source src="http://alex11226.ddns.net:666" type="audio/mpeg">
                <source src="http://alex11226.ddns.net:666" type="application/x-mpegURL">
            </audio>
        `;
        
        const audioElement = document.getElementById('live-stream-audio');
        
        audioElement.addEventListener('playing', () => {
            isLiveStreamPlaying = true;
            button.textContent = 'Stop Live';
            button.classList.add('playing');
        });
        
        audioElement.addEventListener('error', (e) => {
            console.error('Error playing live stream:', e);
            createStreamIframe();
        });
        
    } else {
        stopStream();
    }
}

function createStreamIframe() {
    // Remove any existing audio elements
    audioContainer.innerHTML = '';
    
    // Create iframe for audio stream
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = 'about:blank';
    audioContainer.appendChild(iframe);
    
    // Write audio player directly into iframe
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
    iframeDoc.open();
    iframeDoc.write(`
        <!DOCTYPE html>
        <html>
        <body>
            <audio autoplay controls>
                <source src="http://alex11226.ddns.net:666" type="audio/mp3">
                <source src="http://alex11226.ddns.net:666" type="audio/mpeg">
                <source src="http://alex11226.ddns.net:666" type="application/x-mpegURL">
            </audio>
            <script>
                const audio = document.querySelector('audio');
                audio.addEventListener('playing', () => {
                    window.parent.postMessage('playing', '*');
                });
                audio.addEventListener('error', () => {
                    window.parent.postMessage('error', '*');
                });
            </script>
        </body>
        </html>
    `);
    iframeDoc.close();
    
    // Listen for messages from iframe
    window.addEventListener('message', (event) => {
        const button = document.getElementById('live-stream-button');
        if (event.data === 'playing') {
            isLiveStreamPlaying = true;
            button.textContent = 'Stop Live';
            button.classList.add('playing');
        } else if (event.data === 'error') {
            console.error('Error playing stream in iframe');
            stopStream();
            showStreamError();
        }
    });
}

function stopStream() {
    const button = document.getElementById('live-stream-button');
    audioContainer.innerHTML = ''; // Remove all audio elements
    isLiveStreamPlaying = false;
    button.textContent = 'Listen Live';
    button.classList.remove('playing');
}

function showStreamError() {
    const errorModal = document.createElement('div');
    errorModal.className = 'stream-warning-modal modal';
    errorModal.innerHTML = `
        <div class="modal-content">
            <h2>Stream Error</h2>
            <p>Unable to play the live stream. This may be due to browser security settings blocking non-HTTPS content.</p>
            <div class="modal-buttons">
                <button id="close-error">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(errorModal);
    
    document.getElementById('close-error').addEventListener('click', () => {
        errorModal.remove();
    });
    
    errorModal.style.display = 'block';
}

function applyCustomTimeFilter() {
    const startDate = document.getElementById('custom-start-date').value;
    const startTime = document.getElementById('custom-start-time').value;
    const endDate = document.getElementById('custom-end-date').value;
    const endTime = document.getElementById('custom-end-time').value;

    const start = new Date(`${startDate}T${startTime}:00Z`); // Ensure UTC
    const end = new Date(`${endDate}T${endTime}:00Z`); // Ensure UTC

    if (start && end && start < end) {
        const diffHours = (end - start) / (1000 * 60 * 60);
        timeRangeHours = diffHours;
        applyFilters();
        document.getElementById('custom-time-modal').style.display = 'none';
    } else {
        alert('Please enter valid start and end times.');
    }
}

// Initialize audio context
function initAudioContext() {
    document.body.addEventListener('click', () => {
        // Get all active WaveSurfer instances
        Object.values(wavesurfers).forEach(ws => {
            if (ws && ws.backend && typeof ws.backend.getAudioContext === 'function') {
                const audioContext = ws.backend.getAudioContext();
                if (audioContext && audioContext.state === 'suspended') {
                    audioContext.resume().catch(err => 
                        console.warn('Error resuming AudioContext:', err)
                    );
                }
            }
        });
    }, { once: true });
}

// Attempt to enable audio autoplay with a shorter, more compatible silent audio
function attemptAutoplay() {
    // Create a silent audio context instead of using an Audio element
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        
        // Set gain to 0 to make it silent
        gain.gain.value = 0;
        
        // Connect nodes
        oscillator.connect(gain);
        gain.connect(context.destination);
        
        // Start and stop quickly
        oscillator.start(0);
        oscillator.stop(0.001);
        
        console.log("Autoplay enabled via AudioContext");
    } catch (error) {
        console.warn("Autoplay setup failed:", error);
    }
}

// Initialize map
function initMap() {
    map = L.map('map', {
        center: [39.078635, -76.932249], // Longview, TX coordinates
        zoom: 13,
        maxZoom: 18,
        minZoom: 9,
        zoomControl: !isMobile(),
        tap: false
    });

    // Day layer using OpenStreetMap
    dayLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; Scanner Map V1.5',
        maxZoom: 18,
        crossOrigin: true
    });

    // Add CSS for dark mode tiles
    const style = document.createElement('style');
    style.textContent = `
        .dark-mode-tiles {
            filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%);
        }
        .dark-mode-tiles img {
            background: #0e1216;
        }
        
        /* Preserve marker colors */
        .leaflet-marker-icon,
        .leaflet-marker-shadow,
        .marker-cluster-small,
        .marker-cluster-medium,
        .marker-cluster-large {
            filter: none !important;
        }
    `;
    document.head.appendChild(style);

    // Night layer using filtered OpenStreetMap
    nightLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; Scanner Map V1.5',
        maxZoom: 18,
        crossOrigin: true,
        className: 'dark-mode-tiles'
    });

    // Satellite view using two layers combined
    const satelliteBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Imagery &copy; Esri &copy; Scanner Map V1.5',
        maxZoom: 18,
        crossOrigin: true
    });

    const satelliteLabels = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: 18,
        crossOrigin: true
    });

    satelliteLayer = L.layerGroup([satelliteBase, satelliteLabels]);

    dayLayer.addTo(map);

    markerGroups = L.markerClusterGroup({
        iconCreateFunction: function(cluster) {
            const childCount = cluster.getChildCount();
            let c = ' marker-cluster-';
            if (childCount < 10) {
                c += 'small';
            } else if (childCount < 100) {
                c += 'medium';
            } else {
                c += 'large';
            }

            return L.divIcon({
                html: '<div><span>' + childCount + '</span></div>',
                className: 'marker-cluster' + c,
                iconSize: L.point(40, 40)
            });
        },
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: true,
        zoomToBoundsOnClick: true,
        maxClusterRadius: 55,
        spiderfyDistanceMultiplier: 2
    });

    map.addLayer(markerGroups);

    if (isMobile()) {
        L.control.zoom({ position: 'bottomright' }).addTo(map);
    }

    setupEventListeners();
    L.control.scale().addTo(map);
    loadCalls(timeRangeHours);

    map.on('zoomend', function() {
        console.log('Current zoom level:', map.getZoom());
	addPermanentHouseMarkers();	
    });
}

// Event Listeners Setup
function setupEventListeners() {
    toggleModeButton = document.getElementById('toggle-mode');
    if (toggleModeButton) {
        toggleModeButton.addEventListener('click', toggleMapMode);
        toggleModeButton.textContent = 'Switch to Night Mode'; // Assuming starting in day mode
    } else {
        console.error('Toggle mode button not found');
    }

    window.addEventListener('resize', handleWindowResize);

    // Add event listener for "Get More Info" buttons using event delegation
    document.addEventListener('click', function(event) {
        if (event.target.classList.contains('get-more-info')) {
            handleGetMoreInfo(event);
        }
    });
}

// Toggle Map Mode (Day, Night, Satellite)
function toggleMapMode() {
    if (currentMapMode === 'day') {
        map.removeLayer(dayLayer);
        nightLayer.addTo(map);
        currentMapMode = 'night';
        toggleModeButton.textContent = 'Switch to Satellite Mode';
    } else if (currentMapMode === 'night') {
        map.removeLayer(nightLayer);
        satelliteLayer.addTo(map);
        currentMapMode = 'satellite';
        toggleModeButton.textContent = 'Switch to Day Mode';
    } else if (currentMapMode === 'satellite') {
        map.removeLayer(satelliteLayer);
        dayLayer.addTo(map);
        currentMapMode = 'day';
        toggleModeButton.textContent = 'Switch to Night Mode';
    }
}

// Setup Calls and Socket.IO Updates
function setupCallsAndUpdates() {
    loadCalls(timeRangeHours);
    initializeSocketIO();
}

// Initialize Socket.IO
function initializeSocketIO() {
    socket = io();

    socket.on('connect', () => console.log('Connected to Socket.IO server.'));
    socket.on('disconnect', () => console.log('Disconnected from Socket.IO server.'));

    socket.onAny((eventName, ...args) => {
        console.log(`Received event "${eventName}":`, args);
    });

    socket.on('newCall', handleNewCall);
    socket.on('error', (error) => console.error('Socket.IO Error:', error));
    socket.on('serverMessage', (message) => console.log('Server message:', message));
    socket.on('pong', () => console.log('Received pong from server'));

    socket.io.on('reconnect_attempt', () => console.log('Attempting to reconnect to Socket.IO server...'));
    socket.io.on('reconnect', handleReconnect);
    socket.io.on('reconnect_error', (error) => console.error('Failed to reconnect to Socket.IO server:', error));

    setInterval(() => {
        if (socket.connected) socket.emit('ping');
    }, 30000);
}

// Handle Reconnect Event
function handleReconnect() {
    console.log('Reconnected to Socket.IO server.');
    // If there were any actions to re-establish after reconnect, handle them here
}

// Handle New Call Event
function handleNewCall(call) {
    console.log('Received newCall event:', call);

    if (markers[call.id]) {
        console.log(`Call ID ${call.id} already exists. Skipping.`);
        return;
    }

    if (isValidCall(call)) {
        const callTimestamp = new Date(call.timestamp);
        const sinceTimestamp = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000);

        if (callTimestamp >= sinceTimestamp) {
            const added = addMarker(call, true);
            if (added) {
                console.log('New marker added for call:', call.id);
                const marker = markers[call.id];
                if (marker) {
                    showNewCallBanner(call.talk_group_name || 'Unknown Talk Group');
                    enqueueAnimation(marker, () => {
                        handleMarkerVisibility(marker);
                    });
                    playNewCallSound();
                }
            }
        }
    } else {
        console.warn('Invalid call data received:', call);
    }
}

// Function to show the new call banner
function showNewCallBanner(talkGroup) {
    const banner = document.getElementById('new-call-banner');
    const talkGroupSpan = document.getElementById('talkgroup-name');
    
    talkGroupSpan.textContent = talkGroup;
    banner.classList.remove('hidden');
    
    setTimeout(() => {
        banner.classList.add('hidden');
    }, 4000);
}

// Add Marker to Map
function addMarker(call, isNew = false) {
    console.log('Adding marker for call:', call);
    if (isValidCall(call)) {
        const icon = getMarkerIcon(call.talk_group_name, call.talk_group_id, call.audio_file_path);
        console.log('Icon assigned:', icon);
        const marker = L.marker([call.lat, call.lon], { icon: icon });
        
        // Create popup content container
        const popupContent = document.createElement('div');
        popupContent.className = 'custom-popup';
        
        // Create top container that holds links and timestamp
        const topContainer = document.createElement('div');
        topContainer.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            width: 100%;
            padding-bottom: 8px;
            margin-bottom: 6px;
        `;

        // Create links container (left side)
        const topLinksContainer = document.createElement('div');
        topLinksContainer.style.cssText = 'display: flex; gap: 6px;';

        // Create street view link
        const streetViewLink = document.createElement('a');
        streetViewLink.href = `https://www.google.com/maps?layer=c&cbll=${call.lat},${call.lon}`;
        streetViewLink.target = '_blank';
        streetViewLink.className = 'street-view-link';
        streetViewLink.innerHTML = 'Street View';
        streetViewLink.style.cssText = `
            color: #00ff00;
            text-decoration: none;
            font-size: 11px;
            padding: 2px 4px;
            background-color: #003300;
            border: 1px solid #00ff00;
            border-radius: 4px;
            transition: all 0.3s;
            display: inline-block;
            text-align: center;
            min-width: 60px;
            font-family: 'Share Tech Mono', monospace;
        `;

        // Create correction link
        const correctionLink = document.createElement('a');
        correctionLink.href = '#';
        correctionLink.className = 'correction-link';
        correctionLink.textContent = 'Edit Marker';
        correctionLink.style.cssText = `
            color: #00ff00;
            text-decoration: none;
            font-size: 11px;
            padding: 2px 4px;
            background-color: #003300;
            border: 1px solid #00ff00;
            border-radius: 4px;
            transition: all 0.3s;
            display: inline-block;
            text-align: center;
            min-width: 60px;
            font-family: 'Share Tech Mono', monospace;
        `;
        correctionLink.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showCorrectionModal(call.id, marker);
        });

        // Create timestamp container (right side)
        const timestampContainer = document.createElement('div');
        timestampContainer.style.cssText = 'text-align: right; font-size: 12px; opacity: 0.8;';
        timestampContainer.innerHTML = `<small>${formatTimestamp(call.timestamp)}</small>`;

        // Add links to the left container
        topLinksContainer.appendChild(streetViewLink);
        topLinksContainer.appendChild(correctionLink);

        // Add both containers to the top container
        topContainer.appendChild(topLinksContainer);
        topContainer.appendChild(timestampContainer);

        // Add the top container to the popup content
        popupContent.appendChild(topContainer);

        // Add the main content
        const contentWrapper = document.createElement('div');
        contentWrapper.innerHTML = `
            <b>${call.talk_group_name || 'Unknown Talk Group'}</b><br>
            ${call.transcription || 'No transcription available.'}<br>
            <div id="waveform-${call.id}" class="waveform"></div>
            <div class="audio-controls">
                <button class="play-pause" data-call-id="${call.id}" aria-label="Play audio for call ${call.id}">Play</button>
                <button class="get-more-info" data-call-id="${call.id}" data-skip="0">More Info</button>
                <input type="range" class="volume" min="0" max="1" step="0.1" value="1" data-call-id="${call.id}" aria-label="Volume control for call ${call.id}">
            </div>
            <div class="additional-info"></div>
        `;
        popupContent.appendChild(contentWrapper);

        // Bind popup with content
        marker.bindPopup(popupContent);
        
        if (isNew) {
            marker.shouldPlayAudio = true;
            console.log(`Marker for callId ${call.id} flagged to play audio on popup open.`);
        }
        
        // Handle popup open event
        marker.on('popupopen', function() {
            console.log(`Popup opened for callId: ${call.id}`);
            initWaveSurfer(call.id, `/audio/${call.audio_id}`, () => {
                if (!isNewCallAudioMuted && this.shouldPlayAudio) {
                    const wavesurferInstance = wavesurfers[call.id];

                    if (wavesurferInstance && wavesurferInstance.backend && typeof wavesurferInstance.backend.getAudioContext === 'function') {
                        const audioContext = wavesurferInstance.backend.getAudioContext();

                        if (audioContext.state === 'suspended') {
                            audioContext.resume().then(() => {
                                console.log('AudioContext resumed');
                                playWaveSurferAudio(call.id, this);
                            }).catch(e => {
                                console.error('AudioContext resume failed:', e);
                                playWaveSurferAudio(call.id, this);
                            });
                        } else {
                            playWaveSurferAudio(call.id, this);
                        }
                    } else {
                        console.warn('WaveSurfer instance or backend or getAudioContext not available; proceeding without resuming AudioContext.');
                        playWaveSurferAudio(call.id, this);
                    }
                }
            });
        });
        
        // Handle popup close event
        marker.on('popupclose', function() {
            if (wavesurfers[call.id]) {
                wavesurfers[call.id].pause();
                const playPauseButton = document.querySelector(`.play-pause[data-call-id="${call.id}"]`);
                if (playPauseButton) {
                    playPauseButton.textContent = 'Play';
                }
            }
        });
        
        markerGroups.addLayer(marker);
        markers[call.id] = marker;
        allMarkers[call.id] = { 
            marker: marker, 
            transcription: call.transcription.toLowerCase(), 
            timestamp: call.timestamp,
            visible: true
        };

        // Update heatmap if active
        if (document.getElementById('enable-heatmap').checked) {
            updateHeatmap();
        }

        return true;
    } else {
        console.warn('Invalid call data:', call);
        return false;
    }
}

function showCorrectionModal(callId, marker) {
  const modal = document.createElement('div');
  modal.className = 'modal correction-modal';
  modal.innerHTML = `
    <div class="modal-content bg-gray-800 text-white p-4 rounded-lg shadow-lg">
      <h2 class="text-xl mb-4">Marker Correction Options</h2>
      <div class="flex flex-col space-y-4">
        <button id="delete-marker" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded">
          Delete Marker
        </button>
        <button id="relocate-marker" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
          Correct Location
        </button>
        <button id="cancel-correction" class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded">
          Cancel
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Handle delete
  document.getElementById('delete-marker').addEventListener('click', () => {
    if (confirm('Are you sure you want to delete this marker? This action cannot be undone.')) {
      deleteMarker(callId, marker, modal);
    }
  });

  // Handle relocate
  document.getElementById('relocate-marker').addEventListener('click', () => {
    startMarkerRelocation(callId, marker, modal);
  });

  // Handle cancel
  document.getElementById('cancel-correction').addEventListener('click', () => {
    modal.remove();
  });
}

function deleteMarker(callId, marker, modal) {
  fetch(`/api/markers/${callId}`, {
    method: 'DELETE'
  })
  .then(response => response.json())
  .then(data => {
    markerGroups.removeLayer(marker);
    delete markers[callId];
    delete allMarkers[callId];
    modal.remove();
    
    // Show success notification
    showNotification('Marker deleted successfully', 'success');
    
    // Update heatmap if active
    if (document.getElementById('enable-heatmap').checked) {
      updateHeatmap();
    }
  })
  .catch(error => {
    console.error('Error deleting marker:', error);
    showNotification('Error deleting marker', 'error');
  });
}

function startMarkerRelocation(callId, originalMarker, modal) {
  modal.remove();
  
  // Remove original marker from map temporarily
  markerGroups.removeLayer(originalMarker);

  // Create a draggable preview marker with pulsing effect
  const previewIcon = L.divIcon({
    className: 'preview-marker',
    html: `<div class="marker-pulse" style="
      width: 20px;
      height: 20px;
      background: rgba(0, 255, 0, 0.6);
      border: 2px solid #00ff00;
      border-radius: 50%;
      animation: pulse 1.5s infinite;
    "></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10]
  });

  const previewMarker = L.marker(originalMarker.getLatLng(), {
    icon: previewIcon,
    draggable: true,
    opacity: 1
  }).addTo(map);

  // Add CSS for pulsing animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(0, 255, 0, 0.7);
      }
      70% {
        box-shadow: 0 0 0 15px rgba(0, 255, 0, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(0, 255, 0, 0);
      }
    }
    .preview-marker {
      cursor: move;
    }
    .marker-pulse {
      transition: transform 0.2s;
    }
    .preview-marker:hover .marker-pulse {
      transform: scale(1.2);
    }
  `;
  document.head.appendChild(style);

  // Show instruction banner
  const banner = document.createElement('div');
  banner.className = 'relocation-banner';
  banner.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background-color: rgba(0, 0, 0, 0.9);
    color: #00ff00;
    padding: 15px;
    text-align: center;
    z-index: 2000;
    font-family: 'Share Tech Mono', monospace;
    border-bottom: 2px solid #00ff00;
    box-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
  `;

  banner.innerHTML = `
    <div style="margin-bottom: 10px;">
      <strong>🎯 Relocate Marker</strong><br>
      <span style="font-size: 0.9em;">
        <span class="ellipsis" style="color: #00ff00;">Drag the pulsing marker or click anywhere on the map to set new location</span>
      </span>
    </div>
    <div style="display: flex; justify-content: center; gap: 10px;">
      <button id="confirm-location" style="
        background-color: #003300;
        color: #00ff00;
        border: 1px solid #00ff00;
        padding: 8px 16px;
        cursor: pointer;
        border-radius: 4px;
        font-family: 'Share Tech Mono', monospace;
      ">Confirm New Location</button>
      <button id="cancel-relocation" style="
        background-color: #330000;
        color: #ff0000;
        border: 1px solid #ff0000;
        padding: 8px 16px;
        cursor: pointer;
        border-radius: 4px;
        font-family: 'Share Tech Mono', monospace;
      ">Cancel</button>
    </div>
  `;

  document.body.appendChild(banner);

  // Keep map dragging enabled but highlight draggable marker
  previewMarker.on('mouseover', function() {
    this.getElement().style.cursor = 'move';
  });

  previewMarker.on('mouseout', function() {
    this.getElement().style.cursor = '';
  });

  // Store current location
  let newLocation = previewMarker.getLatLng();

  // Update location when marker is dragged
  previewMarker.on('dragstart', () => {
    banner.querySelector('span.ellipsis').textContent = 'Release to set new location...';
  });

  previewMarker.on('dragend', (e) => {
    newLocation = e.target.getLatLng();
    banner.querySelector('span.ellipsis').textContent = 'Drag the pulsing marker or click anywhere on the map to set new location';
  });

  // Update location when map is clicked
  function handleMapClick(e) {
    newLocation = e.latlng;
    previewMarker.setLatLng(newLocation);
  }
  map.on('click', handleMapClick);

  // Handle confirmation
  document.getElementById('confirm-location').addEventListener('click', () => {
    const confirmButton = document.getElementById('confirm-location');
    confirmButton.textContent = 'Updating...';
    confirmButton.style.opacity = '0.5';
    confirmButton.disabled = true;

    fetch(`/api/markers/${callId}/location`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        lat: newLocation.lat, 
        lon: newLocation.lng 
      })
    })
    .then(response => response.json())
    .then(data => {
      // Update original marker position
      originalMarker.setLatLng(newLocation);
      markerGroups.addLayer(originalMarker);
      
      // Clean up
      map.removeLayer(previewMarker);
      banner.remove();
      style.remove();
      map.off('click', handleMapClick);
      
      showNotification('Marker location updated successfully', 'success');
      
      if (document.getElementById('enable-heatmap').checked) {
        updateHeatmap();
      }
    })
    .catch(error => {
      console.error('Error updating marker location:', error);
      showNotification('Error updating marker location', 'error');
      markerGroups.addLayer(originalMarker);
    })
    .finally(() => {
      map.removeLayer(previewMarker);
      banner.remove();
      style.remove();
      map.off('click', handleMapClick);
    });
  });

  // Handle cancellation
  document.getElementById('cancel-relocation').addEventListener('click', () => {
    map.removeLayer(previewMarker);
    banner.remove();
    style.remove();
    map.off('click', handleMapClick);
    markerGroups.addLayer(originalMarker);
  });
}

// Initialize WaveSurfer
function initWaveSurfer(callId, audioUrl, onReadyCallback) {
    if (wavesurfers[callId]) {
        wavesurfers[callId].destroy();
        delete wavesurfers[callId];
    }

    wavesurfers[callId] = WaveSurfer.create({
        container: `#waveform-${callId}`,
        waveColor: '#00ff00',
        progressColor: '#008000',
        cursorColor: '#ffffff',
        height: 30,
        normalize: true,
        backend: 'webaudio', // Use 'webaudio' backend in v7
    });

    wavesurfers[callId].load(audioUrl);

    const playPauseButton = document.querySelector(`.play-pause[data-call-id="${callId}"]`);
    if (playPauseButton) {
        playPauseButton.replaceWith(playPauseButton.cloneNode(true));
    }

    const newPlayPauseButton = document.querySelector(`.play-pause[data-call-id="${callId}"]`);
    if (newPlayPauseButton) {
        newPlayPauseButton.addEventListener('click', function() {
            if (wavesurfers[callId].isPlaying()) {
                wavesurfers[callId].pause();
                this.textContent = 'Play';
            } else {
                wavesurfers[callId].play();
                this.textContent = 'Pause';
            }
        });
    }

    const volumeControl = document.querySelector(`input[type="range"][data-call-id="${callId}"]`);
    if (volumeControl) {
        volumeControl.replaceWith(volumeControl.cloneNode(true));
    }

    const newVolumeControl = document.querySelector(`input[type="range"][data-call-id="${callId}"]`);
    if (newVolumeControl) {
        newVolumeControl.addEventListener('input', function(e) {
            wavesurfers[callId].setVolume(e.target.value);
        });
    }

    wavesurfers[callId].on('ready', function() {
        console.log(`WaveSurfer for callId ${callId} is ready.`);
        if (onReadyCallback) onReadyCallback();
    });

    wavesurfers[callId].on('finish', function() {
        if (playPauseButton) {
            playPauseButton.textContent = 'Play';
        }
    });

    wavesurfers[callId].on('error', function(error) {
        console.error(`WaveSurfer error for callId ${callId}:`, error);
    });
}

function playWaveSurferAudio(callId, marker) {
    try {
        wavesurfers[callId].play();
        const playPauseButton = document.querySelector(`.play-pause[data-call-id="${callId}"]`);
        if (playPauseButton) {
            playPauseButton.textContent = 'Pause';
        }
        marker.shouldPlayAudio = false;
        console.log(`Audio played for callId: ${callId}`);
    } catch (e) {
        console.error(`Failed to play audio for callId ${callId}:`, e);
    }
}

// Handle "Get More Info" Button Click
function handleGetMoreInfo(event) {
    // Prevent default behavior if necessary
    event.preventDefault();

    const button = event.target;
    const callId = button.getAttribute('data-call-id');
    const skip = parseInt(button.getAttribute('data-skip'), 10);
    const additionalInfoDiv = button.closest('.custom-popup').querySelector('.additional-info');
    getAdditionalTranscriptions(callId, skip, additionalInfoDiv, button);
}

// Utility Functions
function showNotification(message, type = 'success') {
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background-color: ${type === 'success' ? 'var(--hover-color)' : '#330000'};
    color: ${type === 'success' ? 'var(--text-color)' : '#ff0000'};
    border: 1px solid ${type === 'success' ? 'var(--border-color)' : '#ff0000'};
    padding: 15px 20px;
    border-radius: 4px;
    font-family: 'Share Tech Mono', monospace;
    z-index: 2000;
    box-shadow: 0 0 10px ${type === 'success' ? 'rgba(0, 255, 0, 0.3)' : 'rgba(255, 0, 0, 0.3)'};
    animation: notificationSlideIn 0.3s ease-out;
  `;
  
  notification.innerHTML = `
    <div class="flex items-center">
      <span style="margin-right: 8px;">${type === 'success' ? '✓' : '✕'}</span>
      <span>${message}</span>
    </div>
  `;
  
  document.body.appendChild(notification);
  
  // Remove notification after 3 seconds with fade out animation
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100%)';
    notification.style.transition = 'all 0.3s ease-out';
    
    setTimeout(() => {
      notification.remove();
    }, 300);
  }, 3000);
}
// Check if device is mobile
function isMobile() {
    return window.innerWidth <= 768;
}

// Disable map interactions on mobile
function disableMobileMapInteractions() {
    // Keep all touch-based interactions enabled
    map.dragging.enable();
    map.touchZoom.enable();
    map.doubleClickZoom.enable();  // Keep double tap zoom enabled
    
    // Only disable non-touch interactions
    map.boxZoom.disable();
    map.keyboard.disable();
}

// Enable map interactions on desktop
function enableMobileMapInteractions() {
    map.dragging.enable();
    map.touchZoom.enable();
    map.doubleClickZoom.enable();
    map.scrollWheelZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
}

// Handle window resize
function handleWindowResize() {
    if (isMobile()) {
        disableMobileMapInteractions();
    } else {
        enableMobileMapInteractions();
    }
}

// Validate Call Data
function isValidCall(call) {
    const lat = parseFloat(call.lat);
    const lon = parseFloat(call.lon);
    const isValid = (
        call &&
        !isNaN(lat) &&
        !isNaN(lon) &&
        lat >= -90 && lat <= 90 &&
        lon >= -180 && lon <= 180 &&
        call.audio_file_path &&
        call.transcription
    );
    if (!isValid) {
        console.log('Invalid call:', call);
    }
    return isValid;
}

// Get Marker Icon Based on Call Data
function getMarkerIcon(talkGroupName, talkGroupId, audioFilePath) {
    console.log('getMarkerIcon input:', { talkGroupName, talkGroupId, audioFilePath });

    talkGroupName = talkGroupName || '';
    audioFilePath = audioFilePath || '';

    if (audioFilePath.includes('Gladewater_Fire')) {
        return fireIcon;
    }

    if (audioFilePath.includes('Gladewater_PD')) {
        return pdIcon;
    }

    if (talkGroupName === 'TXDPS Tyler 1' ||
        talkGroupName.includes('MCPD') || 
        talkGroupName.includes('Police') || 
        talkGroupName === 'Gregg SO Disp 1' ||
		talkGroupName === 'Gregg SO Disp 2' ||
        talkGroupName.includes('TXDPS')) {
        return pdIcon;
    }

    if (talkGroupName.includes('MCFR') || talkGroupName.includes('Fire')) {
        return fireIcon;
    }

    return defaultIcon;
}

// Smoothly Pan and Zoom to Marker with Animation Queue
/**
 * Smoothly zooms out the map, then flies into the new marker's location.
 * @param {L.Marker} marker - The Leaflet marker to fly to.
 * @param {Function} callback - Function to execute after flying into the marker.
 */
function smoothFlyToNewMarker(marker, callback) {
    const maxZoom = map.getMaxZoom();
    const minZoom = map.getMinZoom();
    const targetZoom = Math.min(17, maxZoom);

    // Disable map interactions during animation
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    if (map.tap) map.tap.disable();

    // Step 1: Always zoom out to 13 (or minZoom if it's higher)
    const zoomOutLevel = Math.max(13, minZoom);
    map.flyTo(map.getCenter(), zoomOutLevel, { duration: 1 });

    map.once('moveend', function() {
        // Step 2: Fly to the marker's location at zoom level 13
        map.flyTo(marker.getLatLng(), zoomOutLevel, { duration: 1 });

        map.once('moveend', function() {
            // Step 3: Zoom in to the target zoom level (17 or maxZoom)
            map.flyTo(marker.getLatLng(), targetZoom, { duration: 1 });

            map.once('moveend', function() {
                callback();

                // Re-enable map interactions
                map.dragging.enable();
                map.scrollWheelZoom.enable();
                map.doubleClickZoom.enable();
                map.boxZoom.enable();
                map.keyboard.enable();
                if (map.tap) map.tap.enable();
            });
        });
    });
}

function handleMarkerVisibility(marker) {
    const visibleParent = markerGroups.getVisibleParent(marker);

    if (visibleParent === marker) {
        // Marker is visible, open popup
        openMarkerPopup(marker);
        playAudioForMarker(marker);
    } else if (visibleParent instanceof L.MarkerCluster) {
        // Marker is in a cluster
        visibleParent.spiderfy();
        
        // Wait for spiderfy animation to complete
        setTimeout(() => {
            openMarkerPopup(marker);
            playAudioForMarker(marker);
        }, 300);
    } else {
        console.error('Unexpected state: marker is neither visible nor in a cluster');
    }
}

function playAudioForMarker(marker) {
    if (!isNewCallAudioMuted) {
        const callId = getCallIdFromMarker(marker);
        if (callId && wavesurfers[callId]) {
            wavesurfers[callId].play();
            const playPauseButton = document.querySelector(`.play-pause[data-call-id="${callId}"]`);
            if (playPauseButton) {
                playPauseButton.textContent = 'Pause';
            }
        }
    }
}

/**
 * Opens the popup for the given marker and plays audio.
 * Ensures the marker is visible (unclustered) before opening the popup.
 * @param {L.Marker} marker - The Leaflet marker whose popup should be opened.
 */
function openMarkerPopup(marker) {
    // Prevent recursive calls
    if (marker.isPopupOpen()) {
        return;
    }

    // Check if the marker is visible and not clustered
    const visibleParent = markerGroups.getVisibleParent(marker);

    if (visibleParent === marker) {
        // Marker is already visible and not clustered; open the popup
        marker.openPopup();
    } else {
        // Marker is clustered or not visible; attempt to zoom to show it
        // Ensure we don't exceed max zoom levels
        const currentZoom = map.getZoom();
        const maxZoom = map.getMaxZoom();

        // If we're already at max zoom, spiderfy the cluster
        if (currentZoom >= maxZoom) {
            // Spiderfy the cluster to show individual markers
            visibleParent.spiderfy();
            // Optionally, open the popup after spiderfying
            marker.openPopup();
        } else {
            // Attempt to zoom in to show the marker
            markerGroups.zoomToShowLayer(marker, function() {
                marker.openPopup();
            });
        }
    }
}

/**
 * Processes the next animation in the queue.
 */
function processNextAnimation() {
    if (animationQueue.length === 0) {
        isAnimating = false;
        return;
    }

    isAnimating = true;
    const { marker, callback } = animationQueue.shift();
    smoothFlyToNewMarker(marker, () => {
        callback();
        processNextAnimation();
    });
}

/**
 * Enqueues a new animation request.
 * @param {L.Marker} marker - The Leaflet marker to animate to.
 * @param {Function} callback - Function to execute after animation.
 */
function enqueueAnimation(marker, callback) {
    animationQueue.push({ marker, callback });
    if (!isAnimating) {
        processNextAnimation();
    }
}

// Setup Mute Button
function setupMuteButton() {
    const muteButton = document.getElementById('mute-new-calls');
    if (muteButton) {
        muteButton.addEventListener('click', toggleNewCallAudioMute);
    } else {
        console.error('Mute button not found');
    }
}

// Toggle Mute State for New Call Audio
function toggleNewCallAudioMute() {
    isNewCallAudioMuted = !isNewCallAudioMuted;
    const muteButton = document.getElementById('mute-new-calls');
    muteButton.textContent = isNewCallAudioMuted ? 'Unmute New Calls' : 'Mute New Calls';
    console.log(`New call audio muted: ${isNewCallAudioMuted}`);
}

// Play Notification Sound for New Call
function playNewCallSound() {
    const audio = new Audio('/notification-sound.mp3');
    audio.play().catch(error => console.error('Error playing notification sound:', error));
}

// Play Audio for a Given Call ID
function playAudio(audioId) {
    if (!isNewCallAudioMuted && wavesurfers[audioId]) {
        wavesurfers[audioId].play();
    } else {
        console.log('New call audio is muted or WaveSurfer not initialized. Audio not played:', audioId);
    }
}

// Fetch and Display Additional Transcriptions
function getAdditionalTranscriptions(callId, skip, container, button) {
    fetch(`/api/additional-transcriptions/${callId}?skip=${skip}`)
        .then(response => response.json())
        .then(data => {
            if (data.length === 0) {
                button.style.display = 'none';
                if (skip === 0) {
                    container.innerHTML = '<p>No additional calls from this talk group.</p>';
                }
            } else {
                const newContent = data.map(trans => `
                    <div class="additional-transcription">
                        <small>${formatTimestamp(trans.timestamp)}</small><br>
                        <p>${trans.transcription}</p>
                        <div id="waveform-${trans.id}" class="waveform"></div>
                        <div class="audio-controls">
                            <button class="play-pause" data-call-id="${trans.id}" aria-label="Play audio for call ${trans.id}">Play</button>
                            <input type="range" class="volume" min="0" max="1" step="0.1" value="1" data-call-id="${trans.id}" aria-label="Volume control for call ${trans.id}">
                        </div>
                    </div>
                `).join('');
                
                container.innerHTML += newContent;
                button.setAttribute('data-skip', skip + data.length);

                // Initialize WaveSurfer for each new transcription
                data.forEach(trans => {
                    initWaveSurfer(trans.id, `/audio/${trans.audio_id}`);
                });
            }
        })
        .catch(error => {
            console.error('Error fetching additional transcriptions:', error);
            container.innerHTML += '<p>Error fetching additional information.</p>';
        });
}

// Clear All Markers from Map
function clearMarkers() {
    markerGroups.clearLayers();
    Object.keys(markers).forEach(key => delete markers[key]);

    // Clear heatmap data
    if (heatmapLayer) {
        heatmapLayer.setLatLngs([]);
    }
}

// Load Calls from API
function loadCalls(hours) {
    console.log(`Requesting calls for the last ${hours} hours`);
    fetch(`/api/calls?hours=${hours}`)
        .then(response => response.json())
        .then(calls => {
            console.log(`Received ${calls.length} calls from server`);
            console.log(`Oldest call received: ${calls[calls.length - 1].timestamp}`);
            console.log(`Newest call received: ${calls[0].timestamp}`);
            clearMarkers();
            const validCalls = calls.filter(isValidCall);
            console.log(`${validCalls.length} valid calls`);
            validCalls.forEach(call => addMarker(call));
            applyFilters();
            if (document.getElementById('enable-heatmap').checked) {
                updateHeatmap();
            }
            fitMapToMarkers();
        })
        .catch(error => {
            console.error('Error loading calls:', error);
        });
}

// Fit Map to Visible Markers
function fitMapToMarkers() {
    const markerArray = Object.values(allMarkers)
        .filter(obj => obj.visible)
        .map(obj => obj.marker);
    if (markerArray.length > 0) {
        const group = L.featureGroup(markerArray);
        map.fitBounds(group.getBounds().pad(0.1));
    } else {
        console.log('No markers to fit');
    }
}

// Format Timestamp for Display
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    // Format the simple timestamp in US Central Time
    const options = { 
        timeZone: 'America/Chicago',
        hour: '2-digit', 
        minute: '2-digit',
        hour12: true
    };
    const simpleTimestamp = date.toLocaleString('en-US', options);

    let relativeTime;
    if (diffDays === 0) {
        if (diffHours === 0) {
            relativeTime = `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
        } else {
            relativeTime = `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
        }
        return `Today, ${relativeTime} (${simpleTimestamp})`;
    } else if (diffDays === 1) {
        return `Yesterday, ${simpleTimestamp}`;
    } else {
        const fullOptions = { 
            timeZone: 'America/Chicago',
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

// Search Functionality

function setupSearch() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', function(event) {
            currentSearchTerm = event.target.value.trim().toLowerCase();
            applyFilters();
        });
    } else {
        console.error('Search input element not found');
    }
}

function applyFilters() {
    let visibleMarkers = 0;
    let lastVisibleMarker = null;

    const now = new Date();
    const filterTime = new Date(now.getTime() - timeRangeHours * 60 * 60 * 1000);

    console.log(`Filtering calls since: ${filterTime.toISOString()}`);
    console.log(`Total markers before filtering: ${Object.keys(allMarkers).length}`);

    Object.keys(allMarkers).forEach(callId => {
        const { marker, transcription, timestamp } = allMarkers[callId];
        const callTime = new Date(timestamp);
        const isWithinTimeRange = callTime >= filterTime;
        const matchesSearch = transcription.toLowerCase().includes(currentSearchTerm.toLowerCase());
        const shouldDisplay = isWithinTimeRange && matchesSearch;

        if (shouldDisplay) {
            markerGroups.addLayer(marker);
            allMarkers[callId].visible = true;
            visibleMarkers++;
            lastVisibleMarker = marker;
        } else {
            markerGroups.removeLayer(marker);
            allMarkers[callId].visible = false;
        }
    });

    console.log(`Visible markers after filtering: ${visibleMarkers}`);

    // Update heatmap if active
    if (document.getElementById('enable-heatmap').checked) {
        updateHeatmap();
    }

    fitMapToMarkers();

    if (visibleMarkers === 1 && lastVisibleMarker) {
        openMarkerPopup(lastVisibleMarker);
    }
}

function isMarkerWithinTimeRange(timestamp) {
    const callTimestamp = new Date(timestamp);
    const sinceTimestamp = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000);
    return callTimestamp >= sinceTimestamp;
}

// Retrieve Call ID from Marker
function getCallIdFromMarker(marker) {
    for (const [callId, data] of Object.entries(allMarkers)) {
        if (data.marker === marker) {
            console.log(`Found callId: ${callId} for marker.`);
            return callId;
        }
    }
    console.error('Could not find call ID for marker:', marker);
    return null;
}

// Heatmap Functionality

function setupHeatmapControls() {
    const heatmapCheckbox = document.getElementById('enable-heatmap');
    const intensitySliderContainer = document.getElementById('heatmap-intensity-container');

    if (heatmapCheckbox) {
        heatmapCheckbox.addEventListener('change', handleHeatmapToggle);

        // Set initial visibility of intensity slider
        if (heatmapCheckbox.checked) {
            intensitySliderContainer.style.display = 'flex';
        } else {
            intensitySliderContainer.style.display = 'none';
        }
    } else {
        console.error('Heatmap checkbox not found');
    }

    const intensitySlider = document.getElementById('heatmap-intensity');
    if (intensitySlider) {
        intensitySlider.addEventListener('input', handleIntensityChange);
    } else {
        console.error('Heatmap intensity slider not found');
    }
}

function handleHeatmapToggle(event) {
    const intensitySliderContainer = document.getElementById('heatmap-intensity-container');
    if (event.target.checked) {
        intensitySliderContainer.style.display = 'flex';
        showHeatmap();
    } else {
        intensitySliderContainer.style.display = 'none';
        hideHeatmap();
    }
}

function handleIntensityChange(event) {
    heatmapIntensity = parseInt(event.target.value, 10);
    if (document.getElementById('enable-heatmap').checked) {
        updateHeatmap();
    }
}

function showHeatmap() {
    // Collect data points from visible markers
    const heatData = [];

    Object.values(allMarkers).forEach(data => {
        if (data.visible) {
            const latlng = data.marker.getLatLng();
            heatData.push([latlng.lat, latlng.lng, heatmapIntensity]); // Use intensity value
        }
    });

    if (heatmapLayer) {
        map.removeLayer(heatmapLayer);
    }

    heatmapLayer = L.heatLayer(heatData, { radius: 25, blur: 19, maxZoom: 17 });
    heatmapLayer.addTo(map);
}

function hideHeatmap() {
    if (heatmapLayer) {
        map.removeLayer(heatmapLayer);
        heatmapLayer = null;
    }
}

function updateHeatmap() {
    if (!heatmapLayer) {
        showHeatmap();
        return;
    }

    const heatData = [];

    Object.values(allMarkers).forEach(data => {
        if (data.visible) {
            const latlng = data.marker.getLatLng();
            heatData.push([latlng.lat, latlng.lng, heatmapIntensity]); // Use intensity value
        }
    });

    heatmapLayer.setLatLngs(heatData);
}

// User Management Functions
function setupUserManagement() {
    const userMenuBtn = document.getElementById('user-menu-btn');
    const dropdownContent = document.getElementById('user-menu-content');
    const addUserBtn = document.getElementById('add-user-btn');
    const viewUsersBtn = document.getElementById('view-users-btn');
    
    // Toggle dropdown
    userMenuBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        dropdownContent.classList.toggle('show');
    });
    
    // Close dropdown when clicking outside
    window.addEventListener('click', function(e) {
        if (!e.target.matches('#user-menu-btn')) {
            dropdownContent.classList.remove('show');
        }
    });
    
    // Add User button click
    addUserBtn.addEventListener('click', function(e) {
        e.preventDefault();
        showAddUserModal();
    });
    
    // View Users button click
    viewUsersBtn.addEventListener('click', function(e) {
        e.preventDefault();
        showViewUsersModal();
    });
    
    // Setup modal forms
    setupAddUserForm();
    setupModalCancelButtons();
}

function showAddUserModal() {
    const modal = document.getElementById('add-user-modal');
    modal.style.display = 'block';
}

function showViewUsersModal() {
    const modal = document.getElementById('view-users-modal');
    loadUsersList();
    modal.style.display = 'block';
}

function setupAddUserForm() {
    const form = document.getElementById('add-user-form');
    form.addEventListener('submit', function(e) {
        e.preventDefault();
        
        const username = document.getElementById('new-username').value;
        const password = document.getElementById('new-password').value;
        
        fetch('/api/users', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showNotification(data.error, 'error');
            } else {
                showNotification('User added successfully', 'success');
                document.getElementById('add-user-modal').style.display = 'none';
                form.reset();
            }
        })
        .catch(error => {
            showNotification('Error adding user', 'error');
            console.error('Error:', error);
        });
    });
}

function loadUsersList() {
    const usersList = document.getElementById('users-list');
    usersList.innerHTML = 'Loading users...';
    
    fetch('/api/users')
        .then(response => response.json())
        .then(users => {
            usersList.innerHTML = users.map(user => `
                <div class="user-item">
                    <div class="user-info">
                        <strong>${user.username}</strong><br>
                        <small>Created: ${new Date(user.created_at).toLocaleString()}</small>
                    </div>
                    <div class="user-actions">
                        <button class="delete-user-btn" data-user-id="${user.id}">Delete</button>
                    </div>
                </div>
            `).join('');
            
            // Add event listeners for delete buttons
            document.querySelectorAll('.delete-user-btn').forEach(button => {
                button.addEventListener('click', function() {
                    const userId = this.getAttribute('data-user-id');
                    deleteUser(userId);
                });
            });
        })
        .catch(error => {
            usersList.innerHTML = 'Error loading users.';
            console.error('Error:', error);
        });
}

function deleteUser(userId) {
    if (confirm('Are you sure you want to delete this user?')) {
        fetch(`/api/users/${userId}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showNotification(data.error, 'error');
            } else {
                showNotification('User deleted successfully', 'success');
                loadUsersList(); // Reload the users list
            }
        })
        .catch(error => {
            showNotification('Error deleting user', 'error');
            console.error('Error:', error);
        });
    }
}

function setupModalCancelButtons() {
    document.querySelectorAll('.cancel-btn').forEach(button => {
        button.addEventListener('click', function() {
            this.closest('.modal').style.display = 'none';
        });
    });
}

// Session Management Functions
function setupSessionManagement() {
    // Get the existing "Manage Sessions" button by its ID
    const manageSessionsBtn = document.getElementById('manage-sessions-btn');

    if (manageSessionsBtn) {
        // Add an event listener to the button
        manageSessionsBtn.addEventListener('click', function(e) {
            e.preventDefault();
            showSessionsModal();
        });
    } else {
        console.error('Manage Sessions button not found');
    }
}

function showSessionsModal() {
    const modal = document.getElementById('sessions-modal');
    loadUsersForDropdown(); // Load users into the dropdown
    loadSessionsList(); // Load sessions for the default or selected user
    modal.style.display = 'block';
}

function loadUsersForDropdown() {
    const userDropdown = document.getElementById('user-dropdown');
    fetch('/api/users')
        .then(response => response.json())
        .then(users => {
            // Clear existing options
            userDropdown.innerHTML = '';
            // Add an option to select all users (optional, for admins)
            const allUsersOption = document.createElement('option');
            allUsersOption.value = 'all';
            allUsersOption.textContent = 'All Users';
            userDropdown.appendChild(allUsersOption);

            // Populate dropdown with users
            users.forEach(user => {
                const option = document.createElement('option');
                option.value = user.id;
                option.textContent = user.username;
                userDropdown.appendChild(option);
            });

            // Add event listener for dropdown change
            userDropdown.addEventListener('change', () => {
                loadSessionsList(); // Reload sessions when user selection changes
            });
        })
        .catch(error => {
            console.error('Error loading users for dropdown:', error);
        });
}

function loadSessionsList() {
    const sessionsList = document.getElementById('sessions-list');
    const userDropdown = document.getElementById('user-dropdown');
    const selectedUserId = userDropdown.value;

    sessionsList.innerHTML = '<div class="loading">Loading sessions...</div>';

    // Build the URL with the selected user ID
    let url = '/api/sessions';
    if (selectedUserId && selectedUserId !== 'all') {
        url += `?userId=${selectedUserId}`;
    }

    fetch(url)
        .then(response => response.json())
        .then(sessions => {
            sessionsList.innerHTML = sessions.map((session) => `
                <div class="session-item ${session.token === currentSessionToken ? 'current-session' : ''}">
                    <div class="session-info">
                        <div class="session-details">
                            <strong>${session.username}</strong>
                            ${session.token === currentSessionToken ? ' (Current Session)' : ''}<br>
                            <small>Created: ${new Date(session.created_at).toLocaleString()}</small><br>
                            <small>Expires: ${new Date(session.expires_at).toLocaleString()}</small>
                            <div class="device-info">
                                <small>${session.user_agent || 'Unknown Device'}</small><br>
                                <small>IP: ${session.ip_address || 'Unknown'}</small>
                            </div>
                        </div>
                        <div class="session-actions">
                            ${session.token !== currentSessionToken ? 
                                `<button class="terminate-session-btn" onclick="terminateSession('${session.token}')">
                                    Terminate
                                </button>` : 
                                ''
                            }
                        </div>
                    </div>
                </div>
            `).join('');
        })
        .catch(error => {
            console.error('Error loading sessions:', error);
            sessionsList.innerHTML = '<div class="error">Error loading sessions</div>';
        });
}

function terminateSession(token) {
    if (confirm('Are you sure you want to terminate this session?')) {
        fetch(`/api/sessions/${token}`, {
            method: 'DELETE'
        })
        .then(response => response.json())
        .then(data => {
            showNotification('Session terminated successfully', 'success');
            loadSessionsList();
        })
        .catch(error => {
            console.error('Error terminating session:', error);
            showNotification('Error terminating session', 'error');
        });
    }
}

document.addEventListener('DOMContentLoaded', initializeApp);

function initializeApp() {
    initAudioContext();
    attemptAutoplay();
    initMap();
    setupCallsAndUpdates();
    setupSearch();
    setupMuteButton();
    setupTimeFilter();
    setupHeatmapControls();
    setupLiveStreamButton();
    loadCalls(timeRangeHours);
    setupUserManagement(); // Call this first
    
    fetch('/api/sessions/current')
        .then(response => response.json())
        .then(data => {
            currentSessionToken = data.session.token;
            setupSessionManagement(); // Now this only adds the event listener
        })
        .catch(error => {
            console.error('Error getting current session:', error);
        });
}

// Update volume slider style
document.addEventListener('input', function(e) {
    if (e.target.classList.contains('volume')) {
        const value = e.target.value;
        e.target.style.setProperty('--value', `${value * 100}%`);
    }
});
