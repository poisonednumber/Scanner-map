// app.js

// Global variables
// Map variables - now managed by MapModule (map and markerGroups are accessed via MapModule)
// Note: map, markerGroups, markers, and allMarkers are declared in map.js, so we just reference them here
var map, markerGroups, markers, allMarkers; // Will be set from MapModule (using var to avoid redeclaration error)
// markers and allMarkers are managed by map.js module
// currentMapMode, dayLayer, nightLayer, satelliteLayer, and toggleModeButton are declared in map.js
let timeRangeHours; // Time range from config

// Map module reference (will be set after map.js loads)
let MapModule = null;
let socket; // Socket.IO
let currentSearchTerm = ''; // Current search term
// wavesurfers, audioContext, and globalVolumeLevel are declared in audio.js (which loads first)
// We can reference them here since they're declared with var (globally accessible)

let heatmapLayer; // Heatmap layer
let heatmapIntensity; // Intensity for heatmap
// toggleModeButton is declared in map.js
let liveAudioStream = null;
let isLiveStreamPlaying = false;
let audioContainer = null;
let currentSessionToken = null;
let selectedCategory = null;
let timestampUpdateInterval = null;
let isNewCallAudioMuted = false;
let isTrackingNewCalls = true; // Default to true so tracking is enabled by default
let additionalWavesurfers = {};
const talkgroupPageLimit = 30; // How many calls to fetch per page
let currentTalkgroupOffset = 0;
let isLoadingMoreTalkgroupCalls = false;
let hasMoreTalkgroupCalls = true;
let isSearchingForTargetCall = false; // NEW: State for target search
let isAdminUser = false; // NEW: Track admin status
let authEnabled = false; // NEW: Track if authentication is enabled

const USER_LOCATION_ZOOM_LEVEL = 16; // ENSURE THIS GLOBAL CONSTANT IS DECLARED

// NEW: Variables for Talkgroup Modal
let isTalkgroupModalOpen = false;
let currentOpenTalkgroupId = null;
const talkgroupModalWavesurfers = {}; // Separate WaveSurfer instances for the modal
let talkgroupPollingInterval = null; // Interval ID for polling
let talkgroupModalAutoplay = true; // Default autoplay to true
let lastCallTimestampInModal = null; // Track the newest timestamp shown in modal

// globalVolumeLevel is declared in audio.js (which loads first)

// NEW: Variable to store original mute state
let originalMuteStateBeforeModal = false;

// --- Live Feed State Variables ---
let liveFeedSelectedTalkgroups = new Set(); // Stores IDs of selected talkgroups
// REMOVED: let isLiveFeedEnabled = false;
let isLiveFeedAudioEnabled = false;
let allLiveFeedTalkgroups = []; // Cache for the full talkgroup list
const MAX_LIVE_FEED_ITEMS = 5;
const LIVE_FEED_ITEM_DURATION = 15000; // 15 seconds in milliseconds
const LIVE_FEED_RETRY_INTERVAL = 3000; // 3 seconds for retry
const MAX_LIVE_FEED_RETRIES = 5; // Max 5 retries (total 15 seconds)

// Add references for the UI elements that will be assigned in setupLiveFeed
// REMOVED liveFeedEnableCheckbox
let liveFeedModal, liveFeedSetupBtn, liveFeedSearchInput, liveFeedAudioEnableCheckbox, liveFeedTalkgroupListContainer, liveFeedDisplayContainer;

// Declare the audio source variable globally if it doesn't exist elsewhere
let currentAudioSource = null;
// --- End Live Feed State Variables ---

// MOVED TO TOP: initGlobalGainNode definition
function initGlobalGainNode() {
    console.log("[VOLUME] Initializing global gain node...");
    // Make sure we have an audio context first
    if (!window.audioContext) {
        console.warn("[VOLUME] Cannot initialize gain node: no audio context");
        return;
    }
    
    // Create gain node if it doesn't exist
    if (!window.globalGainNode) { 
        try {
            window.globalGainNode = window.audioContext.createGain(); 
            window.globalGainNode.gain.value = globalVolumeLevel; 
            window.globalGainNode.connect(window.audioContext.destination);
            console.log(`[VOLUME] Global gain node created with value ${globalVolumeLevel}`);
        } catch (e) {
            console.error('[VOLUME] Failed to create global gain node:', e);
            window.globalGainNode = null;
        }
    } else {
        console.log("[VOLUME] Global gain node already exists");
        // Ensure gain value matches global setting
        try {
            window.globalGainNode.gain.value = globalVolumeLevel;
            console.log(`[VOLUME] Updated existing gain node to ${globalVolumeLevel}`);
        } catch (e) {
            console.error('[VOLUME] Error updating existing gain node:', e);
        }
    }
}

// --- ALL OTHER FUNCTION DEFINITIONS FOLLOW --- 

