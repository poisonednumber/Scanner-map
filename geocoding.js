// geocoding.js

require('dotenv').config();
const fetch = require('node-fetch');
const winston = require('winston');
const moment = require('moment-timezone');
const OpenAI = require('openai');
const geocoding = require('./geocoding.js');
const config = require('./config/geocoding-config.js');
geocoding.loadConfiguration(config);

// Load environment variables with defaults
const {
    GOOGLE_MAPS_API_KEY,
    OPENAI_API_KEY,
    TIMEZONE = 'America/New_York',
    DEFAULT_STATE = 'NY',
    DEFAULT_COUNTRY = 'US'
} = process.env;

// Validate essential environment variables
if (!GOOGLE_MAPS_API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY is not set in environment variables');
}

if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is not set in environment variables');
}

/**
 * Logger Configuration
 */
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp({
            format: () => moment().tz(TIMEZONE).format('MM/DD/YYYY HH:mm:ss.SSS')
        }),
        winston.format.printf(({ timestamp, level, message }) => 
            `${timestamp} [${level.toUpperCase()}] ${message}`
        )
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console()
    ]
});

// Initialize OpenAI API
const openai = new OpenAI({
    apiKey: OPENAI_API_KEY,
});

/**
 * Configuration Objects
 * These should be loaded from external configuration files in production
 */

// Example configuration - Replace with your own loaded from a config file
const CONFIG = {
    targetCities: [], // Load from configuration
    talkGroups: {}, // Load from configuration
    addressRules: {
        streetCorrections: {},
        commonPrefixes: {},
        commonSuffixes: {},
        highwayFormats: {},
        intersectionFormats: {},
        ignoredPatterns: []
    }
};

/**
 * Load configuration from external source
 * @param {string} configPath - Path to configuration file
 */
function loadConfiguration(configPath) {
    try {
        // Load and parse configuration file
        // This is a placeholder - implement actual configuration loading
        const config = require(configPath);
        Object.assign(CONFIG, config);
        logger.info('Configuration loaded successfully');
    } catch (error) {
        logger.error(`Error loading configuration: ${error.message}`);
        throw error;
    }
}

/**
 * Address Extraction using GPT
 */
