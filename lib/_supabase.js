const { createClient } = require('@supabase/supabase-js');
const { requireAuth } = require('./_auth');
const crypto = require('crypto');

const HISTORY_MEDIA_BUCKET = 'history-media';
const HISTORY_THUMB_BUCKET = 'history-thumbnails';
const DESIGN_PRESET_BUCKET = 'custom-design-presets';
const SIGNED_URL_TTL = 60 * 60 * 24 * 7;

function getSupabaseConfig() {
  return {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  };
}

function isSupabaseConfigured() {
  const cfg = getSupabaseConfig();
  return !!(cfg.url && cfg.anonKey && cfg.serviceRoleKey);
}

function createAnonClient() {
  const cfg = getSupabaseConfig();
  if (!cfg.url || !cfg.anonKey) throw new Error('Supabase anon configuration missing');
  return createClient(cfg.url, cfg.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'X-Client-Info': 'nano-banana-studio-server' } },
  });
}

function createAdminClient() {
  const cfg = getSupabaseConfig();
  if (!cfg.url || !cfg.serviceRoleKey) throw new Error('Supabase service role configuration missing');
  return createClient(cfg.url, cfg.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { 'X-Client-Info': 'nano-banana-studio-admin' } },
  });
}

function setCors(req, res, methods = 'GET, POST, DELETE, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function readJsonBody(req) {
  if (req && req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  if (req && typeof req.body === 'string') {
    try {
      return Promise.resolve(JSON.parse(req.body));
    } catch {
      return Promise.resolve({});
    }
  }
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function getBearerToken(req) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!auth) return null;
  const match = /^Bearer\s+(.+)$/i.exec(auth);
  return match ? match[1].trim() : null;
}

async function requireSupabaseUser(req, res) {
  if (!requireAuth(req, res)) return null;
  if (!isSupabaseConfigured()) {
    res.status(500).json({ error: 'Supabase environment variables are not configured' });
    return null;
  }
  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing Supabase session token' });
    return null;
  }
  const anon = createAnonClient();
  const { data, error } = await anon.auth.getUser(token);
  if (error || !data || !data.user) {
    res.status(401).json({ error: 'Invalid Supabase session token' });
    return null;
  }
  return { token, user: data.user, admin: createAdminClient() };
}

function extFromContentType(contentType, fallback = 'bin') {
  const normalized = String(contentType || '').toLowerCase().split(';')[0].trim();
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'model/gltf-binary': 'glb',
    'model/gltf+json': 'gltf',
    'model/obj': 'obj',
    'application/octet-stream': fallback,
  };
  return map[normalized] || fallback;
}

function decodeDataUrl(source) {
  const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/i.exec(String(source || ''));
  if (!match) return null;
  const contentType = match[1] || 'application/octet-stream';
  const payload = match[2] || '';
  return {
    buffer: Buffer.from(payload, 'base64'),
    contentType,
    ext: extFromContentType(contentType),
  };
}

async function fetchRemoteSource(source, fallbackExt = 'bin') {
  const response = await fetch(source);
  if (!response.ok) {
    throw new Error('Failed to fetch source media');
  }
  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'application/octet-stream';
  let ext = extFromContentType(contentType, fallbackExt);
  try {
    const url = new URL(source);
    const pathname = url.pathname || '';
    const name = pathname.split('/').pop() || '';
    const dot = name.lastIndexOf('.');
    if (dot !== -1 && dot < name.length - 1) ext = name.slice(dot + 1).toLowerCase();
  } catch {}
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
    ext,
  };
}

