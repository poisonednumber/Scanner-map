// geocoding.js - Address extraction and geocoding module

require('dotenv').config();
const fetch = require('node-fetch');
const winston = require('winston');
const moment = require('moment-timezone');
const fs = require('fs');
const path = require('path');

// Environment variables - strict loading from .env only
const {
  GOOGLE_MAPS_API_KEY,
  GEOCODING_STATE,
  GEOCODING_COUNTRY,
  GEOCODING_TARGET_COUNTY,
  GEOCODING_CITY,
  TIMEZONE,
  OLLAMA_URL,
  OLLAMA_MODEL,
  TARGET_CITIES_LIST
} = process.env;

// Validate required environment variables
const requiredVars = ['GOOGLE_MAPS_API_KEY', 'GEOCODING_STATE', 'GEOCODING_COUNTRY', 'GEOCODING_CITY', 'GEOCODING_TARGET_COUNTY'];
const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`ERROR: Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: () => moment().tz(TIMEZONE).format('MM/DD/YYYY HH:mm:ss.SSS')
    }),
    winston.format.printf(({ timestamp, level, message }) => {
      // Define patterns that should be yellow
      if (message.includes('Talk Group') || 
          message.includes('Incoming Request')) {
        // ANSI yellow color code
        return `${timestamp} \x1b[33m[${level.toUpperCase()}] ${message}\x1b[0m`;
      }
      
      // Define patterns that should be green
      if (message.includes('Extracted Address') || 
          message.includes('Geocoded Address')) {
        // ANSI green color code
        return `${timestamp} \x1b[32m[${level.toUpperCase()}] ${message}\x1b[0m`;
      }
      
      // White color for other info messages
      if (level === 'info') {
        return `${timestamp} \x1b[37m[${level.toUpperCase()}] ${message}\x1b[0m`;
      }
      
      // Default colors for other log levels
      const colors = {
        error: '\x1b[31m', // red
        warn: '\x1b[33m',  // yellow
        debug: '\x1b[36m'  // cyan
      };
      const color = colors[level] || '\x1b[37m'; // default to white
      return `${timestamp} ${color}[${level.toUpperCase()}] ${message}\x1b[0m`;
    })
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console()
  ]
});

// Build TALK_GROUPS from environment variables
const TALK_GROUPS = {};
Object.keys(process.env).forEach(key => {
  if (key.startsWith('TALK_GROUP_')) {
    const talkGroupId = key.replace('TALK_GROUP_', '');
    TALK_GROUPS[talkGroupId] = process.env[key];
  }
});

// Log the loaded talk groups
logger.info(`Loaded ${Object.keys(TALK_GROUPS).length} talk groups from environment variables`);

// Keep the TARGET_CITIES list for reference and backward compatibility
const TARGET_CITIES = TARGET_CITIES_LIST ? TARGET_CITIES_LIST.split(',').map(city => city.trim()) : 
  ["Ashton-Sandy Spring", "Aspen Hill", "Bethesda", "Brookmont", "Burnt Mills", "Burtonsville", 
   "Cabin John", "Chevy Chase", "Clarksburg", "Cloverly", "Colesville", "Damascus", "Darnestown", 
   "Derwood", "Fairland", "Flower Hill", "Forest Glen", "Four Corners", "Friendship Heights Village", 
   "Germantown", "Glenmont", "Kemp Mill", "Layhill", "Montgomery Village", "North Bethesda", 
   "North Kensington", "North Potomac", "Olney", "Potomac", "Redland", "Silver Spring", 
   "South Kensington", "Spencerville", "Ten Mile Creek", "Wheaton", "White Oak", "Calverton", "Hillandale"];

// Function to load talk groups from env vars
function loadTalkGroups(db) {
  logger.info(`Using talk groups from environment variables. Found ${Object.keys(TALK_GROUPS).length} talk groups`);
  return Promise.resolve(TALK_GROUPS);
}

/**
 * Helper Functions
 */

/**
 * Escapes special characters in a string for use in a regular expression.
 * @param {string} string - The string to escape.
 * @returns {string} - The escaped string.
 */
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Uses local LLM to extract and complete addresses from the full transcript.
 * @param {string} transcript - The full transcript text.
 * @param {string} town - The town associated with the transcript.
 * @returns {Promise<string|null>} - The extracted and completed address or null if not found.
 */
async function extractAddressWithLLM(transcript, town) {
  try {
    const prompt = `
You are an assistant that extracts and completes addresses from first responder dispatch transcripts. 
Focus on extracting a single full address, block, or intersection from the transcript provided below.
If an address is incomplete, attempt to complete it based on the given town.
Only extract addresses for ${town}.
If no valid address is found, respond with "No address found".
Be sure to read the full transcript and determine if an address/intersection or place is being talked about before extracting.
Keep in mind units often start by saying their unit number and city. Sometimes the city is misspelled - don't confuse this for an address.
Ignore things like "Texas Sam Tom John 4318" - that's just a license plate.

Format full addresses as: "123 Main St, Town, ${GEOCODING_STATE}".
Format blocks as: "100 block of Main St, Town, ${GEOCODING_STATE}" into "100 Main St, Town, ${GEOCODING_STATE}".
Format intersections as: "Main St & Oak Ave, Town, ${GEOCODING_STATE}".

From ${town}:
"${transcript}"

Respond with ONLY the address in one line, no commentary or explanation. If no address, respond exactly: No address found.

Extracted Address:`;

    // Call the Ollama API
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
    return extractedAddress === "No address found" ? null : extractedAddress;
  } catch (error) {
    logger.error(`Error extracting address with LLM: ${error.message}`);
    return null;
  }
}

/**
 * Geocodes an address using Google's Geocoding API.
 * @param {string} address - The validated address.
 * @returns {Promise<{ lat: number, lng: number, formatted_address: string } | null>} - Geocoded data or null.
 */
async function geocodeAddress(address) {
  if (!address) return null;
  
  const endpoint = `https://maps.googleapis.com/maps/api/geocode/json`;
  
  const params = new URLSearchParams({
    address: address,
    key: GOOGLE_MAPS_API_KEY,
    components: `country:${GEOCODING_COUNTRY}|administrative_area:${GEOCODING_STATE}`
  });

  try {
    const response = await fetch(`${endpoint}?${params.toString()}`);
    if (!response.ok) {
      logger.error(`Geocoding API error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      logger.warn(`Geocoding API returned status: ${data.status} for address: "${address}"`);
      return null;
    }
    
    // Find the most specific result (preferring street_address over locality)
    const preferredTypes = ['street_address', 'premise', 'subpremise', 'route', 'intersection', 'establishment', 'point_of_interest'];
    let bestResult = null;
    
    // First try to find results with preferred types
    for (const type of preferredTypes) {
      const matchingResult = data.results.find(r => r.types.includes(type));
      if (matchingResult) {
        bestResult = matchingResult;
        break;
      }
    }
    
    // If no preferred type found, use the first result
    const result = bestResult || data.results[0];
    const { lat, lng } = result.geometry.location;
    const formatted_address = result.formatted_address;
    const resultTypes = result.types;

    // Skip generic city-level results
    if (formatted_address.match(new RegExp(`^${GEOCODING_CITY}, ${GEOCODING_STATE} \\d{5}, USA$`))) {
      logger.info(`Skipping city-level result for ${GEOCODING_CITY}: "${formatted_address}"`);
      return null;
    }

    // Skip only generic city-level results while keeping useful partial matches
    if (resultTypes.includes('locality') && resultTypes.length <= 3 && !formatted_address.includes('Caravan')) {
      logger.info(`Skipping city-level result: "${formatted_address}"`);
      return null;
    }
    
    // Check for county-level results
    if (formatted_address === `${GEOCODING_TARGET_COUNTY}, ${GEOCODING_STATE}, USA` || 
        (resultTypes.includes('administrative_area_level_2') && resultTypes.length <= 3)) {
      logger.info(`Skipping county-level result: "${formatted_address}"`);
      return null;
    }

    // Verify that the result is in the target county
    const countyComponent = result.address_components.find(component => 
      component.types.includes('administrative_area_level_2') && 
      component.long_name === GEOCODING_TARGET_COUNTY
    );

    if (countyComponent) {
      logger.info(`Geocoded Address: "${formatted_address}" with coordinates (${lat}, ${lng})`);
      return { lat, lng, formatted_address };
    } else {
      logger.warn(`Geocoded address "${formatted_address}" is not within ${GEOCODING_TARGET_COUNTY}.`);
      return null;
    }
  } catch (error) {
    logger.error(`Error geocoding address "${address}": ${error.message}`);
    return null;
  }
}

/**
 * Hyperlinks an address within the transcript text.
 * @param {string} transcript - The transcript text.
 * @param {string} address - The address to hyperlink.
 * @returns {string} - Transcription with hyperlinked address.
 */
function hyperlinkAddress(transcript, address) {
  if (!address) return transcript;

  const encodedAddress = encodeURIComponent(`${address}`);
  const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
  
  // Use a global, case-insensitive regex to replace all instances
  const regex = new RegExp(`\\b${escapeRegExp(address)}\\b`, 'gi');
  return transcript.replace(regex, `[${address}](${googleMapsUrl})`);
}

/**
 * Extracts potential addresses from a transcript using local LLM.
 * @param {string} transcript - The transcript text.
 * @param {string} talkGroupId - The talk group ID associated with the transcript.
 * @returns {Promise<string|null>} - Extracted and completed addresses or null if none are found.
 */
async function extractAddress(transcript, talkGroupId) {
  // Use loaded talk groups, or fall back to a generic area
  const town = TALK_GROUPS[talkGroupId] || `${GEOCODING_TARGET_COUNTY}, ${GEOCODING_STATE}`;
  
  logger.info(`Extracting address for talk group ID: ${talkGroupId} (${town})`);
  
  const extractedAddress = await extractAddressWithLLM(transcript, town);
  if (!extractedAddress || extractedAddress === "No address found") {
    logger.info('No address extracted by LLM.');
    return null;
  }

  return extractedAddress;
}

/**
 * Processes a transcript to extract and geocode addresses.
 * @param {string} transcript - The transcript text.
 * @param {string} talkGroupId - The talk group ID associated with the transcript.
 * @returns {Promise<Array<{ lat: number, lng: number, formatted_address: string }> | null>} - Array of geocoded data or null.
 */
async function processTranscript(transcript, talkGroupId) {
  // Verify that Ollama is running before proceeding
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
  
  const extractedAddresses = await extractAddress(transcript, talkGroupId);
  if (!extractedAddresses) {
    logger.info('No valid addresses extracted from transcript.');
    return null;
  }

  const addresses = extractedAddresses.split(';').map(addr => addr.trim());
  const geocodedResults = [];

  for (const address of addresses) {
    const geocodeResult = await geocodeAddress(address);
    if (geocodeResult) {
      geocodedResults.push(geocodeResult);
    }
  }

  if (geocodedResults.length === 0) {
    logger.warn(`Failed to geocode any extracted addresses: "${extractedAddresses}"`);
    return null;
  }

  return geocodedResults;
}

module.exports = {
  extractAddress,
  geocodeAddress,
  hyperlinkAddress,
  processTranscript,
  loadTalkGroups
};