async function extractAddressWithGPT(transcript, town) {
    try {
        // Build system prompt from configuration
        const systemPrompt = buildSystemPrompt(town);

        const messages = [
            {
                role: 'system',
                content: systemPrompt
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
            logger.error(`OpenAI API Error: ${error.message}`);
            logger.error(`Status: ${error.status}, Code: ${error.code}, Type: ${error.type}`);
        } else {
            logger.error(`Error extracting address: ${error.message}`);
        }
        return null;
    }
}

/**
 * Build system prompt from configuration
 */
function buildSystemPrompt(town) {
    return `You are an assistant that extracts and completes addresses from first responder dispatch transcripts. 
    Focus on extracting a single full address, block, or intersection. 
    If an address is incomplete, attempt to complete it based on the given town.
    Only extract addresses for ${CONFIG.targetCities.join(', ')}, ${DEFAULT_STATE}.
    If no valid address is found, return "No address found".

    Address Formatting Rules:
    - Full addresses: "123 Main St, Town, ${DEFAULT_STATE}"
    - Blocks: "100 block of Main St, Town, ${DEFAULT_STATE}"
    - Intersections: "Main St & Oak Ave, Town, ${DEFAULT_STATE}"

    Special Rules for ${town}:
    ${generateTownSpecificRules(town)}

    Important:
    - Verify the location is being discussed
    - Ignore unit numbers and license plates
    - Complete partial addresses based on context
    - Apply standard corrections and formats`;
}

/**
 * Generate town-specific rules from configuration
 */
function generateTownSpecificRules(town) {
    const rules = [];
    const townRules = CONFIG.addressRules[town] || {};

    if (townRules.streetCorrections) {
        rules.push('Street Name Corrections:');
        Object.entries(townRules.streetCorrections)
            .forEach(([incorrect, correct]) => 
                rules.push(`- "${incorrect}" should be "${correct}"`));
    }

    if (townRules.highwayFormats) {
        rules.push('Highway Formatting:');
        Object.entries(townRules.highwayFormats)
            .forEach(([highway, format]) => 
                rules.push(`- Highway ${highway} format: ${format}`));
    }

    return rules.join('\n');
}

/**
 * Geocoding Functions
 */
async function geocodeAddress(address) {
    const endpoint = 'https://maps.googleapis.com/maps/api/geocode/json';
    
    // Extract city from address
    const cityMatch = address.match(/(?:,\s*)([^,]+)(?:,\s*${DEFAULT_STATE})/i);
    const city = cityMatch ? cityMatch[1].trim() : '';
    
    if (!CONFIG.targetCities.includes(city)) {
        logger.warn(`City "${city}" not in target cities list`);
        return null;
    }

    const params = new URLSearchParams({
        address: address,
        key: GOOGLE_MAPS_API_KEY,
        components: `country:${DEFAULT_COUNTRY}|administrative_area:${DEFAULT_STATE}|locality:${city}`
    });

    try {
        const response = await fetch(`${endpoint}?${params.toString()}`);
        if (!response.ok) {
            throw new Error(`Geocoding API error: ${response.status}`);
        }

        const data = await response.json();

        if (data.status !== 'OK' || !data.results?.[0]) {
            logger.warn(`Geocoding API status: ${data.status} for address: "${address}"`);
            return null;
        }

        const result = data.results[0];
        const { lat, lng } = result.geometry.location;
        const formatted_address = result.formatted_address;

        // Skip city-level results
        if (isCityLevelResult(formatted_address)) {
            logger.info(`Skipping city-level result: "${formatted_address}"`);
            return null;
        }

        // Validate result
        if (!isValidGeocodeResult(result)) {
            logger.info(`Invalid geocode result for "${formatted_address}"`);
            return null;
        }

        return { lat, lng, formatted_address };
    } catch (error) {
        logger.error(`Geocoding error for "${address}": ${error.message}`);
        return null;
    }
}

/**
 * Validation Functions
 */
function isCityLevelResult(address) {
    return CONFIG.targetCities.some(city => 
        address.match(new RegExp(`^${city},\\s*${DEFAULT_STATE}\\s*\\d{5},\\s*${DEFAULT_COUNTRY}$`))
    );
}

function isValidGeocodeResult(result) {
    // Check for street numbers or specific types
    const hasStreetNumber = /\d+/.test(result.formatted_address);
    const validTypes = [
        'street_address',
        'premise',
        'subpremise',
        'route',
        'intersection',
        'establishment',
        'point_of_interest',
        'park',
        'airport'
    ];

    const hasValidType = result.types.some(type => validTypes.includes(type));
    
    return hasStreetNumber || hasValidType;
}

/**
 * URL Generation
 */
function generateMapUrl(address) {
    const encodedAddress = encodeURIComponent(`${address}`);
    return `https://www.google.com/maps/search/?api=1&query=${encodedAddress}`;
}

/**
 * Process a complete transcript
 */
async function processTranscript(transcript, talkGroupId) {
    const town = CONFIG.talkGroups[talkGroupId] || 'Unknown';
    if (town === 'Unknown') {
        logger.warn(`Unknown talk group ID: ${talkGroupId}`);
        return null;
    }

    const extractedAddress = await extractAddressWithGPT(transcript, town);
    if (!extractedAddress) {
        logger.info('No valid addresses extracted from transcript');
        return null;
    }

    const geocodeResult = await geocodeAddress(extractedAddress);
    if (!geocodeResult) {
        logger.warn(`Failed to geocode address: "${extractedAddress}"`);
        return null;
    }

    return geocodeResult;
}

/**
 * Extract addresses from transcript
 */
async function extractAddress(transcript, talkGroupId) {
    return await extractAddressWithGPT(transcript, CONFIG.talkGroups[talkGroupId] || 'Unknown');
}

/**
 * Create hyperlinked version of address in text
 */
function hyperlinkAddress(transcript, address) {
    if (!address) return transcript;

    const mapUrl = generateMapUrl(address);
    const regex = new RegExp(`\\b${escapeRegExp(address)}\\b`, 'gi');
    return transcript.replace(regex, `[${address}](${mapUrl})`);
}

/**
 * Utility function to escape special characters in a string
 */
function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
    loadConfiguration,
    extractAddress,
    geocodeAddress,
    hyperlinkAddress,
    processTranscript
};