async function materializeSource(source, fallbackExt = 'bin') {
  if (!source || typeof source !== 'string') return null;
  if (/^data:/i.test(source)) return decodeDataUrl(source);
  if (/^https?:\/\//i.test(source)) return fetchRemoteSource(source, fallbackExt);
  return null;
}

async function uploadBuffer(admin, bucket, objectPath, buffer, contentType) {
  const { error } = await admin.storage.from(bucket).upload(objectPath, buffer, {
    upsert: true,
    contentType: contentType || 'application/octet-stream',
  });
  if (error) throw error;
  return objectPath;
}

async function uploadSource(admin, bucket, basePath, source, fallbackExt = 'bin') {
  const materialized = await materializeSource(source, fallbackExt);
  if (!materialized) return null;
  const objectPath = `${basePath}.${materialized.ext || fallbackExt}`;
  await uploadBuffer(admin, bucket, objectPath, materialized.buffer, materialized.contentType);
  return objectPath;
}

async function createSignedUrl(admin, bucket, objectPath) {
  if (!objectPath) return null;
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(objectPath, SIGNED_URL_TTL);
  if (error) throw error;
  return data && data.signedUrl ? data.signedUrl : null;
}

async function removeStorageObjects(admin, removals) {
  const grouped = new Map();
  for (const removal of removals || []) {
    if (!removal || !removal.bucket || !removal.path) continue;
    if (!grouped.has(removal.bucket)) grouped.set(removal.bucket, []);
    grouped.get(removal.bucket).push(removal.path);
  }
  for (const [bucket, paths] of grouped.entries()) {
    if (!paths.length) continue;
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) throw error;
  }
}

function safeJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function summarizeCounts(historyCount, textRows, customDesignRows) {
  const resolvedHistoryCount = typeof historyCount === 'number'
    ? historyCount
    : (Array.isArray(historyCount) ? historyCount.length : 0);
  return {
    historyCount: resolvedHistoryCount,
    presetCount: Array.isArray(textRows) ? textRows.filter((row) => row.state === 'custom').length : 0,
    customDesignPresetCount: Array.isArray(customDesignRows) ? customDesignRows.length : 0,
  };
}

async function normalizeHistoryRow(admin, row) {
  const meta = safeJson(row.meta_json, {}) || {};
  const is3d = row.type === '3d';
  const isVideo = row.type === 'video';
  const isAudio = row.type === 'audio';
  const hasLinkedMedia = !!(meta.originalUrl || meta.originalDownloadUrl || meta.previewUrl || meta.thumbnail_fallback || meta.placeholderUrl);
  const mediaUrl = row.media_path ? await createSignedUrl(admin, HISTORY_MEDIA_BUCKET, row.media_path).catch(() => null) : null;
  const thumbUrl = row.thumbnail_path ? await createSignedUrl(admin, HISTORY_THUMB_BUCKET, row.thumbnail_path).catch(() => null) : null;
  const linkedThumbUrl = thumbUrl || meta.thumbnail_fallback || (!isVideo && !isAudio ? (meta.previewUrl || null) : null);
  const item = {
    id: row.id,
    type: row.type,
    prompt: row.prompt || '',
    timestamp: Date.parse(row.created_at || '') || Date.now(),
    thumbnailUrl: linkedThumbUrl || null,
    mediaUnavailable: !row.media_path && !hasLinkedMedia,
    genCtx: meta.genCtx || null,
    cloud: true,
    meta,
  };
  if (is3d) {
    item.url = thumbUrl || meta.placeholderUrl || meta.previewUrl || null;
    item.modelDownloadUrl = mediaUrl || meta.originalDownloadUrl || meta.originalUrl || null;
    item.modelFormat = meta.modelFormat || 'glb';
    item.model_urls = meta.model_urls || null;
    item.glbUrl = item.modelFormat === 'glb' ? item.modelDownloadUrl : null;
  } else if (isAudio) {
    item.url = mediaUrl || meta.originalUrl || meta.originalDownloadUrl || null;
    item.residualUrl = meta.originalResidualUrl || meta.residualUrl || null;
    item.duration = Number.isFinite(Number(meta.duration)) ? Number(meta.duration) : null;
    item.sampleRate = Number.isFinite(Number(meta.sampleRate)) ? Number(meta.sampleRate) : null;
  } else if (isVideo) {
    item.url = mediaUrl || meta.originalUrl || meta.originalDownloadUrl || meta.previewUrl || meta.thumbnail_fallback || null;
  } else {
    item.url = mediaUrl || meta.originalUrl || meta.previewUrl || meta.thumbnail_fallback || null;
  }
  return item;
}