// Helper function to update slider background fill - improved version
function updateSliderFill(slider) {
    if (!slider) {
        console.warn("[VOLUME] updateSliderFill called with null slider");
        return;
    }
    
    try {
        const min = parseFloat(slider.min || 0);
        const max = parseFloat(slider.max || 1);
        const value = parseFloat(slider.value || 0);
        
        // Calculate percentage (clamped to 0-100 range)
        const percentage = ((value - min) / (max - min)) * 100;
        const clampedPercentage = Math.max(0, Math.min(100, percentage));
        
        // Apply gradient style
        slider.style.background = `linear-gradient(to right, var(--primary-color) ${clampedPercentage}%, rgba(0, 255, 0, 0.1) ${clampedPercentage}%)`;
        
        // console.log(`[VOLUME] Updated slider fill to ${clampedPercentage}%`); // REMOVED THIS LINE
    } catch (error) {
        console.error("[VOLUME] Error updating slider fill:", error);
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

// Pulsing Icon Implementation (Original - for existing markers)
L.Icon.Pulse = L.DivIcon.extend({
    options: {
        className: '',
        iconSize: [12, 12],
        color: 'red', // Default for existing alerts
        heartbeat: 1 // Default pulse speed (lower is faster) for existing alerts
    },
    initialize: function(options) {
        L.setOptions(this, options);
        var uniqueClassName = 'lpi-' + (new Date()).getTime() + '-' + Math.round(Math.random() * 100000);
        this.options.className = this.options.className + ' leaflet-pulsing-icon ' + uniqueClassName;
        var style = document.createElement('style');
        var css = '.' + uniqueClassName + ':after{box-shadow: 0 0 6px 2px ' + this.options.color + '; animation: pulsate ' + this.options.heartbeat + 's ease-out infinite;}';
        if (style.styleSheet) {
            style.styleSheet.cssText = css;
        } else {
            style.appendChild(document.createTextNode(css));
        }
        document.getElementsByTagName('head')[0].appendChild(style);
        L.DivIcon.prototype.initialize.call(this, options);
    }
});

// Helper function to create a new original pulsing icon
L.icon.pulse = function(options) {
    return new L.Icon.Pulse(options);
};

// NEW: User Location Pulsing Icon (Solid dot with pulse)
L.Icon.UserLocationPulse = L.DivIcon.extend({
    options: {
        className: '', // Base class for styling if needed
        iconSize: [16, 16], // Slightly larger for user location dot
        color: '#007bff', // Blue for user location
        heartbeat: 1.2 // Pulse speed for user location
    },
    initialize: function(options) {
        L.setOptions(this, options);

        const uniqueDotClass = 'user-location-dot-' + Date.now();
        const uniquePulseClass = 'user-location-pulse-effect-' + Date.now();

        // Apply the dot class to the main element via options.className
        this.options.className = (this.options.className || '') + ' ' + uniqueDotClass;

        const style = document.createElement('style');
        const css = `
            .${uniqueDotClass} {
                background-color: ${this.options.color};
                width: ${this.options.iconSize[0]}px;
                height: ${this.options.iconSize[1]}px;
                border-radius: 50%;
                box-shadow: 0 0 2px rgba(0,0,0,0.7); /* Sharper shadow for the dot */
                position: relative; /* Needed for :after positioning */
                display: flex; /* For centering if iconSize was just for container */
                align-items: center; /* For centering */
                justify-content: center; /* For centering */
            }
            .${uniqueDotClass}:after {
                content: '';
                position: absolute;
                /* Centering the pulse relative to the dot */
                left: 50%; 
                top: 50%;
                transform: translate(-50%, -50%);
                width: ${this.options.iconSize[0] * 2.5}px; 
                height: ${this.options.iconSize[1] * 2.5}px; 
                border-radius: 50%;
                /* Using a direct animation definition here to avoid conflicts */
                animation-name: userLocationPulsate;
                animation-duration: ${this.options.heartbeat}s;
                animation-timing-function: ease-out;
                animation-iteration-count: infinite;
                box-shadow: 0 0 8px 2px ${this.options.color}; /* Ensure pulse shadow is visible */
                opacity: 0.8; /* Make pulse slightly more opaque */
                z-index: -1; /* Ensure pulse is behind the main dot if dot has content */
            }
            /* Define the keyframes for this specific pulse to avoid global conflicts */
            @keyframes userLocationPulsate {
                0% {
                    transform: translate(-50%, -50%) scale(0.5);
                    opacity: 0.8;
                }
                70% {
                    transform: translate(-50%, -50%) scale(1);
                    opacity: 0;
                }
                100% {
                    transform: translate(-50%, -50%) scale(0.5);
                    opacity: 0;
                }
            }
        `;

        if (style.styleSheet) {
            style.styleSheet.cssText = css;
        } else {
            style.appendChild(document.createTextNode(css));
        }
        document.getElementsByTagName('head')[0].appendChild(style);
        L.DivIcon.prototype.initialize.call(this, options);
    }
});

// Helper function for the new user location pulsing icon
L.icon.userLocationPulse = function(options) {
    return new L.Icon.UserLocationPulse(options);
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
        
        // console.log(`Added pulsing effect to marker ${callId} with color ${color}`); // REMOVED THIS LINE
    } catch(e) {
        console.error("Error creating pulse marker:", e, e.stack);
    }
}

// Function to remove pulsing effect from a marker
function removePulsingEffect(callId) {
    if (markers[callId] && markers[callId].pulseMarker) {
        map.removeLayer(markers[callId].pulseMarker);
        delete markers[callId].pulseMarker;
        // console.log(`Removed pulsing effect from marker ${callId}`); // REMOVED THIS LINE
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
    // Multiply Unix timestamp by 1000 for correct comparison
    const callTime = new Date(allMarkers[callId].timestamp * 1000);
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
    console.log("[VOLUME] Initializing AudioContext..."); 
    try {
        if (!window.audioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            window.audioContext = new AudioContext();
            console.log(`[VOLUME] New AudioContext created. State: ${window.audioContext.state}`);
            
            // Initialize gain node right after context creation
            initGlobalGainNode(); 

            // If the context starts suspended, try to resume it immediately
            if (window.audioContext.state === 'suspended') {
                window.audioContext.resume()
                    .then(() => console.log('[VOLUME] AudioContext resumed'))
                    .catch(e => console.warn('[VOLUME] Resume failed:', e));
            }
        } else {
            console.log(`[VOLUME] AudioContext already exists. State: ${window.audioContext.state}`);
            // Ensure gain node exists
            if (!window.globalGainNode) {
                initGlobalGainNode();
            }
            // Resume if suspended
            if (window.audioContext.state === 'suspended') {
                window.audioContext.resume()
                    .then(() => console.log('[VOLUME] Existing AudioContext resumed'))
                    .catch(e => console.warn('[VOLUME] Resume failed:', e));
            }
        }
    } catch (e) {
        console.error('[VOLUME] Error initializing AudioContext:', e);
    }
}

// Attempt to play a silent buffer to unlock/resume the AudioContext
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

// Initialize map - now uses MapModule if available
function initMap() {
    // Use MapModule if available, otherwise fall back to inline implementation
    if (window.MapModule) {
        MapModule = window.MapModule;
        MapModule.initMap(appConfig, isMobile, setupEventListeners, loadCalls, timeRangeHours, addPermanentHouseMarkers);
        // Sync global variables from module
        map = MapModule.getMap();
        markerGroups = MapModule.getMarkerGroups();
        // Note: markers and allMarkers are managed by the module but we keep local refs for compatibility
    } else {
        // Fallback to original inline implementation
        map = L.map('map', {
            center: appConfig.map.defaultCenter,
            zoom: appConfig.map.defaultZoom,
            maxZoom: appConfig.map.maxZoom,
            minZoom: appConfig.map.minZoom,
            zoomControl: !isMobile(),
            tap: true
        });

        dayLayer = L.tileLayer(appConfig.mapStyles.dayLayer, {
            attribution: appConfig.map.attribution,
            maxZoom: appConfig.map.maxZoom,
            crossOrigin: true
        });

        const style = document.createElement('style');
        style.textContent = `
            .dark-mode-tiles {
                filter: invert(100%) hue-rotate(180deg) brightness(95%) contrast(90%);
            }
            .dark-mode-tiles img {
                background: #0e1216;
            }
            
            .leaflet-marker-icon,
            .leaflet-marker-shadow,
            .marker-cluster-small,
            .marker-cluster-medium,
            .marker-cluster-large {
                filter: none !important;
            }
        `;
        document.head.appendChild(style);

        nightLayer = L.tileLayer(appConfig.mapStyles.dayLayer, {
            attribution: appConfig.map.attribution,
            maxZoom: appConfig.map.maxZoom,
            crossOrigin: true,
            className: 'dark-mode-tiles'
        });

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

// Toggle Map Mode (Day, Night, Satellite) - now uses MapModule if available
function toggleMapMode() {
    if (window.MapModule && MapModule.toggleMapMode) {
        MapModule.toggleMapMode();
        // Sync currentMapMode from module
        currentMapMode = MapModule.getCurrentMapMode();
    } else {
        // Fallback to original implementation
        if (currentMapMode === 'day') {
            map.removeLayer(dayLayer);
            nightLayer.addTo(map);
            currentMapMode = 'night';
            toggleModeButton.textContent = 'Night';
        } else if (currentMapMode === 'night') {
            map.removeLayer(nightLayer);
            satelliteLayer.addTo(map);
            currentMapMode = 'satellite';
            toggleModeButton.textContent = 'Satellite';
        } else if (currentMapMode === 'satellite') {
            map.removeLayer(satelliteLayer);
            dayLayer.addTo(map);
            currentMapMode = 'day';
            toggleModeButton.textContent = 'Day';
        }
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

    /* // RE-ENABLED DEBUG LISTENER -> COMMENTING OUT AGAIN
    socket.onAny((eventName, ...args) => {
        console.log(`Received event \"${eventName}\":`, args);
    });
    */

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
        // Multiply Unix timestamp by 1000 for correct date comparison
        const callTimestamp = new Date(call.timestamp * 1000);
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
                        console.log(`[Track New Call] Tracking enabled. Enqueuing animation for call ID ${call.id}.`);
                        enqueueAnimation(marker, () => {
                            console.log(`[Track New Call] Animation completed. Calling handleMarkerVisibility for call ID ${call.id}.`);
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
        
        // Create correction link (admin only when auth enabled, always when auth disabled)
        let correctionLink = null;
        if (isAdminUser || !authEnabled) { // Show button for admin users OR when auth is disabled
            correctionLink = document.createElement('a');
            correctionLink.href = '#';
            correctionLink.className = authEnabled ? 'correction-link admin-only' : 'correction-link'; // Only add admin-only class when auth is enabled
            correctionLink.textContent = 'Edit Marker';
            correctionLink.title = authEnabled ? 'Admin Only - Edit Marker Location' : 'Edit Marker Location'; // Adjust title based on auth status
            // style.cssText is no longer needed here if using class
            correctionLink.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showCorrectionModal(call.id, marker);
            });
        }

        // Create timestamp container (right side)
        const timestampContainer = document.createElement('div');
        timestampContainer.className = 'popup-timestamp'; // Use class for styling
        timestampContainer.innerHTML = `<small>${formatTimestamp(call.timestamp)}</small>`;

        // Add links to the left container
        topLinksContainer.appendChild(streetViewLink);
        if (correctionLink) {
            topLinksContainer.appendChild(correctionLink);
        } else if (authEnabled) {
            // Show admin-only message for non-admin users when auth is enabled
            const adminOnlyMsg = document.createElement('span');
            adminOnlyMsg.className = 'admin-only-message';
            adminOnlyMsg.textContent = 'Admin Only';
            adminOnlyMsg.title = 'Edit Marker requires admin privileges';
            topLinksContainer.appendChild(adminOnlyMsg);
        }

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
                <!-- NEW: Live Feed Toggle Checkbox -->
                <div class="popup-live-feed-control">
                    <input type="checkbox" id="popup-live-feed-toggle-${call.id}" class="popup-live-feed-toggle" data-tg-id="${call.talk_group_id}">
                    <label for="popup-live-feed-toggle-${call.id}">Add to Live Feed</label> <!-- Changed Label Text -->
                </div>
                <button class="talkgroup-history-btn" data-talkgroup-id="${call.talk_group_id}" data-call-id="${call.id}" data-talkgroup-name="${call.talk_group_name || 'Unknown Talk Group'}">More Info</button>
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
            // console.log(`Popup opened for callId: ${call.id}`); // REMOVED THIS LOG
            // --- MODIFIED: Use call.id for audio URL ---
            initWaveSurfer(call.id, `/audio/${call.id}`, wavesurfers, () => { // Pass main wavesurfers object
                if (!isNewCallAudioMuted && this.shouldPlayAudio) {
                    playWaveSurferAudio(call.id, wavesurfers, this);
                }
            });

            const popupElement = this.getPopup().getElement();

            // Add listener for the history button *inside* popupopen
            const historyButton = popupElement.querySelector('.talkgroup-history-btn');
            if (historyButton) {
                 // Remove previous listener if any to prevent duplicates
                 historyButton.removeEventListener('click', handleShowTalkgroupHistory);
                 historyButton.addEventListener('click', handleShowTalkgroupHistory);
            }

            // ---- NEW: Setup Popup Live Feed Toggle ----
            const liveFeedToggle = popupElement.querySelector(`.popup-live-feed-toggle[data-tg-id="${call.talk_group_id}"]`);
            if (liveFeedToggle) {
                const talkgroupId = parseInt(call.talk_group_id, 10);
                // Set initial state
                liveFeedToggle.checked = liveFeedSelectedTalkgroups.has(talkgroupId);

                // Add change listener
                liveFeedToggle.addEventListener('change', function() {
                    if (this.checked) {
                        liveFeedSelectedTalkgroups.add(talkgroupId);
                        console.log(`[LiveFeed Popup] Added TG ID ${talkgroupId}. Current set:`, liveFeedSelectedTalkgroups);
                    } else {
                        liveFeedSelectedTalkgroups.delete(talkgroupId);
                        console.log(`[LiveFeed Popup] Removed TG ID ${talkgroupId}. Current set:`, liveFeedSelectedTalkgroups);
                    }
                    // Update main display visibility
                    updateLiveFeedDisplayVisibility();
                    // Update checkbox in modal if open
                    updateLiveFeedModalCheckbox(talkgroupId, this.checked);
                    // NEW: Update audio state based on selection
                    isLiveFeedAudioEnabled = liveFeedSelectedTalkgroups.size > 0;
                    console.log(`[LiveFeed] Audio state updated to: ${isLiveFeedAudioEnabled}`);
                });
            }
            // ---- END NEW ----
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

// LocationIQ Autocomplete Dropdown Function
function createLocationIQDropdown(inputElement, scope) {
  const dropdown = document.createElement('div');
  dropdown.className = 'locationiq-dropdown';
  dropdown.style.cssText = `
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    background-color: #000;
    border: 1px solid #00ff00;
    border-top: none;
    border-radius: 0 0 4px 4px;
    max-height: 200px;
    overflow-y: auto;
    z-index: 1000;
    display: none;
  `;
  
  // Insert dropdown after input
  inputElement.parentNode.insertBefore(dropdown, inputElement.nextSibling);
  
  let searchTimeout = null;
  let selectedIndex = -1;
  
  // Add input event listener
  inputElement.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    
    // Clear previous timeout
    if (searchTimeout) {
      clearTimeout(searchTimeout);
    }
    
    // Hide dropdown if query is too short
    if (query.length < appConfig.geocoding.minQueryLength) {
      dropdown.style.display = 'none';
      selectedIndex = -1;
      return;
    }
    
    // Debounce search
    searchTimeout = setTimeout(() => {
      searchLocationIQ(query, dropdown, inputElement, scope);
    }, 300);
  });
  
  // Handle keyboard navigation
  inputElement.addEventListener('keydown', (e) => {
    const items = dropdown.querySelectorAll('.locationiq-item');
    
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        updateSelection(items, selectedIndex);
        break;
      case 'ArrowUp':
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, -1);
        updateSelection(items, selectedIndex);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && items[selectedIndex]) {
          selectLocationIQItem(items[selectedIndex], inputElement, dropdown, scope);
        }
        break;
      case 'Escape':
        dropdown.style.display = 'none';
        selectedIndex = -1;
        break;
    }
  });
  
  // Handle clicks outside dropdown
  document.addEventListener('click', (e) => {
    if (!inputElement.contains(e.target) && !dropdown.contains(e.target)) {
      dropdown.style.display = 'none';
      selectedIndex = -1;
    }
  });
  
  return dropdown;
}

// Search LocationIQ API
  async function searchLocationIQ(query, dropdown, inputElement, scope) {
  try {
    // Get current map center for dynamic bias
    const mapCenter = map.getCenter();
    const biasLat = mapCenter.lat;
    const biasLon = mapCenter.lng;
    
    // Calculate viewbox around the bias point (roughly 50km radius)
    const viewboxRadius = 0.5; // degrees (roughly 50km)
    const viewbox = `${biasLon + viewboxRadius},${biasLat + viewboxRadius},${biasLon - viewboxRadius},${biasLat - viewboxRadius}`;
    
    console.log('[LocationIQ] Viewbox created:', viewbox, 'around point:', biasLat, biasLon);
    
    const params = new URLSearchParams({
      key: appConfig.geocoding.locationiqApiKey,
      q: query,
      countrycodes: appConfig.geocoding.locationiq.countrycodes,
      limit: appConfig.geocoding.locationiq.limit,
      format: 'json',
      lat: biasLat,
      lon: biasLon,
      bounded: 1,
      radius: appConfig.geocoding.locationiq.bias.radius,
      viewbox: viewbox
    });
    
    console.log('[LocationIQ] Using simplified API parameters...');
    
    // Debug: Log the URL being called
    const apiUrl = `https://us1.locationiq.com/v1/autocomplete?${params}`;
    console.log('[LocationIQ] API URL:', apiUrl.replace(appConfig.geocoding.locationiqApiKey, 'API_KEY_HIDDEN'));
    
    const response = await fetch(apiUrl);
    
    if (!response.ok) {
      throw new Error(`LocationIQ API error: ${response.status}`);
    }
    
    const results = await response.json();
    
    console.log('[LocationIQ] Number of results:', results.length);
    
    // Clear dropdown
    dropdown.innerHTML = '';
    
    if (results.length === 0) {
      dropdown.style.display = 'none';
      return;
    }
    
    // Add results to dropdown
    results.forEach((result, index) => {
      const item = document.createElement('div');
      item.className = 'locationiq-item';
      item.style.cssText = `
        padding: 8px 12px;
        cursor: pointer;
        border-bottom: 1px solid #333;
        color: #00ff00;
        font-family: 'Share Tech Mono', monospace;
        font-size: 12px;
      `;
      
      // Store coordinates in dataset
      item.dataset.lat = result.lat;
      item.dataset.lon = result.lon;
      
      item.innerHTML = `
        <div style="font-weight: bold; color: #00ccff;">${result.display_place || result.address?.name || 'Unknown'}</div>
        <div style="color: #888; font-size: 11px;">${result.display_address || result.display_name || ''}</div>
      `;
      
      item.addEventListener('click', () => {
        selectLocationIQItem(item, inputElement, dropdown, scope);
      });
      
      item.addEventListener('mouseenter', () => {
        selectedIndex = index;
        updateSelection(dropdown.querySelectorAll('.locationiq-item'), selectedIndex);
      });
      
      dropdown.appendChild(item);
    });
    
    dropdown.style.display = 'block';
    selectedIndex = -1;
    
  } catch (error) {
    console.error('[LocationIQ] Search error:', error);
    dropdown.style.display = 'none';
  }
}

// Select LocationIQ item
function selectLocationIQItem(item, inputElement, dropdown, scope) {
  const placeName = item.querySelector('div:first-child').textContent;
  const address = item.querySelector('div:last-child').textContent;
  
  // Get coordinates from the item's data
  const lat = parseFloat(item.dataset.lat);
  const lng = parseFloat(item.dataset.lon);
  
  if (isNaN(lat) || isNaN(lng)) {
    console.error('[LocationIQ] Invalid coordinates:', item.dataset);
    showNotification('Invalid location data received.', 'error');
    return;
  }
  
  // Update input value
  inputElement.value = `${placeName}, ${address}`;
  
  // Update variables in the startAddressSearch scope
  if (scope) {
    scope.newAddress = `${placeName}, ${address}`;
    scope.newLocation = L.latLng(lat, lng);
    
    // Update preview marker and map
    if (scope.previewMarker) {
      scope.previewMarker.setLatLng(scope.newLocation);
      map.setView(scope.newLocation, 17);
    }
    
    // Enable confirm button
    if (scope.confirmBtn) {
      scope.confirmBtn.style.opacity = '1';
      scope.confirmBtn.style.pointerEvents = 'auto';
    }
    
    console.log('[LocationIQ] New location set:', scope.newLocation);
    console.log('[LocationIQ] New address:', scope.newAddress);
    console.log('[LocationIQ] Confirm button enabled');
  }
  
  // Hide dropdown
  dropdown.style.display = 'none';
}

// Update selection in dropdown
function updateSelection(items, selectedIndex) {
  items.forEach((item, index) => {
    if (index === selectedIndex) {
      item.style.backgroundColor = '#003300';
      item.style.color = '#00ff00';
    } else {
      item.style.backgroundColor = 'transparent';
      item.style.color = '#00ff00';
    }
  });
}

async function startAddressSearch(callId, originalMarker, modal) {
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
    <div id="address-search-container" style="display: flex; justify-content: center; margin-bottom: 10px; padding: 0 15px;">
      <!-- Autocomplete element will be dynamically inserted here -->
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

  const confirmBtn = document.getElementById('confirm-address');
  let newLocation = previewMarker.getLatLng();
  let newAddress = '';

  try {
    // Create input element for autocomplete
    const searchContainer = document.getElementById('address-search-container');
    const inputElement = document.createElement('input');
    inputElement.type = 'text';
    inputElement.placeholder = 'Enter address...';
    inputElement.style.cssText = `
      width: 100%;
      padding: 8px 10px;
      background-color: #000;
      color: #00ff00;
      border: 1px solid #00ff00;
      border-radius: 4px;
      font-family: 'Share Tech Mono', monospace;
      font-size: 14px;
      box-sizing: border-box;
    `;
    searchContainer.appendChild(inputElement);

    // Initialize autocomplete based on available providers
    let autocompleteProvider = null;
    let autocompleteDropdown = null;

    // Check which providers are available
    const googleAvailable = appConfig.geocoding.googleApiKey && typeof google !== 'undefined' && google.maps && google.maps.places;
    const locationiqAvailable = appConfig.geocoding.locationiqApiKey;

    if (googleAvailable) {
      console.log('[Address Search] Using Google Places Autocomplete');
      autocompleteProvider = 'google';
      
      // Create Google Places autocomplete
      const autocomplete = new google.maps.places.Autocomplete(inputElement, {
        componentRestrictions: { country: "us" },
        fields: ['geometry', 'formatted_address']
      });

      // Add listener for place selection
      autocomplete.addListener('place_changed', () => {
        console.log('[Address Search] Google place changed event triggered');
        const place = autocomplete.getPlace();
        console.log('[Address Search] Selected Google place:', place);
        
        if (!place.geometry || !place.geometry.location) {
          console.error('[Address Search] No geometry data in Google place:', place);
          showNotification('No location data available for selected place.', 'error');
          return;
        }

        newAddress = place.formatted_address;
        newLocation = L.latLng(
          place.geometry.location.lat(),
          place.geometry.location.lng()
        );

        console.log('[Address Search] New location set:', newLocation);
        console.log('[Address Search] New address:', newAddress);

        previewMarker.setLatLng(newLocation);
        map.setView(newLocation, 17);
        confirmBtn.style.opacity = '1';
        confirmBtn.style.pointerEvents = 'auto';
        
        console.log('[Address Search] Confirm button enabled');
      });

    } else if (locationiqAvailable) {
      console.log('[Address Search] Using LocationIQ Autocomplete');
      autocompleteProvider = 'locationiq';
      
      // Create scope object to pass variables
      const scope = { newAddress, newLocation, previewMarker, confirmBtn };
      
      // Create LocationIQ autocomplete dropdown
      autocompleteDropdown = createLocationIQDropdown(inputElement, scope);
      
    } else {
      console.error('[Address Search] No autocomplete providers available');
      showNotification("No address search providers available. Please check API configuration.", "error");
      banner.remove();
      markerGroups.addLayer(originalMarker);
      return;
    }

    // Focus the input
    inputElement.focus();

    // Add a small delay to ensure autocomplete is ready
    setTimeout(() => {
      if (inputElement) {
        inputElement.focus();
      }
    }, 100);

  } catch (error) {
    console.error("Error loading address search component:", error);
    showNotification("Could not load address search component.", "error");
    banner.remove();
    markerGroups.addLayer(originalMarker);
    return;
  }

  function getOriginalAddress(lat, lng) {
    // Try Google first if available, then LocationIQ as fallback
    if (appConfig.geocoding.googleApiKey) {
      return fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${appConfig.geocoding.googleApiKey}`)
        .then(res => res.json())
        .then(data => {
          if (data.results && data.results.length > 0) {
            return data.results[0].formatted_address;
          } else {
            // Fallback to LocationIQ if Google returns no results
            return getLocationIQReverseGeocode(lat, lng);
          }
        })
        .catch(err => {
          console.error('Google reverse geocode error:', err);
          // Fallback to LocationIQ
          return getLocationIQReverseGeocode(lat, lng);
        });
    } else if (appConfig.geocoding.locationiqApiKey) {
      return getLocationIQReverseGeocode(lat, lng);
    } else {
      return Promise.resolve(`Unknown (${lat}, ${lng})`);
    }
  }

  function getLocationIQReverseGeocode(lat, lng) {
    const params = new URLSearchParams({
      key: appConfig.geocoding.locationiqApiKey,
      lat: lat,
      lon: lng,
      format: 'json'
    });
    
    return fetch(`https://us1.locationiq.com/v1/reverse?${params}`)
      .then(res => res.json())
      .then(data => {
        if (data.display_name) {
          return data.display_name;
        } else {
          return `Unknown (${lat}, ${lng})`;
        }
      })
      .catch(err => {
        console.error('LocationIQ reverse geocode error:', err);
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
    location: location, // Use 'location' as expected by the new endpoint
    address: address,   // Use 'address' as expected by the new endpoint
    action: 'marker_deletion'
  };

  fetch('/api/log/deletion', { // Changed endpoint to /api/log/deletion
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
    console.log('[Track New Call] smoothFlyToNewMarker started.');
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
                console.log('[Track New Call] Final animation step ended. Executing callback.');
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
    console.log('[Track New Call] handleMarkerVisibility started.');
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
    console.log('[Track New Call] processNextAnimation dequeuing and starting animation.');
    isAnimating = true;
    const { marker, callback } = animationQueue.shift();
    smoothFlyToNewMarker(marker, () => {
        callback();
        processNextAnimation();
    });
}

function enqueueAnimation(marker, callback) {
    console.log('[Track New Call] enqueueAnimation adding item to queue.');
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
                    initWaveSurfer(trans.id, `/audio/${trans.id}`, additionalWavesurfers); // Corrected: Use trans.id and pass store
                });
            }
        })
        .catch(error => {
            console.error('Error fetching additional transcriptions:', error);
            container.innerHTML += '<p>Error fetching additional information.</p>';
        });
}

function clearMarkers() {
    console.log(`[DEBUG] clearMarkers started`);
    console.log(`[DEBUG] Current markers count: ${Object.keys(markers).length}`);
    console.log(`[DEBUG] Current allMarkers count: ${Object.keys(allMarkers).length}`);
    
    // First, remove all pulse markers
    Object.keys(markers).forEach(callId => {
        if (markers[callId] && markers[callId].pulseMarker) {
            map.removeLayer(markers[callId].pulseMarker);
        }
    });
    
    // Then clear all regular markers
    markerGroups.clearLayers();
    Object.keys(markers).forEach(key => delete markers[key]);
    
    // Clear allMarkers object as well
    Object.keys(allMarkers).forEach(key => delete allMarkers[key]);

    // Clear heatmap data if it exists
    if (heatmapLayer) {
        heatmapLayer.setLatLngs([]);
    }
    
    console.log(`[DEBUG] clearMarkers completed`);
    console.log(`[DEBUG] Markers count after clear: ${Object.keys(markers).length}`);
    console.log(`[DEBUG] allMarkers count after clear: ${Object.keys(allMarkers).length}`);
}

function loadCalls(hours) {
    console.log(`[DEBUG] loadCalls started with hours: ${hours}`);
    console.log(`[DEBUG] Current allMarkers count before fetch: ${Object.keys(allMarkers).length}`);
    
    fetch(`/api/calls?hours=${hours}`)
        .then(response => response.json())
        .then(calls => {
            console.log(`[DEBUG] Received ${calls.length} calls from server`);
            if (calls.length > 0) {
                console.log(`[DEBUG] Oldest call received: ${calls[calls.length - 1].timestamp}`);
                console.log(`[DEBUG] Newest call received: ${calls[0].timestamp}`);
            }
            
            // Clear existing markers
            console.log(`[DEBUG] Clearing existing markers...`);
            clearMarkers();
            console.log(`[DEBUG] Markers cleared. allMarkers count after clear: ${Object.keys(allMarkers).length}`);
            
            // Reset newest call IDs
            newestCallIds = [];
            
            // Filter for valid calls
            const validCalls = calls.filter(isValidCall);
            console.log(`[DEBUG] ${validCalls.length} valid calls after filtering`);
            
            // Sort calls by timestamp (newest first)
            validCalls.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            // Add all markers to the map
            console.log(`[DEBUG] Adding ${validCalls.length} markers to map...`);
            validCalls.forEach(call => addMarker(call));
            console.log(`[DEBUG] Markers added. allMarkers count after adding: ${Object.keys(allMarkers).length}`);
            
            // Get the newest 3 call IDs
            newestCallIds = validCalls.slice(0, MAX_PULSING_MARKERS).map(call => call.id);
            console.log(`[DEBUG] Newest call IDs: ${newestCallIds}`);
            
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
            
            console.log(`[DEBUG] loadCalls completed successfully`);
        })
        .catch(error => {
            console.error('[DEBUG] Error loading calls:', error);
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
    // Multiply Unix timestamp by 1000
    const date = new Date(timestamp * 1000);
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
        const callTime = new Date(timestamp * 1000);
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
      // Add a small delay to prevent race condition with WaveSurfer init
      setTimeout(() => {
          // Ensure the marker still exists and is visible before opening
          if (allMarkers[getCallIdFromMarker(lastVisibleMarker)]?.visible) {
              openMarkerPopup(lastVisibleMarker);
          }
      }, 500); // 500ms delay
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

        // Remove all existing event listeners by cloning the slider
        const newIntensitySlider = intensitySlider.cloneNode(true);
        intensitySlider.parentNode.replaceChild(newIntensitySlider, intensitySlider);
        
        // Add specific heatmap intensity handler - NOT volume related
        newIntensitySlider.addEventListener('input', function(e) {
            // IMPORTANT: Only handle heatmap intensity, NOT volume
            heatmapIntensity = parseInt(this.value, 10);
            console.log(`[HEATMAP] Intensity changed to ${heatmapIntensity}`);
            
            if (document.getElementById('enable-heatmap').checked) {
                updateHeatmap();
            }
            
            // Update slider fill visual only
            updateSliderFill(this);
        });

        console.log("[HEATMAP] Heatmap controls initialized correctly");
    } else {
        console.error('[HEATMAP] Heatmap control elements not found');
    }
}

// Fixed handleIntensityChange to ONLY affect heatmap, not volume
function handleIntensityChange(event) {
    // ONLY handle heatmap intensity here, NOT volume
    heatmapIntensity = parseInt(event.target.value, 10);
    console.log(`[HEATMAP] Intensity handler called with value: ${heatmapIntensity}`);
    
    if (document.getElementById('enable-heatmap').checked) {
        updateHeatmap();
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
            // Be less verbose specifically for AbortError during cleanup
            if (e.name === 'AbortError') {
                 // console.warn(`Ignoring AbortError during destroy for ${callId}`); // Option to log silently
            } else {
                 console.warn(`Error destroying previous wavesurfer for ${callId}:`, e); // Log other errors
            }
        }
        delete wavesurferStore[callId];
    }

    try {
        // Create WaveSurfer instance
        wavesurferStore[callId] = WaveSurfer.create({
            container: `#${containerId}`, // Use the dynamic or default container ID
            waveColor: '#00ff00',
            progressColor: '#008000',
            cursorColor: '#ffffff',
            height: containerId.startsWith('tg-') ? 25 : 30, // Use smaller height for talkgroup modal
            normalize: true,
            backend: 'webaudio',
            volume: globalVolumeLevel, // Set initial volume from global setting
        });

        // console.log(`[Audio] Created new WaveSurfer instance for callId ${callId} with initial volume ${globalVolumeLevel}`); // REMOVED THIS LOG

        // Load audio file
        wavesurferStore[callId].load(audioUrl);

        // Find controls specific to this WaveSurfer instance (pop-up, modal, or dynamic content)
        let controlsContainer = containerElement.closest('.talkgroup-list-item, .custom-popup'); // Try standard parents first
        if (!controlsContainer) {
             // Fallback for dynamically added content (like "More Info") where the button might be a sibling or in a direct child
             controlsContainer = containerElement.parentElement.querySelector('.audio-controls') ? containerElement.parentElement : null;
        }
        
        if (!controlsContainer) {
            console.warn(`Could not find controls container for wavesurfer ${callId} using querySelector or closest.`);
            return;
        }
        // ADD LOG 1
        console.log(`[initWaveSurfer - ${callId}] Found controlsContainer:`, controlsContainer);

        const playPauseButton = controlsContainer.querySelector(`.play-pause[data-call-id="${callId}"]`);
        // ADD LOG 2
        console.log(`[initWaveSurfer - ${callId}] Found playPauseButton:`, playPauseButton);
        if (playPauseButton) {
            // Clone and replace to remove old listeners reliably
            const newButton = playPauseButton.cloneNode(true);
            playPauseButton.parentNode.replaceChild(newButton, playPauseButton);
            // ADD LOG 3
            console.log(`[initWaveSurfer - ${callId}] Adding click listener to button.`);
            newButton.addEventListener('click', function() {
                // ADD LOG 4
                console.log(`[Play Button Click - ${callId}] Clicked!`);
                // ADD LOG 5
                const instanceExists = !!wavesurferStore[callId];
                console.log(`[Play Button Click - ${callId}] Instance in store? ${instanceExists}`, wavesurferStore[callId]);
                
                if (!instanceExists) {
                    console.error(`[Play Button Click - ${callId}] CANNOT PLAY - Instance missing from store!`, wavesurferStore);
                    return; // Stop if instance is missing
                }

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

                    // Resume audio context if needed before playing
                    if (wavesurferStore[callId].backend && typeof wavesurferStore[callId].backend.getAudioContext === 'function') {
                        const audioContext = wavesurferStore[callId].backend.getAudioContext();
                        if (audioContext.state === 'suspended') {
                            audioContext.resume().then(() => {
                                console.log('[Audio] AudioContext resumed before playing wavesurfer audio');
                                wavesurferStore[callId].play();
                                this.textContent = 'Pause';
                            }).catch(e => {
                                console.error('[Audio] AudioContext resume failed:', e);
                                // Try to play anyway
                                wavesurferStore[callId].play();
                                this.textContent = 'Pause';
                            });
                        } else {
                            wavesurferStore[callId].play();
                            this.textContent = 'Pause';
                        }
                    } else {
                        wavesurferStore[callId].play();
                        this.textContent = 'Pause';
                    }
                }
            });
        }

        // WaveSurfer event listeners
        wavesurferStore[callId].on('ready', function() {
            // console.log(`WaveSurfer for callId ${callId} in container #${containerId} is ready.`); // REMOVED THIS LOG

            // Ensure volume is set correctly on ready
            try {
                // Use our global volume setter
                wavesurferStore[callId].setVolume(globalVolumeLevel);
                // console.log(`[VOLUME] Set volume for ready wavesurfer ${callId} to ${globalVolumeLevel}`); // REMOVED THIS LINE
            } catch (e) {
                console.error(`[VOLUME] Error setting volume for wavesurfer ${callId}:`, e);
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
            // ADD Check: Ignore AbortError as it's likely due to rapid cleanup/re-init
            if (error && error.name === 'AbortError') {
                // console.log(`[WaveSurfer ${callId}] Ignoring AbortError during load.`); // Optional: log if needed
                return; // Stop processing this specific error
            }
            // Log and display other errors
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
        // Get the wavesurfer instance
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
    const callIdToScrollTo = button.getAttribute('data-call-id'); // NEW

    if (talkgroupId) {
        showTalkgroupModal(parseInt(talkgroupId, 10), talkgroupName, callIdToScrollTo ? parseInt(callIdToScrollTo, 10) : null); // Pass callId
    } else {
        console.error("Talkgroup ID not found on button");
    }
}

// Global function to close the talkgroup modal
function closeTalkgroupModal() {
    const modal = document.getElementById('talkgroup-modal');
    const listElement = document.getElementById('talkgroup-list'); // Get list element
    if (modal) {
        modal.style.display = 'none';
    }
    // Remove scroll listener when closing
    if (listElement) {
        listElement.removeEventListener('scroll', handleTalkgroupScroll);
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
            ${call.id ? `  
                <div id="tg-waveform-${call.id}" class="waveform"></div>
                <div class="audio-controls">
                    <button class="play-pause" data-call-id="${call.id}" aria-label="Play audio">Play</button>
                    <!-- REMOVED: <input type="range" class="volume" min="0" max="1" step="0.1" value="1" data-call-id="${call.id}" aria-label="Volume control"> -->
                </div>
            ` : '<small>No audio file.</small>'}
        </div>
    `;

    // Initialize WaveSurfer if audio exists (check based on ID)
    if (call.id) { // Corrected: Check for call.id
        // Use setTimeout to ensure the element is in the DOM before WaveSurfer tries to attach
        setTimeout(() => {
            // Use call.id for audio URL
            initWaveSurfer(call.id, `/audio/${call.id}`, talkgroupModalWavesurfers, null, `tg-waveform-${call.id}`);
        }, 0);
    }

    return listItem;
}

// NEW: Function to show the talkgroup modal
function showTalkgroupModal(talkgroupId, talkgroupName, targetCallId = null) {
    const modal = document.getElementById('talkgroup-modal');
    const titleElement = document.getElementById('talkgroup-modal-title');
    const listElement = document.getElementById('talkgroup-list');

    if (!modal || !titleElement || !listElement) {
        console.error('Talkgroup modal elements not found!');
        return;
    }

    // Set title
    titleElement.textContent = talkgroupName || 'Talkgroup History';

    // --- Reset state and content ---
    listElement.innerHTML = '<div class="loading-placeholder">Loading history...</div>';
    isTalkgroupModalOpen = true;
    currentOpenTalkgroupId = talkgroupId;
    // Reset pagination state
    currentTalkgroupOffset = 0;
    isLoadingMoreTalkgroupCalls = false;
    hasMoreTalkgroupCalls = true; // Assume there might be more initially
    isSearchingForTargetCall = !!targetCallId; // NEW: Set based on if targetCallId is provided

    // Clear previous wavesurfers immediately before fetching new data
    Object.keys(talkgroupModalWavesurfers).forEach(callId => {
        if (talkgroupModalWavesurfers[callId]) {
            talkgroupModalWavesurfers[callId].destroy();
        }
    });
    for (let key in talkgroupModalWavesurfers) {
        delete talkgroupModalWavesurfers[key];
    }

    // --- Fetch initial page or start target search --- 
    listElement.innerHTML = '<div class="loading-placeholder">Loading history...</div>';

    // Define the recursive fetcher for finding the target
    async function fetchPageAndFindTarget(offset) {
        if (!isTalkgroupModalOpen || !isSearchingForTargetCall) {
            // Modal closed or search aborted/completed
            isLoadingMoreTalkgroupCalls = false;
            return;
        }

        isLoadingMoreTalkgroupCalls = true;
        if (offset === 0) { // Only show "Searching..." on the very first call of this recursive function
            listElement.innerHTML = '<div class="loading-placeholder">Searching for specific call...</div>';
        }
        
        const loadingIndicatorWhileSearching = document.createElement('div');
        if (offset > 0) { // Add a small indicator for subsequent fetches during search
            loadingIndicatorWhileSearching.className = 'loading-placeholder subtle-loader';
            loadingIndicatorWhileSearching.textContent = 'Loading more to find call...';
            listElement.appendChild(loadingIndicatorWhileSearching);
        }

        try {
            const response = await fetch(`/api/talkgroup/${talkgroupId}/calls?limit=${talkgroupPageLimit}&offset=${offset}`);
            const calls = await response.json();

            if (offset === 0 && listElement.querySelector('.loading-placeholder')) {
                listElement.innerHTML = ''; // Clear "Searching..." or initial "Loading..." placeholder
            }
            if (loadingIndicatorWhileSearching.parentNode) {
                loadingIndicatorWhileSearching.remove();
            }

            if (calls && calls.length > 0) {
                calls.forEach(call => {
                    const listItem = createTalkgroupListItem(call);
                    listElement.appendChild(listItem);
                });
                currentTalkgroupOffset += calls.length;
                hasMoreTalkgroupCalls = calls.length === talkgroupPageLimit;

                const targetElement = listElement.querySelector(`.talkgroup-list-item[data-call-id="${targetCallId}"]`);
                if (targetElement) {
                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    targetElement.classList.add('scrolled-to-highlight');
                    setTimeout(() => targetElement.classList.remove('scrolled-to-highlight'), 2500);
                    console.log(`[TalkgroupModal] Target call ID ${targetCallId} found and scrolled to.`);
                    isSearchingForTargetCall = false; // Target found, stop special search mode
                    isLoadingMoreTalkgroupCalls = false;
                    return; // Exit recursive search
                }
            }

            if (hasMoreTalkgroupCalls && isSearchingForTargetCall) {
                // Target not found yet, and more calls exist, and we are still in search mode
                fetchPageAndFindTarget(currentTalkgroupOffset); // Recursively fetch next page
            } else if (!hasMoreTalkgroupCalls && isSearchingForTargetCall) {
                // No more calls, and target not found
                console.log(`[TalkgroupModal] Target call ID ${targetCallId} not found in the entire history.`);
                // Optionally, add a message to the listElement
                const notFoundMsg = document.createElement('div');
                notFoundMsg.className = 'loading-placeholder';
                notFoundMsg.textContent = 'Target call not found in history.';
                listElement.appendChild(notFoundMsg);
                isSearchingForTargetCall = false;
                isLoadingMoreTalkgroupCalls = false;
            } else {
                 // This case means: either target was found (handled above), or no target search was active.
                 // Or, no more calls and search was not active.
                 isLoadingMoreTalkgroupCalls = false;
            }

        } catch (error) {
            console.error('Error fetching talkgroup page during target search:', error);
            if (loadingIndicatorWhileSearching.parentNode) loadingIndicatorWhileSearching.remove();
            const errorMsg = document.createElement('div');
            errorMsg.className = 'loading-placeholder error';
            errorMsg.textContent = 'Error searching for call.';
            if(listElement.innerHTML.includes('Searching for specific call')) listElement.innerHTML = ''; // Clear search message
            listElement.appendChild(errorMsg);
            isSearchingForTargetCall = false;
            isLoadingMoreTalkgroupCalls = false;
            hasMoreTalkgroupCalls = false; // Stop trying on error
        }
    }

    if (targetCallId) {
        fetchPageAndFindTarget(0); // Start the search for the target call
    } else {
        // No targetCallId, just load the first page normally
        isLoadingMoreTalkgroupCalls = true;
        fetch(`/api/talkgroup/${talkgroupId}/calls?limit=${talkgroupPageLimit}&offset=0`)
            .then(response => response.json())
            .then(calls => {
                listElement.innerHTML = ''; // Clear loading placeholder
                if (calls && calls.length > 0) {
                    calls.forEach(call => {
                        const listItem = createTalkgroupListItem(call);
                        listElement.appendChild(listItem);
                    });
                    currentTalkgroupOffset = calls.length;
                    hasMoreTalkgroupCalls = calls.length === talkgroupPageLimit;
                } else {
                    listElement.innerHTML = '<div class="loading-placeholder">No calls found for this talkgroup.</div>';
                    hasMoreTalkgroupCalls = false;
                }
            })
            .catch(error => {
                console.error('Error fetching initial talkgroup history:', error);
                listElement.innerHTML = '<div class="loading-placeholder error">Error loading call history.</div>';
                hasMoreTalkgroupCalls = false;
            })
            .finally(() => {
                isLoadingMoreTalkgroupCalls = false;
            });
    }

    // --- Add Scroll Listener --- 
    // Remove previous listener first (safety check)
    listElement.removeEventListener('scroll', handleTalkgroupScroll);
    listElement.addEventListener('scroll', handleTalkgroupScroll);

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

                        // Initialize WaveSurfer for the new item and provide the autoplay callback
                        if (call.id) { // Check if ID exists (audio should exist)
                           setTimeout(() => { // Keep setTimeout(0) to ensure newItem is in DOM
                               initWaveSurfer(
                                   call.id, 
                                   `/audio/${call.id}`, 
                                   talkgroupModalWavesurfers, 
                                   () => { // Define the onReadyCallback inline here
                                       if (talkgroupModalAutoplay && isTalkgroupModalOpen && currentOpenTalkgroupId === talkgroupId) {
                                            console.log(`[Autoplay] WaveSurfer ready for ${call.id}, attempting autoplay.`);
                                            playWaveSurferAudio(call.id, talkgroupModalWavesurfers);
                                       }
                                   }, 
                                   `tg-waveform-${call.id}`
                               );
                           }, 0);
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
    
    // Call Purge button click
    const callPurgeBtn = document.getElementById('call-purge-btn');
    if (callPurgeBtn) {
        callPurgeBtn.addEventListener('click', function(e) {
            e.preventDefault();
            showCallPurgeModal();
            dropdownContent.classList.remove('show');
        });
    }
    
    // Service Configuration button click
    const serviceConfigBtn = document.getElementById('service-config-btn');
    if (serviceConfigBtn) {
        serviceConfigBtn.addEventListener('click', function(e) {
            e.preventDefault();
            showServiceConfigModal();
            dropdownContent.classList.remove('show');
        });
    }
    
    // Quick Start button click
    const quickStartBtn = document.getElementById('quick-start-btn');
    if (quickStartBtn) {
        quickStartBtn.addEventListener('click', function(e) {
            e.preventDefault();
            showQuickStartModal();
            dropdownContent.classList.remove('show');
        });
    }
    
    // Settings button click
    const settingsBtn = document.getElementById('settings-btn');
    if (settingsBtn) {
        settingsBtn.addEventListener('click', function(e) {
            e.preventDefault();
            showSettingsModal();
            dropdownContent.classList.remove('show');
        });
    }
    
    // Setup modal forms
    setupAddUserForm();
    setupModalCancelButtons();
    setupCallPurgeModal();
    setupServiceConfigModal();
    setupQuickStartModal();
    setupSettingsModal();
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
// Function to check if current user is admin
async function checkAdminStatus() {
  try {
    const response = await fetch('/api/auth/is-admin');
    const data = await response.json();
    const wasAdmin = isAdminUser;
    const wasAuthEnabled = authEnabled;
    
    isAdminUser = data.isAdmin;
    authEnabled = data.authEnabled;
    
    console.log(`[Auth] Admin status: ${isAdminUser}, Auth enabled: ${authEnabled}`);
    
    // If admin status or auth status changed, update existing markers
    if (wasAdmin !== isAdminUser || wasAuthEnabled !== authEnabled) {
      updateExistingMarkersForAdminStatus();
    }
  } catch (error) {
    console.error('[Auth] Error checking admin status:', error);
    isAdminUser = false;
    authEnabled = false;
  }
}

// Function to update existing markers when admin status changes
function updateExistingMarkersForAdminStatus() {
  console.log(`[Auth] Updating existing markers for admin status: ${isAdminUser}`);
  
  // Update all existing markers
  Object.keys(markers).forEach(callId => {
    const marker = markers[callId];
    if (marker && marker.isPopupOpen()) {
      // If popup is open, close it to force refresh
      marker.closePopup();
    }
  });
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

// REMOVED DOMContentLoaded listener - initializeApp is called directly now
// document.addEventListener('DOMContentLoaded', initializeApp);

document.addEventListener('DOMContentLoaded', initializeApp); // Re-add DOMContentLoaded listener

// Register service worker with automatic cache clearing
if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
        try {
            // First, unregister all old service workers and clear old caches
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                // Unregister old service workers
                await registration.unregister();
                console.log('[Service Worker] Unregistered old service worker');
            }
            
            // Clear all old caches
            if ('caches' in window) {
                const cacheNames = await caches.keys();
                for (const cacheName of cacheNames) {
                    // Only delete old caches (not the current one)
                    if (cacheName !== 'scanner-map-v3.1.0') {
                        await caches.delete(cacheName);
                        console.log('[Service Worker] Deleted old cache:', cacheName);
                    }
                }
            }
            
            // Now register the new service worker
            const registration = await navigator.serviceWorker.register('/sw.js', {
                updateViaCache: 'none' // Always check for updates
            });
            
            console.log('[Service Worker] Registered successfully:', registration.scope);
            
            // Force update check on registration
            await registration.update();
            
            // Check for updates periodically
            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                console.log('[Service Worker] New worker found, installing...');
                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed') {
                        if (navigator.serviceWorker.controller) {
                            // New service worker available, activate it immediately
                            console.log('[Service Worker] New version available, activating...');
                            newWorker.postMessage({ type: 'SKIP_WAITING' });
                            // Reload page to use new service worker
                            window.location.reload();
                        } else {
                            // First time installation
                            console.log('[Service Worker] Installed successfully');
                        }
                    }
                });
            });
            
            // Listen for controller change (new service worker activated)
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                console.log('[Service Worker] New controller activated, reloading...');
                window.location.reload();
            });
            
        } catch (error) {
            console.error('[Service Worker] Registration failed:', error);
        }
    });
}

function initializeApp() {
    console.log("[App] Initializing..."); // Add log
    // Initialize configuration variables from the config
    timeRangeHours = appConfig.time.defaultTimeRangeHours;
    heatmapIntensity = appConfig.heatmap.defaultIntensity;
    
    // Initialize custom icons from config
    Object.assign(customIcons, createIconsFromConfig());
    
    // First ensure audio context is created
    initAudioContext();
    
    // Now we can safely set up the volume control
    setupVolumeControl();
    
    attemptAutoplay();
    initMap();
    setupCallsAndUpdates();
    setupSearch();
    setupCallControls();
    setupTimeFilter();
    setupHeatmapControls();
    setupLiveFeed();
    setupUserLocationButton(); // ADDED: Setup for the new location button
    loadCalls(timeRangeHours);
    setupUserManagement();
    setupSidebarToggle();

    // Initialize the category sidebar content dynamically
    updateCategoryCounts();
    
    // Start timestamp updates
    startTimestampUpdates();
    
    // Check admin status
    checkAdminStatus();
    
    // Set up periodic admin status check
    setInterval(checkAdminStatus, 30000); // Check every 30 seconds
    
    // Helper function to check and show Quick Start modal
    const checkAndShowQuickStart = () => {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('quickstart') === '1') {
            const modal = document.getElementById('quick-start-modal');
            if (modal && typeof showQuickStartModal === 'function') {
                console.log('[App] Auto-opening Quick Start modal from URL parameter');
                showQuickStartModal();
                // Remove the query parameter from URL (clean URL)
                window.history.replaceState({}, document.title, window.location.pathname);
                return true;
            }
            return false;
        }
        return true; // Not a quickstart URL, nothing to do
    };
    
    fetch('/api/sessions/current')
        .then(response => response.json())
        .then(data => {
            currentSessionToken = data.session?.token;
            setupSessionManagement();
            // Re-check admin status after session setup
            checkAdminStatus();
            
            // Try to show Quick Start modal after session setup completes
            if (!checkAndShowQuickStart()) {
                // If modal not ready, wait a bit and retry
                setTimeout(checkAndShowQuickStart, 500);
            }
        })
        .catch(error => {
            console.error('Error getting current session:', error);
            setupSessionManagement();
            
            // Try to show Quick Start modal even if session fetch failed
            if (!checkAndShowQuickStart()) {
                setTimeout(checkAndShowQuickStart, 500);
            }
        });
    
    loadCalls(timeRangeHours);
    
    // Also try to show Quick Start modal after a delay (in case session fetch is slow)
    setTimeout(() => {
        checkAndShowQuickStart();
    }, 2000);
}
// Function to load and display summary
function loadSummary() {
  fetch('/summary.json')
    .then(response => {
      if (!response.ok) {
        // Summary file doesn't exist yet (404) - this is normal on first run
        if (response.status === 404) {
          // Return a rejected promise with a special marker so we can handle it silently
          return Promise.reject({ status: 404, is404: true });
        }
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
      // Silently ignore 404 errors (summary file doesn't exist yet - normal on first run)
      if (error.is404 || (error.status === 404)) {
        return; // Don't log or display anything for 404
      }
      // Only log other errors
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

// Set up summary refresh interval (every 3 minutes)
setInterval(loadSummary, 180000); // Changed from 120000 (2 mins) to 180000 (3 mins)
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
    // Get the volume slider element - MUST BE DIFFERENT from heatmap slider
    const volumeSlider = document.getElementById('global-volume');
    if (!volumeSlider) {
        console.error("Global volume slider not found!");
        return;
    }
    
    if (volumeSlider.id === 'heatmap-intensity') {
        console.error("CRITICAL ERROR: Volume slider has wrong ID! Should be 'global-volume', not 'heatmap-intensity'");
        return;
    }
    
    // First remove all existing event listeners
    const newSlider = volumeSlider.cloneNode(true);
    if (volumeSlider.parentNode) {
        volumeSlider.parentNode.replaceChild(newSlider, volumeSlider);
    } else {
        console.error("Slider has no parent node!");
        return;
    }
    
    // For clarity, add a custom attribute
    newSlider.setAttribute('data-slider-type', 'volume');
    
    // Set initial slider value
    newSlider.value = globalVolumeLevel;
    updateSliderFill(newSlider);
    
    // Single event handler function for all volume change events
    const handleVolumeChange = function(e) {
        // Validate this is the correct slider
        if (this.id !== 'global-volume') {
            console.error(`Wrong slider triggered volume change! ID: ${this.id}`);
            return;
        }
        
        const value = parseFloat(this.value);
        
        // Apply the volume
        setGlobalVolume(value);
        
        // Prevent event from bubbling up to avoid conflict with other sliders
        e.stopPropagation();
    };
    
    // Use multiple events for complete browser compatibility
    newSlider.addEventListener('input', handleVolumeChange);
    newSlider.addEventListener('change', handleVolumeChange);
    
    // Also add mouseup and touchend events to catch all possible interactions
    newSlider.addEventListener('mouseup', handleVolumeChange);
    newSlider.addEventListener('touchend', handleVolumeChange);
    
    // Initialize by applying the current volume globally
    setGlobalVolume(globalVolumeLevel);
}

// Global function to set all audio volumes
function setGlobalVolume(volume) {
    // Clamp volume to 0-1 range
    volume = Math.max(0, Math.min(1, parseFloat(volume)));
    
    // Update global variable
    globalVolumeLevel = volume;
    
    // Update all gain nodes if they exist
    if (window.audioContext && window.globalGainNode) {
        try {
            // Immediately set the value property
            window.globalGainNode.gain.value = volume;
            
            // Also use the time-based method for smooth transitions
            window.globalGainNode.gain.setValueAtTime(volume, window.audioContext.currentTime);
        } catch (err) {
            console.error("Error setting gain node volume:", err);
        }
    }
    
    // Update all wavesurfer instances in main map
    Object.keys(wavesurfers).forEach(callId => {
        if (wavesurfers[callId]) {
            try {
                wavesurfers[callId].setVolume(volume);
            } catch (err) {
                console.warn(`Error setting volume for wavesurfer ${callId}:`, err);
            }
        }
    });
    
    // Update all wavesurfer instances in talkgroup modal
    Object.keys(talkgroupModalWavesurfers).forEach(callId => {
        if (talkgroupModalWavesurfers[callId]) {
            try {
                talkgroupModalWavesurfers[callId].setVolume(volume);
            } catch (err) {
                console.warn(`Error setting volume for modal wavesurfer ${callId}:`, err);
            }
        }
    });
    
    // Update any volume sliders that may exist
    const volumeSlider = document.getElementById('global-volume');
    if (volumeSlider && volumeSlider.value !== volume.toString()) {
        volumeSlider.value = volume;
        updateSliderFill(volumeSlider);
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

    // Check each element individually
    liveFeedSetupBtn = document.getElementById('live-feed-setup-btn');
    if (!liveFeedSetupBtn) console.error("[LiveFeed] Failed to find #live-feed-setup-btn");

    liveFeedModal = document.getElementById('live-feed-modal');
    if (!liveFeedModal) console.error("[LiveFeed] Failed to find #live-feed-modal");

    liveFeedSearchInput = document.getElementById('live-feed-search');
    if (!liveFeedSearchInput) console.error("[LiveFeed] Failed to find #live-feed-search");

    liveFeedTalkgroupListContainer = document.getElementById('live-feed-talkgroup-list');
    if (!liveFeedTalkgroupListContainer) console.error("[LiveFeed] Failed to find #live-feed-talkgroup-list");

    liveFeedDisplayContainer = document.getElementById('live-feed-display');
    if (!liveFeedDisplayContainer) console.error("[LiveFeed] Failed to find #live-feed-display");

    // Check if ALL required elements were found
    if (!liveFeedSetupBtn || !liveFeedModal || !liveFeedSearchInput || !liveFeedTalkgroupListContainer || !liveFeedDisplayContainer) {
        console.error("[LiveFeed] Initialization failed due to missing elements.");
        return; // Stop setup if elements are missing
    }

    console.log("[LiveFeed] All required elements found.");

    // --- REMOVING DEBUG LOG ---
    // console.log("[LiveFeed] Value of liveFeedSetupBtn before addEventListener:", liveFeedSetupBtn);
    // --- END DEBUG LOG ---

    // Listener to open the modal
    try { // Add try-catch for more detailed error
        liveFeedSetupBtn.addEventListener('click', openLiveFeedModal);
    } catch (error) {
        console.error("[LiveFeed] Error adding event listener to liveFeedSetupBtn:", error);
        console.error("[LiveFeed] liveFeedSetupBtn value at time of error:", liveFeedSetupBtn);
    }

    // Listeners within the modal
    // --- REMOVING DEBUG LOG ---
    // console.log("[LiveFeed] Value of liveFeedSearchInput before addEventListener:", liveFeedSearchInput);
    // --- END DEBUG LOG ---
    try { // Add try-catch for more detailed error
        liveFeedSearchInput.addEventListener('input', handleLiveFeedSearch);
    } catch (error) {
        console.error("[LiveFeed] Error adding event listener to liveFeedSearchInput:", error);
        console.error("[LiveFeed] liveFeedSearchInput value at time of error:", liveFeedSearchInput);
    }


    // Initial state setup
    // REMOVED: liveFeedEnableCheckbox.checked = isLiveFeedEnabled;
    updateLiveFeedDisplayVisibility(); // Use helper function for initial state

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
    updateLiveFeedDisplayVisibility(); // Call the new visibility function

    // NEW: Update audio state based on selection
    isLiveFeedAudioEnabled = liveFeedSelectedTalkgroups.size > 0;
    console.log(`[LiveFeed] Audio state updated to: ${isLiveFeedAudioEnabled}`);

    /* // OLD Logic - replaced by updateLiveFeedDisplayVisibility()
    if (liveFeedDisplayContainer) { // Add safety check
        liveFeedDisplayContainer.style.display = liveFeedSelectedTalkgroups.size > 0 ? 'flex' : 'none';
        // Optional: Clear display if no TGs are selected
        if (liveFeedSelectedTalkgroups.size === 0) {
            liveFeedDisplayContainer.innerHTML = '';
        }
    }
    */
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

    const existingItem = liveFeedDisplayContainer.querySelector(`#live-feed-item-${call.id}`);
    if (existingItem) {
        // console.log(`[LiveFeed] Item ${call.id} already displayed. Skipping duplicate.`);
        return; // Avoid adding duplicates if event fires rapidly
    }

    const newItem = document.createElement('div');
    newItem.className = 'live-feed-item';
    newItem.id = `live-feed-item-${call.id}`; // Assign an ID for easy targeting

    // Wrap content in a span for measurement and scrolling
    const contentSpan = document.createElement('span');
    contentSpan.className = 'scroll-content';
    // Initial content based on whether transcription is pending
    const initialTranscription = (call.transcription && call.transcription !== "[Transcription Pending...]") 
                               ? call.transcription 
                               : "[Transcription Pending...]";
    contentSpan.innerHTML = `<strong>${call.talk_group_name || 'Unknown TG'}</strong>: <span class="transcription-text">${initialTranscription}</span>`;
    newItem.appendChild(contentSpan);

    liveFeedDisplayContainer.prepend(newItem);

    // Check for overflow AFTER adding to DOM and applying styles
    requestAnimationFrame(() => {
        const itemWidth = newItem.clientWidth;
        const contentWidth = contentSpan.scrollWidth;
        if (contentWidth > itemWidth) {
            newItem.classList.add('scrolling');
            const scrollSpeed = 50;
            const duration = contentWidth / scrollSpeed;
            contentSpan.style.animationDuration = `${Math.max(5, duration)}s`;
        }
    });

    while (liveFeedDisplayContainer.children.length > MAX_LIVE_FEED_ITEMS) {
        liveFeedDisplayContainer.removeChild(liveFeedDisplayContainer.lastElementChild);
    }

    // Setup removal timer
    const removalTimeoutId = setTimeout(() => {
        newItem.classList.add('fading-out');
        setTimeout(() => {
            if (newItem.parentNode === liveFeedDisplayContainer) {
                liveFeedDisplayContainer.removeChild(newItem);
            }
        }, 1500);
    }, LIVE_FEED_ITEM_DURATION - 1500);

    // Retry logic if transcription is pending
    if (initialTranscription === "[Transcription Pending...]") {
        attemptLiveFeedRetry(call.id, newItem, 0, removalTimeoutId);
    }

    // Live Audio Logic
    if (isLiveFeedAudioEnabled && call.id && call.transcription !== "[Transcription Pending...]") { 
        // Only play audio if transcription is not pending initially
        // console.log(`[LiveFeed] Attempting live audio for TG ${call.talk_group_id}, Call ${call.id}`);
        playLiveAudio(call);
    }
}

function attemptLiveFeedRetry(callId, itemElement, retryCount, removalTimeoutId) {
    if (!itemElement || !itemElement.parentNode) {
        // console.log(`[LiveFeed Retry] Item ${callId} no longer in DOM. Stopping retries.`);
        return; // Item removed, stop retrying
    }
    if (retryCount >= MAX_LIVE_FEED_RETRIES) {
        // console.log(`[LiveFeed Retry] Max retries reached for ${callId}.`);
        return; // Max retries reached
    }

    setTimeout(async () => {
        // Double check item is still in DOM before fetch
        if (!itemElement || !itemElement.parentNode) return;

        try {
            // console.log(`[LiveFeed Retry] Attempt ${retryCount + 1} for call ID ${callId}`);
            const response = await fetch(`/api/call/${callId}/details`);
            if (!response.ok) {
                // console.warn(`[LiveFeed Retry] API error for ${callId}: ${response.status}`);
                // Optionally retry on certain server errors, or just give up
                if (response.status !== 404) { // Don't retry if call truly not found
                    // Recursive call for next attempt
                    attemptLiveFeedRetry(callId, itemElement, retryCount + 1, removalTimeoutId);
                }
                return;
            }
            const callDetails = await response.json();

            // Check again if item is still in DOM after await
            if (!itemElement || !itemElement.parentNode) return;

            if (callDetails && callDetails.transcription && callDetails.transcription !== "[Transcription Pending...]") {
                // console.log(`[LiveFeed Retry] SUCCESS for ${callId}. New transcription: ${callDetails.transcription}`);
                const contentSpan = itemElement.querySelector('.scroll-content');
                const transcriptionSpan = contentSpan ? contentSpan.querySelector('.transcription-text') : null;
                if (transcriptionSpan) {
                    transcriptionSpan.textContent = callDetails.transcription;
                    // Re-evaluate scrolling if content changed
                    requestAnimationFrame(() => {
                        const itemWidth = itemElement.clientWidth;
                        const newContentWidth = contentSpan.scrollWidth;
                        if (newContentWidth > itemWidth && !itemElement.classList.contains('scrolling')) {
                            itemElement.classList.add('scrolling');
                            const scrollSpeed = 50;
                            const duration = newContentWidth / scrollSpeed;
                            contentSpan.style.animationDuration = `${Math.max(5, duration)}s`;
                        } else if (newContentWidth <= itemWidth && itemElement.classList.contains('scrolling')) {
                            itemElement.classList.remove('scrolling');
                            contentSpan.style.animationDuration = '';
                        }
                    });
                    // Play audio now that transcription is available, if it wasn't played before
                    if (isLiveFeedAudioEnabled && callId) { 
                        playLiveAudio(callDetails); // Pass full details in case playLiveAudio needs more than ID
                    }
                }
            } else {
                // Still pending, retry if not maxed out
                // console.log(`[LiveFeed Retry] Still pending for ${callId}. Retrying...`);
                attemptLiveFeedRetry(callId, itemElement, retryCount + 1, removalTimeoutId);
            }
        } catch (error) {
            console.error(`[LiveFeed Retry] Fetch error for ${callId}:`, error);
            // Potentially retry on network errors too
            attemptLiveFeedRetry(callId, itemElement, retryCount + 1, removalTimeoutId);
        }
    }, LIVE_FEED_RETRY_INTERVAL);
}

// playLiveAudio function (use window.audioContext)
function playLiveAudio(call) {
    // --- Ensure AudioContext exists --- 
    if (!window.audioContext) {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            window.audioContext = new AudioContext();
            // Need to ensure GainNode is also ready if context was just created
            initGlobalGainNode(); 
        } catch (e) {
             console.error('Failed to create AudioContext:', e);
             return; // Cannot proceed without context
        }
    }

    // Resume if suspended
    if (window.audioContext.state === 'suspended') { 
        window.audioContext.resume().catch(e => console.warn('AudioContext resume failed:', e));
    }
    
    const audioUrl = `/audio/${call.id}`; // Corrected: Use call.id
    
    fetch(audioUrl)
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.arrayBuffer();
        })
        .then(arrayBuffer => {
            if (!arrayBuffer || arrayBuffer.byteLength === 0) { 
                 throw new Error("Received invalid audio data");
            }
            return window.audioContext.decodeAudioData(arrayBuffer); 
        })
        .then(audioBuffer => {
            const source = window.audioContext.createBufferSource(); 
            source.buffer = audioBuffer;
            
            if (window.globalGainNode) {
                const destinationNode = window.globalGainNode;
                // Force gain value to match global setting
                destinationNode.gain.value = globalVolumeLevel;
                
                source.connect(destinationNode);
                source.start(0);
            } else {
                // Fallback to connect directly to destination, but volume won't work
                source.connect(window.audioContext.destination);
                source.start(0);
            }
        })
        .catch(error => {
            console.error(`Error playing live audio for call ID ${call.id}:`, error);
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

// DEBUG: Volume testing functions
function debugVolume(newVolume) {
    if (newVolume !== undefined) {
        setGlobalVolume(newVolume);
        console.log(`%c[VOLUME DEBUG] Set volume to ${newVolume}`, 'color: green; font-weight: bold');
        
        // Also update the slider directly
        const slider = document.getElementById('global-volume');
        if (slider) {
            slider.value = newVolume;
            updateSliderFill(slider);
            console.log(`%c[VOLUME DEBUG] Slider value set to ${slider.value}`, 'color: green;');
        } else {
            console.log(`%c[VOLUME DEBUG] Could not find slider element!`, 'color: red;');
        }
    } else {
        console.log(`%c[VOLUME DEBUG] Current volume level: ${globalVolumeLevel}`, 'color: blue; font-weight: bold');
        console.log(`%c[VOLUME DEBUG] AudioContext:`, 'color: blue');
        console.log(window.audioContext ? window.audioContext : 'Not initialized');
        console.log(`%c[VOLUME DEBUG] GainNode:`, 'color: blue');
        console.log(window.globalGainNode ? window.globalGainNode : 'Not initialized');
        if (window.globalGainNode) {
            console.log(`%c[VOLUME DEBUG] GainNode value: ${window.globalGainNode.gain.value}`, 'color: green');
        }
        
        // Check slider status
        const slider = document.getElementById('global-volume');
        if (slider) {
            console.log(`%c[VOLUME DEBUG] Slider found: id=${slider.id}, value=${slider.value}`, 'color: green;');
            console.log(slider);
            
            // Try to set up the slider again
            console.log(`%c[VOLUME DEBUG] Attempting to fix slider...`, 'color: orange;');
            setupGlobalVolumeControl();
        } else {
            console.log(`%c[VOLUME DEBUG] Slider not found in DOM!`, 'color: red;');
        }
    }
    
    return "Volume debugging complete";
}

// Make debugVolume available globally
window.debugVolume = debugVolume;

// Function to handle authentication state changes (can be called from login/logout)
window.handleAuthStateChange = function() {
    console.log('[Auth] Authentication state changed, checking admin status...');
    checkAdminStatus();
};

// Global function to set all audio volumes
function setGlobalVolume(volume) {
    // Clamp volume to 0-1 range
    volume = Math.max(0, Math.min(1, parseFloat(volume)));
    
    // Update global variable
    globalVolumeLevel = volume;
    // console.log(`[VOLUME] Setting global volume to ${volume}`); // REMOVE THIS LINE

    // Update all gain nodes if they exist
    if (window.audioContext && window.globalGainNode) {
        try {
            // Immediately set the value property
            window.globalGainNode.gain.value = volume;

            // Also use the time-based method for smooth transitions
            window.globalGainNode.gain.setValueAtTime(volume, window.audioContext.currentTime);
            // console.log(`[VOLUME] Applied to gain node: ${window.globalGainNode.gain.value}`); // REMOVE THIS LINE
        } catch (err) {
            console.error("[VOLUME] Error setting gain node volume:", err);
        }
    }
    
    // Update all wavesurfer instances in main map
    Object.keys(wavesurfers).forEach(callId => {
        if (wavesurfers[callId]) {
            try {
                wavesurfers[callId].setVolume(volume);
            } catch (err) {
                console.warn(`[VOLUME] Error setting volume for wavesurfer ${callId}:`, err);
            }
        }
    });
    
    // Update all wavesurfer instances in talkgroup modal
    Object.keys(talkgroupModalWavesurfers).forEach(callId => {
        if (talkgroupModalWavesurfers[callId]) {
            try {
                talkgroupModalWavesurfers[callId].setVolume(volume);
            } catch (err) {
                console.warn(`[VOLUME] Error setting volume for modal wavesurfer ${callId}:`, err);
            }
        }
    });
    
    // Update any volume sliders that may exist
    const volumeSlider = document.getElementById('global-volume');
    if (volumeSlider && volumeSlider.value !== volume.toString()) {
        volumeSlider.value = volume;
        updateSliderFill(volumeSlider);
    }
}

// NEW CLEANER IMPLEMENTATION - Setup audio volume controls
function setupVolumeControl() {
    // Get the volume slider
    const slider = document.getElementById('global-volume');
    if (!slider) {
        console.error("Volume slider not found in DOM");
        return;
    }
    
    // Verify it's not the heatmap slider
    if (slider.id === 'heatmap-intensity') {
        console.error("Wrong slider found - got heatmap slider instead of volume");
        return;
    }
    
    // Clear any existing listeners by replacing the element
    const newSlider = slider.cloneNode(true);
    if (slider.parentNode) {
        slider.parentNode.replaceChild(newSlider, slider);
    } else {
        console.error("Slider has no parent node");
        return;
    }
    
    // Set initial values
    newSlider.value = globalVolumeLevel;
    updateSliderFill(newSlider);
    
    // Add a single event handler for volume changes
    const volumeChangeHandler = function(e) {
        // Just call our global volume setter
        setGlobalVolume(parseFloat(this.value));
        
        // Update the slider fill
        updateSliderFill(this);
        
        // Prevent event bubbling
        e.stopPropagation();
    };
    
    // Add only the input and change events (no mouseup/touchend)
    newSlider.addEventListener('input', volumeChangeHandler);
    newSlider.addEventListener('change', volumeChangeHandler);
}

// --- NEW Live Feed Helper Functions ---

// Shows/hides the main live feed display area based on selections
function updateLiveFeedDisplayVisibility() {
    if (!liveFeedDisplayContainer) return;
    liveFeedDisplayContainer.style.display = liveFeedSelectedTalkgroups.size > 0 ? 'flex' : 'none';
    // Optional: Clear display if no TGs are selected and it's being hidden
    if (liveFeedSelectedTalkgroups.size === 0) {
        liveFeedDisplayContainer.innerHTML = '';
    }
}

// Updates the corresponding checkbox in the Live Feed setup modal
function updateLiveFeedModalCheckbox(talkgroupId, isSelected) {
    const modalCheckbox = document.querySelector(`#live-feed-modal #live-feed-tg-${talkgroupId}`);
    if (modalCheckbox) {
        modalCheckbox.checked = isSelected;
    }
}

// --- NEW: Scroll Handling Functions --- 
function handleTalkgroupScroll() {
    const listElement = document.getElementById('talkgroup-list');
    if (!listElement) return;

    // Calculate how close to bottom: scrollHeight - currentScrollTop <= clientHeight + threshold
    const scrollThreshold = 200; // Pixels from bottom to trigger load
    const nearBottom = listElement.scrollHeight - listElement.scrollTop <= listElement.clientHeight + scrollThreshold;

    // console.log(`Scroll check: nearBottom=${nearBottom}, isLoading=${isLoadingMoreTalkgroupCalls}, hasMore=${hasMoreTalkgroupCalls}, isSearching=${isSearchingForTargetCall}`);

    if (nearBottom && !isLoadingMoreTalkgroupCalls && hasMoreTalkgroupCalls && !isSearchingForTargetCall) {
        console.log('[TalkgroupModal] Reached bottom, fetching more calls...');
        fetchMoreTalkgroupCalls();
    }
}

function fetchMoreTalkgroupCalls() {
    if (!currentOpenTalkgroupId) return; // Should not happen, but safety check

    isLoadingMoreTalkgroupCalls = true;
    const listElement = document.getElementById('talkgroup-list');
    
    // Add loading indicator
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-placeholder';
    loadingIndicator.textContent = 'Loading more...';
    if (listElement) listElement.appendChild(loadingIndicator);

    const nextOffset = currentTalkgroupOffset; // Offset is the number of items already loaded
    const fetchUrl = `/api/talkgroup/${currentOpenTalkgroupId}/calls?limit=${talkgroupPageLimit}&offset=${nextOffset}`;
    console.log(`[TalkgroupModal] Fetching next page: ${fetchUrl}`);

    fetch(fetchUrl)
        .then(response => response.json())
        .then(calls => {
            if (calls && calls.length > 0) {
                calls.forEach(call => {
                    const listItem = createTalkgroupListItem(call);
                    if (listElement) listElement.appendChild(listItem);
                });
                // Update offset
                currentTalkgroupOffset += calls.length;
                // Check if there might be more
                hasMoreTalkgroupCalls = calls.length === talkgroupPageLimit;
            } else {
                // No more calls returned
                hasMoreTalkgroupCalls = false;
                if (listElement) {
                    loadingIndicator.textContent = 'End of history.';
                    // Optionally remove the indicator after a delay
                    setTimeout(() => loadingIndicator.remove(), 3000);
                }
            }
        })
        .catch(error => {
            console.error('Error fetching more talkgroup calls:', error);
            if (loadingIndicator) loadingIndicator.textContent = 'Error loading more.';
             hasMoreTalkgroupCalls = false; // Stop trying on error
        })
        .finally(() => {
            isLoadingMoreTalkgroupCalls = false;
            // Remove loading indicator unless it was changed to "End of history" or "Error"
             if (loadingIndicator && loadingIndicator.textContent === 'Loading more...') {
                 loadingIndicator.remove();
             }
        });
}
// --- END NEW: Scroll Handling Functions ---

// NEW: User Location Feature
function setupUserLocationButton() {
    const LocationControl = L.Control.extend({
        options: {
            position: 'topright' // CHANGED to topright
        },
        onAdd: function (mapInstance) {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control-custom');
            container.id = 'location-control-container'; // ADD THIS LINE
            this._mapInstance = mapInstance; // Store map reference

            // Initialize control-specific state variables
            this.isUserLocationActive = false; // ADDED
            this.hasCenteredOnUserLocation = false; // ADDED
            this.userLocationMarker = null; // ADDED
            this.userLocationWatchId = null; // ADDED
            // REMOVED: this._isProcessingClick = false;

            this._locationButton = L.DomUtil.create('a', 'location-button', container);
            // Ensure NO INLINE FILL on the path, CSS will control it.
            this._locationButton.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M12,8A4,4 0 0,0 8,12A4,4 0 0,0 12,16A4,4 0 0,0 16,12A4,4 0 0,0 12,8M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4Z" /></svg>';
            this._locationButton.href = '#';
            this._locationButton.role = 'button';
            this._locationButton.title = 'Toggle My Location';

            // Store the bound function for adding/removing listener
            this._boundToggleUserLocation = this._toggleUserLocation.bind(this);

            L.DomEvent.on(this._locationButton, 'click', L.DomEvent.stopPropagation)
                      .on(this._locationButton, 'click', L.DomEvent.preventDefault)
                      .on(this._locationButton, 'click', this._boundToggleUserLocation, this) // USE BOUND HANDLER
                      .on(this._locationButton, 'dblclick', L.DomEvent.stopPropagation);
            return container;
        },

        _toggleUserLocation: function () {
            // REMOVED _isProcessingClick check
            console.log('[LocationControl] _toggleUserLocation called. isUserLocationActive:', this.isUserLocationActive);

            if (this.isUserLocationActive) { 
                this._stopWatchingLocation();
            } else {
                this._startWatchingLocation();
            }
            // REMOVED setTimeout for _isProcessingClick
        },

        _startWatchingLocation: function () {
            console.log('[LocationControl] _startWatchingLocation called.'); 
            if (navigator.geolocation) {
                this.hasCenteredOnUserLocation = false; // CHANGED to this.
                const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 };
                this.userLocationWatchId = navigator.geolocation.watchPosition( // CHANGED to this.
                    (position) => this._updateUserLocationDisplay(position),
                    (error) => this._handleLocationError(error),
                    options
                );
                this.isUserLocationActive = true; // CHANGED to this.
                L.DomUtil.addClass(this._locationButton, 'active');
                console.log('[LocationControl] Added "active" class. Button classes:', this._locationButton.className);
                showNotification('Tracking your location...', 'success');
            } else {
                showNotification('Geolocation is not supported by your browser.', 'error');
                this._stopWatchingLocation(); 
                // this._isProcessingClick = false; // Already handled by setTimeout in _toggleUserLocation
            }
        },

        _stopWatchingLocation: function () {
            console.log('[LocationControl] _stopWatchingLocation CALLED (Top of function)'); 
            console.log('[LocationControl] At stop: userLocationWatchId is:', this.userLocationWatchId);
            console.log('[LocationControl] At stop: userLocationMarker is:', this.userLocationMarker);

            if (navigator.geolocation && this.userLocationWatchId !== null) { 
                console.log('[LocationControl] Attempting to clear watch ID:', this.userLocationWatchId);
                navigator.geolocation.clearWatch(this.userLocationWatchId); 
                console.log('[LocationControl] Geolocation watch clearWatch called.'); // Confirms clearWatch was called
            } else {
                console.log('[LocationControl] Skipped clearWatch. Has geolocation? ', navigator.geolocation, 'Watch ID null? ', this.userLocationWatchId === null);
            }

            if (this.userLocationMarker) { 
                console.log('[LocationControl] userLocationMarker exists. Attempting to remove from map.');
                if (this._mapInstance && this._mapInstance.hasLayer(this.userLocationMarker)) { 
                    this._mapInstance.removeLayer(this.userLocationMarker); 
                    console.log('[LocationControl] User location marker removeLayer called.'); // Confirms removeLayer was called
                } else {
                    console.log('[LocationControl] Skipped removeLayer. Map instance? ', !!this._mapInstance, 'Marker on map? ', this._mapInstance ? this._mapInstance.hasLayer(this.userLocationMarker) : 'N/A');
                }
                this.userLocationMarker = null; 
                console.log('[LocationControl] userLocationMarker set to null.');
            } else {
                console.log('[LocationControl] userLocationMarker was null or undefined already.');
            }

            this.userLocationWatchId = null; 
            this.isUserLocationActive = false; 
            if (this._locationButton) { 
              L.DomUtil.removeClass(this._locationButton, 'active');
              console.log('[LocationControl] Removed "active" class. Button classes:', this._locationButton.className);
            } else {
              console.log('[LocationControl] _stopWatchingLocation: _locationButton not found.');
            }
        },

        _updateUserLocationDisplay: function (position) {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;

            if (!this._mapInstance) return; 

            if (!this.userLocationMarker) { 
                const userLocationIcon = L.icon.userLocationPulse({
                    iconSize: [16, 16], 
                    color: '#007bff', 
                    heartbeat: 1.2 
                });
                this.userLocationMarker = L.marker([lat, lon], { 
                    icon: userLocationIcon, 
                    zIndexOffset: 2000, 
                    interactive: false
                }).addTo(this._mapInstance);
            } else {
                this.userLocationMarker.setLatLng([lat, lon]); 
            }

            if (!this.hasCenteredOnUserLocation) { 
                console.log('[LocationControl] Centering map. Disabling button click temporarily.');

                this._mapInstance.setView([lat, lon], USER_LOCATION_ZOOM_LEVEL);
                this.hasCenteredOnUserLocation = true; 

                // The block that was here, starting with a commented-out
                // "this._mapInstance.once('zoomend', ...)", should be deleted.
            }
        },
        // ... (rest of LocationControl methods are fine)
        _handleLocationError: function (error) {
            console.error('[LocationControl] _handleLocationError CALLED:', error.code, error.message);
            let message = 'Error getting location: ';
            switch (error.code) {
                case error.PERMISSION_DENIED:
                    message = "Geolocation permission denied. Please enable it in your browser settings.";
                    break;
                case error.POSITION_UNAVAILABLE:
                    message += "Location information is unavailable.";
                    break;
                case error.TIMEOUT:
                    message += "The request to get user location timed out.";
                    break;
                case error.UNKNOWN_ERROR:
                    message += "An unknown error occurred.";
                    break;
            }
            showNotification(message, 'error');
            console.error(message, error);
            this._stopWatchingLocation(); 
        },
        
        onRemove: function(mapInstance) {
            this._stopWatchingLocation();
        }
    });

    if (map) { 
        map.addControl(new LocationControl());
        console.log("[App] User Location Control added to map.");
    } else {
        console.error("[App] Map not initialized, cannot add User Location Control.");
    }
}
// END NEW: User Location Feature

// Call Purge Modal Functions
function setupCallPurgeModal() {
    const callPurgeModal = document.getElementById('call-purge-modal');
    const purgeTalkgroupSearch = document.getElementById('purge-talkgroup-search');
    const purgeTalkgroupList = document.getElementById('purge-talkgroup-list');
    const purgeCategorySelect = document.getElementById('purge-category-select');
    const purgeCustomTimeToggle = document.getElementById('purge-custom-time-toggle');
    const purgeCustomTimeInputs = document.getElementById('purge-custom-time-inputs');
    const purgeConfirmBtn = document.getElementById('purge-confirm-btn');
    
    // Initialize category dropdown
    populatePurgeCategoryDropdown();
    
    // Initialize talkgroup list
    populatePurgeTalkgroupList();
    
    // Search functionality
    if (purgeTalkgroupSearch) {
        purgeTalkgroupSearch.addEventListener('input', handlePurgeTalkgroupSearch);
    }
    
    // Custom time toggle
    if (purgeCustomTimeToggle) {
        purgeCustomTimeToggle.addEventListener('change', function() {
            purgeCustomTimeInputs.style.display = this.checked ? 'block' : 'none';
        });
    }
    
    // Time preset buttons
    document.querySelectorAll('.time-preset-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            // Remove active class from all buttons
            document.querySelectorAll('.time-preset-btn').forEach(b => b.classList.remove('active'));
            // Add active class to clicked button
            this.classList.add('active');
            
            // Set custom time inputs to hidden
            purgeCustomTimeToggle.checked = false;
            purgeCustomTimeInputs.style.display = 'none';
        });
    });
    
    // Purge confirm button
    if (purgeConfirmBtn) {
        purgeConfirmBtn.addEventListener('click', executeCallPurge);
    }
    
    // Undo last purge button
    const undoLastPurgeBtn = document.getElementById('undo-last-purge-btn');
    if (undoLastPurgeBtn) {
        undoLastPurgeBtn.addEventListener('click', undoLastPurge);
    }
    
    // Set default date/time values
    setDefaultPurgeDateTime();
}

function showCallPurgeModal() {
    const modal = document.getElementById('call-purge-modal');
    if (modal) {
        // Check if user has admin access when auth is enabled
        if (authEnabled && !isAdminUser) {
            alert('Admin access required to purge calls.');
            return;
        }
        
        modal.style.display = 'block';
        populatePurgeTalkgroupList();
        setDefaultPurgeDateTime();
        
        // Reset form state
        document.querySelectorAll('.time-preset-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('purge-custom-time-toggle').checked = false;
        document.getElementById('purge-custom-time-inputs').style.display = 'none';
        
        // Check if undo is available
        checkUndoAvailability();
    }
}

function populatePurgeCategoryDropdown() {
    const categorySelect = document.getElementById('purge-category-select');
    if (!categorySelect) return;
    
    // Clear existing options
    categorySelect.innerHTML = '<option value="">All Categories</option>';
    
    // Fetch categories from the API
    fetch('/api/categories')
        .then(response => response.json())
        .then(categories => {
            categories.forEach(category => {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                categorySelect.appendChild(option);
            });
        })
        .catch(error => {
            console.error('Error loading categories for purge:', error);
            // Fallback to existing categories if API fails
            Object.keys(categoryCounts).forEach(category => {
                const option = document.createElement('option');
                option.value = category;
                option.textContent = category;
                categorySelect.appendChild(option);
            });
        });
}

function populatePurgeTalkgroupList() {
    const talkgroupList = document.getElementById('purge-talkgroup-list');
    if (!talkgroupList) return;
    
    talkgroupList.innerHTML = '<div class="loading-placeholder">Loading talkgroups...</div>';
    
    fetch('/api/talkgroups')
        .then(response => response.json())
        .then(talkgroups => {
            if (talkgroups.length === 0) {
                talkgroupList.innerHTML = '<div class="loading-placeholder">No talkgroups found.</div>';
                return;
            }
            
            talkgroupList.innerHTML = `
                <div class="purge-talkgroup-item">
                    <input type="checkbox" id="purge-tg-all" data-tg-id="all" />
                    <label for="purge-tg-all"><strong>All Talkgroups</strong></label>
                </div>
                <hr style="margin: 8px 0; border: none; border-top: 1px solid #ccc;">
                ${talkgroups.map(tg => `
                    <div class="purge-talkgroup-item">
                        <input type="checkbox" id="purge-tg-${tg.id}" data-tg-id="${tg.id}" class="individual-tg" />
                        <label for="purge-tg-${tg.id}">${tg.name}</label>
                    </div>
                `).join('')}
            `;
            
            // Add event listeners for "All Talkgroups" functionality
            const allTalkgroupsCheckbox = document.getElementById('purge-tg-all');
            const individualCheckboxes = document.querySelectorAll('.individual-tg');
            
            // When "All Talkgroups" is checked, uncheck individual ones
            allTalkgroupsCheckbox.addEventListener('change', function() {
                if (this.checked) {
                    individualCheckboxes.forEach(cb => cb.checked = false);
                }
            });
            
            // When individual talkgroup is checked, uncheck "All Talkgroups"
            individualCheckboxes.forEach(cb => {
                cb.addEventListener('change', function() {
                    if (this.checked) {
                        allTalkgroupsCheckbox.checked = false;
                    }
                });
            });
        })
        .catch(error => {
            console.error('Error loading talkgroups for purge:', error);
            talkgroupList.innerHTML = '<div class="loading-placeholder error">Error loading talkgroups.</div>';
        });
}

function handlePurgeTalkgroupSearch() {
    const searchInput = document.getElementById('purge-talkgroup-search');
    const talkgroupList = document.getElementById('purge-talkgroup-list');
    if (!searchInput || !talkgroupList) return;
    
    const searchTerm = searchInput.value.toLowerCase();
    const talkgroupItems = talkgroupList.querySelectorAll('.purge-talkgroup-item');
    
    talkgroupItems.forEach(item => {
        const label = item.querySelector('label');
        const text = label.textContent.toLowerCase();
        item.style.display = text.includes(searchTerm) ? 'block' : 'none';
    });
}

function setDefaultPurgeDateTime() {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    
    // Set default end date/time to now
    document.getElementById('purge-end-date').value = now.toISOString().split('T')[0];
    document.getElementById('purge-end-time').value = now.toTimeString().slice(0, 5);
    
    // Set default start date/time to 1 hour ago
    document.getElementById('purge-start-date').value = oneHourAgo.toISOString().split('T')[0];
    document.getElementById('purge-start-time').value = oneHourAgo.toTimeString().slice(0, 5);
}

async function executeCallPurge() {
    console.log('[DEBUG] executeCallPurge started');
    
    const selectedTalkgroups = Array.from(document.querySelectorAll('#purge-talkgroup-list input[type="checkbox"]:checked'))
        .map(cb => cb.dataset.tgId)
        .filter(id => id !== 'all'); // Filter out the "all" option since backend handles empty array as "all talkgroups"
    
    const selectedCategories = [];
    const categorySelect = document.getElementById('purge-category-select');
    if (categorySelect && categorySelect.value) {
        selectedCategories.push(categorySelect.value);
    }
    
    const timeRange = getSelectedTimeRange();
    
    console.log('[DEBUG] Selected talkgroups:', selectedTalkgroups);
    console.log('[DEBUG] Selected categories:', selectedCategories);
    console.log('[DEBUG] Time range:', timeRange);
    
    // Note: Empty selectedCategories means "All Categories" (no filter applied)
    // This is handled by the backend, so we don't need to validate against empty array
    
    if (!timeRange.start || !timeRange.end) {
        showNotification('Please select a valid time range', 'error');
        return;
    }
    
    // Convert to Unix timestamps (seconds)
    const startTime = Math.floor(new Date(timeRange.start).getTime() / 1000);
    const endTime = Math.floor(new Date(timeRange.end).getTime() / 1000);
    
    console.log('[DEBUG] Unix timestamps - start:', startTime, 'end:', endTime);
    
    try {
        // First, get the count of calls that would be affected
        const countParams = new URLSearchParams();
        if (selectedTalkgroups.length > 0) {
            countParams.append('talkgroupIds', selectedTalkgroups.join(','));
        }
        if (selectedCategories.length > 0) {
            countParams.append('categories', selectedCategories.join(','));
        }
        countParams.append('timeRangeStart', startTime);
        countParams.append('timeRangeEnd', endTime);
        
        console.log('[DEBUG] Count params:', countParams.toString());
        
        const countResponse = await fetch(`/api/calls/purge-count?${countParams.toString()}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                ...(authEnabled && currentSessionToken ? { 'Authorization': `Bearer ${currentSessionToken}` } : {})
            }
        });
        
        console.log('[DEBUG] Count response status:', countResponse.status);
        console.log('[DEBUG] Count response ok:', countResponse.ok);
        
        if (!countResponse.ok) {
            const errorText = await countResponse.text();
            console.log('[DEBUG] Count response error text:', errorText);
            throw new Error(`Failed to get call count: ${countResponse.status} ${countResponse.statusText}`);
        }
        
        const contentType = countResponse.headers.get('content-type');
        console.log('[DEBUG] Count response content-type:', contentType);
        
        if (!contentType || !contentType.includes('application/json')) {
            const responseText = await countResponse.text();
            console.log('[DEBUG] Count response non-JSON text:', responseText);
            throw new Error('Invalid response format from server');
        }
        
        const countData = await countResponse.json();
        console.log('[DEBUG] Count data received:', countData);
        
        const callCount = countData.count;
        console.log('[DEBUG] Call count:', callCount);
        
        if (callCount === 0) {
            showNotification('No calls found matching the selected criteria', 'success');
            return;
        }
        
        // Show custom confirmation modal
        const confirmed = await showPurgeConfirmation(callCount);
        console.log('[DEBUG] User confirmed:', confirmed);
        
        if (!confirmed) {
            console.log('[DEBUG] User cancelled, returning');
            return;
        }
        
        // Proceed with the purge
        console.log('[DEBUG] Proceeding with purge...');
        
        const purgeResponse = await fetch('/api/calls/purge', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(authEnabled && currentSessionToken ? { 'Authorization': `Bearer ${currentSessionToken}` } : {})
            },
            body: JSON.stringify({
                talkgroupIds: selectedTalkgroups,
                categories: selectedCategories,
                timeRangeStart: startTime,
                timeRangeEnd: endTime
            })
        });
        
        console.log('[DEBUG] Purge response status:', purgeResponse.status);
        
        if (!purgeResponse.ok) {
            const errorText = await purgeResponse.text();
            console.log('[DEBUG] Purge response error text:', errorText);
            throw new Error(`Purge failed: ${purgeResponse.status} ${purgeResponse.statusText}`);
        }
        
        const contentTypePurge = purgeResponse.headers.get('content-type');
        console.log('[DEBUG] Purge response content-type:', contentTypePurge);
        
        if (!contentTypePurge || !contentTypePurge.includes('application/json')) {
            const responseText = await purgeResponse.text();
            console.log('[DEBUG] Purge response non-JSON text:', responseText);
            throw new Error('Invalid response format from server during purge');
        }
        
        const purgeResult = await purgeResponse.json();
        console.log('[DEBUG] Purge result:', purgeResult);
        
        showNotification(`Successfully purged ${callCount} calls from the map`, 'success');
        
        // Check if undo is now available
        checkUndoAvailability();
        
        // Close the modal
        const modal = document.getElementById('call-purge-modal');
        if (modal) {
            modal.style.display = 'none';
        }
        
        // Reload the map to reflect changes
        console.log('[DEBUG] Reloading map...');
        console.log('[DEBUG] timeRangeHours:', timeRangeHours);
        console.log('[DEBUG] Calling loadCalls...');
        loadCalls(timeRangeHours);
        console.log('[DEBUG] Map reloaded');
        
    } catch (error) {
        console.error('[DEBUG] Error during purge process:', error);
        showNotification(`Error during purge process: ${error.message}`, 'error');
    }
}

// Show custom confirmation modal for purge operations
function showPurgeConfirmation(callCount) {
    return new Promise((resolve) => {
        const modal = document.getElementById('purge-confirmation-modal');
        const message = document.getElementById('purge-confirmation-message');
        const confirmBtn = document.getElementById('purge-confirm-yes');
        const cancelBtn = document.getElementById('purge-confirm-no');
        
        if (!modal || !message || !confirmBtn || !cancelBtn) {
            console.error('[DEBUG] Confirmation modal elements not found');
            resolve(false);
            return;
        }
        
        // Set the message
        message.textContent = `This will purge ${callCount} call${callCount !== 1 ? 's' : ''} from the map. Are you sure you want to continue?`;
        
        // Show the modal
        modal.style.display = 'block';
        
        // Set up event listeners
        const handleConfirm = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(true);
        };
        
        const handleCancel = () => {
            modal.style.display = 'none';
            cleanup();
            resolve(false);
        };
        
        const handleModalClick = (e) => {
            if (e.target === modal) {
                handleCancel();
            }
        };
        
        const cleanup = () => {
            confirmBtn.removeEventListener('click', handleConfirm);
            cancelBtn.removeEventListener('click', handleCancel);
            modal.removeEventListener('click', handleModalClick);
        };
        
        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', handleCancel);
        modal.addEventListener('click', handleModalClick);
    });
}

function resetPurgeButton() {
    const confirmBtn = document.getElementById('purge-confirm-btn');
    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Purge Calls';
    }
}

// Check if undo is available for the last purge operation
async function checkUndoAvailability() {
    const undoBtn = document.getElementById('undo-last-purge-btn');
    if (!undoBtn) return;
    
    try {
        const response = await fetch('/api/calls/can-undo-purge', {
            headers: {
                'Content-Type': 'application/json',
                ...(authEnabled && currentSessionToken ? { 'Authorization': `Bearer ${currentSessionToken}` } : {})
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.canUndo) {
                undoBtn.style.display = 'inline-block';
                undoBtn.disabled = false;
                undoBtn.title = data.message;
            } else {
                undoBtn.style.display = 'none';
            }
        } else {
            undoBtn.style.display = 'none';
        }
    } catch (error) {
        console.error('Error checking undo availability:', error);
        undoBtn.style.display = 'none';
    }
}

// Undo the last purge operation
async function undoLastPurge() {
    const undoBtn = document.getElementById('undo-last-purge-btn');
    if (!undoBtn) return;
    
    // Disable button during operation
    undoBtn.disabled = true;
    undoBtn.textContent = 'Undoing...';
    
    try {
        const response = await fetch('/api/calls/undo-last-purge', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(authEnabled && currentSessionToken ? { 'Authorization': `Bearer ${currentSessionToken}` } : {})
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            showNotification(data.message, 'success');
            
            // Hide the undo button
            undoBtn.style.display = 'none';
            
            // Reload the map to show restored calls
            loadCalls(timeRangeHours);
        } else {
            const errorData = await response.json();
            showNotification(`Error: ${errorData.error}`, 'error');
        }
    } catch (error) {
        console.error('Error undoing purge:', error);
        showNotification('Error undoing purge operation', 'error');
    } finally {
        // Re-enable button
        undoBtn.disabled = false;
        undoBtn.textContent = 'Undo Last Purge';
    }
}

function reloadMapAfterPurge() {
    // Clear existing markers
    Object.values(allMarkers).forEach(({ marker }) => {
        if (marker && map.hasLayer(marker)) {
            map.removeLayer(marker);
        }
    });
    
    // Clear marker groups
    if (markerGroups) {
        map.removeLayer(markerGroups);
        markerGroups = L.layerGroup();
        map.addLayer(markerGroups);
    }
    
    // Reset marker storage
    allMarkers = {};
    
    // Reload calls with current time range
    loadCalls(timeRangeHours);
}

function getSelectedTimeRange() {
    if (document.getElementById('purge-custom-time-toggle').checked) {
        // Custom time range
        const startDate = document.getElementById('purge-start-date').value;
        const startTime = document.getElementById('purge-start-time').value;
        const endDate = document.getElementById('purge-end-date').value;
        const endTime = document.getElementById('purge-end-time').value;
        
        if (!startDate || !startTime || !endDate || !endTime) {
            return null;
        }
        
        return {
            start: `${startDate}T${startTime}:00`,
            end: `${endDate}T${endTime}:00`
        };
    } else {
        // Preset time range
        const activePreset = document.querySelector('.time-preset-btn.active');
        if (!activePreset) {
            return null;
        }
        
        const hours = parseInt(activePreset.dataset.hours);
        const endTime = new Date();
        const startTime = new Date(endTime.getTime() - hours * 60 * 60 * 1000);
        
        return {
            start: startTime.toISOString(),
            end: endTime.toISOString()
        };
    }
}

// Service Configuration Functions
function showServiceConfigModal() {
    const modal = document.getElementById('service-config-modal');
    if (modal) {
        loadServiceConfig();
        modal.style.display = 'block';
    }
}

function loadServiceConfig() {
    fetch('/api/config/services')
        .then(response => response.json())
        .then(data => {
            const ollamaUrlInput = document.getElementById('ollama-url');
            const icadUrlInput = document.getElementById('icad-url');
            
            if (ollamaUrlInput) {
                ollamaUrlInput.value = data.ollama?.url || '';
            }
            if (icadUrlInput) {
                icadUrlInput.value = data.icad?.url || '';
            }
        })
        .catch(error => {
            console.error('Error loading service config:', error);
            showNotification('Error loading service configuration', 'error');
        });
}

function setupServiceConfigModal() {
    const saveBtn = document.getElementById('save-service-config-btn');
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            const ollamaUrl = document.getElementById('ollama-url').value.trim();
            const icadUrl = document.getElementById('icad-url').value.trim();
            
            fetch('/api/config/services', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    ollama: { url: ollamaUrl || undefined },
                    icad: { url: icadUrl || undefined }
                })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    showNotification(data.message || 'Configuration saved. Restart services for changes to take effect.', 'success');
                    document.getElementById('service-config-modal').style.display = 'none';
                } else {
                    showNotification(data.error || 'Error saving configuration', 'error');
                }
            })
            .catch(error => {
                console.error('Error saving service config:', error);
                showNotification('Error saving service configuration', 'error');
            });
        });
    }
}

// Quick Start Modal Functions
function showQuickStartModal() {
    const modal = document.getElementById('quick-start-modal');
    if (modal) {
        // Reset to first tab
        switchQuickStartTab('location');
        // Load initial data for active tabs
        loadLocationConfig();
        loadSystemStatus();
        loadGPUStatus();
        loadAutoStartStatus();
        loadUpdateStatus();
        loadTalkgroups();
        loadFrequencies();
        modal.style.display = 'block';
    }
}

function closeQuickStartModal() {
    const modal = document.getElementById('quick-start-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Settings Modal Functions
function showSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        // Reset to first tab
        switchSettingsTab('general');
        // Load current settings
        loadAllSettings();
        modal.style.display = 'block';
    }
}

function closeSettingsModal() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function switchSettingsTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.settings-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    // Remove active from all tabs
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    // Show selected tab content
    const tabContent = document.getElementById(`settings-${tabName}-tab`);
    const tabButton = document.querySelector(`.settings-tab[data-tab="${tabName}"]`);
    if (tabContent) {
        tabContent.classList.add('active');
    }
    if (tabButton) {
        tabButton.classList.add('active');
    }
    
    // Load tab-specific data
    if (tabName === 'api-keys') {
        loadAPIKeysDisplay();
    } else if (tabName === 'services') {
        loadSettingsServiceStatus();
    } else if (tabName === 'models') {
        loadSettingsModelRecommendations();
        loadSettingsInstalledModels();
    }
}

// Load all settings from server
function loadAllSettings() {
    fetch('/api/settings')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.settings) {
                const s = data.settings;
                
                // General settings
                if (s.webserverPort) document.getElementById('settings-webserver-port').value = s.webserverPort;
                if (s.botPort) document.getElementById('settings-bot-port').value = s.botPort;
                if (s.publicDomain) document.getElementById('settings-public-domain').value = s.publicDomain;
                if (s.timezone) document.getElementById('settings-timezone').value = s.timezone;
                if (s.authEnabled !== undefined) document.getElementById('settings-auth-enabled').checked = s.authEnabled;
                
                // Map settings
                if (s.mapCenter) {
                    document.getElementById('settings-map-center-lat').value = s.mapCenter.lat || '';
                    document.getElementById('settings-map-center-lng').value = s.mapCenter.lng || '';
                }
                if (s.mapZoom) document.getElementById('settings-map-zoom').value = s.mapZoom;
                if (s.defaultTimeRange) document.getElementById('settings-default-time-range').value = s.defaultTimeRange;
                if (s.trackNewCalls !== undefined) document.getElementById('settings-track-new-calls').checked = s.trackNewCalls;
                
                // Audio settings
                if (s.globalVolume !== undefined) {
                    document.getElementById('settings-global-volume').value = s.globalVolume;
                    document.getElementById('settings-volume-display').textContent = Math.round(s.globalVolume * 100) + '%';
                }
                if (s.muteNewCalls !== undefined) document.getElementById('settings-mute-new-calls').checked = s.muteNewCalls;
                if (s.autoplayEnabled !== undefined) document.getElementById('settings-autoplay-enabled').checked = s.autoplayEnabled;
                
                // Geocoding settings
                if (s.geocodingProvider) document.getElementById('settings-geocoding-provider').value = s.geocodingProvider;
                if (s.geocodingCity) document.getElementById('settings-geocoding-city').value = s.geocodingCity;
                if (s.geocodingState) document.getElementById('settings-geocoding-state').value = s.geocodingState;
                if (s.geocodingCountry) document.getElementById('settings-geocoding-country').value = s.geocodingCountry;
                if (s.geocodingCounties) document.getElementById('settings-geocoding-counties').value = s.geocodingCounties;
                
                // Transcription settings - only show if enabled
                if (s.transcriptionEnabled !== false) {
                    if (s.transcriptionMode) {
                        const transcriptionRadio = document.querySelector(`input[name="transcription-mode"][value="${s.transcriptionMode}"]`);
                        if (transcriptionRadio) {
                            transcriptionRadio.checked = true;
                            document.getElementById('settings-transcription-mode').value = s.transcriptionMode;
                        }
                        updateTranscriptionSettingsVisibility();
                    }
                    if (s.icadUrl) {
                        document.getElementById('settings-icad-url').value = s.icadUrl;
                        // Also update services tab
                        if (document.getElementById('settings-services-icad-url')) {
                            document.getElementById('settings-services-icad-url').value = s.icadUrl;
                        }
                        // Extract port from URL if present, or use provided port
                        const port = s.icadPort || (s.icadUrl.match(/:(\d+)/) ? s.icadUrl.match(/:(\d+)/)[1] : '9912');
                        if (document.getElementById('settings-icad-port')) {
                            document.getElementById('settings-icad-port').value = port;
                        }
                    }
                    if (s.fasterWhisperUrl) {
                        document.getElementById('settings-faster-whisper-url').value = s.fasterWhisperUrl;
                        // Extract port from URL if present, or use provided port
                        const port = s.fasterWhisperPort || (s.fasterWhisperUrl.match(/:(\d+)/) ? s.fasterWhisperUrl.match(/:(\d+)/)[1] : '8000');
                        if (document.getElementById('settings-faster-whisper-port')) {
                            document.getElementById('settings-faster-whisper-port').value = port;
                        }
                    }
                } else {
                    // Hide transcription tab if disabled
                    const transcriptionTab = document.querySelector('.settings-tab[data-tab="transcription"]');
                    if (transcriptionTab) transcriptionTab.style.display = 'none';
                }
                
                // AI settings - only show if enabled
                if (s.aiEnabled !== false) {
                    if (s.aiProvider) {
                        const aiRadio = document.querySelector(`input[name="ai-provider"][value="${s.aiProvider}"]`);
                        if (aiRadio) {
                            aiRadio.checked = true;
                            document.getElementById('settings-ai-provider').value = s.aiProvider;
                        }
                        updateAISettingsVisibility();
                    }
                    if (s.ollamaUrl) {
                        document.getElementById('settings-ollama-url').value = s.ollamaUrl;
                        // Also update services tab
                        if (document.getElementById('settings-services-ollama-url')) {
                            document.getElementById('settings-services-ollama-url').value = s.ollamaUrl;
                        }
                        // Extract port from URL if present, or use provided port
                        const port = s.ollamaPort || (s.ollamaUrl.match(/:(\d+)/) ? s.ollamaUrl.match(/:(\d+)/)[1] : '11434');
                        if (document.getElementById('settings-ollama-port')) {
                            document.getElementById('settings-ollama-port').value = port;
                        }
                    }
                    if (s.ollamaModel) {
                        document.getElementById('settings-ollama-model').value = s.ollamaModel;
                        // Also update services tab
                        if (document.getElementById('settings-services-ollama-model')) {
                            document.getElementById('settings-services-ollama-model').value = s.ollamaModel;
                        }
                    }
                    if (s.openaiModel) document.getElementById('settings-openai-model').value = s.openaiModel;
                } else {
                    // Hide AI tab if disabled
                    const aiTab = document.querySelector('.settings-tab[data-tab="ai"]');
                    if (aiTab) aiTab.style.display = 'none';
                }
                
                // Discord settings
                if (s.discordEnabled !== undefined) {
                    document.getElementById('settings-discord-enabled').checked = s.discordEnabled;
                    updateDiscordSettingsVisibility();
                }
                if (s.discordChannel) document.getElementById('settings-discord-channel').value = s.discordChannel;
                if (s.discordAISummaries !== undefined) document.getElementById('settings-discord-ai-summaries').checked = s.discordAISummaries;
                
                // Storage settings
                if (s.storageMode) {
                    document.getElementById('settings-storage-mode').value = s.storageMode;
                    updateStorageSettingsVisibility();
                }
                if (s.s3Endpoint) document.getElementById('settings-s3-endpoint').value = s.s3Endpoint;
                if (s.s3Bucket) document.getElementById('settings-s3-bucket').value = s.s3Bucket;
                if (s.s3Region) document.getElementById('settings-s3-region').value = s.s3Region;
                
                // Display settings
                if (s.heatmapIntensity) {
                    document.getElementById('settings-heatmap-intensity').value = s.heatmapIntensity;
                    document.getElementById('settings-heatmap-intensity-display').textContent = s.heatmapIntensity;
                }
                if (s.heatmapEnabled !== undefined) document.getElementById('settings-heatmap-enabled').checked = s.heatmapEnabled;
                if (s.maxMarkers) document.getElementById('settings-max-markers').value = s.maxMarkers;
                if (s.clusterMarkers !== undefined) document.getElementById('settings-cluster-markers').checked = s.clusterMarkers;
            }
        })
        .catch(error => {
            console.error('Error loading settings:', error);
        });
}

function updateTranscriptionSettingsVisibility() {
    const selectedRadio = document.querySelector('input[name="transcription-mode"]:checked');
    const mode = selectedRadio ? selectedRadio.value : 'local';
    
    // Update hidden input
    const hiddenInput = document.getElementById('settings-transcription-mode');
    if (hiddenInput) hiddenInput.value = mode;
    
    // Show/hide settings sections
    document.getElementById('transcription-icad-settings').style.display = mode === 'icad' ? 'block' : 'none';
    document.getElementById('transcription-faster-whisper-settings').style.display = mode === 'faster-whisper' ? 'block' : 'none';
    
    // Update iCAD web UI link
    if (mode === 'icad') {
        updateICADWebUILink();
    }
}

function updateAISettingsVisibility() {
    const selectedRadio = document.querySelector('input[name="ai-provider"]:checked');
    const provider = selectedRadio ? selectedRadio.value : 'ollama';
    
    // Update hidden input
    const hiddenInput = document.getElementById('settings-ai-provider');
    if (hiddenInput) hiddenInput.value = provider;
    
    // Show/hide settings sections
    document.getElementById('ai-openai-settings').style.display = provider === 'openai' ? 'block' : 'none';
    document.getElementById('ai-ollama-settings').style.display = provider === 'ollama' ? 'block' : 'none';
}

function updateICADWebUILink() {
    const urlInput = document.getElementById('settings-icad-url');
    const portInput = document.getElementById('settings-icad-port');
    const linkBtn = document.getElementById('icad-webui-link-btn');
    const linkContainer = document.getElementById('icad-webui-link');
    
    if (urlInput && portInput && linkBtn && linkContainer) {
        const url = urlInput.value || 'http://localhost';
        const port = portInput.value || '9912';
        
        // Extract base URL (remove port if present)
        const baseUrl = url.replace(/:\d+$/, '').replace(/\/$/, '');
        const webUIUrl = `${baseUrl}:${port}`;
        
        linkBtn.href = webUIUrl;
        linkContainer.style.display = 'block';
    }
}

function updateDiscordSettingsVisibility() {
    const enabled = document.getElementById('settings-discord-enabled').checked;
    document.getElementById('discord-settings-content').style.display = enabled ? 'block' : 'none';
}

function updateStorageSettingsVisibility() {
    const mode = document.getElementById('settings-storage-mode').value;
    document.getElementById('storage-s3-settings').style.display = mode === 's3' ? 'block' : 'none';
}

function loadAPIKeysDisplay() {
    fetch('/api/settings/api-keys')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const keysList = document.getElementById('api-keys-list');
                if (keysList) {
                    keysList.innerHTML = Object.entries(data.keys || {}).map(([name, value]) => {
                        const masked = value ? value.substring(0, 4) + '...' + value.substring(value.length - 4) : 'Not set';
                        return `<div><strong>${name}:</strong> ${masked}</div>`;
                    }).join('');
                }
            }
        })
        .catch(error => {
            console.error('Error loading API keys:', error);
        });
}

// Settings save functions
function saveGeneralSettings() {
    const settings = {
        webserverPort: parseInt(document.getElementById('settings-webserver-port').value),
        botPort: parseInt(document.getElementById('settings-bot-port').value),
        publicDomain: document.getElementById('settings-public-domain').value,
        timezone: document.getElementById('settings-timezone').value,
        authEnabled: document.getElementById('settings-auth-enabled').checked
    };
    saveSettings('general', settings);
}

function saveMapSettings() {
    const settings = {
        mapCenter: {
            lat: parseFloat(document.getElementById('settings-map-center-lat').value),
            lng: parseFloat(document.getElementById('settings-map-center-lng').value)
        },
        mapZoom: parseInt(document.getElementById('settings-map-zoom').value),
        defaultTimeRange: parseInt(document.getElementById('settings-default-time-range').value),
        trackNewCalls: document.getElementById('settings-track-new-calls').checked
    };
    saveSettings('map', settings);
}

function saveAudioSettings() {
    const settings = {
        globalVolume: parseFloat(document.getElementById('settings-global-volume').value),
        muteNewCalls: document.getElementById('settings-mute-new-calls').checked,
        autoplayEnabled: document.getElementById('settings-autoplay-enabled').checked
    };
    saveSettings('audio', settings);
}

function saveGeocodingSettings() {
    const settings = {
        geocodingProvider: document.getElementById('settings-geocoding-provider').value,
        geocodingCity: document.getElementById('settings-geocoding-city').value,
        geocodingState: document.getElementById('settings-geocoding-state').value,
        geocodingCountry: document.getElementById('settings-geocoding-country').value,
        geocodingCounties: document.getElementById('settings-geocoding-counties').value
    };
    saveSettings('geocoding', settings);
}

function saveTranscriptionSettings() {
    const selectedRadio = document.querySelector('input[name="transcription-mode"]:checked');
    const mode = selectedRadio ? selectedRadio.value : 'local';
    
    const settings = {
        transcriptionMode: mode
    };
    
    // Only include settings for the selected mode
    if (mode === 'icad') {
        const url = document.getElementById('settings-icad-url').value || 'http://localhost';
        const port = document.getElementById('settings-icad-port').value || '9912';
        const baseUrl = url.replace(/:\d+$/, '').replace(/\/$/, '');
        settings.icadUrl = `${baseUrl}:${port}`;
        const apiKey = document.getElementById('settings-icad-api-key').value;
        if (apiKey) settings.icadApiKey = apiKey;
    } else if (mode === 'faster-whisper') {
        const url = document.getElementById('settings-faster-whisper-url').value || 'http://localhost';
        const port = document.getElementById('settings-faster-whisper-port').value || '8000';
        const baseUrl = url.replace(/:\d+$/, '').replace(/\/$/, '');
        settings.fasterWhisperUrl = `${baseUrl}:${port}`;
    }
    
    saveSettings('transcription', settings);
}

function saveServicesSettings() {
    const settings = {
        ollamaUrl: document.getElementById('settings-services-ollama-url').value,
        ollamaModel: document.getElementById('settings-services-ollama-model').value,
        icadUrl: document.getElementById('settings-services-icad-url').value
    };
    const icadKey = document.getElementById('settings-services-icad-api-key').value;
    if (icadKey) settings.icadApiKey = icadKey;
    
    saveSettings('services', settings);
}

function saveAISettings() {
    const selectedRadio = document.querySelector('input[name="ai-provider"]:checked');
    const provider = selectedRadio ? selectedRadio.value : 'ollama';
    
    const settings = {
        aiProvider: provider
    };
    
    // Only include settings for the selected provider
    if (provider === 'openai') {
        settings.openaiModel = document.getElementById('settings-openai-model').value;
        const openaiKey = document.getElementById('settings-openai-api-key').value;
        if (openaiKey) settings.openaiApiKey = openaiKey;
    } else if (provider === 'ollama') {
        const url = document.getElementById('settings-ollama-url').value || 'http://localhost';
        const port = document.getElementById('settings-ollama-port').value || '11434';
        const baseUrl = url.replace(/:\d+$/, '').replace(/\/$/, '');
        settings.ollamaUrl = `${baseUrl}:${port}`;
        settings.ollamaModel = document.getElementById('settings-ollama-model').value;
    }
    
    saveSettings('ai', settings);
}

function saveDiscordSettings() {
    const settings = {
        discordEnabled: document.getElementById('settings-discord-enabled').checked,
        discordChannel: document.getElementById('settings-discord-channel').value,
        discordAISummaries: document.getElementById('settings-discord-ai-summaries').checked
    };
    const token = document.getElementById('settings-discord-token').value;
    if (token) settings.discordToken = token;
    saveSettings('discord', settings);
}

function saveStorageSettings() {
    const settings = {
        storageMode: document.getElementById('settings-storage-mode').value,
        s3Endpoint: document.getElementById('settings-s3-endpoint').value,
        s3Bucket: document.getElementById('settings-s3-bucket').value,
        s3Region: document.getElementById('settings-s3-region').value
    };
    const accessKey = document.getElementById('settings-s3-access-key').value;
    const secretKey = document.getElementById('settings-s3-secret-key').value;
    if (accessKey) settings.s3AccessKey = accessKey;
    if (secretKey) settings.s3SecretKey = secretKey;
    saveSettings('storage', settings);
}

function saveDisplaySettings() {
    const settings = {
        heatmapIntensity: parseInt(document.getElementById('settings-heatmap-intensity').value),
        heatmapEnabled: document.getElementById('settings-heatmap-enabled').checked,
        maxMarkers: parseInt(document.getElementById('settings-max-markers').value),
        clusterMarkers: document.getElementById('settings-cluster-markers').checked
    };
    saveSettings('display', settings);
}

function saveAPIKeys() {
    const keys = {};
    const googleKey = document.getElementById('settings-google-maps-key').value;
    const locationiqKey = document.getElementById('settings-locationiq-key').value;
    if (googleKey) keys.googleMapsKey = googleKey;
    if (locationiqKey) keys.locationiqKey = locationiqKey;
    if (Object.keys(keys).length === 0) {
        showNotification('No API keys to save', 'info');
        return;
    }
    saveSettings('api-keys', keys);
}

function saveSettings(category, settings) {
    fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, settings })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification(`${category} settings saved successfully`, 'success');
                loadAllSettings();
            } else {
                showNotification(data.error || `Error saving ${category} settings`, 'error');
            }
        })
        .catch(error => {
            console.error(`Error saving ${category} settings:`, error);
            showNotification(`Error saving ${category} settings`, 'error');
        });
}

function setupSettingsModal() {
    // Settings tab switching
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.dataset.tab;
            switchSettingsTab(tabName);
        });
    });
    
    // Transcription mode radio buttons
    document.querySelectorAll('input[name="transcription-mode"]').forEach(radio => {
        radio.addEventListener('change', updateTranscriptionSettingsVisibility);
    });
    
    // AI provider radio buttons
    document.querySelectorAll('input[name="ai-provider"]').forEach(radio => {
        radio.addEventListener('change', updateAISettingsVisibility);
    });
    
    // iCAD URL/Port changes - update web UI link
    const icadUrl = document.getElementById('settings-icad-url');
    const icadPort = document.getElementById('settings-icad-port');
    if (icadUrl) icadUrl.addEventListener('input', updateICADWebUILink);
    if (icadPort) icadPort.addEventListener('input', updateICADWebUILink);
    
    // Discord enabled change
    const discordEnabled = document.getElementById('settings-discord-enabled');
    if (discordEnabled) {
        discordEnabled.addEventListener('change', updateDiscordSettingsVisibility);
    }
    
    // Storage mode change
    const storageMode = document.getElementById('settings-storage-mode');
    if (storageMode) {
        storageMode.addEventListener('change', updateStorageSettingsVisibility);
    }
    
    // Volume slider
    const volumeSlider = document.getElementById('settings-global-volume');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', function() {
            const display = document.getElementById('settings-volume-display');
            if (display) display.textContent = Math.round(this.value * 100) + '%';
        });
    }
    
    // Heatmap intensity slider
    const heatmapSlider = document.getElementById('settings-heatmap-intensity');
    if (heatmapSlider) {
        heatmapSlider.addEventListener('input', function() {
            const display = document.getElementById('settings-heatmap-intensity-display');
            if (display) display.textContent = this.value;
        });
    }
    
    // Show API keys checkbox
    const showAPIKeys = document.getElementById('settings-show-api-keys');
    if (showAPIKeys) {
        showAPIKeys.addEventListener('change', function() {
            const display = document.getElementById('api-keys-display');
            if (display) {
                display.style.display = this.checked ? 'block' : 'none';
                if (this.checked) {
                    loadAPIKeysDisplay();
                }
            }
        });
    }
    
    // Save buttons
    const saveButtons = {
        'save-general-settings-btn': saveGeneralSettings,
        'save-services-settings-btn': saveServicesSettings,
        'save-map-settings-btn': saveMapSettings,
        'save-audio-settings-btn': saveAudioSettings,
        'save-geocoding-settings-btn': saveGeocodingSettings,
        'save-transcription-settings-btn': saveTranscriptionSettings,
        'save-ai-settings-btn': saveAISettings,
        'save-discord-settings-btn': saveDiscordSettings,
        'save-storage-settings-btn': saveStorageSettings,
        'save-display-settings-btn': saveDisplaySettings,
        'save-api-keys-btn': saveAPIKeys
    };
    
    Object.entries(saveButtons).forEach(([id, handler]) => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', handler);
    });
}

function switchQuickStartTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.quick-start-tab-content').forEach(content => {
        content.classList.remove('active');
    });
    // Remove active from all tabs
    document.querySelectorAll('.quick-start-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    // Show selected tab content
    const tabContent = document.getElementById(`quick-start-${tabName}-tab`);
    if (tabContent) {
        tabContent.classList.add('active');
    }
    // Activate selected tab button
    const tabButton = document.querySelector(`.quick-start-tab[data-tab="${tabName}"]`);
    if (tabButton) {
        tabButton.classList.add('active');
    }
    
    // Start/stop service status auto-refresh based on tab
    if (tabName === 'system') {
        loadServiceStatus(); // Load immediately
        startServiceStatusAutoRefresh();
    } else if (tabName === 'models') {
        // Load model recommendations and installed models for Models tab
        if (typeof loadQuickStartModelRecommendations === 'function') {
            loadQuickStartModelRecommendations();
        }
        if (typeof loadQuickStartInstalledModels === 'function') {
            loadQuickStartInstalledModels();
        }
    } else {
        stopServiceStatusAutoRefresh();
    }
}

function switchRadioSubtab(subtabName) {
    // Hide all sub-tab contents
    document.querySelectorAll('.quick-start-subtab-content').forEach(content => {
        content.classList.remove('active');
    });
    // Remove active from all sub-tabs
    document.querySelectorAll('.quick-start-subtab').forEach(tab => {
        tab.classList.remove('active');
    });
    // Show selected sub-tab content
    let subtabContent = null;
    if (subtabName === 'software-config') {
        subtabContent = document.getElementById('radio-software-config-subtab');
    } else {
        subtabContent = document.getElementById(`radio-${subtabName}-subtab`);
    }
    if (subtabContent) {
        subtabContent.classList.add('active');
    }
    // Activate selected sub-tab button
    const subtabButton = document.querySelector(`.quick-start-subtab[data-subtab="${subtabName}"]`);
    if (subtabButton) {
        subtabButton.classList.add('active');
    }
}

function setupQuickStartModal() {
    // Tab switching
    document.querySelectorAll('.quick-start-tab').forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            switchQuickStartTab(tabName);
        });
    });
    
    // Radio sub-tab switching
    document.querySelectorAll('.quick-start-subtab').forEach(subtab => {
        subtab.addEventListener('click', function() {
            const subtabName = this.getAttribute('data-subtab');
            switchRadioSubtab(subtabName);
        });
    });
    
    // Location configuration
    const detectLocationBtn = document.getElementById('detect-location-btn');
    if (detectLocationBtn) {
        detectLocationBtn.addEventListener('click', detectUserLocation);
    }
    
    const saveLocationBtn = document.getElementById('save-location-btn');
    if (saveLocationBtn) {
        saveLocationBtn.addEventListener('click', saveLocationConfig);
    }
    
    // System status - Install buttons
    const installDockerBtn = document.getElementById('install-docker-btn');
    if (installDockerBtn) {
        installDockerBtn.addEventListener('click', function() {
            installDependency('docker');
        });
    }
    
    const installNodejsBtn = document.getElementById('install-nodejs-btn');
    if (installNodejsBtn) {
        installNodejsBtn.addEventListener('click', function() {
            installDependency('nodejs');
        });
    }
    
    const installPythonBtn = document.getElementById('install-python-btn');
    if (installPythonBtn) {
        installPythonBtn.addEventListener('click', function() {
            installDependency('python');
        });
    }
    
    // Service installation buttons
    const installOllamaLocalBtn = document.getElementById('install-ollama-local-btn');
    if (installOllamaLocalBtn) {
        installOllamaLocalBtn.addEventListener('click', function() {
            installService('ollama', false);
        });
    }
    
    const installOllamaDockerBtn = document.getElementById('install-ollama-docker-btn');
    if (installOllamaDockerBtn) {
        installOllamaDockerBtn.addEventListener('click', function() {
            installService('ollama', true);
        });
    }
    
    const installFasterWhisperBtn = document.getElementById('install-faster-whisper-btn');
    if (installFasterWhisperBtn) {
        installFasterWhisperBtn.addEventListener('click', function() {
            installService('faster-whisper', false);
        });
    }
    
    const installIcadLocalBtn = document.getElementById('install-icad-local-btn');
    if (installIcadLocalBtn) {
        installIcadLocalBtn.addEventListener('click', function() {
            installService('icad-transcribe', false);
        });
    }
    
    const installIcadDockerBtn = document.getElementById('install-icad-docker-btn');
    if (installIcadDockerBtn) {
        installIcadDockerBtn.addEventListener('click', function() {
            installService('icad-transcribe', true);
        });
    }
    
    // GPU configuration
    const gpuEnabledCheckbox = document.getElementById('gpu-enabled-checkbox');
    if (gpuEnabledCheckbox) {
        gpuEnabledCheckbox.addEventListener('change', function() {
            saveGPUConfig(this.checked);
        });
    }
    
    const installNvidiaToolkitBtn = document.getElementById('install-nvidia-toolkit-btn');
    if (installNvidiaToolkitBtn) {
        installNvidiaToolkitBtn.addEventListener('click', installNvidiaToolkit);
    }
    
    // Auto-start configuration
    const autostartEnabledCheckbox = document.getElementById('autostart-enabled-checkbox');
    if (autostartEnabledCheckbox) {
        autostartEnabledCheckbox.addEventListener('change', function() {
            saveAutoStartConfig(this.checked);
        });
    }
    
    // Updates
    const checkUpdatesBtn = document.getElementById('check-updates-btn');
    if (checkUpdatesBtn) {
        checkUpdatesBtn.addEventListener('click', checkForUpdates);
    }
    
    const installUpdateBtn = document.getElementById('install-update-btn');
    if (installUpdateBtn) {
        installUpdateBtn.addEventListener('click', installUpdate);
    }
    
    const autoUpdateCheckbox = document.getElementById('auto-update-checkbox');
    if (autoUpdateCheckbox) {
        autoUpdateCheckbox.addEventListener('change', function() {
            saveUpdateConfig(this.checked);
        });
    }
    
    // Radio configuration - Talkgroups
    const addTalkgroupBtn = document.getElementById('add-talkgroup-btn');
    if (addTalkgroupBtn) {
        addTalkgroupBtn.addEventListener('click', function() {
            showTalkgroupEditForm();
        });
    }
    
    const saveTalkgroupBtn = document.getElementById('save-talkgroup-btn');
    if (saveTalkgroupBtn) {
        saveTalkgroupBtn.addEventListener('click', saveTalkgroup);
    }
    
    const cancelTalkgroupBtn = document.getElementById('cancel-talkgroup-btn');
    if (cancelTalkgroupBtn) {
        cancelTalkgroupBtn.addEventListener('click', function() {
            document.getElementById('talkgroup-edit-form').style.display = 'none';
        });
    }
    
    // Radio configuration - Frequencies
    const addFrequencyBtn = document.getElementById('add-frequency-btn');
    if (addFrequencyBtn) {
        addFrequencyBtn.addEventListener('click', function() {
            showFrequencyEditForm();
        });
    }
    
    const saveFrequencyBtn = document.getElementById('save-frequency-btn');
    if (saveFrequencyBtn) {
        saveFrequencyBtn.addEventListener('click', saveFrequency);
    }
    
    const cancelFrequencyBtn = document.getElementById('cancel-frequency-btn');
    if (cancelFrequencyBtn) {
        cancelFrequencyBtn.addEventListener('click', function() {
            document.getElementById('frequency-edit-form').style.display = 'none';
        });
    }
    
    // Setup CSV import
    setupCSVImport('talkgroups');
    setupCSVImport('frequencies');
    
    // Setup radio software detection and configuration
    setupRadioSoftwareConfig();
    
    // Setup AI commands
    setupAICommands();
}

// Radio Software Detection and Configuration Functions
function setupRadioSoftwareConfig() {
    const detectBtn = document.getElementById('detect-radio-software-btn');
    const configureBtn = document.getElementById('configure-trunkrecorder-btn');
    const statusContent = document.getElementById('radio-software-status-content');
    const previewDiv = document.getElementById('trunkrecorder-config-preview');
    const previewContent = document.getElementById('trunkrecorder-config-preview-content');
    const saveBtn = document.getElementById('trunkrecorder-config-save-btn');
    const cancelBtn = document.getElementById('trunkrecorder-config-cancel-btn');
    const resultsDiv = document.getElementById('trunkrecorder-config-results');
    
    let previewConfig = null;
    
    // Load status on tab open
    const softwareConfigTab = document.getElementById('radio-software-config-subtab');
    if (softwareConfigTab) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    if (softwareConfigTab.classList.contains('active')) {
                        loadRadioSoftwareStatus();
                    }
                }
            });
        });
        observer.observe(softwareConfigTab, { attributes: true });
    }
    
    function loadRadioSoftwareStatus() {
        fetch('/api/radio/detect-software')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.detected) {
                    const detected = data.detected;
                    let html = '<ul style="list-style: none; padding: 0;">';
                    
                    html += `<li style="margin: 5px 0;">
                        <strong>TrunkRecorder:</strong> 
                        <span style="color: ${detected.trunkrecorder ? '#00ff00' : '#ff0000'};">
                            ${detected.trunkrecorder ? '✓ Detected' : '✗ Not Detected'}
                        </span>
                        ${detected.trunkrecorder && detected.details.trunkrecorder ? `<br><small style="color: #888;">Path: ${detected.details.trunkrecorder.configPath}</small>` : ''}
                    </li>`;
                    
                    html += `<li style="margin: 5px 0;">
                        <strong>SDRTrunk:</strong> 
                        <span style="color: ${detected.sdtrunk ? '#00ff00' : '#ff0000'};">
                            ${detected.sdtrunk ? '✓ Detected' : '✗ Not Detected'}
                        </span>
                    </li>`;
                    
                    html += `<li style="margin: 5px 0;">
                        <strong>OP25:</strong> 
                        <span style="color: ${detected.op25 ? '#00ff00' : '#ff0000'};">
                            ${detected.op25 ? '✓ Detected' : '✗ Not Detected'}
                        </span>
                    </li>`;
                    
                    html += `<li style="margin: 5px 0;">
                        <strong>rdio-scanner:</strong> 
                        <span style="color: ${detected.rdioScanner ? '#00ff00' : '#ff0000'};">
                            ${detected.rdioScanner ? '✓ Detected' : '✗ Not Detected'}
                        </span>
                    </li>`;
                    
                    html += '</ul>';
                    
                    if (statusContent) statusContent.innerHTML = html;
                    
                    // Show configure button if TrunkRecorder is detected
                    if (detected.trunkrecorder && configureBtn) {
                        configureBtn.style.display = 'inline-block';
                    } else if (configureBtn) {
                        configureBtn.style.display = 'none';
                    }
                } else {
                    if (statusContent) statusContent.innerHTML = '<span style="color: #ff0000;">Error loading detection status</span>';
                }
            })
            .catch(error => {
                console.error('Error loading radio software status:', error);
                if (statusContent) statusContent.innerHTML = '<span style="color: #ff0000;">Error loading detection status</span>';
            });
    }
    
    if (detectBtn) {
        detectBtn.addEventListener('click', function() {
            loadRadioSoftwareStatus();
        });
    }
    
    if (configureBtn) {
        configureBtn.addEventListener('click', function() {
            // Generate preview
            fetch('/api/radio/configure-trunkrecorder', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ preview: true })
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success && data.config) {
                        previewConfig = data.config;
                        if (previewContent) {
                            previewContent.textContent = JSON.stringify(data.config, null, 2);
                        }
                        if (previewDiv) previewDiv.style.display = 'block';
                        if (resultsDiv) resultsDiv.style.display = 'none';
                    } else {
                        showNotification(data.error || 'Error generating configuration preview', 'error');
                    }
                })
                .catch(error => {
                    console.error('Error generating config preview:', error);
                    showNotification('Error generating configuration preview', 'error');
                });
        });
    }
    
    if (saveBtn) {
        saveBtn.addEventListener('click', function() {
            if (!previewConfig) {
                showNotification('No configuration to save', 'error');
                return;
            }
            
            fetch('/api/radio/configure-trunkrecorder', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ preview: false })
            })
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        if (resultsDiv) {
                            resultsDiv.style.display = 'block';
                            resultsDiv.style.backgroundColor = 'rgba(0, 255, 0, 0.2)';
                            resultsDiv.innerHTML = `<strong>Success!</strong><br>Configuration saved to: ${data.configPath || 'config.json'}<br>API Key: ${data.apiKey || 'N/A'}`;
                        }
                        showNotification('TrunkRecorder configuration saved successfully', 'success');
                        if (previewDiv) previewDiv.style.display = 'none';
                    } else {
                        showNotification(data.error || 'Error saving configuration', 'error');
                        if (resultsDiv) {
                            resultsDiv.style.display = 'block';
                            resultsDiv.style.backgroundColor = 'rgba(255, 0, 0, 0.2)';
                            resultsDiv.innerHTML = `<strong>Error:</strong> ${data.error || 'Unknown error'}`;
                        }
                    }
                })
                .catch(error => {
                    console.error('Error saving config:', error);
                    showNotification('Error saving configuration', 'error');
                });
        });
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            if (previewDiv) previewDiv.style.display = 'none';
            if (resultsDiv) resultsDiv.style.display = 'none';
            previewConfig = null;
        });
    }
}

// Location Configuration Functions
function loadLocationConfig() {
    fetch('/api/location/config')
        .then(response => response.json())
        .then(data => {
            const cityInput = document.getElementById('geocoding-city');
            const stateInput = document.getElementById('geocoding-state');
            const countryInput = document.getElementById('geocoding-country');
            const countiesInput = document.getElementById('geocoding-counties');
            
            if (cityInput) cityInput.value = data.city || '';
            if (stateInput) stateInput.value = data.state || '';
            if (countryInput) countryInput.value = data.country || '';
            if (countiesInput) countiesInput.value = data.targetCounties || '';
        })
        .catch(error => {
            console.error('Error loading location config:', error);
        });
}

function detectUserLocation() {
    const statusEl = document.getElementById('location-detect-status');
    if (!navigator.geolocation) {
        if (statusEl) statusEl.textContent = 'Geolocation is not supported by this browser.';
        return;
    }
    
    if (statusEl) statusEl.textContent = 'Detecting location...';
    
    navigator.geolocation.getCurrentPosition(
        function(position) {
            const lat = position.coords.latitude;
            const lon = position.coords.longitude;
            
            // Send to API to get location details
            fetch('/api/location/detect', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ lat, lon })
            })
            .then(response => response.json())
            .then(data => {
                if (data.success && data.location) {
                    const loc = data.location;
                    const cityInput = document.getElementById('geocoding-city');
                    const stateInput = document.getElementById('geocoding-state');
                    const countryInput = document.getElementById('geocoding-country');
                    const countiesInput = document.getElementById('geocoding-counties');
                    
                    if (cityInput) cityInput.value = loc.city || '';
                    if (stateInput) stateInput.value = loc.state || '';
                    if (countryInput) countryInput.value = loc.country || '';
                    if (countiesInput) countiesInput.value = loc.county || '';
                    
                    if (statusEl) statusEl.textContent = `Detected: ${loc.displayName}`;
                    
                    // TODO: Show map with radius circle (Phase 2A - can be enhanced later)
                } else {
                    if (statusEl) statusEl.textContent = 'Could not detect location details.';
                }
            })
            .catch(error => {
                console.error('Error detecting location:', error);
                if (statusEl) statusEl.textContent = 'Error detecting location.';
            });
        },
        function(error) {
            if (statusEl) statusEl.textContent = 'Location detection failed: ' + error.message;
        }
    );
}

function saveLocationConfig() {
    const city = document.getElementById('geocoding-city').value.trim();
    const state = document.getElementById('geocoding-state').value.trim();
    const country = document.getElementById('geocoding-country').value.trim();
    const counties = document.getElementById('geocoding-counties').value.trim();
    
    fetch('/api/location/config', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ city, state, country, targetCounties: counties })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            showNotification(data.message || 'Location configuration saved.', 'success');
        } else {
            showNotification(data.error || 'Error saving location configuration', 'error');
        }
    })
    .catch(error => {
        console.error('Error saving location config:', error);
        showNotification('Error saving location configuration', 'error');
    });
}

// System Status Functions
const installationProgress = {
    docker: null,
    nodejs: null,
    python: null
};

function loadGPUStatus() {
    fetch('/api/system/gpu-status')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const statusText = document.getElementById('gpu-status-text');
                const gpuName = document.getElementById('gpu-name');
                const gpuCheckbox = document.getElementById('gpu-enabled-checkbox');
                const toolkitSection = document.getElementById('nvidia-toolkit-section');
                
                if (data.available && data.primary) {
                    const brand = data.primary.brand || 'nvidia';
                    const brandName = brand.charAt(0).toUpperCase() + brand.slice(1);
                    if (statusText) statusText.textContent = `✓ ${brandName} GPU Detected`;
                    if (statusText) statusText.style.color = '#00ff00';
                    if (gpuName) gpuName.textContent = `GPU: ${data.primary.name || 'Unknown'}`;
                    if (toolkitSection && brand === 'nvidia' && !data.toolkitInstalled) {
                        toolkitSection.style.display = 'block';
                    } else if (toolkitSection) {
                        toolkitSection.style.display = 'none';
                    }
                    
                    // Update service install buttons based on compatibility
                    if (data.serviceCompatibility) {
                        updateServiceButtons(data.serviceCompatibility);
                    }
                } else {
                    if (statusText) statusText.textContent = '✗ No GPU Detected';
                    if (statusText) statusText.style.color = '#ff0000';
                    if (toolkitSection) toolkitSection.style.display = 'none';
                }
            }
        })
        .catch(error => {
            console.error('Error loading GPU status:', error);
        });
}

function updateServiceButtons(compatibility) {
    // Disable/enable service install buttons based on GPU compatibility
    const ollamaDockerBtn = document.getElementById('install-ollama-docker-btn');
    const ollamaLocalBtn = document.getElementById('install-ollama-local-btn');
    const icadDockerBtn = document.getElementById('install-icad-docker-btn');
    const icadLocalBtn = document.getElementById('install-icad-local-btn');
    const fasterWhisperBtn = document.getElementById('install-faster-whisper-local-btn');
    
    if (ollamaDockerBtn && compatibility.ollama) {
        if (!compatibility.ollama.docker) {
            ollamaDockerBtn.disabled = true;
            ollamaDockerBtn.title = compatibility.ollama.reason || 'Not supported with current GPU';
        } else {
            ollamaDockerBtn.disabled = false;
            ollamaDockerBtn.title = '';
        }
    }
    
    if (ollamaLocalBtn && compatibility.ollama) {
        if (!compatibility.ollama.local) {
            ollamaLocalBtn.disabled = true;
            ollamaLocalBtn.title = compatibility.ollama.reason || 'Not supported with current GPU';
        } else {
            ollamaLocalBtn.disabled = false;
            ollamaLocalBtn.title = '';
        }
    }
    
    if (icadDockerBtn && compatibility.icad) {
        if (!compatibility.icad.supported || !compatibility.icad.docker) {
            icadDockerBtn.disabled = true;
            icadDockerBtn.title = compatibility.icad.reason || 'Not supported with current GPU';
        } else {
            icadDockerBtn.disabled = false;
            icadDockerBtn.title = '';
        }
    }
    
    if (icadLocalBtn && compatibility.icad) {
        if (!compatibility.icad.supported || !compatibility.icad.local) {
            icadLocalBtn.disabled = true;
            icadLocalBtn.title = compatibility.icad.reason || 'Not supported with current GPU';
        } else {
            icadLocalBtn.disabled = false;
            icadLocalBtn.title = '';
        }
    }
    
    if (fasterWhisperBtn && compatibility['faster-whisper']) {
        if (!compatibility['faster-whisper'].supported) {
            fasterWhisperBtn.disabled = true;
            fasterWhisperBtn.title = compatibility['faster-whisper'].reason || 'Not supported with current GPU';
        } else {
            fasterWhisperBtn.disabled = false;
            fasterWhisperBtn.title = '';
        }
    }
}

function saveGPUConfig(enabled) {
    fetch('/api/system/configure-gpu', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification(data.message || 'GPU configuration saved.', 'success');
            } else {
                showNotification(data.error || 'Error saving GPU configuration', 'error');
            }
        })
        .catch(error => {
            console.error('Error saving GPU config:', error);
            showNotification('Error saving GPU configuration', 'error');
        });
}

function installNvidiaToolkit() {
    const btn = document.getElementById('install-nvidia-toolkit-btn');
    if (btn) btn.disabled = true;
    
    fetch('/api/system/install-nvidia-toolkit', {
        method: 'POST'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('NVIDIA Container Toolkit installed successfully', 'success');
                loadGPUStatus(); // Reload to update UI
            } else {
                showNotification(data.error || 'Error installing NVIDIA Container Toolkit', 'error');
            }
        })
        .catch(error => {
            console.error('Error installing NVIDIA Container Toolkit:', error);
            showNotification('Error installing NVIDIA Container Toolkit', 'error');
        })
        .finally(() => {
            if (btn) btn.disabled = false;
        });
}

function loadAutoStartStatus() {
    fetch('/api/system/autostart-status')
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                const statusText = document.getElementById('autostart-status-text');
                const checkbox = document.getElementById('autostart-enabled-checkbox');
                
                if (statusText) {
                    statusText.textContent = data.enabled ? '✓ Enabled' : '✗ Disabled';
                    statusText.style.color = data.enabled ? '#00ff00' : '#ff0000';
                }
                if (checkbox) {
                    checkbox.checked = data.enabled || false;
                }
            }
        })
        .catch(error => {
            console.error('Error loading auto-start status:', error);
        });
}

function saveAutoStartConfig(enabled) {
    fetch('/api/system/configure-autostart', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ enabled })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('Auto-start configuration saved.', 'success');
                loadAutoStartStatus(); // Reload to update UI
            } else {
                showNotification(data.error || 'Error saving auto-start configuration', 'error');
            }
        })
        .catch(error => {
            console.error('Error saving auto-start config:', error);
            showNotification('Error saving auto-start configuration', 'error');
        });
}

function loadSystemStatus() {
    fetch('/api/system/status')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.status) {
                const status = data.status;
                
                // Show installation mode
                const modeText = document.getElementById('installation-mode-text');
                const modeDesc = document.getElementById('installation-mode-description');
                if (modeText) {
                    if (status.runningInDocker) {
                        modeText.textContent = 'Docker Container';
                        modeText.style.color = '#00ccff';
                        if (modeDesc) modeDesc.textContent = 'Running inside Docker. Services will be installed as Docker containers.';
                    } else {
                        modeText.textContent = 'Local Installation';
                        modeText.style.color = '#00ff00';
                        if (modeDesc) modeDesc.textContent = 'Running locally. Services will be installed as native applications.';
                    }
                }
                
                // Docker status
                const dockerStatus = document.getElementById('docker-status');
                const installDockerBtn = document.getElementById('install-docker-btn');
                if (dockerStatus) {
                    if (status.runningInDocker) {
                        dockerStatus.textContent = '✓ Running in Docker';
                        dockerStatus.style.color = '#00ccff';
                        if (installDockerBtn) installDockerBtn.style.display = 'none';
                    } else if (status.docker.installed && status.docker.daemonRunning) {
                        dockerStatus.textContent = '✓ Installed & Running';
                        dockerStatus.style.color = '#00ff00';
                        if (installDockerBtn) installDockerBtn.style.display = 'none';
                    } else if (status.docker.installed) {
                        dockerStatus.textContent = '⚠ Installed (not running)';
                        dockerStatus.style.color = '#ffff00';
                        if (installDockerBtn) installDockerBtn.style.display = 'none';
                    } else {
                        dockerStatus.textContent = '✗ Not Installed';
                        dockerStatus.style.color = '#ff0000';
                        // Only show install button if not running in Docker and can install
                        if (installDockerBtn && status.docker.canInstall !== false) {
                            installDockerBtn.style.display = 'inline-block';
                            installDockerBtn.disabled = false;
                        } else if (installDockerBtn) {
                            installDockerBtn.style.display = 'none';
                        }
                    }
                }
                
                // Node.js status
                const nodejsStatus = document.getElementById('nodejs-status');
                const installNodejsBtn = document.getElementById('install-nodejs-btn');
                if (nodejsStatus) {
                    if (status.nodejs.installed) {
                        nodejsStatus.textContent = `✓ ${status.nodejs.version || 'Installed'}`;
                        nodejsStatus.style.color = '#00ff00';
                        if (installNodejsBtn) installNodejsBtn.style.display = 'none';
                    } else {
                        nodejsStatus.textContent = '✗ Not Installed';
                        nodejsStatus.style.color = '#ff0000';
                        if (installNodejsBtn) {
                            installNodejsBtn.style.display = 'inline-block';
                            installNodejsBtn.disabled = false;
                        }
                    }
                }
                
                // Python status
                const pythonStatus = document.getElementById('python-status');
                const installPythonBtn = document.getElementById('install-python-btn');
                if (pythonStatus) {
                    if (status.python.installed) {
                        pythonStatus.textContent = `✓ ${status.python.version || 'Installed'}`;
                        pythonStatus.style.color = '#00ff00';
                        if (installPythonBtn) installPythonBtn.style.display = 'none';
                    } else {
                        pythonStatus.textContent = '✗ Not Installed';
                        pythonStatus.style.color = '#ff0000';
                        if (installPythonBtn) {
                            installPythonBtn.style.display = 'inline-block';
                            installPythonBtn.disabled = false;
                        }
                    }
                }
                
                // Service status
                if (status.services) {
                    // Ollama
                    const ollamaStatus = document.getElementById('ollama-status');
                    const installOllamaLocalBtn = document.getElementById('install-ollama-local-btn');
                    const installOllamaDockerBtn = document.getElementById('install-ollama-docker-btn');
                    if (ollamaStatus) {
                        if (status.services.ollama.running) {
                            ollamaStatus.textContent = `✓ Running (${status.services.ollama.url || 'localhost:11434'})`;
                            ollamaStatus.style.color = '#00ff00';
                            if (installOllamaLocalBtn) installOllamaLocalBtn.style.display = 'none';
                            if (installOllamaDockerBtn) installOllamaDockerBtn.style.display = 'none';
                        } else if (status.services.ollama.installed) {
                            ollamaStatus.textContent = '⚠ Installed (not running)';
                            ollamaStatus.style.color = '#ffff00';
                            if (installOllamaLocalBtn) installOllamaLocalBtn.style.display = 'none';
                            if (installOllamaDockerBtn) installOllamaDockerBtn.style.display = 'none';
                        } else {
                            ollamaStatus.textContent = '✗ Not Installed';
                            ollamaStatus.style.color = '#ff0000';
                            if (installOllamaLocalBtn) {
                                installOllamaLocalBtn.style.display = 'inline-block';
                                installOllamaLocalBtn.disabled = false;
                            }
                            if (installOllamaDockerBtn && status.docker.daemonRunning) {
                                installOllamaDockerBtn.style.display = 'inline-block';
                                installOllamaDockerBtn.disabled = false;
                            }
                        }
                    }
                    
                    // faster-whisper
                    const fasterWhisperStatus = document.getElementById('faster-whisper-status');
                    const installFasterWhisperBtn = document.getElementById('install-faster-whisper-btn');
                    if (fasterWhisperStatus) {
                        if (status.services.fasterWhisper.installed) {
                            fasterWhisperStatus.textContent = '✓ Installed';
                            fasterWhisperStatus.style.color = '#00ff00';
                            if (installFasterWhisperBtn) installFasterWhisperBtn.style.display = 'none';
                        } else {
                            fasterWhisperStatus.textContent = '✗ Not Installed';
                            fasterWhisperStatus.style.color = '#ff0000';
                            if (installFasterWhisperBtn) {
                                installFasterWhisperBtn.style.display = 'inline-block';
                                installFasterWhisperBtn.disabled = false;
                            }
                        }
                    }
                    
                    // iCAD Transcribe
                    const icadStatus = document.getElementById('icad-status');
                    const installIcadLocalBtn = document.getElementById('install-icad-local-btn');
                    const installIcadDockerBtn = document.getElementById('install-icad-docker-btn');
                    if (icadStatus) {
                        if (status.services.icadTranscribe.running) {
                            icadStatus.textContent = `✓ Running (${status.services.icadTranscribe.url || 'localhost:9912'})`;
                            icadStatus.style.color = '#00ff00';
                            if (installIcadLocalBtn) installIcadLocalBtn.style.display = 'none';
                            if (installIcadDockerBtn) installIcadDockerBtn.style.display = 'none';
                        } else if (status.services.icadTranscribe.installed) {
                            icadStatus.textContent = '⚠ Installed (not running)';
                            icadStatus.style.color = '#ffff00';
                            if (installIcadLocalBtn) installIcadLocalBtn.style.display = 'none';
                            if (installIcadDockerBtn) installIcadDockerBtn.style.display = 'none';
                        } else {
                            icadStatus.textContent = '✗ Not Installed';
                            icadStatus.style.color = '#ff0000';
                            if (installIcadLocalBtn) {
                                installIcadLocalBtn.style.display = 'inline-block';
                                installIcadLocalBtn.disabled = false;
                            }
                            if (installIcadDockerBtn && status.docker.daemonRunning) {
                                installIcadDockerBtn.style.display = 'inline-block';
                                installIcadDockerBtn.disabled = false;
                            }
                        }
                    }
                }
            }
        })
        .catch(error => {
            console.error('Error loading system status:', error);
        });
    
    // Load system info
    fetch('/api/system/info')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.info) {
                const info = data.info;
                const infoContent = document.getElementById('system-info-content');
                if (infoContent) {
                    infoContent.innerHTML = `
                        <div><strong>Platform:</strong> ${info.platform} ${info.arch}</div>
                        <div><strong>OS:</strong> ${info.type} ${info.release}</div>
                        <div><strong>Hostname:</strong> ${info.hostname}</div>
                        <div><strong>CPUs:</strong> ${info.cpus}</div>
                        <div><strong>Node.js:</strong> ${info.nodeVersion}</div>
                        ${info.npmVersion ? `<div><strong>npm:</strong> ${info.npmVersion}</div>` : ''}
                    `;
                }
            }
        })
        .catch(error => {
            console.error('Error loading system info:', error);
        });
    
    // Load model recommendations
    loadModelRecommendations();
    
    // Load service status
    loadServiceStatus();
}

function loadModelRecommendations() {
    fetch('/api/models/recommendations')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.recommendations) {
                const recs = data.recommendations;
                const content = document.getElementById('model-recommendations-content');
                if (content) {
                    let html = `<div style="margin-bottom: 15px;"><strong>Hardware:</strong> ${recs.hardware.type} (${recs.hardware.vramGB || 0}GB ${recs.hardware.hasGPU ? 'VRAM' : 'RAM'})</div>`;
                    html += `<div style="margin-bottom: 15px; padding: 10px; background-color: rgba(0, 51, 0, 0.2); border-radius: 4px;">${recs.summary.bestFor}</div>`;
                    
                    // Ollama recommendations
                    if (recs.ollama) {
                        html += `<div style="margin-top: 15px; padding: 10px; border: 1px solid var(--border-color); border-radius: 4px; margin-bottom: 10px;">`;
                        html += `<strong>🤖 Ollama (AI - Address Extraction, Summarization):</strong><br>`;
                        html += `<div style="margin-top: 5px;">Recommended: <code>${recs.ollama.recommended}</code></div>`;
                        html += `<div style="font-size: 0.9em; opacity: 0.8; margin-top: 5px;">${recs.ollama.description}</div>`;
                        html += `<div style="font-size: 0.9em; margin-top: 5px;">Use cases: ${recs.ollama.useCases ? recs.ollama.useCases.join(', ') : 'AI tasks'}</div>`;
                        html += `<div style="margin-top: 10px;">`;
                        html += `<button type="button" class="install-btn" onclick="pullOllamaModel('${recs.ollama.recommended}')">Pull Recommended Model</button>`;
                        if (recs.ollama.alternatives && recs.ollama.alternatives.length > 0) {
                            html += `<select id="ollama-alternative-select" style="margin-left: 10px; padding: 5px;">`;
                            html += `<option value="">Or choose alternative...</option>`;
                            recs.ollama.alternatives.forEach(alt => {
                                html += `<option value="${alt}">${alt}</option>`;
                            });
                            html += `</select>`;
                            html += `<button type="button" class="install-btn" onclick="pullOllamaModel(document.getElementById('ollama-alternative-select').value)" style="margin-left: 5px;">Pull</button>`;
                        }
                        html += `</div></div>`;
                    }
                    
                    // Whisper recommendations
                    if (recs.whisper) {
                        html += `<div style="margin-top: 15px; padding: 10px; border: 1px solid var(--border-color); border-radius: 4px; margin-bottom: 10px;">`;
                        html += `<strong>🎤 Whisper (Transcription):</strong><br>`;
                        html += `<div style="margin-top: 5px;">Recommended: <code>${recs.whisper.recommended}</code></div>`;
                        html += `<div style="font-size: 0.9em; opacity: 0.8; margin-top: 5px;">${recs.whisper.description}</div>`;
                        if (recs.whisper.bestFor) {
                            html += `<div style="font-size: 0.9em; margin-top: 5px;">Best for: ${recs.whisper.bestFor}</div>`;
                        }
                        html += `<div style="font-size: 0.9em; margin-top: 5px;">Public Safety Score: ${recs.whisper.publicSafetyScore || 'N/A'}/10</div>`;
                        html += `</div>`;
                    }
                    
                    // iCAD recommendations
                    if (recs.icad) {
                        html += `<div style="margin-top: 15px; padding: 10px; border: 1px solid var(--border-color); border-radius: 4px; margin-bottom: 10px;">`;
                        html += `<strong>🚨 iCAD Transcribe (Public Safety Optimized):</strong><br>`;
                        html += `<div style="margin-top: 5px;">Recommended: <code>${recs.icad.recommended}</code></div>`;
                        html += `<div style="font-size: 0.9em; opacity: 0.8; margin-top: 5px;">${recs.icad.description}</div>`;
                        if (recs.icad.bestFor) {
                            html += `<div style="font-size: 0.9em; margin-top: 5px;">Best for: ${recs.icad.bestFor}</div>`;
                        }
                        html += `<div style="font-size: 0.9em; margin-top: 5px;">Public Safety Score: ${recs.icad.publicSafetyScore || 'N/A'}/10</div>`;
                        if (recs.icad.warning) {
                            html += `<div style="font-size: 0.9em; color: #ffaa00; margin-top: 5px;">⚠ ${recs.icad.warning}</div>`;
                        }
                        html += `</div>`;
                    }
                    
                    content.innerHTML = html;
                }
            }
        })
        .catch(error => {
            console.error('Error loading model recommendations:', error);
            const content = document.getElementById('model-recommendations-content');
            if (content) {
                content.textContent = 'Error loading recommendations';
            }
        });
}

function loadServiceStatus() {
    fetch('/api/services/status')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.status) {
                const status = data.status;
                const content = document.getElementById('service-status-content');
                if (content) {
                    let html = '';
                    
                    // Ollama status
                    html += `<div style="margin-bottom: 10px;">`;
                    html += `<strong>Ollama:</strong> `;
                    if (status.ollama.running) {
                        html += `<span style="color: #00ff00;">✓ Running</span>`;
                        if (status.ollama.url) {
                            html += ` <span style="font-size: 0.9em; opacity: 0.8;">(${status.ollama.url})</span>`;
                        }
                        if (status.ollama.models && status.ollama.models.length > 0) {
                            html += `<div style="margin-top: 5px; font-size: 0.9em;">Models: ${status.ollama.models.join(', ')}</div>`;
                        } else {
                            html += `<div style="margin-top: 5px; font-size: 0.9em; color: #ffaa00;">No models installed</div>`;
                        }
                    } else {
                        html += `<span style="color: #ff0000;">✗ Not Running</span>`;
                    }
                    html += `</div>`;
                    
                    // iCAD status
                    html += `<div style="margin-bottom: 10px;">`;
                    html += `<strong>iCAD Transcribe:</strong> `;
                    if (status.icad.running) {
                        html += `<span style="color: #00ff00;">✓ Running</span>`;
                        if (status.icad.url) {
                            html += ` <span style="font-size: 0.9em; opacity: 0.8;">(${status.icad.url})</span>`;
                        }
                        html += `<div style="margin-top: 5px; font-size: 0.9em; opacity: 0.8;">Models are managed automatically by iCAD</div>`;
                    } else {
                        html += `<span style="color: #ff0000;">✗ Not Running</span>`;
                    }
                    html += `</div>`;
                    
                    // faster-whisper status
                    html += `<div>`;
                    html += `<strong>faster-whisper:</strong> `;
                    if (status.fasterWhisper.installed) {
                        html += `<span style="color: #00ff00;">✓ Installed</span>`;
                        html += `<div style="margin-top: 5px; font-size: 0.9em; opacity: 0.8;">Models download automatically on first use</div>`;
                    } else {
                        html += `<span style="color: #ff0000;">✗ Not Installed</span>`;
                    }
                    html += `</div>`;
                    
                    content.innerHTML = html;
                }
            }
        })
        .catch(error => {
            console.error('Error loading service status:', error);
            const content = document.getElementById('service-status-content');
            if (content) {
                content.textContent = 'Error loading service status';
            }
        });
}

// Auto-refresh service status every 30 seconds when System Status tab is active
let serviceStatusInterval = null;
function startServiceStatusAutoRefresh() {
    if (serviceStatusInterval) {
        clearInterval(serviceStatusInterval);
    }
    serviceStatusInterval = setInterval(() => {
        const systemTab = document.querySelector('.quick-start-tab[data-tab="system"]');
        if (systemTab && systemTab.classList.contains('active')) {
            loadServiceStatus();
        }
    }, 30000); // Refresh every 30 seconds
}

// Stop auto-refresh when tab is not active
function stopServiceStatusAutoRefresh() {
    if (serviceStatusInterval) {
        clearInterval(serviceStatusInterval);
        serviceStatusInterval = null;
    }
}

function pullOllamaModel(modelName) {
    if (!modelName) {
        showNotification('Please select a model to pull', 'error');
        return;
    }
    
    if (!confirm(`Pull Ollama model "${modelName}"? This may take several minutes.`)) {
        return;
    }
    
    fetch('/api/models/pull-ollama', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ modelName })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.jobId) {
                showNotification(`Pulling model ${modelName}...`, 'success');
                pollModelPullStatus('ollama', data.jobId, modelName);
            } else {
                showNotification(data.error || 'Error starting model pull', 'error');
            }
        })
        .catch(error => {
            console.error('Error pulling model:', error);
            showNotification('Error pulling model', 'error');
        });
}

function pollModelPullStatus(service, jobId, modelName) {
    const poll = () => {
        fetch(`/api/system/install-status/${jobId}`)
            .then(response => response.json())
            .then(data => {
                if (data.success && data.job) {
                    const job = data.job;
                    
                    if (job.status === 'running') {
                        console.log(`[${service}] Pulling ${modelName}: ${job.progress}%`);
                        setTimeout(poll, 2000);
                    } else if (job.status === 'completed') {
                        showNotification(`${modelName} pulled successfully!`, 'success');
                        loadServiceStatus(); // Refresh status
                        loadModelRecommendations(); // Refresh recommendations
                        // Also refresh if in settings
                        if (typeof loadSettingsInstalledModels === 'function') {
                            loadSettingsInstalledModels();
                        }
                        if (typeof loadQuickStartInstalledModels === 'function') {
                            loadQuickStartInstalledModels();
                        }
                    } else if (job.status === 'failed') {
                        showNotification(job.error || `Failed to pull ${modelName}`, 'error');
                    }
                } else {
                    showNotification('Model pull status unknown', 'error');
                }
            })
            .catch(error => {
                console.error(`Error polling model pull status:`, error);
                showNotification('Error checking pull status', 'error');
            });
    };
    
    poll();
}

// Settings-specific functions
function loadSettingsServiceStatus() {
    fetch('/api/services/status')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.status) {
                const status = data.status;
                const content = document.getElementById('settings-service-status-content');
                if (content) {
                    let html = '';
                    
                    // Ollama status
                    html += `<div style="margin-bottom: 10px;">`;
                    html += `<strong>Ollama:</strong> `;
                    if (status.ollama.running) {
                        html += `<span style="color: #00ff00;">✓ Running</span>`;
                        if (status.ollama.url) {
                            html += ` <span style="font-size: 0.9em; opacity: 0.8;">(${status.ollama.url})</span>`;
                        }
                        if (status.ollama.models && status.ollama.models.length > 0) {
                            html += `<div style="margin-top: 5px; font-size: 0.9em;">Installed models: ${status.ollama.models.join(', ')}</div>`;
                        } else {
                            html += `<div style="margin-top: 5px; font-size: 0.9em; color: #ffaa00;">No models installed</div>`;
                        }
                    } else {
                        html += `<span style="color: #ff0000;">✗ Not Running</span>`;
                    }
                    html += `</div>`;
                    
                    // iCAD status
                    html += `<div style="margin-bottom: 10px;">`;
                    html += `<strong>iCAD Transcribe:</strong> `;
                    if (status.icad.running) {
                        html += `<span style="color: #00ff00;">✓ Running</span>`;
                        if (status.icad.url) {
                            html += ` <span style="font-size: 0.9em; opacity: 0.8;">(${status.icad.url})</span>`;
                        }
                    } else {
                        html += `<span style="color: #ff0000;">✗ Not Running</span>`;
                    }
                    html += `</div>`;
                    
                    // faster-whisper status
                    html += `<div>`;
                    html += `<strong>faster-whisper:</strong> `;
                    if (status.fasterWhisper.installed) {
                        html += `<span style="color: #00ff00;">✓ Installed</span>`;
                    } else {
                        html += `<span style="color: #ff0000;">✗ Not Installed</span>`;
                    }
                    html += `</div>`;
                    
                    content.innerHTML = html;
                }
            }
        })
        .catch(error => {
            console.error('Error loading service status:', error);
            const content = document.getElementById('settings-service-status-content');
            if (content) {
                content.textContent = 'Error loading service status';
            }
        });
}

function loadSettingsModelRecommendations() {
    fetch('/api/models/recommendations')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.recommendations) {
                const recs = data.recommendations;
                const content = document.getElementById('settings-model-recommendations-content');
                const hardwareInfo = document.getElementById('settings-hardware-info');
                
                if (hardwareInfo) {
                    hardwareInfo.innerHTML = `
                        <div><strong>Type:</strong> ${recs.hardware.type}</div>
                        <div><strong>VRAM/RAM:</strong> ${recs.hardware.vramGB || 0}GB ${recs.hardware.hasGPU ? 'VRAM' : 'RAM'}</div>
                        <div style="margin-top: 5px; font-size: 0.9em; opacity: 0.8;">${recs.summary.bestFor}</div>
                    `;
                }
                
                if (content) {
                    let html = '';
                    
                    // Ollama recommendations
                    if (recs.ollama) {
                        html += `<div style="margin-bottom: 15px; padding: 10px; border: 1px solid var(--border-color); border-radius: 4px;">`;
                        html += `<strong>🤖 Ollama (AI - Address Extraction, Summarization):</strong><br>`;
                        html += `<div style="margin-top: 5px;">Recommended: <code>${recs.ollama.recommended}</code></div>`;
                        html += `<div style="font-size: 0.9em; opacity: 0.8; margin-top: 5px;">${recs.ollama.description}</div>`;
                        html += `<div style="font-size: 0.9em; margin-top: 5px;">Use cases: ${recs.ollama.useCases ? recs.ollama.useCases.join(', ') : 'AI tasks'}</div>`;
                        html += `<div style="font-size: 0.9em; margin-top: 5px;">Public Safety Score: ${recs.ollama.publicSafetyScore || 'N/A'}/10</div>`;
                        html += `<div style="margin-top: 10px;">`;
                        html += `<button type="button" class="install-btn" onclick="pullOllamaModel('${recs.ollama.recommended}')">Pull Recommended Model</button>`;
                        if (recs.ollama.alternatives && recs.ollama.alternatives.length > 0) {
                            html += `<select id="settings-ollama-alternative-select" style="margin-left: 10px; padding: 5px;">`;
                            html += `<option value="">Or choose alternative...</option>`;
                            recs.ollama.alternatives.forEach(alt => {
                                html += `<option value="${alt}">${alt}</option>`;
                            });
                            html += `</select>`;
                            html += `<button type="button" class="install-btn" onclick="pullOllamaModel(document.getElementById('settings-ollama-alternative-select').value)" style="margin-left: 5px;">Pull</button>`;
                        }
                        html += `</div></div>`;
                    }
                    
                    // Whisper recommendations
                    if (recs.whisper) {
                        html += `<div style="margin-bottom: 15px; padding: 10px; border: 1px solid var(--border-color); border-radius: 4px;">`;
                        html += `<strong>🎤 Whisper (Transcription):</strong><br>`;
                        html += `<div style="margin-top: 5px;">Recommended: <code>${recs.whisper.recommended}</code></div>`;
                        html += `<div style="font-size: 0.9em; opacity: 0.8; margin-top: 5px;">${recs.whisper.description}</div>`;
                        if (recs.whisper.bestFor) {
                            html += `<div style="font-size: 0.9em; margin-top: 5px;">Best for: ${recs.whisper.bestFor}</div>`;
                        }
                        html += `<div style="font-size: 0.9em; margin-top: 5px;">Public Safety Score: ${recs.whisper.publicSafetyScore || 'N/A'}/10</div>`;
                        html += `</div>`;
                    }
                    
                    // iCAD recommendations
                    if (recs.icad) {
                        html += `<div style="margin-bottom: 15px; padding: 10px; border: 1px solid var(--border-color); border-radius: 4px;">`;
                        html += `<strong>🚨 iCAD Transcribe (Public Safety Optimized):</strong><br>`;
                        html += `<div style="margin-top: 5px;">Recommended: <code>${recs.icad.recommended}</code></div>`;
                        html += `<div style="font-size: 0.9em; opacity: 0.8; margin-top: 5px;">${recs.icad.description}</div>`;
                        if (recs.icad.bestFor) {
                            html += `<div style="font-size: 0.9em; margin-top: 5px;">Best for: ${recs.icad.bestFor}</div>`;
                        }
                        html += `<div style="font-size: 0.9em; margin-top: 5px;">Public Safety Score: ${recs.icad.publicSafetyScore || 'N/A'}/10</div>`;
                        if (recs.icad.warning) {
                            html += `<div style="font-size: 0.9em; color: #ffaa00; margin-top: 5px;">⚠ ${recs.icad.warning}</div>`;
                        }
                        html += `</div>`;
                    }
                    
                    content.innerHTML = html;
                }
            }
        })
        .catch(error => {
            console.error('Error loading model recommendations:', error);
        });
}

function loadSettingsInstalledModels() {
    fetch('/api/services/status')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.status && data.status.ollama) {
                const content = document.getElementById('settings-installed-models-content');
                if (content) {
                    if (data.status.ollama.models && data.status.ollama.models.length > 0) {
                        let html = '<div style="display: flex; flex-direction: column; gap: 5px;">';
                        data.status.ollama.models.forEach(model => {
                            html += `<div style="padding: 5px; background-color: rgba(0, 0, 0, 0.2); border-radius: 4px;"><code>${model}</code></div>`;
                        });
                        html += '</div>';
                        content.innerHTML = html;
                    } else {
                        content.innerHTML = '<div style="color: #ffaa00;">No models installed. Pull a model using the recommendations above or the manual pull section.</div>';
                    }
                }
            }
        })
        .catch(error => {
            console.error('Error loading installed models:', error);
        });
}

function pullModelFromSettings() {
    const modelName = document.getElementById('settings-pull-model-name').value.trim();
    if (!modelName) {
        showNotification('Please enter a model name', 'error');
        return;
    }
    
    const statusEl = document.getElementById('settings-pull-model-status');
    if (statusEl) {
        statusEl.innerHTML = '<span style="color: #ffff00;">Starting pull...</span>';
    }
    
    pullOllamaModel(modelName);
    
    // Update status via polling
    const pollStatus = setInterval(() => {
        fetch('/api/services/status')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.status && data.status.ollama) {
                    if (data.status.ollama.models && data.status.ollama.models.includes(modelName)) {
                        if (statusEl) {
                            statusEl.innerHTML = `<span style="color: #00ff00;">✓ Model ${modelName} installed!</span>`;
                        }
                        clearInterval(pollStatus);
                        loadSettingsInstalledModels();
                    }
                }
            })
            .catch(() => {});
    }, 3000);
    
    setTimeout(() => clearInterval(pollStatus), 300000); // Stop after 5 minutes
}

function autoDetectServiceUrl(serviceName, port, inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    
    input.value = 'Detecting...';
    input.disabled = true;
    
    fetch('/api/system/status')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.status) {
                const runningInDocker = data.status.runningInDocker;
                let detectedUrl;
                
                if (runningInDocker) {
                    // Docker-to-Docker: Use service name
                    detectedUrl = `http://${serviceName}:${port}`;
                } else {
                    // Local-to-Docker or Local-to-Local: Use localhost
                    detectedUrl = `http://localhost:${port}`;
                }
                
                input.value = detectedUrl;
                input.disabled = false;
                showNotification(`Auto-detected URL: ${detectedUrl}`, 'success');
            } else {
                input.value = `http://localhost:${port}`;
                input.disabled = false;
                showNotification('Using default localhost URL', 'info');
            }
        })
        .catch(error => {
            console.error('Error auto-detecting URL:', error);
            input.value = `http://localhost:${port}`;
            input.disabled = false;
            showNotification('Using default localhost URL', 'info');
        });
}

