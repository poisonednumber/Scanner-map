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
let audioContext = null; // Initialize explicitly as null
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

// NEW: Variables for Talkgroup Modal
let isTalkgroupModalOpen = false;
let currentOpenTalkgroupId = null;
const talkgroupModalWavesurfers = {}; // Separate WaveSurfer instances for the modal
let talkgroupPollingInterval = null; // Interval ID for polling
let talkgroupModalAutoplay = true; // Default autoplay to true
let lastCallTimestampInModal = null; // Track the newest timestamp shown in modal

// NEW: Global Volume Level
let globalVolumeLevel = 0.5; // Default to 50% volume

// NEW: Variable to store original mute state
let originalMuteStateBeforeModal = false;

// --- Live Feed State Variables ---
let liveFeedSelectedTalkgroups = new Set(); // Stores IDs of selected talkgroups
// REMOVED: let isLiveFeedEnabled = false;
let isLiveFeedAudioEnabled = false;
let allLiveFeedTalkgroups = []; // Cache for the full talkgroup list
const MAX_LIVE_FEED_ITEMS = 5;
const LIVE_FEED_ITEM_DURATION = 15000; // 15 seconds in milliseconds

// Add references for the UI elements that will be assigned in setupLiveFeed
// REMOVED liveFeedEnableCheckbox
let liveFeedModal, liveFeedSetupBtn, liveFeedSearchInput, liveFeedAudioEnableCheckbox, liveFeedTalkgroupListContainer, liveFeedDisplayContainer;

// Declare the audio source variable globally if it doesn't exist elsewhere
let currentAudioSource = null;
// --- End Live Feed State Variables ---

// MOVED TO TOP: initGlobalGainNode definition
function initGlobalGainNode() {
    console.log("[Audio Debug] Attempting to initialize globalGainNode...");
    // Use window reference just in case, though global scope should be fine here
    if (window.audioContext && !window.globalGainNode) { 
        console.log("[Audio Debug] audioContext exists and globalGainNode is NULL. Creating GainNode...");
        try {
            window.globalGainNode = window.audioContext.createGain(); 
            window.globalGainNode.gain.value = globalVolumeLevel; 
            window.globalGainNode.connect(window.audioContext.destination);
            console.log('[Audio Debug] Global Gain Node initialized SUCCESSFULLY.');
        } catch (e) {
            console.error('[Audio Debug] FAILED to create or connect Global Gain Node:', e);
            window.globalGainNode = null;
        }
    } else {
        if (!window.audioContext) { 
             console.warn("[Audio Debug] Cannot initialize GainNode because audioContext is NULL.");
        } else if (window.globalGainNode) {
             console.log("[Audio Debug] Global Gain Node already initialized.");
        }
    }
}

// --- ALL OTHER FUNCTION DEFINITIONS FOLLOW --- 

// Helper function to update slider background fill
function updateSliderFill(slider) {
    if (!slider) return;
    try {
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const value = parseFloat(slider.value);
        const percentage = ((value - min) / (max - min)) * 100;
        // Ensure percentage is within 0-100
        const clampedPercentage = Math.max(0, Math.min(100, percentage));
        slider.style.background = `linear-gradient(to right, var(--primary-color) ${clampedPercentage}%, rgba(0, 255, 0, 0.1) ${clampedPercentage}%)`;
    } catch (error) {
        console.error("Error updating slider fill:", error, slider);
    }
}

// Uses uppercase keys consistent with how they're stored in the DB via webserver.js
let categoryCounts = {
  'MEDICAL EMERGENCY': 0,
  'INJURED PERSON': 0,
  'DISTURBANCE': 0,
  'VEHICLE COLLISION': 0,
  'BURGLARY': 0,
  'ASSAULT': 0,
  'STRUCTURE FIRE': 0,
  'MISSING PERSON': 0,
  'MEDICAL CALL': 0,
  'BUILDING FIRE': 0,
  'STOLEN VEHICLE': 0,
  'SERVICE CALL': 0,
  'VEHICLE STOP': 0,
  'UNCONSCIOUS PERSON': 0,
  'RECKLESS DRIVER': 0,
  'PERSON WITH A GUN': 0,
  'ALTERED LEVEL OF CONSCIOUSNESS': 0,
  'BREATHING PROBLEMS': 0,
  'FIGHT': 0,
  'CARBON MONOXIDE': 0,
  'ABDUCTION': 0,
  'PASSED OUT PERSON': 0,
  'HAZMAT': 0,
  'FIRE ALARM': 0,
  'TRAFFIC HAZARD': 0,
  'INTOXICATED PERSON': 0,
  'MVC': 0,
  'ANIMAL BITE': 0, // Added
  'ASSIST': 0,      // Added
  'OTHER': 0
};

let newestCallIds = []; // Store IDs of newest calls
const MAX_PULSING_MARKERS = 3; // Maximum number of pulsing markers

