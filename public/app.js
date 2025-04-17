// app.js

// Global variables
let map, markerGroups;
const markers = {};
const allMarkers = {}; // Store all markers for filtering
let timeRangeHours; // Time range from config
let currentMapMode = 'day'; // Possible values: 'day', 'night', 'satellite'
let dayLayer, nightLayer, satelliteLayer; // Declare layers globally
let socket; // Socket.IO
let currentSearchTerm = ''; // Current search term
const wavesurfers = {}; // Store WaveSurfer instances
let audioContext;
let heatmapLayer; // Heatmap layer
let heatmapIntensity; // Intensity for heatmap
let toggleModeButton; // Button to toggle map modes
let liveAudioStream = null;
let isLiveStreamPlaying = false;
let audioContainer = null;
let currentSessionToken = null;
let selectedCategory = null;
let timestampUpdateInterval = null;
let isNewCallAudioMuted = false;
let isTrackingNewCalls = true; // Default to true so tracking is enabled by default

let categoryCounts = {
  'MEDICAL': 0,
  'FIRE': 0,
  'TRAFFIC': 0,
  'THEFT': 0,
  'SUSPICIOUS': 0,
  'DOMESTIC': 0,
  'ASSAULT': 0,
  'ALARM': 0,
  'WELFARE': 0,
  'ANIMAL': 0,
  'OTHER': 0
};
let newestCallIds = []; // Store IDs of newest calls
const MAX_PULSING_MARKERS = 3; // Maximum number of pulsing markers

// Category color mapping - carefully selected colors that match the categories
const CATEGORY_COLORS = {
    'MEDICAL': '#ff0000',    // Bright red for medical emergencies
    'FIRE': '#ff6600',       // Orange-red for fire calls
    'TRAFFIC': '#ffcc00',    // Amber for traffic incidents
    'THEFT': '#cc33ff',      // Purple for theft
    'SUSPICIOUS': '#9933ff', // Violet for suspicious activity
    'DOMESTIC': '#ff0066',   // Pink for domestic issues
    'ASSAULT': '#cc0000',    // Dark red for assault
    'ALARM': '#0066ff',      // Blue for alarms
    'WELFARE': '#00cc99',    // Teal for welfare checks
    'ANIMAL': '#66cc33',     // Green for animal calls
    'OTHER': '#dad600'       // yellow for other/unknown
};

// Pulsing Icon Implementation
L.Icon.Pulse = L.DivIcon.extend({
    options: {
        className: '',
        iconSize: [12, 12],
        color: 'red'
    },
    initialize: function(options) {
        L.setOptions(this, options);
        
        // Generate a unique class name for this icon instance
        var uniqueClassName = 'lpi-' + (new Date()).getTime() + '-' + Math.round(Math.random() * 100000);
        this.options.className = this.options.className + ' leaflet-pulsing-icon ' + uniqueClassName;
        
        // Create a style element with custom CSS for this specific icon
        var style = document.createElement('style');
        // Only apply color to the pulse effect, not the center dot
        var css = '.' + uniqueClassName + ':after{box-shadow: 0 0 6px 2px ' + this.options.color + ';}';
        
        if (style.styleSheet) {
            style.styleSheet.cssText = css;
        } else {
            style.appendChild(document.createTextNode(css));
        }
        document.getElementsByTagName('head')[0].appendChild(style);
        
        L.DivIcon.prototype.initialize.call(this, options);
    }
});

// Helper function to create a new pulsing icon
L.icon.pulse = function(options) {
    return new L.Icon.Pulse(options);
};

// Animation Queue Variables
const animationQueue = [];
let isAnimating = false;

// Create icon objects from config
function createIconsFromConfig() {
    const icons = {};
    
    // Create L.icon objects for each icon in config
    Object.keys(appConfig.icons).forEach(iconKey => {
        icons[iconKey] = L.icon(appConfig.icons[iconKey]);
    });
    
    return icons;
}

// Store icons globally
const customIcons = {};

// Function to add pulsing effect to an existing marker
function addPulsingEffectToMarker(callId) {
    // Skip if marker doesn't exist or already has a pulse effect
    if (!markers[callId] || !allMarkers[callId] || markers[callId].pulseMarker) {
        return;
    }
    
    try {
        // Get the marker's category and determine color
        const category = allMarkers[callId].category || 'OTHER';
        const color = CATEGORY_COLORS[category] || CATEGORY_COLORS['OTHER'];
        
        // Get marker position
        const latlng = markers[callId].getLatLng();
        
        // Create pulsing icon with the category color
        const pulsingIcon = L.icon.pulse({
            iconSize: [15, 15],
            color: color
        });
        
        // Create a pulsing marker at the same position
        const pulseMarker = L.marker(latlng, {
            icon: pulsingIcon,
            zIndexOffset: -100, // Position behind the original marker
            interactive: false  // Prevent interaction with the pulsing marker
        });
        
        // Add to map
        pulseMarker.addTo(map);
        
        // Store reference to pulse marker in original marker
        markers[callId].pulseMarker = pulseMarker;
        
        console.log(`Added pulsing effect to marker ${callId} with color ${color}`);
    } catch(e) {
        console.error("Error creating pulse marker:", e, e.stack);
    }
}

// Function to remove pulsing effect from a marker
function removePulsingEffect(callId) {
    if (markers[callId] && markers[callId].pulseMarker) {
        map.removeLayer(markers[callId].pulseMarker);
        delete markers[callId].pulseMarker;
        console.log(`Removed pulsing effect from marker ${callId}`);
    }
}

