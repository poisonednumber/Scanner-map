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
  GEOCODING_TARGET_COUNTIES,
  GEOCODING_CITY,
  TIMEZONE,
  // --- NEW: AI Provider Env Vars ---
  AI_PROVIDER,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  OLLAMA_URL,
  OLLAMA_MODEL,
  TARGET_CITIES_LIST
} = process.env;

// --- VALIDATE AI-RELATED ENV VARS ---
if (!AI_PROVIDER) {
    console.error("FATAL: [Geocoding] AI_PROVIDER is not set in the .env file. Please specify 'ollama' or 'openai'.");
    process.exit(1);
}

if (AI_PROVIDER.toLowerCase() === 'openai') {
    if (!OPENAI_API_KEY || !OPENAI_MODEL) {
        console.error("FATAL: [Geocoding] AI_PROVIDER is 'openai', but OPENAI_API_KEY or OPENAI_MODEL is missing in the .env file.");
        process.exit(1);
    }
} else if (AI_PROVIDER.toLowerCase() === 'ollama') {
    if (!OLLAMA_URL || !OLLAMA_MODEL) {
        console.error("FATAL: [Geocoding] AI_PROVIDER is 'ollama', but OLLAMA_URL or OLLAMA_MODEL is missing in the .env file.");
        process.exit(1);
    }
} else {
    console.error(`FATAL: [Geocoding] Invalid AI_PROVIDER specified in .env file: '${AI_PROVIDER}'. Must be 'openai' or 'ollama'.`);
    process.exit(1);
}
// --- END VALIDATION ---