function useRecommendedOllamaModel() {
    const recommended = document.getElementById('ai-ollama-recommended-model');
    if (recommended && recommended.textContent) {
        document.getElementById('settings-ollama-model').value = recommended.textContent.trim();
        showNotification('Recommended model set', 'success');
    }
}

// Quick Start Models Tab functions
function loadQuickStartModelRecommendations() {
    fetch('/api/models/recommendations')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.recommendations) {
                const recs = data.recommendations;
                const content = document.getElementById('quickstart-model-recommendations-content');
                const hardwareInfo = document.getElementById('quickstart-hardware-info');
                
                if (hardwareInfo) {
                    hardwareInfo.innerHTML = `
                        <div><strong>Type:</strong> ${recs.hardware.type}</div>
                        <div><strong>VRAM/RAM:</strong> ${recs.hardware.vramGB || 0}GB ${recs.hardware.hasGPU ? 'VRAM' : 'RAM'}</div>
                        <div style="margin-top: 5px; font-size: 0.9em; opacity: 0.8;">${recs.summary.bestFor}</div>
                    `;
                }
                
                if (content) {
                    let html = '';
                    
                    // Ollama recommendations
                    if (recs.ollama) {
                        html += `<div style="margin-bottom: 15px; padding: 10px; border: 1px solid var(--border-color); border-radius: 4px;">`;
                        html += `<strong>🤖 Ollama (AI - Address Extraction, Summarization):</strong><br>`;
                        html += `<div style="margin-top: 5px;">Recommended: <code>${recs.ollama.recommended}</code></div>`;
                        html += `<div style="font-size: 0.9em; opacity: 0.8; margin-top: 5px;">${recs.ollama.description}</div>`;
                        html += `<div style="font-size: 0.9em; margin-top: 5px;">Use cases: ${recs.ollama.useCases ? recs.ollama.useCases.join(', ') : 'AI tasks'}</div>`;
                        html += `<div style="font-size: 0.9em; margin-top: 5px;">Public Safety Score: ${recs.ollama.publicSafetyScore || 'N/A'}/10</div>`;
                        html += `<div style="margin-top: 10px;">`;
                        html += `<button type="button" class="install-btn" onclick="pullOllamaModel('${recs.ollama.recommended}')">Pull Recommended Model</button>`;
                        if (recs.ollama.alternatives && recs.ollama.alternatives.length > 0) {
                            html += `<select id="quickstart-ollama-alternative-select" style="margin-left: 10px; padding: 5px;">`;
                            html += `<option value="">Or choose alternative...</option>`;
                            recs.ollama.alternatives.forEach(alt => {
                                html += `<option value="${alt}">${alt}</option>`;
                            });
                            html += `</select>`;
                            html += `<button type="button" class="install-btn" onclick="pullOllamaModel(document.getElementById('quickstart-ollama-alternative-select').value)" style="margin-left: 5px;">Pull</button>`;
                        }
                        html += `</div></div>`;
                    }
                    
                    // Whisper recommendations
                    if (recs.whisper) {
                        html += `<div style="margin-bottom: 15px; padding: 10px; border: 1px solid var(--border-color); border-radius: 4px;">`;
                        html += `<strong>🎤 Whisper (Transcription):</strong><br>`;
                        html += `<div style="margin-top: 5px;">Recommended: <code>${recs.whisper.recommended}</code></div>`;
                        html += `<div style="font-size: 0.9em; opacity: 0.8; margin-top: 5px;">${recs.whisper.description}</div>`;
                        if (recs.whisper.bestFor) {
                            html += `<div style="font-size: 0.9em; margin-top: 5px;">Best for: ${recs.whisper.bestFor}</div>`;
                        }
                        html += `<div style="font-size: 0.9em; margin-top: 5px;">Public Safety Score: ${recs.whisper.publicSafetyScore || 'N/A'}/10</div>`;
                        html += `</div>`;
                    }
                    
                    // iCAD recommendations
                    if (recs.icad) {
                        html += `<div style="margin-bottom: 15px; padding: 10px; border: 1px solid var(--border-color); border-radius: 4px;">`;
                        html += `<strong>🚨 iCAD Transcribe (Public Safety Optimized):</strong><br>`;
                        html += `<div style="margin-top: 5px;">Recommended: <code>${recs.icad.recommended}</code></div>`;
                        html += `<div style="font-size: 0.9em; opacity: 0.8; margin-top: 5px;">${recs.icad.description}</div>`;
                        if (recs.icad.bestFor) {
                            html += `<div style="font-size: 0.9em; margin-top: 5px;">Best for: ${recs.icad.bestFor}</div>`;
                        }
                        html += `<div style="font-size: 0.9em; margin-top: 5px;">Public Safety Score: ${recs.icad.publicSafetyScore || 'N/A'}/10</div>`;
                        if (recs.icad.warning) {
                            html += `<div style="font-size: 0.9em; color: #ffaa00; margin-top: 5px;">⚠ ${recs.icad.warning}</div>`;
                        }
                        html += `</div>`;
                    }
                    
                    content.innerHTML = html;
                }
            }
        })
        .catch(error => {
            console.error('Error loading model recommendations:', error);
        });
}

