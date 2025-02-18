// geocoding-config.js

module.exports = {
    // List of cities that the system will process
    targetCities: ['Longview', 'Kilgore', 'Gladewater', 'White Oak'],

    // Map talk group IDs to their primary cities
    talkGroups: {
        '2612': 'Longview',
        '20086': 'Kilgore',
        '2398': 'Kilgore',
        '2624': 'Longview',
        '2626': 'Longview',
        '1': 'Gladewater',
        '2610': ['Longview', 'Kilgore', 'Gladewater', 'White Oak'], // Multiple cities
        '20084': 'Kilgore'
    },

    // Address processing rules per city
    addressRules: {
        // Longview specific rules
        'Longview': {
            streetCorrections: {
                'Gilmore': 'Gilmer',
                'fourth': 'N Fourth St',
                'Mollo Drive': 'Mahlow Dr',
                'Odin St': 'Oden St',
                'Ridgely Ave': 'Ridgelea Ave',
                'Buchanan': 'E Buchanan Ave',
                'Wheatley': 'Whaley St',
                'Tami Lund': 'Tammy Lynn',
                'Woodcrest': 'Woodcrest Ln',
                'Ruthland Drive': 'Ruthlynn Dr',
                'Chapel Street': 'Chappell St',
                'Hopkins Parkway': 'Hawkins Pkwy',
                'Cary Lane': 'Carrie Ln',
                'Crystal Drive': 'Christal Dr',
                'Huey': 'Hughey',
                'Swansea': 'Swancy St',
                'Marbley': 'S Mobberly Ave',
                'Arle Boulevard': 'E Aurel Ave'
            },

            // Streets that always include a prefix
            alwaysIncludePrefix: {
                'Young St': 'E',
                'Mobberly Ave': 'S',
                'Eastman Rd': 'N'
            },

            // Highway format rules
            highwayFormats: {
                '300': 'TX-300',
                '259': 'US-259',
                '31': 'TX-31',
                '149': 'TX-149',
                'Loop': 'Loop 281'
            },

            // Specific road formats
            roadFormats: {
                'McCann': 'McCann Rd',
                'Eastman': {
                    'Northeastern': 'N Eastman Rd',
                    'Southeastern': 'S Eastman Rd'
                }
            },

            // ZIP codes for different areas
            zipCodes: {
                'US-259': '75605'
            },

            // Patterns to ignore in address extraction
            ignoredPatterns: [
                /^Unit \d+/i,
                /[A-Z]{4}\d{4}/,  // License plate pattern
                /Texas Sam Tom John \d+/i
            ]
        },

        // Kilgore specific rules
        'Kilgore': {
            streetCorrections: {
                // Add Kilgore-specific corrections
            },
            
            specificStreets: {
                'Fritz Swanson': 'Fritz Swanson Rd',
                'Samples': 'Samples Rd'
            },

            // Add other Kilgore-specific rules
            highwayFormats: {
                '31': 'TX-31',
                '259': 'US-259'
            }
        },

        // Gladewater specific rules
        'Gladewater': {
            streetCorrections: {
                // Add Gladewater-specific corrections
            },

            highwayFormats: {
                '271': 'US-271'
            }
        },

        // White Oak specific rules
        'White Oak': {
            streetCorrections: {
                // Add White Oak-specific corrections
            }
        }
    },

    // Global rules that apply to all cities
    globalRules: {
        // Common abbreviations
        abbreviations: {
            'St': 'Street',
            'Rd': 'Road',
            'Ave': 'Avenue',
            'Blvd': 'Boulevard',
            'Ln': 'Lane',
            'Dr': 'Drive',
            'Ct': 'Court',
            'Pkwy': 'Parkway'
        },

        // Words to capitalize in addresses
        capitalizeWords: [
            'North', 'South', 'East', 'West',
            'Street', 'Road', 'Avenue', 'Boulevard',
            'Lane', 'Drive', 'Court', 'Parkway'
        ],

        // Direction abbreviations
        directions: {
            'N': 'North',
            'S': 'South',
            'E': 'East',
            'W': 'West',
            'NE': 'Northeast',
            'NW': 'Northwest',
            'SE': 'Southeast',
            'SW': 'Southwest'
        }
    },

    // System configuration
    systemConfig: {
        // Minimum confidence score for address matches (0-1)
        minConfidenceScore: 0.8,
        
        // Maximum distance in meters for address clustering
        maxAddressClusterDistance: 100,
        
        // Timeout for geocoding requests (milliseconds)
        geocodingTimeout: 5000,
        
        // Rate limiting (requests per second)
        maxRequestsPerSecond: 10,
        
        // Cache settings
        cache: {
            enabled: true,
            maxSize: 1000,
            ttl: 86400 // 24 hours in seconds
        }
    }
};
