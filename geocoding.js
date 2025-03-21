// geocoding.js

require('dotenv').config();
const fetch = require('node-fetch');
const winston = require('winston');
const moment = require('moment-timezone');
const OpenAI = require('openai');

// Logger setup
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: () => moment().tz('America/Chicago').format('MM/DD/YYYY HH:mm:ss.SSS')
    }),
    winston.format.printf(({ timestamp, level, message }) => `${timestamp} [${level.toUpperCase()}] ${message}`)
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
    new winston.transports.Console()
  ]
});

/**
 * Configuration and Constants
 */

// Load environment variables
const {
  GOOGLE_MAPS_API_KEY,
  OPENAI_API_KEY,
  GEOCODING_STATE = 'FL',
  GEOCODING_COUNTRY = 'US'
} = process.env;

if (!GOOGLE_MAPS_API_KEY) {
  logger.error('GOOGLE_MAPS_API_KEY is not set in the environment variables.');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  logger.error('OPENAI_API_KEY is not set in the environment variables.');
  process.exit(1);
}

// Initialize OpenAI API with v4 SDK
const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

// Define talk groups and their associated counties
const TALK_GROUPS = {
  // Santa Rosa County talk groups
  '5601': 'any town in Santa Rosa County FL',
  '5602': 'any town in Santa Rosa County FL',
  '5603': 'any town in Santa Rosa County FL',
  
  // Escambia County talk groups
  '5267': 'any town in Escambia County FL',
  '6789': 'any town in Escambia County FL',
  '1': 'any town in Escambia County FL',
  
  // Test System - setting this to Escambia County based on the test cases
  '5251': 'any town in Escambia County FL'
};

// Keep the TARGET_CITIES list for reference and backward compatibility
const TARGET_CITIES = [
  // Santa Rosa County cities
  "Bagdad", "Gulf Breeze", "Jay", "Milton", "Navarre",
  // Escambia County cities
  "Cantonment", "Century", "Mc David", "Molino", "Pensacola"
];

// County information for internal use
const COUNTIES = {
  'SANTA_ROSA': {
    name: 'Santa Rosa County',
    state: 'FL',
    cities: ["Bagdad", "Gulf Breeze", "Jay", "Milton", "Navarre"]
  },
  'ESCAMBIA': {
    name: 'Escambia County',
    state: 'FL',
    cities: ["Cantonment", "Century", "Mc David", "Molino", "Pensacola"]
  }
};

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
 * Determines which county a talk group belongs to.
 * @param {string} talkGroupId - The talk group ID.
 * @returns {Object} - The county info object with fallback to Santa Rosa County.
 */
function getCountyFromTalkGroup(talkGroupId) {
  const talkGroup = TALK_GROUPS[talkGroupId];
  if (!talkGroup) {
    logger.warn(`Unknown talk group ID: ${talkGroupId}, defaulting to Santa Rosa County`);
    return COUNTIES.SANTA_ROSA;
  }
  
  if (talkGroup.includes('Santa Rosa')) {
    return COUNTIES.SANTA_ROSA;
  } else if (talkGroup.includes('Escambia')) {
    return COUNTIES.ESCAMBIA;
  }
  
  // Default to Santa Rosa County if there's ambiguity
  logger.info(`Talk group ${talkGroupId} is ambiguous, defaulting to Santa Rosa County`);
  return COUNTIES.SANTA_ROSA;
}

/**
 * Uses GPT-3.5 to extract and complete addresses from the full transcript.
 * @param {string} transcript - The full transcript text.
 * @param {string} town - The town description associated with the transcript.
 * @param {Object} county - The county object with name and state.
 * @returns {Promise<string|null>} - The extracted and completed address or null if not found.
 */
async function extractAddressWithGPT(transcript, town, county) {
  try {
    const messages = [
      {
        role: 'system',
        content: `You are an assistant that extracts and completes addresses from first responder dispatch transcripts. 
        Focus on extracting a single full address, block, or intersection. 
        If an address is incomplete, attempt to complete it based on the given town.
        Only extract addresses for ${county.name}, ${county.state}.
        If no valid address is found, return "No address found".
		"Red Bay Court" will be "Redbay Ct" "Nango Street" will be"Mango St"
		Be sure to read full transcript and determine if an address/intersection or place etc is being talked about before trying to extract an address or place or intersection.
		Keep in mind unit's often start by saying their unit number and city sometimes the city is misspelled don't get it confused for an address, ignore stuff like this "Texas Sam Tom John 4318" thats just a license plate.
        Format full addresses as: "123 Main St, Town, ${county.state}".
        Format blocks as: "100 block of Main St, Town, ${county.state}".
        Format intersections as: "Main St & Oak Ave, Town, ${county.state}".`
      },
      {
        role: 'user',
        content: `From ${town}:\n"${transcript}"\n\nExtracted Address:`
      }
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: messages,
      max_tokens: 50,
      temperature: 0,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0
    });

    const extractedAddress = response.choices[0].message.content.trim();
    logger.info(`GPT-3.5 Extracted Address: "${extractedAddress}"`);
    return extractedAddress === "No address found" ? null : extractedAddress;
  } catch (error) {
    if (error instanceof OpenAI.APIError) {
      logger.error(`OpenAI API Error extracting address: ${error.message}`);
      logger.error(`Status: ${error.status}, Code: ${error.code}, Type: ${error.type}`);
    } else {
      logger.error(`Error extracting address with GPT-3.5: ${error.message}`);
    }
    return null;
  }
}