function loadQuickStartInstalledModels() {
    fetch('/api/services/status')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.status && data.status.ollama) {
                const content = document.getElementById('quickstart-installed-models-content');
                if (content) {
                    if (data.status.ollama.models && data.status.ollama.models.length > 0) {
                        let html = '<div style="display: flex; flex-direction: column; gap: 5px;">';
                        data.status.ollama.models.forEach(model => {
                            html += `<div style="padding: 5px; background-color: rgba(0, 0, 0, 0.2); border-radius: 4px;"><code>${model}</code></div>`;
                        });
                        html += '</div>';
                        content.innerHTML = html;
                    } else {
                        content.innerHTML = '<div style="color: #ffaa00;">No models installed. Pull a model using the recommendations above.</div>';
                    }
                }
            }
        })
        .catch(error => {
            console.error('Error loading installed models:', error);
        });
}

function pullModelFromQuickStart() {
    const modelName = document.getElementById('quickstart-pull-model-name').value.trim();
    if (!modelName) {
        showNotification('Please enter a model name', 'error');
        return;
    }
    
    const statusEl = document.getElementById('quickstart-pull-model-status');
    if (statusEl) {
        statusEl.innerHTML = '<span style="color: #ffff00;">Starting pull...</span>';
    }
    
    pullOllamaModel(modelName);
    
    // Update status via polling
    const pollStatus = setInterval(() => {
        fetch('/api/services/status')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.status && data.status.ollama) {
                    if (data.status.ollama.models && data.status.ollama.models.includes(modelName)) {
                        if (statusEl) {
                            statusEl.innerHTML = `<span style="color: #00ff00;">✓ Model ${modelName} installed!</span>`;
                        }
                        clearInterval(pollStatus);
                        loadQuickStartInstalledModels();
                    }
                }
            })
            .catch(() => {});
    }, 3000);
    
    setTimeout(() => clearInterval(pollStatus), 300000); // Stop after 5 minutes
}