// Function to update which markers should have pulsing effects
function updatePulsingMarkers() {
    console.log("Updating pulsing markers, newest call IDs:", newestCallIds);
    
    // Remove pulsing effect from all markers that are no longer in the newest list
    Object.keys(markers).forEach(callId => {
        if (!newestCallIds.includes(callId) && markers[callId] && markers[callId].pulseMarker) {
            removePulsingEffect(callId);
        }
    });
    
    // Add pulsing effect to newest markers if they don't already have it
    newestCallIds.forEach(callId => {
        if (markers[callId] && !markers[callId].pulseMarker && allMarkers[callId].visible) {
            addPulsingEffectToMarker(callId);
        }
    });
}

// Function to update pulsing marker positions when their parent markers move
function updatePulsingMarkerPositions() {
    Object.keys(markers).forEach(callId => {
        if (markers[callId] && markers[callId].pulseMarker) {
            markers[callId].pulseMarker.setLatLng(markers[callId].getLatLng());
        }
    });
}

function addPermanentHouseMarkers() {
    // Create a separate layer group for permanent markers
    const houseMarkersGroup = L.layerGroup();

    // Add each house to the map
    appConfig.permanentLocations.houses.forEach(location => {
        // Create marker
        const marker = L.marker([location.lat, location.lng], { 
            icon: customIcons.house,
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
    liveStreamButton.textContent = appConfig.ui.liveStreamButtonText;
    liveStreamButton.className = 'cyberpunk-button';
    
    // Insert the button after the toggle mode button
    const toggleModeButton = document.getElementById('toggle-mode');
    if (toggleModeButton && toggleModeButton.parentNode) {
        toggleModeButton.parentNode.insertBefore(liveStreamButton, toggleModeButton.nextSibling);
    }
    
    // We don't need the audio container anymore, but keeping it for compatibility
    audioContainer = document.createElement('div');
    audioContainer.id = 'audio-container';
    audioContainer.style.display = 'none';
    document.body.appendChild(audioContainer);
    
    liveStreamButton.addEventListener('click', toggleLiveStream);
}

// Initialize the category sidebar
function initCategorySidebar() {
  const categoryList = document.getElementById('category-list');
  categoryList.innerHTML = '';
  
  // Check if we're on mobile and adjust styling accordingly
  if (isMobile()) {
    document.getElementById('category-sidebar').style.maxHeight = 
      `${window.innerHeight - 350}px`;
  }
  
  Object.keys(categoryCounts).forEach(category => {
    const categoryItem = document.createElement('div');
    categoryItem.className = 'category-item';
    categoryItem.dataset.category = category;
    categoryItem.innerHTML = `
      <div class="category-name">${category}</div>
      <div class="category-count">${categoryCounts[category]}</div>
    `;
    
    categoryItem.addEventListener('click', () => {
      toggleCategoryFilter(category);
    });
    
    categoryList.appendChild(categoryItem);
  });
  
  // Add "All" category
  const allCategory = document.createElement('div');
  allCategory.className = 'category-item active';
  allCategory.dataset.category = 'ALL';
  allCategory.innerHTML = `
    <div class="category-name">ALL</div>
    <div class="category-count">${Object.values(categoryCounts).reduce((a, b) => a + b, 0)}</div>
  `;
  
  allCategory.addEventListener('click', () => {
    toggleCategoryFilter('ALL');
  });
  
  categoryList.prepend(allCategory);
  
  // Add resize handler for mobile
  window.addEventListener('resize', () => {
    if (isMobile()) {
      document.getElementById('category-sidebar').style.maxHeight = 
        `${window.innerHeight - 350}px`;
    }
  });
}

// Toggle category filter
function toggleCategoryFilter(category) {
  // Reset active state for all categories
  document.querySelectorAll('.category-item').forEach(item => {
    item.classList.remove('active');
  });
  
  // Set active state for selected category
  const categoryElement = document.querySelector(`.category-item[data-category="${category}"]`);
  if (categoryElement) {
    categoryElement.classList.add('active');
  }
  
  selectedCategory = category === 'ALL' ? null : category;
  
  // Apply filters
  applyFilters();
  
  // If switching to ALL category, ensure pulsing markers are updated
  if (category === 'ALL') {
    updatePulsingMarkers();
  }
}

// Update category counts
function updateCategoryCounts() {
  // Reset all counts
  Object.keys(categoryCounts).forEach(category => {
    categoryCounts[category] = 0;
  });
  
  // Count visible markers by category
  Object.values(allMarkers).forEach(data => {
    if (data.visible && data.category) {
      const category = data.category;
      if (categoryCounts.hasOwnProperty(category)) {
        categoryCounts[category]++;
      } else {
        categoryCounts['OTHER']++;
      }
    }
  });
  
  // Update the UI
  Object.keys(categoryCounts).forEach(category => {
    const countElement = document.querySelector(`.category-item[data-category="${category}"] .category-count`);
    if (countElement) {
      countElement.textContent = categoryCounts[category];
    }
  });
  
  // Update ALL category count
  const allCountElement = document.querySelector(`.category-item[data-category="ALL"] .category-count`);
  if (allCountElement) {
    allCountElement.textContent = Object.values(categoryCounts).reduce((a, b) => a + b, 0);
  }
}

// Start timestamp update interval
function startTimestampUpdates() {
  // Clear any existing interval
  if (timestampUpdateInterval) {
    clearInterval(timestampUpdateInterval);
  }
  
  // Update timestamps every minute
  timestampUpdateInterval = setInterval(() => {
    updatePopupTimestamps();
    removeExpiredMarkers();
  }, 60000); // every minute
}

// Update timestamps in open popups
function updatePopupTimestamps() {
  Object.keys(markers).forEach(callId => {
    const marker = markers[callId];
    if (marker && marker.isPopupOpen()) {
      const timestampContainer = marker.getPopup().getContent().querySelector('.popup-timestamp');
      if (timestampContainer) {
        const callTimestamp = allMarkers[callId].timestamp;
        timestampContainer.innerHTML = `<small>${formatTimestamp(callTimestamp)}</small>`;
      }
    }
  });
}

// Remove markers that no longer match the time filter
function removeExpiredMarkers() {
  const now = new Date();
  const filterTime = new Date(now.getTime() - timeRangeHours * 60 * 60 * 1000);
  
  Object.keys(allMarkers).forEach(callId => {
    const callTime = new Date(allMarkers[callId].timestamp);
    if (callTime < filterTime) {
      // Remove from map if it's currently visible
      if (allMarkers[callId].visible) {
        markerGroups.removeLayer(markers[callId]);
        allMarkers[callId].visible = false;
      }
    }
  });
  
  // Update category counts after removing markers
  updateCategoryCounts();
}


function toggleLiveStream() {
    // Open the radio website in a new tab
    window.open(appConfig.audio.liveStreamUrl, '_blank');
}

// These functions are no longer used, but keeping empty stubs for compatibility
// in case they're called from elsewhere in the code
function createStreamIframe() {
    // Function no longer needed
}

function stopStream() {
    // Function no longer needed
}

function showStreamError() {
    // Function no longer needed
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
    // Initialize the map with the configuration center and zoom level
    map = L.map('map', {
        center: appConfig.map.defaultCenter,
        zoom: appConfig.map.defaultZoom,
        maxZoom: appConfig.map.maxZoom,
        minZoom: appConfig.map.minZoom,
        zoomControl: !isMobile(),
        tap: true
    });

    // Day layer using OpenStreetMap
    dayLayer = L.tileLayer(appConfig.mapStyles.dayLayer, {
        attribution: appConfig.map.attribution,
        maxZoom: appConfig.map.maxZoom,
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
    nightLayer = L.tileLayer(appConfig.mapStyles.dayLayer, {
        attribution: appConfig.map.attribution,
        maxZoom: appConfig.map.maxZoom,
        crossOrigin: true,
        className: 'dark-mode-tiles'
    });

    // Satellite view using two layers combined
    const satelliteBase = L.tileLayer(appConfig.mapStyles.satelliteBaseLayer, {
        attribution: appConfig.map.attribution,
        maxZoom: appConfig.map.maxZoom,
        crossOrigin: true
    });

    const satelliteLabels = L.tileLayer(appConfig.mapStyles.satelliteLabelsLayer, {
        attribution: '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
        maxZoom: appConfig.map.maxZoom,
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
} else {
    L.control.zoom({ position: 'topright' }).addTo(map);
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
        toggleModeButton.textContent = appConfig.ui.toggleModeLabels.day; // Assuming starting in day mode
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
        toggleModeButton.textContent = appConfig.ui.toggleModeLabels.night;
    } else if (currentMapMode === 'night') {
        map.removeLayer(nightLayer);
        satelliteLayer.addTo(map);
        currentMapMode = 'satellite';
        toggleModeButton.textContent = appConfig.ui.toggleModeLabels.satellite;
    } else if (currentMapMode === 'satellite') {
        map.removeLayer(satelliteLayer);
        dayLayer.addTo(map);
        currentMapMode = 'day';
        toggleModeButton.textContent = appConfig.ui.toggleModeLabels.day;
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
                    // Show new call banner with talk group name and category
                    showNewCallBanner(call.talk_group_name || 'Unknown Talk Group', call.category || 'OTHER');
                    
                    // Add new call ID to the beginning of newestCallIds array
                    newestCallIds.unshift(call.id);
                    
                    // Limit to MAX_PULSING_MARKERS
                    if (newestCallIds.length > MAX_PULSING_MARKERS) {
                        // Remove pulsing from the oldest call that's no longer in top 3
                        const oldestId = newestCallIds.pop();
                        removePulsingEffect(oldestId);
                    }
                    
                    // Add pulsing to the new call
                    addPulsingEffectToMarker(call.id);
                    
                    // Only animate to the new marker if tracking is enabled
                    if (isTrackingNewCalls) {
                        enqueueAnimation(marker, () => {
                            handleMarkerVisibility(marker);
                        });
                    }
                    
                    // Play new call sound if not muted
                    if (!isNewCallAudioMuted) {
                        playNewCallSound();
                    }
                    
                    // Update category counts
                    updateCategoryCounts();
                }
            }
        }
    } else {
        console.warn('Invalid call data received:', call);
    }
}


// Function to show the new call banner
function showNewCallBanner(talkGroup, category) {
  const banner = document.getElementById('new-call-banner');
  const talkGroupSpan = document.getElementById('talkgroup-name');
  
  talkGroupSpan.textContent = `${talkGroup} `;
  
  // Add category badge if available
  if (category) {
    const categoryBadge = document.createElement('span');
    categoryBadge.className = 'category-badge';
    categoryBadge.textContent = category;
    categoryBadge.style.cssText = `
      background-color: var(--hover-color);
      color: #00ccff;
      padding: 2px 6px;
      border-radius: 10px;
      font-size: 12px;
      margin-left: 5px;
    `;
    talkGroupSpan.appendChild(categoryBadge);
  }
  
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

        // Add the main content with talk group name and category on separate lines
        const contentWrapper = document.createElement('div');
        
        // Create talk group and category HTML with enhanced styling
        let mainContentHTML = '';
        
        // Add talk group name
        mainContentHTML += `<b>${call.talk_group_name || 'Unknown Talk Group'}</b>`;
        
        // Add category with blue theme styling if it exists
        if (call.category) {
            mainContentHTML += `<span style="display: inline-block; margin-left: 10px; color: #00ccff; font-weight: bold; font-style: italic; text-shadow: 0 0 3px #003366; font-size: 1.1em; letter-spacing: 0.2px;">${call.category}</span>`;
        }
        
        // Add transcription and other elements
        mainContentHTML += `<br>${call.transcription || 'No transcription available.'}<br>
            <div id="waveform-${call.id}" class="waveform"></div>
            <div class="audio-controls">
                <button class="play-pause" data-call-id="${call.id}" aria-label="Play audio for call ${call.id}">Play</button>
                <button class="get-more-info" data-call-id="${call.id}" data-skip="0">More Info</button>
                <input type="range" class="volume" min="0" max="1" step="0.1" value="1" data-call-id="${call.id}" aria-label="Volume control for call ${call.id}">
            </div>
            <div class="additional-info"></div>
        `;
        
        contentWrapper.innerHTML = mainContentHTML;
        popupContent.appendChild(contentWrapper);

        // Bind popup with content
        marker.bindPopup(popupContent);
        
        // Rest of your function remains unchanged
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
			category: call.category ? call.category.toUpperCase() : 'OTHER', // Ensure uppercase for category matching
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
        <button id="address-marker" class="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded">
          Enter Address
        </button>
        <button id="relocate-marker" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded">
          Manual Correction
        </button>
        <button id="delete-marker" class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded">
          Delete Marker
        </button>
        <button id="cancel-correction" class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded">
          Cancel
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Handle address search
  document.getElementById('address-marker').addEventListener('click', () => {
    startAddressSearch(callId, marker, modal);
  });

  // Handle relocate
  document.getElementById('relocate-marker').addEventListener('click', () => {
    startMarkerRelocation(callId, marker, modal);
  });

  // Handle delete
  document.getElementById('delete-marker').addEventListener('click', () => {
    if (confirm('Are you sure you want to delete this marker? This action cannot be undone.')) {
      deleteMarker(callId, marker, modal);
    }
  });

  // Handle cancel
  document.getElementById('cancel-correction').addEventListener('click', () => {
    modal.remove();
  });
}

function startAddressSearch(callId, originalMarker, modal) {
  modal.remove();

  if (!markers[callId] || !allMarkers[callId]) {
    showNotification('Marker data not found', 'error');
    return;
  }

  const callData = allMarkers[callId];
  const transcription = callData.transcription || 'No transcription available';
  const category = callData.category || 'OTHER';
  const originalLocation = {
    lat: originalMarker.getLatLng().lat,
    lng: originalMarker.getLatLng().lng
  };

  markerGroups.removeLayer(originalMarker);

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
    draggable: false,
    opacity: 1
  }).addTo(map);

  const banner = document.createElement('div');
  banner.className = 'address-search-banner';
  banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0;
    background-color: rgba(0, 0, 0, 0.9);
    color: #00ff00; padding: 15px; text-align: center; z-index: 2000;
    font-family: 'Share Tech Mono', monospace;
    border-bottom: 2px solid #00ff00;
    box-shadow: 0 0 10px rgba(0, 255, 0, 0.5);
  `;

  banner.innerHTML = `
    <div style="margin-bottom: 10px;"><strong>🔍 Search Address</strong></div>
    <div style="margin-bottom: 15px; padding: 10px; background-color: rgba(0, 51, 0, 0.7); border: 1px solid rgba(0, 255, 0, 0.3); border-radius: 4px; text-align: left; max-height: 60px; overflow-y: auto;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="color: #00ccff; font-weight: bold;">${category}</span>
        <span style="flex: 1; color: #00ff00; overflow: hidden; text-overflow: ellipsis;">${transcription}</span>
      </div>
    </div>
    <div style="display: flex; justify-content: center; margin-bottom: 10px;">
      <input id="address-search-input" type="text" style="
        width: 100%; max-width: 500px;
        padding: 8px 10px; background-color: #000; color: #00ff00;
        border: 1px solid #00ff00; border-radius: 4px;
        font-family: 'Share Tech Mono', monospace; font-size: 14px;
      " placeholder="Enter address...">
    </div>
    <div style="display: flex; justify-content: center; gap: 10px;">
      <button id="confirm-address" style="
        background-color: #003300; color: #00ff00;
        border: 1px solid #00ff00; padding: 8px 16px;
        cursor: pointer; border-radius: 4px;
        font-family: 'Share Tech Mono', monospace;
        opacity: 0.5; pointer-events: none;
      ">Confirm New Location</button>
      <button id="cancel-address-search" style="
        background-color: #330000; color: #ff0000;
        border: 1px solid #ff0000; padding: 8px 16px;
        cursor: pointer; border-radius: 4px;
        font-family: 'Share Tech Mono', monospace;
      ">Cancel</button>
    </div>
  `;

  document.body.appendChild(banner);

  const input = document.getElementById('address-search-input');
  const confirmBtn = document.getElementById('confirm-address');
  let newLocation = previewMarker.getLatLng();
  let newAddress = '';

  setTimeout(() => input.focus(), 100);

  const autocomplete = new google.maps.places.Autocomplete(input, {
    componentRestrictions: { country: "us" },
    fields: ['geometry', 'formatted_address'],
    types: ['geocode']
  });

  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (!place.geometry) {
      showNotification('No location found', 'error');
      return;
    }

    newAddress = place.formatted_address;
    newLocation = L.latLng(
      place.geometry.location.lat(),
      place.geometry.location.lng()
    );

    previewMarker.setLatLng(newLocation);
    map.setView(newLocation, 17);
    confirmBtn.style.opacity = '1';
    confirmBtn.style.pointerEvents = 'auto';
  });

  function getOriginalAddress(lat, lng) {
    return fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${appConfig.geocoding.googleApiKey}`)
      .then(res => res.json())
      .then(data => {
        if (data.results && data.results.length > 0) {
          return data.results[0].formatted_address;
        } else {
          return `Unknown (${lat}, ${lng})`;
        }
      })
      .catch(err => {
        console.error('Reverse geocode error:', err);
        return `Unknown (${lat}, ${lng})`;
      });
  }

  function logCorrection(originalAddress, newAddress) {
    const logData = {
      timestamp: new Date().toISOString(),
      callId,
      category,
      transcription,
      originalLocation,
      originalAddress,
      newLocation: {
        lat: newLocation.lat,
        lng: newLocation.lng
      },
      newAddress,
      action: 'location_correction'
    };

    fetch('/api/log/correction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logData)
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          console.log('Correction logged');
        } else {
          console.error('Logging failed:', data.error);
        }
      })
      .catch(err => {
        console.error('Log error:', err);
      });
  }

  confirmBtn.addEventListener('click', () => {
    if (confirmBtn.style.pointerEvents === 'none') return;

    confirmBtn.textContent = 'Updating...';
    confirmBtn.disabled = true;

    getOriginalAddress(originalLocation.lat, originalLocation.lng)
      .then(originalAddress => {
        return fetch(`/api/markers/${callId}/location`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lat: newLocation.lat,
            lon: newLocation.lng
          })
        })
        .then(res => res.json())
        .then(() => {
          originalMarker.setLatLng(newLocation);
          markerGroups.addLayer(originalMarker);
          if (markers[callId]?.pulseMarker) {
            markers[callId].pulseMarker.setLatLng(newLocation);
          }
          logCorrection(originalAddress, newAddress || 'Unknown');
          map.removeLayer(previewMarker);
          banner.remove();
          showNotification('Marker location updated successfully', 'success');
          if (document.getElementById('enable-heatmap').checked) {
            updateHeatmap();
          }
        });
      })
      .catch(err => {
        console.error('Update error:', err);
        showNotification('Error updating marker location', 'error');
        markerGroups.addLayer(originalMarker);
      })
      .finally(() => {
        map.removeLayer(previewMarker);
        banner.remove();
      });
  });

  document.getElementById('cancel-address-search').addEventListener('click', () => {
    map.removeLayer(previewMarker);
    banner.remove();
    markerGroups.addLayer(originalMarker);
  });
}
// Helper function for reverse geocoding
function getOriginalAddress(lat, lng) {
  return fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${appConfig.geocoding.googleApiKey}`)
    .then(res => res.json())
    .then(data => {
      if (data.results && data.results.length > 0) {
        return data.results[0].formatted_address;
      } else {
        return `Unknown (${lat}, ${lng})`;
      }
    })
    .catch(err => {
      console.error('Reverse geocode error:', err);
      return `Unknown (${lat}, ${lng})`;
    });
}

function deleteMarker(callId, marker, modal) {
  const markerData = allMarkers[callId];
  const originalLocation = {
    lat: marker.getLatLng().lat,
    lng: marker.getLatLng().lng
  };

  // Helper to handle actual deletion process
  const performDeletion = () => {
    fetch(`/api/markers/${callId}`, {
      method: 'DELETE'
    })
    .then(response => response.json())
    .then(data => {
      // Remove pulsing effect if exists
      if (markers[callId] && markers[callId].pulseMarker) {
        map.removeLayer(markers[callId].pulseMarker);
      }

      // Remove from newestCallIds array if present
      const indexInNewest = newestCallIds.indexOf(callId);
      if (indexInNewest > -1) {
        newestCallIds.splice(indexInNewest, 1);
      }

      // Remove marker and cleanup
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

      // If a marker in the newest list was deleted, update pulsing markers
      if (indexInNewest > -1) {
        loadNewNewestMarker();
      }
    })
    .catch(error => {
      console.error('Error deleting marker:', error);
      showNotification('Error deleting marker', 'error');
    });
  };

  // Try to log the deletion first
  getOriginalAddress(originalLocation.lat, originalLocation.lng)
    .then(address => {
      logDeletion(callId, markerData, originalLocation, address);
      performDeletion();
    })
    .catch(error => {
      console.error('Error getting address for deletion log:', error);
      performDeletion(); // Continue deletion even if address fails
    });
}

function logDeletion(callId, markerData, location, address) {
  const timestamp = new Date().toISOString();
  const logData = {
    timestamp: timestamp,
    callId: callId,
    category: markerData?.category || 'UNKNOWN',
    transcription: markerData?.transcription || 'No transcription available',
    location: location,
    address: address,
    action: 'marker_deletion'
  };

  fetch('/api/log/correction', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(logData)
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      console.log('Deletion logged successfully to server');
    } else {
      console.error('Error logging deletion:', data.error);
    }
  })
  .catch(error => {
    console.error('Error sending deletion log to server:', error);
  });
}


// Add this helper function to load a new marker to the newest list if needed
function loadNewNewestMarker() {
  if (newestCallIds.length < MAX_PULSING_MARKERS) {
    // Find the next newest visible marker not already in the list
    const allCallIds = Object.keys(allMarkers);
    
    // Sort by timestamp (newest first)
    allCallIds.sort((a, b) => {
      const timeA = new Date(allMarkers[a].timestamp);
      const timeB = new Date(allMarkers[b].timestamp);
      return timeB - timeA;
    });
    
    // Find the first marker that isn't already in newestCallIds
    for (const callId of allCallIds) {
      if (!newestCallIds.includes(callId) && allMarkers[callId].visible) {
        newestCallIds.push(callId);
        // Add pulsing effect to this marker
        addPulsingEffectToMarker(callId);
        break; // Only need to add one
      }
    }
  }
  
  // Update all pulsing markers
  updatePulsingMarkers();
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

// Get Marker Icon Based on Call Data
function getMarkerIcon(talkGroupName, talkGroupId, audioFilePath) {
    console.log('getMarkerIcon input:', { talkGroupName, talkGroupId, audioFilePath });

    talkGroupName = talkGroupName || '';
    audioFilePath = audioFilePath || '';

    // Check audio path classifications first
    if (audioFilePath) {
        // Check for police audio paths
        for (const pattern of appConfig.markerClassification.audioPaths.police) {
            if (audioFilePath.includes(pattern)) {
                return customIcons.pd;
            }
        }
        
        // Check for fire audio paths
        for (const pattern of appConfig.markerClassification.audioPaths.fire) {
            if (audioFilePath.includes(pattern)) {
                return customIcons.fire;
            }
        }
    }

    // Check talk group name classifications
    if (talkGroupName) {
        // Check for police talk groups
        for (const pattern of appConfig.markerClassification.police) {
            if (talkGroupName === pattern || talkGroupName.includes(pattern)) {
                return customIcons.pd;
            }
        }
        
        // Check for fire talk groups
        for (const pattern of appConfig.markerClassification.fire) {
            if (talkGroupName === pattern || talkGroupName.includes(pattern)) {
                return customIcons.fire;
            }
        }
    }

    // Default icon if no matches
    return customIcons.default;
}

// Smoothly Pan and Zoom to Marker with Animation Queue
function smoothFlyToNewMarker(marker, callback) {
    const maxZoom = map.getMaxZoom();
    const minZoom = map.getMinZoom();
    const targetZoom = Math.min(appConfig.animation.targetZoom, maxZoom);

    // Disable map interactions during animation
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom.disable();
    map.boxZoom.disable();
    map.keyboard.disable();
    if (map.tap) map.tap.disable();

    // Step 1: Always zoom out to configured level (or minZoom if it's higher)
    const zoomOutLevel = Math.max(appConfig.animation.zoomOutLevel, minZoom);
    map.flyTo(map.getCenter(), zoomOutLevel, { duration: appConfig.animation.duration });

    map.once('moveend', function() {
        // Step 2: Fly to the marker's location at zoom out level
        map.flyTo(marker.getLatLng(), zoomOutLevel, { duration: appConfig.animation.duration });

        map.once('moveend', function() {
            // Step 3: Zoom in to the target zoom level
            map.flyTo(marker.getLatLng(), targetZoom, { duration: appConfig.animation.duration });

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

function enqueueAnimation(marker, callback) {
    animationQueue.push({ marker, callback });
    if (!isAnimating) {
        processNextAnimation();
    }
}

// New function to replace setupMuteButton
function setupCallControls() {
    const muteCheckbox = document.getElementById('mute-new-calls');
    const trackCheckbox = document.getElementById('track-new-calls');
    
    if (muteCheckbox) {
        muteCheckbox.addEventListener('change', function() {
            isNewCallAudioMuted = this.checked;
            console.log(`New call audio muted: ${isNewCallAudioMuted}`);
        });
    } else {
        console.error('Mute new calls checkbox not found');
    }
    
    if (trackCheckbox) {
        trackCheckbox.checked = isTrackingNewCalls; // Set initial state
        trackCheckbox.addEventListener('change', function() {
            isTrackingNewCalls = this.checked;
            console.log(`Tracking new calls: ${isTrackingNewCalls}`);
        });
    } else {
        console.error('Track new calls checkbox not found');
    }
}

function toggleNewCallAudioMute() {
    isNewCallAudioMuted = !isNewCallAudioMuted;
    const muteButton = document.getElementById('mute-new-calls');
    muteButton.textContent = isNewCallAudioMuted ? 'Unmute New Calls' : 'Mute New Calls';
    console.log(`New call audio muted: ${isNewCallAudioMuted}`);
}

function playNewCallSound() {
    if (!isNewCallAudioMuted) {
        const audio = new Audio(appConfig.audio.notificationSound);
        audio.play().catch(error => console.error('Error playing notification sound:', error));
    }
}

function playAudio(audioId) {
    if (!isNewCallAudioMuted && wavesurfers[audioId]) {
        wavesurfers[audioId].play();
    } else {
        console.log('New call audio is muted or WaveSurfer not initialized. Audio not played:', audioId);
    }
}

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

function clearMarkers() {
    // First, remove all pulse markers
    Object.keys(markers).forEach(callId => {
        if (markers[callId] && markers[callId].pulseMarker) {
            map.removeLayer(markers[callId].pulseMarker);
        }
    });
    
    // Then clear all regular markers
    markerGroups.clearLayers();
    Object.keys(markers).forEach(key => delete markers[key]);

    // Clear heatmap data if it exists
    if (heatmapLayer) {
        heatmapLayer.setLatLngs([]);
    }
}

function loadCalls(hours) {
    console.log(`Requesting calls for the last ${hours} hours`);
    fetch(`/api/calls?hours=${hours}`)
        .then(response => response.json())
        .then(calls => {
            console.log(`Received ${calls.length} calls from server`);
            if (calls.length > 0) {
                console.log(`Oldest call received: ${calls[calls.length - 1].timestamp}`);
                console.log(`Newest call received: ${calls[0].timestamp}`);
            }
            
            // Clear existing markers
            clearMarkers();
            
            // Reset newest call IDs
            newestCallIds = [];
            
            // Filter for valid calls
            const validCalls = calls.filter(isValidCall);
            console.log(`${validCalls.length} valid calls`);
            
            // Sort calls by timestamp (newest first)
            validCalls.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            // Add all markers to the map
            validCalls.forEach(call => addMarker(call));
            
            // Get the newest 3 call IDs
            newestCallIds = validCalls.slice(0, MAX_PULSING_MARKERS).map(call => call.id);
            console.log(`Newest call IDs: ${newestCallIds}`);
            
            // Apply pulsing effect to newest calls
            updatePulsingMarkers();
            
            // Apply any filters
            applyFilters();
            
            // Update heatmap if enabled
            if (document.getElementById('enable-heatmap').checked) {
                updateHeatmap();
            }
            
            // Fit map to markers
            fitMapToMarkers();
        })
        .catch(error => {
            console.error('Error loading calls:', error);
        });
}

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

function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    // Format the simple timestamp in the configured time zone
    const options = { 
        timeZone: appConfig.map.timeZone,
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
            timeZone: appConfig.map.timeZone,
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

    // Process each marker
    Object.keys(allMarkers).forEach(callId => {
        const { marker, transcription, category, timestamp } = allMarkers[callId];
        const callTime = new Date(timestamp);
        const isWithinTimeRange = callTime >= filterTime;
        
        // Check if search term matches transcription or category
        const matchesSearch = 
            transcription.toLowerCase().includes(currentSearchTerm.toLowerCase()) || 
            (category && category.toLowerCase().includes(currentSearchTerm.toLowerCase()));
        
        // Check if category filter matches
        const matchesCategory = !selectedCategory || category === selectedCategory;
            
        const shouldDisplay = isWithinTimeRange && matchesSearch && matchesCategory;

        if (shouldDisplay) {
            markerGroups.addLayer(marker);
            allMarkers[callId].visible = true;
            visibleMarkers++;
            lastVisibleMarker = marker;
            
            // If this is a newest call with pulsing effect, make sure it's visible
            if (markers[callId] && markers[callId].pulseMarker && newestCallIds.includes(callId)) {
                if (!map.hasLayer(markers[callId].pulseMarker)) {
                    map.addLayer(markers[callId].pulseMarker);
                }
            }
        } else {
            markerGroups.removeLayer(marker);
            allMarkers[callId].visible = false;
            
            // If this marker has a pulsing effect, remove it from map
            if (markers[callId] && markers[callId].pulseMarker) {
                map.removeLayer(markers[callId].pulseMarker);
            }
        }
    });

    console.log(`Visible markers after filtering: ${visibleMarkers}`);
    
    // Update category counts
    updateCategoryCounts();

    // Update heatmap if active
    if (document.getElementById('enable-heatmap').checked) {
        updateHeatmap();
    }

    // Fit map to visible markers
    fitMapToMarkers();

    // If only one marker is visible, open its popup
    if (visibleMarkers === 1 && lastVisibleMarker) {
        openMarkerPopup(lastVisibleMarker);
    }
}


function isMarkerWithinTimeRange(timestamp) {
    const callTimestamp = new Date(timestamp);
    const sinceTimestamp = new Date(Date.now() - timeRangeHours * 60 * 60 * 1000);
    return callTimestamp >= sinceTimestamp;
}

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

    heatmapLayer = L.heatLayer(heatData, { 
        radius: appConfig.heatmap.radius, 
        blur: appConfig.heatmap.blur, 
        maxZoom: appConfig.heatmap.maxZoom 
    });
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

function isMobile() {
    return window.innerWidth <= 768;
}

function disableMobileMapInteractions() {
    // Keep all touch-based interactions enabled
    map.dragging.enable();
    map.touchZoom.enable();
    map.doubleClickZoom.enable();  // Keep double tap zoom enabled
    
    // Only disable non-touch interactions
    map.boxZoom.disable();
    map.keyboard.disable();
}

function enableMobileMapInteractions() {
    map.dragging.enable();
    map.touchZoom.enable();
    map.doubleClickZoom.enable();
    map.scrollWheelZoom.enable();
    map.boxZoom.enable();
    map.keyboard.enable();
}

function handleWindowResize() {
    if (isMobile()) {
        disableMobileMapInteractions();
    } else {
        enableMobileMapInteractions();
    }
}

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

function handleGetMoreInfo(event) {
    // Prevent default behavior if necessary
    event.preventDefault();

    const button = event.target;
    const callId = button.getAttribute('data-call-id');
    const skip = parseInt(button.getAttribute('data-skip'), 10);
    const additionalInfoDiv = button.closest('.custom-popup').querySelector('.additional-info');
    getAdditionalTranscriptions(callId, skip, additionalInfoDiv, button);
}

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

function setupUserManagement() {
    const userMenuBtn = document.getElementById('user-menu-btn');
    const dropdownContent = document.getElementById('user-menu-content');
    const addUserBtn = document.getElementById('add-user-btn');
    const viewUsersBtn = document.getElementById('view-users-btn');
    
    // Toggle dropdown
    if (userMenuBtn) {
        userMenuBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            dropdownContent.classList.toggle('show');
        });
    }
    
    // Close dropdown when clicking outside
    window.addEventListener('click', function(e) {
        if (!e.target.matches('#user-menu-btn')) {
            if (dropdownContent && dropdownContent.classList.contains('show')) {
                dropdownContent.classList.remove('show');
            }
        }
    });
    
    // Add User button click
    if (addUserBtn) {
        addUserBtn.addEventListener('click', function(e) {
            e.preventDefault();
            showAddUserModal();
        });
    }
    
    // View Users button click
    if (viewUsersBtn) {
        viewUsersBtn.addEventListener('click', function(e) {
            e.preventDefault();
            showViewUsersModal();
        });
    }
    
    // Setup modal forms
    setupAddUserForm();
    setupModalCancelButtons();
}

function showAddUserModal() {
    const modal = document.getElementById('add-user-modal');
    if (modal) {
        modal.style.display = 'block';
    }
}

function showViewUsersModal() {
    const modal = document.getElementById('view-users-modal');
    if (modal) {
        loadUsersList();
        modal.style.display = 'block';
    }
}

function setupAddUserForm() {
    const form = document.getElementById('add-user-form');
    if (form) {
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
}

function loadUsersList() {
    const usersList = document.getElementById('users-list');
    if (usersList) {
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
    if (modal) {
        loadUsersForDropdown(); // Load users into the dropdown
        loadSessionsList(); // Load sessions for the default or selected user
        modal.style.display = 'block';
    }
}

function loadUsersForDropdown() {
    const userDropdown = document.getElementById('user-dropdown');
    if (!userDropdown) return;
    
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
    if (!sessionsList) return;
    
    const userDropdown = document.getElementById('user-dropdown');
    const selectedUserId = userDropdown ? userDropdown.value : 'all';

    sessionsList.innerHTML = '<div class="loading">Loading sessions...</div>';

    // Build the URL with the selected user ID
    let url = '/api/sessions';
    if (selectedUserId && selectedUserId !== 'all') {
        url += `?userId=${selectedUserId}`;
    }

    fetch(url)
        .then(response => response.json())
        .then(sessions => {
            sessionsList.innerHTML = sessions.length ? sessions.map((session) => `
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
            `).join('') : '<div class="no-sessions">No active sessions found</div>';
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

// User and Session Management functions remain the same

document.addEventListener('DOMContentLoaded', initializeApp);

function initializeApp() {
    // Initialize configuration variables from the config
    timeRangeHours = appConfig.time.defaultTimeRangeHours;
    heatmapIntensity = appConfig.heatmap.defaultIntensity;
    
    // Initialize custom icons from config
    Object.assign(customIcons, createIconsFromConfig());
    
    initAudioContext();
    attemptAutoplay();
    initMap();
    setupCallsAndUpdates();
    setupSearch();
    setupCallControls(); // Use this instead of setupMuteButton
    setupTimeFilter();
    setupHeatmapControls();
    setupLiveStreamButton();
    loadCalls(timeRangeHours);
    setupUserManagement();
    
    // Initialize the category sidebar
    initCategorySidebar();
    
    // Start timestamp updates
    startTimestampUpdates();
    
    fetch('/api/sessions/current')
        .then(response => response.json())
        .then(data => {
            currentSessionToken = data.session.token;
            setupSessionManagement();
        })
        .catch(error => {
            console.error('Error getting current session:', error);
        });
    
    // Initialize pulsing markers functionality
    initializePulsingMarkers();
}
// Function to load and display summary
function loadSummary() {
  fetch('/summary.json')
    .then(response => response.json())
    .then(data => {
      const ticker = document.querySelector('.ticker');
      
      // Create content with main summary and highlights
      let content = `${data.summary} | `;
      
      // Add highlights if available
      if (data.highlights && data.highlights.length > 0) {
        data.highlights.forEach(highlight => {
          content += `<span class="summary-highlight">${highlight.talk_group}</span>: ${highlight.description} (${highlight.time}) | `;
        });
      }
      
      // Add update time
      content += `Updated: ${new Date(data.updated).toLocaleTimeString()} | `;
      
      // Clear ticker
      ticker.innerHTML = '';
      
      // Create multiple copies of the content for seamless looping
      for (let i = 0; i < 3; i++) {
        const item = document.createElement('div');
        item.className = 'ticker-item';
        item.innerHTML = content;
        ticker.appendChild(item);
      }
      
      // Reset animation to start from the beginning
      ticker.style.animationName = 'none';
      
      // Force a reflow
      void ticker.offsetWidth;
      
      // Restart animation
      ticker.style.animationName = 'ticker';
      
      // Calculate proper duration based on content length
      const tickerWidth = ticker.scrollWidth;
      const viewportWidth = document.querySelector('.ticker-wrap').offsetWidth;
      const ratio = tickerWidth / viewportWidth;
      
      // Adjust duration: higher = slower, lower = faster
      const baseDuration = 30; // seconds
      ticker.style.animationDuration = `${baseDuration * (ratio / 3)}s`;
      
      console.log(`Ticker animation set with duration: ${ticker.style.animationDuration}`);
    })
    .catch(error => {
      console.error('Error loading summary:', error);
      const ticker = document.querySelector('.ticker');
      ticker.innerHTML = '<div class="ticker-item">Summary information unavailable</div>';
    });
}
// Load summary immediately
loadSummary();

// Set up summary refresh interval (every 2 minutes)
setInterval(loadSummary, 120000);
// Update volume slider style
document.addEventListener('input', function(e) {
    if (e.target.classList.contains('volume')) {
        const value = e.target.value;
        e.target.style.setProperty('--value', `${value * 100}%`);
    }
});