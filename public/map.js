// map.js - Map and Marker Management Module

// Map instance and state
let map = null;
let markerGroups = null;
const markers = {};
const allMarkers = {};
let currentMapMode = 'day';
let dayLayer = null;
let nightLayer = null;
let satelliteLayer = null;
let toggleModeButton = null;

// Export map instance getter
function getMap() {
    return map;
}

function getMarkerGroups() {
    return markerGroups;
}

function getMarkers() {
    return markers;
}

function getAllMarkers() {
    return allMarkers;
}

function getCurrentMapMode() {
    return currentMapMode;
}

/**
 * Initialize the map
 * @param {Object} appConfig - Application configuration
 * @param {Function} isMobile - Function to check if mobile
 * @param {Function} setupEventListeners - Function to setup event listeners
 * @param {Function} loadCalls - Function to load calls
 * @param {Number} timeRangeHours - Time range in hours
 * @param {Function} addPermanentHouseMarkers - Function to add permanent markers
 */
function initMap(appConfig, isMobile, setupEventListeners, loadCalls, timeRangeHours, addPermanentHouseMarkers) {
    // Initialize the map with the configuration center and zoom level
    const isMobileDevice = isMobile();
    map = L.map('map', {
        center: appConfig.map.defaultCenter,
        zoom: appConfig.map.defaultZoom,
        maxZoom: appConfig.map.maxZoom,
        minZoom: appConfig.map.minZoom,
        zoomControl: !isMobileDevice,
        tap: true,
        // Mobile optimizations
        touchZoom: true,
        doubleClickZoom: !isMobileDevice, // Disable double-click zoom on mobile (use pinch)
        boxZoom: !isMobileDevice,
        dragging: true,
        keyboard: true,
        scrollWheelZoom: !isMobileDevice, // Disable scroll zoom on mobile (use pinch)
        tap: true,
        tapTolerance: 15
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
        if (addPermanentHouseMarkers) {
            addPermanentHouseMarkers();
        }
    });
}

/**
 * Toggle map mode (Day, Night, Satellite)
 */
function toggleMapMode() {
    if (!map || !toggleModeButton) return;
    
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

/**
 * Set the toggle mode button reference
 */
function setToggleModeButton(button) {
    toggleModeButton = button;
}

/**
 * Add permanent house markers to the map
 * @param {Object} appConfig - Application configuration
 */
function addPermanentHouseMarkers(appConfig) {
    if (!map || !appConfig || !appConfig.permanentLocations || !appConfig.permanentLocations.houses) {
        return;
    }

    // Create a separate layer group for permanent markers
    const houseMarkersGroup = L.layerGroup();

    // Add each house to the map
    appConfig.permanentLocations.houses.forEach(location => {
        // Use customIcons if available globally, otherwise create default
        const houseIcon = window.customIcons?.house || L.icon({
            iconUrl: '/icons/house.png',
            iconSize: [25, 25],
            iconAnchor: [12, 25],
            popupAnchor: [0, -25]
        });
        
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

/**
 * Clear all markers from the map
 */
function clearAllMarkers() {
    if (markerGroups) {
        markerGroups.clearLayers();
    }
    Object.keys(markers).forEach(key => delete markers[key]);
    Object.keys(allMarkers).forEach(key => delete allMarkers[key]);
}

/**
 * Remove a specific marker
 * @param {String} callId - Call ID
 */
function removeMarker(callId) {
    if (markers[callId] && markerGroups) {
        markerGroups.removeLayer(markers[callId]);
        delete markers[callId];
    }
    if (allMarkers[callId]) {
        delete allMarkers[callId];
    }
}

/**
 * Get marker by call ID
 * @param {String} callId - Call ID
 * @returns {L.Marker|null} - Marker instance or null
 */
function getMarker(callId) {
    return markers[callId] || null;
}

/**
 * Check if marker exists
 * @param {String} callId - Call ID
 * @returns {Boolean} - True if marker exists
 */
function hasMarker(callId) {
    return !!markers[callId];
}

/**
 * Store marker data (called from addMarker in app.js)
 * @param {String} callId - Call ID
 * @param {L.Marker} marker - Marker instance
 * @param {Object} callData - Call data
 */
function storeMarker(callId, marker, callData) {
    markers[callId] = marker;
    allMarkers[callId] = {
        marker: marker,
        transcription: (callData.transcription || '').toLowerCase(),
        category: callData.category ? callData.category.toUpperCase() : 'OTHER',
        timestamp: callData.timestamp,
        visible: true
    };
}

// Export all functions and getters
if (typeof window !== 'undefined') {
    window.MapModule = {
        initMap,
        toggleMapMode,
        setToggleModeButton,
        addPermanentHouseMarkers,
        clearAllMarkers,
        removeMarker,
        getMarker,
        hasMarker,
        storeMarker,
        getMap,
        getMarkerGroups,
        getMarkers,
        getAllMarkers,
        getCurrentMapMode,
        cleanupOldMarkers
    };
}

