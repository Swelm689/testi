// Vercel Serverless Function for checking fal.ai request status
// Proxies status requests to fal.ai to avoid CORS issues

const { requireAuth } = require('../lib/_auth');

const FAL_API_KEY = process.env.FAL_API_KEY || process.env.FAL_KEY;

function extractDetailMessage(details) {
    if (!details) return '';

    if (typeof details === 'string') {
        const text = details.trim();
        if (!text) return '';
        try {
            const parsed = JSON.parse(text);
            return extractDetailMessage(parsed);
        } catch {
            return text;
        }
    }

    if (Array.isArray(details)) {
        for (const item of details) {
            const msg = extractDetailMessage(item);
            if (msg) return msg;
        }
        return '';
    }

    if (typeof details !== 'object') return '';

    if (Array.isArray(details.detail)) {
        for (const entry of details.detail) {
            if (entry && typeof entry === 'object') {
                const msg = typeof entry.msg === 'string' && entry.msg.trim()
                    ? entry.msg.trim()
                    : (typeof entry.message === 'string' ? entry.message.trim() : '');
                if (msg) return msg;
            }
            const nested = extractDetailMessage(entry);
            if (nested) return nested;
        }
    }

    if (typeof details.msg === 'string' && details.msg.trim()) return details.msg.trim();
    if (typeof details.message === 'string' && details.message.trim()) return details.message.trim();
    if (typeof details.error === 'string' && details.error.trim()) return details.error.trim();

    if (details.details) return extractDetailMessage(details.details);
    if (details.detail) return extractDetailMessage(details.detail);

    return '';
}

function pickBestErrorMessage(parsedErr, fallbackMessage) {
    if (!parsedErr || typeof parsedErr !== 'object') return fallbackMessage;

    const primary = typeof parsedErr.error === 'string' && parsedErr.error.trim()
        ? parsedErr.error.trim()
        : (typeof parsedErr.message === 'string' && parsedErr.message.trim() ? parsedErr.message.trim() : '');

    const detail = extractDetailMessage(parsedErr.details || parsedErr.detail || null);

    if ((!primary || /unprocessable entity/i.test(primary) || /status check failed:/i.test(primary)) && detail) {
        return detail;
    }

    if (primary && detail && !primary.toLowerCase().includes(detail.toLowerCase())) {
        return `${primary}\n${detail}`;
    }

    return primary || detail || fallbackMessage;
}

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

            const fallbackMessage = `Status check failed: ${response.statusText}`;
            const bestMessage = pickBestErrorMessage(parsedErr, fallbackMessage);

            return res.status(response.status).json({
                error: bestMessage,
                details: parsedErr || errorText,
                status: response.status,
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