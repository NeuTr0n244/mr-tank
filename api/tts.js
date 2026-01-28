// Vercel Serverless Function - Uberduck TTS Proxy
// This keeps the API key secure on the server side

export default async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Get API key from environment variable
    const API_KEY = process.env.UBERDUCK_API_KEY;

    if (!API_KEY) {
        console.error('UBERDUCK_API_KEY not configured');
        return res.status(500).json({ error: 'API key not configured' });
    }

    // Get text from request body
    const { text } = req.body;

    if (!text) {
        return res.status(400).json({ error: 'Text is required' });
    }

    // Truncate text if too long
    const maxChars = 1500;
    const truncatedText = text.length > maxChars
        ? text.substring(0, maxChars) + '...'
        : text;

    try {
        console.log('Calling Uberduck API...');
        console.log('Text length:', truncatedText.length);

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

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Uberduck API error:', response.status, errorText);
            return res.status(response.status).json({
                error: 'Uberduck API error',
                details: errorText
            });
        }

        const data = await response.json();
        console.log('✅ Audio URL received');

        // Return the audio URL to the client
        return res.status(200).json(data);

    } catch (error) {
        console.error('Error calling Uberduck:', error);
        return res.status(500).json({
            error: 'Internal server error',
            message: error.message
        });
    }
}
