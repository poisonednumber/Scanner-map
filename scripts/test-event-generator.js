// test-event-generator.js
// Generates random test radio call events for testing Scanner Map

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = require('node-fetch');

// Configuration
const CONFIG = {
    // Interval range in milliseconds (3-5 minutes)
    MIN_INTERVAL: 3 * 60 * 1000,  // 3 minutes
    MAX_INTERVAL: 5 * 60 * 1000,   // 5 minutes
    
    // API endpoint
    API_URL: process.env.WEBSERVER_PORT 
        ? `http://localhost:${process.env.WEBSERVER_PORT}/api/call-upload`
        : 'http://localhost:3001/api/call-upload',
    
    // API key file paths (check both locations)
    API_KEY_PATHS: [
        path.join(__dirname, '..', 'data', 'apikeys.json'),
        path.join(__dirname, '..', 'appdata', 'scanner-map', 'data', 'apikeys.json')
    ],
    
    // Alternative: read from environment variable or simple text file
    API_KEY_ENV: 'SCANNER_MAP_API_KEY',
    API_KEY_FILE: path.join(__dirname, '..', 'test', 'tmp', 'test-api-key.txt')
};

// Realistic radio call transcriptions
const TRANSCRIPTIONS = [
    // Medical Emergencies
    "Dispatch to 123 Main Street for a medical emergency, 50 year old male complaining of chest pain, ETA 5 minutes.",
    "Ambulance 5 responding to 456 Oak Avenue for an unconscious person, caller states they found someone unresponsive.",
    "Medical call at 789 Elm Street, 30 year old female with difficulty breathing, requesting immediate response.",
    "Dispatch to 321 Pine Road for a fall victim, elderly female, possible hip injury, requesting ambulance.",
    
    // Vehicle Collisions
    "Vehicle collision reported at the intersection of First Street and Main Avenue, two vehicles involved, no injuries reported.",
    "MVC at 555 Highway 95, single vehicle off the road, driver appears to be okay, requesting tow truck.",
    "Traffic accident at 777 Broadway and Second Street, three car pileup, multiple injuries reported.",
    "Vehicle collision at 888 Market Street, rear-end collision, minor damage, no injuries.",
    
    // Fires
    "Structure fire reported at 999 Industrial Boulevard, commercial building, smoke visible from second floor.",
    "Fire alarm activation at 111 School Lane, checking for smoke or fire, units responding.",
    "Vehicle fire on Highway 101 at mile marker 15, car fully engulfed, requesting fire department.",
    "Grass fire reported near 222 Country Road, approximately 2 acres burning, requesting brush truck.",
    
    // Police Calls
    "Disturbance reported at 333 Apartment Complex, Building 4, loud music and possible fight in progress.",
    "Vehicle stop at 444 Main Street, white sedan, registration check in progress.",
    "Burglary alarm at 555 Business Park, Building A, units responding to check the premises.",
    "Suspicious activity reported at 666 Park Avenue, individual matching description of wanted person.",
    "Assault reported at 777 Bar and Grill, two individuals involved, requesting backup.",
    
    // Service Calls
    "Service call at 888 Residential Street, lockout, resident locked out of their home.",
    "Assist citizen at 999 City Hall, elderly person needs help with their vehicle.",
    "Traffic hazard at 111 Bridge Road, debris in roadway, requesting public works.",
    "Animal complaint at 222 Farm Road, loose livestock on the highway.",
    
    // General Dispatch
    "Unit 10, respond to 1234 Emergency Lane for a welfare check, caller concerned about neighbor.",
    "Dispatch to 5678 Service Road, carbon monoxide alarm activation, all units respond with caution.",
    "Medical call at 9012 Hospital Drive, patient transport needed, non-emergency.",
    "Traffic stop at 3456 Patrol Avenue, routine check, all clear."
];

// Realistic talkgroups
const TALKGROUPS = [
    { id: 1001, name: 'Fire Dispatch', system: 1 },
    { id: 1002, name: 'Fire Operations', system: 1 },
    { id: 2001, name: 'Police Dispatch', system: 1 },
    { id: 2002, name: 'Police Operations', system: 1 },
    { id: 3001, name: 'EMS Dispatch', system: 1 },
    { id: 3002, name: 'EMS Operations', system: 1 },
    { id: 4001, name: 'Sheriff Dispatch', system: 1 },
    { id: 4002, name: 'Sheriff Operations', system: 1 }
];

