// Vercel Serverless Function - Uberduck TTS Proxy
// This keeps the API key secure on the server side

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

    // Handle OPTIONS preflight request
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    console.log('========================================');
    console.log('🚀 TTS API called');
    console.log('Method:', req.method);
    console.log('========================================');

    // Only allow POST requests
    if (req.method !== 'POST') {
        console.error('❌ Invalid method:', req.method);
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Get API key from environment variable
    const API_KEY = process.env.UBERDUCK_API_KEY;
    console.log('🔑 Checking API key...');
    console.log('   API_KEY exists:', !!API_KEY);
    console.log('   API_KEY length:', API_KEY ? API_KEY.length : 0);
    console.log('   API_KEY first 20 chars:', API_KEY ? API_KEY.substring(0, 20) + '...' : 'N/A');

    if (!API_KEY) {
        console.error('❌ UBERDUCK_API_KEY not configured in environment variables!');
        return res.status(500).json({ error: 'API key not configured' });
    }

    // Get text from request body
    const { text } = req.body;
    console.log('📝 Request body text length:', text ? text.length : 0);
    console.log('📝 Text preview:', text ? text.substring(0, 100) + '...' : 'N/A');

    if (!text) {
        console.error('❌ No text provided in request body');
        return res.status(400).json({ error: 'Text is required' });
    }

    // Truncate text if too long
    const maxChars = 1500;
    const truncatedText = text.length > maxChars
        ? text.substring(0, maxChars) + '...'
        : text;

    try {
        console.log('📡 Calling Uberduck API...');
        console.log('   Text length:', truncatedText.length);
        console.log('   Voice model: en-us-casual-k');
        console.log('   API endpoint: https://api.uberduck.ai/speak');

        // Call Uberduck API
        const response = await fetch('https://api.uberduck.ai/speak', {
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + Buffer.from(API_KEY + ':' + API_KEY).toString('base64'),
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                speech: truncatedText,
                voicemodel_uuid: 'en-us-casual-k'
            })
        });

        console.log('📡 Uberduck API response status:', response.status);
        console.log('📡 Uberduck API response statusText:', response.statusText);

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ ========================================');
            console.error('❌ UBERDUCK API ERROR:');
            console.error('❌ Status:', response.status);
            console.error('❌ Status text:', response.statusText);
            console.error('❌ Error response:', errorText);
            console.error('❌ ========================================');
            return res.status(response.status).json({
                error: 'Uberduck API error',
                details: errorText,
                status: response.status
            });
        }

        const data = await response.json();
        console.log('✅ ========================================');
        console.log('✅ SUCCESS! Audio URL received from Uberduck');
        console.log('✅ Audio path:', data.path);
        console.log('✅ ========================================');

        // Return the audio URL to the client
        return res.status(200).json(data);

    } catch (error) {
        console.error('❌ ========================================');
        console.error('❌ EXCEPTION in serverless function:');
        console.error('❌ Error type:', error.constructor.name);
        console.error('❌ Error message:', error.message);
        console.error('❌ Stack trace:', error.stack);
        console.error('❌ ========================================');
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message,
            type: error.constructor.name
        });
    }
}