// Assigning colors based on incident type similarity. Using uppercase keys.
const CATEGORY_COLORS = {
    // Medical Related (Reds/Pinks - adjusted for better contrast)
    'MEDICAL EMERGENCY':                 '#E53935', // Medium Red
    'INJURED PERSON':                    '#F06292', // Medium Pink
    'MEDICAL CALL':                      '#E53935', // Medium Red
    'UNCONSCIOUS PERSON':                '#F06292', // Medium Pink
    'ALTERED LEVEL OF CONSCIOUSNESS':    '#E53935', // Medium Red
    'BREATHING PROBLEMS':                '#F06292', // Medium Pink
    'PASSED OUT PERSON':                 '#F06292', // Medium Pink
    'ANIMAL BITE':                       '#EF5350', // Slightly Lighter Red

    // Fire Related (Oranges - avoiding pure yellow)
    'STRUCTURE FIRE':                    '#F57C00', // Strong Orange
    'BUILDING FIRE':                     '#F57C00', // Strong Orange
    'FIRE ALARM':                        '#FFA726', // Lighter Orange (Amber)
    'CARBON MONOXIDE':                   '#FFA726', // Lighter Orange (Amber)
    'HAZMAT':                            '#E65100', // Darker Orange/Brownish

    // Police/Crime Related (Blues/Teals - adjusted brightness)
    'DISTURBANCE':                       '#039BE5', // Medium Blue
    'BURGLARY':                          '#26C6DA', // Medium Cyan/Teal
    'ASSAULT':                           '#1E88E5', // Strong Blue
    'STOLEN VEHICLE':                    '#26C6DA', // Medium Cyan/Teal
    'VEHICLE STOP':                      '#4FC3F7', // Lighter, distinct Blue
    'PERSON WITH A GUN':                 '#1E88E5', // Strong Blue
    'FIGHT':                             '#039BE5', // Medium Blue
    'ABDUCTION':                         '#1E88E5', // Strong Blue
    'INTOXICATED PERSON':                '#4FC3F7', // Lighter, distinct Blue

    // Traffic Related (Ambers/Oranges - replaced pure yellow)
    'VEHICLE COLLISION':                 '#FFB300', // Amber/Gold
    'RECKLESS DRIVER':                   '#FFCA28', // Lighter Amber
    'TRAFFIC HAZARD':                    '#FFB300', // Amber/Gold
    'MVC':                               '#FFCA28', // Lighter Amber (Motor Vehicle Collision)

    // Other/Service (Greens/Purples/Greys - ensuring visibility)
    'MISSING PERSON':                    '#66BB6A', // Medium Green
    'SERVICE CALL':                      '#78909C', // Blue Grey (more distinct than plain grey)
    'ASSIST':                            '#78909C', // Blue Grey
    'OTHER':                             '#90A4AE', // Lighter Blue Grey
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
/* // REMOVE THIS FUNCTION ENTIRELY
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
*/

// Toggle category filter
function toggleCategoryFilter(category) {
  // Reset active state for all categories
  /* // Logic moved to updateCategoryCounts / handled by re-rendering
  document.querySelectorAll('.category-item').forEach(item => {
    item.classList.remove('active');
  });

  // Set active state for selected category
  const categoryElement = document.querySelector(`.category-item[data-category="${category}"]`);
  if (categoryElement) {
    categoryElement.classList.add('active');
  }
  */

  selectedCategory = category === 'ALL' ? null : category;

  // Apply filters (this will trigger updateCategoryCounts which handles active state)
  applyFilters();

  // If switching to ALL category, ensure pulsing markers are updated
  // This might not be necessary if applyFilters correctly handles visibility
  // if (category === 'ALL') {
  //   updatePulsingMarkers();
  // }
}


// Update category counts and dynamically update sidebar
function updateCategoryCounts() {
    const categoryList = document.getElementById('category-list');
    if (!categoryList) {
        console.error("Category list element not found!");
        return;
    }

    // 1. Calculate counts for visible markers
    const currentCounts = {};
    // Initialize with known categories to ensure they are checked even if count becomes 0
    Object.keys(categoryCounts).forEach(category => {
        currentCounts[category] = 0;
    });
    let totalVisible = 0;

    Object.values(allMarkers).forEach(data => {
        // Count only if the marker is currently visible according to filters
        if (data.visible) {
            totalVisible++;
            const category = data.category || 'OTHER'; // Use 'OTHER' if undefined/null
            // Ensure we only count valid, known categories or 'OTHER'
            if (currentCounts.hasOwnProperty(category)) {
                currentCounts[category]++;
            } else {
                // If the category from the data isn't in our initial list, count it as 'OTHER'
                currentCounts['OTHER']++;
            }
        }
    });

    // 2. Prepare list of categories with counts > 0
    const categoriesToShow = [];
    for (const category in currentCounts) {
        if (currentCounts[category] > 0) {
            categoriesToShow.push({ name: category, count: currentCounts[category] });
        }
    }

    // 3. Sort categories alphabetically
    categoriesToShow.sort((a, b) => a.name.localeCompare(b.name));

    // 4. Rebuild the category list (excluding 'ALL' for now)
    categoryList.innerHTML = ''; // Clear previous category-specific items

    // 5. Add sorted categories with counts > 0
    categoriesToShow.forEach(catInfo => {
        const categoryItem = document.createElement('div');
        categoryItem.className = 'category-item';
        categoryItem.dataset.category = catInfo.name;
        categoryItem.innerHTML = `
            <div class="category-name">${catInfo.name}</div>
            <div class="category-count">${catInfo.count}</div>
        `;

        // Highlight if it's the currently selected category
        if (selectedCategory === catInfo.name) {
            categoryItem.classList.add('active');
        }

        categoryItem.addEventListener('click', () => {
            // Pass the actual category name to the filter function
            toggleCategoryFilter(catInfo.name);
        });

        categoryList.appendChild(categoryItem);
    });

    // 6. Handle the "ALL" category
    const allCategoryItem = document.createElement('div');
    allCategoryItem.className = 'category-item';
    allCategoryItem.dataset.category = 'ALL';
    allCategoryItem.innerHTML = `
        <div class="category-name">ALL</div>
        <div class="category-count">${totalVisible}</div>
    `;
    // Set 'ALL' as active if no specific category is selected
    if (!selectedCategory) {
        allCategoryItem.classList.add('active');
    }
    allCategoryItem.addEventListener('click', () => {
        toggleCategoryFilter('ALL');
    });

    // Add 'ALL' to the top
    categoryList.prepend(allCategoryItem);

    // 7. Check if the currently selected category is still visible
    if (selectedCategory && currentCounts[selectedCategory] === 0) {
        console.log(`Selected category "${selectedCategory}" no longer has visible markers. Resetting to ALL.`);
        // Update state and visually reset in the next filter application
        selectedCategory = null; // Reset internal state
        // Re-apply filters which will call updateCategoryCounts again and highlight ALL
        applyFilters();
    }

    // 8. Adjust sidebar height for mobile
    // Consider moving resize logic to a dedicated function if it becomes complex
    if (isMobile()) {
        const sidebar = document.getElementById('category-sidebar');
        if (sidebar) {
           // Adjusted height: Viewport - control panel (180) - summary bar (50) - buffer (20)
           sidebar.style.maxHeight = `${window.innerHeight - 180 - 50 - 20}px`;
        }
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
    // Only act on markers that are currently visible
    if (allMarkers[callId].visible && callTime < filterTime) {
        // Remove from map
        markerGroups.removeLayer(markers[callId]);
        allMarkers[callId].visible = false;
        // Remove pulsing if present
        if (markers[callId].pulseMarker) {
            map.removeLayer(markers[callId].pulseMarker);
        }
    }
  });

  // Update category counts after potentially removing markers
  updateCategoryCounts();
}


