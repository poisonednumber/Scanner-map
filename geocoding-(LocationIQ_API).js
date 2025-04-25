// geocoding.js - Address extraction and geocoding module (using LocationIQ)

require('dotenv').config();
const fetch = require('node-fetch');
const winston = require('winston');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');

// Environment variables - strict loading from .env only
const {
  LOCATIONIQ_API_KEY, 
  GEOCODING_STATE,
  GEOCODING_COUNTRY,
  GEOCODING_TARGET_COUNTIES,
  GEOCODING_CITY, 
  TIMEZONE,
  OLLAMA_URL,
  OLLAMA_MODEL,
  TARGET_CITIES_LIST 
} = process.env;

// Validate required environment variables
// Updated to check for LOCATIONIQ_API_KEY
const requiredVars = ['LOCATIONIQ_API_KEY', 'GEOCODING_STATE', 'GEOCODING_COUNTRY', 'GEOCODING_CITY', 'GEOCODING_TARGET_COUNTIES'];
const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`ERROR: Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

// Parse target counties into array
const TARGET_COUNTIES = GEOCODING_TARGET_COUNTIES.split(',').map(county => county.trim());
const COUNTRY_CODES = GEOCODING_COUNTRY; // LocationIQ uses country codes

// Logger setup (remains the same)
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: () => moment().tz(TIMEZONE).format('MM/DD/YYYY HH:mm:ss.SSS')
    }),
    winston.format.printf(({ timestamp, level, message }) => {
      if (message.includes('Talk Group') ||
          message.includes('Incoming Request')) {
        return `${timestamp} \x1b[33m[${level.toUpperCase()}] ${message}\x1b[0m`;
      }
      if (message.includes('Extracted Address') ||
          message.includes('Geocoded Address')) {
        return `${timestamp} \x1b[32m[${level.toUpperCase()}] ${message}\x1b[0m`;
      }
      if (level === 'info') {
        return `${timestamp} \x1b[37m[${level.toUpperCase()}] ${message}\x1b[0m`;
      }
      const colors = { error: '\x1b[31m', warn: '\x1b[33m', debug: '\x1b[36m' };
      const color = colors[level] || '\x1b[37m';
      return `${timestamp} ${color}[${level.toUpperCase()}] ${message}\x1b[0m`;
    })
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console()
  ]
});

// Override logger.info (remains the same)
const originalInfo = logger.info.bind(logger);
const allowedPatterns = [
  /^Geocoded Address: ".+" with coordinates \(.+, .+\) in .+$/
];
logger.info = function (...args) {
  const message = args.join(' ');
  const shouldLog = allowedPatterns.some((pattern) => pattern.test(message));
  if (shouldLog) {
    originalInfo(...args);
  }
};

// Build TALK_GROUPS from environment variables (remains the same)
const TALK_GROUPS = {};
Object.keys(process.env).forEach(key => {
  if (key.startsWith('TALK_GROUP_')) {
    const talkGroupId = key.replace('TALK_GROUP_', '');
    TALK_GROUPS[talkGroupId] = process.env[key];
  }
});
logger.info(`Loaded ${Object.keys(TALK_GROUPS).length} talk groups from environment variables`);

// Keep the TARGET_CITIES list for reference (remains the same)
const TARGET_CITIES = TARGET_CITIES_LIST ? TARGET_CITIES_LIST.split(',').map(city => city.trim()) : [];

// Function to load talk groups from env vars (remains the same)
function loadTalkGroups(db) {
  logger.info(`Using talk groups from environment variables. Found ${Object.keys(TALK_GROUPS).length} talk groups`);
  return Promise.resolve(TALK_GROUPS);
}

/**
 * Helper Functions
 */

/**
 * Escapes special characters in a string for use in a regular expression. (remains the same)
 * @param {string} string - The string to escape.
 * @returns {string} - The escaped string.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Uses local LLM to extract and complete addresses from the full transcript. (remains the same)
 * @param {string} transcript - The full transcript text.
 * @param {string} town - The town associated with the transcript.
 * @returns {Promise<string|null>} - The extracted and completed address or null if not found.
 */
async function extractAddressWithLLM(transcript, town) {
  try {
    const countiesString = TARGET_COUNTIES.join(', ');
    const prompt = `
You are an assistant that extracts and completes addresses from first responder dispatch transcripts.
Focus on extracting a single full address, block, or intersection from the transcript provided below.
If an address is incomplete, attempt to complete it based on the given town.
Only extract addresses for ${town}.
The address could be in one of these counties: ${countiesString}.

VERY IMPORTANT INSTRUCTIONS:
1. If no valid address is found in the transcript, respond with exactly "No address found".
2. DO NOT make up or hallucinate addresses that aren't clearly mentioned in the transcript.
3. DO NOT include ANY notes, comments, explanations, or parentheticals in your response.
4. Respond with ONLY the address in one line, nothing else.
5. NEVER include phrases like "Town Not Specified" - if you don't know the town, use "${GEOCODING_CITY}" as default.

Be extremely strict - only extract if there are actual street names present in the text.
Phrases like "Copy following it" or general chatter should NEVER result in address extraction.
When you hear patterns like "7-9-0-8, Cindy Lane" extract as "7908 Cindy Lane".
When in doubt, respond with "No address found" rather than guessing.

Valid examples:
- "123 Main Street"
- "Main Street and Park Avenue" (intersection)
- "300 block of Maple Drive"
- "Fire reported at the Town Center Mall"
- "Elm Street" (if street name is clearly mentioned as a location)

Invalid examples (respond "No address found"):
- "Copy that"
- "Unit 5 responding"
- "Can you repeat that?"
- "We're on our way"
- "Copy following it"
- "10-4 received"

Format full addresses as: "123 Main St, Town, ${GEOCODING_STATE}".
Format blocks as: "100 block of Main St, Town, ${GEOCODING_STATE}" into "100 Main St, Town, ${GEOCODING_STATE}".
Format intersections as: "Main St & Oak Ave, Town, ${GEOCODING_STATE}".

From ${town}:
"${transcript}"

Respond with ONLY the address in one line, no commentary or explanation. If no address, respond exactly: No address found.`;

    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    const extractedAddress = result.response.trim();

    logger.info(`LLM Extracted Address: "${extractedAddress}"`);

    if (extractedAddress === "No address found" || extractedAddress === "No address found.") {
      return null;
    }
    return extractedAddress;
  } catch (error) {
    logger.error(`Error extracting address with LLM: ${error.message}`);
    return null;
  }
}

/**
 * Geocodes an address using LocationIQ's Geocoding API, filtering for specific results.
 * @param {string} address - The address query string.
 * @returns {Promise<{ lat: number, lng: number, formatted_address: string, county: string } | null>} - Geocoded data or null.
 */
async function geocodeAddress(address) {
  // 1. Input Validation
  if (!address || address.trim() === '') {
    logger.info('No address provided for geocoding.');
    return null;
  }

  // 2. Prepare API Request
  const endpoint = `https://us1.locationiq.com/v1/search`;
  const params = new URLSearchParams({
    q: address,
    key: LOCATIONIQ_API_KEY,
    format: 'json',
    addressdetails: '1',
    normalizeaddress: '1',
    countrycodes: COUNTRY_CODES,
    limit: '1'
  });

  try {
    // 3. Make API Call
    const response = await fetch(`${endpoint}?${params.toString()}`);
    if (!response.ok) {
      logger.error(`LocationIQ API error: ${response.status} ${response.statusText}`);
      const errorBody = await response.text();
      logger.error(`LocationIQ Error Body: ${errorBody} for query: "${address}"`);
      return null;
    }

    // 4. Parse Response
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) {
      logger.warn(`LocationIQ API returned no results for address: "${address}"`);
      return null;
    }

    const result = data[0];

    // Extract key fields
    const lat = parseFloat(result.lat);
    const lon = parseFloat(result.lon);
    const display_name = result.display_name;
    const resultType = result.type;
    const resultClass = result.class;
    const addressDetails = result.address || {};
    const county = addressDetails.county || null;

    // Basic check for essential coordinates and display name
    if (isNaN(lat) || isNaN(lon) || !display_name) {
       logger.warn(`LocationIQ response missing essential fields (lat/lon/display_name) for address: "${address}"`);
       return null;
    }

    // --- START: Final Revised Filtering Logic ---

    // 5. Specificity Filtering - Require road info unless it's a specific non-admin place/highway.
    const hasRoadInfo = !!(addressDetails.road);
    const isCityAdminType = ['city', 'town', 'village', 'municipality', 'administrative', 'county', 'state', 'postcode'].includes(resultType);

    // Is it a highway/intersection? (Specific enough)
    const isHighwayOrIntersection = (resultClass === 'highway' || resultType === 'intersection');

    // Is it classified as a 'place' BUT NOT also typed as a city/admin area? (Specific enough POI)
    const isSpecificPlace = (resultClass === 'place' && !isCityAdminType);

    // If there is NO road information AND it's NOT a specific place AND it's NOT a highway/intersection, filter it out.
    if (!hasRoadInfo && !isSpecificPlace && !isHighwayOrIntersection) {
        logger.info(`[Filter Action] Skipping result lacking road info and not a specific place/highway (Type: ${resultType}, Class: ${resultClass}): "${display_name}"`);
        return null;
    }

    // --- END: Final Revised Filtering Logic ---


    // 6. Target County Filtering
    if (!county || !TARGET_COUNTIES.includes(county)) {
      const countiesList = TARGET_COUNTIES.join(' or ');
      if (!county) {
        logger.warn(`[Filter Action] Specific address "${display_name}" OK but LocationIQ did not return county information. Cannot verify target county.`);
      } else {
        logger.warn(`[Filter Action] Specific address "${display_name}" OK but geocoded county "${county}" is not within target counties: ${countiesList}.`);
      }
      return null;
    }

    // 7. Success: Return Formatted Result
    logger.info(`Geocoded Address: "${display_name}" with coordinates (${lat}, ${lon}) in ${county}`);
    return {
        lat: lat,
        lng: lon,
        formatted_address: display_name,
        county: county
    };

  } catch (error) {
    logger.error(`Unexpected error in geocodeAddress for query "${address}": ${error.message}`, { stack: error.stack });
    return null;
  }
}


/**
 * Hyperlinks an address within the transcript text using coordinates.
 * @param {string} transcript - The transcript text.
 * @param {string} address - The address text to find and replace.
 * @param {number} lat - Latitude.
 * @param {number} lng - Longitude.
 * @returns {string} - Transcription with hyperlinked address.
 */
function hyperlinkAddress(transcript, address, lat, lng) {
  // Use a generic Google Maps URL with coordinates for the link
  if (!address || address.trim() === '' || lat === null || lng === null) {
    return transcript;
  }

  const encodedCoords = `${lat},${lng}`;
  // Link to Google Maps centered on the coordinates
  const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodedCoords}`;

  try {
      // Use a global, case-insensitive regex to replace all instances of the plain address text
      // Escape special regex characters in the address string
      const escapedAddress = escapeRegExp(address);
      const regex = new RegExp(`\\b${escapedAddress}\\b`, 'gi');
      // Replace with Markdown link using the coordinate-based URL
      return transcript.replace(regex, `[${address}](${mapUrl})`);
  } catch (e) {
      logger.error(`Error creating regex for hyperlinking address "${address}": ${e.message}`);
      return transcript; // Return original transcript if regex fails
  }
}


/**
 * Extracts potential addresses from a transcript using local LLM. (remains the same)
 * @param {string} transcript - The transcript text.
 * @param {string} talkGroupId - The talk group ID associated with the transcript.
 * @returns {Promise<string|null>} - Extracted and completed addresses or null if none are found.
 */
async function extractAddress(transcript, talkGroupId) {
  // Use loaded talk groups, or fall back to a generic area
  const town = TALK_GROUPS[talkGroupId] || `${TARGET_COUNTIES.join(' or ')}, ${GEOCODING_STATE}`;

  logger.info(`Extracting address for talk group ID: ${talkGroupId} (${town})`);

  let extractedAddress = await extractAddressWithLLM(transcript, town);

  if (!extractedAddress) {
    return null;
  }

  // Clean up potentially messy LLM responses (remains the same)
  extractedAddress = extractedAddress
    .replace(/\([^)]*\)/g, '')
    .replace(/Note:.*$/i, '')
    .replace(/Town Not Specified/gi, GEOCODING_CITY)
    .trim();

  if (extractedAddress.split(',').length > 3 || extractedAddress.includes('\n')) {
    const firstLine = extractedAddress.split('\n')[0].trim();
    const firstPart = extractedAddress.split(',').slice(0, 3).join(',').trim();
    extractedAddress = firstLine.length < firstPart.length ? firstLine : firstPart;
    logger.warn(`Fixed malformed address response from LLM: "${extractedAddress}"`);
  }

  extractedAddress = extractedAddress.replace(/(?<=\d),(?=\d)/g, '');
  extractedAddress = extractedAddress.replace(/(?<=\d)-(?=\d)/g, '');
  extractedAddress = extractedAddress
    .replace(/\bAvenue\b/gi, 'Ave')
    .replace(/\bRoad\b/gi, 'Rd')
    .replace(/\bStreet\b/gi, 'St')
    .replace(/\bDrive\b/gi, 'Dr')
    .replace(/\bBoulevard\b/gi, 'Blvd')
    .replace(/\bLane\b/gi, 'Ln')
    .replace(/\bPlace\b/gi, 'Pl')
    .replace(/\bParkway\b/gi, 'Pkwy')
    .replace(/\bHighway\b/gi, 'Hwy');

  if (!extractedAddress.includes(GEOCODING_STATE)) {
    extractedAddress += `, ${GEOCODING_STATE}`;
  }
  extractedAddress = extractedAddress.trim();

  // LLM extraction log moved inside extractAddressWithLLM
  // logger.info(`Extracted Address for ID ${talkGroupId}: ${extractedAddress}`);
  return extractedAddress;
}


/**
 * Processes a transcript to extract and geocode addresses.
 * Note: Now relies on the updated geocodeAddress and hyperlinkAddress.
 * @param {string} transcript - The transcript text.
 * @param {string} talkGroupId - The talk group ID associated with the transcript.
 * @returns {Promise<{ geocodedResult: { lat: number, lng: number, formatted_address: string, county: string }, linkedTranscript: string } | null>} - Geocoded data and updated transcript or null.
 */
async function processTranscriptAndLink(transcript, talkGroupId) {
  // Verify Ollama is running (remains the same)
  try {
    const response = await fetch(`${OLLAMA_URL}/api/version`);
    if (!response.ok) {
      logger.error('Ollama server is not responding properly');
      return null;
    }
  } catch (error) {
    logger.error(`Ollama server connection error: ${error.message}. Make sure Ollama is running at ${OLLAMA_URL}`);
    return null;
  }

  const extractedAddress = await extractAddress(transcript, talkGroupId);

  if (!extractedAddress) {
    logger.info('No valid address extracted from transcript.');
    return null; // Return null if no address extracted
  }

  // Geocode the single extracted address
  const geocodeResult = await geocodeAddress(extractedAddress);

  if (geocodeResult) {
    // Hyperlink the address in the original transcript using the geocoded coordinates
    const linkedTranscript = hyperlinkAddress(transcript, geocodeResult.formatted_address, geocodeResult.lat, geocodeResult.lng);
    return { geocodedResult: geocodeResult, linkedTranscript: linkedTranscript };
  } else {
    logger.warn(`Failed to geocode extracted address: "${extractedAddress}"`);
    return null; // Return null if geocoding failed
  }
}


module.exports = {
  extractAddress,
  geocodeAddress,
  hyperlinkAddress, // Note: Signature changed slightly if used directly
  processTranscriptAndLink, // Renamed for clarity, returns linked text now
  loadTalkGroups
};