function buildTextPresetStore(rows, kind) {
  const store = {};
  for (const row of rows || []) {
    if (row.kind !== kind) continue;
    const lang = row.lang || 'en';
    if (!store[lang]) store[lang] = { removed: [], custom: [] };
    if (row.state === 'removed_default') store[lang].removed.push(row.value);
    if (row.state === 'custom') store[lang].custom.push(row.value);
  }
  return store;
}

function isUuidLike(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());
}

function normalizeCustomPresetDbId(value, fallbackPrefix = 'preset') {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (isUuidLike(raw)) return raw.toLowerCase();
  const source = raw || `${fallbackPrefix}:${crypto.randomUUID()}`;
  const hash = crypto.createHash('sha1').update(`${fallbackPrefix}:${source}`).digest('hex').slice(0, 32);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

function isFontCustomPresetRow(row) {
  const path = String(row && row.image_path ? row.image_path : '').toLowerCase();
  return path.includes('/design-presets/fonts/');
}

function buildDesignPresetState(rows, customRows) {
  const hiddenBuiltins = [];
  const nameOverrides = {};
  for (const row of rows || []) {
    if (row.hidden) hiddenBuiltins.push(row.builtin_id);
    if (row.name_override) nameOverrides[row.builtin_id] = row.name_override;
  }
  const mappedCustomPresets = (customRows || []).map((row) => ({
    id: row.id,
    name: row.name || 'Custom Preset',
    image_path: row.image_path,
    storagePath: row.image_path,
    createdAt: row.created_at,
    isCustom: true,
  }));
  return {
    hiddenBuiltins,
    nameOverrides,
    customPresets: mappedCustomPresets.filter((row) => !isFontCustomPresetRow(row)),
    fontCustomPresets: mappedCustomPresets.filter((row) => isFontCustomPresetRow(row)),
  };
}

async function fetchHistoryPage(admin, userId, options = {}) {
  const offset = Number.isFinite(Number(options.offset)) ? Math.max(0, Number(options.offset)) : 0;
  const rawLimit = Number(options.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(200, Math.floor(rawLimit)) : null;
  const includeCount = options.includeCount === true;
  let query = admin.from('history_items').select('*', includeCount ? { count: 'exact' } : undefined).eq('user_id', userId).order('created_at', { ascending: false });
  if (limit) query = query.range(offset, offset + (includeCount ? limit - 1 : limit));
  const historyRes = await query;
  if (historyRes.error) throw historyRes.error;
  const rows = Array.isArray(historyRes.data) ? historyRes.data : [];
  const pageRows = limit && !includeCount ? rows.slice(0, limit) : rows;
  const items = await Promise.all(pageRows.map((row) => normalizeHistoryRow(admin, row)));
  const totalCount = includeCount
    ? (typeof historyRes.count === 'number' ? historyRes.count : items.length)
    : null;
  const hasMore = includeCount
    ? !!(limit && offset + items.length < totalCount)
    : !!(limit && rows.length > limit);
  return {
    items,
    totalCount,
    nextOffset: hasMore ? offset + items.length : null,
  };
}

async function fetchHistorySummary(admin, userId) {
  const [{ count, error: countError }, headRes] = await Promise.all([
    admin.from('history_items').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    admin.from('history_items').select('id, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(1),
  ]);
  if (countError) throw countError;
  if (headRes.error) throw headRes.error;
  const newestRow = Array.isArray(headRes.data) && headRes.data.length ? headRes.data[0] : null;
  const totalCount = typeof count === 'number' ? count : 0;
  return {
    items: [],
    totalCount,
    nextOffset: totalCount > 0 ? 0 : null,
    newestId: newestRow && newestRow.id ? String(newestRow.id) : null,
    newestTimestamp: newestRow && newestRow.created_at ? (Date.parse(newestRow.created_at) || null) : null,
  };
}

async function fetchAccountData(admin, userId, options = {}) {
  const includeHistory = options.includeHistory !== false;
  const historyOffset = Number.isFinite(Number(options.historyOffset)) ? Math.max(0, Number(options.historyOffset)) : 0;
  const historyLimit = Number.isFinite(Number(options.historyLimit)) && Number(options.historyLimit) > 0
    ? Math.min(200, Math.floor(Number(options.historyLimit)))
    : null;
  const [profileRes, textRes, designRes, customRes, historyResult] = await Promise.all([
    admin.from('profiles').select('*').eq('id', userId).maybeSingle(),
    admin.from('text_preset_overrides').select('*').eq('user_id', userId),
    admin.from('design_preset_overrides').select('*').eq('user_id', userId),
    admin.from('custom_design_presets').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
    includeHistory
      ? fetchHistoryPage(admin, userId, { offset: historyOffset, limit: historyLimit, includeCount: true })
      : fetchHistorySummary(admin, userId),
  ]);
  if (profileRes.error) throw profileRes.error;
  if (textRes.error) throw textRes.error;
  if (designRes.error) throw designRes.error;
  if (customRes.error) throw customRes.error;

  const textRows = textRes.data || [];
  const customDesignRows = customRes.data || [];
  const designState = buildDesignPresetState(designRes.data || [], customDesignRows);
  const signPresetList = async (list) => Promise.all((list || []).map(async (preset) => ({
    ...preset,
    src: preset.storagePath ? await createSignedUrl(admin, DESIGN_PRESET_BUCKET, preset.storagePath).catch(() => null) : null,
  })));
  const customPresets = await signPresetList(designState.customPresets);
  const fontCustomPresets = await signPresetList(designState.fontCustomPresets);

  return {
    profile: profileRes.data || null,
    history: historyResult.items,
    historyMeta: {
      totalCount: historyResult.totalCount,
      loadedCount: historyResult.items.length,
      nextOffset: historyResult.nextOffset,
      newestId: historyResult.newestId || (historyResult.items[0] && historyResult.items[0].id ? historyResult.items[0].id : null),
      newestTimestamp: historyResult.newestTimestamp || (historyResult.items[0] && historyResult.items[0].timestamp ? Number(historyResult.items[0].timestamp) : null),
    },
    titlePresetStore: buildTextPresetStore(textRows, 'title'),
    charPresetStore: buildTextPresetStore(textRows, 'char'),
    designPresetState: {
      hiddenBuiltins: designState.hiddenBuiltins,
      nameOverrides: designState.nameOverrides,
      customPresets,
      fontCustomPresets,
    },
    summary: summarizeCounts(historyResult.totalCount, textRows, customDesignRows),
  };
}

async function upsertProfile(admin, user) {
  const payload = {
    id: user.id,
    email: user.email || null,
    display_name: user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name) ? (user.user_metadata.full_name || user.user_metadata.name) : (user.email || 'User'),
    avatar_url: user.user_metadata && user.user_metadata.avatar_url ? user.user_metadata.avatar_url : null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from('profiles').upsert(payload, { onConflict: 'id' });
  if (error) throw error;
}

async function replaceTextPresetStore(admin, userId, kind, store) {
  const { error: deleteError } = await admin.from('text_preset_overrides').delete().eq('user_id', userId).eq('kind', kind);
  if (deleteError) throw deleteError;
  const rows = [];
  for (const [lang, data] of Object.entries(store || {})) {
    for (const value of Array.isArray(data && data.removed) ? data.removed : []) {
      rows.push({ id: crypto.randomUUID(), user_id: userId, kind, lang, value, state: 'removed_default' });
    }
    for (const value of Array.isArray(data && data.custom) ? data.custom : []) {
      rows.push({ id: crypto.randomUUID(), user_id: userId, kind, lang, value, state: 'custom' });
    }
  }
  if (!rows.length) return;
  const { error } = await admin.from('text_preset_overrides').insert(rows);
  if (error) throw error;
}

async function replaceDesignPresetState(admin, userId, state) {
  const nextState = state || {};
  const hiddenBuiltins = Array.isArray(nextState.hiddenBuiltins) ? nextState.hiddenBuiltins : [];
  const nameOverrides = nextState.nameOverrides && typeof nextState.nameOverrides === 'object' ? nextState.nameOverrides : {};
  const incomingCustom = Array.isArray(nextState.customPresets) ? nextState.customPresets : [];
  const incomingFontCustom = Array.isArray(nextState.fontCustomPresets) ? nextState.fontCustomPresets : [];
  const incomingAllCustom = [
    ...incomingCustom.map((preset) => ({ ...(preset || {}), __bucket: 'inspo' })),
    ...incomingFontCustom.map((preset) => ({ ...(preset || {}), __bucket: 'font' })),
  ];

  const { data: existingCustomRows, error: existingError } = await admin.from('custom_design_presets').select('*').eq('user_id', userId);
  if (existingError) throw existingError;
  const keepIds = new Set();
  const nextRows = [];
  for (const preset of incomingAllCustom) {
    const presetId = normalizeCustomPresetDbId(preset && preset.id, preset && preset.__bucket === 'font' ? 'font-preset' : 'custom-preset');
    keepIds.add(presetId);
    let imagePath = preset.storagePath || null;
    if (!imagePath && preset.dataUrl) {
      const basePath = preset && preset.__bucket === 'font'
        ? `${userId}/design-presets/fonts/${presetId}`
        : `${userId}/design-presets/${presetId}`;
      imagePath = await uploadSource(admin, DESIGN_PRESET_BUCKET, basePath, preset.dataUrl, 'png');
    }
    nextRows.push({
      id: presetId,
      user_id: userId,
      name: preset && preset.name ? String(preset.name) : 'Custom Preset',
      image_path: imagePath,
      created_at: normalizeDbTimestamp(preset && preset.createdAt),
    });
  }

  const removals = [];
  for (const row of existingCustomRows || []) {
    if (!keepIds.has(row.id) && row.image_path) removals.push({ bucket: DESIGN_PRESET_BUCKET, path: row.image_path });
  }
  if (removals.length) await removeStorageObjects(admin, removals);

  const { error: deleteOverridesError } = await admin.from('design_preset_overrides').delete().eq('user_id', userId);
  if (deleteOverridesError) throw deleteOverridesError;
  const { error: deleteCustomError } = await admin.from('custom_design_presets').delete().eq('user_id', userId);
  if (deleteCustomError) throw deleteCustomError;

  const overrideRows = [];
  const builtinIds = new Set([...hiddenBuiltins, ...Object.keys(nameOverrides)]);
  for (const builtinId of builtinIds) {
    overrideRows.push({
      id: crypto.randomUUID(),
      user_id: userId,
      builtin_id: builtinId,
      hidden: hiddenBuiltins.includes(builtinId),
      name_override: nameOverrides[builtinId] || null,
    });
  }
  if (overrideRows.length) {
    const { error } = await admin.from('design_preset_overrides').insert(overrideRows);
    if (error) throw error;
  }
  if (nextRows.length) {
    const { error } = await admin.from('custom_design_presets').insert(nextRows);
    if (error) throw error;
  }
}

function normalizeDbTimestamp(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return new Date().toISOString();
    if (/^\d{10,17}$/.test(trimmed)) {
      const numeric = Number(trimmed);
      const date = new Date(numeric);
      return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
    }
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

function prepareHistoryRow(userId, rawItem) {
  const rawId = rawItem && rawItem.id ? String(rawItem.id) : '';
  const itemId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawId)
    ? rawId
    : crypto.randomUUID();
  const timestamp = rawItem && rawItem.timestamp ? Number(rawItem.timestamp) : Date.now();
  const basePath = `${userId}/history/${timestamp}-${itemId}`;
  const type = rawItem && rawItem.type ? rawItem.type : 'image';
  const previewUrl = type === 'audio'
    ? (rawItem && rawItem.thumbnailUrl ? rawItem.thumbnailUrl : null)
    : (rawItem && (rawItem.thumbnailUrl || rawItem.url) ? (rawItem.thumbnailUrl || rawItem.url) : null);
  const meta = {
    clientId: itemId,
    genCtx: rawItem && rawItem.genCtx ? rawItem.genCtx : null,
    modelFormat: rawItem && rawItem.modelFormat ? rawItem.modelFormat : null,
    model_urls: rawItem && rawItem.model_urls ? rawItem.model_urls : null,
    originalUrl: rawItem && rawItem.url ? rawItem.url : null,
    originalDownloadUrl: rawItem && rawItem.modelDownloadUrl ? rawItem.modelDownloadUrl : null,
    originalResidualUrl: rawItem && rawItem.residualUrl ? rawItem.residualUrl : null,
    previewUrl,
    thumbnail_fallback: rawItem && rawItem.thumbnailUrl ? rawItem.thumbnailUrl : previewUrl,
    placeholderUrl: rawItem && rawItem.url && /^data:/i.test(rawItem.url) ? rawItem.url : null,
    duration: rawItem && Number.isFinite(Number(rawItem.duration)) ? Number(rawItem.duration) : null,
    sampleRate: rawItem && Number.isFinite(Number(rawItem.sampleRate)) ? Number(rawItem.sampleRate) : null,
    outputFormat: rawItem && rawItem.meta && rawItem.meta.outputFormat ? rawItem.meta.outputFormat : (rawItem && rawItem.outputFormat ? rawItem.outputFormat : null),
  };
  return {
    rawItem,
    type,
    basePath,
    row: {
      id: itemId,
      user_id: userId,
      type,
      prompt: rawItem && rawItem.prompt ? String(rawItem.prompt) : '',
      created_at: new Date(timestamp).toISOString(),
      media_path: null,
      thumbnail_path: null,
      meta_json: meta,
    },
  };
}

function normalizeHistoryRowFallback(row) {
  const meta = safeJson(row.meta_json, {}) || {};
  const is3d = row.type === '3d';
  const isVideo = row.type === 'video';
  const isAudio = row.type === 'audio';
  const hasLinkedMedia = !!(meta.originalUrl || meta.originalDownloadUrl || meta.previewUrl || meta.thumbnail_fallback || meta.placeholderUrl);
  const linkedThumbUrl = meta.thumbnail_fallback || (!isVideo && !isAudio ? (meta.previewUrl || null) : null);
  const item = {
    id: row.id,
    type: row.type,
    prompt: row.prompt || '',
    timestamp: Date.parse(row.created_at || '') || Date.now(),
    thumbnailUrl: linkedThumbUrl || null,
    mediaUnavailable: !row.media_path && !hasLinkedMedia,
    genCtx: meta.genCtx || null,
    cloud: true,
    meta,
  };
  if (is3d) {
    item.url = meta.placeholderUrl || meta.previewUrl || null;
    item.modelDownloadUrl = meta.originalDownloadUrl || meta.originalUrl || null;
    item.modelFormat = meta.modelFormat || 'glb';
    item.model_urls = meta.model_urls || null;
    item.glbUrl = item.modelFormat === 'glb' ? item.modelDownloadUrl : null;
  } else if (isAudio) {
    item.url = meta.originalUrl || meta.originalDownloadUrl || null;
    item.residualUrl = meta.originalResidualUrl || meta.residualUrl || null;
    item.duration = Number.isFinite(Number(meta.duration)) ? Number(meta.duration) : null;
    item.sampleRate = Number.isFinite(Number(meta.sampleRate)) ? Number(meta.sampleRate) : null;
  } else if (isVideo) {
    item.url = meta.originalUrl || meta.originalDownloadUrl || meta.previewUrl || meta.thumbnail_fallback || null;
  } else {
    item.url = meta.originalUrl || meta.previewUrl || meta.thumbnail_fallback || null;
  }
  return item;
}

async function saveHistoryItems(admin, userId, items, options = {}) {
  const fastMigration = !!(options && options.fastMigration);
  const preparedRows = [];
  for (const rawItem of items || []) {
    const prepared = prepareHistoryRow(userId, rawItem);
    const meta = prepared.row.meta_json;
    meta.linkOnly = true;
    if (fastMigration) meta.fastMigrated = true;
    const hasOriginalMedia = !!(meta.originalUrl || meta.originalDownloadUrl);
    const hasPreviewMedia = !!(meta.previewUrl || meta.thumbnail_fallback || meta.placeholderUrl);
    if (!hasOriginalMedia && !hasPreviewMedia) {
      meta.missingMedia = true;
    } else if (!hasOriginalMedia) {
      meta.degraded = true;
      meta.missingMedia = true;
    }
    preparedRows.push(prepared.row);
  }
  for (let i = 0; i < preparedRows.length; i += 100) {
    const chunk = preparedRows.slice(i, i + 100);
    if (!chunk.length) continue;
    const { error } = await admin.from('history_items').upsert(chunk, { onConflict: 'id' });
    if (error) throw error;
  }
  return preparedRows.map((row) => normalizeHistoryRowFallback(row));
}

async function deleteHistoryItem(admin, userId, itemId) {
  const { data: row, error: rowError } = await admin.from('history_items').select('*').eq('id', itemId).eq('user_id', userId).maybeSingle();
  if (rowError) throw rowError;
  if (!row) return false;
  const removals = [];
  if (row.media_path) removals.push({ bucket: HISTORY_MEDIA_BUCKET, path: row.media_path });
  if (row.thumbnail_path) removals.push({ bucket: HISTORY_THUMB_BUCKET, path: row.thumbnail_path });
  if (removals.length) await removeStorageObjects(admin, removals);
  const { error } = await admin.from('history_items').delete().eq('id', itemId).eq('user_id', userId);
  if (error) throw error;
  return true;
}

async function clearHistoryItems(admin, userId) {
  const removals = [];
  let deletedCount = 0;
  let page = 0;
  const pageSize = 500;
  while (true) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const { data: rows, error } = await admin
      .from('history_items')
      .select('id, media_path, thumbnail_path')
      .eq('user_id', userId)
      .range(from, to);
    if (error) throw error;
    const batch = Array.isArray(rows) ? rows : [];
    if (!batch.length) break;
    deletedCount += batch.length;
    batch.forEach((row) => {
      if (row && row.media_path) removals.push({ bucket: HISTORY_MEDIA_BUCKET, path: row.media_path });
      if (row && row.thumbnail_path) removals.push({ bucket: HISTORY_THUMB_BUCKET, path: row.thumbnail_path });
    });
    if (batch.length < pageSize) break;
    page += 1;
  }
  if (removals.length) await removeStorageObjects(admin, removals);
  const { error: deleteError } = await admin.from('history_items').delete().eq('user_id', userId);
  if (deleteError) throw deleteError;
  return deletedCount;
}

module.exports = {
  HISTORY_MEDIA_BUCKET,
  HISTORY_THUMB_BUCKET,
  DESIGN_PRESET_BUCKET,
  SIGNED_URL_TTL,
  getSupabaseConfig,
  isSupabaseConfigured,
  createAdminClient,
  createAnonClient,
  setCors,
  readJsonBody,
  requireSupabaseUser,
  uploadSource,
  uploadBuffer,
  createSignedUrl,
  removeStorageObjects,
  fetchHistoryPage,
  fetchAccountData,
  upsertProfile,
  replaceTextPresetStore,
  replaceDesignPresetState,
  saveHistoryItems,
  deleteHistoryItem,
  clearHistoryItems,
};