/**
 * Geocodes an address using Google's Geocoding API.
 * @param {string} address - The validated address.
 * @returns {Promise<{ lat: number, lng: number, formatted_address: string } | null>} - Geocoded data or null.
 */
async function geocodeAddress(address) {
  // Check if address contains Pensacola or other Escambia cities
  const escambiaCities = ["Pensacola", "Cantonment", "Century", "Mc David", "Molino"];
  const escambiaMatch = escambiaCities.some(city => address.includes(city));
  
  // Get the county from the address or infer from city name
  const countyMatch = address.match(/(Santa Rosa|Escambia)\s+County/i);
  let countyObj = null;
  
  if (countyMatch) {
    // Explicit county mentioned in address
    if (countyMatch[1].toLowerCase() === 'escambia') {
      countyObj = COUNTIES.ESCAMBIA;
    } else {
      countyObj = COUNTIES.SANTA_ROSA;
    }
  } else if (escambiaMatch) {
    // City in Escambia County
    countyObj = COUNTIES.ESCAMBIA;
  } else {
    // Default to Santa Rosa County if no specific indicator
    countyObj = COUNTIES.SANTA_ROSA;
  }
  
  logger.info(`Geocoding address "${address}" in ${countyObj.name}`);
  
  const endpoint = `https://maps.googleapis.com/maps/api/geocode/json`;
  
  const params = new URLSearchParams({
    address: address,
    key: GOOGLE_MAPS_API_KEY,
    components: `country:${GEOCODING_COUNTRY}|administrative_area:${countyObj.state}`
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

    // Skip only generic city-level results while keeping useful partial matches
    if (resultTypes.includes('locality') && resultTypes.length <= 3 && !formatted_address.includes('Caravan')) {
      logger.info(`Skipping city-level result: "${formatted_address}"`);
      return null;
    }

    // Check both Santa Rosa and Escambia counties
    const countyComponent = result.address_components.find(component => 
      component.types.includes('administrative_area_level_2') && 
      (component.long_name === COUNTIES.SANTA_ROSA.name || 
       component.long_name === COUNTIES.ESCAMBIA.name)
    );

    if (countyComponent) {
      logger.info(`Geocoded Address: "${formatted_address}" with coordinates (${lat}, ${lng}) in ${countyComponent.long_name}`);
      return { lat, lng, formatted_address };
    } else {
      logger.warn(`Geocoded address "${formatted_address}" is not within either county.`);
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
 * Extracts potential addresses from a transcript using GPT-3.5.
 * @param {string} transcript - The transcript text.
 * @param {string} talkGroupId - The talk group ID associated with the transcript.
 * @returns {Promise<string|null>} - Extracted and completed addresses or null if none are found.
 */
async function extractAddress(transcript, talkGroupId) {
  // Look for Pensacola or other Escambia cities in the transcript
  const escambiaCities = ["Pensacola", "Cantonment", "Century", "Mc David", "Molino"];
  const escambiaMatch = escambiaCities.some(city => transcript.includes(city));
  
  let county = null;
  if (escambiaMatch) {
    county = COUNTIES.ESCAMBIA;
    logger.info(`Detected Escambia County reference in transcript`);
  } else {
    // Default logic based on talk group
    county = getCountyFromTalkGroup(talkGroupId);
  }
  
  const town = TALK_GROUPS[talkGroupId] || 'Unknown';
  if (town === 'Unknown') {
    logger.warn(`Unknown talk group ID: ${talkGroupId}, using detected or default county`);
  }
  
  logger.info(`Processing transcript for talk group ${talkGroupId} in ${county.name}, ${county.state}`);
  const extractedAddress = await extractAddressWithGPT(transcript, town, county);
  if (!extractedAddress || extractedAddress === "No address found") {
    logger.info('No address extracted by GPT-3.5.');
    return null;
  }

  // Return just the address string to match original interface
  return extractedAddress;
}

/**
 * Processes a transcript to extract and geocode addresses.
 * @param {string} transcript - The transcript text.
 * @param {string} talkGroupId - The talk group ID associated with the transcript.
 * @returns {Promise<Array<{ lat: number, lng: number, formatted_address: string }> | null>} - Array of geocoded data or null.
 */
async function processTranscript(transcript, talkGroupId) {
  const extractedAddresses = await extractAddress(transcript, talkGroupId);
  if (!extractedAddresses) {
    logger.info('No valid addresses extracted from transcript.');
    return null;
  }

  const addresses = extractedAddresses.split(';').map(addr => addr.trim());
  const geocodedResults = [];

  for (const address of addresses) {
    logger.info(`Attempting to geocode address: "${address}"`);
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
  processTranscript
};