// Realistic addresses with coordinates (Baltimore area as example)
const ADDRESSES = [
    { address: '123 Main Street', city: 'Baltimore', state: 'MD', lat: 39.2904, lon: -76.6122 },
    { address: '456 Oak Avenue', city: 'Baltimore', state: 'MD', lat: 39.2833, lon: -76.6167 },
    { address: '789 Elm Street', city: 'Baltimore', state: 'MD', lat: 39.2975, lon: -76.6094 },
    { address: '321 Pine Road', city: 'Baltimore', state: 'MD', lat: 39.2861, lon: -76.6208 },
    { address: '555 Highway 95', city: 'Baltimore', state: 'MD', lat: 39.2933, lon: -76.6056 },
    { address: '777 Broadway', city: 'Baltimore', state: 'MD', lat: 39.3000, lon: -76.6144 },
    { address: '888 Market Street', city: 'Baltimore', state: 'MD', lat: 39.2778, lon: -76.6222 },
    { address: '999 Industrial Boulevard', city: 'Baltimore', state: 'MD', lat: 39.3042, lon: -76.6011 },
    { address: '111 School Lane', city: 'Baltimore', state: 'MD', lat: 39.2750, lon: -76.6250 },
    { address: '222 Country Road', city: 'Baltimore', state: 'MD', lat: 39.3100, lon: -76.5950 },
    { address: '333 Apartment Complex', city: 'Baltimore', state: 'MD', lat: 39.2689, lon: -76.6278 },
    { address: '444 Main Street', city: 'Baltimore', state: 'MD', lat: 39.3156, lon: -76.5889 },
    { address: '555 Business Park', city: 'Baltimore', state: 'MD', lat: 39.2628, lon: -76.6306 },
    { address: '666 Park Avenue', city: 'Baltimore', state: 'MD', lat: 39.3211, lon: -76.5828 },
    { address: '777 Bar and Grill', city: 'Baltimore', state: 'MD', lat: 39.2567, lon: -76.6333 }
];

// Realistic source units
const SOURCE_UNITS = [
    'Unit 1', 'Unit 2', 'Unit 3', 'Unit 4', 'Unit 5',
    'Engine 1', 'Engine 2', 'Ladder 1', 'Ambulance 1', 'Ambulance 2',
    'Patrol 1', 'Patrol 2', 'Sheriff 1', 'Sheriff 2',
    'Dispatch', 'Control', 'Base'
];

// Realistic frequencies
const FREQUENCIES = [
    '851.5125', '852.5125', '853.5125', '854.5125',
    '154.415', '154.430', '155.160', '155.340',
    '460.500', '460.550', '460.600', '460.650'
];

// Generate a simple silence audio file (WAV format)
function generateSilenceAudio(durationSeconds = 3) {
    const sampleRate = 8000;
    const numSamples = sampleRate * durationSeconds;
    const buffer = Buffer.alloc(44 + numSamples * 2); // WAV header + PCM data
    
    // WAV header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(36 + numSamples * 2, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // fmt chunk size
    buffer.writeUInt16LE(1, 20);  // audio format (PCM)
    buffer.writeUInt16LE(1, 22);  // num channels
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
    buffer.writeUInt16LE(2, 32);  // block align
    buffer.writeUInt16LE(16, 34); // bits per sample
    buffer.write('data', 36);
    buffer.writeUInt32LE(numSamples * 2, 40);
    
    // PCM data (silence = zeros, already set by Buffer.alloc)
    
    return buffer;
}

// Read API key - try multiple sources
function readApiKey() {
    // 1. Try environment variable first (easiest for automation)
    if (process.env[CONFIG.API_KEY_ENV]) {
        return process.env[CONFIG.API_KEY_ENV].trim();
    }
    
    // 2. Try simple text file (user can create this after seeing the key in console)
    if (fs.existsSync(CONFIG.API_KEY_FILE)) {
        try {
            const key = fs.readFileSync(CONFIG.API_KEY_FILE, 'utf8').trim();
            if (key) {
                return key;
            }
        } catch (err) {
            console.error(`Error reading API key from ${CONFIG.API_KEY_FILE}:`, err.message);
        }
    }
    
    // 3. Try to extract from log files (look for "Created default API key: ...")
    const logPaths = [
        path.join(__dirname, '..', 'logs', 'combined.log'),
        path.join(__dirname, '..', 'logs', 'info.log')
    ];
    
    for (const logPath of logPaths) {
        if (fs.existsSync(logPath)) {
            try {
                const logContent = fs.readFileSync(logPath, 'utf8');
                // Look for pattern: "Created default API key: <uuid>"
                const match = logContent.match(/Created default API key:\s+([a-f0-9-]{36})/i);
                if (match && match[1]) {
                    return match[1];
                }
            } catch (err) {
                // Ignore errors reading logs
            }
        }
    }
    
    return null;
}

