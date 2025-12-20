// config.js

/**
 * Scanner Map Configuration
 * This file contains all configurable settings for the Scanner Map application
 */

const config = {
  // Map settings
  map: {
    defaultCenter: [39.078925, -76.933018], // Default center coordinates on load
    defaultZoom: 13,
    maxZoom: 18, // Changing this may break tracking new calls!
    minZoom: 6,
    attribution: '&copy; OpenStreetMap contributors &copy; Scanner Map V3.1.0',
    timeZone: 'America/New_York', // Time zone for display
  },
   
  // Time settings
  time: {
    defaultTimeRangeHours: 12, // Default time range in hours
  },
  
  // Marker icons
  icons: {
    // Define custom marker icons
    default: {
      iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
      shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
      shadowSize: [41, 41]
    },
    pd: {
      iconUrl: 'pd.png',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    },
    fire: {
      iconUrl: 'fire.png',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    },
    house: {
      iconUrl: 'house.png',
      iconSize: [32, 32],
      iconAnchor: [16, 32],
      popupAnchor: [0, -32]
    }
  },
  
  // Permanent locations
  permanentLocations: {
    houses: [
      { lat: 39.078925, lng: -76.933018 },
      // Add more locations as needed maybe fire stations and pd stations?
      // { lat: 38.9907, lng: -87.402731 },
    ]
  },
  
  // Audio settings
  audio: {
    notificationSound: '/notification-sound.mp3',
    liveStreamUrl: 'n/a', // not used anymore.
  },
  
  // Marker classification rules
  markerClassification: {
    // Rules to determine which icon to use for each marker, looks at talkgroup names.
    // Format: { type: [string match patterns] }
    police: [
      'TXDPS Tyler 1',
      'MCPD',
      'Police',
      'Gregg SO Disp 1',
      'Gregg SO Disp 2',
      'TXDPS'
    ],
    fire: [
      'MCFR',
      'Fire'
    ],
    // Audio path based classifications, use this if talkgroup name dont contain pd/fd etc will check audio file name.
    audioPaths: {
      police: ['Gladewater_PD'],
      fire: ['Gladewater_Fire']
    }
  },
  
  // Heatmap settings
  heatmap: {
    defaultIntensity: 5,
    radius: 25,
    blur: 19,
    maxZoom: 17
  },
  
  // UI text and labels
  ui: {
    appTitle: 'Scanner Map',
    toggleModeLabels: {
      day: 'Switch to Night Mode',
      night: 'Switch to Satellite Mode',
      satellite: 'Switch to Day Mode'
    },
    liveStreamButtonText: 'Listen Live'
  },
  
  // Map styling
  mapStyles: {
    dayLayer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    satelliteBaseLayer: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    satelliteLabelsLayer: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png'
  },
  
  // Animation settings (Changing this may break tracking new calls!)
  animation: {
    zoomOutLevel: 13,
    targetZoom: 17,
    duration: 1
  },
  
  // Geocoding settings
  geocoding: {
    googleApiKey: null, // Will be set dynamically
    locationiqApiKey: null, // Will be set dynamically
    defaultArea: {
      lat: 39.078925, 
      lng: -76.933018
    },
    // Maximum results to show in dropdown
    maxResults: 5,
    // Minimum characters required to trigger search
    minQueryLength: 3,
    // Preferred geocoding provider (google, locationiq, or auto)
    preferredProvider: 'auto', // auto will use available providers
    // LocationIQ specific settings
    locationiq: {
      countrycodes: 'us', // Limit to US results (comma-separated for multiple countries)
      limit: 5, // Reduced maximum results for more focused results
      normalizecity: 1, // Normalize city names
      // Location bias settings (similar to Google's autocomplete bias)
      bias: {
        enabled: true, // Enable location bias
        lat: 39.078925, // Default latitude (same as defaultArea)
        lon: -76.933018, // Default longitude (same as defaultArea)
        bounded: 1, // Restrict results to a bounding box around the bias point (1 = true, 0 = false)
        radius: 25 // Reduced search radius in kilometers around the bias point for more local results
      },
      // Additional parameters for better geographical restriction
      tag: 'place:city,place:town,place:village,place:suburb,place:neighbourhood', // Restrict to populated places and neighborhoods
      importancesort: 1, // Sort by importance
      accept_language: 'en' // Prefer English results
    }
  }
};

// Function to fetch geocoding configuration from server
async function fetchGeocodingConfig() {
  try {
    const response = await fetch('/api/config/geocoding');
    const data = await response.json();
    
    if (data.google.available) {
      config.geocoding.googleApiKey = data.google.apiKey;
      console.log('[Config] Google Places API available');
    }
    
    if (data.locationiq.available) {
      config.geocoding.locationiqApiKey = data.locationiq.apiKey;
      console.log('[Config] LocationIQ API available');
    }
    
    // Log available providers
    const availableProviders = [];
    if (data.google.available) availableProviders.push('Google');
    if (data.locationiq.available) availableProviders.push('LocationIQ');
    
    console.log(`[Config] Available geocoding providers: ${availableProviders.join(', ')}`);
    
  } catch (error) {
    console.error('Error fetching geocoding configuration:', error);
  }
}

// Fetch the geocoding configuration when the config is loaded
fetchGeocodingConfig();

// Export the configuration
window.appConfig = config;