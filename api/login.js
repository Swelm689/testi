const { isRequestAuthorized } = require('../lib/_auth');

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

  const expected = process.env.APP_ACCESS_TOKEN;
  if (!expected) {
    return res.status(500).json({ error: 'APP_ACCESS_TOKEN environment variable not configured' });
  }

  const token = req.body && req.body.token;
  if (!token) {
    return res.status(400).json({ error: 'token is required' });
  }

  if (token !== expected) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  if (!isRequestAuthorized({ headers: { cookie: `app_access=${encodeURIComponent(token)}` } })) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  const isProd = (process.env.VERCEL_ENV || '').toLowerCase() === 'production';
  const maxAge = 30 * 24 * 60 * 60; // 30 days
  res.setHeader(
    'Set-Cookie',
    `app_access=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProd ? '; Secure' : ''}`
  );

  return res.status(200).json({ ok: true });
};
