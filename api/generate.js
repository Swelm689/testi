// Vercel Serverless Function for Image Generation using fal.ai
// Handles both text-to-image and image-to-image modes

const { requireAuth } = require('../lib/_auth');

const FAL_API_KEY = process.env.FAL_API_KEY || process.env.FAL_KEY;

const IMAGE_MODELS = {
    'flux-pro-v1.1-ultra': {
        endpoint: 'https://queue.fal.run/fal-ai/flux-pro/v1.1-ultra',
        kind: 'text-to-image',
        allowed: ['prompt', 'seed', 'num_images', 'enable_safety_checker', 'output_format', 'safety_tolerance', 'enhance_prompt', 'image_url', 'image_prompt_strength', 'aspect_ratio', 'raw'],
    },
    'nano-banana-pro': {
        endpoint: 'https://queue.fal.run/fal-ai/nano-banana-pro',
        kind: 'text-to-image',
        allowed: ['prompt', 'num_images', 'aspect_ratio', 'output_format', 'resolution', 'limit_generations', 'enable_web_search', 'sync_mode'],
    },
    'nano-banana-pro/edit': {
        endpoint: 'https://queue.fal.run/fal-ai/nano-banana-pro/edit',
        kind: 'image-to-image',
        allowed: ['prompt', 'image_urls', 'num_images', 'aspect_ratio', 'output_format', 'resolution', 'limit_generations', 'enable_web_search', 'sync_mode'],
    },
    'nano-banana-2': {
        endpoint: 'https://queue.fal.run/fal-ai/nano-banana-2',
        kind: 'text-to-image',
        allowed: ['prompt', 'num_images', 'seed', 'aspect_ratio', 'output_format', 'safety_tolerance', 'resolution', 'limit_generations', 'enable_web_search', 'enable_google_search', 'sync_mode'],
    },
    'nano-banana-2/edit': {
        endpoint: 'https://queue.fal.run/fal-ai/nano-banana-2/edit',
        kind: 'image-to-image',
        allowed: ['prompt', 'image_urls', 'num_images', 'seed', 'aspect_ratio', 'output_format', 'safety_tolerance', 'resolution', 'limit_generations', 'enable_web_search', 'enable_google_search', 'sync_mode'],
    },
    'gpt-image-1.5': {
        endpoint: 'https://queue.fal.run/fal-ai/gpt-image-1.5',
        kind: 'text-to-image',
        allowed: ['prompt', 'image_size', 'background', 'quality', 'num_images', 'output_format', 'sync_mode'],
    },
    'gpt-image-1.5/edit': {
        endpoint: 'https://queue.fal.run/fal-ai/gpt-image-1.5/edit',
        kind: 'image-to-image',
        allowed: ['prompt', 'image_urls', 'image_size', 'background', 'quality', 'input_fidelity', 'num_images', 'output_format', 'sync_mode', 'mask_image_url'],
    },
};

function pickAllowed(obj, allowed) {
    const out = {};
    if (!obj || typeof obj !== 'object') return out;
    for (const k of allowed) {
        if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
            out[k] = obj[k];
        }
    }
    return out;
}

function parseDataUri(dataUri) {
    const s = String(dataUri || '');
    if (!s.startsWith('data:')) return null;
    const comma = s.indexOf(',');
    if (comma < 0) return null;
    const meta = s.slice(5, comma);
    const b64 = s.slice(comma + 1);
    const isB64 = /;base64/i.test(meta);
    if (!isB64) return null;
    const mimeType = (meta.split(';')[0] || 'application/octet-stream').trim();
    const buffer = Buffer.from(b64, 'base64');
    return { mimeType, buffer };
}