function toggleLiveStream() {
    // Open the rdio website in a new tab
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
    console.log("[Audio Debug] Setting up standard audio context init listener.");
    document.body.addEventListener('click', () => {
        console.log("[Audio Debug] Body click detected (standard listener).");
        // Create context ONLY if it doesn't exist
        if (!window.audioContext) { 
            console.log("[Audio Debug] audioContext is NULL. Attempting creation...");
            try {
                const AudioContext = window.AudioContext || window.webkitAudioContext;
                window.audioContext = new AudioContext(); 
                console.log(`[Audio Debug] AudioContext CREATED successfully. State: ${window.audioContext.state}`);
                // REMOVED: initGlobalGainNode(); // Don't call here, handled by fallback in playLiveAudio if needed
            } catch (e) {
                console.error('[Audio Debug] FAILED to create AudioContext:', e);
                window.audioContext = null; 
                return; 
            }
        }

        // Attempt to resume if context exists and is suspended 
        if (window.audioContext && window.audioContext.state === 'suspended') {
            console.log("[Audio Debug] audioContext is suspended. Attempting resume...");
            window.audioContext.resume().then(() => {
                 console.log("[Audio Debug] audioContext resumed successfully.");
            }).catch(err =>
                console.warn('[Audio Debug] Error resuming AudioContext:', err)
            );
        }
         // Optionally resume wavesurfers 
         // ... wavesurfer resume logic ...

    }, { once: true }); // Still run only once
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
        // Set the initial text directly to "Day":
        toggleModeButton.textContent = 'Day'; // Assuming starting in day mode
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
        // Use direct text assignment
        toggleModeButton.textContent = 'Night';
    } else if (currentMapMode === 'night') {
        map.removeLayer(nightLayer);
        satelliteLayer.addTo(map);
        currentMapMode = 'satellite';
        // Use direct text assignment
        toggleModeButton.textContent = 'Satellite';
    } else if (currentMapMode === 'satellite') {
        map.removeLayer(satelliteLayer);
        dayLayer.addTo(map);
        currentMapMode = 'day';
        // Use direct text assignment
        toggleModeButton.textContent = 'Day';
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

    // Listener for map updates (Keep as is)
    socket.on('newCall', handleNewCall);
    
    // Restore direct Listener for live feed updates
    socket.on('liveFeedUpdate', handleLiveFeedUpdate); 
    
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
        topContainer.className = 'popup-top-container'; // Use class for styling
        
        // Create links container (left side)
        const topLinksContainer = document.createElement('div');
        topLinksContainer.className = 'popup-top-links'; // Use class for styling
        
        // Create street view link
        const streetViewLink = document.createElement('a');
        streetViewLink.href = `https://www.google.com/maps?layer=c&cbll=${call.lat},${call.lon}`;
        streetViewLink.target = '_blank';
        streetViewLink.className = 'street-view-link';
        streetViewLink.innerHTML = 'Street View';
        // style.cssText is no longer needed here if using class
        
        // Create correction link
        const correctionLink = document.createElement('a');
        correctionLink.href = '#';
        correctionLink.className = 'correction-link';
        correctionLink.textContent = 'Edit Marker';
        // style.cssText is no longer needed here if using class
        correctionLink.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showCorrectionModal(call.id, marker);
        });

        // Create timestamp container (right side)
        const timestampContainer = document.createElement('div');
        timestampContainer.className = 'popup-timestamp'; // Use class for styling
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
            mainContentHTML += `<span class="category-badge">${call.category}</span>`; // Use class for styling
        }
        
        // Add transcription and audio controls
        mainContentHTML += `<br>${call.transcription || 'No transcription available.'}<br>
            <div id="waveform-${call.id}" class="waveform"></div>
            <div class="audio-controls">
                <button class="play-pause" data-call-id="${call.id}" aria-label="Play audio for call ${call.id}">Play</button>
                <button class="talkgroup-history-btn" data-talkgroup-id="${call.talk_group_id}" data-talkgroup-name="${call.talk_group_name || 'Unknown Talk Group'}">More Info</button>
                <!-- REMOVED: <input type="range" class="volume" min="0" max="1" step="0.1" value="1" data-call-id="${call.id}" aria-label="Volume control for call ${call.id}"> -->
            </div>
            <!-- REMOVED: <div class="additional-info"></div> -->
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
            initWaveSurfer(call.id, `/audio/${call.audio_id}`, wavesurfers, () => { // Pass main wavesurfers object
                if (!isNewCallAudioMuted && this.shouldPlayAudio) {
                    playWaveSurferAudio(call.id, wavesurfers, this);
                }
            });

            // Add listener for the new history button *inside* popupopen
            const historyButton = this.getPopup().getElement().querySelector('.talkgroup-history-btn');
            if (historyButton) {
                 // Remove previous listener if any to prevent duplicates
                 historyButton.removeEventListener('click', handleShowTalkgroupHistory);
                 historyButton.addEventListener('click', handleShowTalkgroupHistory);
            }
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
             // Optional: Remove history button listener on close?
             // const historyButton = this.getPopup()?.getElement()?.querySelector('.talkgroup-history-btn');
             // if (historyButton) historyButton.removeEventListener('click', handleShowTalkgroupHistory);
        });
        
        markerGroups.addLayer(marker);
        markers[call.id] = marker; // Corrected: use call.id
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
          // Update counts as marker location changed but it's still visible
          updateCategoryCounts();
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

      // Update counts and sidebar
      updateCategoryCounts();

      // If a marker in the newest list was deleted, update pulsing markers
      if (indexInNewest > -1) {
        loadNewNewestMarker(); // This internally calls updatePulsingMarkers
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
    
    // Update category counts and sidebar *after* visibility is set
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
    const intensitySlider = document.getElementById('heatmap-intensity');

    if (heatmapCheckbox && intensitySliderContainer && intensitySlider) {
        heatmapCheckbox.addEventListener('change', handleHeatmapToggle);

        // Set initial visibility of intensity slider container
        intensitySliderContainer.style.display = heatmapCheckbox.checked ? 'flex' : 'none';

        // Set initial fill for intensity slider
        updateSliderFill(intensitySlider);

        intensitySlider.addEventListener('input', function(e) {
            handleIntensityChange(e);
            updateSliderFill(this); // Update fill on change
        });

    } else {
        console.error('Heatmap control elements not found');
    }

    // Removed the duplicate event listener setup from previous attempt if any
    /* // REMOVE if exists
    if (intensitySlider) {
        intensitySlider.addEventListener('input', handleIntensityChange);
    } else {
        console.error('Heatmap intensity slider not found');
    }
    */
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
function initWaveSurfer(callId, audioUrl, wavesurferStore, onReadyCallback, containerSelector = null) {
    const containerId = containerSelector || `waveform-${callId}`;
    const containerElement = document.getElementById(containerId);

    // Check if container exists
    if (!containerElement) {
        console.warn(`WaveSurfer container #${containerId} not found for callId ${callId}. Skipping init.`);
        return;
    }

    // Destroy existing instance for this specific call ID *in this store* if it exists
    if (wavesurferStore[callId]) {
        try {
            wavesurferStore[callId].destroy();
        } catch (e) {
            console.warn(`Error destroying previous wavesurfer for ${callId}:`, e);
        }
        delete wavesurferStore[callId];
    }

    try {
        wavesurferStore[callId] = WaveSurfer.create({
            container: `#${containerId}`, // Use the dynamic or default container ID
            waveColor: '#00ff00',
            progressColor: '#008000',
            cursorColor: '#ffffff',
            height: containerId.startsWith('tg-') ? 25 : 30, // Use smaller height for talkgroup modal
            normalize: true,
            backend: 'webaudio',
        });

        wavesurferStore[callId].load(audioUrl);

        // Find controls specific to this WaveSurfer instance (pop-up or modal)
        const controlsContainer = containerElement.closest('.talkgroup-list-item, .custom-popup');
        if (!controlsContainer) {
            console.warn(`Could not find controls container for wavesurfer ${callId}`);
            return;
        }

        const playPauseButton = controlsContainer.querySelector(`.play-pause[data-call-id="${callId}"]`);
        if (playPauseButton) {
            // Clone and replace to remove old listeners reliably
            const newButton = playPauseButton.cloneNode(true);
            playPauseButton.parentNode.replaceChild(newButton, playPauseButton);

            newButton.addEventListener('click', function() {
                if (wavesurferStore[callId].isPlaying()) {
                    wavesurferStore[callId].pause();
                    this.textContent = 'Play';
                } else {
                    // Pause all other playing wavesurfers in the *same* store
                    Object.keys(wavesurferStore).forEach(wsCallId => {
                        if (wsCallId !== callId.toString() && wavesurferStore[wsCallId] && wavesurferStore[wsCallId].isPlaying()) {
                            wavesurferStore[wsCallId].pause();
                            const otherButton = document.querySelector(`.play-pause[data-call-id="${wsCallId}"]`);
                            if (otherButton) otherButton.textContent = 'Play';
                        }
                    });
                    wavesurferStore[callId].play();
                    this.textContent = 'Pause';
                }
            });
        }

        // REMOVE Volume Control Logic
        /*
        const volumeControl = controlsContainer.querySelector(`input.volume[data-call-id="${call.id}"]`);
        if (volumeControl) {
            const newVolumeControl = volumeControl.cloneNode(true);
            volumeControl.parentNode.replaceChild(newVolumeControl, volumeControl);
            newVolumeControl.addEventListener('input', function(e) {
                 if (wavesurferStore[callId]) {
                    wavesurferStore[callId].setVolume(e.target.value);
                 }
            });
            // Initialize volume visually
             if (wavesurferStore[callId]) {
                wavesurferStore[callId].setVolume(newVolumeControl.value);
             }
        }
        */

        wavesurferStore[callId].on('ready', function() {
            console.log(`WaveSurfer for callId ${callId} in container #${containerId} is ready.`);
            // Set initial volume using global level
            if (wavesurferStore[callId]) {
                wavesurferStore[callId].setVolume(globalVolumeLevel);
            }
            if (onReadyCallback) onReadyCallback();
        });

        wavesurferStore[callId].on('finish', function() {
             const button = controlsContainer.querySelector(`.play-pause[data-call-id="${callId}"]`);
             if (button) {
                button.textContent = 'Play';
             }
        });

        wavesurferStore[callId].on('error', function(error) {
            console.error(`WaveSurfer error for callId ${callId} in container #${containerId}:`, error);
             const errorMsg = document.createElement('small');
             errorMsg.textContent = ' Error loading audio.';
             errorMsg.style.color = 'red';
             containerElement.appendChild(errorMsg);
        });

    } catch (error) {
        console.error(`Failed to initialize WaveSurfer for callId ${callId}:`, error);
    }
}

