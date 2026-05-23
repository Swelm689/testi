// Vercel Serverless Function for Image Generation using fal.ai
// Handles both text-to-image and image-to-image modes

const { requireAuth } = require('../lib/_auth');
const { uploadBufferToFal } = require('../lib/_fal_upload');
const { generateGoogleImageFallback, getGoogleImageModelId, hasGoogleApiKey } = require('../lib/_google_fallback');

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
    'openai/gpt-image-2': {
        endpoint: 'https://queue.fal.run/openai/gpt-image-2',
        kind: 'text-to-image',
        allowed: ['prompt', 'image_size', 'quality', 'num_images', 'output_format', 'sync_mode'],
    },
    'gpt-image-1.5/edit': {
        endpoint: 'https://queue.fal.run/fal-ai/gpt-image-1.5/edit',
        kind: 'image-to-image',
        allowed: ['prompt', 'image_urls', 'image_size', 'background', 'quality', 'input_fidelity', 'num_images', 'output_format', 'sync_mode', 'mask_image_url'],
    },
    'openai/gpt-image-2/edit': {
        endpoint: 'https://queue.fal.run/openai/gpt-image-2/edit',
        kind: 'image-to-image',
        allowed: ['prompt', 'image_urls', 'image_size', 'quality', 'num_images', 'output_format', 'sync_mode', 'mask_url'],
    },
    'pixelcut/background-removal': {
        endpoint: 'https://queue.fal.run/pixelcut/background-removal',
        kind: 'image-to-image',
        allowed: ['image_url', 'output_format', 'sync_mode'],
        requiresPrompt: false,
    },
    'fal-ai/topaz/upscale/image': {
        endpoint: 'https://queue.fal.run/fal-ai/topaz/upscale/image',
        kind: 'image-to-image',
        allowed: ['model', 'upscale_factor', 'crop_to_fill', 'image_url', 'output_format', 'subject_detection', 'face_enhancement', 'face_enhancement_creativity', 'face_enhancement_strength', 'sharpen', 'denoise', 'fix_compression', 'strength', 'creativity', 'texture', 'prompt', 'autoprompt', 'detail'],
        requiresPrompt: false,
    },
    'fal-ai/sam-audio/separate': {
        endpoint: 'https://queue.fal.run/fal-ai/sam-audio/separate',
        kind: 'audio-to-audio',
        allowed: ['audio_url', 'prompt', 'predict_spans', 'reranking_candidates', 'acceleration', 'max_chunk_duration', 'chunk_overlap', 'output_format'],
    },
    'fal-ai/sam-audio/span-separate': {
        endpoint: 'https://queue.fal.run/fal-ai/sam-audio/span-separate',
        kind: 'audio-to-audio',
        allowed: ['audio_url', 'prompt', 'spans', 'reranking_candidates', 'acceleration', 'max_chunk_duration', 'chunk_overlap', 'use_sound_activity_ranking', 'trim_to_span', 'output_format'],
        requiresPrompt: false,
    },
    'fal-ai/heygen/v2/translate/precision': {
        endpoint: 'https://queue.fal.run/fal-ai/heygen/v2/translate/precision',
        kind: 'video-to-video',
        allowed: ['video_url', 'output_language', 'translate_audio_only', 'speaker_num', 'enable_dynamic_duration'],
        requiresPrompt: false,
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
    return uploadBufferToFal(fileBuffer, fileName, mimeType);
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

async function normalizeSingleImageUrl(imageUrl) {
    if (!imageUrl) return null;
    const value = String(imageUrl);
    if (value.startsWith('http://') || value.startsWith('https://')) {
        return value;
    }
    const parsed = parseDataUri(value);
    if (!parsed) {
        throw new Error('Invalid image input. Provide an https URL or data URI.');
    }
    const ext = parsed.mimeType === 'image/png' ? 'png' : (parsed.mimeType === 'image/webp' ? 'webp' : 'jpg');
    return uploadToFal(parsed.buffer, `upload-${Date.now()}.${ext}`, parsed.mimeType);
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

    if (!FAL_API_KEY && (!getGoogleImageModelId((req.body || {}).model_id || 'flux-pro-v1.1-ultra') || !hasGoogleApiKey())) {
        return res.status(500).json({ error: 'FAL_KEY environment variable not configured' });
    }

    try {
        const body = req.body || {};
        const model_id = body.model_id || 'flux-pro-v1.1-ultra';
        const model = IMAGE_MODELS[model_id] || null;
        if (!model) {
            return res.status(400).json({ error: `Unknown model_id: ${model_id}` });
        }

        const prompt = typeof body.prompt === 'string' ? body.prompt : '';
        const requiresPrompt = model.requiresPrompt !== false;

        if (requiresPrompt && !prompt) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const rawPayload = {
            ...body,
        };
        if (prompt) rawPayload.prompt = prompt;

        const allowed = Array.isArray(model.allowed) ? model.allowed : [];
        const supportsImageUrls = allowed.includes('image_urls');
        const supportsImageUrl = allowed.includes('image_url');

        const maxImageUrlsByModel = {
            'nano-banana-pro/edit': 14,
            'nano-banana-2/edit': 14,
            'gpt-image-1.5/edit': 4,
            'openai/gpt-image-2/edit': 4,
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

        if (supportsImageUrl && typeof rawPayload.image_url === 'string' && rawPayload.image_url) {
            rawPayload.image_url = await normalizeSingleImageUrl(rawPayload.image_url);
        }

        if (typeof rawPayload.mask_image_url === 'string' && rawPayload.mask_image_url.startsWith('data:')) {
            const parsed = parseDataUri(rawPayload.mask_image_url);
            if (!parsed) throw new Error('Invalid mask image data URI');
            const ext = parsed.mimeType === 'image/png' ? 'png' : (parsed.mimeType === 'image/webp' ? 'webp' : 'jpg');
            rawPayload.mask_image_url = await uploadToFal(parsed.buffer, `mask-${Date.now()}.${ext}`, parsed.mimeType);
        }
        if (typeof rawPayload.mask_url === 'string' && rawPayload.mask_url.startsWith('data:')) {
            const parsed = parseDataUri(rawPayload.mask_url);
            if (!parsed) throw new Error('Invalid mask image data URI');
            const ext = parsed.mimeType === 'image/png' ? 'png' : (parsed.mimeType === 'image/webp' ? 'webp' : 'jpg');
            rawPayload.mask_url = await uploadToFal(parsed.buffer, `mask-${Date.now()}.${ext}`, parsed.mimeType);
        }

        const payload = pickAllowed(rawPayload, allowed);

        // Submit to fal.ai
        const endpoint = model.endpoint;

        let response = null;
        if (FAL_API_KEY) {
            response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Authorization': `Key ${FAL_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
        }

        if (!response || !response.ok) {
            const errorText = response ? await response.text() : 'FAL_KEY environment variable not configured';
            console.error('FAL API Error:', errorText);
            const googleFallback = await generateGoogleImageFallback(model_id, payload).catch((fallbackError) => {
                console.error('Google image fallback error:', fallbackError);
                return { error: fallbackError.message || 'Google fallback failed' };
            });
            if (googleFallback && !googleFallback.error) {
                return res.status(200).json(googleFallback);
            }
            return res.status(response ? response.status : 500).json({
                error: googleFallback && googleFallback.error
                    ? googleFallback.error
                    : `FAL API error: ${response ? response.statusText : 'missing API key'}`
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
