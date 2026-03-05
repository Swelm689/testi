const { handleUpload } = require('@vercel/blob/client');
const { requireAuth } = require('../lib/_auth');

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
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

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(500).json({ error: 'BLOB_READ_WRITE_TOKEN environment variable not configured' });
  }

  try {
    const jsonBody = await readJsonBody(req);

    if (!jsonBody || typeof jsonBody !== 'object') {
      return res.status(400).json({ error: 'Invalid upload request body' });
    }

    // @vercel/blob/client sends: { type: 'blob.generate-client-token', payload: { pathname, ... } }
    // Keep backwards compatibility with older shapes that might include pathname at the top level.
    const effectivePathname =
      (jsonBody && jsonBody.payload && typeof jsonBody.payload.pathname === 'string' && jsonBody.payload.pathname) ||
      (typeof jsonBody.pathname === 'string' && jsonBody.pathname) ||
      null;

    if (!effectivePathname) {
      return res.status(400).json({
        error: 'Missing pathname in upload request body',
        receivedKeys: Object.keys(jsonBody),
        payloadKeys: jsonBody && jsonBody.payload && typeof jsonBody.payload === 'object' ? Object.keys(jsonBody.payload) : null,
      });
    }

    const response = await handleUpload({
      body: jsonBody,
      request: req,
      onBeforeGenerateToken: async (pathname /*, clientPayload */) => {
        return {
          allowedContentTypes: [
            'video/mp4',
            'video/quicktime',
            'video/webm',
            'image/png',
            'image/jpeg',
            'image/webp',
            'image/gif',
            'image/bmp',
            'audio/mpeg',
            'audio/wav',
            'audio/ogg',
            'audio/mp4',
            'audio/webm',
            'model/gltf-binary',
            'model/gltf+json',
            'model/obj',
            'model/stl',
            'application/octet-stream',
          ],
          tokenPayload: JSON.stringify({ pathname }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log('Blob upload completed:', { url: blob.url, pathname: blob.pathname, tokenPayload });
      },
    });

    return res.status(200).json(response);
  } catch (e) {
    console.error('Blob upload error:', e);
    return res.status(400).json({
      error: e && e.message ? e.message : 'Blob upload error',
      name: e && e.name ? e.name : undefined,
    });
  }
};

module.exports.config = {
  api: {
    bodyParser: false,
  },
};