// Update Management Functions
function loadUpdateStatus() {
    fetch('/api/updates/check')
        .then(response => response.json())
        .then(data => {
            const currentVersionEl = document.getElementById('current-version');
            const latestVersionEl = document.getElementById('latest-version');
            const updateBadge = document.getElementById('update-available-badge');
            const installUpdateBtn = document.getElementById('install-update-btn');
            
            if (currentVersionEl) currentVersionEl.textContent = data.currentVersion || 'Unknown';
            if (latestVersionEl) latestVersionEl.textContent = data.latestVersion || 'Unknown';
            
            if (data.updateAvailable) {
                if (updateBadge) updateBadge.style.display = 'block';
                if (installUpdateBtn) installUpdateBtn.style.display = 'inline-block';
            } else {
                if (updateBadge) updateBadge.style.display = 'none';
                if (installUpdateBtn) installUpdateBtn.style.display = 'none';
            }
        })
        .catch(error => {
            console.error('Error checking updates:', error);
        });
    
    // Load auto-update config
    fetch('/api/updates/config')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.config) {
                const checkbox = document.getElementById('auto-update-checkbox');
                if (checkbox) {
                    checkbox.checked = data.config.autoUpdateCheck || false;
                }
            }
        })
        .catch(error => {
            console.error('Error loading update config:', error);
        });
}

