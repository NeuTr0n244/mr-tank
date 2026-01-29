export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, voice } = req.body || {};
  const API_KEY = process.env.UBERDUCK_API_KEY;

  if (!API_KEY) return res.status(500).json({ error: 'No API key configured' });
  if (!text) return res.status(400).json({ error: 'No text provided' });

  try {
    const response = await fetch('https://api.uberduck.ai/speak', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(API_KEY + ':' + API_KEY).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        speech: text,
        voicemodel_uuid: voice || 'en-us-casual-k'
      })
    });
    const data = await response.json();
    return res.status(response.ok ? 200 : response.status).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
