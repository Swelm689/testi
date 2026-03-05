// Vercel Serverless Function for checking fal.ai request status
// Proxies status requests to fal.ai to avoid CORS issues

const { requireAuth } = require('../lib/_auth');

const FAL_API_KEY = process.env.FAL_API_KEY || process.env.FAL_KEY;

module.exports = async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!requireAuth(req, res)) {
        return;
    }

    if (!FAL_API_KEY) {
        return res.status(500).json({ error: 'FAL_KEY environment variable not configured' });
    }

    try {
        const { statusUrl } = req.query;

        if (!statusUrl) {
            return res.status(400).json({ error: 'statusUrl parameter is required' });
        }

        let parsed;
        try {
            parsed = new URL(statusUrl);
        } catch {
            return res.status(400).json({ error: 'Invalid statusUrl' });
        }

        if (parsed.protocol !== 'https:') {
            return res.status(400).json({ error: 'statusUrl must be https' });
        }

        const allowedHosts = new Set(['queue.fal.run']);
        if (!allowedHosts.has(parsed.hostname)) {
            return res.status(400).json({ error: 'statusUrl host not allowed' });
        }

        // Fetch status from fal.ai
        const response = await fetch(parsed.toString(), {
            method: 'GET',
            headers: {
                'Authorization': `Key ${FAL_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('FAL Status Error:', errorText);
            let parsedErr;
            try {
                parsedErr = JSON.parse(errorText);
            } catch {
                parsedErr = null;
            }

            return res.status(response.status).json({
                error: `Status check failed: ${response.statusText}`,
                details: parsedErr || errorText,
            });
        }

        const data = await response.json();

        // Forward the response
        return res.status(200).json(data);

    } catch (error) {
        console.error('Status check error:', error);
        return res.status(500).json({
            error: error.message || 'Internal server error'
        });
    }
}