async function uploadToFal(fileBuffer, fileName, mimeType) {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('file', fileBuffer, {
        filename: fileName,
        contentType: mimeType,
    });

    const response = await fetch('https://fal.run/fal-ai/storage/upload', {
        method: 'POST',
        headers: {
            'Authorization': `Key ${FAL_API_KEY}`,
        },
        body: form,
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to upload file: ${response.statusText}: ${errorText}`);
    }

    const data = await response.json();
    return data.url;
}

async function normalizeImageUrls(imageUrls) {
    const list = Array.isArray(imageUrls) ? imageUrls : [];
    const out = [];
    for (let i = 0; i < list.length; i++) {
        const v = list[i];
        if (!v) continue;
        const s = String(v);
        if (s.startsWith('http://') || s.startsWith('https://')) {
            out.push(s);
            continue;
        }
        const parsed = parseDataUri(s);
        if (!parsed) {
            throw new Error('Invalid image input. Provide https URL(s) or data URI(s).');
        }
        const ext = parsed.mimeType === 'image/png' ? 'png' : (parsed.mimeType === 'image/webp' ? 'webp' : 'jpg');
        const url = await uploadToFal(parsed.buffer, `upload-${Date.now()}-${i}.${ext}`, parsed.mimeType);
        out.push(url);
    }
    return out;
}

module.exports = async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    if (!requireAuth(req, res)) {
        return;
    }

    if (!FAL_API_KEY) {
        return res.status(500).json({ error: 'FAL_KEY environment variable not configured' });
    }

    try {
        const body = req.body || {};
        const model_id = body.model_id || 'flux-pro-v1.1-ultra';
        const model = IMAGE_MODELS[model_id] || null;
        if (!model) {
            return res.status(400).json({ error: `Unknown model_id: ${model_id}` });
        }

        const { prompt } = body;

        if (!prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const rawPayload = {
            ...body,
            prompt,
        };

        const allowed = Array.isArray(model.allowed) ? model.allowed : [];
        const supportsImageUrls = allowed.includes('image_urls');

        const maxImageUrlsByModel = {
            'nano-banana-pro/edit': 14,
            'nano-banana-2/edit': 14,
            'gpt-image-1.5/edit': 4,
        };

        if (supportsImageUrls) {
            if (Array.isArray(rawPayload.image_urls)) {
                const max = maxImageUrlsByModel[model_id];
                if (typeof max === 'number' && Number.isFinite(max) && rawPayload.image_urls.length > max) {
                    rawPayload.image_urls = rawPayload.image_urls.slice(0, max);
                }
            }

            // Legacy compatibility: old UI sends image_url for mode==='image'
            if (typeof rawPayload.image_url === 'string' && rawPayload.image_url && !rawPayload.image_urls) {
                rawPayload.image_urls = [rawPayload.image_url];
            }

            // Normalize multi-image + optional mask upload
            if (Array.isArray(rawPayload.image_urls)) {
                rawPayload.image_urls = await normalizeImageUrls(rawPayload.image_urls);
            }
        }

        if (typeof rawPayload.mask_image_url === 'string' && rawPayload.mask_image_url.startsWith('data:')) {
            const parsed = parseDataUri(rawPayload.mask_image_url);
            if (!parsed) throw new Error('Invalid mask image data URI');
            const ext = parsed.mimeType === 'image/png' ? 'png' : (parsed.mimeType === 'image/webp' ? 'webp' : 'jpg');
            rawPayload.mask_image_url = await uploadToFal(parsed.buffer, `mask-${Date.now()}.${ext}`, parsed.mimeType);
        }

        const payload = pickAllowed(rawPayload, allowed);

        // Submit to fal.ai
        const endpoint = model.endpoint;

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Key ${FAL_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('FAL API Error:', errorText);
            return res.status(response.status).json({
                error: `FAL API error: ${response.statusText}`
            });
        }

        const data = await response.json();
        const requestId = data.request_id || data.requestId || data.id || null;

        const statusUrl = data.status_url || (requestId ? `${endpoint}/requests/${requestId}/status` : null);
        const responseUrl = data.response_url || (requestId ? `${endpoint}/requests/${requestId}` : null);

        if (!statusUrl) {
            return res.status(502).json({
                error: 'FAL API returned no status_url',
                details: data,
            });
        }

        // Return request info for polling
        return res.status(200).json({
            request_id: requestId,
            status_url: statusUrl,
            response_url: responseUrl,
        });

    } catch (error) {
        console.error('Generate error:', error);
        return res.status(500).json({
            error: error.message || 'Internal server error'
        });
    }
}