// Modified to accept the specific wavesurfer store
function playWaveSurferAudio(callId, wavesurferStore, marker = null) {
    if (!wavesurferStore || !wavesurferStore[callId]) {
        console.error(`WaveSurfer instance not found for callId ${callId} in the provided store.`);
        return;
    }
    try {
        // Ensure audio context is running (required after user interaction)
        const wsInstance = wavesurferStore[callId];
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

        const controlsContainer = document.querySelector(`.talkgroup-list-item[data-call-id="${callId}"], .custom-popup`); // Find the right container
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

// NEW: Event handler wrapper for the history button
function handleShowTalkgroupHistory(event) {
    const button = event.target;
    const talkgroupId = button.getAttribute('data-talkgroup-id');
    const talkgroupName = button.getAttribute('data-talkgroup-name');
    if (talkgroupId) {
        showTalkgroupModal(parseInt(talkgroupId, 10), talkgroupName);
    } else {
        console.error("Talkgroup ID not found on button");
    }
}

// Global function to close the talkgroup modal
function closeTalkgroupModal() {
    const modal = document.getElementById('talkgroup-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    isTalkgroupModalOpen = false;
    currentOpenTalkgroupId = null;

    // Destroy all wavesurfers associated with this modal instance
    Object.keys(talkgroupModalWavesurfers).forEach(callId => {
        if (talkgroupModalWavesurfers[callId]) {
            talkgroupModalWavesurfers[callId].destroy();
        }
    });
    // Clear the object
    for (let key in talkgroupModalWavesurfers) {
        delete talkgroupModalWavesurfers[key];
    }
    console.log('Talkgroup modal closed and wavesurfers destroyed.');

    // Restore main mute state
    const mainMuteCheckbox = document.getElementById('mute-new-calls');
    if (mainMuteCheckbox && mainMuteCheckbox.checked !== originalMuteStateBeforeModal) {
        mainMuteCheckbox.checked = originalMuteStateBeforeModal;
        mainMuteCheckbox.dispatchEvent(new Event('change')); // Trigger state update
        console.log(`Restored main mute state to: ${originalMuteStateBeforeModal}`);
    }

    // Clear the polling interval when closing the modal
    if (talkgroupPollingInterval) {
        clearInterval(talkgroupPollingInterval);
        talkgroupPollingInterval = null;
    }
}

// NEW: Function to create a list item for the talkgroup modal
function createTalkgroupListItem(call) {
    const listItem = document.createElement('div');
    listItem.className = 'talkgroup-list-item';
    listItem.dataset.callId = call.id;

    listItem.innerHTML = `
        <span class="talkgroup-item-timestamp">${formatTimestamp(call.timestamp)}</span>
        <p class="talkgroup-item-transcription">${call.transcription || 'No transcription available.'}</p>
        <div class="talkgroup-item-audio">
            ${call.audio_id ? `
                <div id="tg-waveform-${call.id}" class="waveform"></div>
                <div class="audio-controls">
                    <button class="play-pause" data-call-id="${call.id}" aria-label="Play audio">Play</button>
                    <!-- REMOVED: <input type="range" class="volume" min="0" max="1" step="0.1" value="1" data-call-id="${call.id}" aria-label="Volume control"> -->
                </div>
            ` : '<small>No audio file.</small>'}
        </div>
    `;

    // Initialize WaveSurfer if audio exists
    if (call.audio_id) {
        // Use setTimeout to ensure the element is in the DOM before WaveSurfer tries to attach
        setTimeout(() => {
            initWaveSurfer(call.id, `/audio/${call.audio_id}`, talkgroupModalWavesurfers, null, `tg-waveform-${call.id}`);
        }, 0);
    }

    return listItem;
}

// NEW: Function to show the talkgroup modal
function showTalkgroupModal(talkgroupId, talkgroupName) {
    const modal = document.getElementById('talkgroup-modal');
    const titleElement = document.getElementById('talkgroup-modal-title');
    const listElement = document.getElementById('talkgroup-list');

    if (!modal || !titleElement || !listElement) {
        console.error('Talkgroup modal elements not found!');
        return;
    }

    // Set title
    titleElement.textContent = talkgroupName || 'Talkgroup History';

    // Reset state and content
    listElement.innerHTML = '<div class="loading-placeholder">Loading history...</div>';
    isTalkgroupModalOpen = true;
    currentOpenTalkgroupId = talkgroupId;

    // Clear previous wavesurfers immediately before fetching new data
    Object.keys(talkgroupModalWavesurfers).forEach(callId => {
        if (talkgroupModalWavesurfers[callId]) {
            talkgroupModalWavesurfers[callId].destroy();
        }
    });
    for (let key in talkgroupModalWavesurfers) {
        delete talkgroupModalWavesurfers[key];
    }

    // Fetch initial history (using the current main time filter range)
    fetch(`/api/talkgroup/${talkgroupId}/calls?hours=${timeRangeHours}`)
        .then(response => response.json())
        .then(calls => {
            listElement.innerHTML = ''; // Clear loading placeholder
            if (calls && calls.length > 0) {
                calls.forEach(call => {
                    const listItem = createTalkgroupListItem(call);
                    listElement.appendChild(listItem);
                });
            } else {
                listElement.innerHTML = '<div class="loading-placeholder">No calls found for this talkgroup in the selected time range.</div>';
            }
        })
        .catch(error => {
            console.error('Error fetching talkgroup history:', error);
            listElement.innerHTML = '<div class="loading-placeholder error">Error loading call history.</div>';
        });

    // Display the modal
    modal.style.display = 'block';

    // --- Auto-mute main new calls --- 
    const mainMuteCheckbox = document.getElementById('mute-new-calls');
    if (mainMuteCheckbox) {
        originalMuteStateBeforeModal = mainMuteCheckbox.checked; // Store original state
        if (!originalMuteStateBeforeModal) { // Only check it if it wasn't already checked
            mainMuteCheckbox.checked = true;
            mainMuteCheckbox.dispatchEvent(new Event('change')); // Trigger state update
            console.log("Temporarily muted main new call sounds.");
        }
    }
    // --- End auto-mute ---

    // Set initial state of autoplay toggle and add listener
    const autoplayToggle = document.getElementById('talkgroup-autoplay-toggle');
    const autoplayLabel = document.getElementById('talkgroup-autoplay-label'); // Get the label
    const autoplayLabelTextSpan = autoplayLabel?.querySelector('span'); // Get the inner span

    if (autoplayToggle && autoplayLabel && autoplayLabelTextSpan) { // Check all exist
        autoplayToggle.checked = talkgroupModalAutoplay;
        // Set initial class based on default state
        if (talkgroupModalAutoplay) {
            // autoplayLabel.classList.add('live-indicator'); // Old way
            autoplayLabelTextSpan.classList.add('loading-ellipsis'); // Add to span
        } else {
            // autoplayLabel.classList.remove('live-indicator'); // Old way
            autoplayLabelTextSpan.classList.remove('loading-ellipsis'); // Remove from span
        }
        // Remove previous listener before adding new one
        autoplayToggle.removeEventListener('change', handleTalkgroupAutoplayChange);
        autoplayToggle.addEventListener('change', handleTalkgroupAutoplayChange);
    }

    // Start polling for new calls for this talkgroup
    startTalkgroupPolling(talkgroupId);
}

// NEW: Handler for the autoplay toggle change
function handleTalkgroupAutoplayChange(event) {
    talkgroupModalAutoplay = event.target.checked;
    console.log(`Talkgroup modal autoplay set to: ${talkgroupModalAutoplay}`);

    const autoplayLabel = document.getElementById('talkgroup-autoplay-label'); // Get label
    const autoplayLabelTextSpan = autoplayLabel?.querySelector('span'); // Get inner span

    // if (autoplayLabel) { // Old check
    if (autoplayLabelTextSpan) { // Check if span exists
        if (talkgroupModalAutoplay) {
            // autoplayLabel.classList.add('live-indicator'); // Old way
            autoplayLabelTextSpan.classList.add('loading-ellipsis'); // Add class to span
        } else {
            // autoplayLabel.classList.remove('live-indicator'); // Old way
            autoplayLabelTextSpan.classList.remove('loading-ellipsis'); // Remove class from span
        }
    }
}

// NEW: Function to start polling for new calls in the modal
function startTalkgroupPolling(talkgroupId) {
    // Clear any existing interval first
    if (talkgroupPollingInterval) {
        clearInterval(talkgroupPollingInterval);
    }

    // console.log(`Starting polling for talkgroup ${talkgroupId}...`); // Reduced logging

    talkgroupPollingInterval = setInterval(() => {
        pollForNewTalkgroupCalls(talkgroupId);
    }, 5000); // Poll every 5 seconds (reverted from 3)
}

// NEW: Function that actually performs the poll
function pollForNewTalkgroupCalls(talkgroupId) {
    if (!isTalkgroupModalOpen || currentOpenTalkgroupId !== talkgroupId) {
        // Modal closed or changed talkgroup, stop polling (should be handled by close, but safety check)
        if (talkgroupPollingInterval) clearInterval(talkgroupPollingInterval);
        talkgroupPollingInterval = null;
        return;
    }

    // Use the timestamp of the newest item currently in the modal list
    const listElement = document.getElementById('talkgroup-list');
    const firstItem = listElement?.querySelector('.talkgroup-list-item');
    const newestCallIdInList = firstItem ? parseInt(firstItem.dataset.callId, 10) : 0;

    // Fetch calls newer than the newest one we already have displayed
    // Note: Using ID assumes IDs are sequential and increasing with time
    fetch(`/api/talkgroup/${talkgroupId}/calls?sinceId=${newestCallIdInList}`)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(newCalls => {
            if (newCalls && newCalls.length > 0) {
                // console.log(`Poll received ${newCalls.length} new call(s) for talkgroup ${talkgroupId}`); // Reduced logging
                const placeholder = listElement.querySelector('.loading-placeholder');
                if (placeholder) placeholder.remove(); // Remove placeholder if present

                // Sort potentially multiple new calls by timestamp (newest first for prepending)
                newCalls.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

                newCalls.forEach(call => {
                     // Double-check we haven't already added this ID (e.g., from rapid polling)
                     if (!listElement.querySelector(`.talkgroup-list-item[data-call-id="${call.id}"]`)) {
                        const newItem = createTalkgroupListItem(call);
                        newItem.classList.add('new-item-highlight');
                        listElement.prepend(newItem);

                        // Handle autoplay if enabled
                        if (talkgroupModalAutoplay && call.audio_id) {
                            // Need a slight delay for WaveSurfer init
                            setTimeout(() => {
                                playWaveSurferAudio(call.id, talkgroupModalWavesurfers);
                            }, 500); // Adjust delay if needed
                        }
                     }
                });

                // Optional: Prune old items if list gets too long
                const maxItems = 100;
                while (listElement.children.length > maxItems) {
                    const oldestItem = listElement.lastElementChild;
                    const oldCallId = oldestItem.dataset.callId;
                    if (talkgroupModalWavesurfers[oldCallId]) {
                        talkgroupModalWavesurfers[oldCallId].destroy();
                        delete talkgroupModalWavesurfers[oldCallId];
                    }
                    listElement.removeChild(oldestItem);
                }
            }
        })
        .catch(error => {
            console.warn(`Polling error for talkgroup ${talkgroupId}:`, error);
            // Optionally stop polling on repeated errors?
        });
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
// Function to setup the sidebar toggle button
function setupSidebarToggle() {
  const toggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebar = document.getElementById('category-sidebar');

  if (toggleBtn && sidebar) {
    toggleBtn.addEventListener('click', () => {
      sidebar.classList.toggle('sidebar-hidden');
      // Optional: Change button text/icon when sidebar is hidden/shown
      if (sidebar.classList.contains('sidebar-hidden')) {
        toggleBtn.textContent = '☰ Show Categories';
        toggleBtn.setAttribute('aria-expanded', 'false');
      } else {
        toggleBtn.textContent = '✕ Hide Categories';
         toggleBtn.setAttribute('aria-expanded', 'true');
      }
    });

    // Ensure sidebar is hidden by default on mobile if the screen is small on load
    if (isMobile() && !sidebar.classList.contains('sidebar-hidden')) {
         sidebar.classList.add('sidebar-hidden');
         toggleBtn.textContent = '☰ Show Categories';
         toggleBtn.setAttribute('aria-expanded', 'false');
    } else if (!isMobile() && sidebar.classList.contains('sidebar-hidden')) {
         // Ensure sidebar is shown on desktop if window resizes large
         sidebar.classList.remove('sidebar-hidden');
         toggleBtn.textContent = '✕ Hide Categories'; // Or revert to default if needed
         toggleBtn.setAttribute('aria-expanded', 'true');
    }

  } else {
    console.error('Sidebar toggle button or sidebar element not found.');
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
    setupLiveFeed(); // Change back to setupLiveFeed
    // setupLiveStreamButton(); // Keep the old one commented out
    loadCalls(timeRangeHours);
    setupUserManagement();
	setupSidebarToggle();
    setupGlobalVolumeControl(); // Add this line

    // Initialize the category sidebar content dynamically
    updateCategoryCounts(); // Call this to build the initial list based on default state
    
    // Start timestamp updates
    startTimestampUpdates();
    
    fetch('/api/sessions/current')
        .then(response => response.json())
        .then(data => {
            currentSessionToken = data.session?.token; // Handle potential null session
            setupSessionManagement();
        })
        .catch(error => {
            console.error('Error getting current session:', error);
            // Proceed even if session fetch fails, maybe show anonymous state?
             setupSessionManagement(); // Setup anyway, might show defaults
        });
    
    // Initialize pulsing markers functionality (assuming this is defined elsewhere)
    // initializePulsingMarkers(); // If this function exists, keep it

    // Load initial calls *after* all UI setup is complete
    loadCalls(timeRangeHours);
}
// Function to load and display summary
function loadSummary() {
  fetch('/summary.json')
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return response.json();
    })
    .then(data => {
      const ticker = document.querySelector('.ticker');
      if (!ticker) {
          console.error('Ticker element not found.');
          return;
      }
      const tickerWrap = document.querySelector('.ticker-wrap');
       if (!tickerWrap) {
          console.error('Ticker wrap element not found.');
          return;
      }

      // --- NEW TICKER CONTENT HANDLING ---
      // Create content with main summary and highlights
      let baseContent = `${data.summary} | `;

      // Add highlights if available
      if (data.highlights && data.highlights.length > 0) {
        data.highlights.forEach(highlight => {
          // IMPORTANT: Use the class "summary-highlight" here
          baseContent += `<span class="summary-highlight">${highlight.talk_group}</span>: ${highlight.description} (${highlight.time}) | `;
        });
      }

      // Add update time
      baseContent += `Updated: ${new Date(data.updated).toLocaleTimeString()} | `;

      // Create the main ticker item
      const tickerItem = document.createElement('div');
      tickerItem.className = 'ticker-item';
      tickerItem.innerHTML = baseContent;

      // Create a duplicate ticker item for seamless looping (CSS will handle positioning)
      const tickerItemDuplicate = document.createElement('div');
      tickerItemDuplicate.className = 'ticker-item';
      tickerItemDuplicate.innerHTML = baseContent;
      tickerItemDuplicate.setAttribute('aria-hidden', 'true'); // Hide duplicate from screen readers

       // Clear previous ticker content
      ticker.innerHTML = '';

      // Append the items
      ticker.appendChild(tickerItem);
      ticker.appendChild(tickerItemDuplicate);

      // Reset animation (force restart if content changes)
      // This ensures the animation restarts correctly if the content width changes significantly
      ticker.style.animation = 'none';
      void ticker.offsetWidth; // Trigger reflow to apply the 'none' state
      ticker.style.animation = ''; // Re-apply animation from CSS defined rules

      // OPTIONAL: Dynamically adjust speed based on content width
      // Uncomment the following lines if you want speed to adjust
      /*
      const contentWidth = tickerItem.offsetWidth; // Get width of one copy
      if (contentWidth > 0 && tickerWrap.offsetWidth > 0) {
          const pixelsPerSecond = 75; // Adjust this value to control speed (higher = faster)
          const duration = contentWidth / pixelsPerSecond;
          // Use the animation name defined in CSS ('ticker-scroll')
          ticker.style.animation = `ticker-scroll ${Math.max(20, duration)}s linear infinite`; // Ensure a minimum duration
          console.log(`Ticker animation duration set to: ${ticker.style.animationDuration}`);
      } else {
           // Fallback if widths aren't available yet - use CSS default
           console.log('Could not calculate dynamic ticker duration, using CSS default.');
      }
      */

      console.log(`Ticker content updated.`);
      // --- END NEW TICKER CONTENT HANDLING ---

    })
    .catch(error => {
      console.error('Error loading or processing summary:', error);
      const ticker = document.querySelector('.ticker');
      if (ticker) {
        // Display error message within the ticker for visibility
        ticker.innerHTML = '<div class="ticker-item" style="color: #ff3333;">Error loading summary information</div>';
        // Stop any running animation
        ticker.style.animation = 'none';
      }
    });
}
// Load summary immediately
loadSummary();

// Set up summary refresh interval (every 2 minutes)
setInterval(loadSummary, 120000);
// Update volume slider style
/* // REMOVE THIS BLOCK
document.addEventListener('input', function(e) {
    if (e.target.classList.contains('volume')) {
        const value = e.target.value;
        e.target.style.setProperty('--value', `${value * 100}%`);
    }
});
*/

// NEW: Function to setup the global volume control listener
function setupGlobalVolumeControl() {
    console.log("Attempting to set up global volume control..."); // Log function call
    const volumeSlider = document.getElementById('global-volume');

    if (volumeSlider) {
        console.log("Global volume slider element FOUND."); // Log element found
        // Set initial slider value
        volumeSlider.value = globalVolumeLevel;
        updateSliderFill(volumeSlider); // Set initial fill

        volumeSlider.addEventListener('input', function(e) {
            globalVolumeLevel = parseFloat(e.target.value);
            // console.log(`Global volume slider changed. New value: ${globalVolumeLevel}`); // Reduced logging

            // Apply volume to all active wavesurfers in the main map
            Object.values(wavesurfers).forEach((ws, index) => {
                if (ws) {
                    try {
                       // console.log(`Setting volume for map WS index ${index} to ${globalVolumeLevel}`); // Reduced logging
                       ws.setVolume(globalVolumeLevel);
                    } catch (err) {
                        // console.warn(`Error setting volume on map wavesurfer ${index}:`, err); // Keep warning for errors
                    }
                } // else {
                    // console.log(`Map WS index ${index} is null/undefined.`); // Reduced logging
                // }
            });

            // Apply volume to all active wavesurfers in the talkgroup modal
            Object.values(talkgroupModalWavesurfers).forEach((ws, index) => {
                if (ws) {
                    try {
                        // console.log(`Setting volume for modal WS index ${index} to ${globalVolumeLevel}`); // Reduced logging
                        ws.setVolume(globalVolumeLevel);
                    } catch (err) {
                        // console.warn(`Error setting volume on modal wavesurfer ${index}:`, err); // Keep warning for errors
                    }
                } // else {
                    // console.log(`Modal WS index ${index} is null/undefined.`); // Reduced logging
                // }
            });
            updateSliderFill(this); // Update fill on change
        });
    } else {
        console.error("Global volume slider element NOT FOUND!"); // Log element not found
    }
}

// NEW Handler for Live Feed Updates
function handleLiveFeedUpdate(call) {
    // OPTIMIZATION: Skip if nothing is selected/enabled
    if (liveFeedSelectedTalkgroups.size === 0 && !isLiveFeedAudioEnabled) {
        // console.log("[LiveFeed] No talkgroups selected and audio disabled. Skipping update.");
        return; 
    }
    
    // console.log("[LiveFeed] handleLiveFeedUpdate triggered for call ID:", call.id);
    const incomingTgId = parseInt(call.talk_group_id, 10); 

    // Check if the talkgroup is selected
    if (liveFeedSelectedTalkgroups.has(incomingTgId)) { 
        // console.log(`[LiveFeed] Match found for TG ID ${incomingTgId}! Calling displayLiveFeedItem.`);
        displayLiveFeedItem(call); // Display the item (handles audio internally)
    } else {
        // console.log(`[LiveFeed] Call TG ID ${incomingTgId} ignored. Selected: ${liveFeedSelectedTalkgroups.has(incomingTgId)}`);
    }
}

// NEW: Live Feed Setup and Helper Functions

function setupLiveFeed() {
    console.log("[LiveFeed] Setting up Live Feed UI and listeners...");
    liveFeedSetupBtn = document.getElementById('live-feed-setup-btn');
    liveFeedModal = document.getElementById('live-feed-modal');
    liveFeedSearchInput = document.getElementById('live-feed-search');
    // REMOVED: liveFeedEnableCheckbox = document.getElementById('live-feed-enable');
    liveFeedAudioEnableCheckbox = document.getElementById('live-feed-audio-enable');
    liveFeedTalkgroupListContainer = document.getElementById('live-feed-talkgroup-list');
    liveFeedDisplayContainer = document.getElementById('live-feed-display');

    // Modified check to remove liveFeedEnableCheckbox
    if (!liveFeedSetupBtn || !liveFeedModal || !liveFeedSearchInput || !liveFeedAudioEnableCheckbox || !liveFeedTalkgroupListContainer || !liveFeedDisplayContainer) {
        console.error("[LiveFeed] Failed to find one or more required Live Feed elements.");
        return;
    }

    // Listener to open the modal
    liveFeedSetupBtn.addEventListener('click', openLiveFeedModal);

    // Listeners within the modal
    liveFeedSearchInput.addEventListener('input', handleLiveFeedSearch);
    // REMOVED: liveFeedEnableCheckbox.addEventListener('change', handleMasterEnableChange);
    liveFeedAudioEnableCheckbox.addEventListener('change', handleAudioEnableChange);

    // Initial state setup
    // REMOVED: liveFeedEnableCheckbox.checked = isLiveFeedEnabled;
    liveFeedAudioEnableCheckbox.checked = isLiveFeedAudioEnabled;
    // MODIFIED: Hide display initially, show based on selections later
    liveFeedDisplayContainer.style.display = liveFeedSelectedTalkgroups.size > 0 ? 'flex' : 'none'; 

    // Fetch all talkgroups for the modal (unchanged)
    fetch('/api/talkgroups')
        .then(response => response.json())
        .then(talkgroups => {
            allLiveFeedTalkgroups = talkgroups; // Cache the list
            console.log(`[LiveFeed] Fetched ${allLiveFeedTalkgroups.length} talkgroups.`);
        })
        .catch(error => {
            console.error('[LiveFeed] Error fetching talkgroups:', error);
            liveFeedTalkgroupListContainer.innerHTML = '<div class="loading-placeholder error">Error loading talkgroups.</div>';
        });
}

function openLiveFeedModal() {
    if (!liveFeedModal || !allLiveFeedTalkgroups) return;
    console.log("[LiveFeed] Opening setup modal.");
    liveFeedModal.style.display = 'block';
    populateLiveFeedTalkgroups(); // Populate with current selections
    // Ensure display state is correct when opening modal
    liveFeedDisplayContainer.style.display = liveFeedSelectedTalkgroups.size > 0 ? 'flex' : 'none'; 
}

// Placeholder for the globally accessible close function (defined in index.html)
function closeLiveFeedModal() { 
    const modal = document.getElementById('live-feed-modal');
    if (modal) {
        modal.style.display = 'none';
    }
    // Ensure display state is correct when closing modal
    if (liveFeedDisplayContainer) { // Add check for safety
       liveFeedDisplayContainer.style.display = liveFeedSelectedTalkgroups.size > 0 ? 'flex' : 'none'; 
    }
}

function populateLiveFeedTalkgroups() { // (Unchanged from previous step)
    if (!liveFeedTalkgroupListContainer) return;

    const searchTerm = liveFeedSearchInput.value.toLowerCase();
    const filteredTalkgroups = allLiveFeedTalkgroups.filter(tg =>
        tg.name.toLowerCase().includes(searchTerm)
    );

    filteredTalkgroups.sort((a, b) => {
        const aIsSelected = liveFeedSelectedTalkgroups.has(a.id);
        const bIsSelected = liveFeedSelectedTalkgroups.has(b.id);

        if (aIsSelected && !bIsSelected) {
            return -1; 
        } else if (!aIsSelected && bIsSelected) {
            return 1;  
        } else {
            return a.name.localeCompare(b.name);
        }
    });

    if (filteredTalkgroups.length === 0) {
        liveFeedTalkgroupListContainer.innerHTML = '<div class="loading-placeholder">No matching talkgroups found.</div>';
        return;
    }

    liveFeedTalkgroupListContainer.innerHTML = filteredTalkgroups.map(tg => `
        <div class="live-feed-tg-item">
            <input type="checkbox"
                   id="live-feed-tg-${tg.id}"
                   data-tg-id="${tg.id}"
                   ${liveFeedSelectedTalkgroups.has(tg.id) ? 'checked' : ''}>
            <label for="live-feed-tg-${tg.id}">${tg.name}</label>
        </div>
    `).join('');

    liveFeedTalkgroupListContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', handleLiveFeedSelectionChange);
    });
}

function handleLiveFeedSearch() { // (Unchanged)
    populateLiveFeedTalkgroups();
}

function handleLiveFeedSelectionChange(event) {
    const checkbox = event.target;
    const talkgroupId = parseInt(checkbox.dataset.tgId, 10);

    if (checkbox.checked) {
        liveFeedSelectedTalkgroups.add(talkgroupId);
        console.log(`[LiveFeed] Added TG ID ${talkgroupId} to selection. Current set:`, liveFeedSelectedTalkgroups);
    } else {
        liveFeedSelectedTalkgroups.delete(talkgroupId);
         console.log(`[LiveFeed] Removed TG ID ${talkgroupId} from selection. Current set:`, liveFeedSelectedTalkgroups);
    }
    
    // NEW: Update display based on selection size
    if (liveFeedDisplayContainer) { // Add safety check
        liveFeedDisplayContainer.style.display = liveFeedSelectedTalkgroups.size > 0 ? 'flex' : 'none';
        // Optional: Clear display if no TGs are selected
        if (liveFeedSelectedTalkgroups.size === 0) {
            liveFeedDisplayContainer.innerHTML = '';
        }
    }
}

// REMOVED function handleMasterEnableChange(event) { ... }

function handleAudioEnableChange(event) { // (Unchanged)
    isLiveFeedAudioEnabled = event.target.checked;
    console.log(`[LiveFeed] Audio Enabled set to: ${isLiveFeedAudioEnabled}`);
}

// Ensure displayLiveFeedItem is defined before handleLiveFeedUpdate
function displayLiveFeedItem(call) {
    // MODIFIED: Removed check for isLiveFeedEnabled
    if (!liveFeedDisplayContainer) return; 

    const newItem = document.createElement('div');
    newItem.className = 'live-feed-item';
    newItem.innerHTML = `<strong>${call.talk_group_name || 'Unknown TG'}</strong>: ${call.transcription || '...'}`;
    liveFeedDisplayContainer.prepend(newItem);

    while (liveFeedDisplayContainer.children.length > MAX_LIVE_FEED_ITEMS) {
        liveFeedDisplayContainer.removeChild(liveFeedDisplayContainer.lastElementChild);
    }

    setTimeout(() => {
        newItem.classList.add('fading-out');
        setTimeout(() => {
             if (newItem.parentNode === liveFeedDisplayContainer) { 
                liveFeedDisplayContainer.removeChild(newItem);
             }
        }, 1500); 
    }, LIVE_FEED_ITEM_DURATION - 1500);
    
    // Live Audio Logic (Unchanged)
    if (isLiveFeedAudioEnabled && call.audio_id) {
        console.log(`[LiveFeed] Attempting live audio for TG ${call.talk_group_id}, Call ${call.id}`);
        playLiveAudio(call);
    }
}

// playLiveAudio function (use window.audioContext)
function playLiveAudio(call) {
    console.log(`[LiveFeed Debug] playLiveAudio called for Call ID: ${call.id}, Audio ID: ${call.audio_id}`);
    // Stop previous source
    if (currentAudioSource && currentAudioSource.stop) {
        try {
            console.log(`[LiveFeed Debug] Stopping previous audio source...`);
            currentAudioSource.stop();
        } catch (e) {
            console.warn('[LiveFeed] Error stopping previous audio source:', e);
        }
        currentAudioSource = null; // Ensure it's cleared
    }

    // --- MODIFIED: Ensure AudioContext exists --- 
    if (!window.audioContext) {
        console.warn('[LiveFeed Debug] AudioContext is NULL inside playLiveAudio. Attempting fallback creation...');
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            window.audioContext = new AudioContext();
            console.log(`[LiveFeed Debug] Fallback AudioContext CREATED successfully. State: ${window.audioContext.state}`);
            // Need to ensure GainNode is also ready if context was just created
            initGlobalGainNode(); 
        } catch (e) {
             console.error('[LiveFeed Debug] Fallback FAILED to create AudioContext:', e);
             return; // Cannot proceed without context
        }
    }
    // --- END MODIFIED SECTION --- 

    // Resume if suspended (shouldn't be needed if just created, but safe check)
    if (window.audioContext.state === 'suspended') { 
        console.log('[LiveFeed Debug] AudioContext is suspended, attempting to resume...');
        window.audioContext.resume().catch(e => console.warn('[LiveFeed] AudioContext resume failed:', e));
    }
    
    // Check GainNode state 
    if (!window.globalGainNode) {
         console.warn('[LiveFeed Debug] globalGainNode is NULL. Audio might be silent.');
    } else {
         console.log(`[LiveFeed Debug] globalGainNode exists. Gain value: ${window.globalGainNode.gain.value}`);
    }
    
    const audioUrl = `/audio/${call.audio_id}`;
    console.log(`[LiveFeed Debug] Fetching audio from: ${audioUrl}`);
    
    fetch(audioUrl)
        .then(response => {
             // ... (fetch response logging) ...
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.arrayBuffer();
        })
        .then(arrayBuffer => {
            // ... (arrayBuffer check and logging) ... 
            if (!arrayBuffer || arrayBuffer.byteLength === 0) { 
                 console.error(`[LiveFeed Debug] Error: Received invalid ArrayBuffer...`);
                 throw new Error("Received invalid audio data");
            }
            console.log(`[LiveFeed Debug] Decoding ArrayBuffer...`);
            return window.audioContext.decodeAudioData(arrayBuffer); 
        })
        .then(audioBuffer => {
            // ... (decode success logging) ...
            const source = window.audioContext.createBufferSource(); 
            source.buffer = audioBuffer;
            const destinationNode = window.globalGainNode || window.audioContext.destination; 
            // ... (connect and start logging) ...
            source.connect(destinationNode);
            source.start(0);
            currentAudioSource = source;
            console.log(`[LiveFeed] Started playing live audio for Call ID: ${call.id}`);
            source.onended = () => {
                // ... (onended logging) ...
                if (currentAudioSource === source) { 
                    currentAudioSource = null;
                }
            };
        })
        .catch(error => {
            console.error(`[LiveFeed Debug] Error in playLiveAudio chain for Call ID ${call.id}:`, error);
            currentAudioSource = null;
        });
}

// initGlobalGainNode function (use window.audioContext)
// ... (existing implementation) ...

// setupGlobalVolumeControl function (Unchanged)
function setupGlobalVolumeControl() {
    // ... (existing implementation) ...
}

// initAudioContext function (Unchanged)
function initAudioContext() {
    // ... (existing implementation) ...
}

// --- END Live Feed Functions ---