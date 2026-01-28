// Configuration file for API keys and settings
// Copy this file to config.js and add your actual API keys

const API_CONFIG = {
    // Uberduck API Configuration
    // Get your API key from: https://uberduck.ai/
    UBERDUCK: {
        API_KEY: 'YOUR_UBERDUCK_API_KEY_HERE', // Replace with your actual API key
        VOICE_MODEL: 'en-us-casual-k', // Friendly and approachable American male voice
        MAX_CHARS: 1500, // Character limit per request
        API_URL: 'https://api.uberduck.ai/speak'
    }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = API_CONFIG;
}

// INSTRUCTIONS:
// 1. Copy this file to config.js
// 2. Replace 'YOUR_UBERDUCK_API_KEY_HERE' with your actual Uberduck API key
// 3. Never commit config.js with real API keys (it's in .gitignore)
// 4. If you want to use a different voice, change VOICE_MODEL to another voice ID from Uberduck
