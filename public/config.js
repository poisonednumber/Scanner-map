// config.js

/**
 * Scanner Map Configuration
 * This file contains all configurable settings for the Scanner Map application
 */

const config = {
  // Map settings
  map: {
    defaultCenter: [32.078925, -94.933018], // Default center coordinates on load
    defaultZoom: 13,
    maxZoom: 18, // Changing this may break tracking new calls!
    minZoom: 6,
    attribution: '&copy; OpenStreetMap contributors &copy; Scanner Map V1.5',
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
      { lat: 32.078925, lng: -94.933018 },
      // Add more locations as needed maybe fire stations and pd stations?
      
    ]
  },
  
  // Audio settings
  audio: {
    notificationSound: '/notification-sound.mp3',
    liveStreamUrl: 'https://website,com', // your rdio scanner site if perferred.
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
  
  // Animation settings (Changing this mmy break tracking new calls!)
  animation: {
    zoomOutLevel: 13,
    targetZoom: 17,
    duration: 1
  }
};

// Export the configuration
window.appConfig = config;
