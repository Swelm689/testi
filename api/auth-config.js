const { getSupabaseConfig, setCors } = require('../lib/_supabase');

module.exports = async function handler(req, res) {
  setCors(req, res, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const cfg = getSupabaseConfig();
  return res.status(200).json({
    configured: !!(cfg.url && cfg.anonKey),
    url: cfg.url || null,
    anonKey: cfg.anonKey || null,
  });
};