function checkForUpdates() {
    const checkBtn = document.getElementById('check-updates-btn');
    if (checkBtn) checkBtn.disabled = true;
    
    fetch('/api/updates/check')
        .then(response => response.json())
        .then(data => {
            loadUpdateStatus(); // Reload to update UI
            if (data.updateAvailable) {
                showNotification('Update available!', 'success');
            } else {
                showNotification('You are running the latest version.', 'success');
            }
        })
        .catch(error => {
            console.error('Error checking updates:', error);
            showNotification('Error checking for updates', 'error');
        })
        .finally(() => {
            if (checkBtn) checkBtn.disabled = false;
        });
}

function installUpdate() {
    if (!confirm('This will update the application. Continue?')) {
        return;
    }
    
    const installBtn = document.getElementById('install-update-btn');
    if (installBtn) installBtn.disabled = true;
    
    fetch('/api/updates/install', {
        method: 'POST'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification(data.message || 'Update installed. Please restart the application.', 'success');
                loadUpdateStatus(); // Reload to update UI
            } else {
                showNotification(data.error || 'Error installing update', 'error');
            }
        })
        .catch(error => {
            console.error('Error installing update:', error);
            showNotification('Error installing update', 'error');
        })
        .finally(() => {
            if (installBtn) installBtn.disabled = false;
        });
}