// Validate required environment variables
const requiredVars = ['GOOGLE_MAPS_API_KEY', 'GEOCODING_STATE', 'GEOCODING_COUNTRY', 'GEOCODING_CITY', 'GEOCODING_TARGET_COUNTIES'];
const missingVars = requiredVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`ERROR: Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

// Parse target counties into array
const TARGET_COUNTIES = GEOCODING_TARGET_COUNTIES.split(',').map(county => county.trim());

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

// Override logger.info to only allow specific messages
const originalInfo = logger.info.bind(logger);
const allowedPatterns = [
  // Core information only
  /^Geocoded Address: ".+" with coordinates \(.+, .+\) in .+$/
];

logger.info = function (...args) {
  const message = args.join(' ');
  const shouldLog = allowedPatterns.some((pattern) => pattern.test(message));
  if (shouldLog) {
    originalInfo(...args);
  }
};

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
const TARGET_CITIES = TARGET_CITIES_LIST ? TARGET_CITIES_LIST.split(',').map(city => city.trim()) : [];

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
1. If no valid street name, intersection, or specific place (like a mall or park name) is clearly mentioned in the transcript, respond with exactly "No address found". A sequence of numbers alone (e.g., "5-9-1-6-9") is NOT enough; a street name or named location from the transcript must accompany it.
2. DO NOT make up or hallucinate addresses or street names that aren't clearly mentioned in the transcript.
3. DO NOT include ANY notes, comments, explanations, or parentheticals in your response.
4. Respond with ONLY the address in one line, nothing else.
5. The town "${GEOCODING_CITY}" should ONLY be used to COMPLETE a partially extracted address (e.g., if "123 Main Street" is found, you can append ", ${GEOCODING_CITY}, ${GEOCODING_STATE}"). DO NOT use "${GEOCODING_CITY}" if no other address components are found.

Be extremely strict - only extract if there are actual street names or specific, named locations present in the text. Isolated numbers are not sufficient.
Phrases like "Copy following it" or general chatter should ALWAYS result in "No address found".
If the transcript says, for example, "units respond to 7-9-0-8 Cindy Lane", then extract "7908 Cindy Lane". However, if it only says "reference 7-9-0-8", respond with "No address found".
When in doubt, respond with "No address found" rather than guessing.

Valid examples (assuming ${town} is the target and the street/place is mentioned in the transcript):
- "123 Main Street"
- "Main Street and Park Avenue" (intersection)
- "300 block of Maple Drive"
- "Fire reported at the Town Center Mall"
- "Elm Street" (if street name is clearly mentioned as a location for an incident)

Invalid examples (respond "No address found"):
- "Copy that"
- "Unit 5 responding"
- "Can you repeat that?"
- "We're on our way"
- "Copy following it"
- "10-4 received"
- "Just the city name like '${GEOCODING_CITY}'"
- "5916" (if no street name follows in the transcript)

Format full addresses as: "123 Main St, Town, ${GEOCODING_STATE}".
Format blocks as: "100 block of Main St, Town, ${GEOCODING_STATE}" into "100 Main St, Town, ${GEOCODING_STATE}".
Format intersections as: "Main St & Oak Ave, Town, ${GEOCODING_STATE}".

From ${town}:
"${transcript}"

Respond with ONLY the address in one line, no commentary or explanation. If no address, respond exactly: No address found.`;

    // Add AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
        logger.warn(`AI request timed out after 30 seconds for address extraction.`);
        controller.abort();
    }, 30000);

    let extractedAddress = '';

    if (AI_PROVIDER.toLowerCase() === 'openai') {
        if (!OPENAI_API_KEY) {
            logger.error("[Geocoding] FATAL: AI_PROVIDER is set to openai, but OPENAI_API_KEY is not configured!");
            return null;
        }
        logger.info(`[Geocoding] Extracting address with OpenAI model: ${OPENAI_MODEL}`);

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: OPENAI_MODEL,
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.1,
                max_tokens: 50
            }),
            signal: controller.signal
        });

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`OpenAI API error! status: ${response.status}. Body: ${errorBody}`);
        }
        const result = await response.json();
        if (result.choices && result.choices.length > 0 && result.choices[0].message) {
            extractedAddress = result.choices[0].message.content.trim();
        }

    } else { // Default to Ollama
        logger.info(`[Geocoding] Extracting address with Ollama model: ${OLLAMA_MODEL}`);

        const response = await fetch(`${OLLAMA_URL}/api/generate`, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({
            model: OLLAMA_MODEL,
            prompt,
            stream: false
          }),
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error(`Ollama API error! status: ${response.status}`);
        }
        
        const result = await response.json();
        extractedAddress = result.response.trim();
    }

    clearTimeout(timeoutId); // Clear the timeout if fetch completes

    // --- ADDED: Remove <think> block --- 
    const thinkBlockRegex = /<think>[\s\S]*?<\/think>\s*/; // Corrected escaping
    extractedAddress = extractedAddress.replace(thinkBlockRegex, '').trim();
    // --- END ADDED ---

    logger.info(`LLM Extracted Address: \"${extractedAddress}\"`);

    if (extractedAddress === "No address found" || extractedAddress === "No address found.") {
      return null;
    }

    // --- ADDED: Check for overly generic LLM response ---
    const trimmedLlmOutput = extractedAddress.trim();
    const genericCityStatePattern = new RegExp(`^${escapeRegExp(GEOCODING_CITY)},\s*${escapeRegExp(GEOCODING_STATE)}$`, 'i');
    const justCityPattern = new RegExp(`^${escapeRegExp(GEOCODING_CITY)}$`, 'i');

    if (genericCityStatePattern.test(trimmedLlmOutput) || justCityPattern.test(trimmedLlmOutput)) {
      logger.info(`LLM returned a generic city/state or just city: "${trimmedLlmOutput}". Treating as no address found.`);
      return null;
    }
    // --- END ADDED ---

    return extractedAddress;
  } catch (error) {
    // Check specifically for AbortError (timeout)
    if (error.name === 'AbortError') {
         logger.error(`AI request timed out during address extraction: ${error.message}`);
         return null; // Return null on timeout
    }
    logger.error(`Error extracting address with LLM: ${error.message}`);
    return null;
  }
}

/**
 * Geocodes an address using Google's Geocoding API.
 * @param {string} address - The validated address.
 * @returns {Promise<{ lat: number, lng: number, formatted_address: string, county: string } | null>} - Geocoded data or null.
 */