// Get random element from array
function randomElement(array) {
    return array[Math.floor(Math.random() * array.length)];
}

// Get random integer between min and max (inclusive)
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Generate random interval between MIN and MAX
function getRandomInterval() {
    return randomInt(CONFIG.MIN_INTERVAL, CONFIG.MAX_INTERVAL);
}

// Generate a test event
async function generateTestEvent() {
    const talkgroup = randomElement(TALKGROUPS);
    const transcription = randomElement(TRANSCRIPTIONS);
    const address = randomElement(ADDRESSES);
    const source = randomElement(SOURCE_UNITS);
    const frequency = randomElement(FREQUENCIES);
    const dateTime = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
    
    // Generate audio file
    const audioDuration = randomInt(2, 5); // 2-5 seconds
    const audioBuffer = generateSilenceAudio(audioDuration);
    
    // Create form data
    const form = new FormData();
    form.append('audio', audioBuffer, {
        filename: `test-call-${dateTime}.wav`,
        contentType: 'audio/wav'
    });
    form.append('key', readApiKey());
    form.append('system', talkgroup.system.toString());
    form.append('talkgroup', talkgroup.id.toString());
    form.append('talkgroupLabel', talkgroup.name);
    form.append('systemLabel', 'Test System');
    form.append('dateTime', dateTime.toString());
    form.append('source', source);
    form.append('frequency', frequency);
    
    try {
        console.log(`[${new Date().toLocaleTimeString()}] Sending test event: ${talkgroup.name} - ${transcription.substring(0, 50)}...`);
        
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            body: form,
            headers: form.getHeaders()
        });
        
        if (response.ok) {
            const result = await response.text();
            console.log(`[${new Date().toLocaleTimeString()}] Event sent successfully: ${result}`);
        } else {
            const errorText = await response.text();
            console.error(`[${new Date().toLocaleTimeString()}] Error sending event: ${response.status} - ${errorText}`);
        }
    } catch (error) {
        console.error(`[${new Date().toLocaleTimeString()}] Error sending event:`, error.message);
    }
}

// Main loop
async function start() {
    const apiKey = readApiKey();
    if (!apiKey) {
        console.error('ERROR: Could not find API key.');
        console.error('');
        console.error('The API key is needed to send test events. You can provide it in one of these ways:');
        console.error('');
        console.error('1. Environment variable:');
        console.error(`   set SCANNER_MAP_API_KEY=your-api-key-here`);
        console.error('');
        console.error('2. Create a text file:');
        console.error(`   Create file: ${CONFIG.API_KEY_FILE}`);
        console.error('   Put your API key (the unhashed UUID) in that file');
        console.error('');
        console.error('3. Wait for the app to start and check the console output for:');
        console.error('   "Created default API key: <uuid>"');
        console.error('   Then use that UUID as your API key');
        console.error('');
        console.error('The API key is shown in the console when the app first starts.');
        console.error('It is also logged to the log files.');
        process.exit(1);
    }
    
    console.log('========================================');
    console.log('Scanner Map Test Event Generator');
    console.log('========================================');
    console.log(`API URL: ${CONFIG.API_URL}`);
    console.log(`API Key: ${apiKey.substring(0, 10)}...`);
    console.log(`Interval: ${CONFIG.MIN_INTERVAL / 1000 / 60}-${CONFIG.MAX_INTERVAL / 1000 / 60} minutes`);
    console.log('========================================');
    console.log('Starting event generation...');
    console.log('Press Ctrl+C to stop');
    console.log('');
    
    // Generate first event immediately
    await generateTestEvent();
    
    // Schedule next event
    function scheduleNext() {
        const interval = getRandomInterval();
        const nextTime = new Date(Date.now() + interval);
        console.log(`Next event in ${Math.round(interval / 1000 / 60 * 10) / 10} minutes (at ${nextTime.toLocaleTimeString()})`);
        
        setTimeout(async () => {
            await generateTestEvent();
            scheduleNext();
        }, interval);
    }
    
    scheduleNext();
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down test event generator...');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nShutting down test event generator...');
    process.exit(0);
});

// Start the generator
start().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