function saveUpdateConfig(enabled) {
    fetch('/api/updates/config', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ autoUpdateCheck: enabled })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('Auto-update configuration saved.', 'success');
            } else {
                showNotification(data.error || 'Error saving update config', 'error');
            }
        })
        .catch(error => {
            console.error('Error saving update config:', error);
            showNotification('Error saving update configuration', 'error');
        });
}

// Radio Configuration Functions - Talkgroups
function loadTalkgroups() {
    fetch('/api/radio/talkgroups')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.talkgroups) {
                const tbody = document.getElementById('talkgroups-table-body');
                if (tbody) {
                    tbody.innerHTML = '';
                    if (data.talkgroups.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="8">No talkgroups configured</td></tr>';
                    } else {
                        data.talkgroups.forEach(tg => {
                            const row = document.createElement('tr');
                            row.innerHTML = `
                                <td>${tg.id || ''}</td>
                                <td>${tg.hex || ''}</td>
                                <td>${tg.alpha_tag || ''}</td>
                                <td>${tg.mode || ''}</td>
                                <td>${tg.description || ''}</td>
                                <td>${tg.tag || ''}</td>
                                <td>${tg.county || ''}</td>
                                <td>
                                    <button onclick="editTalkgroup('${tg.id}')">Edit</button>
                                    <button onclick="deleteTalkgroup('${tg.id}')">Delete</button>
                                </td>
                            `;
                            tbody.appendChild(row);
                        });
                    }
                }
            }
        })
        .catch(error => {
            console.error('Error loading talkgroups:', error);
        });
}

function showTalkgroupEditForm(talkgroupId = null) {
    const form = document.getElementById('talkgroup-edit-form');
    const title = document.getElementById('talkgroup-form-title');
    
    if (form) {
        form.style.display = 'block';
        
        if (talkgroupId) {
            if (title) title.textContent = 'Edit Talkgroup';
            // Load existing talkgroup data
            fetch(`/api/radio/talkgroups`)
                .then(response => response.json())
                .then(data => {
                    if (data.success && data.talkgroups) {
                        const tg = data.talkgroups.find(t => t.id.toString() === talkgroupId.toString());
                        if (tg) {
                            document.getElementById('talkgroup-dec').value = tg.id || '';
                            document.getElementById('talkgroup-hex').value = tg.hex || '';
                            document.getElementById('talkgroup-alpha-tag').value = tg.alpha_tag || '';
                            document.getElementById('talkgroup-mode').value = tg.mode || '';
                            document.getElementById('talkgroup-description').value = tg.description || '';
                            document.getElementById('talkgroup-tag').value = tg.tag || '';
                            document.getElementById('talkgroup-county').value = tg.county || '';
                            document.getElementById('talkgroup-dec').disabled = true; // Can't change ID
                        }
                    }
                });
        } else {
            if (title) title.textContent = 'Add Talkgroup';
            // Clear form
            document.getElementById('talkgroup-dec').value = '';
            document.getElementById('talkgroup-hex').value = '';
            document.getElementById('talkgroup-alpha-tag').value = '';
            document.getElementById('talkgroup-mode').value = '';
            document.getElementById('talkgroup-description').value = '';
            document.getElementById('talkgroup-tag').value = '';
            document.getElementById('talkgroup-county').value = '';
            document.getElementById('talkgroup-dec').disabled = false;
        }
    }
}

function editTalkgroup(id) {
    showTalkgroupEditForm(id);
}

function deleteTalkgroup(id) {
    if (!confirm(`Delete talkgroup ${id}?`)) {
        return;
    }
    
    fetch(`/api/radio/talkgroups/${id}`, {
        method: 'DELETE'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('Talkgroup deleted successfully', 'success');
                loadTalkgroups();
            } else {
                showNotification(data.error || 'Error deleting talkgroup', 'error');
            }
        })
        .catch(error => {
            console.error('Error deleting talkgroup:', error);
            showNotification('Error deleting talkgroup', 'error');
        });
}

function saveTalkgroup() {
    const id = document.getElementById('talkgroup-dec').value.trim();
    if (!id) {
        showNotification('DEC (ID) is required', 'error');
        return;
    }
    
    const data = {
        id: id,
        hex: document.getElementById('talkgroup-hex').value.trim() || null,
        alpha_tag: document.getElementById('talkgroup-alpha-tag').value.trim() || null,
        mode: document.getElementById('talkgroup-mode').value.trim() || null,
        description: document.getElementById('talkgroup-description').value.trim() || null,
        tag: document.getElementById('talkgroup-tag').value.trim() || null,
        county: document.getElementById('talkgroup-county').value.trim() || null
    };
    
    fetch('/api/radio/talkgroups', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                showNotification('Talkgroup saved successfully', 'success');
                document.getElementById('talkgroup-edit-form').style.display = 'none';
                loadTalkgroups();
            } else {
                showNotification(result.error || 'Error saving talkgroup', 'error');
            }
        })
        .catch(error => {
            console.error('Error saving talkgroup:', error);
            showNotification('Error saving talkgroup', 'error');
        });
}

// Radio Configuration Functions - Frequencies
function loadFrequencies() {
    fetch('/api/radio/frequencies')
        .then(response => response.json())
        .then(data => {
            if (data.success && data.frequencies) {
                const tbody = document.getElementById('frequencies-table-body');
                if (tbody) {
                    tbody.innerHTML = '';
                    if (data.frequencies.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="4">No frequencies configured</td></tr>';
                    } else {
                        data.frequencies.forEach(freq => {
                            const row = document.createElement('tr');
                            row.innerHTML = `
                                <td>${freq.id || ''}</td>
                                <td>${freq.frequency || ''}</td>
                                <td>${freq.description || ''}</td>
                                <td>
                                    <button onclick="editFrequency('${freq.id}')">Edit</button>
                                    <button onclick="deleteFrequency('${freq.id}')">Delete</button>
                                </td>
                            `;
                            tbody.appendChild(row);
                        });
                    }
                }
            }
        })
        .catch(error => {
            console.error('Error loading frequencies:', error);
        });
}

function showFrequencyEditForm(frequencyId = null) {
    const form = document.getElementById('frequency-edit-form');
    const title = document.getElementById('frequency-form-title');
    
    if (form) {
        form.style.display = 'block';
        
        if (frequencyId) {
            if (title) title.textContent = 'Edit Frequency';
            // Load existing frequency data
            fetch(`/api/radio/frequencies`)
                .then(response => response.json())
                .then(data => {
                    if (data.success && data.frequencies) {
                        const freq = data.frequencies.find(f => f.id.toString() === frequencyId.toString());
                        if (freq) {
                            document.getElementById('frequency-site-id').value = freq.id || '';
                            document.getElementById('frequency-value').value = freq.frequency || '';
                            document.getElementById('frequency-description').value = freq.description || '';
                        }
                    }
                });
        } else {
            if (title) title.textContent = 'Add Frequency';
            // Clear form
            document.getElementById('frequency-site-id').value = '';
            document.getElementById('frequency-value').value = '';
            document.getElementById('frequency-description').value = '';
        }
    }
}

function editFrequency(id) {
    showFrequencyEditForm(id);
}

function deleteFrequency(id) {
    if (!confirm(`Delete frequency ${id}?`)) {
        return;
    }
    
    fetch(`/api/radio/frequencies/${id}`, {
        method: 'DELETE'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                showNotification('Frequency deleted successfully', 'success');
                loadFrequencies();
            } else {
                showNotification(data.error || 'Error deleting frequency', 'error');
            }
        })
        .catch(error => {
            console.error('Error deleting frequency:', error);
            showNotification('Error deleting frequency', 'error');
        });
}

