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
  GEOCODING_STATE = 'MD',
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

// Define talk groups and their associated towns
const TALK_GROUPS = {
  '6010': 'Silver Spring or any town in Montgomery County MD',
  '4005': 'Silver Spring or any town in Montgomery County MD',
};

// Keep the TARGET_CITIES list for reference and backward compatibility
const TARGET_CITIES = ["Ashton-Sandy Spring", "Aspen Hill", "Bethesda", "Brookmont", "Burnt Mills", "Burtonsville", "Cabin John", "Chevy Chase", "Clarksburg", "Cloverly", "Colesville", "Damascus", "Darnestown", "Derwood", "Fairland", "Flower Hill", "Forest Glen", "Four Corners", "Friendship Heights Village", "Germantown", "Glenmont", "Kemp Mill", "Layhill", "Montgomery Village", "North Bethesda", "North Kensington", "North Potomac", "Olney", "Potomac", "Redland", "Silver Spring", "South Kensington", "Spencerville", "Ten Mile Creek", "Wheaton", "White Oak", "Calverton", "Hillandale"];

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
 * Uses GPT-3.5 to extract and complete addresses from the full transcript.
 * @param {string} transcript - The full transcript text.
 * @param {string} town - The town associated with the transcript.
 * @returns {Promise<string|null>} - The extracted and completed address or null if not found.
 */
async function extractAddressWithGPT(transcript, town) {
  try {
    const messages = [
      {
        role: 'system',
        content: `You are an assistant that extracts and completes addresses from first responder dispatch transcripts. 
        Focus on extracting a single full address, block, or intersection. 
        If an address is incomplete, attempt to complete it based on the given town.
        Only extract addresses for Montgomery County, MD.
        If no valid address is found, return "No address found".
		Be sure to read full transcript and determine if an address/intersection or place etc is being talked about before trying to extract an address or place or intersection.
		Keep in mind unit's often start by saying their unit number and city sometimes the city is misspelled don't get it confused for an address,ignore stuff like this "Texas Sam Tom John 4318" thats just a license plate.
        Format full addresses as: "123 Main St, Town, MD".
        Format blocks as: "100 block of Main St, Town, MD".
        Format intersections as: "Main St & Oak Ave, Town, MD".`
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

    // Add this check to filter out the specific Silver Spring city result
    if (formatted_address === "Silver Spring, MD 20910, USA") {
      logger.info(`Skipping city-level result for Silver Spring: "${formatted_address}"`);
      return null;
    }

    // **Enhanced Filtering Logic with Additional Specific Types Starts Here**

    // Skip only generic city-level results while keeping useful partial matches
    if (resultTypes.includes('locality') && resultTypes.length <= 3 && !formatted_address.includes('Caravan')) {
      logger.info(`Skipping city-level result: "${formatted_address}"`);
      return null;
    }

    // **Enhanced Filtering Logic with Additional Specific Types Ends Here**

    // Verify that the result is in Montgomery County
    const countyComponent = result.address_components.find(component => 
      component.types.includes('administrative_area_level_2') && 
      component.long_name === 'Montgomery County'
    );

    if (countyComponent) {
      logger.info(`Geocoded Address: "${formatted_address}" with coordinates (${lat}, ${lng})`);
      return { lat, lng, formatted_address };
    } else {
      logger.warn(`Geocoded address "${formatted_address}" is not within Montgomery County.`);
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
  const town = TALK_GROUPS[talkGroupId] || 'Unknown';
  if (town === 'Unknown') {
    logger.warn(`Unknown talk group ID: ${talkGroupId}`);
    return null;
  }

  const extractedAddress = await extractAddressWithGPT(transcript, town);
  if (!extractedAddress || extractedAddress === "No address found") {
    logger.info('No address extracted by GPT-3.5.');
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
  processTranscript
};