async function geocodeAddress(address) {
  // FIX: Add explicit check for null, undefined, or empty address
  if (!address || address.trim() === '') {
    logger.info('No address provided for geocoding.');
    return null;
  }
  
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
    if (TARGET_COUNTIES.some(county => formatted_address === `${county}, ${GEOCODING_STATE}, USA`) || 
        (resultTypes.includes('administrative_area_level_2') && resultTypes.length <= 3)) {
      logger.info(`Skipping county-level result: "${formatted_address}"`);
      return null;
    }

    // Verify that the result is in one of the target counties
    const countyComponent = result.address_components.find(component => 
      component.types.includes('administrative_area_level_2') && 
      TARGET_COUNTIES.includes(component.long_name)
    );

    if (countyComponent) {
      const county = countyComponent.long_name;
      logger.info(`Geocoded Address: "${formatted_address}" with coordinates (${lat}, ${lng}) in ${county}`);
      return { lat, lng, formatted_address, county };
    } else {
      const countiesList = TARGET_COUNTIES.join(' or ');
      logger.warn(`Geocoded address "${formatted_address}" is not within ${countiesList}.`);
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
  // FIX: Add explicit check for null, undefined, or empty address
  if (!address || address.trim() === '') {
    return transcript;
  }

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
  const town = TALK_GROUPS[talkGroupId] || `${TARGET_COUNTIES.join(' or ')}, ${GEOCODING_STATE}`;
  
  logger.info(`Extracting address for talk group ID: ${talkGroupId} (${town})`);
  
  let extractedAddress = await extractAddressWithLLM(transcript, town);
  
  if (!extractedAddress) {
    return null;
  }
  
  // Remove any explanatory text in parentheses or notes
  extractedAddress = extractedAddress
    .replace(/\([^)]*\)/g, '') // Remove text in parentheses
    .replace(/Note:.*$/i, '')   // Remove any "Note:" text
    .replace(/Town Not Specified/gi, GEOCODING_CITY) // Replace "Town Not Specified" with default city
    .trim();
  
  // If the address contains more than 3 commas or a newline, it likely includes explanatory text
  if (extractedAddress.split(',').length > 3 || extractedAddress.includes('\n')) {
    // Try to extract just the first line or first part of the response
    const firstLine = extractedAddress.split('\n')[0].trim();
    const firstPart = extractedAddress.split(',').slice(0, 3).join(',').trim();
    
    extractedAddress = firstLine.length < firstPart.length ? firstLine : firstPart;
    logger.warn(`Fixed malformed address response from LLM: "${extractedAddress}"`);
  }
  
  // Clean up the address format:
  // 1. Remove commas from numbers (e.g., 12,325 → 12325)
  extractedAddress = extractedAddress.replace(/(\d),(\d)/g, '$1$2');
  
  // 2. Fix other common formatting issues
  // Standardize abbreviations
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
  
  // If the address doesn't contain the state, add it
  if (!extractedAddress.includes(GEOCODING_STATE)) {
    extractedAddress += `, ${GEOCODING_STATE}`;
  }
  
  // Log the found address
  logger.info(`Extracted Address for ID ${talkGroupId}: ${extractedAddress}`);
  return extractedAddress;
}

/**
 * Processes a transcript to extract and geocode addresses.
 * @param {string} transcript - The transcript text.
 * @param {string} talkGroupId - The talk group ID associated with the transcript.
 * @returns {Promise<Array<{ lat: number, lng: number, formatted_address: string, county: string }> | null>} - Array of geocoded data or null.
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
  
  // FIX: Add explicit check for null result
  if (!extractedAddresses) {
    logger.info('No valid addresses extracted from transcript.');
    return null;
  }

  const addresses = extractedAddresses.split(';').map(addr => addr.trim());
  const geocodedResults = [];

  for (const address of addresses) {
    // FIX: Skip empty addresses
    if (!address || address.trim() === '') continue;
    
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