function saveFrequency() {
    const frequency = document.getElementById('frequency-value').value.trim();
    if (!frequency) {
        showNotification('Frequency is required', 'error');
        return;
    }
    
    const siteId = document.getElementById('frequency-site-id').value.trim();
    const data = {
        frequency: frequency,
        description: document.getElementById('frequency-description').value.trim() || null
    };
    
    if (siteId) {
        data.id = parseInt(siteId);
    }
    
    fetch('/api/radio/frequencies', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    })
        .then(response => response.json())
        .then(result => {
            if (result.success) {
                showNotification('Frequency saved successfully', 'success');
                document.getElementById('frequency-edit-form').style.display = 'none';
                loadFrequencies();
            } else {
                showNotification(result.error || 'Error saving frequency', 'error');
            }
        })
        .catch(error => {
            console.error('Error saving frequency:', error);
            showNotification('Error saving frequency', 'error');
        });
}

function installService(service, useDocker) {
    const serviceNames = {
        'ollama': 'Ollama',
        'faster-whisper': 'faster-whisper',
        'icad-transcribe': 'iCAD Transcribe'
    };
    
    const serviceName = serviceNames[service] || service;
    const installType = useDocker ? 'Docker' : 'Local';
    
    if (!confirm(`Install ${serviceName} as ${installType} installation?`)) {
        return;
    }
    
    // Map service name for API endpoint
    const apiServiceName = service === 'icad-transcribe' ? 'icad-transcribe' : service;
    const endpoint = `/api/system/install-${apiServiceName}`;
    const btnId = `install-${service}${useDocker ? '-docker' : '-local'}-btn`;
    const btn = document.getElementById(btnId);
    // Map status element ID (icad vs icad-transcribe)
    const statusElId = service === 'icad-transcribe' ? 'icad-status' : `${service}-status`;
    const statusEl = document.getElementById(statusElId);
    
    if (btn) btn.disabled = true;
    if (statusEl) {
        statusEl.textContent = '⏳ Starting installation...';
        statusEl.style.color = '#ffff00';
    }
    
    fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ useDocker })
    })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.jobId) {
                showNotification(`${serviceName} installation started.`, 'success');
                // Poll for installation status using the existing function
                pollServiceInstallationStatus(apiServiceName, data.jobId, btnId);
            } else {
                if (statusEl) {
                    statusEl.textContent = '✗ Installation failed';
                    statusEl.style.color = '#ff0000';
                }
                if (btn) btn.disabled = false;
                showNotification(data.error || `Error starting ${serviceName} installation`, 'error');
            }
        })
        .catch(error => {
            console.error(`Error installing ${serviceName}:`, error);
            if (statusEl) {
                statusEl.textContent = '✗ Installation error';
                statusEl.style.color = '#ff0000';
            }
            if (btn) btn.disabled = false;
            showNotification(`Error installing ${serviceName}`, 'error');
        });
}

function pollServiceInstallationStatus(service, jobId, btnId) {
    const statusEl = document.getElementById(`${service}-status`);
    const btn = document.getElementById(btnId);
    
    // Map service names for display
    const serviceNames = {
        'ollama': 'Ollama',
        'faster-whisper': 'faster-whisper',
        'icad-transcribe': 'iCAD Transcribe'
    };
    const displayName = serviceNames[service] || service;
    
    const poll = () => {
        fetch(`/api/system/install-status/${jobId}`)
            .then(response => response.json())
            .then(data => {
                if (data.success && data.job) {
                    const job = data.job;
                    
                    if (job.status === 'running') {
                        if (statusEl) {
                            statusEl.textContent = `⏳ Installing... (${Math.round(job.progress || 0)}%)`;
                            statusEl.style.color = '#ffff00';
                        }
                        // Show output if available
                        if (job.output && job.output.length > 0) {
                            const lastOutput = job.output[job.output.length - 1];
                            if (lastOutput && lastOutput.length < 100) {
                                // Show last output line if it's short
                                console.log(`[${displayName}] ${lastOutput}`);
                            }
                        }
                        setTimeout(poll, 2000);
                    } else if (job.status === 'completed') {
                        if (statusEl) {
                            statusEl.textContent = '✓ Installation complete';
                            statusEl.style.color = '#00ff00';
                        }
                        if (btn) btn.style.display = 'none';
                        showNotification(`${displayName} installed successfully`, 'success');
                        setTimeout(() => loadSystemStatus(), 2000);
                    } else if (job.status === 'failed') {
                        if (statusEl) {
                            statusEl.textContent = '✗ Installation failed';
                            statusEl.style.color = '#ff0000';
                        }
                        if (btn) btn.disabled = false;
                        const errorMsg = job.error || `${displayName} installation failed`;
                        showNotification(errorMsg, 'error');
                        console.error(`[${displayName}] Installation failed:`, job.error);
                        if (job.output && job.output.length > 0) {
                            console.error(`[${displayName}] Output:`, job.output);
                        }
                    }
                } else {
                    if (statusEl) statusEl.textContent = '✗ Installation status unknown';
                    if (btn) btn.disabled = false;
                }
            })
            .catch(error => {
                console.error(`Error polling ${displayName} installation status:`, error);
                if (statusEl) statusEl.textContent = '✗ Status check failed';
                if (btn) btn.disabled = false;
            });
    };
    
    poll();
}

function installDependency(type) {
    const btn = document.getElementById(`install-${type}-btn`);
    const statusEl = document.getElementById(`${type}-status`);
    
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.textContent = '⏳ Installing...';
    
    fetch(`/api/system/install-${type}`, {
        method: 'POST'
    })
        .then(response => response.json())
        .then(data => {
            if (data.success && data.jobId) {
                installationProgress[type] = data.jobId;
                pollInstallationStatus(type, data.jobId);
            } else {
                if (statusEl) statusEl.textContent = '✗ Installation failed';
                if (btn) btn.disabled = false;
                showNotification(data.error || 'Installation failed', 'error');
            }
        })
        .catch(error => {
            console.error(`Error starting ${type} installation:`, error);
            if (statusEl) statusEl.textContent = '✗ Installation error';
            if (btn) btn.disabled = false;
            showNotification(`Error starting ${type} installation`, 'error');
        });
}

function pollInstallationStatus(type, jobId) {
    const statusEl = document.getElementById(`${type}-status`);
    const btn = document.getElementById(`install-${type}-btn`);
    
    const poll = () => {
        fetch(`/api/system/install-status/${jobId}`)
            .then(response => response.json())
            .then(data => {
                if (data.success && data.job) {
                    const job = data.job;
                    
                    if (job.status === 'running') {
                        if (statusEl) statusEl.textContent = `⏳ Installing... (${job.progress || 0}%)`;
                        setTimeout(poll, 2000); // Poll every 2 seconds
                    } else if (job.status === 'completed') {
                        if (statusEl) statusEl.textContent = '✓ Installation complete';
                        if (statusEl) statusEl.style.color = '#00ff00';
                        if (btn) btn.style.display = 'none';
                        installationProgress[type] = null;
                        showNotification(`${type} installed successfully`, 'success');
                        // Reload system status to update versions
                        setTimeout(() => loadSystemStatus(), 2000);
                    } else if (job.status === 'failed') {
                        if (statusEl) statusEl.textContent = '✗ Installation failed';
                        if (statusEl) statusEl.style.color = '#ff0000';
                        if (btn) btn.disabled = false;
                        installationProgress[type] = null;
                        showNotification(job.error || `${type} installation failed`, 'error');
                    }
                } else {
                    // Job not found or expired
                    if (statusEl) statusEl.textContent = '✗ Installation status unknown';
                    if (btn) btn.disabled = false;
                    installationProgress[type] = null;
                }
            })
            .catch(error => {
                console.error(`Error polling ${type} installation status:`, error);
                if (statusEl) statusEl.textContent = '✗ Status check failed';
                if (btn) btn.disabled = false;
                installationProgress[type] = null;
            });
    };
    
    poll();
}

// CSV Import Functions
function setupCSVImport(type) {
    const importBtn = document.getElementById(`import-${type}-csv-btn`);
    const importSection = document.getElementById(`${type}-csv-import-section`);
    const fileInput = document.getElementById(`${type}-csv-file`);
    const dropZone = document.getElementById(`${type}-csv-drop-zone`);
    const previewDiv = document.getElementById(`${type}-csv-preview`);
    const previewContent = document.getElementById(`${type}-csv-preview-content`);
    const previewErrors = document.getElementById(`${type}-csv-preview-errors`);
    const importBtn2 = document.getElementById(`${type}-csv-import-btn`);
    const cancelBtn = document.getElementById(`${type}-csv-cancel-btn`);
    const progressDiv = document.getElementById(`${type}-csv-progress`);
    const resultsDiv = document.getElementById(`${type}-csv-results`);
    const mergeCheckbox = document.getElementById(`${type}-csv-merge`);
    
    let selectedFile = null;
    let previewData = null;
    
    // Show/hide import section
    if (importBtn) {
        importBtn.addEventListener('click', function() {
            if (importSection) {
                importSection.style.display = importSection.style.display === 'none' ? 'block' : 'none';
            }
        });
    }
    
    // File input change
    if (fileInput) {
        fileInput.addEventListener('change', function(e) {
            if (e.target.files && e.target.files[0]) {
                selectedFile = e.target.files[0];
                previewCSVFile(selectedFile, type);
            }
        });
    }
    
    // Drag and drop
    if (dropZone) {
        dropZone.addEventListener('click', function() {
            if (fileInput) fileInput.click();
        });
        
        dropZone.addEventListener('dragover', function(e) {
            e.preventDefault();
            dropZone.style.backgroundColor = 'rgba(0, 255, 0, 0.1)';
        });
        
        dropZone.addEventListener('dragleave', function(e) {
            e.preventDefault();
            dropZone.style.backgroundColor = '';
        });
        
        dropZone.addEventListener('drop', function(e) {
            e.preventDefault();
            dropZone.style.backgroundColor = '';
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                selectedFile = e.dataTransfer.files[0];
                if (fileInput) fileInput.files = e.dataTransfer.files;
                previewCSVFile(selectedFile, type);
            }
        });
    }
    
    // Preview CSV
    function previewCSVFile(file, csvType) {
        if (!file) return;
        
        const formData = new FormData();
        formData.append('file', file);
        
        fetch(`/api/radio/import-preview?type=${csvType}`, {
            method: 'POST',
            body: formData
        })
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    previewData = data;
                    if (previewContent) {
                        let html = '<table style="width: 100%; font-size: 12px;"><thead><tr>';
                        if (csvType === 'talkgroups') {
                            html += '<th>DEC</th><th>HEX</th><th>Alpha Tag</th><th>Mode</th><th>Description</th><th>Tag</th><th>County</th>';
                        } else {
                            html += '<th>Site ID</th><th>Frequency</th><th>Description</th>';
                        }
                        html += '</tr></thead><tbody>';
                        data.preview.forEach(row => {
                            html += '<tr>';
                            if (csvType === 'talkgroups') {
                                html += `<td>${row.DEC || row['DEC'] || ''}</td>`;
                                html += `<td>${row.HEX || row['HEX'] || ''}</td>`;
                                html += `<td>${row['Alpha Tag'] || row['alpha_tag'] || ''}</td>`;
                                html += `<td>${row.Mode || row['Mode'] || ''}</td>`;
                                html += `<td>${row.Description || row['Description'] || ''}</td>`;
                                html += `<td>${row.Tag || row['Tag'] || ''}</td>`;
                                html += `<td>${row.County || row['County'] || ''}</td>`;
                            } else {
                                html += `<td>${row['Site ID'] || row['site_id'] || ''}</td>`;
                                html += `<td>${row.Frequency || row['Frequency'] || ''}</td>`;
                                html += `<td>${row.Description || row['Description'] || ''}</td>`;
                            }
                            html += '</tr>';
                        });
                        html += '</tbody></table>';
                        previewContent.innerHTML = html;
                    }
                    if (previewErrors) {
                        if (data.errors && data.errors.length > 0) {
                            previewErrors.innerHTML = '<strong>Validation Errors:</strong><br>' + data.errors.join('<br>');
                        } else {
                            previewErrors.innerHTML = '';
                        }
                    }
                    if (previewDiv) previewDiv.style.display = 'block';
                } else {
                    showNotification(data.error || 'Error previewing CSV', 'error');
                }
            })
            .catch(error => {
                console.error('Error previewing CSV:', error);
                showNotification('Error previewing CSV file', 'error');
            });
    }
    
    // Import CSV
    if (importBtn2) {
        importBtn2.addEventListener('click', function() {
            if (!selectedFile) {
                showNotification('Please select a CSV file first', 'error');
                return;
            }
            
            const merge = mergeCheckbox ? mergeCheckbox.checked : false;
            const formData = new FormData();
            formData.append('file', selectedFile);
            
            if (progressDiv) progressDiv.style.display = 'block';
            if (importBtn2) importBtn2.disabled = true;
            
            fetch(`/api/radio/import-csv?type=${type}&merge=${merge}`, {
                method: 'POST',
                body: formData
            })
                .then(response => response.json())
                .then(data => {
                    if (progressDiv) progressDiv.style.display = 'none';
                    if (importBtn2) importBtn2.disabled = false;
                    
                    if (data.success !== false) {
                        let message = `Imported ${data.imported} ${type}`;
                        if (data.skipped > 0) {
                            message += `, skipped ${data.skipped}`;
                        }
                        if (data.errors && data.errors.length > 0) {
                            message += `, ${data.errors.length} errors`;
                            if (resultsDiv) {
                                resultsDiv.style.display = 'block';
                                resultsDiv.style.backgroundColor = 'rgba(255, 255, 0, 0.2)';
                                resultsDiv.innerHTML = `<strong>Import Results:</strong><br>${message}<br><strong>Errors:</strong><br>${data.errors.slice(0, 10).join('<br>')}${data.errors.length > 10 ? '<br>...' : ''}`;
                            }
                        } else {
                            showNotification(message, 'success');
                            if (resultsDiv) resultsDiv.style.display = 'none';
                        }
                        
                        // Reload the list
                        if (type === 'talkgroups') {
                            loadTalkgroups();
                        } else {
                            loadFrequencies();
                        }
                        
                        // Reset form
                        if (fileInput) fileInput.value = '';
                        selectedFile = null;
                        if (previewDiv) previewDiv.style.display = 'none';
                    } else {
                        showNotification(data.error || 'Error importing CSV', 'error');
                    }
                })
                .catch(error => {
                    console.error('Error importing CSV:', error);
                    if (progressDiv) progressDiv.style.display = 'none';
                    if (importBtn2) importBtn2.disabled = false;
                    showNotification('Error importing CSV file', 'error');
                });
        });
    }
    
    // Cancel
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function() {
            if (fileInput) fileInput.value = '';
            selectedFile = null;
            if (previewDiv) previewDiv.style.display = 'none';
            if (progressDiv) progressDiv.style.display = 'none';
            if (resultsDiv) resultsDiv.style.display = 'none';
        });
    }
}

// AI Commands Functions
function setupAICommands() {
    const commandInput = document.getElementById('ai-command-input');
    const submitBtn = document.getElementById('ai-command-submit-btn');
    const voiceBtn = document.getElementById('ai-command-voice-btn');
    const historyDiv = document.getElementById('ai-command-history');
    const parsingDiv = document.getElementById('ai-command-parsing');
    const parsingResultDiv = document.getElementById('ai-command-parsing-result');
    const voiceFeedbackDiv = document.getElementById('ai-voice-feedback');
    const voiceStatusDiv = document.getElementById('ai-voice-status');
    const examplesList = document.getElementById('command-examples-list');
    
    let commandHistory = JSON.parse(localStorage.getItem('ai-command-history') || '[]');
    let recognition = null;
    
    // Load command examples
    function loadCommandExamples() {
        fetch('/api/ai/command-examples')
            .then(response => response.json())
            .then(data => {
                if (data.success && data.examples) {
                    let html = '';
                    Object.keys(data.examples).forEach(category => {
                        html += `<div style="margin-bottom: 15px;"><strong>${category.charAt(0).toUpperCase() + category.slice(1)}:</strong>`;
                        data.examples[category].forEach(example => {
                            html += `<div style="margin: 5px 0; padding: 5px; background-color: rgba(0, 255, 0, 0.1); border-radius: 4px; cursor: pointer;" class="command-example" data-command="${example.text}">${example.text}</div>`;
                        });
                        html += '</div>';
                    });
                    if (examplesList) examplesList.innerHTML = html;
                    
                    // Add click handlers to examples
                    document.querySelectorAll('.command-example').forEach(el => {
                        el.addEventListener('click', function() {
                            const cmd = this.getAttribute('data-command');
                            if (commandInput) {
                                commandInput.value = cmd;
                                commandInput.focus();
                            }
                        });
                    });
                }
            })
            .catch(error => {
                console.error('Error loading command examples:', error);
            });
    }
    
    // Render command history
    function renderHistory() {
        if (!historyDiv) return;
        
        if (commandHistory.length === 0) {
            historyDiv.innerHTML = '<div style="color: #888; font-style: italic;">No commands yet. Try entering a command above.</div>';
            return;
        }
        
        let html = '';
        commandHistory.slice().reverse().forEach((item, index) => {
            const date = new Date(item.timestamp);
            html += `<div style="margin-bottom: 15px; padding: 10px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <strong>Command:</strong>
                    <span style="color: #888; font-size: 12px;">${date.toLocaleTimeString()}</span>
                </div>
                <div style="margin-bottom: 5px; color: var(--primary-color);">${item.command}</div>
                <div style="margin-bottom: 5px;"><strong>Intent:</strong> ${item.parsed?.intent || 'unknown'}</div>
                ${item.parsed?.confidence ? `<div style="margin-bottom: 5px;"><strong>Confidence:</strong> ${(item.parsed.confidence * 100).toFixed(0)}%</div>` : ''}
                ${item.result ? `<div style="color: ${item.result.success ? '#00ff00' : '#ff0000'};">
                    ${item.result.success ? '✓ Success' : '✗ Error: ' + (item.result.error || 'Unknown error')}
                </div>` : ''}
            </div>`;
        });
        historyDiv.innerHTML = html;
    }
    
    // Process command
    function processCommand(command) {
        if (!command || !command.trim()) return;
        
        // Add to history
        const historyItem = {
            command: command,
            timestamp: new Date().toISOString(),
            parsed: null,
            result: null
        };
        commandHistory.push(historyItem);
        if (commandHistory.length > 50) {
            commandHistory = commandHistory.slice(-50); // Keep last 50
        }
        localStorage.setItem('ai-command-history', JSON.stringify(commandHistory));
        renderHistory();
        
        // Show parsing div
        if (parsingDiv) parsingDiv.style.display = 'block';
        if (parsingResultDiv) parsingResultDiv.innerHTML = 'Parsing command...';
        
        // Send to API
        fetch('/api/ai/command', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ command: command })
        })
            .then(response => response.json())
            .then(data => {
                // Update history item
                historyItem.parsed = data.parsed || {};
                historyItem.result = data;
                
                // Update localStorage
                const index = commandHistory.findIndex(item => item.timestamp === historyItem.timestamp);
                if (index !== -1) {
                    commandHistory[index] = historyItem;
                    localStorage.setItem('ai-command-history', JSON.stringify(commandHistory));
                }
                
                // Show parsing result
                if (parsingResultDiv) {
                    let html = `<div style="margin-bottom: 10px;"><strong>Intent:</strong> ${data.parsed?.intent || 'unknown'}</div>`;
                    if (data.parsed?.confidence !== undefined) {
                        html += `<div style="margin-bottom: 10px;"><strong>Confidence:</strong> ${(data.parsed.confidence * 100).toFixed(0)}%</div>`;
                    }
                    if (data.parsed?.params) {
                        html += `<div style="margin-bottom: 10px;"><strong>Parameters:</strong><pre style="background-color: rgba(0,0,0,0.3); padding: 5px; border-radius: 4px; font-size: 12px;">${JSON.stringify(data.parsed.params, null, 2)}</pre></div>`;
                    }
                    if (data.success) {
                        html += `<div style="color: #00ff00; margin-top: 10px;">✓ Command parsed successfully</div>`;
                        // Execute command if needed
                        executeParsedCommand(data);
                    } else {
                        html += `<div style="color: #ff0000; margin-top: 10px;">✗ Error: ${data.error || 'Failed to parse command'}</div>`;
                    }
                    parsingResultDiv.innerHTML = html;
                }
                
                renderHistory();
            })
            .catch(error => {
                console.error('Error processing command:', error);
                if (parsingResultDiv) {
                    parsingResultDiv.innerHTML = `<div style="color: #ff0000;">Error: ${error.message}</div>`;
                }
                historyItem.result = { success: false, error: error.message };
                const index = commandHistory.findIndex(item => item.timestamp === historyItem.timestamp);
                if (index !== -1) {
                    commandHistory[index] = historyItem;
                    localStorage.setItem('ai-command-history', JSON.stringify(commandHistory));
                }
                renderHistory();
            });
    }
    
    // Execute parsed command
    function executeParsedCommand(data) {
        if (!data.parsed || !data.parsed.intent) return;
        
        const intent = data.parsed.intent;
        const params = data.parsed.params || {};
        
        // Map intents to actual API calls
        switch (intent) {
            case 'add_talkgroup':
                fetch('/api/radio/talkgroups', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: params.id || params.dec,
                        hex: params.hex || null,
                        alpha_tag: params.alpha_tag || null,
                        mode: params.mode || null,
                        description: params.description || null,
                        tag: params.tag || null,
                        county: params.county || null
                    })
                })
                    .then(response => response.json())
                    .then(result => {
                        if (result.success) {
                            showNotification('Talkgroup added successfully', 'success');
                            if (typeof loadTalkgroups === 'function') loadTalkgroups();
                        } else {
                            showNotification(result.error || 'Error adding talkgroup', 'error');
                        }
                    })
                    .catch(error => {
                        showNotification('Error adding talkgroup', 'error');
                    });
                break;
                
            case 'delete_talkgroup':
                const tgId = params.id || params.dec;
                if (tgId) {
                    fetch(`/api/radio/talkgroups/${tgId}`, { method: 'DELETE' })
                        .then(response => response.json())
                        .then(result => {
                            if (result.success) {
                                showNotification('Talkgroup deleted successfully', 'success');
                                if (typeof loadTalkgroups === 'function') loadTalkgroups();
                            } else {
                                showNotification(result.error || 'Error deleting talkgroup', 'error');
                            }
                        })
                        .catch(error => {
                            showNotification('Error deleting talkgroup', 'error');
                        });
                }
                break;
                
            case 'add_frequency':
                fetch('/api/radio/frequencies', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        frequency: params.frequency,
                        description: params.description || null,
                        site_id: params.site_id || null
                    })
                })
                    .then(response => response.json())
                    .then(result => {
                        if (result.success) {
                            showNotification('Frequency added successfully', 'success');
                            if (typeof loadFrequencies === 'function') loadFrequencies();
                        } else {
                            showNotification(result.error || 'Error adding frequency', 'error');
                        }
                    })
                    .catch(error => {
                        showNotification('Error adding frequency', 'error');
                    });
                break;
                
            case 'delete_frequency':
                const freqId = params.id || params.frequency;
                if (freqId) {
                    fetch(`/api/radio/frequencies/${freqId}`, { method: 'DELETE' })
                        .then(response => response.json())
                        .then(result => {
                            if (result.success) {
                                showNotification('Frequency deleted successfully', 'success');
                                if (typeof loadFrequencies === 'function') loadFrequencies();
                            } else {
                                showNotification(result.error || 'Error deleting frequency', 'error');
                            }
                        })
                        .catch(error => {
                            showNotification('Error deleting frequency', 'error');
                        });
                }
                break;
                
            case 'list_talkgroups':
                if (typeof loadTalkgroups === 'function') loadTalkgroups();
                break;
                
            case 'list_frequencies':
                if (typeof loadFrequencies === 'function') loadFrequencies();
                break;
        }
    }
    
    // Setup voice recognition
    function setupVoiceRecognition() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            if (voiceBtn) voiceBtn.style.display = 'none';
            return;
        }
        
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        
        recognition.onstart = function() {
            if (voiceFeedbackDiv) voiceFeedbackDiv.style.display = 'block';
            if (voiceStatusDiv) voiceStatusDiv.textContent = 'Listening...';
            if (voiceBtn) voiceBtn.disabled = true;
        };
        
        recognition.onresult = function(event) {
            const transcript = event.results[0][0].transcript;
            if (commandInput) commandInput.value = transcript;
            if (voiceFeedbackDiv) voiceFeedbackDiv.style.display = 'none';
            if (voiceBtn) voiceBtn.disabled = false;
            processCommand(transcript);
        };
        
        recognition.onerror = function(event) {
            console.error('Speech recognition error:', event.error);
            if (voiceStatusDiv) voiceStatusDiv.textContent = `Error: ${event.error}`;
            setTimeout(() => {
                if (voiceFeedbackDiv) voiceFeedbackDiv.style.display = 'none';
                if (voiceBtn) voiceBtn.disabled = false;
            }, 2000);
        };
        
        recognition.onend = function() {
            if (voiceFeedbackDiv) voiceFeedbackDiv.style.display = 'none';
            if (voiceBtn) voiceBtn.disabled = false;
        };
    }
    
    // Event listeners
    if (submitBtn) {
        submitBtn.addEventListener('click', function() {
            if (commandInput && commandInput.value) {
                processCommand(commandInput.value);
                commandInput.value = '';
            }
        });
    }
    
    if (commandInput) {
        commandInput.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                if (commandInput.value) {
                    processCommand(commandInput.value);
                    commandInput.value = '';
                }
            }
        });
    }
    
    if (voiceBtn) {
        voiceBtn.addEventListener('click', function() {
            if (recognition) {
                try {
                    recognition.start();
                } catch (error) {
                    console.error('Error starting voice recognition:', error);
                }
            }
        });
    }
    
    // Load examples and history on tab open
    const aiCommandsTab = document.getElementById('quick-start-ai-commands-tab');
    if (aiCommandsTab) {
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                    if (aiCommandsTab.classList.contains('active')) {
                        loadCommandExamples();
                        renderHistory();
                    }
                }
            });
        });
        observer.observe(aiCommandsTab, { attributes: true });
    }
    
    // Initialize
    setupVoiceRecognition();
    renderHistory();

    // Mobile: Add FAB button for AI commands
    if (window.UtilsModule && window.UtilsModule.isMobile && window.UtilsModule.isMobile()) {
        const fab = document.createElement('button');
        fab.className = 'ai-command-fab';
        fab.innerHTML = '🎤';
        fab.setAttribute('aria-label', 'Open AI command interface');
        fab.addEventListener('click', () => {
            // Open Quick Start modal to AI Commands tab
            if (typeof showQuickStartModal === 'function') {
                showQuickStartModal();
                setTimeout(() => {
                    const aiTab = document.querySelector('.quick-start-tab[data-tab="ai-commands"]');
                    if (aiTab) aiTab.click();
                }, 100);
            }
        });
        document.body.appendChild(fab);
    }
}

// Haptic feedback for mobile
function triggerHapticFeedback(type = 'light') {
    if ('vibrate' in navigator) {
        const patterns = {
            light: 10,
            medium: 20,
            heavy: 30
        };
        navigator.vibrate(patterns[type] || patterns.light);
    }
}

// Make functions global for onclick handlers
window.editTalkgroup = editTalkgroup;
window.deleteTalkgroup = deleteTalkgroup;
window.editFrequency = editFrequency;
window.deleteFrequency = deleteFrequency;


