// Icons
if (window.lucide && typeof window.lucide.createIcons === 'function') {
  window.lucide.createIcons();
}

// State
let currentMode = 'text';
let currentVideoTab = 'text-to-video';
let activeAccountStorageScope = null;
let accountSyncSuspendCount = 0;

function setActiveAccountStorageScope(userId) {
  activeAccountStorageScope = userId ? String(userId) : null;
}

function getActiveAccountStorageScope() {
  return activeAccountStorageScope || null;
}

function getScopedStorageKey(baseKey, explicitScope) {
  const scope = explicitScope === undefined
    ? getActiveAccountStorageScope()
    : (explicitScope ? String(explicitScope) : null);
  return scope ? `${baseKey}::${scope}` : baseKey;
}

function readStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (_) {
    return fallback;
  }
}

function loadStoredArray(baseKey) {
  const value = readStoredJson(getScopedStorageKey(baseKey), []);
  return Array.isArray(value) ? value : [];
}

function getHistoryCacheMetaKey(explicitScope) {
  return getScopedStorageKey('nano_history_meta', explicitScope);
}

function createHistoryClientId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return `hist_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function ensureHistoryItemIdentity(item) {
  if (!item || typeof item !== 'object') return item;
  if (!item.id || typeof item.id !== 'string') {
    item.id = createHistoryClientId();
  }
  return item;
}

function getHistoryPrimaryUrl(item) {
  const meta = item && item.meta && typeof item.meta === 'object' ? item.meta : null;
  return (
    (meta && (meta.originalDownloadUrl || meta.originalUrl || meta.previewUrl || meta.thumbnail_fallback || meta.placeholderUrl))
    || item.modelDownloadUrl
    || item.url
    || item.thumbnailUrl
    || ''
  );
}

function getHistorySemanticKey(item) {
  if (!item || typeof item !== 'object') return '';
  const meta = item.meta && typeof item.meta === 'object' ? item.meta : null;
  const clientId = meta && meta.clientId ? String(meta.clientId) : '';
  if (clientId) return `client:${clientId}`;
  if (!item.cloud && item.id) return `local:${String(item.id)}`;
  const type = item.type || 'image';
  const timestamp = Number.isFinite(Number(item.timestamp)) ? Number(item.timestamp) : 0;
  const primaryUrl = getHistoryPrimaryUrl(item);
  if (primaryUrl) return `media:${type}:${timestamp}:${primaryUrl}`;
  const requestId = item.genCtx && (item.genCtx.requestId || item.genCtx.taskId || item.genCtx.jobId || item.genCtx.id)
    ? String(item.genCtx.requestId || item.genCtx.taskId || item.genCtx.jobId || item.genCtx.id)
    : '';
  if (requestId) return `req:${type}:${requestId}`;
  const prompt = item.prompt ? String(item.prompt).trim() : '';
  if (prompt) return `prompt:${type}:${timestamp}:${prompt.slice(0, 200)}`;
  return '';
}

function getHistoryIdentityKey(item, fallbackIndex = 0) {
  const semanticKey = getHistorySemanticKey(item);
  if (semanticKey) return semanticKey;
  if (item && item.id) return `id:${item.id}`;
  const type = item && item.type ? item.type : 'image';
  const primaryUrl = getHistoryPrimaryUrl(item);
  const timestamp = Number.isFinite(Number(item && item.timestamp)) ? Number(item.timestamp) : 0;
  return `fallback:${type}:${timestamp}:${primaryUrl}:${fallbackIndex}`;
}

const LOCAL_HISTORY_CACHE_LIMIT = 120;

function normalizeHistoryItemForRuntime(item) {
  if (!item || typeof item !== 'object') return item;
  const next = item;
  const meta = next.meta && typeof next.meta === 'object' ? next.meta : null;
  const type = next.type || 'image';
  const originalUrl = meta && meta.originalUrl ? String(meta.originalUrl) : '';
  const originalDownloadUrl = meta && meta.originalDownloadUrl ? String(meta.originalDownloadUrl) : '';
  const previewUrl = meta && meta.previewUrl ? String(meta.previewUrl) : '';
  const fallbackThumb = meta && meta.thumbnail_fallback ? String(meta.thumbnail_fallback) : '';

  ensureHistoryItemIdentity(next);

  if (type === 'video') {
    if ((!next.url || /^data:image\//i.test(String(next.url))) && (originalUrl || originalDownloadUrl)) {
      next.url = originalUrl || originalDownloadUrl;
    }
    if (next.thumbnailUrl && next.url && String(next.thumbnailUrl) === String(next.url)) {
      next.thumbnailUrl = fallbackThumb && fallbackThumb !== next.url ? fallbackThumb : null;
    }
    if (!next.thumbnailUrl) {
      const thumbCandidate = fallbackThumb || (previewUrl && previewUrl !== next.url ? previewUrl : '');
      if (thumbCandidate && thumbCandidate !== next.url) next.thumbnailUrl = thumbCandidate;
    }
  } else if (type === 'image') {
    if (originalUrl && (!next.url || (fallbackThumb && String(next.url) === fallbackThumb))) {
      next.url = originalUrl;
    }
    if (!next.thumbnailUrl) {
      const thumbCandidate = fallbackThumb || (previewUrl && previewUrl !== next.url ? previewUrl : '');
      if (thumbCandidate && thumbCandidate !== next.url) next.thumbnailUrl = thumbCandidate;
    }
  } else if (type === '3d') {
    if (!next.url && (fallbackThumb || previewUrl)) next.url = fallbackThumb || previewUrl;
    if (!next.modelDownloadUrl && (originalDownloadUrl || originalUrl)) {
      next.modelDownloadUrl = originalDownloadUrl || originalUrl;
    }
    if (!next.thumbnailUrl && (fallbackThumb || previewUrl)) next.thumbnailUrl = fallbackThumb || previewUrl;
  }

  return next;
}

function sortHistoryItems(items) {
  return items.sort((a, b) => {
    const at = Number.isFinite(Number(a && a.timestamp)) ? Number(a.timestamp) : 0;
    const bt = Number.isFinite(Number(b && b.timestamp)) ? Number(b.timestamp) : 0;
    return bt - at;
  });
}

function dedupeHistoryItems(items) {
  const map = new Map();
  (Array.isArray(items) ? items : []).forEach((item, index) => {
    if (!item) return;
    const normalizedItem = normalizeHistoryItemForRuntime(item);
    const key = getHistoryIdentityKey(normalizedItem, index);
    const existing = map.get(key);
    map.set(key, existing ? Object.assign(existing, normalizedItem) : normalizedItem);
  });
  return sortHistoryItems(Array.from(map.values()));
}

function buildHistoryCacheMeta(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  const persistedCount = Number.isFinite(Number(options.persistedCount))
    ? Math.max(0, Math.min(list.length, Number(options.persistedCount)))
    : list.length;
  return {
    count: list.length,
    cachedCount: persistedCount,
    complete: persistedCount >= list.length,
    savedAt: Date.now(),
    newestId: list[0] && list[0].id ? list[0].id : null,
    newestTimestamp: list[0] && Number.isFinite(Number(list[0].timestamp)) ? Number(list[0].timestamp) : null,
  };
}

function getScopedHistoryCacheMeta(explicitScope) {
  const raw = readStoredJson(getHistoryCacheMetaKey(explicitScope), null);
  if (!raw || typeof raw !== 'object') {
    return { count: 0, cachedCount: 0, complete: false, savedAt: 0, newestId: null, newestTimestamp: null };
  }
  return {
    count: Number.isFinite(Number(raw.count)) ? Math.max(0, Number(raw.count)) : 0,
    cachedCount: Number.isFinite(Number(raw.cachedCount))
      ? Math.max(0, Number(raw.cachedCount))
      : (Number.isFinite(Number(raw.count)) ? Math.max(0, Number(raw.count)) : 0),
    complete: raw.complete !== false,
    savedAt: Number.isFinite(Number(raw.savedAt)) ? Number(raw.savedAt) : 0,
    newestId: raw.newestId ? String(raw.newestId) : null,
    newestTimestamp: Number.isFinite(Number(raw.newestTimestamp)) ? Number(raw.newestTimestamp) : null,
  };
}

function persistHistoryCacheMeta(items, explicitScope, options = {}) {
  try {
    localStorage.setItem(getHistoryCacheMetaKey(explicitScope), JSON.stringify(buildHistoryCacheMeta(items, options)));
  } catch (_) {}
}

function withAccountSyncSuspended(fn) {
  accountSyncSuspendCount += 1;
  try {
    return fn();
  } finally {
    accountSyncSuspendCount = Math.max(0, accountSyncSuspendCount - 1);
  }
}

function isAccountSyncSuspended() {
  return accountSyncSuspendCount > 0;
}

function isPrimaryCoarsePointer() {
  try {
    return !!(window.matchMedia && (
      window.matchMedia('(pointer: coarse)').matches
      || window.matchMedia('(hover: none)').matches
    ));
  } catch (_) {
    return false;
  }
}

function shouldSkipClientHistoryThumbnailWork() {
  return document.hidden || isPrimaryCoarsePointer() || !!activeTouchAssetDrag;
}

function canGenerateClientHistoryThumbnail(item) {
  if (!item || !item.url || item.thumbnailUrl || item.type === '3d') return false;
  if (shouldSkipClientHistoryThumbnailWork()) return false;
  return item.type === 'video';
}

// Account history/tasks are loaded after the signed-in scope is known.
let history = [];
let tasks = [];
const HISTORY_FILTERS = [
  { id: 'all', types: null },
  { id: 'image', types: ['image'] },
  { id: 'video', types: ['video'] },
  { id: '3d', types: ['3d'] },
];
let historyViewState = { type: HISTORY_FILTERS[0].id, query: '' };
let historyHydrating = false;

const pollTimers = new Map();

const MAX_CONCURRENT_TASKS = 4;
let taskTicker = null;
let currentPreview = null;

// Gallery state for multiple outputs
let galleryItems = [];
let galleryIndex = 0;

// File state
let uploadedImageFiles = [];
let uploadedMaskFile = null;
let uploadedVideoFile = null;
let uploadedVideoImageFile = null;
let uploadedReferenceImages = [];
let uploadedEndImageFile = null;
let uploaded3dFrontFile = null;
let uploaded3dBackFile = null;
let uploaded3dLeftFile = null;
let uploaded3dRightFile = null;
let uploaded3dMeshyTextureImageFile = null;
let uploaded3dTopologyFile = null;
let uploaded3dRetextureModelFile = null;
let uploaded3dRetextureStyleImageFile = null;
let uploadedAudioFile = null;

// Kling 3 specific file state
let uploadedKling3StartImage = null;
let uploadedKling3EndImage = null;
let uploadedKling3Video = null;
let uploadedKling3RefImages = [];

// Tools mode state
let uploadedToolsImages = [];
const managedUploadRemoteState = Object.create(null);
let toolsCharsCount = 0;
let currentKling3Tab = 'v3-text-to-video';
let currentKling3Family = 'v3';
let currentLtx23Family = 'text-to-video';
let kling3MultiPrompts = [];
let kling3Elements = []; // KlingV3ElementInput: { id, frontalImageFile, frontalImageUrl, referenceImageFiles, referenceImageUrls, videoFile, videoUrl }
let kling3SelectedModelByTab = {};
let kling3LastTabByFamily = { v3: 'v3-text-to-video', o3: 'o3-text-to-video' };
let kling3ControlsInitialized = false;
let ltx23SelectedModelByFamily = {};

function isRemoteAssetItem(item) {
  return !!(item && typeof item === 'object' && item.__remoteAsset && typeof item.url === 'string' && item.url);
}

function createRemoteAssetItem(payload = {}) {
  if (!payload || !payload.url) return null;
  const type = payload.type || (String(payload.mimeHint || '').startsWith('video/') ? 'video' : 'image');
  const fallbackExt = type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'png';
  const name = payload.filename || deriveFilenameFromUrl(payload.url, fallbackExt);
  return {
    __remoteAsset: true,
    url: String(payload.url),
    name,
    type: payload.mimeHint || inferMimeTypeFromName(name, type === 'video' ? 'video/mp4' : type === 'audio' ? 'audio/mpeg' : 'image/png'),
    assetType: type,
  };
}

function normalizeRemoteAssetItems(value, fallbackKind = 'image') {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  return list
    .map((entry) => {
      if (!entry) return null;
      if (typeof entry === 'string') {
        return createRemoteAssetItem({ url: entry, type: fallbackKind });
      }
      if (isRemoteAssetItem(entry)) return entry;
      if (typeof entry === 'object' && entry.url) {
        return createRemoteAssetItem({
          url: entry.url,
          filename: entry.name || entry.filename,
          mimeHint: entry.type || entry.mimeHint,
          type: entry.assetType || fallbackKind,
        });
      }
      return null;
    })
    .filter(Boolean);
}

function getAssetItemName(item, fallback = 'asset') {
  if (!item) return fallback;
  if (isRemoteAssetItem(item)) return item.name || deriveFilenameFromUrl(item.url, 'bin');
  return item.name || fallback;
}

function getAssetItemPreviewUrl(item) {
  if (!item) return '';
  return isRemoteAssetItem(item) ? item.url : '';
}

function clearPreviewBlobUrls(host) {
  if (!host || !Array.isArray(host._previewBlobUrls)) {
    if (host) host._previewBlobUrls = [];
    return;
  }
  host._previewBlobUrls.forEach((url) => {
    try { URL.revokeObjectURL(url); } catch (_) {}
  });
  host._previewBlobUrls = [];
}

function getPreviewSrcForAssetItem(item, host) {
  if (!item) return '';
  if (isRemoteAssetItem(item)) return item.url;
  const blobUrl = URL.createObjectURL(item);
  if (host) {
    if (!Array.isArray(host._previewBlobUrls)) host._previewBlobUrls = [];
    host._previewBlobUrls.push(blobUrl);
  }
  return blobUrl;
}

async function ensureFileLikeAssetItem(item) {
  if (!item) return null;
  if (!isRemoteAssetItem(item)) return item;
  return fetchUrlAsFile(item.url, {
    type: item.assetType || 'image',
    filename: item.name,
    mimeHint: item.type,
  });
}
const NEWS_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const DEFAULT_IMAGE_TEXT_MODEL = 'nano-banana-pro';
const DEFAULT_IMAGE_EDIT_MODEL = 'nano-banana-pro/edit';
const DEFAULT_TOOLS_MODEL = DEFAULT_IMAGE_EDIT_MODEL;
const DEFAULT_3D_MODEL = 'fal-ai/meshy/v6-preview/image-to-3d';

const IMAGE_MODELS_TEXT = [
  { id: 'nano-banana-pro', label: 'Nano Banana Pro' },
  { id: 'nano-banana-2', label: 'Nano Banana 2' },
  { id: 'gpt-image-1.5', label: 'GPT-Image 1.5' },
  { id: 'flux-pro-v1.1-ultra', label: 'Flux Pro v1.1 Ultra' },
];

const EDIT_MAX_IMAGES = {
  'nano-banana-2/edit': 14,
  'nano-banana-pro/edit': 14,
  'gpt-image-1.5/edit': 4,
};
function editMaxImages() {
  const sel = qs('imageModelEdit');
  const id = sel ? sel.value : DEFAULT_IMAGE_EDIT_MODEL;
  return EDIT_MAX_IMAGES[id] || EDIT_MAX_IMAGES[DEFAULT_IMAGE_EDIT_MODEL] || 4;
}

const IMAGE_MODELS_EDIT = [
  { id: 'nano-banana-pro/edit', label: 'Nano Banana Pro (Edit)' },
  { id: 'nano-banana-2/edit', label: 'Nano Banana 2 (Edit)' },
  { id: 'gpt-image-1.5/edit', label: 'GPT-Image 1.5 (Edit)' },
];
const TOOLS_MODELS = IMAGE_MODELS_EDIT.map((model) => ({
  id: model.id,
  label: model.label.replace(/\s+\(Edit\)$/, ''),
}));

const THREE_D_MODELS = [
  { id: 'fal-ai/meshy/v6-preview/image-to-3d', label: 'Meshy V6 Preview (Image to 3D)', kind: 'image-to-3d', provider: 'fal' },
  { id: 'fal-ai/hunyuan3d-v3/image-to-3d', label: 'Hunyuan3D V3 (Image to 3D)', kind: 'image-to-3d', provider: 'fal' },
  { id: 'fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d', label: 'Hunyuan3D V3.1 Rapid (Image to 3D)', kind: 'image-to-3d', provider: 'fal' },
  { id: 'fal-ai/meshy/v6-preview/text-to-3d', label: 'Meshy V6 Preview (Text to 3D)', kind: 'text-to-3d', provider: 'fal' },
  { id: 'fal-ai/hunyuan3d-v3/text-to-3d', label: 'Hunyuan3D V3 (Text to 3D)', kind: 'text-to-3d', provider: 'fal' },
  { id: 'fal-ai/hunyuan-3d/v3.1/smart-topology', label: 'Hunyuan3D V3.1 Smart Topology', kind: 'topology', provider: 'fal' },
  { id: 'fal-ai/meshy/v5/retexture', label: 'Meshy V5 Retexture', kind: 'retexture', provider: 'fal' },
];

// Kling 3 Models
const KLING3_MODELS = {
  'v3-text-to-video': [
    { id: 'kling-v3-pro-t2v', label: 'Kling 3.0 Pro (Text to Video)' },
  ],
  'v3-image-to-video': [
    { id: 'kling-v3-pro-i2v', label: 'Kling 3.0 Pro (Image to Video)' },
  ],
  'v3-motion-control': [
    {
      id: 'kling-v3-pro-motion-control',
      label: 'Kling 3.0 Pro (Motion Control)',
      addedAt: '2026-03-05T00:00:00.000Z',
      newsDescriptionKey: 'news_desc_kling_v3_pro_motion',
    },
    {
      id: 'kling-v3-standard-motion-control',
      label: 'Kling 3.0 Standard (Motion Control)',
      addedAt: '2026-03-05T00:00:00.000Z',
      newsDescriptionKey: 'news_desc_kling_v3_standard_motion',
    },
  ],
  'o3-text-to-video': [
    { id: 'kling-o3-pro-t2v', label: 'Kling O3 Pro (Text to Video)' },
  ],
  'o3-image-to-video': [
    { id: 'kling-o3-pro-i2v', label: 'Kling O3 Pro (Image to Video)' },
  ],
  'o3-reference-to-video': [
    { id: 'kling-o3-pro-ref2v', label: 'Kling O3 Pro (Reference to Video)' },
  ],
  'o3-video-to-video': [
    { id: 'kling-o3-pro-v2v-ref', label: 'Kling O3 Pro (V2V Reference)' },
    { id: 'kling-o3-pro-v2v-edit', label: 'Kling O3 Pro (V2V Edit)' },
  ],
};

const KLING3_MOTION_MODEL_IDS = new Set([
  'kling-v3-standard-motion-control',
  'kling-v3-pro-motion-control',
]);

const KLING3_MODEL_TO_TAB = new Map(
  Object.entries(KLING3_MODELS).flatMap(([tab, models]) => (models || []).map((model) => [model.id, tab])),
);

const KLING3_TAB_TO_VIDEO_TAB = {
  'v3-text-to-video': 'text-to-video',
  'o3-text-to-video': 'text-to-video',
  'v3-image-to-video': 'image-to-video',
  'o3-image-to-video': 'image-to-video',
  'v3-motion-control': 'video-to-video',
  'o3-video-to-video': 'video-to-video',
  'o3-reference-to-video': 'reference-to-video',
};

const LTX23_MODELS = {
  'text-to-video': [
    { id: 'ltx-2.3-pro-t2v', label: 'Pro' },
    { id: 'ltx-2.3-fast-t2v', label: 'Fast' },
  ],
  'image-to-video': [
    { id: 'ltx-2.3-pro-i2v', label: 'Pro' },
    { id: 'ltx-2.3-fast-i2v', label: 'Fast' },
  ],
  'video-to-video': [
    { id: 'ltx-2.3-retake-v2v', label: 'Retake' },
    { id: 'ltx-2.3-extend-v2v', label: 'Extend' },
  ],
  'audio-to-video': [
    { id: 'ltx-2.3-a2v', label: 'Audio' },
  ],
};

const LTX23_MODEL_TO_FAMILY = new Map(
  Object.entries(LTX23_MODELS).flatMap(([family, models]) => (models || []).map((model) => [model.id, family])),
);

function isKling3VideoKind(kind) {
  return String(kind || '').trim().startsWith('kling3-');
}

function getLtx23FamilyForModelId(modelId) {
  return modelId ? (LTX23_MODEL_TO_FAMILY.get(String(modelId).trim()) || null) : null;
}

function isLtx23VideoModelId(modelId) {
  return !!getLtx23FamilyForModelId(modelId);
}

function getSelectedLtx23ModelId(fallback = '') {
  if (fallback && isLtx23VideoModelId(fallback)) return fallback;
  const videoModelId = qs('videoModel') ? String(qs('videoModel').value || '').trim() : '';
  if (isLtx23VideoModelId(videoModelId)) return videoModelId;
  return '';
}

function getKling3TabForModelId(modelId) {
  return modelId ? (KLING3_MODEL_TO_TAB.get(String(modelId).trim()) || null) : null;
}

function isKling3VideoModelId(modelId) {
  return !!getKling3TabForModelId(modelId);
}

function getKling3FamilyForTab(tab) {
  return String(tab || '').startsWith('o3-') ? 'o3' : 'v3';
}

function getVideoTabForKling3Tab(tab) {
  return KLING3_TAB_TO_VIDEO_TAB[String(tab || '').trim()] || null;
}

function getSelectedKling3ModelId(fallback = '') {
  if (fallback && isKling3VideoModelId(fallback)) return fallback;
  const videoModelId = qs('videoModel') ? String(qs('videoModel').value || '').trim() : '';
  if (isKling3VideoModelId(videoModelId)) return videoModelId;
  const klingModelId = qs('kling3Model') ? String(qs('kling3Model').value || '').trim() : '';
  if (isKling3VideoModelId(klingModelId)) return klingModelId;
  return '';
}

function isKling3MotionModelId(modelId) {
  return KLING3_MOTION_MODEL_IDS.has(modelId);
}

function isKling3MotionOrientationVideo() {
  const orientation = qs('kling3MotionOrientation') ? qs('kling3MotionOrientation').value : 'video';
  return orientation === 'video';
}

let VIDEO_MODELS = [];
let VIDEO_MODEL_MAP = new Map();
let videoModelsLoaded = false;
let videoModelsPromise = null;

function qs(id) {
  return document.getElementById(id);
}

let viewportLockRaf = 0;

function syncViewportLock() {
  const viewport = window.visualViewport;
  const viewportHeight = Math.max(1, Math.round((viewport && Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : window.innerHeight) || window.innerHeight || 0));
  document.documentElement.style.setProperty('--app-vh', `${viewportHeight}px`);
  if (window.scrollX || window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }
}

function scheduleViewportLockSync() {
  if (viewportLockRaf) return;
  viewportLockRaf = requestAnimationFrame(() => {
    viewportLockRaf = 0;
    syncViewportLock();
  });
}

function getScrollableContainer(el) {
  let node = el ? el.parentElement : null;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (/(auto|scroll|overlay)/.test(style.overflowY || '') && node.scrollHeight > node.clientHeight + 4) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

function scrollElementWithinContainer(el, options = {}) {
  if (!el || typeof el.getBoundingClientRect !== 'function') return;
  const container = getScrollableContainer(el);
  if (!container) {
    scheduleViewportLockSync();
    return;
  }
  const { behavior = 'smooth', block = 'center' } = options;
  const containerRect = container.getBoundingClientRect();
  const targetRect = el.getBoundingClientRect();
  const targetTop = targetRect.top - containerRect.top + container.scrollTop;
  let nextTop = targetTop;

  if (block === 'center') {
    nextTop -= Math.max(0, (container.clientHeight - targetRect.height) / 2);
  } else if (block === 'nearest') {
    const currentTop = container.scrollTop;
    const currentBottom = currentTop + container.clientHeight;
    const targetBottom = targetTop + targetRect.height;
    if (targetTop < currentTop) {
      nextTop = targetTop - 12;
    } else if (targetBottom > currentBottom) {
      nextTop = targetBottom - container.clientHeight + 12;
    } else {
      scheduleViewportLockSync();
      return;
    }
  } else {
    nextTop -= 12;
  }

  container.scrollTo({ top: Math.max(0, nextTop), behavior });
  scheduleViewportLockSync();
}

window.addEventListener('resize', scheduleViewportLockSync, { passive: true });
window.addEventListener('orientationchange', scheduleViewportLockSync, { passive: true });
window.addEventListener('pageshow', scheduleViewportLockSync, { passive: true });
window.addEventListener('focus', scheduleViewportLockSync, true);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleViewportLockSync();
});
document.addEventListener('focusin', (e) => {
  const target = e.target;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName || '')) {
    setTimeout(scheduleViewportLockSync, 140);
  }
});
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', scheduleViewportLockSync, { passive: true });
  window.visualViewport.addEventListener('scroll', scheduleViewportLockSync, { passive: true });
}
scheduleViewportLockSync();

function getAccountBridge() {
  return window.NanoAccountBridge || null;
}

function queueAccountTextPresetSync() {
  if (isAccountSyncSuspended()) return;
  const bridge = getAccountBridge();
  if (bridge && typeof bridge.queueTextPresetSync === 'function') {
    bridge.queueTextPresetSync();
  }
}

function queueAccountDesignPresetSync() {
  if (isAccountSyncSuspended()) return;
  const bridge = getAccountBridge();
  if (bridge && typeof bridge.queueDesignPresetSync === 'function') {
    bridge.queueDesignPresetSync();
  }
}

function queueAccountHistoryPersist(items) {
  if (isAccountSyncSuspended()) return;
  const bridge = getAccountBridge();
  if (bridge && typeof bridge.queueHistoryPersist === 'function') {
    bridge.queueHistoryPersist(items);
  }
}

function queueAccountHistoryDelete(item) {
  if (isAccountSyncSuspended()) return;
  const bridge = getAccountBridge();
  if (bridge && typeof bridge.queueHistoryDelete === 'function') {
    bridge.queueHistoryDelete(item);
  }
}

// ---- Drag & Drop utility ----
function fileMatchesAccept(file, accept) {
  if (!accept) return true;
  const types = accept.split(',').map(t => t.trim().toLowerCase());
  const name = file.name.toLowerCase();
  const mime = (file.type || '').toLowerCase();
  for (const t of types) {
    if (t.startsWith('.') && name.endsWith(t)) return true;
    if (t.endsWith('/*') && mime.startsWith(t.slice(0, -1))) return true;
    if (mime === t) return true;
  }
  return false;
}

const INTERNAL_ASSET_MIME = 'application/x-nano-asset';

function getI18nText(key, fallback) {
  if (window.I18N && typeof window.I18N.t === 'function') {
    const translated = window.I18N.t(key);
    if (translated && translated !== key) return translated;
  }
  return fallback || key;
}

function hasTransferType(dt, type) {
  if (!dt || !dt.types) return false;
  return Array.from(dt.types).includes(type);
}

function isExternalFileTransfer(dt) {
  return hasTransferType(dt, 'Files');
}

function isInternalAssetTransfer(dt) {
  return hasTransferType(dt, INTERNAL_ASSET_MIME) || hasTransferType(dt, 'text/uri-list');
}

function canHandleDropTransfer(dt) {
  return isExternalFileTransfer(dt) || isInternalAssetTransfer(dt);
}

function isUploadSurface(target) {
  return !!(target && typeof target.closest === 'function' && target.closest('.upload-zone, .upload-area'));
}

function inferMimeTypeFromName(name, fallback = 'application/octet-stream') {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.mp4')) return 'video/mp4';
  if (lower.endsWith('.mov')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.m4a')) return 'audio/mp4';
  return fallback;
}

function deriveFilenameFromUrl(url, fallbackExt = 'bin') {
  try {
    const parsed = new URL(url, window.location.origin);
    const file = parsed.pathname.split('/').pop();
    if (file) return decodeURIComponent(file);
  } catch (_) {
    const clean = String(url || '').split('?')[0].split('#')[0];
    const file = clean.split('/').pop();
    if (file) return decodeURIComponent(file);
  }
  return `asset.${fallbackExt}`;
}

function readUriList(uriList) {
  const lines = String(uriList || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.find((line) => !line.startsWith('#')) || '';
}

function getInternalAssetPayload(dt, inputEl) {
  if (!dt) return null;
  let payload = null;
  if (hasTransferType(dt, INTERNAL_ASSET_MIME)) {
    try {
      payload = JSON.parse(dt.getData(INTERNAL_ASSET_MIME) || 'null');
    } catch (_) {
      payload = null;
    }
  }
  if (!payload || !payload.url) {
    const url = readUriList(dt.getData('text/uri-list'));
    if (url) payload = { url };
  }
  if (!payload || !payload.url) return null;

  const accept = String((inputEl && inputEl.accept) || '').toLowerCase();
  let inferredType = payload.type || '';
  if (!inferredType) {
    if (accept.includes('image/')) inferredType = 'image';
    else if (accept.includes('video/')) inferredType = 'video';
    else if (accept.includes('audio/')) inferredType = 'audio';
  }

  const fallbackExt = inferredType === 'image' ? 'png' : inferredType === 'video' ? 'mp4' : inferredType === 'audio' ? 'mp3' : 'bin';
  const filename = payload.filename || deriveFilenameFromUrl(payload.url, fallbackExt);
  const mimeHint = payload.mimeHint || inferMimeTypeFromName(filename, inferredType ? `${inferredType}/*` : 'application/octet-stream');

  return {
    ...payload,
    type: inferredType || payload.type || '',
    filename,
    mimeHint,
  };
}

function getDropRejectMessage(accept) {
  const normalized = String(accept || '').toLowerCase();
  if (normalized.includes('image/')) return getI18nText('drop_accept_images_only', 'This target accepts images only.');
  if (normalized.includes('video/')) return getI18nText('drop_accept_videos_only', 'This target accepts videos only.');
  if (normalized.includes('audio/')) return getI18nText('drop_accept_audio_only', 'This target accepts audio only.');
  return getI18nText('drop_accept_supported_files', 'This file type is not supported here.');
}

async function fetchUrlAsFile(url, payload = {}) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const blob = await resp.blob();
  const fallbackExt = payload.type === 'image' ? 'png' : payload.type === 'video' ? 'mp4' : payload.type === 'audio' ? 'mp3' : 'bin';
  const filename = payload.filename || deriveFilenameFromUrl(url, fallbackExt);
  return new File([blob], filename, { type: blob.type || payload.mimeHint || inferMimeTypeFromName(filename) });
}

function assignFilesToInput(inputEl, files, opts = {}) {
  const safeFiles = Array.from(files || []).filter(Boolean);
  if (!inputEl || safeFiles.length === 0) return;
  if (typeof inputEl._assignDroppedFiles === 'function') {
    inputEl._assignDroppedFiles(safeFiles, opts);
    return;
  }
  const dt = new DataTransfer();
  safeFiles.forEach((file) => dt.items.add(file));
  inputEl.files = dt.files;
  inputEl.dispatchEvent(new Event('change', { bubbles: true }));
}
function getUploadSurfaceForInput(inputEl, explicitZone) {
  if (explicitZone) return explicitZone;
  if (!inputEl || typeof inputEl.closest !== 'function') return null;
  return inputEl.closest('.upload-zone, .upload-area');
}

function ensureUploadSurfaceLoader(surfaceEl) {
  if (!surfaceEl) return null;
  let loader = surfaceEl.querySelector('.upload-surface-loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.className = 'upload-surface-loader';
    loader.setAttribute('aria-hidden', 'true');
    loader.innerHTML = '<div class="spinner upload-surface-spinner"></div>';
    surfaceEl.appendChild(loader);
  }
  return loader;
}

function setUploadSurfaceLoading(surfaceEl, loading) {
  if (!surfaceEl) return;
  ensureUploadSurfaceLoader(surfaceEl);
  surfaceEl.classList.toggle('upload-loading', !!loading);
  surfaceEl.setAttribute('aria-busy', loading ? 'true' : 'false');
}

function applyInternalAssetUrlToManagedInput(inputEl, payload) {
  if (!inputEl || !payload || !payload.url) return false;
  const config = inputEl._uploadConfig;
  if (!config || !config.kind || (config.kind !== 'image' && config.kind !== 'video')) return false;
  if (payload.type && config.kind && payload.type !== config.kind) return false;
  const remoteItem = createRemoteAssetItem(payload);
  if (!remoteItem) return false;
  const nextRemote = config.multiple
    ? [...getManagedUploadRemoteItems(config), remoteItem]
    : [remoteItem];
  if (!config.multiple) config.setFiles(null);
  setManagedUploadRemoteItems(config, nextRemote);
  refreshManagedUploadUi(inputEl);
  return true;
}

function applyInternalAssetUrlToImageCollectionInput(inputEl, payload) {
  if (!inputEl || !payload || payload.type !== 'image') return false;
  const remoteItem = createRemoteAssetItem(payload);
  if (!remoteItem) return false;

  if (inputEl.id === 'imageInput') {
    const max = editMaxImages();
    if (uploadedImageFiles.length >= max) {
      showToast(window.I18N ? I18N.t('wiz_max_images').replace('{n}', max) : `Maximum ${max} images allowed`, 'error');
      return true;
    }
    uploadedImageFiles = [...uploadedImageFiles, remoteItem].slice(0, max);
    updateImagePreview();
    return true;
  }

  if (inputEl.id === 'toolsImageInput') {
    const max = wizMaxImages();
    if (uploadedToolsImages.length >= max) {
      showToast(window.I18N ? I18N.t('wiz_max_images').replace('{n}', max) : `Maximum ${max} images`, 'error');
      return true;
    }
    uploadedToolsImages = [...uploadedToolsImages, remoteItem].slice(0, max);
    updateToolsImagePreview();
    saveAppState();
    return true;
  }

  return false;
}

async function applyInternalAssetPayloadToInput(inputEl, payload, options = {}) {
  if (!inputEl || !payload || !payload.url) return false;
  const accept = inputEl.accept || '';
  const append = !!options.append;
  const surfaceEl = getUploadSurfaceForInput(inputEl, options.zoneEl);
  const uploadConfig = inputEl._uploadConfig || null;
  const sameManagedKind = !!(
    uploadConfig
    && uploadConfig.kind
    && payload.type
    && uploadConfig.kind === payload.type
  );

  if (!sameManagedKind && !fileMatchesAccept({ name: payload.filename, type: payload.mimeHint }, accept)) {
    showToast(getDropRejectMessage(accept), 'error');
    return false;
  }

  setUploadSurfaceLoading(surfaceEl, true);
  try {
    if (applyInternalAssetUrlToManagedInput(inputEl, payload)) {
      return true;
    }
    if (applyInternalAssetUrlToImageCollectionInput(inputEl, payload)) {
      return true;
    }
    const fetchedFile = await fetchUrlAsFile(payload.url, payload);
    if (!fileMatchesAccept(fetchedFile, accept)) {
      showToast(getDropRejectMessage(accept), 'error');
      return false;
    }
    assignFilesToInput(inputEl, [fetchedFile], { append, reason: options.reason || 'drop' });
    return true;
  } catch (err) {
    console.error('Failed to fetch dragged asset', err);
    showToast(getI18nText('drop_fetch_asset_failed', 'Failed to load the dragged asset.'), 'error');
    return false;
  } finally {
    setUploadSurfaceLoading(surfaceEl, false);
  }
}
function setupDropZone(zoneEl, inputEl) {
  if (!zoneEl || !inputEl) return;
  if (zoneEl._dropZoneBoundFor === inputEl.id) return;
  zoneEl._dropZoneBoundFor = inputEl.id;
  zoneEl._dropInput = inputEl;

  const markActive = (e) => {
    if (!canHandleDropTransfer(e.dataTransfer)) return false;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    zoneEl.classList.add('drag-over');
    return true;
  };

  zoneEl.addEventListener('dragover', (e) => {
    markActive(e);
  });
  zoneEl.addEventListener('dragenter', (e) => {
    markActive(e);
  });
  zoneEl.addEventListener('dragleave', (e) => {
    if (!canHandleDropTransfer(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    if (!zoneEl.contains(e.relatedTarget)) {
      zoneEl.classList.remove('drag-over');
    }
  });
  zoneEl.addEventListener('drop', async (e) => {
    if (!canHandleDropTransfer(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    zoneEl.classList.remove('drag-over');

    const accept = inputEl.accept || '';
    let acceptedFiles = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter((file) => fileMatchesAccept(file, accept));

    if (acceptedFiles.length === 0 && isInternalAssetTransfer(e.dataTransfer)) {
      const payload = getInternalAssetPayload(e.dataTransfer, inputEl);
      if (!payload) return;
      await applyInternalAssetPayloadToInput(inputEl, payload, { append: !!inputEl.multiple, zoneEl, reason: 'drop' });
      return;
    }
    if (acceptedFiles.length === 0) {
      showToast(getDropRejectMessage(accept), 'error');
      return;
    }

    assignFilesToInput(inputEl, acceptedFiles, { append: !!inputEl.multiple, reason: 'drop' });
  });
}

// Prevent browser from opening files dropped outside upload zones
document.addEventListener('dragover', (e) => {
  if (isExternalFileTransfer(e.dataTransfer) && !isUploadSurface(e.target)) {
    e.preventDefault();
  }
});
document.addEventListener('drop', (e) => {
  if (isExternalFileTransfer(e.dataTransfer) && !isUploadSurface(e.target)) {
    e.preventDefault();
  }
  document.body.classList.remove('dragging-internal-asset');
});

// Force-download a cross-origin URL by fetching as blob
async function forceDownload(url, filename) {
  if (!url) return;
  try {
    showToast(window.I18N ? I18N.t('toast_preparing_download') : 'Preparing download…');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch (e) {
    console.error('Download failed, falling back to new tab:', e);
    window.open(url, '_blank');
  }
}

// ---- Use as Asset ----
const ASSET_TARGETS = {
  image: [
    { label: 'Edit → Source Image', i18nKey: 'asset_edit_source', mode: 'image', inputId: 'imageInput' },
    { label: 'Edit → Mask', i18nKey: 'asset_edit_mask', mode: 'image', inputId: 'maskInput' },
    { label: '3D Hunyuan → Front View', i18nKey: 'asset_3d_hunyuan_front', mode: '3d', inputId: 'threeDFrontInput', select3dModel: 'fal-ai/hunyuan3d-v3/image-to-3d' },
    { label: '3D Hunyuan → Back View', i18nKey: 'asset_3d_hunyuan_back', mode: '3d', inputId: 'threeDBackInput', select3dModel: 'fal-ai/hunyuan3d-v3/image-to-3d' },
    { label: '3D Hunyuan → Left View', i18nKey: 'asset_3d_hunyuan_left', mode: '3d', inputId: 'threeDLeftInput', select3dModel: 'fal-ai/hunyuan3d-v3/image-to-3d' },
    { label: '3D Hunyuan → Right View', i18nKey: 'asset_3d_hunyuan_right', mode: '3d', inputId: 'threeDRightInput', select3dModel: 'fal-ai/hunyuan3d-v3/image-to-3d' },
    { label: '3D Rapid → Front Image', i18nKey: 'asset_3d_rapid_front', mode: '3d', inputId: 'threeDFrontInput', select3dModel: 'fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d' },
    { label: '3D Meshy → Texture Image', i18nKey: 'asset_3d_meshy_texture', mode: '3d', inputId: 'threeDMeshyTextureImageInput', select3dModel: 'fal-ai/meshy/v6-preview/image-to-3d' },
    { label: '3D Retexture → Style Image', i18nKey: 'asset_3d_retexture_style', mode: '3d', inputId: 'threeDRetextureStyleImageInput', select3dModel: 'fal-ai/meshy/v5/retexture' },
    { label: 'Video → Image', i18nKey: 'asset_video_image', mode: 'video', inputId: 'videoImageInput', videoTab: 'image-to-video' },
    { label: 'Video → End Frame', i18nKey: 'asset_video_end_frame', mode: 'video', inputId: 'videoEndImageInput', videoTab: 'image-to-video' },
    { label: 'Kling3 → Start Image', i18nKey: 'asset_kling3_start', mode: 'video', inputId: 'kling3StartImageInput', videoTab: 'image-to-video', kling3Tab: 'image-to-video' },
    { label: 'Kling3 → End Image', i18nKey: 'asset_kling3_end', mode: 'video', inputId: 'kling3EndImageInput', videoTab: 'image-to-video', kling3Tab: 'image-to-video' },
  ],
  video: [
    { label: 'Video → Video Input', i18nKey: 'asset_video_input', mode: 'video', inputId: 'videoInput', videoTab: 'video-to-video' },
    { label: 'Kling3 → Video Input', i18nKey: 'asset_kling3_video', mode: 'video', inputId: 'kling3VideoInput', videoTab: 'video-to-video', kling3Tab: 'video-to-video' },
  ],
  '3d': [
    { label: '3D Topology → 3D File', i18nKey: 'asset_3d_topology', mode: '3d', inputId: 'threeDTopologyFileInput', select3dModel: 'fal-ai/hunyuan-3d/v3.1/smart-topology' },
    { label: '3D Retexture → 3D Model', i18nKey: 'asset_3d_retexture_model', mode: '3d', inputId: 'threeDRetextureModelInput', select3dModel: 'fal-ai/meshy/v5/retexture' },
  ],
};

function resolveAssetTargetVideoTab(target) {
  if (!target) return null;
  if (target.mode !== 'video') return target.videoTab || null;

  // The shared video image input is used by both image-to-video and audio-to-video.
  // When the user is already in audio-to-video, keep that workflow active instead of
  // forcing the generic image-to-video tab.
  if (target.inputId === 'videoImageInput') {
    const selectedModel = getSelectedVideoModel();
    const selectedKind = selectedModel && selectedModel.kind ? selectedModel.kind : currentVideoTab;
    if (selectedKind === 'audio-to-video' || currentVideoTab === 'audio-to-video') {
      return 'audio-to-video';
    }
  }

  return target.videoTab || null;
}

let _assetMenu = null;

function closeAssetMenu() {
  if (_assetMenu) { _assetMenu.remove(); _assetMenu = null; }
}
document.addEventListener('click', (e) => {
  if (_assetMenu && !_assetMenu.contains(e.target)) closeAssetMenu();
}, true);

function showAssetMenu(anchorEl, item) {
  closeAssetMenu();
  const targets = ASSET_TARGETS[item.type];
  if (!targets || targets.length === 0) { showToast(window.I18N ? I18N.t('toast_no_placement') : 'No available placements for this type', 'error'); return; }

  const menu = document.createElement('div');
  menu.className = 'asset-menu';
  targets.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'asset-menu-item';
    btn.textContent = (t.i18nKey && window.I18N) ? I18N.t(t.i18nKey) : t.label;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeAssetMenu();
      applyAsset(item, t);
    });
    menu.appendChild(btn);
  });

  document.body.appendChild(menu);
  _assetMenu = menu;

  // Position near anchor
  const rect = anchorEl.getBoundingClientRect();
  const mw = menu.offsetWidth || 200;
  const mh = menu.offsetHeight || 100;
  let top = rect.bottom + 4;
  let left = rect.left;
  if (left + mw > window.innerWidth) left = window.innerWidth - mw - 8;
  if (left < 4) left = 4;
  if (top + mh > window.innerHeight) top = rect.top - mh - 4;
  menu.style.top = top + 'px';
  menu.style.left = left + 'px';
}

async function applyAsset(item, target) {
  const url = item.type === '3d' ? (item.modelDownloadUrl || item.glbUrl) : item.url;
  if (!url) { showToast(window.I18N ? I18N.t('toast_no_url') : 'No URL available', 'error'); return; }

  showToast(window.I18N ? I18N.t('toast_setting_asset') : 'Setting asset…');

  // 1. Switch mode if needed
  if (target.mode && target.mode !== currentMode) {
    switchMode(target.mode);
  }

  // 2. Navigate to the correct sub-section within the mode
  if (target.select3dModel) {
    const sel = qs('threeDModel');
    if (sel && sel.value !== target.select3dModel) {
      sel.value = target.select3dModel;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
    update3dUiVisibility();
  }

  const targetVideoTab = resolveAssetTargetVideoTab(target);
  if (targetVideoTab) {
    ensureVideoControls();
    switchVideoTab(targetVideoTab);
  }

  if (target.kling3Tab) {
    // Determine the full tab name using the current kling3 family
    const family = currentKling3Family || 'v3';
    const suffix = target.kling3Tab; // e.g. 'image-to-video', 'video-to-video'
    // video-to-video and reference-to-video only exist in o3
    let fullTab;
    if (suffix === 'video-to-video' || suffix === 'reference-to-video') {
      fullTab = 'o3-' + suffix;
      if (currentKling3Family !== 'o3') switchKling3Family('o3');
    } else {
      fullTab = family + '-' + suffix;
    }
    switchKling3Tab(fullTab);
    updateKling3UiVisibility();
  }

  // Small delay to let UI update after section switches
  await new Promise(r => setTimeout(r, 150));

  try {
    const fallbackExt = item.type === 'video' ? 'mp4' : item.type === '3d' ? (item.modelFormat || 'glb') : 'png';
    const file = await fetchUrlAsFile(url, {
      type: item.type === '3d' ? 'file' : item.type,
      filename: deriveFilenameFromUrl(url, fallbackExt),
      mimeHint: item.type === 'video' ? 'video/mp4' : item.type === '3d' ? 'application/octet-stream' : 'image/png',
    });
    const inputEl = qs(target.inputId);
    if (!inputEl) { showToast(window.I18N ? I18N.t('toast_input_not_found') : 'Input not found - section may not be loaded', 'error'); return; }

    assignFilesToInput(inputEl, [file], { append: false, reason: 'asset' });

    // Close media modal if open so user can see the target section
    const modal = qs('mediaModal');
    if (modal && modal.style.display && modal.style.display !== 'none') {
      closeMediaModal();
    }

    // Scroll the target into view
    const scrollTarget = inputEl.closest('.upload-zone, .upload-item, .setting-group, .form-group');
    if (scrollTarget) {
      setTimeout(() => scrollElementWithinContainer(scrollTarget, { behavior: 'smooth', block: 'center' }), 100);
    }

    showToast(window.I18N ? I18N.t('toast_asset_applied') : 'Asset applied!');
  } catch (e) {
    console.error('Apply asset failed:', e);
    showToast((window.I18N ? I18N.t('toast_failed_asset') : 'Failed to set asset: ') + (e.message || e), 'error');
  }
}

const MANAGED_UPLOADS = {
  maskInput: { labelId: 'maskUploadLabel', emptyKey: 'upload_mask', previewKind: 'image', kind: 'image', multiple: false, getFiles: () => uploadedMaskFile ? [uploadedMaskFile] : [], setFiles: (next) => { uploadedMaskFile = next || null; } },
  videoInput: { labelId: 'videoFileLabel', emptyKey: 'upload_video', previewKind: 'video', kind: 'video', multiple: false, remoteUrlInputId: 'videoUrlInput', getFiles: () => uploadedVideoFile ? [uploadedVideoFile] : [], setFiles: (next) => { uploadedVideoFile = next || null; } },
  videoImageInput: { labelId: 'videoImageLabel', emptyKey: 'select_image', previewKind: 'image', kind: 'image', multiple: false, getFiles: () => uploadedVideoImageFile ? [uploadedVideoImageFile] : [], setFiles: (next) => { uploadedVideoImageFile = next || null; } },
  referenceImagesInput: { labelId: 'refImagesLabel', emptyKey: 'select_images', previewKind: 'image', kind: 'image', multiple: true, getFiles: () => uploadedReferenceImages, setFiles: (next) => { uploadedReferenceImages = next; } },
  videoEndImageInput: { labelId: 'endImageLabel', emptyKey: 'select_image', previewKind: 'image', kind: 'image', multiple: false, getFiles: () => uploadedEndImageFile ? [uploadedEndImageFile] : [], setFiles: (next) => { uploadedEndImageFile = next || null; } },
  audioInput: { labelId: 'audioFileLabel', emptyKey: 'select_audio', kind: 'audio', multiple: false, showFileName: true, getFiles: () => uploadedAudioFile ? [uploadedAudioFile] : [], setFiles: (next) => { uploadedAudioFile = next || null; } },
  kling3StartImageInput: { labelId: 'kling3StartImageLabel', emptyKey: 'select_image', previewKind: 'image', kind: 'image', multiple: false, getFiles: () => uploadedKling3StartImage ? [uploadedKling3StartImage] : [], setFiles: (next) => { uploadedKling3StartImage = next || null; } },
  kling3EndImageInput: { labelId: 'kling3EndImageLabel', emptyKey: 'select_image', previewKind: 'image', kind: 'image', multiple: false, getFiles: () => uploadedKling3EndImage ? [uploadedKling3EndImage] : [], setFiles: (next) => { uploadedKling3EndImage = next || null; } },
  kling3VideoInput: { labelId: 'kling3VideoLabel', emptyKey: 'upload_video', previewKind: 'video', kind: 'video', multiple: false, remoteUrlInputId: 'kling3VideoUrlInput', getFiles: () => uploadedKling3Video ? [uploadedKling3Video] : [], setFiles: (next) => { uploadedKling3Video = next || null; } },
  kling3RefImagesInput: { labelId: 'kling3RefImagesLabel', emptyKey: 'select_images', previewKind: 'image', kind: 'image', multiple: true, getFiles: () => uploadedKling3RefImages, setFiles: (next) => { uploadedKling3RefImages = next; } },
  threeDFrontInput: { labelId: 'threeDFrontLabel', emptyKey: 'upload_front', previewKind: 'image', kind: 'image', multiple: false, getFiles: () => uploaded3dFrontFile ? [uploaded3dFrontFile] : [], setFiles: (next) => { uploaded3dFrontFile = next || null; } },
  threeDBackInput: { labelId: 'threeDBackLabel', emptyKey: 'upload_front', previewKind: 'image', kind: 'image', multiple: false, getFiles: () => uploaded3dBackFile ? [uploaded3dBackFile] : [], setFiles: (next) => { uploaded3dBackFile = next || null; } },
  threeDLeftInput: { labelId: 'threeDLeftLabel', emptyKey: 'upload_front', previewKind: 'image', kind: 'image', multiple: false, getFiles: () => uploaded3dLeftFile ? [uploaded3dLeftFile] : [], setFiles: (next) => { uploaded3dLeftFile = next || null; } },
  threeDRightInput: { labelId: 'threeDRightLabel', emptyKey: 'upload_front', previewKind: 'image', kind: 'image', multiple: false, getFiles: () => uploaded3dRightFile ? [uploaded3dRightFile] : [], setFiles: (next) => { uploaded3dRightFile = next || null; } },
  threeDMeshyTextureImageInput: { labelId: 'threeDMeshyTextureImageLabel', emptyKey: 'upload_texture', previewKind: 'image', kind: 'image', multiple: false, getFiles: () => uploaded3dMeshyTextureImageFile ? [uploaded3dMeshyTextureImageFile] : [], setFiles: (next) => { uploaded3dMeshyTextureImageFile = next || null; } },
  threeDTopologyFileInput: { labelId: 'threeDTopologyFileLabel', emptyKey: 'upload_glb_obj', kind: 'file', multiple: false, showFileName: true, getFiles: () => uploaded3dTopologyFile ? [uploaded3dTopologyFile] : [], setFiles: (next) => { uploaded3dTopologyFile = next || null; } },
  threeDRetextureModelInput: { labelId: 'threeDRetextureModelLabel', emptyKey: 'upload_3d_model', kind: 'file', multiple: false, showFileName: true, getFiles: () => uploaded3dRetextureModelFile ? [uploaded3dRetextureModelFile] : [], setFiles: (next) => { uploaded3dRetextureModelFile = next || null; } },
  threeDRetextureStyleImageInput: { labelId: 'threeDRetextureStyleImageLabel', emptyKey: 'upload_style', previewKind: 'image', kind: 'image', multiple: false, getFiles: () => uploaded3dRetextureStyleImageFile ? [uploaded3dRetextureStyleImageFile] : [], setFiles: (next) => { uploaded3dRetextureStyleImageFile = next || null; } },
};

Object.entries(MANAGED_UPLOADS).forEach(([inputId, config]) => {
  if (!config.inputId) config.inputId = inputId;
  if (!config.stateKey) config.stateKey = inputId;
});

function toManagedFileArray(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter(Boolean);
}

function getManagedUploadFiles(config) {
  if (!config) return [];
  const files = toManagedFileArray(config.getFiles ? config.getFiles() : []);
  if (files.length > 0) return files;
  const inputEl = config.inputId ? qs(config.inputId) : null;
  if (inputEl && inputEl.files && inputEl.files.length) {
    return Array.from(inputEl.files).filter(Boolean);
  }
  return [];
}

function getManagedUploadPrimarySource(config, legacyFallback = null) {
  const remoteItems = getManagedUploadRemoteItems(config);
  if (remoteItems[0]) return remoteItems[0];
  const files = getManagedUploadFiles(config);
  if (files[0]) return files[0];
  return legacyFallback || null;
}

function getManagedUploadStateKey(config) {
  if (!config) return '';
  return config.stateKey || config.inputId || '';
}

function getManagedUploadRemoteItems(config) {
  if (!config) return [];
  if (typeof config.getRemoteItems === 'function') {
    return normalizeRemoteAssetItems(config.getRemoteItems(), config.kind || config.previewKind || 'image');
  }
  if (config.remoteUrlInputId) {
    const remoteUrl = getManagedUploadRemoteUrl(config);
    return remoteUrl ? normalizeRemoteAssetItems([remoteUrl], config.kind || config.previewKind || 'image') : [];
  }
  const key = getManagedUploadStateKey(config);
  return key ? normalizeRemoteAssetItems(managedUploadRemoteState[key], config.kind || config.previewKind || 'image') : [];
}

function setManagedUploadRemoteItems(config, value) {
  if (!config) return;
  const items = normalizeRemoteAssetItems(value, config.kind || config.previewKind || 'image');
  if (typeof config.setRemoteItems === 'function') {
    config.setRemoteItems(config.multiple ? items : (items[0] || null));
    return;
  }
  if (config.remoteUrlInputId) {
    setManagedUploadRemoteUrl(config, items[0] ? items[0].url : '');
    return;
  }
  const key = getManagedUploadStateKey(config);
  if (key) managedUploadRemoteState[key] = config.multiple ? items : (items[0] ? [items[0]] : []);
}

function getManagedUploadRemoteUrl(config) {
  if (!config || !config.remoteUrlInputId) return '';
  const remoteInput = qs(config.remoteUrlInputId);
  return remoteInput ? String(remoteInput.value || '').trim() : '';
}

function setManagedUploadRemoteUrl(config, value) {
  if (!config || !config.remoteUrlInputId) return;
  const remoteInput = qs(config.remoteUrlInputId);
  if (!remoteInput) return;
  remoteInput.value = value || '';
  remoteInput.dispatchEvent(new Event('input', { bubbles: true }));
  remoteInput.dispatchEvent(new Event('change', { bubbles: true }));
}

function getManagedUploadLabel(config, files) {
  if (!config) return '';
  const remoteItems = getManagedUploadRemoteItems(config);
  if (!files.length && remoteItems.length > 0) {
    const kind = config.kind || config.previewKind || 'file';
    const singleKey = config.selectedSingleKey || (kind === 'image' ? 'upload_selected_image' : kind === 'video' ? 'upload_selected_video' : kind === 'audio' ? 'upload_selected_audio' : 'upload_selected_file');
    return getI18nText(singleKey, 'Selected file');
  }
  const totalItems = files.length + remoteItems.length;
  if (totalItems === 0) return getI18nText(config.emptyKey, config.emptyFallback || '');
  const kind = config.kind || config.previewKind || 'file';
  if (config.multiple) {
    const multiKey = config.selectedMultiKey || (kind === 'image' ? 'upload_selected_images' : 'upload_selected_files');
    return getI18nText(multiKey, 'Selected items').replace('{n}', totalItems);
  }
  const singleKey = config.selectedSingleKey || (kind === 'image' ? 'upload_selected_image' : kind === 'video' ? 'upload_selected_video' : kind === 'audio' ? 'upload_selected_audio' : 'upload_selected_file');
  const prefix = getI18nText(singleKey, 'Selected file');
  const firstItem = remoteItems[0] || files[0];
  return config.showFileName ? `${prefix}: ${getAssetItemName(firstItem, 'file')}` : prefix;
}

function cleanupCompactPreviewHost(host) {
  if (!host) return;
  if (Array.isArray(host._blobUrls)) {
    host._blobUrls.forEach((url) => URL.revokeObjectURL(url));
  }
  host._blobUrls = [];
  host.innerHTML = '';
}

function ensureCompactPreviewHost(inputEl) {
  if (!inputEl) return null;
  if (inputEl._compactPreviewHost && inputEl._compactPreviewHost.isConnected) return inputEl._compactPreviewHost;
  const zone = inputEl.closest('.upload-zone, .upload-area');
  if (!zone || !zone.parentElement) return null;
  const selector = `.compact-upload-preview[data-input-id="${inputEl.id}"]`;
  let host = zone.parentElement.querySelector(selector);
  if (!host) {
    host = document.createElement('div');
    host.className = 'compact-upload-preview';
    host.dataset.inputId = inputEl.id;
    zone.insertAdjacentElement('afterend', host);
  }
  inputEl._compactPreviewHost = host;
  return host;
}

function detectPreviewKind(file, config) {
  if (config && config.previewKind) return config.previewKind;
  const type = String((file && file.type) || '').toLowerCase();
  if (type.startsWith('image/')) return 'image';
  if (type.startsWith('video/')) return 'video';
  return null;
}

function renderCompactPreviewForInput(inputEl, config) {
  if (!inputEl || !config) return;
  const host = ensureCompactPreviewHost(inputEl);
  if (!host) return;
  cleanupCompactPreviewHost(host);

  const files = getManagedUploadFiles(config);
  const remoteItems = getManagedUploadRemoteItems(config);
  if (!files.length && !remoteItems.length) {
    host.style.display = 'none';
    return;
  }

  const previewable = files.some((file) => !!detectPreviewKind(file, config))
    || remoteItems.some((item) => {
      const assetType = item && item.assetType ? item.assetType : (config.previewKind || config.kind || '');
      return assetType === 'image' || assetType === 'video';
    });
  if (!previewable) {
    host.style.display = 'none';
    return;
  }

  host.style.display = 'flex';
  const grid = document.createElement('div');
  grid.className = 'compact-upload-preview-grid';

  const entries = [
    ...remoteItems.map((item, index) => ({
      file: item,
      index,
      kind: item && item.assetType ? item.assetType : config.previewKind,
      isRemote: true,
      src: item.url,
    })),
    ...files.map((file, index) => ({
      file,
      index: remoteItems.length + index,
      kind: detectPreviewKind(file, config),
      isRemote: false,
      src: '',
    })),
  ];

  entries.forEach((entry) => {
    const { file, index, kind, isRemote, src } = entry;
    if (!kind) return;

    const tile = document.createElement('div');
    tile.className = 'compact-upload-preview-item';
    tile.title = isRemote ? src : file.name;

    const previewSrc = isRemote ? src : URL.createObjectURL(file);
    if (!isRemote) host._blobUrls.push(previewSrc);

    if (kind === 'video') {
      const video = document.createElement('video');
      video.src = previewSrc;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.addEventListener('loadeddata', () => {
        try { video.currentTime = Math.min(0.15, video.duration || 0); } catch (_) {}
        video.play().catch(() => {});
      }, { once: true });
      tile.appendChild(video);
    } else {
      const img = document.createElement('img');
      img.src = previewSrc;
      img.alt = isRemote ? getAssetItemName(file, config.kind || 'asset') : file.name;
      tile.appendChild(img);
    }

    if (config.multiple) {
      const badge = document.createElement('span');
      badge.className = 'img-num-badge';
      badge.textContent = index + 1;
      tile.appendChild(badge);
    }

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'compact-upload-preview-remove';
    removeBtn.setAttribute('aria-label', getI18nText('btn_remove', 'Remove'));
    removeBtn.title = getI18nText('btn_remove', 'Remove');
    removeBtn.textContent = 'x';
    removeBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (isRemote) {
        const nextRemote = config.multiple
          ? getManagedUploadRemoteItems(config).filter((_, remoteIndex) => remoteIndex !== index)
          : [];
        setManagedUploadRemoteItems(config, nextRemote);
        if (!config.multiple) config.setFiles(null);
        refreshManagedUploadUi(inputEl);
        return;
      }
      const nextFiles = config.multiple ? files.filter((_, fileIndex) => fileIndex !== index) : [];
      if (typeof inputEl._assignDroppedFiles === 'function') {
        inputEl._assignDroppedFiles(nextFiles, { append: false, reason: 'remove' });
      }
    });
    tile.appendChild(removeBtn);
    grid.appendChild(tile);
  });

  if (!grid.children.length) {
    host.style.display = 'none';
    return;
  }

  host.appendChild(grid);
}

function refreshManagedUploadUi(inputEl) {
  if (!inputEl || !inputEl._uploadConfig) return;
  const config = inputEl._uploadConfig;
  const files = getManagedUploadFiles(config);
  const labelEl = config.labelId ? qs(config.labelId) : null;
  if (labelEl) labelEl.textContent = getManagedUploadLabel(config, files);
  renderCompactPreviewForInput(inputEl, config);
}

function bindManagedUploadInput(inputEl, config) {
  if (!inputEl || !config) return;
  inputEl._uploadConfig = { ...config, inputId: config.inputId || inputEl.id, stateKey: config.stateKey || inputEl.id };
  inputEl._assignDroppedFiles = (files, opts = {}) => {
    const runtimeConfig = inputEl._uploadConfig;
    const incoming = Array.from(files || []).filter(Boolean);
    const nextFiles = runtimeConfig.multiple && opts.append ? [...getManagedUploadFiles(runtimeConfig), ...incoming] : incoming;
    if (incoming.length && (!opts.append || !runtimeConfig.multiple)) {
      setManagedUploadRemoteItems(runtimeConfig, runtimeConfig.multiple && opts.append ? getManagedUploadRemoteItems(runtimeConfig) : []);
    }
    if (runtimeConfig.multiple) runtimeConfig.setFiles(nextFiles);
    else runtimeConfig.setFiles(nextFiles[0] || null);
    refreshManagedUploadUi(inputEl);
  };
  if (!inputEl._managedUploadBound) {
    inputEl._managedUploadBound = true;
    inputEl.addEventListener('change', (event) => {
      inputEl._assignDroppedFiles(Array.from(event.target.files || []), { append: false, reason: 'picker' });
      event.target.value = '';
    });
  }
  if (inputEl._uploadConfig.remoteUrlInputId && !inputEl._managedUploadRemoteBound) {
    inputEl._managedUploadRemoteBound = true;
    const remoteInput = qs(inputEl._uploadConfig.remoteUrlInputId);
    if (remoteInput) {
      const syncRemotePreview = () => refreshManagedUploadUi(inputEl);
      remoteInput.addEventListener('input', syncRemotePreview);
      remoteInput.addEventListener('change', syncRemotePreview);
    }
  }
  refreshManagedUploadUi(inputEl);
}

function bindManagedUploadById(inputId) {
  const inputEl = qs(inputId);
  const config = MANAGED_UPLOADS[inputId];
  if (inputEl && config) bindManagedUploadInput(inputEl, config);
}

function refreshAllManagedUploads() {
  Object.keys(MANAGED_UPLOADS).forEach((inputId) => {
    const inputEl = qs(inputId);
    if (inputEl && inputEl._uploadConfig) refreshManagedUploadUi(inputEl);
  });
}

function createInternalAssetPayload(item) {
  if (!item || (item.type !== 'image' && item.type !== 'video')) return null;
  const meta = item && item.meta && typeof item.meta === 'object' ? item.meta : null;
  const resolvedUrl = item.type === 'video'
    ? (meta && (meta.originalDownloadUrl || meta.originalUrl)) || item.modelDownloadUrl || item.url || ''
    : (meta && (meta.originalUrl || meta.originalDownloadUrl)) || item.url || item.thumbnailUrl || '';
  if (!resolvedUrl) return null;
  const fallbackExt = item.type === 'video' ? 'mp4' : 'png';
  const filename = deriveFilenameFromUrl(resolvedUrl, fallbackExt);
  return {
    type: item.type,
    url: resolvedUrl,
    filename,
    mimeHint: inferMimeTypeFromName(filename, item.type === 'video' ? 'video/mp4' : 'image/png'),
  };
}

let activeTouchAssetDrag = null;
const TOUCH_ASSET_DRAG_HOLD_MS = 220;
const TOUCH_ASSET_DRAG_MOVE_SLOP_PX = 12;
let touchAssetDragCleanupSuspendUntil = 0;

function suspendTouchAssetDragCleanup(ms = 420) {
  touchAssetDragCleanupSuspendUntil = Date.now() + Math.max(0, ms);
}

function removeTouchAssetGhosts() {
  document.querySelectorAll('.touch-drag-ghost').forEach((ghost) => ghost.remove());
}

function clearTouchAssetHoverZone() {
  if (activeTouchAssetDrag && activeTouchAssetDrag.hoverZone) {
    activeTouchAssetDrag.hoverZone.classList.remove('drag-over');
    activeTouchAssetDrag.hoverZone = null;
  }
}

function flushTouchAssetDragPosition(clientX, clientY) {
  if (!activeTouchAssetDrag) return;
  positionTouchAssetGhost(clientX, clientY);
  const lastHoverX = Number.isFinite(activeTouchAssetDrag.hoverX) ? activeTouchAssetDrag.hoverX : null;
  const lastHoverY = Number.isFinite(activeTouchAssetDrag.hoverY) ? activeTouchAssetDrag.hoverY : null;
  if (
    lastHoverX === null
    || lastHoverY === null
    || Math.abs(clientX - lastHoverX) >= 8
    || Math.abs(clientY - lastHoverY) >= 8
  ) {
    activeTouchAssetDrag.hoverX = clientX;
    activeTouchAssetDrag.hoverY = clientY;
    updateTouchAssetHoverZone(clientX, clientY);
  }
}

function scheduleTouchAssetDragPosition(clientX, clientY) {
  if (!activeTouchAssetDrag) return;
  activeTouchAssetDrag.pendingX = clientX;
  activeTouchAssetDrag.pendingY = clientY;
  if (activeTouchAssetDrag.moveRaf) return;
  activeTouchAssetDrag.moveRaf = requestAnimationFrame(() => {
    if (!activeTouchAssetDrag) return;
    activeTouchAssetDrag.moveRaf = 0;
    flushTouchAssetDragPosition(activeTouchAssetDrag.pendingX, activeTouchAssetDrag.pendingY);
  });
}

function cleanupTouchAssetDrag() {
  const dragState = activeTouchAssetDrag;
  clearTouchAssetHoverZone();
  if (dragState && dragState.moveRaf) {
    cancelAnimationFrame(dragState.moveRaf);
    dragState.moveRaf = 0;
  }
  if (activeTouchAssetDrag && activeTouchAssetDrag.ghost && activeTouchAssetDrag.ghost.parentNode) {
    activeTouchAssetDrag.ghost.parentNode.removeChild(activeTouchAssetDrag.ghost);
  }
  activeTouchAssetDrag = null;
  removeTouchAssetGhosts();
  document.body.classList.remove('dragging-internal-asset', 'dragging-internal-asset-touch');
  if (dragState && dragState.deferHistoryDrawerClose) {
    closeHistoryDrawer();
  }
}

function getUploadSurfaceAtPoint(clientX, clientY) {
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
  const hit = document.elementFromPoint(clientX, clientY);
  if (!hit || typeof hit.closest !== 'function') return null;
  const surface = hit.closest('.upload-zone, .upload-area');
  return surface && surface._dropInput ? surface : null;
}

function updateTouchAssetHoverZone(clientX, clientY) {
  if (!activeTouchAssetDrag) return null;
  const nextZone = getUploadSurfaceAtPoint(clientX, clientY);
  if (activeTouchAssetDrag.hoverZone === nextZone) return nextZone;
  clearTouchAssetHoverZone();
  if (nextZone) {
    nextZone.classList.add('drag-over');
    activeTouchAssetDrag.hoverZone = nextZone;
  }
  return nextZone;
}

function createTouchAssetGhost(payload) {
  removeTouchAssetGhosts();
  const ghost = document.createElement('div');
  ghost.className = 'touch-drag-ghost';
  ghost.dataset.assetType = payload.type || 'image';
  ghost.innerHTML = `<span>${payload.type === 'video' ? 'VIDEO' : 'IMAGE'}</span>`;
  document.body.appendChild(ghost);
  return ghost;
}

function positionTouchAssetGhost(clientX, clientY) {
  if (!activeTouchAssetDrag || !activeTouchAssetDrag.ghost) return;
  activeTouchAssetDrag.ghost.style.transform = `translate3d(${clientX}px, ${clientY}px, 0) translate(-50%, -50%)`;
}

function finishTouchAssetDrag(clientX, clientY) {
  if (!activeTouchAssetDrag) return;
  const dragState = activeTouchAssetDrag;
  const zoneEl = updateTouchAssetHoverZone(clientX, clientY) || dragState.hoverZone;
  cleanupTouchAssetDrag();

  if (zoneEl && zoneEl._dropInput && dragState.payload) {
    void applyInternalAssetPayloadToInput(zoneEl._dropInput, dragState.payload, {
      append: !!zoneEl._dropInput.multiple,
      zoneEl,
      reason: 'touch-drop',
    });
  }
}

function setInternalAssetData(dt, payload) {
  if (!dt || !payload || !payload.url) return;
  dt.effectAllowed = 'copy';
  dt.setData(INTERNAL_ASSET_MIME, JSON.stringify(payload));
  dt.setData('text/uri-list', payload.url);
  dt.setData('text/plain', payload.url);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) cleanupTouchAssetDrag();
}, true);
['pagehide', 'blur'].forEach((eventName) => {
  window.addEventListener(eventName, () => {
    cleanupTouchAssetDrag();
  }, true);
});
document.addEventListener('scroll', () => {
  if (activeTouchAssetDrag) {
    if (activeTouchAssetDrag.ignoreScrollCleanup || Date.now() < touchAssetDragCleanupSuspendUntil) return;
    cleanupTouchAssetDrag();
  }
}, true);
document.addEventListener('pointerdown', () => {
  if (activeTouchAssetDrag) cleanupTouchAssetDrag();
}, true);

function bindAssetDragSource(el, item, options = {}) {
  if (!el) return;
  const payload = createInternalAssetPayload(item);
  if (el._touchAssetStartHandler) {
    el.removeEventListener('touchstart', el._touchAssetStartHandler, true);
    el._touchAssetStartHandler = null;
  }
  if (el._touchAssetContextMenuHandler) {
    el.removeEventListener('contextmenu', el._touchAssetContextMenuHandler, true);
    el._touchAssetContextMenuHandler = null;
  }
  if (!payload) {
    el.draggable = false;
    el.classList.remove('draggable-asset');
    el.classList.remove('drag-source-touch');
    el.removeAttribute('data-drag-hint');
    el.removeAttribute('title');
    el.ondragstart = null;
    el.ondragend = null;
    return;
  }
  const touchSource = isPrimaryCoarsePointer();
  const useNativeDrag = !touchSource;
  el.draggable = useNativeDrag;
  el.classList.add('draggable-asset');
  el.classList.toggle('drag-source-touch', touchSource);
  if (options.badge !== false) {
    el.setAttribute('data-drag-hint', getI18nText('drag_asset_badge', 'Drag'));
  }
  el.title = getI18nText('drag_asset_hint', 'Drag into an upload area');
  const handleDragStartSideEffects = () => {
    if (typeof options.onDragStart === 'function') {
      options.onDragStart();
    }
  };
  const handleTouchDragStartSideEffects = () => {
    if (typeof options.onTouchDragStart === 'function') {
      options.onTouchDragStart();
      return;
    }
    handleDragStartSideEffects();
  };
  el.ondragstart = useNativeDrag ? (event) => {
    if (!event.dataTransfer) return;
    setInternalAssetData(event.dataTransfer, payload);
    document.body.classList.add('dragging-internal-asset');
    setTimeout(handleDragStartSideEffects, 0);
  } : null;
  el.ondragend = useNativeDrag ? (() => {
    document.body.classList.remove('dragging-internal-asset');
    if (typeof options.onDragEnd === 'function') {
      options.onDragEnd();
    }
  }) : null;
  if (touchSource) {
    const handleContextMenu = (event) => {
      event.preventDefault();
    };
    el._touchAssetContextMenuHandler = handleContextMenu;
    el.addEventListener('contextmenu', handleContextMenu, true);
  }
  const onTouchStart = (startEvent) => {
    if (!startEvent.touches || startEvent.touches.length !== 1) return;
    const startTouch = startEvent.touches[0];
    const startX = startTouch.clientX;
    const startY = startTouch.clientY;
    let activated = false;
    let pressTimer = null;
    let latestX = startX;
    let latestY = startY;

    const clearPressTimer = () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    };

    const teardown = () => {
      clearPressTimer();
      document.removeEventListener('touchmove', handleMove);
      document.removeEventListener('touchend', handleEnd);
      document.removeEventListener('touchcancel', handleCancel);
    };

    const activateTouchDrag = () => {
      if (activated) return;
      activated = true;
      cleanupTouchAssetDrag();
      activeTouchAssetDrag = {
        payload,
        sourceEl: el,
        hoverZone: null,
        ghost: createTouchAssetGhost(payload),
        moveRaf: 0,
        pendingX: latestX,
        pendingY: latestY,
        ignoreScrollCleanup: true,
      };
      document.body.classList.add('dragging-internal-asset', 'dragging-internal-asset-touch');
      flushTouchAssetDragPosition(latestX, latestY);
      handleTouchDragStartSideEffects();
      if (navigator.vibrate) navigator.vibrate(10);
    };

    const handleMove = (moveEvent) => {
      const touch = moveEvent.touches && moveEvent.touches[0];
      if (!touch) return;
      latestX = touch.clientX;
      latestY = touch.clientY;
      const distance = Math.hypot(latestX - startX, latestY - startY);

      if (!activated) {
        if (distance > TOUCH_ASSET_DRAG_MOVE_SLOP_PX) {
          teardown();
          cleanupTouchAssetDrag();
        }
        return;
      }

      moveEvent.preventDefault();
      scheduleTouchAssetDragPosition(latestX, latestY);
    };

    const handleEnd = (endEvent) => {
      teardown();
      if (!activated) return;
      const touch = (endEvent.changedTouches && endEvent.changedTouches[0]) || startTouch;
      endEvent.preventDefault();
      finishTouchAssetDrag(touch.clientX, touch.clientY);
    };

    const handleCancel = () => {
      teardown();
      if (activated) cleanupTouchAssetDrag();
    };

    pressTimer = setTimeout(activateTouchDrag, touchSource ? 180 : TOUCH_ASSET_DRAG_HOLD_MS);
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd, { passive: false });
    document.addEventListener('touchcancel', handleCancel, { passive: false });
  };
  el._touchAssetStartHandler = onTouchStart;
  el.addEventListener('touchstart', onTouchStart, { passive: false, capture: true });
}
async function reuseFromHistory(index) {
  const item = history[index];
  if (!item) return;

  const ctx = item.genCtx;

  // If no saved context, just restore the prompt
  if (!ctx) {
    if (item.prompt) {
      const pi = qs('promptInput');
      if (pi) { pi.value = item.prompt; pi.dispatchEvent(new Event('input', { bubbles: true })); }
    }
    showToast(window.I18N ? I18N.t('toast_prompt_restored_no_settings') : 'Prompt restored (no saved settings for this item)');
    return;
  }

  // 1. Switch to the correct mode
  const normalizedMode = ctx.mode === 'kling3' ? 'video' : ctx.mode;
  if (normalizedMode) switchMode(normalizedMode);

  // 2. Restore all select values
  if (ctx.selects) {
    for (const [id, val] of Object.entries(ctx.selects)) {
      const el = qs(id);
      if (el) {
        el.value = val;
        if (!el.value && el.options && el.options.length > 0) el.value = el.options[0].value;
      }
    }
  }

  // 3. Restore all input values
  if (ctx.inputs) {
    for (const [id, val] of Object.entries(ctx.inputs)) {
      const el = qs(id);
      if (el) el.value = val || '';
    }
  }

  // 4. Restore prompt
  const pi = qs('promptInput');
  if (pi) {
    pi.value = ctx.prompt || item.prompt || '';
    pi.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // 5. Navigate to the correct sub-section
  if (normalizedMode === '3d') {
    update3dUiVisibility();
  }
  if (normalizedMode === 'video') {
    await ensureVideoModelsReady();
    const desiredVideoTab = ctx.videoTab || getVideoTabForKling3Tab(ctx.kling3Tab);
    if (desiredVideoTab) switchVideoTab(desiredVideoTab);

    const desiredVideoModelId = ctx.selects && (ctx.selects.videoModel || ctx.selects.kling3Model)
      ? String(ctx.selects.videoModel || ctx.selects.kling3Model)
      : '';

    if (desiredVideoModelId && qs('videoModel')) {
      refreshVideoModelDropdown(desiredVideoModelId);
      const videoSelect = qs('videoModel');
      if (videoSelect && Array.from(videoSelect.options || []).some((opt) => opt.value === desiredVideoModelId)) {
        videoSelect.value = desiredVideoModelId;
      }
      if (isKling3VideoModelId(desiredVideoModelId)) {
        syncKling3StateFromVideoModelId(desiredVideoModelId, { skipSave: true });
      }
    } else if (ctx.kling3Tab) {
      switchKling3Tab(ctx.kling3Tab, { skipSave: true });
    }

    updateVideoUiVisibility();
    renderVideoOptionsUI();
  }

  // 6. Save restored state
  if (typeof saveAppState === 'function') saveAppState();

  // 7. Scroll to the prompt input
  setTimeout(() => {
    const promptArea = qs('promptInput');
    if (promptArea) scrollElementWithinContainer(promptArea, { behavior: 'smooth', block: 'center' });
  }, 150);

  showToast(window.I18N ? I18N.t('toast_settings_restored') : 'Settings restored! Ready to generate.');
}
window.reuseFromHistory = reuseFromHistory;

function reuseCurrentPreview() {
  if (!currentPreview) { showToast(window.I18N ? I18N.t('toast_no_preview') : 'No preview to reuse', 'error'); return; }
  const idx = history.findIndex(h => h && h.timestamp === currentPreview.timestamp && h.url === currentPreview.url);
  if (idx >= 0) {
    closeMediaModal();
    reuseFromHistory(idx);
  } else if (currentPreview.genCtx) {
    closeMediaModal();
    // Directly reuse from the preview object
    const fakeIdx = history.length;
    history.push(currentPreview);
    reuseFromHistory(fakeIdx);
    history.pop();
  } else if (currentPreview.prompt) {
    closeMediaModal();
    const pi = qs('promptInput');
    if (pi) { pi.value = currentPreview.prompt; pi.dispatchEvent(new Event('input', { bubbles: true })); }
    showToast(window.I18N ? I18N.t('toast_prompt_restored') : 'Prompt restored');
  } else {
    showToast(window.I18N ? I18N.t('toast_no_settings') : 'No saved settings for this item', 'error');
  }
}
window.reuseCurrentPreview = reuseCurrentPreview;

function useCurrentPreviewAsAsset(anchorEl) {
  if (!currentPreview) { showToast(window.I18N ? I18N.t('toast_no_preview_use') : 'No preview to use', 'error'); return; }
  showAssetMenu(anchorEl, currentPreview);
}
window.useCurrentPreviewAsAsset = useCurrentPreviewAsAsset;

function useHistoryAsAsset(index, anchorEl) {
  const item = history[index];
  if (!item) return;
  showAssetMenu(anchorEl, item);
}
window.useHistoryAsAsset = useHistoryAsAsset;

async function editCurrentImage() {
  if (!currentPreview || (currentPreview.type && currentPreview.type !== 'image')) {
    showToast(window.I18N ? I18N.t('toast_no_preview_use') : 'No image to edit', 'error');
    return;
  }
  const url = currentPreview.url;
  if (!url) return;

  // 1. Switch to Edit tab
  switchMode('image');

  // 2. Set model to Nano Banana 2 edit
  const modelSel = qs('imageModelEdit');
  if (modelSel) {
    modelSel.value = 'nano-banana-2/edit';
    modelSel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // 3. Wait for DOM to settle
  await new Promise(r => setTimeout(r, 180));

  // 4. Apply preset settings: 4K, web search on, google search on
  const resSel = qs('editNano2Resolution');
  if (resSel) resSel.value = '4K';
  const webSel = qs('editNano2WebSearch');
  if (webSel) webSel.value = 'true';
  const googleSel = qs('editNano2GoogleSearch');
  if (googleSel) googleSel.value = 'true';

  // 5. Fetch image and inject into imageInput
  try {
    showToast(window.I18N ? I18N.t('toast_setting_asset') : 'Setting image…');
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();
    let filename = 'edit-source.png';
    try { filename = new URL(url).pathname.split('/').pop() || filename; } catch(_) {}
    const file = new File([blob], filename, { type: blob.type || 'image/png' });

    const inputEl = qs('imageInput');
    if (!inputEl) { showToast(window.I18N ? I18N.t('toast_input_not_found') : 'Input not found', 'error'); return; }
    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));

    // Scroll controls panel to top so settings are visible
    setTimeout(() => {
      const panel = document.querySelector('.controls-scroll');
      if (panel) panel.scrollTo({ top: 0, behavior: 'smooth' });
    }, 200);

    showToast(window.I18N ? I18N.t('toast_asset_applied') : 'Ready to edit!');
  } catch (e) {
    console.error('editCurrentImage failed:', e);
    showToast((window.I18N ? I18N.t('toast_failed_asset') : 'Failed: ') + (e.message || e), 'error');
  }
}
window.editCurrentImage = editCurrentImage;

function showToast(message, kind = 'info') {
  const toast = qs('statusToast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = 'block';
  toast.style.opacity = '1';

  toast.style.borderColor = kind === 'error' ? '#d33' : 'rgba(255,255,255,0.12)';

  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.style.display = 'none';
    }, 200);
  }, 2800);
}

// Toggle history / news drawers
let _historyRendered = false;

function closeHistoryDrawer() {
  const drawer = qs('historyDrawer');
  const overlay = qs('drawerOverlay');
  if (drawer) drawer.classList.remove('drag-hidden');
  if (overlay) overlay.classList.remove('drag-hidden');
  if (drawer) drawer.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}

function closeHistoryDrawerDuringTouchDrag() {
  suspendTouchAssetDragCleanup(420);
  const drawer = qs('historyDrawer');
  const overlay = qs('drawerOverlay');
  if (activeTouchAssetDrag) {
    activeTouchAssetDrag.deferHistoryDrawerClose = true;
  }
  if (drawer) drawer.classList.add('drag-hidden');
  if (overlay) overlay.classList.add('drag-hidden');
}

function closeHistoryDrawerDuringNativeDrag() {
  const drawer = qs('historyDrawer');
  const overlay = qs('drawerOverlay');
  if (drawer) drawer.classList.add('drag-hidden');
  if (overlay) overlay.classList.add('drag-hidden');
}

function finalizeHistoryDrawerAfterNativeDrag() {
  closeHistoryDrawer();
}

function closeNewsDrawer() {
  const drawer = qs('newsDrawer');
  const overlay = qs('newsOverlay');
  if (drawer) drawer.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}

function toggleHistory() {
  const drawer = qs('historyDrawer');
  const overlay = qs('drawerOverlay');
  if (!drawer) return;

  const opening = !drawer.classList.contains('open');
  if (opening) closeNewsDrawer();

  drawer.classList.toggle('open', opening);
  if (overlay) overlay.classList.toggle('open', opening);

  // Lazy render: build history DOM only when first opened, deferred so animation is not blocked
  if (opening && !_historyRendered) {
    _historyRendered = true;
    requestAnimationFrame(() => updateHistoryUI());
  }
}
window.toggleHistory = toggleHistory;

function toggleProfileMenu() {
  const dropdown = document.getElementById('profileDropdown');
  const btn = document.getElementById('profileBtn');
  if (!dropdown || !btn) return;
  const isOpen = dropdown.classList.contains('open');
  if (isOpen) {
    dropdown.classList.remove('open');
    btn.classList.remove('active');
  } else {
    dropdown.classList.add('open');
    btn.classList.add('active');
  }
}
window.toggleProfileMenu = toggleProfileMenu;

// Close profile dropdown when clicking outside
document.addEventListener('click', function(e) {
  const wrap = document.querySelector('.profile-menu-wrap');
  if (wrap && !wrap.contains(e.target)) {
    const dropdown = document.getElementById('profileDropdown');
    const btn = document.getElementById('profileBtn');
    if (dropdown) dropdown.classList.remove('open');
    if (btn) btn.classList.remove('active');
  }
});

function parseNewsTimestamp(value) {
  if (!value) return NaN;
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  const ts = Date.parse(String(value));
  return Number.isFinite(ts) ? ts : NaN;
}

function getVideoTabForModelKind(kind) {
  const k = String(kind || '').trim();
  if (!k) return null;
  if (k === 'kling3-text-to-video') return 'text-to-video';
  if (k === 'kling3-image-to-video') return 'image-to-video';
  if (k === 'kling3-reference-to-video') return 'reference-to-video';
  if (k === 'kling3-video-to-video' || k === 'kling3-motion-control') return 'video-to-video';
  if (k === 'text-to-video') return 'text-to-video';
  if (k === 'image-to-video') return 'image-to-video';
  if (k === 'audio-to-video') return 'audio-to-video';
  if (k === 'reference-to-video') return 'reference-to-video';
  if (k === 'video-to-video' || k === 'motion-control' || k === 'video-id-to-video') return 'video-to-video';
  return null;
}

function collectModelNewsEntries() {
  const map = new Map();

  function pushEntry(model, meta) {
    if (!model || !model.id) return;
    const addedAt = parseNewsTimestamp(model.addedAt);
    if (!Number.isFinite(addedAt)) return;

    const mode = meta && meta.mode ? meta.mode : '';
    const key = `${mode}:${model.id}`;
    const next = {
      id: model.id,
      label: model.label || model.id,
      addedAt,
      mode,
      selectId: meta && meta.selectId ? meta.selectId : null,
      videoTab: meta && meta.videoTab ? meta.videoTab : null,
      kling3Tab: meta && meta.kling3Tab ? meta.kling3Tab : null,
      kling3Family: meta && meta.kling3Family ? meta.kling3Family : null,
      newsDescription: model.newsDescription || '',
      newsDescriptionKey: model.newsDescriptionKey || null,
    };

    const prev = map.get(key);
    if (!prev || next.addedAt >= prev.addedAt) {
      map.set(key, next);
    }
  }

  for (const m of IMAGE_MODELS_TEXT) {
    pushEntry(m, { mode: 'text', selectId: 'imageModelText' });
  }
  for (const m of IMAGE_MODELS_EDIT) {
    pushEntry(m, { mode: 'image', selectId: 'imageModelEdit' });
  }
  for (const m of THREE_D_MODELS) {
    pushEntry(m, { mode: '3d', selectId: 'threeDModel' });
  }

  for (const [tab, models] of Object.entries(KLING3_MODELS)) {
    const videoTab = getVideoTabForKling3Tab(tab);
    if (!videoTab) continue;
    for (const m of models || []) {
      pushEntry(m, {
        mode: 'video',
        selectId: 'videoModel',
        videoTab,
        kling3Tab: tab,
        kling3Family: getKling3FamilyForTab(tab),
      });
    }
  }

  for (const m of VIDEO_MODELS) {
    const videoTab = getVideoTabForModelKind(m.kind);
    if (!videoTab) continue;
    pushEntry(m, {
      mode: 'video',
      selectId: 'videoModel',
      videoTab,
    });
  }

  return Array.from(map.values()).sort((a, b) => b.addedAt - a.addedAt);
}

function getRecentModelNewsEntries() {
  const now = Date.now();
  const cutoff = now - NEWS_WINDOW_MS;
  return collectModelNewsEntries().filter((item) => item.addedAt >= cutoff && item.addedAt <= now);
}

function resolveModelNewsDescription(item) {
  if (!item) return '';
  if (item.newsDescriptionKey && window.I18N) {
    const translated = I18N.t(item.newsDescriptionKey);
    if (translated && translated !== item.newsDescriptionKey) return translated;
  }
  return item.newsDescription || '';
}

function updateNewsBadge(items) {
  const badge = qs('newsBadge');
  const profileBadge = document.getElementById('profileBadge');
  const count = Array.isArray(items) ? items.length : 0;
  if (badge) {
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : String(count);
      badge.style.display = 'inline-flex';
    } else {
      badge.style.display = 'none';
    }
  }
  if (profileBadge) {
    profileBadge.style.display = count > 0 ? 'block' : 'none';
  }
}

function renderModelNews(itemsArg = null) {
  const list = qs('newsList');
  const empty = qs('emptyNews');
  if (!list || !empty) return;

  const items = Array.isArray(itemsArg) ? itemsArg : getRecentModelNewsEntries();
  updateNewsBadge(items);

  list.innerHTML = '';
  if (items.length === 0) {
    list.style.display = 'none';
    empty.style.display = 'flex';
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      requestAnimationFrame(() => window.lucide.createIcons());
    }
    return;
  }

  list.style.display = 'flex';
  empty.style.display = 'none';

  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'news-card';

    const head = document.createElement('div');
    head.className = 'news-card-head';

    const title = document.createElement('h4');
    title.className = 'news-card-title';
    title.textContent = item.label;

    const date = document.createElement('span');
    date.className = 'news-card-date';
    date.textContent = new Date(item.addedAt).toLocaleDateString(window.I18N ? I18N.lang : undefined, {
      month: 'short',
      day: 'numeric',
    });

    head.appendChild(title);
    head.appendChild(date);

    const desc = document.createElement('p');
    desc.className = 'news-card-desc';
    desc.textContent = resolveModelNewsDescription(item);

    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'news-open-btn';
    const openModelLabel = window.I18N ? I18N.t('news_open_model') : 'Open model';
    actionBtn.innerHTML = `<span>${escapeHtml(openModelLabel)}</span><i data-lucide="arrow-up-right"></i>`;
    actionBtn.addEventListener('click', () => { void openNewsModel(item); });

    card.appendChild(head);
    card.appendChild(desc);
    card.appendChild(actionBtn);
    list.appendChild(card);
  }

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    requestAnimationFrame(() => window.lucide.createIcons());
  }
}
window.renderModelNews = renderModelNews;

function refreshModelNews(forceRender = false) {
  const items = getRecentModelNewsEntries();
  const drawer = qs('newsDrawer');
  const shouldRender = forceRender || (drawer && drawer.classList.contains('open'));
  if (shouldRender) {
    renderModelNews(items);
  } else {
    updateNewsBadge(items);
  }
}

async function openNewsModel(item) {
  if (!item || !item.mode) return;

  if (item.mode === 'kling3' || item.mode === 'video') {
    switchMode('video');
    await ensureVideoModelsReady();
    const desiredVideoTab = item.videoTab || getVideoTabForKling3Tab(item.kling3Tab);
    if (desiredVideoTab) switchVideoTab(desiredVideoTab);
    if (item.kling3Tab) {
      switchKling3Tab(item.kling3Tab, {
        preferredModelId: item.id,
        skipSave: true,
      });
    }
  } else {
    switchMode(item.mode);
  }

  const modelSelect = item.selectId ? qs(item.selectId) : null;
  if (modelSelect) {
    const hasOption = Array.from(modelSelect.options || []).some((opt) => opt.value === item.id);
    if (hasOption) {
      modelSelect.value = item.id;
      modelSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }

    setTimeout(() => {
      const scrollTarget = modelSelect.closest('.field') || modelSelect;
      if (scrollTarget && typeof scrollTarget.scrollIntoView === 'function') {
        scrollElementWithinContainer(scrollTarget, { behavior: 'smooth', block: 'center' });
      }
    }, 120);
  }

  closeNewsDrawer();
}
window.openNewsModel = openNewsModel;

function toggleNews() {
  const drawer = qs('newsDrawer');
  const overlay = qs('newsOverlay');
  if (!drawer) return;

  const opening = !drawer.classList.contains('open');
  if (opening) closeHistoryDrawer();

  drawer.classList.toggle('open', opening);
  if (overlay) overlay.classList.toggle('open', opening);

  refreshModelNews(opening);
}
window.toggleNews = toggleNews;

// Open fullscreen preview
function openFullscreen() {
  if (currentPreview) {
    openMediaModal(currentPreview);
  }
}
window.openFullscreen = openFullscreen;

// Substitute @1..@14 with "Image 1".."Image 14" in prompt text
function substituteImageRefs(text) {
  return text.replace(/@(1[0-4]|[1-9])/g, (m, n) => `Image ${parseInt(n, 10)}`);
}

// Update image upload preview with thumbnails
function updateImagePreview() {
  const grid = qs('imagePreviewGrid');
  if (!grid) return;
  clearPreviewBlobUrls(grid);

  const max = editMaxImages();

  // Clamp array if model was switched to a lower limit
  if (uploadedImageFiles.length > max) {
    uploadedImageFiles = uploadedImageFiles.slice(0, max);
  }

  grid.innerHTML = '';

  if (uploadedImageFiles.length === 0) {
    _updateEditDropzoneHint(max);
    return;
  }

  // Count badge
  const badge = document.createElement('div');
  badge.className = 'edit-img-count';
  badge.textContent = `${uploadedImageFiles.length} / ${max}`;
  grid.appendChild(badge);

  uploadedImageFiles.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'upload-preview-item';

    const img = document.createElement('img');
    img.src = getPreviewSrcForAssetItem(file, grid);
    img.alt = getAssetItemName(file, 'image');
    item.appendChild(img);

    // Number badge
    const numBadge = document.createElement('span');
    numBadge.className = 'img-num-badge';
    numBadge.textContent = index + 1;
    item.appendChild(numBadge);

    // Action overlay (pen-tool + remove)
    const actions = document.createElement('div');
    actions.className = 'tools-img-actions';
    const sketchBtn = document.createElement('button');
    sketchBtn.type = 'button'; sketchBtn.className = 'tools-img-action-btn'; sketchBtn.title = 'Edit / Sketch';
    sketchBtn.innerHTML = '<i data-lucide="pen-tool"></i>';
    sketchBtn.onclick = () => openSketchEditor(index, uploadedImageFiles, updateImagePreview);
    actions.appendChild(sketchBtn);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button'; removeBtn.className = 'tools-img-action-btn'; removeBtn.title = 'Remove';
    removeBtn.innerHTML = '<i data-lucide="x"></i>';
    removeBtn.onclick = (e) => { e.stopPropagation(); uploadedImageFiles.splice(index, 1); updateImagePreview(); };
    actions.appendChild(removeBtn);
    item.appendChild(actions);

    grid.appendChild(item);
  });

  _updateEditDropzoneHint(max);
  requestAnimationFrame(() => { if (window.lucide) window.lucide.createIcons(); });
}

function _updateEditDropzoneHint(max) {
  const zone = qs('imageDropzone');
  if (!zone) return;
  let hint = zone.querySelector('.edit-max-hint');
  if (uploadedImageFiles.length < max) {
    if (!hint) {
      hint = document.createElement('span');
      hint.className = 'edit-max-hint';
      zone.appendChild(hint);
    }
    hint.textContent = window.I18N ? `${I18N.t('upload_click_drag')} (≤ ${max})` : `Click or drag images (≤ ${max})`;
  } else {
    if (hint) hint.remove();
  }
}

function compactHistoryItemForStorage(item) {
  if (!item || typeof item !== 'object') return item;
  const copy = { ...normalizeHistoryItemForRuntime({ ...item, meta: item.meta && typeof item.meta === 'object' ? { ...item.meta } : item.meta }) };
  delete copy.__accountPersistQueued;
  if (copy.thumbnailUrl && copy.thumbnailUrl === copy.url) delete copy.thumbnailUrl;
  if (copy.thumbnailUrl && /^data:image\//i.test(String(copy.thumbnailUrl))) delete copy.thumbnailUrl;
  if (copy.thumbnailUrl && String(copy.thumbnailUrl).length > 2048) delete copy.thumbnailUrl;
  return copy;
}

function saveHistory() {
  const key = getScopedStorageKey('nano_history');
  history = dedupeHistoryItems(history).map((item) => {
    if (!item || typeof item !== 'object') return item;
    delete item.__accountPersistQueued;
    return normalizeHistoryItemForRuntime(item);
  });

  let persistedHistory = history.slice(0, LOCAL_HISTORY_CACHE_LIMIT).map((item) => compactHistoryItemForStorage(item));
  try {
    localStorage.setItem(key, JSON.stringify(persistedHistory));
    persistHistoryCacheMeta(history, undefined, { persistedCount: persistedHistory.length });
  } catch (e) {
    while (persistedHistory.length > 1) {
      persistedHistory.pop();
      try {
        localStorage.setItem(key, JSON.stringify(persistedHistory));
        persistHistoryCacheMeta(history, undefined, { persistedCount: persistedHistory.length });
        return;
      } catch (_) { /* keep trimming */ }
    }
    persistHistoryCacheMeta(history, undefined, { persistedCount: persistedHistory.length });
  }
}

const TASK_STORAGE_FAILED_RETENTION_MS = 15 * 60 * 1000;
const TASK_STORAGE_MAX_TERMINAL = 20;

function isTaskActiveForStorage(task) {
  return !!(task && (task.status === 'QUEUED' || task.status === 'SUBMITTING' || task.status === 'RUNNING'));
}

function shouldPersistTask(task, now = Date.now()) {
  if (!task || !task.id) return false;
  if (isTaskActiveForStorage(task)) return true;
  if (task.status === 'COMPLETED') return !task.savedToHistory;
  if (task.status === 'FAILED') {
    const failedAge = Math.max(0, now - (task.failedAt || task.createdAt || now));
    return failedAge <= TASK_STORAGE_FAILED_RETENTION_MS;
  }
  return false;
}

function compactTaskForStorage(task) {
  if (!task || typeof task !== 'object') return null;
  const compact = {
    id: task.id,
    mode: task.mode,
    prompt: task.prompt || '',
    model_id: task.model_id || null,
    status: task.status || null,
    createdAt: task.createdAt || null,
    startedAt: task.startedAt || null,
    completedAt: task.completedAt || null,
    failedAt: task.failedAt || null,
    status_url: task.status_url || null,
    response_url: task.response_url || null,
    error: task.error || null,
    retryCount: Number.isFinite(Number(task.retryCount)) ? Number(task.retryCount) : 0,
    savedToHistory: !!task.savedToHistory,
  };

  if (task.status === 'COMPLETED' && !task.savedToHistory) {
    compact.mediaUrl = task.mediaUrl || null;
    compact.thumbUrl = task.thumbUrl || null;
    compact.model_urls = task.model_urls || null;
    compact.modelFormat = task.modelFormat || null;
  }

  if (isTaskActiveForStorage(task)) {
    compact.genCtx = task.genCtx || null;
  }

  return compact;
}

function buildPersistedTasksSnapshot() {
  const now = Date.now();
  const active = [];
  const terminal = [];

  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!shouldPersistTask(task, now)) continue;
    if (isTaskActiveForStorage(task) || (task.status === 'COMPLETED' && !task.savedToHistory)) active.push(task);
    else terminal.push(task);
  }

  terminal.sort((a, b) => {
    const at = Number(a && (a.failedAt || a.createdAt || 0)) || 0;
    const bt = Number(b && (b.failedAt || b.createdAt || 0)) || 0;
    return bt - at;
  });

  const keptTasks = [...active, ...terminal.slice(0, TASK_STORAGE_MAX_TERMINAL)];
  return keptTasks.map(compactTaskForStorage).filter(Boolean);
}

function saveTasks() {
  const key = getScopedStorageKey('nano_tasks');
  const persistedTasks = buildPersistedTasksSnapshot();

  if (persistedTasks.length !== tasks.length) {
    const persistedIds = new Set(persistedTasks.map((task) => task.id));
    tasks = tasks.filter((task) => task && persistedIds.has(task.id));
  }

  try {
    localStorage.setItem(key, JSON.stringify(persistedTasks));
  } catch (error) {
    const activeOnly = persistedTasks.filter((task) => isTaskActiveForStorage(task) || (task.status === 'COMPLETED' && !task.savedToHistory));
    tasks = tasks.filter((task) => task && activeOnly.some((entry) => entry.id === task.id));
    localStorage.setItem(key, JSON.stringify(activeOnly));
    console.warn('Task storage quota exceeded; pruned terminal tasks from local cache', error);
  }
}

function isTransientPollError(err) {
  if (!err) return false;
  if (err && err.__transient) return true;
  const msg = err && err.message ? String(err.message) : String(err);
  return /failed to fetch/i.test(msg) || /networkerror/i.test(msg) || /network error/i.test(msg);
}

const MAX_POLL_RETRIES = 30;

function computeRetryDelayMs(retryCount) {
  const n = Math.max(0, Math.min(10, Number.isFinite(retryCount) ? retryCount : 0));
  const ms = 2000 * Math.pow(2, Math.max(0, n - 1));
  return Math.max(2000, Math.min(30000, ms));
}

function schedulePoll(taskId, delayMs) {
  if (pollTimers.has(taskId)) {
    clearTimeout(pollTimers.get(taskId));
  }
  const h = setTimeout(() => {
    pollTimers.delete(taskId);
    pollTask(taskId);
  }, Math.max(0, delayMs || 0));
  pollTimers.set(taskId, h);
}

function parseJsonMaybe(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  if (!text.startsWith('{') && !text.startsWith('[')) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractDetailMessage(details) {
  const src = typeof details === 'string' ? (parseJsonMaybe(details) || details) : details;
  if (!src) return '';

  if (typeof src === 'string') {
    return src.trim();
  }

  if (Array.isArray(src)) {
    for (const entry of src) {
      const msg = extractDetailMessage(entry);
      if (msg) return msg;
    }
    return '';
  }

  if (typeof src !== 'object') return '';

  if (Array.isArray(src.detail)) {
    for (const entry of src.detail) {
      if (entry && typeof entry === 'object') {
        const msg = (typeof entry.msg === 'string' ? entry.msg.trim() : '') ||
          (typeof entry.message === 'string' ? entry.message.trim() : '');
        if (msg) return msg;
      }
      const nested = extractDetailMessage(entry);
      if (nested) return nested;
    }
  }

  if (typeof src.msg === 'string' && src.msg.trim()) return src.msg.trim();
  if (typeof src.message === 'string' && src.message.trim()) return src.message.trim();
  if (typeof src.error === 'string' && src.error.trim()) return src.error.trim();

  if (src.details) return extractDetailMessage(src.details);
  if (src.detail) return extractDetailMessage(src.detail);

  return '';
}

function i18nText(key, fallback) {
  if (window.I18N && typeof I18N.t === 'function') {
    const translated = I18N.t(key);
    if (translated && translated !== key) return translated;
  }
  return fallback;
}

function localizeErrorLine(line) {
  const src = String(line || '').trim();
  if (!src) return '';

  if (/^generation failed$/i.test(src)) return i18nText('err_generation_failed', 'Generation failed');
  if (/^request expired or invalid/i.test(src)) return i18nText('err_expired', 'Request expired or invalid. Please re-generate.');
  if (/^connection lost after multiple retries/i.test(src)) return i18nText('err_connection_lost', 'Connection lost after multiple retries. Please try again.');
  if (/^temporary connection issue\. retrying/i.test(src)) return i18nText('err_retrying_connection', 'Temporary connection issue. Retrying…');
  if (/^task expired after being active too long/i.test(src)) return i18nText('err_task_expired', 'Task expired after being active too long. Please try again.');
  if (/^interrupted - please try again$/i.test(src)) return i18nText('err_interrupted', 'Interrupted - please try again');
  if (/video duration can(?:not| not)?(?: be)? longer than 30s/i.test(src)) {
    return i18nText('err_kling_duration_limit_video', 'Video duration cannot be longer than 30s.');
  }
  if (/video duration can(?:not| not)?(?: be)? longer than 10s/i.test(src)) {
    return i18nText('err_kling_duration_limit_image', 'Video duration cannot be longer than 10s when orientation is image.');
  }
  if (/element binding is only supported when character_orientation is ['\"]video['\"]/i.test(src)) {
    return i18nText('err_kling_element_video_only', "Element binding works only when Character Orientation is set to 'Video'.");
  }
  if (/only 1 element is supported/i.test(src) || /supports only one element/i.test(src)) {
    return i18nText('err_kling_one_element_only', 'Only one element is supported for Kling 3 motion-control.');
  }
  return src;
}

function formatErrorForDisplay(message) {
  const raw = String(message || '').trim();
  if (!raw) return '';

  const lines = raw
    .split(/\n+/)
    .map((line) => localizeErrorLine(line))
    .filter(Boolean);

  let output = lines.join('\n');
  if (/video duration can(?:not| not)?(?: be)? longer than 30s/i.test(raw)) {
    const tip = i18nText(
      'err_kling_motion_duration_tip',
      "Tip: Motion-control videos must be <= 30s with orientation 'video' (<= 10s with orientation 'image')."
    );
    if (!output.includes(tip)) output += '\n' + tip;
  }

  return output;
}

function getTaskStatusLabel(status) {
  const keyMap = {
    QUEUED: 'task_status_queued',
    SUBMITTING: 'task_status_submitting',
    RUNNING: 'task_status_running',
    FAILED: 'task_status_failed',
    COMPLETED: 'task_status_completed',
  };
  const fallbackMap = {
    QUEUED: 'Queued',
    SUBMITTING: 'Submitting',
    RUNNING: 'Running',
    FAILED: 'Failed',
    COMPLETED: 'Completed',
  };
  const s = String(status || '').toUpperCase();
  const key = keyMap[s];
  if (!key) return status || '';
  return i18nText(key, fallbackMap[s] || s);
}

function normalizeErrorMessageFromPayload(payload, fallbackMessage = '') {
  const src = typeof payload === 'string' ? (parseJsonMaybe(payload) || { error: payload }) : payload;
  const primary = src && typeof src === 'object'
    ? ((typeof src.error === 'string' && src.error.trim()) ? src.error.trim() :
      ((typeof src.message === 'string' && src.message.trim()) ? src.message.trim() : ''))
    : '';

  const detail = extractDetailMessage(src && typeof src === 'object' ? (src.details || src.detail) : src);

  const isGeneric = !primary || /status check failed:/i.test(primary) || /unprocessable entity/i.test(primary) || /^generation failed$/i.test(primary);

  let message = primary;
  if (isGeneric && detail) {
    message = detail;
  } else if (detail && primary && !primary.toLowerCase().includes(detail.toLowerCase())) {
    message = primary + '\n' + detail;
  }

  if (!message) {
    message = fallbackMessage || 'Generation failed';
  }

  return message;
}

function getErrorMessage(error, fallbackMessage = '') {
  if (error && typeof error === 'object') {
    if (error.__payload) return normalizeErrorMessageFromPayload(error.__payload, fallbackMessage || error.message || '');
    if (typeof error.message === 'string') return normalizeErrorMessageFromPayload(error.message, fallbackMessage);
    return normalizeErrorMessageFromPayload(error, fallbackMessage);
  }
  return normalizeErrorMessageFromPayload(error, fallbackMessage);
}

async function createResponseError(res, fallbackPrefix = 'Request failed') {
  let rawText = '';
  try {
    rawText = await res.text();
  } catch {
    rawText = '';
  }

  const parsed = parseJsonMaybe(rawText);
  const payload = parsed || (rawText ? { error: rawText } : { error: fallbackPrefix + ': ' + res.status + ' ' + res.statusText });
  const fallbackMessage = fallbackPrefix + ': ' + res.status + ' ' + res.statusText;

  const err = new Error(normalizeErrorMessageFromPayload(payload, fallbackMessage));
  err.__httpStatus = res.status;
  err.__payload = payload;
  err.__transient = res.status === 429 || res.status >= 500;
  return err;
}

async function ensureOkJsonResponse(res, fallbackPrefix = 'Request failed') {
  if (!res.ok) throw await createResponseError(res, fallbackPrefix);
  return await res.json();
}

async function fetchFalViaStatusProxy(url) {
  const res = await fetch(`/api/status?statusUrl=${encodeURIComponent(url)}`);
  return await ensureOkJsonResponse(res, 'Status check failed');
}

function getActiveTaskCount() {
  return tasks.filter((t) => t && (t.status === 'SUBMITTING' || t.status === 'RUNNING')).length;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function setSelectOptions(selectEl, items) {
  if (!selectEl) return;
  const prev = selectEl.value;
  selectEl.innerHTML = '';
  for (const it of items) {
    const opt = document.createElement('option');
    opt.value = it.id;
    opt.textContent = it.label;
    selectEl.appendChild(opt);
  }
  if (prev) selectEl.value = prev;
}

function getSelected3dModelId() {
  const sel = qs('threeDModel');
  return sel ? String(sel.value || '').trim() : '';
}

function getSelected3dModelMeta() {
  const id = getSelected3dModelId();
  if (!id) return null;
  return THREE_D_MODELS.find((m) => m && m.id === id) || null;
}

let VIDEO_OPTION_DEFS = {};

async function loadVideoModels() {
  if (videoModelsLoaded) return;
  if (!videoModelsPromise) {
    videoModelsPromise = (async () => {
      const res = await fetch('/api/video-generate');
      if (!res.ok) throw await createResponseError(res, 'Failed to load video models');
      const json = await res.json();
      const models = Array.isArray(json && json.models) ? json.models : [];
      VIDEO_MODELS = models.map((m) => ({
        id: m.id,
        label: m.label || m.id,
        kind: m.kind || '',
        addedAt: m.addedAt || null,
        newsDescription: m.newsDescription || '',
        newsDescriptionKey: m.newsDescriptionKey || null,
      }));
      VIDEO_MODEL_MAP = new Map(models.map((m) => [m.id, m]));
      VIDEO_OPTION_DEFS = (json && json.optionDefs) ? json.optionDefs : {};
      videoModelsLoaded = true;
      refreshModelNews();
    })().finally(() => {
      videoModelsPromise = null;
    });
  }
  await videoModelsPromise;
}

function getSelectedVideoModel() {
  const id = qs('videoModel') ? qs('videoModel').value : '';
  return id ? (VIDEO_MODEL_MAP.get(id) || null) : null;
}

function getVideoFamilyPriority(model) {
  if (model && model.kind && isKling3VideoKind(model.kind)) return 0;
  if (model && model.id && isLtx23VideoModelId(model.id)) return 1;
  return 2;
}

function getVideoModelsForTab(tab) {
  const t = String(tab || '').trim();
  if (!t) return VIDEO_MODELS;

  return VIDEO_MODELS.filter((m) => {
    const k = m && m.kind ? m.kind : '';
    return getVideoTabForModelKind(k) === t;
  }).sort((a, b) => {
    const familyDiff = getVideoFamilyPriority(a) - getVideoFamilyPriority(b);
    if (familyDiff !== 0) return familyDiff;
    return 0;
  });
}

function refreshVideoModelDropdown(preferredId = '') {
  const sel = qs('videoModel');
  if (!sel) return;
  const prev = sel.value;
  const items = getVideoModelsForTab(currentVideoTab);
  setSelectOptions(sel, items);
  if (preferredId && Array.isArray(items) && items.some((m) => m.id === preferredId)) {
    sel.value = preferredId;
  } else if (prev && Array.isArray(items) && items.some((m) => m.id === prev)) {
    sel.value = prev;
  } else if (!sel.value && items[0]) {
    sel.value = items[0].id;
  }
}

function getLtx23ModelsForFamily(family) {
  return LTX23_MODELS[family] || [];
}

function refreshLtx23ModelDropdown(preferredId = '') {
  const sel = qs('ltx23Model');
  if (!sel) return;
  const prev = sel.value;
  const items = getLtx23ModelsForFamily(currentLtx23Family);
  setSelectOptions(sel, items);
  const remembered = ltx23SelectedModelByFamily[currentLtx23Family];
  if (preferredId && Array.isArray(items) && items.some((m) => m.id === preferredId)) {
    sel.value = preferredId;
  } else if (remembered && Array.isArray(items) && items.some((m) => m.id === remembered)) {
    sel.value = remembered;
  } else if (prev && Array.isArray(items) && items.some((m) => m.id === prev)) {
    sel.value = prev;
  } else if (items[0]) {
    sel.value = items[0].id;
  }
}

function renderLtx23VariantTabs(preferredId = '') {
  const host = qs('ltx23VariantTabs');
  if (!host) return;
  const models = getLtx23ModelsForFamily(currentLtx23Family);
  const activeId = getSelectedLtx23ModelId(preferredId) || ltx23SelectedModelByFamily[currentLtx23Family] || (models[0] && models[0].id) || '';
  host.innerHTML = models.map((model) => `
    <button class="sub-tab ${model.id === activeId ? 'active' : ''}" type="button" onclick="selectLtx23Model('${model.id}')">
      ${escapeHtml(model.label)}
    </button>
  `).join('');
}

function syncLtx23FamilyButtons() {
  const familyIds = {
    'text-to-video': 'ltx23family-text',
    'image-to-video': 'ltx23family-image',
    'video-to-video': 'ltx23family-video',
    'audio-to-video': 'ltx23family-audio',
  };
  Object.entries(familyIds).forEach(([family, id]) => {
    const el = qs(id);
    if (el) el.classList.toggle('active', family === currentLtx23Family);
  });
}

function ensureLtx23EmbeddedSection() {
  const videoHost = qs('videoUploadGroup');
  const ltxSection = qs('ltx23UploadGroup');
  if (!videoHost || !ltxSection) return;

  const videoControls = qs('videoControls');
  const desiredInsertBefore = videoControls && videoControls.nextSibling ? videoControls.nextSibling : null;
  if (ltxSection.parentElement !== videoHost) {
    if (desiredInsertBefore) videoHost.insertBefore(ltxSection, desiredInsertBefore);
    else videoHost.appendChild(ltxSection);
  } else if (videoControls && ltxSection.previousElementSibling !== videoControls) {
    if (desiredInsertBefore && desiredInsertBefore !== ltxSection) {
      videoHost.insertBefore(ltxSection, desiredInsertBefore);
    } else {
      videoHost.appendChild(ltxSection);
    }
  }

  ltxSection.classList.add('video-ltx-embedded');
  if (ltxSection.dataset.ready !== 'true') {
    const ltxModelSel = qs('ltx23Model');
    if (ltxModelSel) {
      ltxModelSel.addEventListener('change', () => {
        if (ltxModelSel.value) selectLtx23Model(ltxModelSel.value);
      });
    }
    ltxSection.dataset.ready = 'true';
  }
  syncLtx23FamilyButtons();
  refreshLtx23ModelDropdown();
  renderLtx23VariantTabs();
}

function syncLtx23StateFromVideoModelId(modelId, options = {}) {
  const family = getLtx23FamilyForModelId(modelId);
  if (!family) return false;
  currentLtx23Family = family;
  ltx23SelectedModelByFamily[family] = modelId;
  ensureLtx23EmbeddedSection();
  syncLtx23FamilyButtons();
  refreshLtx23ModelDropdown(modelId);
  renderLtx23VariantTabs(modelId);
  if (!options.skipSave && typeof saveAppState === 'function') saveAppState();
  return true;
}

function selectLtx23Model(modelId, options = {}) {
  const family = getLtx23FamilyForModelId(modelId);
  if (!family) return;
  currentLtx23Family = family;
  ltx23SelectedModelByFamily[family] = modelId;
  if (currentVideoTab !== family) {
    currentVideoTab = family;
    setActiveVideoTabButtonState(currentVideoTab);
  }
  refreshVideoModelDropdown(modelId);
  refreshLtx23ModelDropdown(modelId);
  const videoSel = qs('videoModel');
  if (videoSel) videoSel.value = modelId;
  ensureLtx23EmbeddedSection();
  updateVideoUiVisibility();
  renderVideoOptionsUI();
  if (!options.skipSave && typeof saveAppState === 'function') saveAppState();
}
window.selectLtx23Model = selectLtx23Model;

function switchLtx23Family(family, options = {}) {
  if (!LTX23_MODELS[family]) return;
  currentLtx23Family = family;
  const remembered = ltx23SelectedModelByFamily[family];
  const models = getLtx23ModelsForFamily(family);
  const preferredId = (options.preferredModelId && isLtx23VideoModelId(options.preferredModelId))
    ? options.preferredModelId
    : (remembered || (models[0] && models[0].id) || '');
  selectLtx23Model(preferredId, options);
}
window.switchLtx23Family = switchLtx23Family;

function ensureKling3EmbeddedSection() {
  const videoHost = qs('videoUploadGroup');
  const klingSection = qs('kling3UploadGroup');
  if (!videoHost || !klingSection) return;

  if (klingSection.parentElement !== videoHost) {
    videoHost.appendChild(klingSection);
  }

  klingSection.classList.add('video-kling-embedded');
  klingSection.style.marginTop = '0.75rem';

  const klingModelRow = qs('kling3Model') ? qs('kling3Model').closest('.settings-row') : null;
  if (klingModelRow) klingModelRow.style.display = 'none';

  if (!kling3ControlsInitialized) {
    initKling3Controls();
    kling3ControlsInitialized = true;
  }

  if (klingSection.dataset.embeddedReady !== 'true') {
    switchKling3Tab(currentKling3Tab, {
      skipVideoSelectionSync: true,
      skipSave: true,
      preferredModelId: getSelectedKling3ModelId(),
    });
    klingSection.dataset.embeddedReady = 'true';
  }
}

async function ensureVideoModelsReady() {
  ensureVideoControls();
  await loadVideoModels();
}

function coerceBoolFromUi(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v || '').trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return null;
}

const VIDEO_OPTION_LABEL_KEYS = {
  acceleration: 'label_acceleration',
  adjust_fps_for_interpolation: 'label_adjust_fps_for_interpolation',
  audio_url: 'label_audio_url',
  auto_fix: 'label_auto_fix_prompt',
  camera_fixed: 'label_fixed_camera',
  cfg_scale: 'label_cfg_scale',
  cfg_scale_framepack: 'label_cfg_scale',
  character_orientation: 'label_character_orientation_mode',
  character_orientation_kling3_motion: 'label_character_orientation_mode',
  delete_video: 'label_delete_after',
  detect_and_block_ip: 'label_block_ip_content',
  effect_pixverse: 'label_effect',
  enable_output_safety_checker_off: 'label_output_safety',
  enable_prompt_expansion: 'label_expand_prompt',
  enable_prompt_expansion_on: 'label_expand_prompt',
  enable_safety_checker: 'label_safety_check',
  enable_safety_checker_off: 'label_safety_check',
  first_n_seconds: 'label_source_seconds',
  fps_animatediff: 'label_fps',
  fps_ltx2: 'label_fps',
  fps_ltx23: 'label_fps',
  frames_per_second: 'label_frames_per_second',
  generate_audio: 'label_generate_audio',
  generate_audio_on: 'label_generate_audio',
  generate_audio_switch: 'label_generate_audio',
  generate_multi_clip_switch: 'label_multi_clip',
  guidance_scale_2: 'label_guidance_scale_2',
  guidance_scale_animatediff: 'label_guidance_scale',
  guidance_scale_framepack: 'label_guidance_scale',
  guidance_scale_ltx23_audio: 'label_guidance_scale',
  guidance_scale_ltx_video: 'label_guidance_scale',
  guidance_scale_wan22: 'label_guidance_scale',
  guidance_scale_wan_move: 'label_guidance_scale',
  interpolator_model: 'label_interpolator',
  keep_audio: 'label_keep_audio',
  keep_audio_on: 'label_keep_audio',
  keep_original_sound: 'label_keep_original_sound',
  motions: 'label_motions',
  multi_shots: 'label_multi_shots',
  multi_shots_on: 'label_multi_shots',
  negative_prompt: 'label_negative_prompt',
  negative_prompt_animatediff: 'label_negative_prompt',
  negative_prompt_kling: 'label_negative_prompt',
  negative_prompt_ltx_video: 'label_negative_prompt',
  num_frames: 'label_frames',
  num_frames_framepack: 'label_frames',
  num_frames_hunyuan: 'label_frames',
  num_inference_steps_animatediff: 'label_inference_steps',
  num_inference_steps_ltx_video: 'label_inference_steps',
  num_inference_steps_wan22: 'label_inference_steps',
  num_inference_steps_wan_move: 'label_inference_steps',
  num_interpolated_frames: 'label_interpolated_frames',
  pro_mode: 'label_pro_mode',
  prompt_optimizer: 'label_optimize_prompt',
  resample_fps: 'label_resample_fps',
  return_frames_zip: 'label_return_frames_zip',
  safety_tolerance_veo31: 'label_safety_tolerance',
  seed: 'label_seed',
  shift: 'label_shift',
  shot_type_customize: 'label_shot_type',
  shot_type_v3: 'label_shot_type',
  strength_animatediff: 'label_strength',
  strength_wan22: 'label_strength',
  style_pixverse: 'label_style',
  sync_mode: 'label_sync_mode',
  thinking_type: 'label_thinking_type',
  use_turbo: 'label_turbo_mode',
  video_quality: 'label_video_quality',
  video_write_mode: 'label_write_mode',
  voice_ids: 'label_voice_ids_simple',
};

const VIDEO_OPTION_VALUE_KEYS = {
  auto: 'opt_auto',
  true: 'opt_on',
  false: 'opt_off',
  image: 'opt_image',
  video: 'opt_video',
  customize: 'opt_customize',
  intelligent: 'opt_intelligent',
  full: 'opt_full',
  preview: 'opt_preview',
  high: 'opt_high',
  medium: 'opt_medium',
  low: 'opt_low',
  realistic: 'opt_realistic',
  sculpture: 'opt_sculpture',
  triangle: 'opt_triangle',
  quadrilateral: 'opt_quad',
  quad: 'opt_quad',
  normal: 'opt_normal',
  lowpoly: 'opt_lowpoly',
  geometry: 'opt_geometry',
  random: 'opt_random',
  yes: 'opt_yes',
  no: 'opt_no',
  on: 'opt_on',
  off: 'opt_off',
};

function humanizeVideoOptionKey(key) {
  return String(key || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getVideoOptionLabelKey(key, def) {
  if (VIDEO_OPTION_LABEL_KEYS[key]) return VIDEO_OPTION_LABEL_KEYS[key];
  if (/^aspect_ratio_/.test(key)) return 'label_aspect_ratio';
  if (/^duration_/.test(key)) return def && /sec/i.test(def.label || '') ? 'label_duration_seconds' : 'label_duration';
  if (/^resolution_/.test(key)) return 'label_resolution';
  return null;
}

function getVideoOptionLabelText(key, def) {
  const labelKey = getVideoOptionLabelKey(key, def);
  if (labelKey) return getI18nText(labelKey, def && def.label ? def.label : humanizeVideoOptionKey(key));
  return def && def.label ? def.label : humanizeVideoOptionKey(key);
}

function getVideoOptionValueText(key, value) {
  const raw = String(value);
  const valueKey = VIDEO_OPTION_VALUE_KEYS[raw.toLowerCase()];
  if (valueKey) return getI18nText(valueKey, raw);
  return raw;
}

function getVideoOptionPlaceholderText(key, def) {
  if (def && Object.prototype.hasOwnProperty.call(def, 'default') && def.default !== null && def.default !== '') {
    return String(def.default);
  }
  return getVideoOptionLabelText(key, def);
}

function localizeVideoOptionFields(root) {
  if (!root) return;
  root.querySelectorAll('[data-video-opt-key]').forEach((field) => {
    const key = field.dataset.videoOptKey;
    const def = VIDEO_OPTION_DEFS[key] || null;
    const label = field.querySelector(':scope > label');
    if (label) label.textContent = getVideoOptionLabelText(key, def);
    const control = field.querySelector('[data-opt-key]');
    if (!control) return;
    if (control.tagName === 'SELECT') {
      Array.from(control.options).forEach((option) => {
        if (option.dataset.empty === 'true') option.textContent = getI18nText('opt_default', 'Default');
        else option.textContent = getVideoOptionValueText(key, option.value);
      });
      return;
    }
    control.placeholder = getVideoOptionPlaceholderText(key, def);
  });
}

function buildVideoOptionInput(key, modelMeta) {
  const def = VIDEO_OPTION_DEFS[key] || null;

  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.dataset.videoOptKey = key;

  const label = document.createElement('label');
  label.textContent = getVideoOptionLabelText(key, def);
  wrap.appendChild(label);

  const optType = def ? def.type : null;
  const hasDefault = !!(def && Object.prototype.hasOwnProperty.call(def, 'default'));

  if (optType === 'select' && Array.isArray(def.values)) {
    const sel = document.createElement('select');
    sel.dataset.optKey = key;

    if (def.allowEmpty) {
      const empty = document.createElement('option');
      empty.value = '';
      empty.dataset.empty = 'true';
      empty.textContent = getI18nText('opt_default', def.emptyLabel || 'Default');
      if (!hasDefault || def.default === null || def.default === '') {
        empty.selected = true;
      }
      sel.appendChild(empty);
    }

    for (const v of def.values) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = getVideoOptionValueText(key, v);
      if (hasDefault && String(def.default) === String(v)) {
        o.selected = true;
      }
      sel.appendChild(o);
    }
    wrap.appendChild(sel);
    return wrap;
  }

  if (optType === 'bool') {
    const sel = document.createElement('select');
    sel.dataset.optKey = key;
    const defVal = def.default === true ? 'true' : 'false';
    ['false', 'true'].forEach((v) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = getVideoOptionValueText(key, v);
      if (v === defVal) o.selected = true;
      sel.appendChild(o);
    });
    wrap.appendChild(sel);
    return wrap;
  }

  if (optType === 'number') {
    const input = document.createElement('input');
    input.dataset.optKey = key;
    input.type = 'number';
    if (def.min !== undefined) input.min = def.min;
    if (def.max !== undefined) input.max = def.max;
    if (def.step !== undefined) input.step = def.step;
    input.placeholder = getVideoOptionPlaceholderText(key, def);
    wrap.appendChild(input);
    return wrap;
  }

  const input = document.createElement('input');
  input.dataset.optKey = key;
  input.type = 'text';
  input.placeholder = getVideoOptionPlaceholderText(key, def);
  wrap.appendChild(input);
  return wrap;
}

function renderVideoOptionsUI() {
  const host = qs('videoOptionsDynamic');
  if (!host) return;

  host.innerHTML = '';

  const modelMeta = getSelectedVideoModel();
  if (!modelMeta) return;
  if (isKling3VideoKind(modelMeta.kind)) return;

  const allowed = Array.isArray(modelMeta.allowedOptions) ? modelMeta.allowedOptions : [];
  if (allowed.length === 0) return;

  const grid = document.createElement('div');
  grid.className = 'settings-grid';
  grid.style.marginTop = '0.5rem';

  for (const key of allowed) {
    grid.appendChild(buildVideoOptionInput(key, modelMeta));
  }

  host.appendChild(grid);
  localizeVideoOptionFields(host);
}

function collectVideoOptionsFromUI() {
  const modelMeta = getSelectedVideoModel();
  if (!modelMeta) return { options: {}, top: {} };

  const allowed = new Set(Array.isArray(modelMeta.allowedOptions) ? modelMeta.allowedOptions : []);
  const optionTypes = (modelMeta.optionTypes && typeof modelMeta.optionTypes === 'object') ? modelMeta.optionTypes : {};
  const els = Array.from(document.querySelectorAll('[data-opt-key]'));

  const options = {};
  const top = {};

  for (const el of els) {
    const key = el.dataset.optKey;
    if (!key || !allowed.has(key)) continue;
    const def = VIDEO_OPTION_DEFS[key] || null;
    let v = (el && 'value' in el) ? el.value : null;
    if (v === null || typeof v === 'undefined') continue;
    if (String(v).trim() === '') continue;

    if (key === 'voice_ids') {
      const arr = String(v).split(',').map((s) => s.trim()).filter(Boolean);
      if (arr.length > 0) options[key] = arr;
      continue;
    }

    if (key === 'motions') {
      const arr = String(v).split(/[\\n,]/).map((s) => s.trim()).filter(Boolean);
      if (arr.length > 0) options[key] = arr;
      continue;
    }

    if (def && def.type === 'bool') {
      const b = coerceBoolFromUi(v);
      if (b !== null) v = b;
    }

    if ((def && def.type === 'number') || optionTypes[key] === 'number') {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) v = n;
    }

    if (key === 'duration' || key === 'aspect_ratio' || key === 'keep_audio' || key === 'video_id') {
      top[key] = v;
    } else {
      options[key] = v;
    }
  }

  return { options, top };
}

function ensureVideoControls() {
  const host = qs('videoUploadGroup');
  if (!host) return;
  if (qs('videoModel')) {
    ensureLtx23EmbeddedSection();
    ensureKling3EmbeddedSection();
    return;
  }

  const wrap = document.createElement('div');
  wrap.id = 'videoControls';

  wrap.innerHTML = `
    <div class="settings-row" style="margin-top:0.75rem;">
      <div class="field" style="flex:2;">
        <label data-i18n="label_model">${getI18nText('label_model', 'Model')}</label>
        <select id="videoModel"></select>
      </div>
    </div>

    <div class="settings-row" style="margin-top:0.5rem;" id="videoUrlGroup">
      <div class="field">
        <label data-i18n="label_video_url">${getI18nText('label_video_url', 'Video URL')}</label>
        <input id="videoUrlInput" type="text" data-i18n-placeholder="placeholder_video_url" placeholder="${getI18nText('placeholder_video_url', 'https://...mp4')}" />
      </div>
    </div>

    <div class="settings-row" style="margin-top:0.5rem;">
      <div class="field" id="videoFileGroup">
        <label data-i18n="label_upload_video">${getI18nText('label_upload_video', 'Upload Video')}</label>
        <div class="upload-zone small" onclick="document.getElementById('videoInput').click()">
          <i data-lucide="film"></i>
          <span id="videoFileLabel">${getI18nText('upload_video', 'Upload video')}</span>
          <input id="videoInput" type="file" accept="video/*" hidden />
        </div>
      </div>
      <div class="field" id="videoImageFileGroup">
        <label data-i18n="label_upload_image">${getI18nText('label_upload_image', 'Upload Image')}</label>
        <div class="upload-zone small" onclick="document.getElementById('videoImageInput').click()">
          <i data-lucide="image"></i>
          <span id="videoImageLabel">${getI18nText('select_image', 'Select image')}</span>
          <input id="videoImageInput" type="file" accept="image/*" hidden />
        </div>
      </div>
    </div>

    <div class="field" id="referenceImagesGroup" style="margin-top:0.5rem;">
      <label data-i18n="label_reference_images_video">${getI18nText('label_reference_images_video', 'Reference Images (1-7)')}</label>
      <div class="upload-zone small" onclick="document.getElementById('referenceImagesInput').click()">
        <i data-lucide="images"></i>
        <span id="refImagesLabel">${getI18nText('select_images', 'Select images')}</span>
        <input id="referenceImagesInput" type="file" accept="image/*" multiple hidden />
      </div>
    </div>

    <div class="settings-row" style="margin-top:0.5rem;" id="videoEndImageGroup">
      <div class="field">
        <label data-i18n="label_end_frame_optional">${getI18nText('label_end_frame_optional', 'End Frame (optional)')}</label>
        <div class="upload-zone small" onclick="document.getElementById('videoEndImageInput').click()">
          <i data-lucide="image"></i>
          <span id="endImageLabel">${getI18nText('select_image', 'Select image')}</span>
          <input id="videoEndImageInput" type="file" accept="image/*" hidden />
        </div>
      </div>
    </div>

    <div class="settings-row" style="margin-top:0.5rem;" id="videoIdGroup">
      <div class="field">
        <label data-i18n="label_video_id">${getI18nText('label_video_id', 'Video ID')}</label>
        <input id="videoIdInput" type="text" data-i18n-placeholder="placeholder_video_id" placeholder="${getI18nText('placeholder_video_id', 'Enter video ID')}" />
      </div>
    </div>

    <div class="settings-row" style="margin-top:0.5rem;" id="audioFileGroup">
      <div class="field">
        <label data-i18n="label_audio_file">${getI18nText('label_audio_file', 'Audio File')}</label>
        <div class="upload-zone small" onclick="document.getElementById('audioInput').click()">
          <i data-lucide="music"></i>
          <span id="audioFileLabel">${getI18nText('select_audio', 'Select audio')}</span>
          <input id="audioInput" type="file" accept="audio/*" hidden />
        </div>
      </div>
    </div>

    <div id="videoOptionsDynamic"></div>
  `;

  host.appendChild(wrap);
  ensureLtx23EmbeddedSection();
  ensureKling3EmbeddedSection();
  if (window.I18N && typeof window.I18N.applyLocale === 'function') {
    window.I18N.applyLocale();
  }

  const modelSel = qs('videoModel');

  loadVideoModels()
    .then(() => {
      refreshVideoModelDropdown();
      const items = getVideoModelsForTab(currentVideoTab);
      try {
        const saved = JSON.parse(localStorage.getItem(APP_STATE_KEY) || '{}');
        const savedVideoModelId = saved && saved.selects ? String(saved.selects.videoModel || '') : '';
        const savedKlingModelId = saved && saved.selects ? String(saved.selects.kling3Model || '') : '';
        if (savedVideoModelId && modelSel && items.some((m) => m.id === savedVideoModelId)) {
          modelSel.value = savedVideoModelId;
        } else if (savedKlingModelId && modelSel && items.some((m) => m.id === savedKlingModelId)) {
          modelSel.value = savedKlingModelId;
        }
      } catch (_) {}
      if (modelSel && (!modelSel.value || !items.some((m) => m.id === modelSel.value)) && items[0]) {
        modelSel.value = items[0].id;
      }
      updateVideoUiVisibility();
      renderVideoOptionsUI();
    })
    .catch((e) => {
      showToast(e && e.message ? e.message : String(e), 'error');
    });

  if (modelSel) {
    modelSel.addEventListener('change', () => {
      updateVideoUiVisibility();
      renderVideoOptionsUI();
    });
  }

  ['videoInput', 'videoImageInput', 'referenceImagesInput', 'videoEndImageInput', 'audioInput'].forEach((inputId) => {
    bindManagedUploadById(inputId);
    const inputEl = qs(inputId);
    if (inputEl) setupDropZone(inputEl.closest('.upload-zone'), inputEl);
  });

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}
function updateVideoUiVisibility() {
  ensureVideoControls();
  ensureLtx23EmbeddedSection();
  ensureKling3EmbeddedSection();
  const modelMeta = getSelectedVideoModel();
  const kind = (modelMeta && modelMeta.kind) ? modelMeta.kind : currentVideoTab;
  const isKlingModel = !!(modelMeta && isKling3VideoKind(modelMeta.kind));
  const isLtx23Model = !!(modelMeta && isLtx23VideoModelId(modelMeta.id));
  const supportsReferenceImages = !modelMeta || modelMeta.usesImageUrls !== false;

  const showVideo = !isKlingModel && (kind === 'video-to-video' || kind === 'motion-control' || kind === 'video-id-to-video');
  const showImage = !isKlingModel && (kind === 'image-to-video' || kind === 'audio-to-video' || kind === 'motion-control' || kind === 'reference-to-video');
  const showRefs = !isKlingModel && supportsReferenceImages && (kind === 'reference-to-video' || kind === 'video-to-video');
  const showAudioModelRow = true;

  if (qs('videoUrlGroup')) qs('videoUrlGroup').style.display = showVideo ? 'block' : 'none';
  if (qs('videoFileGroup')) qs('videoFileGroup').style.display = showVideo ? 'block' : 'none';
  if (qs('videoImageFileGroup')) qs('videoImageFileGroup').style.display = showImage ? 'block' : 'none';
  if (qs('referenceImagesGroup')) qs('referenceImagesGroup').style.display = showRefs ? 'block' : 'none';

  const videoModelRow = qs('videoModel') ? qs('videoModel').closest('.settings-row') : null;
  if (videoModelRow) videoModelRow.style.display = showAudioModelRow ? '' : 'none';

  const showEndImage = !!(!isKlingModel && modelMeta && modelMeta.supportsEndImage && kind === 'image-to-video');
  if (qs('videoEndImageGroup')) qs('videoEndImageGroup').style.display = showEndImage ? 'block' : 'none';

  const showVideoId = !isKlingModel && kind === 'video-id-to-video';
  if (qs('videoIdGroup')) qs('videoIdGroup').style.display = showVideoId ? 'block' : 'none';

  // Show audio file upload for models that support audio_url
  const allowedOpts = (modelMeta && Array.isArray(modelMeta.allowedOptions)) ? modelMeta.allowedOptions : [];
  const showAudio = !isKlingModel && allowedOpts.includes('audio_url');
  if (qs('audioFileGroup')) qs('audioFileGroup').style.display = showAudio ? 'block' : 'none';

  const videoOptionsHost = qs('videoOptionsDynamic');
  if (videoOptionsHost) videoOptionsHost.style.display = isKlingModel ? 'none' : '';

  const ltxSection = qs('ltx23UploadGroup');
  if (ltxSection) ltxSection.style.display = isLtx23Model ? 'block' : 'none';

  const klingSection = qs('kling3UploadGroup');
  if (klingSection) klingSection.style.display = isKlingModel ? 'block' : 'none';

  if (isLtx23Model) {
    syncLtx23StateFromVideoModelId(modelMeta.id, { skipSave: true });
  }

  if (isKlingModel) {
    syncKling3StateFromVideoModelId(modelMeta.id, { skipSave: true });
    updateKling3UiVisibility();
  }
}

function update3dUiVisibility() {
  const meta = getSelected3dModelMeta();

  const imageWrap = qs('threeDImageUploadWrap');
  const showImageUpload = meta && meta.kind === 'image-to-3d';
  if (imageWrap) {
    const wasHidden = imageWrap.style.display === 'none';
    imageWrap.style.display = showImageUpload ? 'block' : 'none';
    if (showImageUpload && wasHidden) {
      const grid = imageWrap.querySelector('.upload-grid');
      if (grid) {
        grid.classList.remove('grid-enter');
        void grid.offsetWidth;
        grid.classList.add('grid-enter');
      }
    }
  }

  const showMultiView = meta && meta.id === 'fal-ai/hunyuan3d-v3/image-to-3d';
  const multiViewIds = ['threeDBackUploadItem', 'threeDLeftUploadItem', 'threeDRightUploadItem'];
  for (const mvId of multiViewIds) {
    const el = qs(mvId);
    if (el) el.style.display = showMultiView ? 'block' : 'none';
  }

  const isHunyuan = meta && (meta.id === 'fal-ai/hunyuan3d-v3/image-to-3d' || meta.id === 'fal-ai/hunyuan3d-v3/text-to-3d');
  const isMeshy = meta && (meta.id === 'fal-ai/meshy/v6-preview/image-to-3d' || meta.id === 'fal-ai/meshy/v6-preview/text-to-3d');
  const isRapid = meta && meta.id === 'fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d';
  const isTopology = meta && meta.id === 'fal-ai/hunyuan-3d/v3.1/smart-topology';
  const isRetexture = meta && meta.id === 'fal-ai/meshy/v5/retexture';

  const hunyuanWrap = qs('threeDHunyuanSettings');
  if (hunyuanWrap) {
    const wasHidden = hunyuanWrap.style.display === 'none';
    hunyuanWrap.style.display = isHunyuan ? 'grid' : 'none';
    if (isHunyuan && wasHidden) {
      hunyuanWrap.classList.remove('grid-enter');
      void hunyuanWrap.offsetWidth;
      hunyuanWrap.classList.add('grid-enter');
    }
  }

  const meshyWrap = qs('threeDMeshySettings');
  if (meshyWrap) {
    const wasHidden = meshyWrap.style.display === 'none';
    meshyWrap.style.display = isMeshy ? 'block' : 'none';
    if (isMeshy && wasHidden) {
      meshyWrap.querySelectorAll('.settings-grid').forEach(grid => {
        grid.classList.remove('grid-enter');
        void grid.offsetWidth;
        grid.classList.add('grid-enter');
      });
    }
  }

  const rapidWrap = qs('threeDRapidSettings');
  if (rapidWrap) {
    const wasHidden = rapidWrap.style.display === 'none';
    rapidWrap.style.display = isRapid ? 'grid' : 'none';
    if (isRapid && wasHidden) {
      rapidWrap.classList.remove('grid-enter');
      void rapidWrap.offsetWidth;
      rapidWrap.classList.add('grid-enter');
    }
  }

  const topoWrap = qs('threeDTopologySettings');
  if (topoWrap) {
    const wasHidden = topoWrap.style.display === 'none';
    topoWrap.style.display = isTopology ? 'block' : 'none';
    if (isTopology && wasHidden) {
      topoWrap.querySelectorAll('.settings-grid').forEach(grid => {
        grid.classList.remove('grid-enter');
        void grid.offsetWidth;
        grid.classList.add('grid-enter');
      });
    }
  }

  const retexWrap = qs('threeDRetextureSettings');
  if (retexWrap) {
    const wasHidden = retexWrap.style.display === 'none';
    retexWrap.style.display = isRetexture ? 'block' : 'none';
    if (isRetexture && wasHidden) {
      retexWrap.querySelectorAll('.settings-grid').forEach(grid => {
        grid.classList.remove('grid-enter');
        void grid.offsetWidth;
        grid.classList.add('grid-enter');
      });
    }
  }

  const isMeshyText = meta && meta.id === 'fal-ai/meshy/v6-preview/text-to-3d';
  const isMeshyImage = meta && meta.id === 'fal-ai/meshy/v6-preview/image-to-3d';
  const showIds = (ids, show) => {
    for (const id of ids) {
      const el = qs(id);
      if (el) el.style.display = show ? 'block' : 'none';
    }
  };
  showIds(['threeDMeshyTextOnly', 'threeDMeshyTextOnly2', 'threeDMeshyTextOnly3', 'threeDMeshyTextOnly4'], !!isMeshyText);
  showIds(['threeDMeshyImageOnly'], !!isMeshyImage);

  const typeEl = qs('threeDGenerateType');
  const polyEl = qs('threeDPolygonType');
  if (typeEl && polyEl) {
    const gt = String(typeEl.value || 'Normal');
    polyEl.disabled = gt !== 'LowPoly';
  }
}

function setActiveVideoTabButtonState(tab) {
  const ids = ['vtab-text', 'vtab-image', 'vtab-video', 'vtab-reference', 'vtab-audio'];
  for (const id of ids) {
    const el = qs(id);
    if (el) el.classList.remove('active');
  }
  const map = {
    'text-to-video': 'vtab-text',
    'image-to-video': 'vtab-image',
    'video-to-video': 'vtab-video',
    'reference-to-video': 'vtab-reference',
    'audio-to-video': 'vtab-audio',
  };
  if (map[tab] && qs(map[tab])) qs(map[tab]).classList.add('active');
}

function switchVideoTab(tab) {
  currentVideoTab = tab;
  setActiveVideoTabButtonState(tab);

  ensureVideoControls();
  if (videoModelsLoaded) {
    refreshVideoModelDropdown();
    updateVideoUiVisibility();
    renderVideoOptionsUI();
  } else {
    updateVideoUiVisibility();
  }
  
  // Animate video controls section
  const videoControls = qs('videoControlsContainer');
  if (videoControls) {
    videoControls.querySelectorAll('.settings-grid').forEach(grid => {
      grid.classList.remove('grid-enter');
      void grid.offsetWidth;
      grid.classList.add('grid-enter');
    });
  }

  if (typeof saveAppState === 'function') saveAppState();
}

// Helper to animate a settings grid
function animateGrid(el) {
  if (!el) return;
  el.classList.remove('grid-enter');
  void el.offsetWidth;
  el.classList.add('grid-enter');
}

// ==================== KLING 3 FUNCTIONS ====================
function getKling3ModelsForTab(tab) {
  return KLING3_MODELS[tab] || [];
}

function refreshKling3ModelDropdown(preferredId = '') {
  const sel = qs('kling3Model');
  if (!sel) return;
  const prev = sel.value;
  const items = getKling3ModelsForTab(currentKling3Tab);
  setSelectOptions(sel, items);
  const remembered = kling3SelectedModelByTab[currentKling3Tab];
  if (preferredId && Array.isArray(items) && items.some((m) => m.id === preferredId)) {
    sel.value = preferredId;
  } else if (remembered && Array.isArray(items) && items.some((m) => m.id === remembered)) {
    sel.value = remembered;
  } else if (prev && Array.isArray(items) && items.some((m) => m.id === prev)) {
    sel.value = prev;
  } else if (items[0]) {
    sel.value = items[0].id;
  }
}

function syncKling3StateFromVideoModelId(modelId, options = {}) {
  const klingTab = getKling3TabForModelId(modelId);
  if (!klingTab) return false;
  const klingSelect = qs('kling3Model');
  const currentKlingModelId = klingSelect ? String(klingSelect.value || '').trim() : '';
  if (currentKling3Tab === klingTab && currentKlingModelId === modelId) {
    kling3SelectedModelByTab[klingTab] = modelId;
    return true;
  }
  switchKling3Tab(klingTab, {
    skipVideoSelectionSync: true,
    skipSave: options.skipSave === true,
    preferredModelId: modelId,
  });
  return true;
}

function switchKling3Tab(tab, options = {}) {
  const prevTab = currentKling3Tab;
  const modelSel = qs('kling3Model');
  if (modelSel && prevTab) {
    kling3SelectedModelByTab[prevTab] = modelSel.value;
  }
  currentKling3Tab = tab;
  if (tab.startsWith('v3-')) {
    currentKling3Family = 'v3';
    kling3LastTabByFamily.v3 = tab;
  } else if (tab.startsWith('o3-')) {
    currentKling3Family = 'o3';
    kling3LastTabByFamily.o3 = tab;
  }
  const tabIds = ['k3tab-v3-text', 'k3tab-v3-image', 'k3tab-v3-motion', 'k3tab-o3-text', 'k3tab-o3-image', 'k3tab-o3-ref', 'k3tab-o3-v2v'];
  for (const id of tabIds) {
    const el = qs(id);
    if (el) el.classList.remove('active');
  }
  const map = {
    'v3-text-to-video': 'k3tab-v3-text',
    'v3-image-to-video': 'k3tab-v3-image',
    'v3-motion-control': 'k3tab-v3-motion',
    'o3-text-to-video': 'k3tab-o3-text',
    'o3-image-to-video': 'k3tab-o3-image',
    'o3-reference-to-video': 'k3tab-o3-ref',
    'o3-video-to-video': 'k3tab-o3-v2v',
  };
  if (map[tab] && qs(map[tab])) qs(map[tab]).classList.add('active');

  const v3Tabs = qs('kling3ModeTabsV3');
  const o3Tabs = qs('kling3ModeTabsO3');
  if (v3Tabs) v3Tabs.style.display = currentKling3Family === 'v3' ? 'flex' : 'none';
  if (o3Tabs) o3Tabs.style.display = currentKling3Family === 'o3' ? 'flex' : 'none';

  const v3Family = qs('k3family-v3');
  const o3Family = qs('k3family-o3');
  if (v3Family) v3Family.classList.toggle('active', currentKling3Family === 'v3');
  if (o3Family) o3Family.classList.toggle('active', currentKling3Family === 'o3');

  refreshKling3ModelDropdown(options.preferredModelId || '');
  if (modelSel && modelSel.value) {
    kling3SelectedModelByTab[currentKling3Tab] = modelSel.value;
  }

  if (!options.skipVideoSelectionSync) {
    const preferredVideoModelId = (modelSel && modelSel.value) ? modelSel.value : (options.preferredModelId || '');
    const nextVideoTab = getVideoTabForKling3Tab(tab);
    if (nextVideoTab) {
      currentVideoTab = nextVideoTab;
      setActiveVideoTabButtonState(nextVideoTab);
      if (qs('videoModel')) {
        refreshVideoModelDropdown(preferredVideoModelId);
      }
    }
  }

  updateKling3UiVisibility();
  if (!options.skipVideoSelectionSync) {
    updateVideoUiVisibility();
    renderVideoOptionsUI();
  }
  if (!options.skipSave && typeof saveAppState === 'function') saveAppState();
}
window.switchKling3Tab = switchKling3Tab;

function switchKling3Family(family, options = {}) {
  if (family !== 'v3' && family !== 'o3') return;
  currentKling3Family = family;
  const nextTab = kling3LastTabByFamily[family] || (family === 'v3' ? 'v3-text-to-video' : 'o3-text-to-video');
  switchKling3Tab(nextTab, options);
}
window.switchKling3Family = switchKling3Family;

function updateKling3UiVisibility() {
  const tab = currentKling3Tab;
  const isT2V = tab === 'v3-text-to-video' || tab === 'o3-text-to-video';
  const isI2V = tab === 'v3-image-to-video' || tab === 'o3-image-to-video';
  const isRef = tab === 'o3-reference-to-video';
  const isV2V = tab === 'o3-video-to-video';
  const isMotionTab = tab === 'v3-motion-control';
  const isV3 = tab.startsWith('v3-');
  const selectedModelId = getSelectedKling3ModelId();
  const isV2VEdit = selectedModelId === 'kling-o3-pro-v2v-edit';
  const isV2VRef = selectedModelId === 'kling-o3-pro-v2v-ref';
  const isMotionModel = isKling3MotionModelId(selectedModelId);
  const showMotionControls = isMotionTab || isMotionModel;
  const showMotionElements = showMotionControls && isKling3MotionOrientationVideo();
  const isV3Classic = isV3 && !showMotionControls;

  // Start image (for I2V, Ref and Motion modes)
  if (qs('kling3StartImageGroup')) qs('kling3StartImageGroup').style.display = (isI2V || isRef || showMotionControls) ? 'block' : 'none';
  // End image (for I2V and O3 Ref modes)
  if (qs('kling3EndImageGroup')) qs('kling3EndImageGroup').style.display = (isI2V || isRef) ? 'block' : 'none';
  // Video upload (for V2V and Motion modes)
  if (qs('kling3VideoGroup')) qs('kling3VideoGroup').style.display = (isV2V || showMotionControls) ? 'block' : 'none';
  // Reference images (for Ref and V2V modes)
  if (qs('kling3RefImagesGroup')) qs('kling3RefImagesGroup').style.display = (isRef || isV2V) ? 'block' : 'none';
  // Elements (for V3 I2V, O3 Ref/V2V, and V3 motion with video orientation)
  if (qs('kling3ElementsGroup')) qs('kling3ElementsGroup').style.display = ((isV3 && isI2V) || isRef || isV2V || showMotionElements) ? 'block' : 'none';

  if (showMotionControls && kling3Elements.length > 1) {
    kling3Elements = kling3Elements.slice(0, 1);
    renderKling3Elements();
  }

  // Motion-specific settings
  if (qs('kling3MotionSettings')) qs('kling3MotionSettings').style.display = showMotionControls ? 'grid' : 'none';

  // Shot type - V3 T2V has intelligent option, others only customize
  const shotTypeGroup = qs('kling3ShotTypeGroup');
  const shotTypeSel = qs('kling3ShotType');
  if (shotTypeGroup && shotTypeSel) {
    shotTypeGroup.style.display = (isT2V || isI2V || isRef || isV2V) ? 'block' : 'none';
    if (tab === 'v3-text-to-video') {
      shotTypeSel.innerHTML = '<option value="customize" selected>Customize</option><option value="intelligent">Intelligent</option>';
    } else {
      shotTypeSel.innerHTML = '<option value="customize" selected>Customize</option>';
    }
  }

  // CFG Scale / Negative prompt (classic V3 only)
  if (qs('kling3CfgScaleGroup')) qs('kling3CfgScaleGroup').style.display = isV3Classic ? 'block' : 'none';
  if (qs('kling3NegativePromptGroup')) qs('kling3NegativePromptGroup').style.display = isV3Classic ? 'block' : 'none';

  // Duration/Aspect for V2V: only V2V Reference supports these; hidden for motion-control
  if (qs('kling3DurationGroup')) {
    qs('kling3DurationGroup').style.display = (showMotionControls || (isV2V && isV2VEdit)) ? 'none' : 'block';
  }
  if (qs('kling3AspectRatioGroup')) {
    qs('kling3AspectRatioGroup').style.display = (showMotionControls || (isV2V && isV2VEdit)) ? 'none' : 'block';
  }

  // Audio settings (not for motion-control)
  const showAudioSettings = !showMotionControls && (isV3Classic || isT2V || isRef || tab === 'o3-image-to-video' || isV2V);
  if (qs('kling3AudioSettings')) qs('kling3AudioSettings').style.display = showAudioSettings ? 'grid' : 'none';
  if (qs('kling3KeepAudioGroup')) qs('kling3KeepAudioGroup').style.display = isV2V ? 'block' : 'none';

  // Voice IDs (V3 classic + O3 T2V)
  if (qs('kling3VoiceGroup')) qs('kling3VoiceGroup').style.display = (isV3Classic || tab === 'o3-text-to-video') ? 'block' : 'none';

  // Aspect ratio with auto option for O3 V2V
  const arSel = qs('kling3AspectRatio');
  if (arSel) {
    if (isV2V && isV2VRef) {
      const hasAuto = Array.from(arSel.options).some(o => o.value === 'auto');
      if (!hasAuto) {
        const opt = document.createElement('option');
        opt.value = 'auto';
        opt.textContent = 'Auto';
        arSel.insertBefore(opt, arSel.firstChild);
        arSel.value = 'auto';
      }
    } else {
      const autoOpt = Array.from(arSel.options).find(o => o.value === 'auto');
      if (autoOpt) arSel.removeChild(autoOpt);
      if (arSel.value === 'auto') arSel.value = '16:9';
    }
  }

  // Multi-prompt section (not for motion-control)
  if (qs('kling3MultiPromptSection')) {
    qs('kling3MultiPromptSection').style.display = (isT2V || isI2V) ? 'block' : 'none';
  }

  // Animate
  const controls = qs('kling3Controls');
  if (controls) {
    controls.querySelectorAll('.settings-grid').forEach(grid => animateGrid(grid));
  }
}
function initKling3Controls() {
  ['kling3StartImageInput', 'kling3EndImageInput', 'kling3VideoInput', 'kling3RefImagesInput'].forEach((inputId) => {
    bindManagedUploadById(inputId);
  });

  const multiPromptCheck = qs('kling3UseMultiPrompt');
  if (multiPromptCheck) {
    multiPromptCheck.addEventListener('change', () => {
      const container = qs('kling3MultiPromptContainer');
      if (container) {
        container.style.display = multiPromptCheck.checked ? 'block' : 'none';
        if (multiPromptCheck.checked && kling3MultiPrompts.length === 0) {
          addKling3MultiPromptItem();
        }
      }
    });
  }

  const modelSel = qs('kling3Model');
  if (modelSel) {
    modelSel.addEventListener('change', () => {
      kling3SelectedModelByTab[currentKling3Tab] = modelSel.value;
      if (qs('videoModel') && isKling3VideoModelId(modelSel.value)) {
        const nextVideoTab = getVideoTabForKling3Tab(currentKling3Tab);
        if (nextVideoTab) currentVideoTab = nextVideoTab;
        refreshVideoModelDropdown(modelSel.value);
        updateVideoUiVisibility();
        renderVideoOptionsUI();
      }
      updateKling3UiVisibility();
    });
  }

  const motionOrientationSel = qs('kling3MotionOrientation');
  if (motionOrientationSel) {
    motionOrientationSel.addEventListener('change', () => {
      updateKling3UiVisibility();
    });
  }
  ['kling3StartImageInput', 'kling3EndImageInput', 'kling3VideoInput', 'kling3RefImagesInput'].forEach((inputId) => {
    const inputEl = qs(inputId);
    if (inputEl) setupDropZone(inputEl.closest('.upload-zone'), inputEl);
  });
}

function addKling3MultiPromptItem() {
  const id = Date.now();
  kling3MultiPrompts.push({ id, prompt: '', duration: '5' });
  renderKling3MultiPrompts();
}
window.addKling3MultiPromptItem = addKling3MultiPromptItem;

function removeKling3MultiPromptItem(id) {
  kling3MultiPrompts = kling3MultiPrompts.filter(p => p.id !== id);
  renderKling3MultiPrompts();
}
window.removeKling3MultiPromptItem = removeKling3MultiPromptItem;

function renderKling3MultiPrompts() {
  const list = qs('kling3MultiPromptList');
  if (!list) return;

  list.innerHTML = kling3MultiPrompts.map((item, idx) => `
    <div class="multi-prompt-item" data-id="${item.id}" style="background:var(--surface);border:1px solid var(--border);border-radius:var(--radius-sm);padding:0.5rem;margin-bottom:0.5rem;">
      <div class="field">
        <label>Shot ${idx + 1} Prompt *</label>
        <textarea class="k3-mp-prompt" data-id="${item.id}" rows="2" style="width:100%;resize:vertical;" placeholder="Describe this shot...">${escapeHtml(item.prompt)}</textarea>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:flex-end;margin-top:0.35rem;">
        <div class="field" style="flex:1;">
          <label>Duration</label>
          <select class="k3-mp-duration" data-id="${item.id}">
            ${[3,4,5,6,7,8,9,10,11,12,13,14,15].map(d => `<option value="${d}" ${String(item.duration) === String(d) ? 'selected' : ''}>${d}s</option>`).join('')}
          </select>
        </div>
        <button type="button" onclick="removeKling3MultiPromptItem(${item.id})" style="background:var(--error);border:none;color:#fff;padding:0.4rem 0.6rem;border-radius:var(--radius-xs);cursor:pointer;">
          <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
        </button>
      </div>
    </div>
  `).join('');

  // Re-attach event listeners
  list.querySelectorAll('.k3-mp-prompt').forEach(el => {
    el.addEventListener('input', (e) => {
      const id = Number(e.target.dataset.id);
      const item = kling3MultiPrompts.find(p => p.id === id);
      if (item) item.prompt = e.target.value;
    });
  });
  list.querySelectorAll('.k3-mp-duration').forEach(el => {
    el.addEventListener('change', (e) => {
      const id = Number(e.target.dataset.id);
      const item = kling3MultiPrompts.find(p => p.id === id);
      if (item) item.duration = e.target.value;
    });
  });

  if (window.lucide) window.lucide.createIcons();
}

// Elements handling for Kling 3
function addKling3Element() {
  const selectedModelId = getSelectedKling3ModelId();
  if (isKling3MotionModelId(selectedModelId) && kling3Elements.length >= 1) {
    showToast(window.I18N ? I18N.t('toast_kling3_motion_one_element') : 'Kling 3 motion-control supports only one element.', 'error');
    return;
  }
  const id = Date.now();
  kling3Elements.push({ id, frontalImageFile: null, referenceImageFiles: [], videoFile: null });
  renderKling3Elements();
}
window.addKling3Element = addKling3Element;

function removeKling3Element(id) {
  kling3Elements = kling3Elements.filter(e => e.id !== id);
  renderKling3Elements();
}
window.removeKling3Element = removeKling3Element;

function handleElementFrontalUpload(id, file) {
  const item = kling3Elements.find(e => e.id === id);
  if (item) {
    item.frontalImageFile = file;
    renderKling3Elements();
  }
}

function handleElementRefUpload(id, files) {
  const item = kling3Elements.find(e => e.id === id);
  if (item) {
    item.referenceImageFiles = Array.from(files);
    renderKling3Elements();
  }
}

function handleElementVideoUpload(id, file) {
  const item = kling3Elements.find(e => e.id === id);
  if (item) {
    item.videoFile = file;
    renderKling3Elements();
  }
}

function renderKling3Elements() {
  const list = qs('kling3ElementsList');
  if (!list) return;

  const selectedModelId = getSelectedKling3ModelId();
  const isMotionModel = isKling3MotionModelId(selectedModelId);
  if (isMotionModel && kling3Elements.length > 1) {
    kling3Elements = kling3Elements.slice(0, 1);
  }
  const displayElements = isMotionModel ? kling3Elements.slice(0, 1) : kling3Elements;

  list.innerHTML = displayElements.map((item, idx) => {
    const gridColumns = isMotionModel ? '1fr 1fr' : '1fr 1fr 1fr';
    const videoFieldHtml = isMotionModel ? '' : `
        <div class="field">
          <label style="font-size:0.65rem;">${getI18nText('label_video_optional', 'Video (opt)')}</label>
          <div class="upload-zone small" onclick="document.getElementById('k3-el-video-${item.id}').click()" style="padding:0.3rem;font-size:0.65rem;">
            <i data-lucide="film" style="width:12px;height:12px;"></i>
            <span id="k3-el-video-label-${item.id}" style="font-size:0.6rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60px;">${escapeHtml(getI18nText('upload_video', 'Upload video'))}</span>
            <input type="file" id="k3-el-video-${item.id}" data-id="${item.id}" accept="video/*" hidden class="k3-el-video-input" />
          </div>
        </div>
    `;

    return `
    <div class="multi-prompt-item" data-id="${item.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;">
        <strong style="font-size:0.75rem;">@Element${idx + 1}</strong>
        <button type="button" onclick="removeKling3Element(${item.id})" title="${escapeHtml(getI18nText('btn_remove', 'Remove'))}" style="background:var(--error);border:none;color:#fff;padding:0.25rem 0.4rem;border-radius:var(--radius-xs);cursor:pointer;font-size:0.7rem;">
          <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
        </button>
      </div>
      <div style="display:grid;grid-template-columns:${gridColumns};gap:0.35rem;">
        <div class="field">
          <label style="font-size:0.65rem;">${getI18nText('label_frontal_image', 'Frontal Image')}</label>
          <div class="upload-zone small" onclick="document.getElementById('k3-el-frontal-${item.id}').click()" style="padding:0.3rem;font-size:0.65rem;">
            <i data-lucide="image" style="width:12px;height:12px;"></i>
            <span id="k3-el-frontal-label-${item.id}" style="font-size:0.6rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60px;">${escapeHtml(getI18nText('upload_frontal', 'Upload frontal'))}</span>
            <input type="file" id="k3-el-frontal-${item.id}" data-id="${item.id}" accept="image/*" hidden class="k3-el-frontal-input" />
          </div>
        </div>
        <div class="field">
          <label style="font-size:0.65rem;">${getI18nText('label_ref_images_short', 'Ref Images')}</label>
          <div class="upload-zone small" onclick="document.getElementById('k3-el-refs-${item.id}').click()" style="padding:0.3rem;font-size:0.65rem;">
            <i data-lucide="images" style="width:12px;height:12px;"></i>
            <span id="k3-el-refs-label-${item.id}" style="font-size:0.6rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60px;">${escapeHtml(getI18nText('upload_refs', 'Upload refs'))}</span>
            <input type="file" id="k3-el-refs-${item.id}" data-id="${item.id}" accept="image/*" multiple hidden class="k3-el-refs-input" />
          </div>
        </div>
        ${videoFieldHtml}
      </div>
    </div>
  `;
  }).join('');

  displayElements.forEach((item) => {
    const frontalInput = qs(`k3-el-frontal-${item.id}`);
    if (frontalInput) {
      bindManagedUploadInput(frontalInput, {
        labelId: `k3-el-frontal-label-${item.id}`,
        emptyKey: 'upload_frontal',
        previewKind: 'image',
        kind: 'image',
        multiple: false,
        getFiles: () => {
          const current = kling3Elements.find((entry) => entry.id === item.id);
          return current && current.frontalImageFile ? [current.frontalImageFile] : [];
        },
        getRemoteItems: () => {
          const current = kling3Elements.find((entry) => entry.id === item.id);
          return current && current.frontalImageUrl ? [current.frontalImageUrl] : [];
        },
        setFiles: (next) => {
          const current = kling3Elements.find((entry) => entry.id === item.id);
          if (current) current.frontalImageFile = next || null;
        },
        setRemoteItems: (next) => {
          const current = kling3Elements.find((entry) => entry.id === item.id);
          if (current) current.frontalImageUrl = next && next.url ? next.url : '';
        },
      });
      setupDropZone(frontalInput.closest('.upload-zone'), frontalInput);
    }

    const refsInput = qs(`k3-el-refs-${item.id}`);
    if (refsInput) {
      bindManagedUploadInput(refsInput, {
        labelId: `k3-el-refs-label-${item.id}`,
        emptyKey: 'upload_refs',
        previewKind: 'image',
        kind: 'image',
        multiple: true,
        getFiles: () => {
          const current = kling3Elements.find((entry) => entry.id === item.id);
          return current ? current.referenceImageFiles : [];
        },
        getRemoteItems: () => {
          const current = kling3Elements.find((entry) => entry.id === item.id);
          return current ? current.referenceImageUrls || [] : [];
        },
        setFiles: (next) => {
          const current = kling3Elements.find((entry) => entry.id === item.id);
          if (current) current.referenceImageFiles = next;
        },
        setRemoteItems: (next) => {
          const current = kling3Elements.find((entry) => entry.id === item.id);
          if (current) current.referenceImageUrls = Array.isArray(next) ? next.map((entry) => entry.url).filter(Boolean) : [];
        },
      });
      setupDropZone(refsInput.closest('.upload-zone'), refsInput);
    }

    const videoInput = qs(`k3-el-video-${item.id}`);
    if (videoInput) {
      bindManagedUploadInput(videoInput, {
        labelId: `k3-el-video-label-${item.id}`,
        emptyKey: 'upload_video',
        previewKind: 'video',
        kind: 'video',
        multiple: false,
        getFiles: () => {
          const current = kling3Elements.find((entry) => entry.id === item.id);
          return current && current.videoFile ? [current.videoFile] : [];
        },
        getRemoteItems: () => {
          const current = kling3Elements.find((entry) => entry.id === item.id);
          return current && current.videoUrl ? [current.videoUrl] : [];
        },
        setFiles: (next) => {
          const current = kling3Elements.find((entry) => entry.id === item.id);
          if (current) current.videoFile = next || null;
        },
        setRemoteItems: (next) => {
          const current = kling3Elements.find((entry) => entry.id === item.id);
          if (current) current.videoUrl = next && next.url ? next.url : '';
        },
      });
      setupDropZone(videoInput.closest('.upload-zone'), videoInput);
    }
  });

  if (window.lucide) window.lucide.createIcons();
}

function collectKling3Options() {
  const options = {};
  const currentTab = currentKling3Tab || 'v3-text-to-video';
  const isMotion = currentTab === 'v3-motion-control';

  if (!isMotion) {
    // Use the specific option keys that match allowedOptions in VIDEO_MODELS
    const duration = qs('kling3Duration') ? qs('kling3Duration').value : '5';
    options.duration_kling3 = duration;

    const aspectRatio = qs('kling3AspectRatio') ? qs('kling3AspectRatio').value : '16:9';
    options.aspect_ratio_kling3 = aspectRatio;

    // Shot type - V3 T2V uses shot_type_v3 (customize/intelligent), others use shot_type_customize
    const shotType = qs('kling3ShotType') ? qs('kling3ShotType').value : 'customize';
    if (currentTab === 'v3-text-to-video') {
      options.shot_type_v3 = shotType;
    } else {
      options.shot_type_customize = shotType;
    }

    // O3 V2V uses aspect_ratio_o3_v2v with 'auto' option
    if (currentTab === 'o3-video-to-video') {
      options.aspect_ratio_o3_v2v = aspectRatio;
    }

    const cfgScale = qs('kling3CfgScale') ? qs('kling3CfgScale').value : '';
    if (cfgScale) options.cfg_scale = Number(cfgScale);

    const negPrompt = qs('kling3NegativePrompt') ? qs('kling3NegativePrompt').value.trim() : '';
    if (negPrompt) options.negative_prompt = negPrompt;

    const genAudio = qs('kling3GenerateAudio') ? qs('kling3GenerateAudio').value : 'true';
    options.generate_audio = genAudio === 'true';

    const keepAudio = qs('kling3KeepAudio') ? qs('kling3KeepAudio').value : 'true';
    options.keep_audio = keepAudio === 'true';

    const voiceIds = qs('kling3VoiceIds') ? qs('kling3VoiceIds').value.trim() : '';
    if (voiceIds) {
      options.voice_ids = voiceIds.split(',').map(s => s.trim()).filter(Boolean).slice(0, 2);
    }
  } else {
    const orientation = qs('kling3MotionOrientation') ? qs('kling3MotionOrientation').value : 'video';
    options.character_orientation_kling3_motion = orientation || 'video';

    const keepOriginalSound = qs('kling3KeepOriginalSound') ? qs('kling3KeepOriginalSound').value : 'true';
    options.keep_original_sound = keepOriginalSound === 'true';
  }

  // Elements will be handled separately in submitKling3Request (file uploads)
  const validElements = kling3Elements.filter((e) => (
    e.frontalImageFile
    || e.frontalImageUrl
    || (Array.isArray(e.referenceImageFiles) && e.referenceImageFiles.length > 0)
    || (Array.isArray(e.referenceImageUrls) && e.referenceImageUrls.length > 0)
    || e.videoFile
    || e.videoUrl
  ));
  if (validElements.length > 0) {
    options.hasElements = true;
  }

  return options;
}
async function submitKling3Request(task) {
  const modelId = getSelectedKling3ModelId(task && task.model_id ? task.model_id : '');
  const prompt = task.prompt;
  const options = collectKling3Options();

  const body = { model_id: modelId };

  // Check for multi-prompt mode
  const isMotionModel = isKling3MotionModelId(modelId);
  const useMultiPrompt = !isMotionModel && qs('kling3UseMultiPrompt') && qs('kling3UseMultiPrompt').checked;
  if (useMultiPrompt && kling3MultiPrompts.length > 0) {
    const validPrompts = kling3MultiPrompts.filter(p => p.prompt.trim());
    if (validPrompts.length === 0) throw new Error('At least one multi-prompt shot is required');
    body.multi_prompt = validPrompts.map(p => ({
      prompt: p.prompt.trim(),
      duration: p.duration,
    }));
  } else {
    if (!prompt && !isMotionModel) throw new Error('Prompt is required');
    if (prompt) body.prompt = prompt;
  }

  // Pass all options via body.options - backend will filter based on allowedOptions
  const mergedOptions = { ...options };
  
  // keep_audio goes directly on body for V2V models
  if (options.keep_audio !== undefined) {
    body.keep_audio = options.keep_audio;
    delete mergedOptions.keep_audio;
  }
  
  // Remove hasElements marker from options (we'll handle it below)
  delete mergedOptions.hasElements;

  if (Object.keys(mergedOptions).length > 0) body.options = mergedOptions;
  // Upload element files and build elements array
  const motionOrientation = qs('kling3MotionOrientation') ? qs('kling3MotionOrientation').value : 'video';
  const includeElements = !isMotionModel || motionOrientation === 'video';
  const sourceElements = isMotionModel ? kling3Elements.slice(0, 1) : kling3Elements;

  if (options.hasElements && sourceElements.length > 0 && includeElements) {
    const elementsArray = [];
    for (const el of sourceElements) {
      const hasRefImages = (Array.isArray(el.referenceImageFiles) && el.referenceImageFiles.length > 0)
        || (Array.isArray(el.referenceImageUrls) && el.referenceImageUrls.length > 0);
      if (isMotionModel) {
        if (!el.frontalImageFile && !el.frontalImageUrl && !hasRefImages) continue;
      } else if (!el.frontalImageFile && !el.frontalImageUrl && !el.videoFile && !el.videoUrl && !hasRefImages) {
        continue;
      }

      const elementObj = {};

      // Upload frontal image
      const frontalSource = (el.frontalImageUrl && createRemoteAssetItem({ url: el.frontalImageUrl, type: 'image' })) || el.frontalImageFile;
      if (frontalSource) {
        const u = await resolveUploadItemUrl(frontalSource, 'kling3-el-frontal', task);
        if (u) elementObj.frontal_image_url = u;
      }

      // Upload reference images
      const elementRefSources = [
        ...normalizeRemoteAssetItems(el.referenceImageUrls, 'image'),
        ...(Array.isArray(el.referenceImageFiles) ? el.referenceImageFiles : []),
      ];
      if (elementRefSources.length > 0) {
        const refUrls = await resolveUploadItemUrls(elementRefSources, 'kling3-el-ref', task, isMotionModel ? 3 : Infinity);
        if (refUrls.length > 0) elementObj.reference_image_urls = refUrls;
      }

      // Upload video (not supported for Kling 3 motion-control elements)
      const elementVideoSource = (el.videoUrl && createRemoteAssetItem({ url: el.videoUrl, type: 'video' })) || el.videoFile;
      if (!isMotionModel && elementVideoSource) {
        const u = await resolveUploadItemUrl(elementVideoSource, 'kling3-el-video', task);
        if (u) elementObj.video_url = u;
      }

      if (Object.keys(elementObj).length > 0) {
        elementsArray.push(elementObj);
      }
    }
    if (elementsArray.length > 0) {
      body.elements = elementsArray;
    }
  }

  // Upload images
  const kling3StartSource = getManagedUploadRemoteItems(MANAGED_UPLOADS.kling3StartImageInput)[0] || uploadedKling3StartImage;
  if (kling3StartSource) {
    const u = await resolveUploadItemUrl(kling3StartSource, 'kling3-start', task);
    if (u) body.image_url = u;
  }

  const kling3EndSource = getManagedUploadRemoteItems(MANAGED_UPLOADS.kling3EndImageInput)[0] || uploadedKling3EndImage;
  if (kling3EndSource) {
    const u = await resolveUploadItemUrl(kling3EndSource, 'kling3-end', task);
    if (u) body.end_image_url = u;
  }

  // Video URL or upload
  const videoUrl = qs('kling3VideoUrlInput') ? qs('kling3VideoUrlInput').value.trim() : '';
  if (videoUrl) body.video_url = videoUrl;
  const kling3VideoSource = getManagedUploadRemoteItems(MANAGED_UPLOADS.kling3VideoInput)[0] || uploadedKling3Video;
  if (kling3VideoSource) {
    const u = await resolveUploadItemUrl(kling3VideoSource, 'kling3-video', task);
    if (u) body.video_url = u;
  }

  // Reference images
  const kling3RefSources = [
    ...getManagedUploadRemoteItems(MANAGED_UPLOADS.kling3RefImagesInput),
    ...(Array.isArray(uploadedKling3RefImages) ? uploadedKling3RefImages : []),
  ];
  if (kling3RefSources.length > 0) {
    const imageUrls = await resolveUploadItemUrls(kling3RefSources, 'kling3-ref', task, 4);
    if (imageUrls.length > 0) body.image_urls = imageUrls;
  }

  const res = await fetch('/api/video-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await createResponseError(res, 'Video generation failed');
  return await res.json();
}

function updateTextModelOptions() {
  const modelSel = qs('imageModelText');
  const modelId = modelSel ? modelSel.value : '';
  
  const fluxOpts = qs('fluxAdvancedOptions');
  const gptOpts = qs('gptImageOptions');
  const nanoOpts = qs('nanoBananaOptions');
  const nano2Opts = qs('nanoBanana2Options');
  const aspectGroup = qs('aspectRatioBaseGroup');
  
  const isFlux = modelId === 'flux-pro-v1.1-ultra';
  const isGpt = modelId === 'gpt-image-1.5';
  const isNano = modelId === 'nano-banana-pro';
  const isNano2 = modelId === 'nano-banana-2';
  
  if (fluxOpts) {
    fluxOpts.style.display = isFlux ? 'grid' : 'none';
    if (isFlux) animateGrid(fluxOpts);
  }
  if (gptOpts) {
    gptOpts.style.display = isGpt ? 'grid' : 'none';
    if (isGpt) animateGrid(gptOpts);
  }
  if (nanoOpts) {
    nanoOpts.style.display = isNano ? 'grid' : 'none';
    if (isNano) animateGrid(nanoOpts);
  }
  if (nano2Opts) {
    nano2Opts.style.display = isNano2 ? 'grid' : 'none';
    if (isNano2) animateGrid(nano2Opts);
  }
  if (aspectGroup) aspectGroup.style.display = isGpt ? 'none' : 'block';
}

function updateEditModelOptions() {
  const modelSel = qs('imageModelEdit');
  const modelId = modelSel ? modelSel.value : '';
  
  const gptEditOpts = qs('gptEditOptions');
  const nanoEditOpts = qs('nanoEditOptions');
  const nano2EditOpts = qs('nano2EditOptions');
  
  const isGpt = modelId === 'gpt-image-1.5/edit';
  const isNano = modelId === 'nano-banana-pro/edit';
  const isNano2 = modelId === 'nano-banana-2/edit';
  
  if (gptEditOpts) {
    gptEditOpts.style.display = isGpt ? 'block' : 'none';
    if (isGpt) animateGrid(gptEditOpts);
  }
  if (nanoEditOpts) {
    nanoEditOpts.style.display = isNano ? 'block' : 'none';
    if (isNano) animateGrid(nanoEditOpts);
  }
  if (nano2EditOpts) {
    nano2EditOpts.style.display = isNano2 ? 'block' : 'none';
    if (isNano2) animateGrid(nano2EditOpts);
  }
}

// Animate section entrance
function animateSection(el) {
  if (!el) return;
  el.classList.remove('section-enter');
  // Force reflow to restart animation
  void el.offsetWidth;
  el.classList.add('section-enter');
  
  // Animate child grids
  el.querySelectorAll('.settings-grid').forEach(grid => {
    grid.classList.remove('grid-enter');
    void grid.offsetWidth;
    grid.classList.add('grid-enter');
  });
  el.querySelectorAll('.upload-grid').forEach(grid => {
    grid.classList.remove('grid-enter');
    void grid.offsetWidth;
    grid.classList.add('grid-enter');
  });
  el.querySelectorAll('.sub-tabs').forEach(tabs => {
    tabs.classList.remove('sub-tabs-enter');
    void tabs.offsetWidth;
    tabs.classList.add('sub-tabs-enter');
  });
}

function switchMode(mode) {
  if (mode === 'kling3') mode = 'video';
  currentMode = mode;

  const modeIds = ['mode-text', 'mode-image', 'mode-video', 'mode-kling3', 'mode-3d', 'mode-tools'];
  for (const id of modeIds) {
    const el = qs(id);
    if (el) el.classList.remove('active');
  }
  const activeBtn = qs(`mode-${mode}`);
  if (activeBtn) activeBtn.classList.add('active');

  // Hide all sections first
  const sections = ['imageUploadGroup', 'videoUploadGroup', 'kling3UploadGroup', 'threeDUploadGroup', 'basicOptions', 'toolsSection'];
  sections.forEach(id => {
    const el = qs(id);
    if (el) {
      el.style.display = 'none';
      el.classList.remove('section-enter');
    }
  });

  // Show and animate the active section
  if (mode === 'text') {
    const el = qs('basicOptions');
    if (el) {
      el.style.display = 'block';
      animateSection(el);
    }
    updateTextModelOptions();
  }
  if (mode === 'image') {
    const el = qs('imageUploadGroup');
    if (el) {
      el.style.display = 'block';
      animateSection(el);
    }
    updateEditModelOptions();
  }
  if (mode === 'video') {
    const el = qs('videoUploadGroup');
    if (el) {
      el.style.display = 'block';
      animateSection(el);
    }
    ensureVideoControls();
    updateVideoUiVisibility();
  }
  if (mode === '3d') {
    const el = qs('threeDUploadGroup');
    if (el) {
      el.style.display = 'block';
      animateSection(el);
    }
    update3dUiVisibility();
  }
  if (mode === 'tools') {
    const el = qs('toolsSection');
    if (el) {
      el.style.display = 'block';
      animateSection(el);
    }
    initToolsControls();
    enterWizFullscreen();
  } else {
    exitWizFullscreen();
  }

  // Hide/show prompt group & generate btn (tools mode has its own)
  const promptGroup = qs('promptGroup');
  if (promptGroup) promptGroup.style.display = mode === 'tools' ? 'none' : '';
  const genBtn = qs('generateBtn');
  if (genBtn) genBtn.style.display = mode === 'tools' ? 'none' : '';
  // Show @1/@2 reference hint only in image-edit mode
  const imgRefHint = qs('promptImgRefHint');
  if (imgRefHint) imgRefHint.style.display = mode === 'image' ? '' : 'none';

  requestAnimationFrame(() => {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons();
    }
  });

  if (typeof saveAppState === 'function') saveAppState();
}

// Make functions available to inline HTML handlers
window.switchMode = switchMode;
window.switchVideoTab = switchVideoTab;

// ---- TOOLS WIZARD ----
const WIZ_TOTAL = 6;
let _wizStep = 0;
let _wizAnimating = false;
let _toolsInitialized = false;

// Max images per model
const WIZ_MAX_IMAGES = EDIT_MAX_IMAGES;
function wizMaxImages() {
  const m = qs('toolsModel') ? qs('toolsModel').value : DEFAULT_TOOLS_MODEL;
  return WIZ_MAX_IMAGES[m] || WIZ_MAX_IMAGES[DEFAULT_TOOLS_MODEL] || 4;
}
// --- Translated chip data ---
const WIZ_TITLE_CHIPS = {
  en: ['Premium Quality','Best Seller','New Season','Best Choice','Top Sales','Ideal Gift','Maximum Comfort','Stylish Design'],
  es: ['Calidad Premium','Más vendido','Novedad de temporada','Mejor elección','Top ventas','Regalo ideal','Máximo confort','Diseño elegante'],
  zh: ['优质品质','畅销热品','新品上市','最佳选择','销量冠军','理想礼物','极致舒适','时尚设计'],
  ar: ['جودة ممتازة','الأكثر مبيعًا','جديد الموسم','الخيار الأفضل','الأعلى مبيعًا','هدية مثالية','راحة قصوى','تصميم أنيق'],
  fr: ['Qualité Premium','Best-seller','Nouveauté saison','Meilleur choix','Top ventes','Cadeau idéal','Confort maximal','Design élégant'],
  ru: ['Премиум качество','Хит продаж','Новинка сезона','Лучший выбор','Топ продаж','Идеальный подарок','Максимальный комфорт','Стильный дизайн'],
  pt: ['Qualidade Premium','Mais vendido','Novidade da temporada','Melhor escolha','Top vendas','Presente ideal','Máximo conforto','Design elegante'],
  de: ['Premium Qualität','Bestseller','Neuheit der Saison','Beste Wahl','Top Verkäufe','Ideales Geschenk','Maximaler Komfort','Stilvolles Design'],
  ja: ['プレミアム品質','大人気商品','新作','ベストチョイス','売上トップ','理想のギフト','最高の快適さ','スタイリッシュデザイン'],
  ko: ['프리미엄 품질','베스트셀러','신상품','최고의 선택','판매 1위','이상적인 선물','최고의 편안함','스타일리시 디자인'],
};
const WIZ_CHAR_CHIPS = {
  en: ['Natural materials','Size: S-XXL','Waterproof','Hypoallergenic','Handmade','Quality guarantee','Eco-friendly','High durability','Easy care','Premium packaging','Thermal insulation','Lightweight'],
  es: ['Materiales naturales','Talla: S-XXL','Impermeable','Hipoalergénico','Hecho a mano','Garantía de calidad','Ecológico','Alta durabilidad','Fácil cuidado','Embalaje premium','Aislamiento térmico','Ligero'],
  zh: ['天然材料','尺码: S-XXL','防水','低敏','手工制作','品质保证','环保','高耐久','易打理','精美包装','隔热','轻量'],
  ar: ['مواد طبيعية','المقاس: S-XXL','مقاوم للماء','مضاد للحساسية','صناعة يدوية','ضمان الجودة','صديق للبيئة','متانة عالية','سهل العناية','تغليف فاخر','عزل حراري','خفيف الوزن'],
  fr: ['Matériaux naturels','Taille: S-XXL','Imperméable','Hypoallergénique','Fait main','Garantie qualité','Écologique','Haute durabilité','Entretien facile','Emballage premium','Isolation thermique','Léger'],
  ru: ['Натуральные материалы','Размер: S-XXL','Водонепроницаемый','Гипоаллергенный','Ручная работа','Гарантия качества','Экологичный','Высокая прочность','Лёгкий уход','Премиум упаковка','Термоизоляция','Лёгкий вес'],
  pt: ['Materiais naturais','Tamanho: S-XXL','Impermeável','Hipoalergênico','Feito à mão','Garantia de qualidade','Ecológico','Alta durabilidade','Fácil manutenção','Embalagem premium','Isolamento térmico','Leve'],
  de: ['Naturmaterialien','Größe: S-XXL','Wasserdicht','Hypoallergen','Handarbeit','Qualitätsgarantie','Umweltfreundlich','Hohe Haltbarkeit','Pflegeleicht','Premium-Verpackung','Wärmedämmung','Leichtgewicht'],
  ja: ['天然素材','サイズ: S-XXL','防水','低アレルギー','ハンドメイド','品質保証','エコフレンドリー','高耐久性','お手入れ簡単','プレミアム梱包','断熱性','軽量'],
  ko: ['천연 소재','사이즈: S-XXL','방수','저자극성','수제','품질 보증','친환경','높은 내구성','관리 용이','프리미엄 포장','단열','경량'],
};

// --- Font style data (name, CSS inline style, prompt value) ---
const WIZ_FONTS = [
  { name: 'Bold Sans', css: 'font-weight:900;letter-spacing:-0.03em;font-family:var(--font-body);', val: 'wiz_font_bold_sans' },
  { name: 'Elegant Serif', css: 'font-family:var(--font-display);font-style:italic;font-weight:400;', val: 'wiz_font_elegant_serif' },
  { name: 'Geometric', css: 'font-weight:600;letter-spacing:0.12em;text-transform:uppercase;font-size:0.95rem;', val: 'wiz_font_geometric' },
  { name: 'Soft Rounded', css: 'font-weight:500;letter-spacing:0.04em;font-family:var(--font-body);', val: 'wiz_font_soft_rounded' },
  { name: 'Classic', css: 'font-weight:700;font-family:var(--font-display);letter-spacing:0.02em;', val: 'wiz_font_classic' },
  { name: 'Handwritten', css: "font-family:'Segoe Script','Bradley Hand',cursive;", val: 'wiz_font_handwritten' },
  { name: 'Thin Light', css: 'font-weight:300;letter-spacing:0.06em;font-family:var(--font-body);', val: 'wiz_font_thin_light' },
  { name: 'Monospace', css: "font-family:'Courier New',Courier,monospace;font-weight:700;", val: 'wiz_font_monospace' },
  { name: 'Display Bold', css: 'font-weight:700;font-family:var(--font-display);font-size:1.5rem;letter-spacing:-0.03em;', val: 'wiz_font_display_bold' },
  { name: 'Condensed', css: 'font-weight:600;letter-spacing:-0.06em;font-stretch:condensed;font-family:var(--font-body);', val: 'wiz_font_condensed' },
  { name: 'Extra Bold', css: 'font-weight:800;font-family:var(--font-body);letter-spacing:0.02em;', val: 'wiz_font_extra_bold' },
  { name: 'Thin Serif', css: 'font-weight:200;font-family:var(--font-display);letter-spacing:0.04em;', val: 'wiz_font_thin_serif' },
  { name: 'Wide Caps', css: 'font-weight:600;letter-spacing:0.25em;text-transform:uppercase;font-size:0.8rem;', val: 'wiz_font_wide_caps' },
  { name: 'Italic Classic', css: 'font-style:italic;font-weight:700;font-family:var(--font-display);', val: 'wiz_font_italic_classic' },
  { name: 'Script', css: "font-family:'Segoe Script','Brush Script MT',cursive;font-weight:400;font-size:1.3rem;", val: 'wiz_font_script' },
  { name: 'Stencil', css: 'font-weight:900;letter-spacing:0.15em;text-transform:uppercase;font-family:var(--font-body);', val: 'wiz_font_stencil' },
  { name: 'Rounded Bold', css: 'font-weight:700;letter-spacing:0.03em;font-family:var(--font-body);', val: 'wiz_font_rounded_bold' },
  { name: 'Slab Serif', css: "font-weight:700;font-family:'Rockwell','Courier New',serif;letter-spacing:0.01em;", val: 'wiz_font_slab_serif' },
  { name: 'Neon Glow', css: 'font-weight:400;font-family:var(--font-body);letter-spacing:0.08em;text-shadow:0 0 4px var(--accent-bright);', val: 'wiz_font_neon_glow' },
  { name: 'Retro', css: "font-weight:700;font-family:'Courier New',monospace;letter-spacing:0.1em;text-transform:uppercase;font-size:0.85rem;", val: 'wiz_font_retro' },
  { name: 'Minimalist', css: 'font-weight:400;font-family:var(--font-body);letter-spacing:0.08em;', val: 'wiz_font_minimalist' },
  { name: 'Black Impact', css: "font-weight:900;font-family:'Impact','Arial Black',sans-serif;letter-spacing:0.01em;", val: 'wiz_font_black_impact' },
  { name: 'Calligraphy', css: "font-family:'Segoe Script','Palatino',cursive;font-weight:300;font-style:italic;font-size:1.2rem;", val: 'wiz_font_calligraphy' },
  { name: 'Futuristic', css: 'font-weight:600;letter-spacing:0.18em;text-transform:uppercase;font-family:var(--font-body);font-size:0.75rem;', val: 'wiz_font_futuristic' },
  { name: 'Art Deco', css: 'font-weight:700;letter-spacing:0.1em;font-family:var(--font-display);text-transform:uppercase;font-size:0.9rem;', val: 'wiz_font_art_deco' },
  { name: 'Playful', css: "font-weight:700;font-family:'Comic Sans MS','Segoe UI',sans-serif;letter-spacing:0.02em;", val: 'wiz_font_playful' },
  { name: 'Newspaper', css: "font-weight:700;font-family:'Times New Roman',Times,serif;font-style:italic;", val: 'wiz_font_newspaper' },
  { name: 'Gothic', css: "font-weight:900;font-family:'Trebuchet MS',var(--font-body);letter-spacing:-0.02em;text-transform:uppercase;", val: 'wiz_font_gothic' },
  { name: 'Brush Stroke', css: "font-family:'Segoe Script','Bradley Hand',cursive;font-weight:700;font-size:1.4rem;", val: 'wiz_font_brush_stroke' },
  { name: 'Tech Narrow', css: "font-weight:500;font-family:'Arial Narrow',var(--font-body);letter-spacing:0.04em;font-stretch:condensed;", val: 'wiz_font_tech_narrow' },
  { name: 'Vintage Label', css: "font-weight:700;font-family:'Georgia',serif;letter-spacing:0.08em;text-transform:uppercase;font-size:0.85rem;border-bottom:2px solid currentColor;padding-bottom:2px;", val: 'wiz_font_vintage_label' },
  { name: 'Luxury Thin', css: "font-weight:200;font-family:'Didot','Georgia',serif;letter-spacing:0.15em;text-transform:uppercase;font-size:0.8rem;", val: 'wiz_font_luxury_thin' },
  { name: 'Grunge Bold', css: "font-weight:900;font-family:'Impact','Arial Black',sans-serif;letter-spacing:-0.02em;text-transform:uppercase;", val: 'wiz_font_grunge_bold' },
  { name: 'Elegant Italic', css: "font-weight:300;font-family:'Palatino','Georgia',serif;font-style:italic;letter-spacing:0.04em;font-size:1.15rem;", val: 'wiz_font_elegant_italic' },
  { name: 'Tech Mono', css: "font-weight:600;font-family:'Consolas','Courier New',monospace;letter-spacing:0.06em;font-size:0.85rem;", val: 'wiz_font_tech_mono' },
  { name: 'Rounded Soft', css: "font-weight:500;font-family:'Trebuchet MS',var(--font-body);letter-spacing:0.06em;", val: 'wiz_font_rounded_soft' },
  { name: 'Stamp', css: "font-weight:900;letter-spacing:0.12em;text-transform:uppercase;font-size:0.78rem;border:2px solid currentColor;padding:2px 6px;display:inline-block;", val: 'wiz_font_stamp' },
  { name: 'Handprint', css: "font-family:'Comic Sans MS','Segoe Script',cursive;font-weight:400;letter-spacing:0.02em;font-size:1.1rem;", val: 'wiz_font_handprint' },
  { name: 'Corporate', css: "font-weight:600;font-family:'Cambria','Georgia',serif;letter-spacing:0.03em;", val: 'wiz_font_corporate' },
  { name: 'Poster Bold', css: "font-weight:900;font-family:var(--font-body);letter-spacing:-0.04em;font-size:1.6rem;line-height:1;", val: 'wiz_font_poster_bold' },
  { name: 'Whisper Light', css: "font-weight:100;font-family:var(--font-body);letter-spacing:0.12em;font-size:0.9rem;", val: 'wiz_font_whisper_light' },
  { name: 'Typewriter', css: "font-weight:400;font-family:'Courier New',monospace;letter-spacing:0.08em;font-size:0.82rem;", val: 'wiz_font_typewriter' },
  { name: 'Magazine', css: "font-weight:700;font-family:'Georgia',serif;font-size:1.3rem;letter-spacing:-0.01em;font-style:italic;", val: 'wiz_font_magazine' },
  { name: 'Clean Modern', css: "font-weight:500;font-family:'Segoe UI','Helvetica',sans-serif;letter-spacing:0.04em;", val: 'wiz_font_clean_modern' },
  { name: 'Heavy Shadow', css: "font-weight:900;font-family:var(--font-body);letter-spacing:0.02em;text-shadow:2px 2px 0 rgba(0,0,0,0.2);font-size:1.2rem;", val: 'wiz_font_heavy_shadow' },
  { name: 'Outline', css: "font-weight:700;font-family:var(--font-body);letter-spacing:0.06em;-webkit-text-stroke:1px currentColor;color:transparent;font-size:1.2rem;", val: 'wiz_font_outline' },
  { name: 'Small Caps', css: "font-weight:600;font-family:'Georgia',serif;font-variant:small-caps;letter-spacing:0.08em;font-size:0.95rem;", val: 'wiz_font_small_caps' },
  { name: 'Sporty', css: "font-weight:800;font-family:'Impact','Arial Black',sans-serif;font-style:italic;letter-spacing:0.02em;font-size:1.15rem;", val: 'wiz_font_sporty' },
  { name: 'Chalk', css: "font-weight:400;font-family:'Segoe Script','Bradley Hand',cursive;letter-spacing:0.03em;font-size:1.1rem;opacity:0.9;", val: 'wiz_font_chalk' },
];

function initToolsControls() {
  if (_toolsInitialized) return;
  _toolsInitialized = true;

  const imgInput = qs('toolsImageInput');
  if (imgInput) {
    imgInput.addEventListener('change', (e) => {
      const newFiles = Array.from(e.target.files || []);
      const max = wizMaxImages();
      uploadedToolsImages = [...uploadedToolsImages, ...newFiles].slice(0, max);
      if (uploadedToolsImages.length >= max) {
        showToast(window.I18N ? I18N.t('wiz_max_images').replace('{n}', max) : `Maximum ${max} images`);
      }
      updateToolsImagePreview();
      saveAppState();
      e.target.value = '';
    });
  }

  const dropzone = qs('toolsImageDropzone');
  if (dropzone && imgInput) setupDropZone(dropzone, imgInput);

  wizBuildTitleChips();
  wizBuildCharChips();
  wizBuildFontCards();
  wizLoadInspoPresets();
  wizInitInspoUpload();
  wizUpdateToolsSettings();

  // Hook into locale application (covers both init() and setLang()) to rebuild chips
  if (!window._wizLangHooked && window.I18N && window.I18N.applyLocale) {
    window._wizLangHooked = true;
    const _origApply = window.I18N.applyLocale.bind(window.I18N);
    window.I18N.applyLocale = function() {
      _origApply.call(this);
      if (_toolsInitialized) {
        wizBuildTitleChips();
        wizBuildCharChips();
      }
    };
  }

  // Restore wizard state if available
  const rs = window._wizRestoredState;
  if (rs) {
    // Restore characteristics
    if (rs.chars && rs.chars.length > 0) {
      const list = qs('toolsCharList');
      if (list) list.innerHTML = '';
      rs.chars.forEach(c => toolsAddChar(c));
    }
    // Auto-resize title if restored
    requestAnimationFrame(() => { const t = qs('toolsTitleInput'); if (t) wizAutoResize(t); });
    // Restore selected presets (after presets are loaded)
    if (rs.selectedPresets && rs.selectedPresets.length > 0) {
      const waitPresets = () => {
        if (_wizInspoPresets.length > 0 || document.querySelector('.wiz-inspo-empty')) {
          _wizSelectedPresets = new Set(rs.selectedPresets);
          const container = document.getElementById('wizInspoPresets');
          if (container) container.querySelectorAll('.wiz-inspo-card').forEach(c => c.classList.toggle('wiz-inspo-on', _wizSelectedPresets.has(c.dataset.presetId)));
        } else {
          setTimeout(waitPresets, 100);
        }
      };
      setTimeout(waitPresets, 200);
    }
    // Restore step (jump without animation)
    if (typeof rs.step === 'number' && rs.step > 0 && rs.step < WIZ_TOTAL) {
      _wizStep = rs.step;
      const panels = document.querySelectorAll('[data-wiz-panel]');
      panels.forEach(p => { p.style.display = 'none'; p.style.opacity = ''; p.classList.remove('wiz-panel-active','wiz-panel-intro'); });
      const target = document.querySelector(`[data-wiz-panel="${rs.step}"]`);
      if (target) { target.style.display = 'block'; target.style.opacity = '1'; target.classList.add('wiz-panel-active'); }
    } else {
      _wizStep = 0;
    }
    delete window._wizRestoredState;
  } else {
    _wizStep = 0;
  }
  wizUpdateUI();

  // Restore images from IndexedDB
  wizIdbRestoreImages();

  requestAnimationFrame(() => { if (window.lucide) window.lucide.createIcons(); });
}

// --- Wizard fullscreen ---
function enterWizFullscreen() {
  document.body.classList.add('wiz-fullscreen');
}
function exitWizFullscreen() {
  document.body.classList.remove('wiz-fullscreen');
}
window.enterWizFullscreen = enterWizFullscreen;
window.exitWizFullscreen = exitWizFullscreen;

// --- Wizard navigation ---
function wizGoTo(step) {
  if (_wizAnimating || step === _wizStep || step < 0 || step >= WIZ_TOTAL) return;
  // Only allow jumping to completed steps or next
  if (step > _wizStep + 1) return;
  enterWizFullscreen();
  const dir = step > _wizStep ? 'fwd' : 'bwd';
  _wizTransition(_wizStep, step, dir);
}
window.wizGoTo = wizGoTo;

function wizNext() {
  if (_wizStep >= WIZ_TOTAL - 1) {
    handleGenerate();
    exitWizFullscreen();
    return;
  }
  wizGoTo(_wizStep + 1);
}
window.wizNext = wizNext;

function wizPrev() {
  wizGoTo(_wizStep - 1);
}
window.wizPrev = wizPrev;

function _wizTransition(from, to, dir) {
  _wizAnimating = true;
  const panels = document.querySelectorAll('[data-wiz-panel]');
  const fromEl = document.querySelector(`[data-wiz-panel="${from}"]`);
  const toEl = document.querySelector(`[data-wiz-panel="${to}"]`);
  if (!fromEl || !toEl) { _wizAnimating = false; return; }

  // Remove all state classes
  panels.forEach(p => p.classList.remove('wiz-panel-active','wiz-exit-fwd','wiz-exit-bwd','wiz-enter-fwd','wiz-enter-bwd'));

  // Animate out (keep inline opacity so exit starts visible)
  fromEl.style.display = 'block';
  fromEl.classList.add(dir === 'fwd' ? 'wiz-exit-fwd' : 'wiz-exit-bwd');
  // Animate in — clear inline styles so CSS class applies
  toEl.style.display = '';
  toEl.style.opacity = '';
  toEl.classList.add(dir === 'fwd' ? 'wiz-enter-fwd' : 'wiz-enter-bwd');

  _wizStep = to;
  wizUpdateUI();
  saveAppState();

  // After animation, clean up
  setTimeout(() => {
    panels.forEach(p => {
      p.classList.remove('wiz-panel-active','wiz-panel-intro','wiz-exit-fwd','wiz-exit-bwd','wiz-enter-fwd','wiz-enter-bwd');
      p.style.display = 'none';
      p.style.opacity = '';
    });
    toEl.style.display = 'block';
    toEl.style.opacity = '1';
    toEl.classList.add('wiz-panel-active');
    _wizAnimating = false;
    requestAnimationFrame(() => { if (window.lucide) window.lucide.createIcons(); });
  }, 450);
}

function wizUpdateUI() {
  // Progress bar fill
  const fill = qs('wizFill');
  if (fill) fill.style.width = `${(_wizStep / (WIZ_TOTAL - 1)) * 100}%`;

  // Dots
  document.querySelectorAll('[data-wiz-dot]').forEach(dot => {
    const s = Number(dot.dataset.wizDot);
    dot.classList.remove('wiz-dot-active', 'wiz-dot-done');
    if (s === _wizStep) dot.classList.add('wiz-dot-active');
    else if (s < _wizStep) dot.classList.add('wiz-dot-done');
  });

  // Counter
  const counter = qs('wizCounter');
  if (counter) counter.textContent = `${_wizStep + 1} / ${WIZ_TOTAL}`;

  // Back button
  const backBtn = qs('wizBackBtn');
  if (backBtn) backBtn.setAttribute('data-hidden', _wizStep === 0 ? 'true' : 'false');

  // Next button: last step = Generate
  const nextBtn = qs('wizNextBtn');
  if (nextBtn) {
    const _t = (k, fb) => window.I18N ? I18N.t(k) : fb;
    if (_wizStep === WIZ_TOTAL - 1) {
      nextBtn.innerHTML = `<i data-lucide="sparkles"></i><span>${_t('wiz_btn_generate','Generate')}</span>`;
      nextBtn.classList.add('wiz-gen-btn');
    } else {
      nextBtn.innerHTML = `<span>${_t('wiz_btn_next','Next')}</span><i data-lucide="arrow-right"></i>`;
      nextBtn.classList.remove('wiz-gen-btn');
    }
  }

  // Image strip (visible on steps 1+)
  updateWizImgStrip();

  // Disable generate button when no images uploaded
  wizUpdateGenBtn();

  requestAnimationFrame(() => { if (window.lucide) window.lucide.createIcons(); });
}

function wizUpdateGenBtn() {
  const nextBtn = qs('wizNextBtn');
  if (!nextBtn) return;
  const isLastStep = _wizStep === WIZ_TOTAL - 1;
  const noImages = uploadedToolsImages.length === 0;
  const shouldDisable = isLastStep && noImages;
  nextBtn.disabled = shouldDisable;
  nextBtn.classList.toggle('wiz-btn-disabled', shouldDisable);
}
window.wizUpdateGenBtn = wizUpdateGenBtn;


// --- Image strip ---
function updateWizImgStrip() {
  const strip = qs('wizImgStrip');
  if (!strip) return;
  clearPreviewBlobUrls(strip);
  strip.innerHTML = '';
  if (uploadedToolsImages.length === 0 || _wizStep === 0) return;

  uploadedToolsImages.forEach((file, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'wiz-img-thumb';
    const img = document.createElement('img');
    img.src = getPreviewSrcForAssetItem(file, strip);
    thumb.appendChild(img);

    const acts = document.createElement('div');
    acts.className = 'wiz-img-thumb-actions';
    const editBtn = document.createElement('button');
    editBtn.type = 'button'; editBtn.className = 'wiz-img-thumb-btn'; editBtn.title = 'Sketch';
    editBtn.innerHTML = '<i data-lucide="pen-tool"></i>';
    editBtn.onclick = (e) => { e.stopPropagation(); openSketchEditor(i); };
    acts.appendChild(editBtn);
    const rmBtn = document.createElement('button');
    rmBtn.type = 'button'; rmBtn.className = 'wiz-img-thumb-btn'; rmBtn.title = 'Remove';
    rmBtn.innerHTML = '<i data-lucide="x"></i>';
    rmBtn.onclick = (e) => { e.stopPropagation(); uploadedToolsImages.splice(i, 1); updateToolsImagePreview(); saveAppState(); };
    acts.appendChild(rmBtn);
    thumb.appendChild(acts);
    strip.appendChild(thumb);
  });

  // Add "+" button to strip if under max
  if (uploadedToolsImages.length < wizMaxImages()) {
    const addThumb = document.createElement('div');
    addThumb.className = 'wiz-img-thumb wiz-img-add';
    addThumb.innerHTML = '<i data-lucide="plus"></i>';
    addThumb.onclick = () => { const inp = qs('toolsImageInput'); if (inp) inp.click(); };
    strip.appendChild(addThumb);
  }
}

// --- Preset storage helpers ---
const TITLE_PRESETS_KEY = 'nano_title_presets';
const CHAR_PRESETS_KEY  = 'nano_char_presets';

function _getStoreForKey(key) {
  const scopedKey = getScopedStorageKey(key);
  try { return JSON.parse(localStorage.getItem(scopedKey) || '{}'); } catch(_) { return {}; }
}
function _saveStoreForKey(key, store) {
  try { localStorage.setItem(getScopedStorageKey(key), JSON.stringify(store)); } catch(_) {}
  if (key === TITLE_PRESETS_KEY || key === CHAR_PRESETS_KEY) queueAccountTextPresetSync();
}
function _getLangData(key, lang) {
  const store = _getStoreForKey(key);
  if (!store[lang]) store[lang] = { removed: [], custom: [] };
  if (!Array.isArray(store[lang].removed)) store[lang].removed = [];
  if (!Array.isArray(store[lang].custom)) store[lang].custom = [];
  return store[lang];
}

function _getPresetStore()         { return _getStoreForKey(TITLE_PRESETS_KEY); }
function _savePresetStore(store)   { _saveStoreForKey(TITLE_PRESETS_KEY, store); }
function _getLangPresets(lang)     { return _getLangData(TITLE_PRESETS_KEY, lang); }
function _getLangCharPresets(lang) { return _getLangData(CHAR_PRESETS_KEY, lang); }

function getUserTitlePresets(lang) {
  const { removed, custom } = _getLangPresets(lang);
  const defaults = WIZ_TITLE_CHIPS[lang] || WIZ_TITLE_CHIPS['en'];
  return [...defaults.filter(t => !removed.includes(t)), ...custom];
}
function getUserCharPresets(lang) {
  const { removed, custom } = _getLangCharPresets(lang);
  const defaults = WIZ_CHAR_CHIPS[lang] || WIZ_CHAR_CHIPS['en'];
  return [...defaults.filter(t => !removed.includes(t)), ...custom];
}

// --- Build title chips dynamically ---
function wizBuildTitleChips() {
  const container = document.getElementById('wizTitleChips');
  if (!container) return;
  const lang = window.I18N ? I18N.lang : 'en';
  const chips = getUserTitlePresets(lang);
  const currentVal = document.getElementById('toolsTitleInput') ? document.getElementById('toolsTitleInput').value : '';
  container.innerHTML = '';
  chips.forEach(text => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wiz-chip' + (text === currentVal ? ' wiz-chip-on' : '');
    btn.textContent = text;
    btn.onclick = function() { wizPickChip('toolsTitleInput', this); };
    container.appendChild(btn);
  });
}
window.wizBuildTitleChips = wizBuildTitleChips;

// --- Preset Manager (context-aware: 'title' | 'char') ---
let _pmContext = 'title';

function openPresetManager(ctx) {
  _pmContext = ctx || 'title';
  // Update panel title
  const titleEl = document.getElementById('presetManagerPanel')?.querySelector('.pm-title');
  if (titleEl && window.I18N) {
    titleEl.textContent = I18N.t(_pmContext === 'char' ? 'wiz_char_preset_title' : 'wiz_preset_title');
  }
  _pmRender();
  document.getElementById('presetManagerBackdrop')?.classList.add('pm-backdrop--open');
  document.getElementById('presetManagerPanel')?.classList.add('pm-panel--open');
  setTimeout(() => { document.getElementById('pmAddInput')?.focus(); }, 320);
}
window.openPresetManager = openPresetManager;

function closePresetManager() {
  document.getElementById('presetManagerBackdrop')?.classList.remove('pm-backdrop--open');
  document.getElementById('presetManagerPanel')?.classList.remove('pm-panel--open');
}
window.closePresetManager = closePresetManager;

function _pmGetDefaults(lang) {
  return _pmContext === 'char'
    ? (WIZ_CHAR_CHIPS[lang] || WIZ_CHAR_CHIPS['en'])
    : (WIZ_TITLE_CHIPS[lang] || WIZ_TITLE_CHIPS['en']);
}
function _pmGetLangData(lang) {
  return _pmContext === 'char' ? _getLangCharPresets(lang) : _getLangPresets(lang);
}
function _pmGetStore() {
  return _getStoreForKey(_pmContext === 'char' ? CHAR_PRESETS_KEY : TITLE_PRESETS_KEY);
}
function _pmSaveStore(store) {
  _saveStoreForKey(_pmContext === 'char' ? CHAR_PRESETS_KEY : TITLE_PRESETS_KEY, store);
}
function _pmRebuildChips() {
  if (_pmContext === 'char') wizBuildCharChips();
  else wizBuildTitleChips();
}

function _pmMakeChip(text, onDelete) {
  const chip = document.createElement('div');
  chip.className = 'pm-chip';
  const label = document.createElement('span');
  label.textContent = text;
  label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'pm-chip-del';
  del.innerHTML = '&#x2715;';
  del.onclick = (e) => { e.stopPropagation(); onDelete(); };
  chip.onclick = () => {
    if (_pmContext === 'char') {
      toolsAddChar(text);
    } else {
      const inp = document.getElementById('toolsTitleInput');
      if (inp) { inp.value = text; inp.dispatchEvent(new Event('input')); saveAppState(); }
    }
    closePresetManager();
    _pmRebuildChips();
  };
  chip.appendChild(label);
  chip.appendChild(del);
  return chip;
}

function _pmRender() {
  const lang = window.I18N ? I18N.lang : 'en';
  const { removed, custom } = _pmGetLangData(lang);
  const defaults = _pmGetDefaults(lang);
  const body = document.getElementById('presetManagerBody');
  if (!body) return;
  const t = (key) => window.I18N ? I18N.t(key) : key;
  body.innerHTML = '';

  // Quick picks section
  const sec1 = document.createElement('div');
  const lbl1 = document.createElement('div');
  lbl1.className = 'pm-section-label';
  lbl1.textContent = t('wiz_preset_defaults');
  sec1.appendChild(lbl1);
  const grid1 = document.createElement('div');
  grid1.className = 'pm-chips-grid';
  const activeDefaults = defaults.filter(d => !removed.includes(d));
  if (activeDefaults.length === 0) {
    const e = document.createElement('div');
    e.className = 'pm-empty'; e.textContent = '—';
    grid1.appendChild(e);
  } else {
    activeDefaults.forEach(text => grid1.appendChild(_pmMakeChip(text, () => pmRemoveDefault(text))));
  }
  sec1.appendChild(grid1);
  if (removed.length > 0) {
    const rb = document.createElement('button');
    rb.type = 'button'; rb.className = 'pm-restore-btn';
    rb.innerHTML = '<i data-lucide="rotate-ccw"></i> ' + t('wiz_preset_reset_defaults');
    rb.onclick = pmRestoreDefaults;
    sec1.appendChild(rb);
  }
  body.appendChild(sec1);

  // My presets section
  const sec2 = document.createElement('div');
  const lbl2 = document.createElement('div');
  lbl2.className = 'pm-section-label';
  lbl2.textContent = t('wiz_preset_custom');
  sec2.appendChild(lbl2);
  const grid2 = document.createElement('div');
  grid2.className = 'pm-chips-grid';
  if (custom.length === 0) {
    const e = document.createElement('div');
    e.className = 'pm-empty'; e.textContent = t('wiz_preset_empty_custom');
    grid2.appendChild(e);
  } else {
    custom.forEach((text, idx) => grid2.appendChild(_pmMakeChip(text, () => pmDeleteCustom(idx))));
  }
  sec2.appendChild(grid2);
  body.appendChild(sec2);

  if (window.lucide) lucide.createIcons({ attrs: { 'stroke-width': '1.5' } });
}
window.renderPresetManager = _pmRender;

function pmRemoveDefault(text) {
  const lang = window.I18N ? I18N.lang : 'en';
  const store = _pmGetStore();
  if (!store[lang]) store[lang] = { removed: [], custom: [] };
  if (!store[lang].removed.includes(text)) store[lang].removed.push(text);
  _pmSaveStore(store);
  _pmRender(); _pmRebuildChips();
}
window.pmRemoveDefault = pmRemoveDefault;

function pmDeleteCustom(idx) {
  const lang = window.I18N ? I18N.lang : 'en';
  const store = _pmGetStore();
  if (store[lang]?.custom) store[lang].custom.splice(idx, 1);
  _pmSaveStore(store);
  _pmRender(); _pmRebuildChips();
}
window.pmDeleteCustom = pmDeleteCustom;

function pmRestoreDefaults() {
  const lang = window.I18N ? I18N.lang : 'en';
  const store = _pmGetStore();
  if (store[lang]) store[lang].removed = [];
  _pmSaveStore(store);
  _pmRender(); _pmRebuildChips();
}
window.pmRestoreDefaults = pmRestoreDefaults;

function pmAddPreset() {
  const inp = document.getElementById('pmAddInput');
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;
  const lang = window.I18N ? I18N.lang : 'en';
  const store = _pmGetStore();
  if (!store[lang]) store[lang] = { removed: [], custom: [] };
  if (!store[lang].custom) store[lang].custom = [];
  if (!store[lang].custom.includes(text)) {
    store[lang].custom.push(text);
    _pmSaveStore(store);
    _pmRebuildChips();
  }
  inp.value = '';
  _pmRender();
  inp.focus();
}
window.pmAddPreset = pmAddPreset;

// --- Build characteristic chips dynamically ---
function wizBuildCharChips() {
  const container = document.getElementById('wizCharChips');
  if (!container) return;
  const lang = window.I18N ? I18N.lang : 'en';
  const chips = getUserCharPresets(lang);
  // Remember which texts are already used
  const usedTexts = new Set();
  document.querySelectorAll('.tools-char-item input[type="text"], .tools-char-item textarea.wiz-char-input').forEach(inp => {
    if (inp.value.trim()) usedTexts.add(inp.value.trim());
  });
  container.innerHTML = '';
  chips.forEach(text => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wiz-chip-sm';
    if (usedTexts.has(text)) btn.classList.add('wiz-chip-used');
    btn.textContent = text;
    btn.onclick = function() { wizQuickChar(this); };
    container.appendChild(btn);
  });
}
window.wizBuildCharChips = wizBuildCharChips;

// --- Build font cards dynamically ---
function wizBuildFontCards(filter) {
  const track = document.getElementById('wizFontTrack');
  if (!track) return;
  const previewInput = qs('wizFontPreviewText');
  const previewText = previewInput ? (previewInput.value.trim() || 'Aa') : 'Aa';
  const currentVal = qs('toolsFontInput') ? qs('toolsFontInput').value : '';
  const q = (filter || '').toLowerCase();
  track.innerHTML = '';
  WIZ_FONTS.forEach(f => {
    if (q && !f.name.toLowerCase().includes(q)) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wiz-font-card';
    const promptVal = window.I18N ? I18N.t(f.val) : f.name;
    btn.dataset.val = promptVal;
    if (currentVal === promptVal) btn.classList.add('wiz-font-on');
    btn.innerHTML = `<span class="wiz-font-preview" style="${f.css}">${previewText}</span><span class="wiz-font-name">${f.name}</span>`;
    btn.onclick = function() { wizPickFont(this); };
    track.appendChild(btn);
  });
  requestAnimationFrame(() => {
    wizInitFontScrollbar();
    wizSyncFontScrollbar();
    if (window.lucide) window.lucide.createIcons({ el: document.querySelector('.wiz-font-scroll-hint-line') });
  });
}
window.wizBuildFontCards = wizBuildFontCards;

function wizFilterFonts() {
  const search = qs('wizFontSearch');
  wizBuildFontCards(search ? search.value.trim() : '');
}
window.wizFilterFonts = wizFilterFonts;

// --- Chip/preset pickers ---
function wizPickChip(inputId, btn) {
  const input = qs(inputId);
  if (!input || !btn) return;
  input.value = btn.textContent.trim();
  const parent = btn.closest('.wiz-chips');
  if (parent) parent.querySelectorAll('.wiz-chip').forEach(c => c.classList.remove('wiz-chip-on'));
  btn.classList.add('wiz-chip-on');
}
window.wizPickChip = wizPickChip;

function wizPickFont(btn) {
  if (!btn) return;
  const val = btn.dataset.val || btn.textContent.trim();
  const input = qs('toolsFontInput');
  if (input) input.value = val;
  document.querySelectorAll('.wiz-font-card').forEach(c => c.classList.remove('wiz-font-on'));
  btn.classList.add('wiz-font-on');
}
window.wizPickFont = wizPickFont;

function wizUpdateFontPreview() {
  const input = qs('wizFontPreviewText');
  const text = input ? input.value.trim() : '';
  const display = text || 'Aa';
  document.querySelectorAll('.wiz-font-preview').forEach(el => {
    el.textContent = display;
  });
}
window.wizUpdateFontPreview = wizUpdateFontPreview;

function wizSyncFontScrollbar() {
  const scroll = document.getElementById('wizFontScroll');
  const thumb = document.getElementById('wizFontScrollThumb');
  if (!scroll || !thumb) return;
  const maxScroll = scroll.scrollWidth - scroll.clientWidth;
  if (maxScroll <= 0) {
    thumb.style.width = '100%';
    thumb.style.left = '0%';
    return;
  }
  const ratio = scroll.scrollLeft / maxScroll;
  const thumbPct = Math.max(12, Math.min(80, (scroll.clientWidth / scroll.scrollWidth) * 100));
  const maxLeft = 100 - thumbPct;
  thumb.style.width = thumbPct + '%';
  thumb.style.left = (ratio * maxLeft) + '%';
}
window.wizSyncFontScrollbar = wizSyncFontScrollbar;

function wizInitFontScrollbar() {
  const scroll = document.getElementById('wizFontScroll');
  if (!scroll || scroll._sbInited) return;
  scroll._sbInited = true;
  scroll.addEventListener('scroll', () => requestAnimationFrame(wizSyncFontScrollbar), { passive: true });
  if (window.ResizeObserver) {
    new ResizeObserver(() => requestAnimationFrame(wizSyncFontScrollbar)).observe(scroll);
  }
  /* PC drag-to-scroll */
  let isDragging = false, dragStartX = 0, scrollStartX = 0;
  scroll.addEventListener('mousedown', e => {
    isDragging = true;
    dragStartX = e.clientX;
    scrollStartX = scroll.scrollLeft;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    scroll.scrollLeft = scrollStartX - (e.clientX - dragStartX);
  });
  document.addEventListener('mouseup', () => { isDragging = false; });
}
window.wizInitFontScrollbar = wizInitFontScrollbar;

function wizQuickChar(btn) {
  if (!btn) return;
  const text = btn.textContent.trim();
  btn.classList.add('wiz-chip-used');
  toolsAddChar(text);
}
window.wizQuickChar = wizQuickChar;

// --- Model-aware settings visibility ---
function wizUpdateToolsSettings() {
  const model = qs('toolsModel') ? qs('toolsModel').value : DEFAULT_TOOLS_MODEL;
  const isNano2 = model === 'nano-banana-2/edit';
  const isNanoPro = model === 'nano-banana-pro/edit';
  const isGpt = model === 'gpt-image-1.5/edit';

  // Resolution: available for nano models only
  const fRes = document.getElementById('toolsFieldResolution');
  if (fRes) fRes.style.display = isGpt ? 'none' : '';

  // Aspect: available for all
  const fAsp = document.getElementById('toolsFieldAspect');
  if (fAsp) fAsp.style.display = '';

  // Web search: nano models
  const fWeb = document.getElementById('toolsFieldWebSearch');
  if (fWeb) fWeb.style.display = isGpt ? 'none' : '';

  // Google search: nano-banana-2 only
  const fGoogle = document.getElementById('toolsFieldGoogleSearch');
  if (fGoogle) fGoogle.style.display = isNano2 ? '' : 'none';

  // Seed: nano-banana-2 only
  const fSeed = document.getElementById('toolsFieldSeed');
  if (fSeed) fSeed.style.display = isNano2 ? '' : 'none';

  // Enforce image limit for model change
  const max = wizMaxImages();
  if (uploadedToolsImages.length > max) {
    uploadedToolsImages = uploadedToolsImages.slice(0, max);
    updateToolsImagePreview();
  }
  // Update upload hint
  const hint = document.querySelector('.wiz-drop-hint');
  if (hint) hint.textContent = `PNG, JPG ${window.I18N ? I18N.t('wiz_upload_hint_up_to') : 'up to'} ${max} ${window.I18N ? I18N.t('wiz_upload_hint_images') : 'images'}`;
}
window.wizUpdateToolsSettings = wizUpdateToolsSettings;

// --- Auto-resize helper for growing textareas ---
function wizAutoResize(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function autoResizePromptInput() {
  const promptInput = qs('promptInput');
  if (!promptInput) return;
  wizAutoResize(promptInput);
}

// Delegate auto-resize to all .wiz-input-grow and .wiz-char-input textareas
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t && (t.id === 'promptInput' || t.classList.contains('wiz-input-grow') || t.classList.contains('wiz-char-input'))) {
    wizAutoResize(t);
  }
});

window.addEventListener('resize', autoResizePromptInput);

// --- Simplified char items (no inline select) ---
function toolsAddChar(prefill) {
  const list = qs('toolsCharsList');
  if (!list) return;
  toolsCharsCount++;
  const idx = toolsCharsCount;
  const item = document.createElement('div');
  item.className = 'tools-char-item';
  item.id = `toolsChar-${idx}`;
  const charPh = window.I18N ? I18N.t('wiz_char_placeholder') : 'e.g. Natural materials';
  item.innerHTML = `
    <textarea id="toolsCharInput-${idx}" class="wiz-char-input" placeholder="${charPh}" rows="1">${prefill ? prefill.replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''}</textarea>
    <button type="button" class="tools-char-remove" onclick="toolsRemoveChar('toolsChar-${idx}')" style="align-self:flex-start;margin-top:2px">
      <i data-lucide="x"></i>
    </button>
  `;
  list.appendChild(item);
  // Expand to fit prefilled text immediately
  requestAnimationFrame(() => {
    const ta = item.querySelector('.wiz-char-input');
    if (ta) wizAutoResize(ta);
    if (window.lucide) window.lucide.createIcons();
  });
}
window.toolsAddChar = toolsAddChar;

function toolsRemoveChar(id) {
  const el = document.getElementById(id);
  if (el) {
    const input = el.querySelector('input[type="text"], textarea.wiz-char-input');
    if (input && input.value.trim()) {
      const text = input.value.trim();
      document.querySelectorAll('.wiz-chip-sm.wiz-chip-used').forEach(chip => {
        if (chip.textContent.trim() === text) chip.classList.remove('wiz-chip-used');
      });
    }
    el.remove();
  }
}
window.toolsRemoveChar = toolsRemoveChar;

// --- Image preview (step 0 grid + strip) ---
function updateToolsImagePreview() {
  const grid = qs('toolsImagePreviewGrid');
  const label = qs('toolsImageLabel');
  if (!grid) return;
  clearPreviewBlobUrls(grid);
  grid.innerHTML = '';
  if (label) label.textContent = uploadedToolsImages.length > 0
    ? `${uploadedToolsImages.length} image(s)` : (window.I18N ? I18N.t('wiz_upload_text') : 'Click or drag product images');

  uploadedToolsImages.forEach((file, i) => {
    const item = document.createElement('div');
    item.className = 'upload-preview-item';
    item.style.position = 'relative';
    const img = document.createElement('img');
    img.src = getPreviewSrcForAssetItem(file, grid);
    img.alt = getAssetItemName(file, 'image');
    item.appendChild(img);

    // Number badge
    const numBadge = document.createElement('span');
    numBadge.className = 'img-num-badge';
    numBadge.textContent = i + 1;
    item.appendChild(numBadge);

    const actions = document.createElement('div');
    actions.className = 'tools-img-actions';
    const sketchBtn = document.createElement('button');
    sketchBtn.type = 'button'; sketchBtn.className = 'tools-img-action-btn'; sketchBtn.title = 'Edit / Sketch';
    sketchBtn.innerHTML = '<i data-lucide="pen-tool"></i>';
    sketchBtn.onclick = () => openSketchEditor(i, uploadedToolsImages, updateToolsImagePreview);
    actions.appendChild(sketchBtn);
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button'; removeBtn.className = 'tools-img-action-btn'; removeBtn.title = 'Remove';
    removeBtn.innerHTML = '<i data-lucide="x"></i>';
    removeBtn.onclick = () => { uploadedToolsImages.splice(i, 1); updateToolsImagePreview(); saveAppState(); };
    actions.appendChild(removeBtn);
    item.appendChild(actions);
    grid.appendChild(item);
  });

  // Also update floating strip
  updateWizImgStrip();
  wizUpdateGenBtn();
  requestAnimationFrame(() => { if (window.lucide) window.lucide.createIcons(); });
}

// ---- DESIGN INSPIRATION ----
let _wizInspoPresets = [];         // built-in presets from presets.json
let _wizCustomPresets = [];        // user-added presets {id, name, dataUrl|src, addedAt|createdAt, storagePath}
let _wizSelectedPresets = new Set();
let _wizHiddenBuiltins = new Set(); // built-in preset IDs hidden by user
let _wizPresetNameOverrides = {};   // {presetId: overriddenName}
let uploadedInspoImages = [];       // kept for backwards compat

// --- Storage keys ---
const INSPO_HIDDEN_KEY  = 'nano_inspo_hidden';
const INSPO_NAMES_KEY   = 'nano_inspo_names';
const INSPO_STATE_META_KEY = 'nano_inspo_state_meta';
const INSPO_IDB_NAME    = 'nano_custom_presets_db';
const INSPO_IDB_STORE   = 'presets';

// --- IndexedDB helpers for custom presets ---
function _inspoIdbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(INSPO_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(INSPO_IDB_STORE))
        req.result.createObjectStore(INSPO_IDB_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror  = () => reject(req.error);
  });
}
function getInspoPresetOwnerKey(explicitScope) {
  const scope = explicitScope === undefined ? getActiveAccountStorageScope() : explicitScope;
  return scope ? String(scope) : '__guest__';
}

function normalizeInspoStateMeta(raw) {
  return {
    updatedAt: Number.isFinite(Number(raw && raw.updatedAt)) ? Number(raw.updatedAt) : 0,
    lastSyncedAt: Number.isFinite(Number(raw && raw.lastSyncedAt)) ? Number(raw.lastSyncedAt) : 0,
    dirty: !!(raw && raw.dirty),
  };
}

function readInspoLocalStateMeta(explicitScope) {
  return normalizeInspoStateMeta(readStoredJson(getScopedStorageKey(INSPO_STATE_META_KEY, explicitScope), {}));
}

function writeInspoLocalStateMeta(meta, explicitScope) {
  try {
    localStorage.setItem(
      getScopedStorageKey(INSPO_STATE_META_KEY, explicitScope),
      JSON.stringify(normalizeInspoStateMeta(meta)),
    );
  } catch (_) {}
}

function markInspoLocalStateDirty(explicitScope) {
  const current = readInspoLocalStateMeta(explicitScope);
  writeInspoLocalStateMeta({
    updatedAt: Date.now(),
    lastSyncedAt: current.lastSyncedAt || 0,
    dirty: true,
  }, explicitScope);
}

function markInspoLocalStateClean(explicitScope) {
  const current = readInspoLocalStateMeta(explicitScope);
  writeInspoLocalStateMeta({
    updatedAt: current.updatedAt || Date.now(),
    lastSyncedAt: Date.now(),
    dirty: false,
  }, explicitScope);
}

function hasDesignPresetStateContent(state) {
  const nextState = state || {};
  return !!(
    (Array.isArray(nextState.hiddenBuiltins) && nextState.hiddenBuiltins.length > 0)
    || (nextState.nameOverrides && typeof nextState.nameOverrides === 'object' && Object.keys(nextState.nameOverrides).length > 0)
    || (Array.isArray(nextState.customPresets) && nextState.customPresets.length > 0)
  );
}

async function _inspoIdbSave(preset) {
  const db = await _inspoIdbOpen();
  const nextPreset = { ...preset, ownerKey: preset && preset.ownerKey ? preset.ownerKey : getInspoPresetOwnerKey() };
  return new Promise((res, rej) => {
    const tx = db.transaction(INSPO_IDB_STORE, 'readwrite');
    tx.objectStore(INSPO_IDB_STORE).put(nextPreset);
    tx.oncomplete = () => { queueAccountDesignPresetSync(); res(); };
    tx.onerror = rej;
  });
}
async function _inspoIdbDelete(id) {
  const db = await _inspoIdbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(INSPO_IDB_STORE, 'readwrite');
    tx.objectStore(INSPO_IDB_STORE).delete(id);
    tx.oncomplete = () => { queueAccountDesignPresetSync(); res(); };
    tx.onerror = rej;
  });
}
async function _inspoIdbLoadAll(explicitOwnerKey) {
  const db = await _inspoIdbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(INSPO_IDB_STORE, 'readonly');
    const req = tx.objectStore(INSPO_IDB_STORE).getAll();
    req.onsuccess = () => {
      const ownerKey = getInspoPresetOwnerKey(explicitOwnerKey);
      const items = Array.isArray(req.result) ? req.result : [];
      res(items.filter((item) => getInspoPresetOwnerKey(item && item.ownerKey ? item.ownerKey : null) === ownerKey));
    };
    req.onerror = rej;
  });
}
async function _inspoIdbReplaceAllForOwner(ownerKey, presets) {
  const db = await _inspoIdbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(INSPO_IDB_STORE, 'readwrite');
    const store = tx.objectStore(INSPO_IDB_STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = Array.isArray(req.result) ? req.result : [];
      all.forEach((item) => {
        if (getInspoPresetOwnerKey(item && item.ownerKey ? item.ownerKey : null) === ownerKey) {
          store.delete(item.id);
        }
      });
      (presets || []).forEach((preset) => {
        store.put({ ...preset, ownerKey });
      });
    };
    req.onerror = rej;
    tx.oncomplete = res;
    tx.onerror = rej;
  });
}
// --- localStorage helpers ---
function inspoLoadLocalMeta() {
  try { _wizHiddenBuiltins = new Set(JSON.parse(localStorage.getItem(getScopedStorageKey(INSPO_HIDDEN_KEY)) || '[]')); } catch(_) { _wizHiddenBuiltins = new Set(); }
  try { _wizPresetNameOverrides = JSON.parse(localStorage.getItem(getScopedStorageKey(INSPO_NAMES_KEY)) || '{}'); } catch(_) { _wizPresetNameOverrides = {}; }
}
function inspoSaveLocalMeta(options = {}) {
  try {
    localStorage.setItem(getScopedStorageKey(INSPO_HIDDEN_KEY), JSON.stringify([..._wizHiddenBuiltins]));
    localStorage.setItem(getScopedStorageKey(INSPO_NAMES_KEY), JSON.stringify(_wizPresetNameOverrides));
  } catch(_) {}
  if (options.markDirty !== false) {
    markInspoLocalStateDirty(options.explicitScope);
  }
  queueAccountDesignPresetSync();
}

// --- Load everything and render ---
async function wizLoadInspoPresets() {
  inspoLoadLocalMeta();
  try {
    const res = await fetch('/design-presets/presets.json');
    if (res.ok) _wizInspoPresets = await res.json();
  } catch(e) { console.warn('Failed to load built-in presets', e); }
  try {
    _wizCustomPresets = await _inspoIdbLoadAll();
    _wizCustomPresets.sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  } catch(e) { console.warn('Failed to load custom presets', e); }
  wizRenderInspoPresets();
}

// --- Render presets grid ---
function wizRenderInspoPresets() {
  const container = document.getElementById('wizInspoPresets');
  if (!container) return;
  container.innerHTML = '';
  const _t = (k, fb) => window.I18N ? I18N.t(k) : fb;

  const visibleBuiltins = _wizInspoPresets.filter(p => p.thumb && !_wizHiddenBuiltins.has(p.id));
  const allCards = [
    ...visibleBuiltins.map(p => ({ id: p.id, name: _wizPresetNameOverrides[p.id] || p.name || '', src: p.thumb, isCustom: false })),
    ..._wizCustomPresets.map(p => ({ id: p.id, name: _wizPresetNameOverrides[p.id] || p.name || '', src: p.src || p.dataUrl, isCustom: true })),
  ];

  allCards.forEach(p => {
    const isOn = _wizSelectedPresets.has(p.id);
    const imgSrc = p.isCustom ? p.src : (p.src.startsWith('http') ? p.src : window.location.origin + p.src);

    const wrap = document.createElement('div');
    wrap.className = 'wiz-inspo-wrap';

    const card = document.createElement('div');
    card.className = 'wiz-inspo-card' + (isOn ? ' wiz-inspo-on' : '');
    card.dataset.presetId = p.id;
    card.title = p.name;

    // Thumbnail
    const img = document.createElement('img');
    img.className = 'wiz-inspo-card-thumb';
    img.src = imgSrc;
    img.alt = p.name;
    img.loading = 'lazy';
    card.appendChild(img);

    // Action buttons (top-right, shown on hover)
    const actions = document.createElement('div');
    actions.className = 'wiz-inspo-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'wiz-inspo-action-btn';
    editBtn.title = 'Rename';
    editBtn.innerHTML = '<i data-lucide="pencil"></i>';
    editBtn.onclick = (e) => { e.stopPropagation(); inspoStartRename(p.id, nameEl, p.isCustom); };
    actions.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'wiz-inspo-action-btn wiz-inspo-del-btn';
    delBtn.title = 'Delete preset';
    delBtn.innerHTML = '<i data-lucide="trash-2"></i>';
    delBtn.onclick = (e) => { e.stopPropagation(); inspoDeletePreset(p.id, p.isCustom); };
    actions.appendChild(delBtn);
    card.appendChild(actions);

    // Selected checkmark
    const check = document.createElement('div');
    check.className = 'wiz-inspo-check';
    check.innerHTML = '<i data-lucide="check"></i>';
    card.appendChild(check);

    // Name label (inline-editable)
    const nameEl = document.createElement('span');
    nameEl.className = 'wiz-inspo-card-name';
    nameEl.textContent = p.name;
    card.appendChild(nameEl);

    // Toggle selection on click (not on action buttons)
    card.onclick = () => {
      if (_wizSelectedPresets.has(p.id)) _wizSelectedPresets.delete(p.id);
      else _wizSelectedPresets.add(p.id);
      card.classList.toggle('wiz-inspo-on', _wizSelectedPresets.has(p.id));
      saveAppState();
    };
    wrap.appendChild(card);

    // Full-view button below card
    const viewBtn = document.createElement('button');
    viewBtn.type = 'button';
    viewBtn.className = 'wiz-inspo-view-btn';
    viewBtn.innerHTML = `<i data-lucide="expand"></i><span>${_t('wiz_inspo_full_view', 'Full View')}</span>`;
    viewBtn.onclick = (e) => { e.stopPropagation(); wizOpenLightbox(imgSrc); };
    wrap.appendChild(viewBtn);
    container.appendChild(wrap);
  });

  // "+" Add custom preset card
  const addWrap = document.createElement('div');
  addWrap.className = 'wiz-inspo-wrap';
  const addCard = document.createElement('button');
  addCard.type = 'button';
  addCard.className = 'wiz-inspo-add-card';
  addCard.innerHTML = `<i data-lucide="image-plus"></i><span>${_t('wiz_inspo_add_preset', 'Add Preset')}</span>`;
  addCard.onclick = () => inspoPickAndAddPreset();
  addWrap.appendChild(addCard);
  container.appendChild(addWrap);

  requestAnimationFrame(() => { if (window.lucide) window.lucide.createIcons(); });
}

// --- Add custom preset flow ---
function inspoPickAndAddPreset() {
  const input = document.getElementById('wizInspoFileInput');
  if (!input) return;
  input.onchange = async (e) => {
    const file = (e.target.files || [])[0];
    if (!file) return;
    e.target.value = '';
    const dataUrl = await _fileToDataUrl(file);
    const suggestedName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
    inspoShowNameModal(dataUrl, suggestedName);
  };
  input.click();
}

function _fileToDataUrl(file) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
}

function inspoShowNameModal(dataUrl, suggestedName) {
  const overlay = document.createElement('div');
  overlay.className = 'inspo-name-overlay';
  overlay.innerHTML = `
    <div class="inspo-name-modal">
      <img src="${dataUrl}" class="inspo-name-preview" alt="" />
      <div class="inspo-name-body">
        <div class="inspo-name-label">Name your preset</div>
        <input type="text" class="inspo-name-input" value="${suggestedName}" placeholder="e.g. Minimalist White..." maxlength="50" />
        <div class="inspo-name-actions">
          <button type="button" class="inspo-name-cancel">Cancel</button>
          <button type="button" class="inspo-name-save"><i data-lucide="check"></i> Save Preset</button>
        </div>
      </div>
    </div>`;
  const inp  = overlay.querySelector('.inspo-name-input');
  const save = overlay.querySelector('.inspo-name-save');
  const cancel = overlay.querySelector('.inspo-name-cancel');
  cancel.onclick = () => { overlay.classList.remove('inspo-name-open'); setTimeout(() => overlay.remove(), 220); };
  overlay.onclick = (e) => { if (e.target === overlay) cancel.onclick(); };
  save.onclick = async () => {
    const name = inp.value.trim() || suggestedName || 'Custom Preset';
    const id = 'custom_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    const preset = { id, name, dataUrl, addedAt: Date.now() };
    _wizCustomPresets.push(preset);
    try { await _inspoIdbSave(preset); } catch(e) { console.warn('Failed to save preset to IDB', e); }
    markInspoLocalStateDirty();
    cancel.onclick();
    wizRenderInspoPresets();
    saveAppState();
    showToast(`Preset "${name}" saved`, 'info');
  };
  inp.onkeydown = (e) => { if (e.key === 'Enter') save.onclick(); if (e.key === 'Escape') cancel.onclick(); };
  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('inspo-name-open');
    if (window.lucide) window.lucide.createIcons();
    inp.focus(); inp.select();
  });
}

// --- Rename a preset inline ---
function inspoStartRename(id, nameEl, isCustom) {
  const current = nameEl.textContent;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.className = 'wiz-inspo-rename-input';
  inp.value = current; inp.maxLength = 50;
  const finish = async (save) => {
    const newName = inp.value.trim() || current;
    nameEl.textContent = save ? newName : current;
    inp.replaceWith(nameEl);
    if (!save) return;
    if (isCustom) {
      const cp = _wizCustomPresets.find(p => p.id === id);
      if (cp) {
        cp.name = newName;
        try { await _inspoIdbSave(cp); } catch(_) {}
        markInspoLocalStateDirty();
      }
    } else {
      _wizPresetNameOverrides[id] = newName;
      inspoSaveLocalMeta();
    }
  };
  inp.onblur = () => finish(true);
  inp.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
    if (e.key === 'Escape') { finish(false); }
  };
  nameEl.replaceWith(inp);
  inp.focus(); inp.select();
}

// --- Delete a preset ---
async function inspoDeletePreset(id, isCustom) {
  if (isCustom) {
    const idx = _wizCustomPresets.findIndex(p => p.id === id);
    if (idx !== -1) _wizCustomPresets.splice(idx, 1);
    try { await _inspoIdbDelete(id); } catch(e) { console.warn('Failed to delete preset from IDB', e); }
    markInspoLocalStateDirty();
  } else {
    _wizHiddenBuiltins.add(id);
    inspoSaveLocalMeta();
  }
  _wizSelectedPresets.delete(id);
  delete _wizPresetNameOverrides[id];
  wizRenderInspoPresets();
  saveAppState();
}

function wizOpenLightbox(src) {
  const lb = document.getElementById('wizLightbox');
  const img = document.getElementById('wizLightboxImg');
  if (!lb || !img) return;
  img.src = src;
  lb.style.display = 'flex';
  requestAnimationFrame(() => lb.classList.add('wiz-lightbox-open'));
}
function wizCloseLightbox() {
  const lb = document.getElementById('wizLightbox');
  if (!lb) return;
  lb.classList.remove('wiz-lightbox-open');
  setTimeout(() => { lb.style.display = 'none'; }, 250);
}
window.wizCloseLightbox = wizCloseLightbox;

// wizInitInspoUpload is now a no-op (file input triggered programmatically)
function wizInitInspoUpload() {}

function wizRenderInspoThumbs() {}  // kept for backwards compat

function getInspoPresetUrls() {
  const urls = [];
  _wizSelectedPresets.forEach(id => {
    const builtin = _wizInspoPresets.find(x => x.id === id);
    if (builtin && builtin.thumb) {
      urls.push(builtin.thumb.startsWith('http') ? builtin.thumb : window.location.origin + builtin.thumb);
      return;
    }
    const custom = _wizCustomPresets.find(x => x.id === id);
    if (custom && (custom.src || custom.dataUrl)) urls.push(custom.src || custom.dataUrl);
  });
  return urls;
}

// ---- WB CARD PROMPT ASSEMBLY ----
function assembleWbCardPrompt(productImageCount) {
  const title = (qs('toolsTitleInput') ? qs('toolsTitleInput').value.trim() : '') || 'Premium Quality';
  const charItems = document.querySelectorAll('.tools-char-item');
  const chars = [];
  charItems.forEach(item => {
    const input = item.querySelector('input[type="text"], textarea.wiz-char-input');
    if (input && input.value.trim()) chars.push(input.value.trim());
  });
  const fontStyle = (qs('toolsFontInput') ? qs('toolsFontInput').value.trim() : '') || 'Bold minimalist sans-serif';
  const wishes = (qs('toolsWishesInput') ? qs('toolsWishesInput').value.trim() : '') || '';
  const charsBlock = chars.length > 0
    ? chars.map(c => `  \u2022 ${c}`).join('\n')
    : '  \u2022 Natural materials\n  \u2022 Premium quality\n  \u2022 Guaranteed';
  const textOverlays = skGetTextOverlaysForPrompt();
  const inspoPresetCount = getInspoPresetUrls().length;
  const inspoUploadCount = uploadedInspoImages.length;
  const totalInspoCount = inspoPresetCount + inspoUploadCount;
  const prodCount = productImageCount || 0;
  const hasInspo = totalInspoCount > 0;
  const alignBgWithProductStyle = !!(qs('toolsInspoMatchBg') && qs('toolsInspoMatchBg').checked);
  const bgStyleHarmonyBlock = alignBgWithProductStyle
    ? `

═══ BACKGROUND STYLE ALIGNMENT (enabled) ═══
Ensure the background, scene styling, color palette, props, and decorative details match the product's overall style, material character, and brand mood so the final card feels cohesive.`
    : '';

  // ── WITH DESIGN REFERENCES: lean prompt — only user content + aesthetic directive ──
  if (hasInspo) {
    const prodRolesBlock = prodCount > 0
      ? `\u2550\u2550\u2550 IMAGE ROLES (follow strictly) \u2550\u2550\u2550\n`
        + (prodCount === 1
            ? `Image 1 \u2014 PRODUCT PHOTO: Reproduce the product\u2019s exact shape, color, material, and texture faithfully. Do NOT alter it.`
            : `Images 1\u2013${prodCount} \u2014 PRODUCT PHOTOS: Reproduce the product\u2019s exact shape, color, material, and texture faithfully. Do NOT alter it.`)
        + `\n`
        + (totalInspoCount === 1
            ? `Image ${prodCount + 1} \u2014 DESIGN REFERENCE: This image is the sole authority for the entire visual design of the card.`
            : `Images ${prodCount + 1}\u2013${prodCount + totalInspoCount} \u2014 DESIGN REFERENCES: These images are the sole authority for the entire visual design of the card.`)
        + `\nCopy EVERYTHING visual from the design reference(s): background, scene, color palette, mood, layout, composition, element positioning, spacing, typography (fonts, weights, sizes, placement), icon style, text decoration, shadows, overlays, and any decorative details. Reproduce the aesthetic faithfully.\nDo NOT take any products or objects from the design reference(s) \u2014 only transfer the visual design language.`
      : `\u2550\u2550\u2550 IMAGE ROLES (follow strictly) \u2550\u2550\u2550\n`
        + (totalInspoCount === 1
            ? `Image 1 \u2014 DESIGN REFERENCE: This image is the sole authority for the entire visual design of the card.`
            : `Images 1\u2013${totalInspoCount} \u2014 DESIGN REFERENCES: These images are the sole authority for the entire visual design of the card.`)
        + `\nCopy EVERYTHING visual from the design reference(s): background, scene, color palette, mood, layout, composition, element positioning, spacing, typography (fonts, weights, sizes, placement), icon style, text decoration, shadows, overlays, and any decorative details. Reproduce the aesthetic faithfully.`;

    return `Generate a premium e-commerce hero card for the Wildberries marketplace.

\u2550\u2550\u2550 CANVAS \u2550\u2550\u2550
Format: portrait 3:4 ratio. Quality: ultra-sharp, 4K resolution, award-winning composition, masterpiece.

\u2550\u2550\u2550 PRODUCT RULES (critical \u2014 zero deviation) \u2550\u2550\u2550
\u2022 Do NOT alter the product\u2019s shape, color, proportions, material, or texture in any way.
\u2022 Do NOT add text, logos, or extra details directly ON or TO the product itself.
\u2022 Product occupies 30\u201355% of the image area \u2014 realistic physical scale.
\u2022 Product is physically grounded: accurate contact shadows, stable base, believable perspective.

${prodRolesBlock}

\u2550\u2550\u2550 TEXT CONTENT (reproduce exactly \u2014 validate spelling character by character) \u2550\u2550\u2550
HEADLINE: "${title}"
FEATURE LIST \u2014 each item paired with one unique icon:
${charsBlock}

Place the headline, feature bullets, and icons exactly as the design reference(s) position such elements. Adapt contrast (overlays, shadows, color) from the reference\u2019s approach so all text is legible.
CRITICAL: Every text element must appear EXACTLY ONCE \u2014 never duplicate lines or icons.

\u2550\u2550\u2550 STRICTLY FORBIDDEN \u2550\u2550\u2550
\u2717 Prices, discount tags, promo stickers, star ratings, barcodes
\u2717 Logos, watermarks, Wildberries or WB brand marks anywhere

\u2550\u2550\u2550 QUALITY \u2550\u2550\u2550
ultra-sharp \u00b7 4K detail \u00b7 cinematic lighting \u00b7 premium composition \u00b7 masterpiece${bgStyleHarmonyBlock}${wishes ? `\n\n\u2550\u2550\u2550 ADDITIONAL WISHES \u2550\u2550\u2550\n${wishes}` : ''}${textOverlays ? `\n\n\u2550\u2550\u2550 ADDITIONAL TEXT TO RENDER (reproduce exactly as written) \u2550\u2550\u2550\n${textOverlays}` : ''}`;
  }

  // ── WITHOUT DESIGN REFERENCES: full default prompt ──
  const sceneBlock = `\u2550\u2550\u2550 SCENE \u2550\u2550\u2550
Full-background lifestyle scene thematically matched to the product \u2014 NOT a flat studio cutout or template banner.
Shot: medium to medium-close. Composition: rule of thirds with product as clear focal point.
Lighting: professional studio-lifestyle blend \u2014 soft diffused key light, warm subtle fill, clean sharp shadows, slight depth of field (product sharp, background slightly soft).
Include scale-anchoring context objects (table / shelf / hands / interior surfaces) so the product size reads naturally.

Scene type \u2014 apply whichever matches the product:
\u2192 Wearable / accessory / clothing \u2192 shown worn on person or mannequin; face optional; product is hero
\u2192 Kitchenware / cookware / food \u2192 elegant table or kitchen scene, real-world scale
\u2192 Cosmetics / beauty / skincare \u2192 vanity or bathroom surface, no competitor branding
\u2192 Electronics / gadgets \u2192 active-use scenario (desk / hands / home), no third-party logos
\u2192 Home d\u00e9cor / furniture / textiles \u2192 interior scene where scale reads naturally`;

  const textBlock = `\u2550\u2550\u2550 TEXT ON CARD (spelling must be perfect \u2014 validate character by character) \u2550\u2550\u2550
HEADLINE \u2014 positioned at the TOP CENTER, bold, large, single line. Text reading exactly:
"${title}"

FEATURE BULLETS \u2014 placed on LEFT and RIGHT sides of the card, each with a small icon. Feature list:
${charsBlock}

CRITICAL: Every text element must appear EXACTLY ONCE \u2014 never duplicate lines, numbers, or icons.
CRITICAL: All text must be maximum legible \u2014 strong contrast between text and background at all times. Use white or accent-colored text on dark semi-transparent overlay panels where needed.`;

  const iconAndTypoBlock = `\u2550\u2550\u2550 ICON & TYPOGRAPHY STYLE \u2550\u2550\u2550
Icons: Each feature bullet should have ONE small icon that matches its text. All icons must follow a unified stylistic approach. Be very creative with icon design.

HEADING TYPOGRAPHY STYLE: ${fontStyle}
Apply this style to the headline. Keep body feature text clean and readable.`;

  let imageRolesBlock = '';
  if (prodCount > 0) {
    const prodRange = prodCount === 1 ? 'Image 1 is a' : `Images 1\u2013${prodCount} are`;
    imageRolesBlock = `\n\n\u2550\u2550\u2550 REFERENCE IMAGE ROLES (critical \u2014 follow strictly) \u2550\u2550\u2550\n${prodRange} PRODUCT PHOTO(S): Use these to understand the product\u2019s exact appearance, shape, color, material, and texture. Reproduce the product faithfully.`;
  }

  return `Generate a premium e-commerce hero card for the Wildberries marketplace. This is a structured reasoning task \u2014 follow every requirement explicitly and precisely.

\u2550\u2550\u2550 CANVAS \u2550\u2550\u2550
Format: portrait 3:4 ratio. Style: photorealistic commercial product photography. Quality: ultra-sharp, 4K resolution, award-winning composition, cinematic lighting, masterpiece.

\u2550\u2550\u2550 PRODUCT RULES (critical \u2014 zero deviation) \u2550\u2550\u2550
\u2022 The reference product photo is the source of truth. Do NOT alter the product\u2019s shape, color, proportions, material, or texture in any way.
\u2022 Do NOT add text, logos, branding, or extra details directly ON or TO the product itself.
\u2022 Product occupies 30\u201355% of the image area \u2014 realistic physical scale, never oversized or miniaturized.
\u2022 Product is physically grounded: accurate contact shadows, stable base point, believable perspective with surroundings.

${sceneBlock}

${textBlock}

${iconAndTypoBlock}

\u2550\u2550\u2550 STRICTLY FORBIDDEN \u2550\u2550\u2550
\u2717 Prices, discount tags, promo stickers, star ratings, barcodes
\u2717 Logos, watermarks, Wildberries or WB brand marks anywhere

\u2550\u2550\u2550 QUALITY DIRECTIVES \u2550\u2550\u2550
photorealistic \u00b7 award-winning product photography \u00b7 ultra-sharp focus on product \u00b7 4K detail \u00b7 cinematic lighting \u00b7 premium composition \u00b7 masterpiece \u00b7 high fidelity${imageRolesBlock}${bgStyleHarmonyBlock}${wishes ? `\n\n\u2550\u2550\u2550 USER REQUESTS (important) \u2550\u2550\u2550\n${wishes}` : ''}${textOverlays ? `\n\n\u2550\u2550\u2550 ADDITIONAL TEXT TO RENDER (user specified \u2014 reproduce exactly as written) \u2550\u2550\u2550\n${textOverlays}` : ''}`;
}

async function submitToolsRequest(task) {
  const modelId = qs('toolsModel') ? qs('toolsModel').value : DEFAULT_TOOLS_MODEL;
  const isNano2 = modelId === 'nano-banana-2/edit';
  const isGpt = modelId === 'gpt-image-1.5/edit';
  const body = { model_id: modelId, prompt: task.prompt };

  const imageUrls = await resolveUploadItemUrls(uploadedToolsImages, 'tools-ref', task);
  const presetUrls = getInspoPresetUrls();
  for (const pUrl of presetUrls) {
    try {
      if (canPassThroughRemoteUrl(pUrl)) {
        imageUrls.push(pUrl.trim());
        continue;
      }
      const resp = await fetch(pUrl);
      if (!resp.ok) continue;
      const blob = await resp.blob();
      const ext = pUrl.split('.').pop().split('?')[0] || 'jpg';
      const file = new File([blob], `preset-${Date.now()}.${ext}`, { type: blob.type || 'image/jpeg' });
      const u = await uploadFileToFal(file, 'tools-inspo-preset', task);
      if (u) imageUrls.push(u);
    } catch (e) { console.warn('Preset upload failed:', pUrl, e); }
  }
  for (const f of uploadedInspoImages) {
    const u = await uploadFileToFal(f, 'tools-inspo', task);
    if (u) imageUrls.push(u);
  }
  if (imageUrls.length > 0) body.image_urls = imageUrls;

  if (!isGpt) {
    const resolution = qs('toolsResolution') ? qs('toolsResolution').value : '2K';
    if (resolution) body.resolution = resolution;
  }

  const aspectRatio = qs('toolsAspectRatio') ? qs('toolsAspectRatio').value : '3:4';
  if (aspectRatio) body.aspect_ratio = aspectRatio;

  if (!isGpt) {
    const webSearch = qs('toolsWebSearch') ? qs('toolsWebSearch').value : 'true';
    if (webSearch === 'true') body.enable_web_search = true;
  }

  if (isNano2) {
    const googleSearch = qs('toolsGoogleSearch') ? qs('toolsGoogleSearch').value : 'true';
    if (googleSearch === 'true') body.enable_google_search = true;

    const seed = qs('toolsSeed') ? String(qs('toolsSeed').value || '').trim() : '';
    if (seed) body.seed = Number(seed);
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await createResponseError(res, 'Image generation failed');
  return await res.json();
}

// ---- PROFESSIONAL IMAGE EDITOR ----
let SK = {
  ctx: null, canvas: null, tool: 'move', drawing: false, imgIndex: -1,
  history: [], redoStack: [], startPos: null, shapePreview: null,
  zoom: 1, bgImage: null, drawCanvas: null, drawCtx: null,
  layerVisible: { background: true, drawing: true },
  textOverlays: [], selectedTextId: null, dragTextOffset: null,
  textBold: false, textItalic: false, textIdCounter: 0,
  sourceArray: null, updateFn: null,
  layers: [], activeLayerId: null, layerCounter: 0,
};

async function openSketchEditor(imageIndex, sourceArr, updateFn) {
  SK.imgIndex = imageIndex;
  SK.sourceArray = sourceArr || uploadedToolsImages;
  SK.updateFn = updateFn || updateToolsImagePreview;
  const sourceItem = SK.sourceArray[imageIndex];
  if (!sourceItem) return;
  const modal = qs('sketchModal');
  if (!modal) return;
  modal.style.display = 'flex';
  SK.textOverlays = []; SK.selectedTextId = null;
  SK.textBold = false; SK.textItalic = false; SK.textIdCounter = 0;
  SK.zoom = 1; SK.redoStack = [];

  const canvas = qs('sketchCanvas');
  if (!canvas) return;
  let file = sourceItem;
  try {
    file = await ensureFileLikeAssetItem(sourceItem);
  } catch (error) {
    console.error('Failed to load asset for sketch editor', error);
    closeSketchEditor();
    showToast(getI18nText('drop_fetch_asset_failed', 'Failed to load the dragged asset.'), 'error');
    return;
  }
  const img = new Image();
  const imgUrl = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(imgUrl);
    const maxW = 1200, maxH = 900;
    let w = img.naturalWidth, h = img.naturalHeight;
    if (w > maxW) { h = h * maxW / w; w = maxW; }
    if (h > maxH) { w = w * maxH / h; h = maxH; }
    canvas.width = Math.round(w); canvas.height = Math.round(h);
    SK.ctx = canvas.getContext('2d'); SK.canvas = canvas;
    SK.bgImage = img;
    SK.drawCanvas = document.createElement('canvas');
    SK.drawCanvas.width = canvas.width;
    SK.drawCanvas.height = canvas.height;
    SK.drawCtx = SK.drawCanvas.getContext('2d');
    SK.layerVisible = { background: true };
    SK.layerCounter = 1;
    SK.layers = [{ id: 'layer-1', name: 'Drawing', canvas: SK.drawCanvas, ctx: SK.drawCtx, visible: true }];
    SK.activeLayerId = 'layer-1';
    SK.history = [skSnapshotLayers()]; SK.drawing = false;
    SK.startPos = null; SK.shapePreview = null;
    skSetTool('move');
    skSetupEvents(canvas);
    skSetupZoom();
    skSetupKeyboard();
    skRedrawCanvas();
    _skApplyZoom();
    skUpdateZoomLabel();
    skRenderTextOverlays();
    skRenderTextList();
    skRenderLayersPanel();
    skUpdatePropsBar();
    // Size/opacity listeners
    const sizeR = qs('sketchSize'); const sizeV = qs('skSizeVal');
    if (sizeR && sizeV) { sizeR.oninput = () => { sizeV.textContent = sizeR.value; }; }
    const opR = qs('sketchOpacity'); const opV = qs('skOpacityVal');
    if (opR && opV) { opR.oninput = () => { opV.textContent = opR.value + '%'; }; }
  };
  img.src = imgUrl;
  requestAnimationFrame(() => { if (window.lucide) window.lucide.createIcons(); });
}
window.openSketchEditor = openSketchEditor;

// --- Snapshot all layer canvases for history ---
function skSnapshotLayers() {
  return SK.layers.map(l => ({ id: l.id, data: l.canvas.toDataURL() }));
}

// --- Apply current SK.zoom to canvas and text overlay DOM ---
function _skApplyZoom() {
  const wrap = qs('skCanvasWrap');
  const canvas = SK.canvas;
  if (!wrap || !canvas) return;
  const z = SK.zoom;
  canvas.style.transformOrigin = '0 0';
  canvas.style.transform = `scale(${z})`;
  const overlays = qs('skTextOverlays');
  if (overlays) {
    overlays.style.transformOrigin = '0 0';
    overlays.style.transform = `scale(${z})`;
    overlays.style.width = canvas.width + 'px';
    overlays.style.height = canvas.height + 'px';
  }
  // Set wrap dimensions = natural size * zoom so the scroller knows how big to scroll
  wrap.style.width = (canvas.width * z) + 'px';
  wrap.style.height = (canvas.height * z) + 'px';
}

// --- Apply zoom by a factor, keeping focalScrollX/Y fixed on screen ---
function skZoomBy(factor, focalScrollX, focalScrollY) {
  const sc = qs('skCanvasScroller');
  const oldZoom = SK.zoom;
  SK.zoom = Math.max(0.08, Math.min(12, SK.zoom * factor));
  _skApplyZoom();
  if (sc && focalScrollX != null) {
    sc.scrollLeft = focalScrollX * (SK.zoom / oldZoom) - (focalScrollX - sc.scrollLeft);
    sc.scrollTop  = focalScrollY * (SK.zoom / oldZoom) - (focalScrollY - sc.scrollTop);
  }
  skUpdateZoomLabel();
}
window.skZoomBy = skZoomBy;

// --- Attach wheel (trackpad pinch) + two-touch pinch zoom to canvas scroller ---
function skSetupZoom() {
  const sc = qs('skCanvasScroller') || qs('skCanvasArea');
  if (!sc || sc._skZoomReady) return;
  sc._skZoomReady = true;

  // Wheel: ctrl/meta = pinch-zoom; plain = pass through (scroll naturally)
  sc.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const rect = sc.getBoundingClientRect();
      const fx = e.clientX - rect.left + sc.scrollLeft;
      const fy = e.clientY - rect.top  + sc.scrollTop;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      skZoomBy(factor, fx, fy);
    }
  }, { passive: false });

  // Two-finger touch pinch
  let _pinch = null;
  sc.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const t0 = e.touches[0], t1 = e.touches[1];
      _pinch = {
        dist: Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY),
        zoom: SK.zoom,
        midX: (t0.clientX + t1.clientX) / 2,
        midY: (t0.clientY + t1.clientY) / 2,
        scrollX: sc.scrollLeft,
        scrollY: sc.scrollTop,
      };
      e.preventDefault();
    }
  }, { passive: false });

  sc.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2 && _pinch) {
      e.preventDefault();
      const t0 = e.touches[0], t1 = e.touches[1];
      const dist = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
      const newZoom = Math.max(0.08, Math.min(12, _pinch.zoom * (dist / _pinch.dist)));
      const rect = sc.getBoundingClientRect();
      const curMidX = (t0.clientX + t1.clientX) / 2 - rect.left;
      const curMidY = (t0.clientY + t1.clientY) / 2 - rect.top;
      const focalX = _pinch.scrollX + (_pinch.midX - rect.left);
      const focalY = _pinch.scrollY + (_pinch.midY - rect.top);
      const oldZoom = SK.zoom;
      SK.zoom = newZoom;
      _skApplyZoom();
      sc.scrollLeft = focalX * (SK.zoom / _pinch.zoom) - curMidX;
      sc.scrollTop  = focalY * (SK.zoom / _pinch.zoom) - curMidY;
      skUpdateZoomLabel();
    }
  }, { passive: false });

  sc.addEventListener('touchend',   () => { _pinch = null; });
  sc.addEventListener('touchcancel',() => { _pinch = null; });
}

// --- Layer management ---
function skRenderLayersPanel() {
  const list = qs('skLayersList');
  if (!list) return;
  list.innerHTML = '';

  // Background row (non-drawable, always at bottom of stack)
  const bgRow = document.createElement('div');
  bgRow.className = 'sk-layer';
  bgRow.style.opacity = '0.65';
  bgRow.innerHTML = `<button class="sk-layer-vis" title="Toggle background"><i data-lucide="${SK.layerVisible.background !== false ? 'eye' : 'eye-off'}"></i></button><span class="sk-layer-name">Background</span><span class="sk-layer-type">BG</span>`;
  bgRow.querySelector('.sk-layer-vis').onclick = (e) => {
    e.stopPropagation();
    SK.layerVisible.background = !SK.layerVisible.background;
    skRenderLayersPanel();
    skRedrawCanvas();
  };
  list.appendChild(bgRow);

  // Drawing layers — top layer shown first
  [...SK.layers].reverse().forEach(layer => {
    const row = document.createElement('div');
    row.className = 'sk-layer' + (layer.id === SK.activeLayerId ? ' sk-layer-active' : '');
    row.innerHTML = `<button class="sk-layer-vis" title="Toggle visibility"><i data-lucide="${layer.visible !== false ? 'eye' : 'eye-off'}"></i></button><span class="sk-layer-name">${layer.name}</span>${SK.layers.length > 1 ? `<button class="sk-layer-del" title="Delete"><i data-lucide="trash-2"></i></button>` : ''}`;
    row.querySelector('.sk-layer-vis').onclick = (e) => {
      e.stopPropagation();
      layer.visible = layer.visible === false ? true : false;
      skRenderLayersPanel();
      skRedrawCanvas();
    };
    const del = row.querySelector('.sk-layer-del');
    if (del) del.onclick = (e) => { e.stopPropagation(); skDeleteLayer(layer.id); };
    row.onclick = (e) => {
      if (e.target.closest('.sk-layer-vis') || e.target.closest('.sk-layer-del')) return;
      skSelectLayer(layer.id);
    };
    list.appendChild(row);
  });
  requestAnimationFrame(() => { if (window.lucide) window.lucide.createIcons(); });
}

function skSelectLayer(id) {
  SK.activeLayerId = id;
  const layer = SK.layers.find(l => l.id === id);
  if (layer) {
    // Keep SK.drawCtx / SK.drawCanvas pointing to active layer for backwards compat
    SK.drawCtx = layer.ctx;
    SK.drawCanvas = layer.canvas;
  }
  skRenderLayersPanel();
}
window.skSelectLayer = skSelectLayer;

function skAddLayer() {
  if (!SK.canvas) return;
  SK.layerCounter++;
  const nc = document.createElement('canvas');
  nc.width = SK.canvas.width; nc.height = SK.canvas.height;
  const nctx = nc.getContext('2d');
  const layer = { id: 'layer-' + SK.layerCounter, name: 'Layer ' + SK.layerCounter, canvas: nc, ctx: nctx, visible: true };
  SK.layers.push(layer);
  skSelectLayer(layer.id);
  skPushHistory();
  showToast('Layer added', 'info');
}
window.skAddLayer = skAddLayer;

function skDeleteLayer(id) {
  if (SK.layers.length <= 1) return;
  const idx = SK.layers.findIndex(l => l.id === id);
  if (idx === -1) return;
  SK.layers.splice(idx, 1);
  if (SK.activeLayerId === id) {
    skSelectLayer(SK.layers[Math.min(idx, SK.layers.length - 1)].id);
  } else {
    skRenderLayersPanel();
  }
  skPushHistory();
  skRedrawCanvas();
}
window.skDeleteLayer = skDeleteLayer;

function skToggleLayersPanel() {
  const panel = qs('skRightPanel');
  if (panel) panel.classList.toggle('sk-panel-open');
}
window.skToggleLayersPanel = skToggleLayersPanel;

// --- Keyboard shortcuts ---
let _skKbReady = false;
function skSetupKeyboard() {
  if (_skKbReady) return;
  _skKbReady = true;
  document.addEventListener('keydown', (e) => {
    const modal = qs('sketchModal');
    if (!modal || modal.style.display === 'none') return;
    const tag = (e.target || {}).tagName || '';
    const inInput = /^(INPUT|TEXTAREA|SELECT)$/i.test(tag);
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); sketchUndo(); return; }
      if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); sketchRedo(); return; }
      if (e.key === '=' || e.key === '+') { e.preventDefault(); skZoom(1); return; }
      if (e.key === '-') { e.preventDefault(); skZoom(-1); return; }
      if (e.key === '0') { e.preventDefault(); skZoom(0); return; }
    }
    if (e.key === 'Escape') { closeSketchEditor(); return; }
    if (e.key === 'Delete' && SK.selectedTextId && !inInput) {
      skRemoveTextOverlay(SK.selectedTextId); return;
    }
    if (!e.ctrlKey && !e.metaKey && !inInput) {
      const map = { v:'move', p:'pen', e:'eraser', r:'rect', c:'circle', l:'line', t:'text', a:'arrow', s:'select' };
      if (map[e.key]) skSetTool(map[e.key]);
    }
  });
}

function closeSketchEditor() {
  const modal = qs('sketchModal');
  if (modal) modal.style.display = 'none';
  SK.ctx = null; SK.canvas = null; SK.history = []; SK.redoStack = [];
  SK.drawCanvas = null; SK.drawCtx = null; SK.bgImage = null;
  SK.shapePreview = null; SK.startPos = null;
  SK.textOverlays = []; SK.selectedTextId = null;
  SK.layers = []; SK.activeLayerId = null;
  SK.zoom = 1;
  // Reset scroller position
  const sc = qs('skCanvasScroller'); if (sc) { sc.scrollLeft = 0; sc.scrollTop = 0; }
  const wrap = qs('skCanvasWrap'); if (wrap) { wrap.style.width = ''; wrap.style.height = ''; }
}
window.closeSketchEditor = closeSketchEditor;

function skSetTool(tool) {
  SK.tool = tool;
  document.querySelectorAll('.sk-tool[data-sktool]').forEach(b => {
    b.classList.toggle('active', b.dataset.sktool === tool);
  });
  const c = SK.canvas;
  if (c) {
    const cursors = { move:'default', pen:'crosshair', eraser:'crosshair', line:'crosshair',
      rect:'crosshair', circle:'crosshair', arrow:'crosshair', text:'text',
      select:'crosshair', eyedropper:'crosshair' };
    c.style.cursor = cursors[tool] || 'crosshair';
  }
  skUpdatePropsBar();
}

function skUpdateLayerButtonIcon(btn, visible) {
  if (!btn) return;
  btn.classList.toggle('sk-vis-off', !visible);
  btn.innerHTML = `<i data-lucide="${visible ? 'eye' : 'eye-off'}"></i>`;
  if (window.lucide) window.lucide.createIcons();
}
// Toolbar click delegation
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.sk-tool[data-sktool]');
  if (btn) { e.preventDefault(); skSetTool(btn.dataset.sktool); }
  // (layer visibility now handled inline in skRenderLayersPanel)
});

function skUpdatePropsBar() {
  const drawProps = qs('skPropsBar');
  const textProps = qs('skTextPropsBar');
  if (!drawProps || !textProps) return;
  const isText = SK.tool === 'text';
  drawProps.style.display = isText ? 'none' : '';
  textProps.style.display = isText ? '' : 'none';
}


function sketchUndo() {
  if (SK.history.length <= 1) return;
  SK.redoStack.push(SK.history.pop());
  skRestoreFromHistory(SK.history[SK.history.length - 1]);
}
window.sketchUndo = sketchUndo;

function sketchRedo() {
  if (SK.redoStack.length === 0) return;
  const snap = SK.redoStack.pop();
  SK.history.push(snap);
  skRestoreFromHistory(snap);
}
window.sketchRedo = sketchRedo;

function skRestoreFromHistory(snap) {
  if (!snap || !SK.drawCanvas) return;
  if (typeof snap === 'string') {
    // Legacy single-string format
    const img = new Image();
    img.onload = () => { if(SK.drawCtx){SK.drawCtx.clearRect(0,0,SK.drawCanvas.width,SK.drawCanvas.height); SK.drawCtx.drawImage(img,0,0);} skRedrawCanvas(); };
    img.src = snap; return;
  }
  // Multi-layer format: [{id, data}, ...]
  let done = 0; const total = snap.length;
  if (total === 0) { skRedrawCanvas(); return; }
  snap.forEach(s => {
    const layer = SK.layers.find(l => l.id === s.id);
    if (!layer) { done++; if (done === total) skRedrawCanvas(); return; }
    const img = new Image();
    img.onload = () => {
      layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
      layer.ctx.drawImage(img, 0, 0);
      done++; if (done === total) skRedrawCanvas();
    };
    img.src = s.data;
  });
}

function skPushHistory() {
  if (!SK.drawCanvas) return;
  SK.redoStack = [];
  SK.history.push(skSnapshotLayers());
}

function sketchClear() {
  if (!SK.drawCanvas) return;
  SK.layers.forEach(layer => {
    if (layer.ctx) layer.ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
  });
  SK.history = [skSnapshotLayers()];
  SK.redoStack = [];
  SK.shapePreview = null;
  skRedrawCanvas();
}
window.sketchClear = sketchClear;

function skRedrawCanvas() {
  if (!SK.canvas || !SK.ctx) return;
  const c = SK.canvas, ctx = SK.ctx;
  ctx.clearRect(0, 0, c.width, c.height);
  if (SK.layerVisible.background && SK.bgImage) {
    ctx.drawImage(SK.bgImage, 0, 0, c.width, c.height);
  }
  // Draw all drawing layers in order (bottom to top)
  SK.layers.forEach(layer => {
    if (layer.visible !== false && layer.canvas) {
      ctx.drawImage(layer.canvas, 0, 0);
    }
  });

  // Live preview overlays for selection and shape tools
  if (SK.drawing && SK.shapePreview) {
    if (SK.shapePreview.type === 'select') {
      const { x, y, w, h } = SK.shapePreview;
      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    } else if (SK.shapePreview.from && SK.shapePreview.to) {
      const color = qs('sketchColor')?.value || '#ff0000';
      const size = Number(qs('sketchSize')?.value || 4);
      const opacity = Number(qs('sketchOpacity')?.value || 100) / 100;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = 'round';
      ctx.globalAlpha = opacity;
      skDrawShape(ctx, SK.shapePreview.type, SK.shapePreview.from, SK.shapePreview.to, size);
      ctx.restore();
    }
  }
}

function saveSketch() {
  if (!SK.canvas) return;
  const out = document.createElement('canvas');
  out.width = SK.canvas.width;
  out.height = SK.canvas.height;
  const ctx = out.getContext('2d');
  if (!ctx) return;

  if (SK.layerVisible.background && SK.bgImage) {
    ctx.drawImage(SK.bgImage, 0, 0, out.width, out.height);
  }
  // Composite all visible drawing layers
  SK.layers.forEach(layer => {
    if (layer.visible !== false && layer.canvas) {
      ctx.drawImage(layer.canvas, 0, 0);
    }
  });

  SK.textOverlays.forEach(t => {
    const weight = t.bold ? 'bold' : 'normal';
    const style = t.italic ? 'italic' : 'normal';
    ctx.save();
    ctx.font = `${style} ${weight} ${t.size}px "${t.font}"`;
    ctx.fillStyle = t.color;
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'top';
    // Convert overlay position from % to canvas pixels
    const cx = (t.xPct / 100) * out.width;
    const cy = (t.yPct / 100) * out.height;
    ctx.fillText(t.text, cx, cy);
    ctx.restore();
  });
  out.toBlob((blob) => {
    if (!blob) return;
    const file = new File([blob], `edited-${Date.now()}.png`, { type: 'image/png' });
    const arr = SK.sourceArray || uploadedToolsImages;
    const upd = SK.updateFn || updateToolsImagePreview;
    if (SK.imgIndex >= 0 && SK.imgIndex < arr.length) {
      arr[SK.imgIndex] = file;
    } else {
      arr.push(file);
    }
    window._lastEditorTextOverlays = SK.textOverlays.map(t => ({ text: t.text, font: t.font }));
    upd();
    closeSketchEditor();
    showToast(window.I18N ? I18N.t('toast_sketch_saved') : 'Image saved', 'info');
  }, 'image/png');
}
window.saveSketch = saveSketch;

// --- Zoom ---
function skZoom(dir) {
  if (dir === 0) { SK.zoom = 1; }
  else if (dir > 0) { SK.zoom = Math.min(SK.zoom * 1.25, 12); }
  else { SK.zoom = Math.max(SK.zoom / 1.25, 0.08); }
  _skApplyZoom();
  skUpdateZoomLabel();
}
window.skZoom = skZoom;
function skUpdateZoomLabel() {
  const el = qs('skZoomLabel');
  if (el) el.textContent = Math.round(SK.zoom * 100) + '%';
}

// --- Text Overlays ---
function skAddTextOverlay(x, y) {
  SK.textIdCounter++;
  const id = 'sktxt-' + SK.textIdCounter;
  const font = qs('skTextFont') ? qs('skTextFont').value : 'Arial';
  const size = qs('skTextSize') ? Number(qs('skTextSize').value) : 36;
  const color = qs('skTextColor') ? qs('skTextColor').value : '#ffffff';
  const xPct = x != null ? x : 10;
  const yPct = y != null ? y : 10;
  const overlay = { id, text: 'Text', font, size, color, bold: SK.textBold, italic: SK.textItalic, xPct, yPct };
  SK.textOverlays.push(overlay);
  SK.selectedTextId = id;
  skRenderTextOverlays();
  skRenderTextList();
  // Prompt edit
  setTimeout(() => {
    const el = document.getElementById(id);
    if (el) { skStartInlineEdit(el, overlay); }
  }, 50);
}
window.skAddTextOverlay = skAddTextOverlay;

function skRemoveTextOverlay(id) {
  SK.textOverlays = SK.textOverlays.filter(t => t.id !== id);
  if (SK.selectedTextId === id) SK.selectedTextId = null;
  skRenderTextOverlays();
  skRenderTextList();
}
window.skRemoveTextOverlay = skRemoveTextOverlay;

function skRenderTextOverlays() {
  const container = qs('skTextOverlays');
  if (!container || !SK.canvas) return;
  container.innerHTML = '';
  SK.textOverlays.forEach(t => {
    const div = document.createElement('div');
    div.className = 'sk-text-overlay' + (t.id === SK.selectedTextId ? ' sk-text-selected' : '');
    div.id = t.id;
    div.style.left = t.xPct + '%'; div.style.top = t.yPct + '%';
    const weight = t.bold ? 'bold' : 'normal';
    const style = t.italic ? 'italic' : 'normal';
    div.style.font = `${style} ${weight} ${t.size}px "${t.font}"`;
    div.style.color = t.color;
    div.textContent = t.text;
    div.ondblclick = (e) => { e.stopPropagation(); skStartInlineEdit(div, t); };
    div.onmousedown = (e) => { if (SK.tool === 'move' || SK.tool === 'text') skStartDragText(e, t); };
    div.ontouchstart = (e) => { if (SK.tool === 'move' || SK.tool === 'text') skStartDragText(e, t); };
    container.appendChild(div);
  });
}

function skStartInlineEdit(el, overlay) {
  SK.selectedTextId = overlay.id;
  skRenderTextList();
  const input = document.createElement('input');
  input.type = 'text'; input.value = overlay.text;
  input.className = 'sk-inline-edit';
  input.style.cssText = `position:absolute;left:${overlay.xPct}%;top:${overlay.yPct}%;font:${el.style.font};color:${overlay.color};background:rgba(0,0,0,0.6);border:1px solid var(--accent-bright);border-radius:3px;padding:2px 4px;outline:none;z-index:5;pointer-events:all;min-width:60px;`;
  const container = qs('skTextOverlays');
  el.style.display = 'none';
  container.appendChild(input);
  input.focus(); input.select();
  const finish = () => {
    overlay.text = input.value || 'Text';
    input.remove();
    skRenderTextOverlays();
    skRenderTextList();
  };
  input.onblur = finish;
  input.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); finish(); } };
}

function skStartDragText(e, overlay) {
  e.preventDefault(); e.stopPropagation();
  SK.selectedTextId = overlay.id;
  skRenderTextOverlays();
  skRenderTextList();
  const container = qs('skTextOverlays');
  if (!container) return;
  const rect = container.getBoundingClientRect();
  const cx = e.touches ? e.touches[0].clientX : e.clientX;
  const cy = e.touches ? e.touches[0].clientY : e.clientY;
  const startXPct = overlay.xPct, startYPct = overlay.yPct;
  const startCx = cx, startCy = cy;
  const onMove = (ev) => {
    const mx = ev.touches ? ev.touches[0].clientX : ev.clientX;
    const my = ev.touches ? ev.touches[0].clientY : ev.clientY;
    const dx = ((mx - startCx) / rect.width) * 100;
    const dy = ((my - startCy) / rect.height) * 100;
    overlay.xPct = Math.max(0, Math.min(95, startXPct + dx));
    overlay.yPct = Math.max(0, Math.min(95, startYPct + dy));
    const el = document.getElementById(overlay.id);
    if (el) { el.style.left = overlay.xPct + '%'; el.style.top = overlay.yPct + '%'; }
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  document.addEventListener('touchmove', onMove, { passive: false });
  document.addEventListener('touchend', onUp);
}

function skRenderTextList() {
  const list = qs('skTextList');
  if (!list) return;
  if (SK.textOverlays.length === 0) {
    list.innerHTML = '<div class="sk-text-empty">Click + or use Text tool to add text</div>';
    return;
  }
  list.innerHTML = '';
  SK.textOverlays.forEach(t => {
    const item = document.createElement('div');
    item.className = 'sk-text-item' + (t.id === SK.selectedTextId ? ' sk-text-item-active' : '');
    item.innerHTML = `<span class="sk-text-item-preview">"${t.text}"</span><span class="sk-text-item-font">${t.font}</span><button class="sk-text-item-del" onclick="skRemoveTextOverlay('${t.id}')"><i data-lucide="x"></i></button>`;
    item.onclick = (e) => {
      if (e.target.closest('.sk-text-item-del')) return;
      SK.selectedTextId = t.id;
      skRenderTextOverlays(); skRenderTextList();
    };
    list.appendChild(item);
  });
  requestAnimationFrame(() => { if (window.lucide) window.lucide.createIcons(); });
}

function skToggleBold() {
  SK.textBold = !SK.textBold;
  const btn = qs('skTextBold');
  if (btn) btn.classList.toggle('active', SK.textBold);
  if (SK.selectedTextId) {
    const t = SK.textOverlays.find(o => o.id === SK.selectedTextId);
    if (t) { t.bold = SK.textBold; skRenderTextOverlays(); }
  }
}
window.skToggleBold = skToggleBold;

function skToggleItalic() {
  SK.textItalic = !SK.textItalic;
  const btn = qs('skTextItalic');
  if (btn) btn.classList.toggle('active', SK.textItalic);
  if (SK.selectedTextId) {
    const t = SK.textOverlays.find(o => o.id === SK.selectedTextId);
    if (t) { t.italic = SK.textItalic; skRenderTextOverlays(); }
  }
}
window.skToggleItalic = skToggleItalic;

// --- Canvas Event Setup ---
function skSetupEvents(canvas) {
  const c = canvas.cloneNode(true);
  c.id = 'sketchCanvas';
  canvas.parentNode.replaceChild(c, canvas);
  SK.ctx = c.getContext('2d'); SK.canvas = c;
  skRedrawCanvas();

  const getPos = (e) => {
    const rect = c.getBoundingClientRect();
    const sx = c.width / rect.width, sy = c.height / rect.height;
    const touch = e.touches && e.touches[0] ? e.touches[0] : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : null);
    const cx = touch ? touch.clientX : e.clientX;
    const cy = touch ? touch.clientY : e.clientY;
    return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
  };

  const getPctPos = (e) => {
    const container = qs('skTextOverlays');
    if (!container) return { xPct: 10, yPct: 10 };
    const rect = container.getBoundingClientRect();
    const touch = e.touches && e.touches[0] ? e.touches[0] : (e.changedTouches && e.changedTouches[0] ? e.changedTouches[0] : null);
    const cx = touch ? touch.clientX : e.clientX;
    const cy = touch ? touch.clientY : e.clientY;
    return { xPct: ((cx - rect.left) / rect.width) * 100, yPct: ((cy - rect.top) / rect.height) * 100 };
  };

  const getColor = () => qs('sketchColor')?.value || '#ff0000';
  const getSize = () => Number(qs('sketchSize')?.value || 4);
  const getOpacity = () => Number(qs('sketchOpacity')?.value || 100) / 100;

  const startDraw = (e) => {
    if (SK.tool === 'move') return;
    if (SK.tool === 'text') {
      e.preventDefault();
      const p = getPctPos(e);
      skAddTextOverlay(p.xPct, p.yPct);
      return;
    }
    if (SK.tool === 'eyedropper') {
      e.preventDefault();
      const pos = getPos(e);
      const px = SK.ctx.getImageData(Math.round(pos.x), Math.round(pos.y), 1, 1).data;
      const hex = '#' + [px[0], px[1], px[2]].map(v => v.toString(16).padStart(2, '0')).join('');
      const ci = qs('sketchColor'); if (ci) ci.value = hex;
      return;
    }
    e.preventDefault();
    SK.drawing = true;
    const pos = getPos(e);
    SK.startPos = pos;
    SK.shapePreview = null;

    if (SK.tool === 'select') {
      SK.shapePreview = { type: 'select', x: pos.x, y: pos.y, w: 0, h: 0 };
      skRedrawCanvas();
      return;
    }
    if (['line', 'rect', 'circle', 'arrow'].includes(SK.tool)) {
      SK.shapePreview = { type: SK.tool, from: pos, to: pos };
      skRedrawCanvas();
      return;
    }

    const dctx = SK.drawCtx;
    if (!dctx) return;
    dctx.beginPath();
    dctx.moveTo(pos.x, pos.y);
    dctx.lineWidth = getSize();
    dctx.lineCap = 'round';
    dctx.lineJoin = 'round';
    dctx.globalAlpha = getOpacity();
    if (SK.tool === 'eraser') {
      dctx.globalCompositeOperation = 'destination-out';
      dctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      dctx.globalCompositeOperation = 'source-over';
      dctx.strokeStyle = getColor();
    }
  };

  const moveDraw = (e) => {
    if (!SK.drawing || SK.tool === 'move') return;
    e.preventDefault();
    const pos = getPos(e);

    // Select area preview
    if (SK.tool === 'select' && SK.startPos) {
      const x = Math.min(SK.startPos.x, pos.x);
      const y = Math.min(SK.startPos.y, pos.y);
      const w = Math.abs(pos.x - SK.startPos.x);
      const h = Math.abs(pos.y - SK.startPos.y);
      SK.shapePreview = { type: 'select', x, y, w, h };
      skRedrawCanvas();
      return;
    }

    // Shape preview (line/rect/circle/arrow)
    if (['line', 'rect', 'circle', 'arrow'].includes(SK.tool) && SK.startPos) {
      SK.shapePreview = { type: SK.tool, from: SK.startPos, to: pos };
      skRedrawCanvas();
      return;
    }

    // Pen/eraser continuous stroke
    if (!SK.drawCtx) return;
    SK.drawCtx.lineTo(pos.x, pos.y);
    SK.drawCtx.stroke();
    skRedrawCanvas();
  };

  const endDraw = (e) => {
    if (!SK.drawing) return;
    SK.drawing = false;
    const pos = e && (e.changedTouches || e.clientX !== undefined) ? getPos(e) : SK.startPos;

    // Select: fill white on drawing layer
    if (SK.tool === 'select' && SK.shapePreview && SK.drawCtx) {
      const { x, y, w, h } = SK.shapePreview;
      SK.drawCtx.save();
      SK.drawCtx.globalCompositeOperation = 'source-over';
      SK.drawCtx.globalAlpha = 1;
      SK.drawCtx.fillStyle = '#ffffff';
      SK.drawCtx.fillRect(x, y, w, h);
      SK.drawCtx.restore();
      SK.startPos = null;
      SK.shapePreview = null;
      skPushHistory();
      skRedrawCanvas();
      return;
    }

    // Shapes: commit
    if (['line', 'rect', 'circle', 'arrow'].includes(SK.tool) && SK.startPos && pos && SK.drawCtx) {
      SK.drawCtx.save();
      SK.drawCtx.globalCompositeOperation = 'source-over';
      SK.drawCtx.strokeStyle = getColor();
      SK.drawCtx.fillStyle = getColor();
      SK.drawCtx.lineWidth = getSize();
      SK.drawCtx.lineCap = 'round';
      SK.drawCtx.globalAlpha = getOpacity();
      skDrawShape(SK.drawCtx, SK.tool, SK.startPos, pos, getSize());
      SK.drawCtx.restore();
      SK.startPos = null;
      SK.shapePreview = null;
      skPushHistory();
      skRedrawCanvas();
      return;
    }

    // Pen/eraser: commit
    if (SK.drawCtx) {
      SK.drawCtx.globalCompositeOperation = 'source-over';
      SK.drawCtx.globalAlpha = 1;
    }
    SK.startPos = null;
    SK.shapePreview = null;
    skPushHistory();
    skRedrawCanvas();
  };

  c.addEventListener('mousedown', startDraw);
  c.addEventListener('mousemove', moveDraw);
  c.addEventListener('mouseup', endDraw);
  c.addEventListener('mouseleave', endDraw);
  // Only handle single-touch; two-finger events are for pinch zoom
  c.addEventListener('touchstart', (e) => { if (e.touches.length === 1) startDraw(e); }, { passive: false });
  c.addEventListener('touchmove',  (e) => { if (e.touches.length === 1) moveDraw(e); else if (SK.drawing) { SK.drawing = false; skPushHistory(); skRedrawCanvas(); } }, { passive: false });
  c.addEventListener('touchend', endDraw);
  c.addEventListener('touchcancel', endDraw);
}

function skDrawShape(ctx, tool, from, to, size) {
  if (tool === 'line') {
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
  } else if (tool === 'rect') {
    const x = Math.min(from.x, to.x), y = Math.min(from.y, to.y);
    const w = Math.abs(to.x - from.x), h = Math.abs(to.y - from.y);
    ctx.strokeRect(x, y, w, h);
  } else if (tool === 'circle') {
    const cx = (from.x + to.x) / 2, cy = (from.y + to.y) / 2;
    const rx = Math.abs(to.x - from.x) / 2, ry = Math.abs(to.y - from.y) / 2;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  } else if (tool === 'arrow') {
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
    // Arrowhead
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    const headLen = size * 3;
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - headLen * Math.cos(angle - Math.PI / 6), to.y - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - headLen * Math.cos(angle + Math.PI / 6), to.y - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }
}

// --- Get editor text overlays for prompt ---
function skGetTextOverlaysForPrompt() {
  const overlays = window._lastEditorTextOverlays || [];
  if (overlays.length === 0) return '';
  return overlays.map(t => `"${t.text}" (font: ${t.font})`).join(', ');
}

function onMediaModalBackdropClick(e) {
  if (!e || !e.target) return;
  if (e.target.id === 'mediaModal') closeMediaModal();
}
window.onMediaModalBackdropClick = onMediaModalBackdropClick;

function openMediaModal(item) {
  const modal = qs('mediaModal');
  const body = qs('mediaModalBody');
  const title = qs('mediaModalTitle');
  const dl = qs('mediaModalDownload');
  if (!modal || !body || !title) return;

  currentPreview = item;
  body.innerHTML = '';

  title.textContent = (item && item.prompt) ? item.prompt : (item.type === 'video' ? 'Video' : (item.type === '3d' ? '3D Model' : 'Image'));

  const hasUrl = item && (item.url || item.glbUrl || item.modelDownloadUrl);
  if (dl) {
    dl.style.display = hasUrl ? 'inline-flex' : 'none';
    if (item && item.type === '3d') {
      const dlUrl3d = item.modelDownloadUrl || item.glbUrl;
      const dlExt3d = item.modelFormat || 'glb';
      dl.dataset.dlUrl = dlUrl3d;
      dl.dataset.dlName = `model-${item.timestamp || Date.now()}.${dlExt3d}`;
    } else if (item && item.type === 'video') {
      dl.dataset.dlUrl = item.url;
      dl.dataset.dlName = `generation-${item.timestamp || Date.now()}.mp4`;
    } else if (item) {
      dl.dataset.dlUrl = item.url;
      dl.dataset.dlName = `generation-${item.timestamp || Date.now()}.png`;
    }
  }
  const modalAssetBtn = qs('mediaModalUseAsset');
  if (modalAssetBtn) modalAssetBtn.style.display = hasUrl ? 'inline-flex' : 'none';
  const modalReuseBtn = qs('mediaModalReuse');
  if (modalReuseBtn) modalReuseBtn.style.display = (item.genCtx || item.prompt) ? 'inline-flex' : 'none';

  if (item.type === 'video') {
    const v = document.createElement('video');
    v.controls = true;
    v.playsInline = true;
    v.src = item.url;
    body.appendChild(v);
  } else if (item.type === '3d' && item.glbUrl) {
    const mv = document.createElement('model-viewer');
    mv.setAttribute('camera-controls', '');
    mv.setAttribute('auto-rotate', '');
    mv.setAttribute('rotation-per-second', '20deg');
    mv.setAttribute('shadow-intensity', '1');
    mv.setAttribute('exposure', '1.2');
    mv.setAttribute('environment-image', 'neutral');
    mv.setAttribute('tone-mapping', 'commerce');
    if (item.thumbUrl || item.url) mv.setAttribute('poster', item.thumbUrl || item.url);
    mv.setAttribute('loading', 'eager');
    mv.src = item.glbUrl;
    body.appendChild(mv);
  } else if (item.type === '3d') {
    // OBJ-only: show thumbnail image
    const img = document.createElement('img');
    img.src = item.url || '';
    img.alt = '3D Model (OBJ)';
    body.appendChild(img);
  } else {
    const img = document.createElement('img');
    img.src = item.url;
    body.appendChild(img);
  }

  bindAssetDragSource(body, item);
  const modalMedia = body.querySelector('img, video');
  if (modalMedia) bindAssetDragSource(modalMedia, item, { badge: false });

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function closeMediaModal() {
  closeAssetMenu();
  const modal = qs('mediaModal');
  const body = qs('mediaModalBody');
  const dl = qs('mediaModalDownload');
  const modalAssetBtn = qs('mediaModalUseAsset');
  const modalReuseBtn = qs('mediaModalReuse');
  if (body) {
    bindAssetDragSource(body, null);
    body.innerHTML = '';
  }
  if (dl) dl.style.display = 'none';
  if (modalAssetBtn) modalAssetBtn.style.display = 'none';
  if (modalReuseBtn) modalReuseBtn.style.display = 'none';
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

window.closeMediaModal = closeMediaModal;

window.addEventListener('keydown', (e) => {
  if (e && e.key === 'Escape') {
    const modal = qs('mediaModal');
    if (modal && modal.style.display && modal.style.display !== 'none') {
      closeMediaModal();
    }
  }
});

// Inline SVG icons for history items — avoids expensive global lucide.createIcons() scan
const _historyIcons = {
  play: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>',
  box: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>',
  image: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path></svg>',
  'repeat-2': '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m2 9 3-3 3 3"></path><path d="M13 18H7a2 2 0 0 1-2-2V6"></path><path d="m22 15-3 3-3-3"></path><path d="M11 6h6a2 2 0 0 1 2 2v10"></path></svg>',
  'package-plus': '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 16h6"></path><path d="M19 13v6"></path><path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14"></path><path d="m7.5 4.27 9 5.15"></path><polyline points="3.29 7 12 12 20.71 7"></polyline><line x1="12" x2="12" y1="22" y2="12"></line></svg>',
  download: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" x2="12" y1="15" y2="3"></line></svg>',
  'trash-2': '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path><line x1="10" x2="10" y1="11" y2="17"></line><line x1="14" x2="14" y1="11" y2="17"></line></svg>',
};
function _hIcon(name) { return _historyIcons[name] || ''; }

// Debounce helper for performance
function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

const MAX_HISTORY_RENDER = 100; // cap rendered items for performance
const HISTORY_SEARCH_DEBOUNCE_MS = 140;
let _historyControlsBound = false;
let _historySearchInputHandler = null;

function getHistoryFilterConfig(filterId = historyViewState.type) {
  return HISTORY_FILTERS.find((filter) => filter.id === filterId) || HISTORY_FILTERS[0];
}

function getHistoryPromptText(item) {
  return item && item.prompt ? String(item.prompt).trim() : '';
}

function getHistoryFallbackLabel(item) {
  if (item && item.type === 'video') return i18nText('opt_video', 'Video');
  if (item && item.type === '3d') return i18nText('tab_3d', '3D');
  return i18nText('opt_image', 'Image');
}

// Get appropriate thumbnail for history item — prefer small thumbnailUrl over full-res url
function getHistoryThumb(item) {
  if (item.type === 'video') {
    return item.thumbnailUrl || `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect fill="#1a1a2e" width="64" height="64" rx="8"/><polygon fill="#fff" points="26,20 26,44 46,32"/></svg>')}`;
  }
  if (item.type === '3d') {
    return item.thumbnailUrl || item.url || `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect fill="#1a1a2e" width="64" height="64" rx="8"/><path fill="#fff" d="M32 16L48 26V42L32 52L16 42V26L32 16Z" stroke="#fff" stroke-width="2" fill="none"/></svg>')}`;
  }
  // For images: prefer the small thumbnailUrl data URI over the full-res url
  return item.thumbnailUrl || item.url || `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect fill="#1a1a2e" width="64" height="64" rx="8"/><path fill="#fff" d="M15 45L26 31L34 39L43 28L52 45H15Z" opacity="0.9"/><circle cx="24" cy="21" r="5" fill="#fff" opacity="0.95"/></svg>')}`;
}

function getHistoryQueryTerms(query) {
  return String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
}

function matchesHistoryFilter(item, filterId) {
  const filter = getHistoryFilterConfig(filterId);
  return !filter.types || filter.types.includes(item.type);
}

function isHistoryViewFiltered() {
  return getHistoryFilterConfig().id !== HISTORY_FILTERS[0].id || getHistoryQueryTerms(historyViewState.query).length > 0;
}

function getFilteredHistoryItems() {
  const terms = getHistoryQueryTerms(historyViewState.query);

  return history.reduce((items, item, index) => {
    if (!item) return items;
    if (!matchesHistoryFilter(item, historyViewState.type)) return items;

    if (terms.length > 0) {
      const prompt = getHistoryPromptText(item).toLowerCase();
      if (!terms.every((term) => prompt.includes(term))) return items;
    }

    items.push({ item, index });
    return items;
  }, []);
}

const historyThumbnailPendingKeys = new Set();
const historyThumbnailQueue = [];
let historyThumbnailTimer = null;
let historyThumbnailRunning = false;

function queueHistoryThumbnailForItem(item, index = 0) {
  if (!canGenerateClientHistoryThumbnail(item)) return;
  const key = getHistoryIdentityKey(item, index);
  if (!key || historyThumbnailPendingKeys.has(key)) return;
  historyThumbnailPendingKeys.add(key);
  historyThumbnailQueue.push({ item, key });
  if (!historyThumbnailTimer && !historyThumbnailRunning) {
    historyThumbnailTimer = setTimeout(processHistoryThumbnailQueue, 60);
  }
}

function queueVisibleHistoryThumbnails(entries) {
  (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
    if (!entry || !entry.item) return;
    queueHistoryThumbnailForItem(entry.item, Number.isFinite(Number(entry.index)) ? Number(entry.index) : index);
  });
}

async function processHistoryThumbnailQueue() {
  historyThumbnailTimer = null;
  if (shouldSkipClientHistoryThumbnailWork()) return;
  if (historyThumbnailRunning) return;
  historyThumbnailRunning = true;
  let changed = false;
  let processed = 0;

  while (historyThumbnailQueue.length > 0 && processed < 2) {
    const work = historyThumbnailQueue.shift();
    if (!work || !work.item) continue;
    const { item, key } = work;
    try {
      let thumb = null;
      if (item.type === 'video') {
        thumb = await generateVideoThumbnail(item.url);
      }
      if (thumb && !item.thumbnailUrl) {
        item.thumbnailUrl = thumb;
        changed = true;
      }
    } catch (_) {
      // Ignore thumbnail generation failures and keep the lightweight placeholder.
    } finally {
      historyThumbnailPendingKeys.delete(key);
    }
    processed += 1;
  }

  historyThumbnailRunning = false;
  if (changed) {
    _pendingHistorySave = true;
    debouncedSaveHistory();
    scheduleHistoryUIUpdate();
    if (_fhgState.open) renderFhgGallery();
  }
  if (historyThumbnailQueue.length > 0 && !historyThumbnailTimer) {
    historyThumbnailTimer = setTimeout(processHistoryThumbnailQueue, 90);
  }
}

function setHistoryHydrating(loading) {
  const next = !!loading;
  if (historyHydrating === next) return;
  historyHydrating = next;
  scheduleHistoryUIUpdate();
  if (_fhgState.open) renderFhgGallery();
}

function appendHistoryMetaLoading(text) {
  if (!historyHydrating) return text;
  const loadingText = i18nText('history_syncing', 'Syncing history...');
  return text ? `${text} · ${loadingText}` : loadingText;
}
function updateHistorySearchUi(inputValue = null) {
  const searchInput = qs('historySearchInput');
  const clearBtn = qs('historySearchClear');
  const rawValue = inputValue !== null ? String(inputValue) : (searchInput ? searchInput.value : String(historyViewState.query || ''));

  if (searchInput && inputValue === null && searchInput.value !== historyViewState.query) {
    searchInput.value = historyViewState.query || '';
  }
  if (clearBtn) clearBtn.hidden = rawValue.length === 0;
}

function updateHistoryFilterUi() {
  const filterBar = qs('historyFilterBar');
  if (!filterBar) return;

  const activeId = getHistoryFilterConfig().id;
  filterBar.querySelectorAll('[data-history-filter]').forEach((btn) => {
    const isActive = btn.dataset.historyFilter === activeId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}

function clearHistorySearch(shouldFocus = false) {
  const searchInput = qs('historySearchInput');
  if (searchInput) searchInput.value = '';
  historyViewState.query = '';
  updateHistorySearchUi('');
  if (_historyRendered) updateHistoryUI();
  if (shouldFocus && searchInput) searchInput.focus();
}

function initHistoryControls() {
  if (_historyControlsBound) return;

  const searchInput = qs('historySearchInput');
  const clearBtn = qs('historySearchClear');
  const filterBar = qs('historyFilterBar');
  if (!searchInput || !clearBtn || !filterBar) return;

  if (!_historySearchInputHandler) {
    _historySearchInputHandler = debounce(() => {
      historyViewState.query = searchInput.value || '';
      if (_historyRendered) updateHistoryUI();
    }, HISTORY_SEARCH_DEBOUNCE_MS);
  }

  searchInput.addEventListener('input', () => {
    updateHistorySearchUi(searchInput.value || '');
    _historySearchInputHandler();
  });

  searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && searchInput.value) {
      event.preventDefault();
      clearHistorySearch(true);
    }
  });

  clearBtn.addEventListener('click', () => clearHistorySearch(true));

  filterBar.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-history-filter]');
    if (!btn) return;

    const nextFilter = getHistoryFilterConfig(btn.dataset.historyFilter).id;
    if (historyViewState.type === nextFilter) return;

    historyViewState.type = nextFilter;
    updateHistoryUI();
  });

  _historyControlsBound = true;
  updateHistoryFilterUi();
  updateHistorySearchUi();
}

function formatHistoryMeta(totalCount, shownCount) {
  if (totalCount === 0 && !isHistoryViewFiltered()) return '';

  if (isHistoryViewFiltered()) {
    if (totalCount > shownCount) {
      return i18nText('history_results_matches_capped', 'Showing {shown} of {count} matches')
        .replace('{shown}', shownCount)
        .replace('{count}', totalCount);
    }
    return i18nText('history_results_matches', '{count} matches').replace('{count}', totalCount);
  }

  if (history.length > shownCount) {
    return i18nText('history_results_total_capped', 'Showing {shown} of {count} items')
      .replace('{shown}', shownCount)
      .replace('{count}', history.length);
  }

  return i18nText('history_results_total', '{count} items').replace('{count}', history.length);
}

function updateHistoryEmptyState(emptyEl, textEl, message) {
  if (textEl) textEl.textContent = message;
  emptyEl.style.display = 'flex';
}

function updateHistoryUI() {
  const list = qs('historyList');
  const empty = qs('emptyHistory');
  const emptyText = qs('emptyHistoryText');
  const meta = qs('historyResultsMeta');
  const searchInput = qs('historySearchInput');
  if (!list || !empty || !emptyText || !meta) return;

  if (searchInput && searchInput.value !== historyViewState.query) {
    historyViewState.query = searchInput.value || '';
  }

  updateHistoryFilterUi();
  updateHistorySearchUi();

  if (!history || history.length === 0) {
    list.innerHTML = '';
    meta.textContent = appendHistoryMetaLoading('');
    updateHistoryEmptyState(
      empty,
      emptyText,
      historyHydrating
        ? i18nText('history_loading', 'Loading history...')
        : i18nText('history_empty', 'No creations yet')
    );
    return;
  }

  const filteredHistory = getFilteredHistoryItems();
  const renderItems = filteredHistory.slice(0, MAX_HISTORY_RENDER);
  meta.textContent = appendHistoryMetaLoading(formatHistoryMeta(filteredHistory.length, renderItems.length));

  if (filteredHistory.length === 0) {
    list.innerHTML = '';
    updateHistoryEmptyState(empty, emptyText, i18nText('history_empty_filtered', 'No history items match the current search or filter'));
    return;
  }

  empty.style.display = 'none';

  // Build HTML string — much faster than N createElement + innerHTML calls
  const parts = [];
  for (const entry of renderItems) {
    const item = entry.item;
    const idx = entry.index;
    const icon = item.type === 'video' ? 'play' : (item.type === '3d' ? 'box' : 'image');
    const thumbSrc = getHistoryThumb(item);
    const promptText = getHistoryPromptText(item) || getHistoryFallbackLabel(item);
    const timeText = item && item.timestamp
      ? new Date(item.timestamp).toLocaleTimeString(window.I18N ? I18N.lang : undefined)
      : '';

    parts.push(`<div class="history-item" data-index="${idx}"><div class="history-content"><div class="history-thumb-wrap"><img src="${escapeHtml(thumbSrc)}" class="history-thumb" loading="lazy" decoding="async" draggable="false" alt=""><div class="history-icon">${_hIcon(icon)}</div></div><div class="history-info"><div class="history-prompt">${escapeHtml(promptText)}</div><div class="history-time">${escapeHtml(timeText)}</div></div></div><div class="history-actions"><button class="history-action-btn" data-action="reuse" title="Reuse Prompt & Settings">${_hIcon('repeat-2')}</button><button class="history-action-btn" data-action="use-asset" title="Use as Asset">${_hIcon('package-plus')}</button><button class="history-action-btn" data-action="download" title="Download">${_hIcon('download')}</button><button class="history-action-btn history-action-btn--danger" data-action="delete" title="Delete">${_hIcon('trash-2')}</button></div></div>`);
  }

  list.innerHTML = parts.join('');

  // Single event listener for all history items (event delegation)
  list.onclick = handleHistoryClick;
  list.querySelectorAll('.history-thumb-wrap').forEach((thumb) => {
    const itemEl = thumb.closest('.history-item');
    const idx = itemEl ? Number(itemEl.dataset.index) : -1;
    bindAssetDragSource(thumb, idx >= 0 ? history[idx] : null, {
      onDragStart: closeHistoryDrawerDuringNativeDrag,
      onDragEnd: finalizeHistoryDrawerAfterNativeDrag,
      onTouchDragStart: closeHistoryDrawerDuringTouchDrag,
    });
  });
  queueVisibleHistoryThumbnails(renderItems);

  // No lucide.createIcons() needed — all icons are inline SVGs
}

function handleHistoryClick(e) {
  const actionBtn = e.target.closest('.history-action-btn');
  const historyItem = e.target.closest('.history-item');

  if (!historyItem) return;

  const idx = parseInt(historyItem.dataset.index, 10);
  if (isNaN(idx) || idx < 0 || idx >= history.length) return;

  if (actionBtn) {
    e.stopPropagation();
    const action = actionBtn.dataset.action;
    if (action === 'reuse') {
      e.stopPropagation();
      reuseFromHistory(idx);
    } else if (action === 'use-asset') {
      e.stopPropagation();
      useHistoryAsAsset(idx, actionBtn);
    } else if (action === 'download') {
      downloadFromHistory(idx, e);
    } else if (action === 'delete') {
      deleteFromHistory(idx, e);
    }
    return;
  }

  // Click on item itself - display it
  const item = history[idx];
  if (!item) return;

  exitWizFullscreen();
  galleryItems = [item];
  galleryIndex = 0;
  currentPreview = item;
  displayResult(item);

  // Close drawer on mobile
  const drawer = qs('historyDrawer');
  const overlay = qs('drawerOverlay');
  if (drawer && window.innerWidth <= 900) {
    drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('open');
  }
}

function addToHistory(item) {
  ensureHistoryItemIdentity(item);
  history.unshift(item);
  saveHistory();
  scheduleHistoryUIUpdate();
  queueAccountHistoryPersist(item);
}

function createTaskHistoryItemId(task, suffix) {
  const taskId = task && task.id ? String(task.id) : createHistoryClientId();
  const safeSuffix = suffix ? String(suffix) : 'output';
  return `task_${taskId}_${safeSuffix}`;
}

function buildTaskHistoryItem(task, type, url, options = {}) {
  const suffix = options.suffix || (type === '3d' ? '3d' : 'output');
  const meta = options.meta && typeof options.meta === 'object' ? { ...options.meta } : {};
  meta.clientId = meta.clientId || createTaskHistoryItemId(task, suffix);
  meta.taskId = meta.taskId || (task && task.id ? String(task.id) : null);
  if (Number.isFinite(Number(options.outputIndex))) meta.outputIndex = Number(options.outputIndex);
  return {
    id: meta.clientId,
    type,
    url,
    prompt: task && task.prompt ? task.prompt : '',
    timestamp: Number.isFinite(Number(options.timestamp)) ? Number(options.timestamp) : Date.now(),
    genCtx: task && task.genCtx ? task.genCtx : null,
    meta,
  };
}

// ===== FULLSCREEN HISTORY GALLERY =====
let _fhgState = { filter: 'all', query: '', open: false, searchHandler: null };

function openFullHistory() {
  const el = qs('fullHistoryGallery');
  if (!el) return;

  // Close the side drawer first
  const drawer = qs('historyDrawer');
  const overlay = qs('drawerOverlay');
  if (drawer) drawer.classList.remove('open');
  if (overlay) overlay.classList.remove('open');

  _fhgState.open = true;
  _fhgState.filter = 'all';
  _fhgState.query = '';
  _fhgFirstRender = true;
  el.style.display = 'flex';
  el.classList.remove('fhg-closing');
  document.body.style.overflow = 'hidden';
  const grid = qs('fhgGrid');
  if (grid) grid.classList.remove('fhg-no-anim');

  // Reset search input and filter buttons
  const searchInput = qs('fhgSearchInput');
  if (searchInput) searchInput.value = '';
  const filterBar = qs('fhgFilterBar');
  if (filterBar) {
    filterBar.querySelectorAll('.fhg-filter').forEach(b => b.classList.toggle('active', b.dataset.fhgFilter === 'all'));
  }

  // Re-apply i18n to gallery elements
  if (window.I18N && typeof I18N.t === 'function') {
    el.querySelectorAll('[data-i18n]').forEach(e => { e.textContent = I18N.t(e.dataset.i18n); });
    el.querySelectorAll('[data-i18n-placeholder]').forEach(e => { e.placeholder = I18N.t(e.dataset.i18nPlaceholder); });
  }

  initFhgControls();
  renderFhgGallery();

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    requestAnimationFrame(() => window.lucide.createIcons({ nameAttr: 'data-lucide' }));
  }
}
window.openFullHistory = openFullHistory;

function closeFullHistory() {
  const el = qs('fullHistoryGallery');
  if (!el) return;
  _fhgState.open = false;
  el.classList.add('fhg-closing');
  document.body.style.overflow = '';
  setTimeout(() => {
    el.style.display = 'none';
    el.classList.remove('fhg-closing');
  }, 300);
}
window.closeFullHistory = closeFullHistory;

let _fhgControlsBound = false;
function initFhgControls() {
  if (_fhgControlsBound) return;
  const searchInput = qs('fhgSearchInput');
  const filterBar = qs('fhgFilterBar');

  if (searchInput) {
    _fhgState.searchHandler = debounce(() => {
      _fhgState.query = searchInput.value || '';
      renderFhgGallery();
    }, 160);
    searchInput.addEventListener('input', _fhgState.searchHandler);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchInput.value) {
        e.preventDefault();
        e.stopPropagation();
        searchInput.value = '';
        _fhgState.query = '';
        renderFhgGallery();
      }
    });
  }

  if (filterBar) {
    filterBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-fhg-filter]');
      if (!btn) return;
      const next = btn.dataset.fhgFilter;
      if (_fhgState.filter === next) return;
      _fhgState.filter = next;
      filterBar.querySelectorAll('.fhg-filter').forEach(b => b.classList.toggle('active', b.dataset.fhgFilter === next));
      renderFhgGallery();
    });
  }

  _fhgControlsBound = true;
}

function getFhgFilteredItems() {
  const terms = _fhgState.query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return history.reduce((out, item, index) => {
    if (!item) return out;
    if (!matchesHistoryFilter(item, _fhgState.filter)) return out;
    if (terms.length > 0) {
      const prompt = getHistoryPromptText(item).toLowerCase();
      if (!terms.every(t => prompt.includes(t))) return out;
    }
    out.push({ item, index });
    return out;
  }, []);
}

let _fhgFirstRender = true;

function renderFhgGallery() {
  const grid = qs('fhgGrid');
  const empty = qs('fhgEmpty');
  const meta = qs('fhgMeta');
  if (!grid) return;

  // Skip animations on filter/search updates (not the first open)
  const skipAnim = !_fhgFirstRender;
  if (skipAnim) grid.classList.add('fhg-no-anim');

  const filtered = getFhgFilteredItems();
  const maxItems = 200;
  const items = filtered.slice(0, maxItems);

  if (meta) {
    if (filtered.length === 0 && history.length === 0) {
      meta.textContent = appendHistoryMetaLoading('');
    } else if (filtered.length > maxItems) {
      meta.textContent = appendHistoryMetaLoading((i18nText('history_results_matches_capped', 'Showing {shown} of {count} matches') || 'Showing {shown} of {count}')
        .replace('{shown}', maxItems).replace('{count}', filtered.length));
    } else {
      meta.textContent = appendHistoryMetaLoading((i18nText('history_results_total', '{count} items') || '{count} items')
        .replace('{count}', filtered.length));
    }
  }

  if (items.length === 0) {
    grid.innerHTML = '';
    if (empty) {
      empty.style.display = 'flex';
      if (window.lucide && typeof window.lucide.createIcons === 'function') {
        requestAnimationFrame(() => window.lucide.createIcons({ nameAttr: 'data-lucide' }));
      }
    }
    _fhgFirstRender = false;
    return;
  }

  if (empty) empty.style.display = 'none';

  const parts = [];
  for (const entry of items) {
    const item = entry.item;
    const idx = entry.index;
    const icon = item.type === 'video' ? 'play' : (item.type === '3d' ? 'box' : 'image');
    const thumbSrc = getHistoryThumb(item);
    const promptText = getHistoryPromptText(item) || getHistoryFallbackLabel(item);
    const timeText = item && item.timestamp
      ? new Date(item.timestamp).toLocaleString(window.I18N ? I18N.lang : undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '';

    parts.push(
      `<div class="fhg-card" data-index="${idx}">` +
        `<img class="fhg-card-img" src="${escapeHtml(thumbSrc)}" loading="lazy" alt="">` +
        `<div class="fhg-card-type">${_hIcon(icon)}</div>` +
        `<div class="fhg-card-actions">` +
          `<button class="fhg-card-action" data-action="download" title="Download">${_hIcon('download')}</button>` +
          `<button class="fhg-card-action fhg-card-action--danger" data-action="delete" title="Delete">${_hIcon('trash-2')}</button>` +
        `</div>` +
        `<div class="fhg-card-info">` +
          `<div class="fhg-card-prompt">${escapeHtml(promptText)}</div>` +
          `<div class="fhg-card-time">${escapeHtml(timeText)}</div>` +
        `</div>` +
      `</div>`
    );
  }

  grid.innerHTML = parts.join('');
  grid.onclick = handleFhgClick;
  queueVisibleHistoryThumbnails(items);
  _fhgFirstRender = false;
}

function handleFhgClick(e) {
  const actionBtn = e.target.closest('.fhg-card-action');
  const card = e.target.closest('.fhg-card');
  if (!card) return;

  const idx = parseInt(card.dataset.index, 10);
  if (isNaN(idx) || idx < 0 || idx >= history.length) return;

  if (actionBtn) {
    e.stopPropagation();
    const action = actionBtn.dataset.action;
    if (action === 'download') {
      downloadFromHistory(idx, e);
    } else if (action === 'delete') {
      deleteFromHistory(idx, e);
      renderFhgGallery();
    }
    return;
  }

  // Click on card: show it and close gallery
  const item = history[idx];
  if (!item) return;
  exitWizFullscreen();
  galleryItems = [item];
  galleryIndex = 0;
  currentPreview = item;
  displayResult(item);
  closeFullHistory();
}

// Escape key closes fullscreen gallery
const _origKeydownForFhg = window.addEventListener('keydown', function _fhgEsc(e) {
  if (e.key === 'Escape' && _fhgState.open) {
    const searchInput = qs('fhgSearchInput');
    if (searchInput && searchInput.value) return; // let search clear handler handle it
    closeFullHistory();
  }
}, true);

// Silent version: adds to array without triggering save/UI (for batch inserts)
function addToHistorySilent(item) {
  ensureHistoryItemIdentity(item);
  history.unshift(item);
}

// Debounced history save — coalesces multiple thumbnail saves into one write
let _pendingHistorySave = false;
let _historySaveTimer = null;
function debouncedSaveHistory() {
  if (_historySaveTimer) return;
  _historySaveTimer = setTimeout(() => {
    _historySaveTimer = null;
    if (_pendingHistorySave) {
      _pendingHistorySave = false;
      saveHistory();
    }
  }, 500);
}

// Debounced history UI refresh — prevents cascade of full DOM rebuilds
let _historyUITimer = null;
function scheduleHistoryUIUpdate() {
  // If drawer hasn't been opened yet, just mark it dirty so next open rebuilds
  if (!_historyRendered) return;
  if (_historyUITimer) return; // already scheduled
  _historyUITimer = requestAnimationFrame(() => {
    _historyUITimer = null;
    updateHistoryUI();
  });
}

function deleteFromHistory(index, event) {
  event.stopPropagation();
  const removed = history[index] || null;
  history.splice(index, 1);
  saveHistory();
  updateHistoryUI();
  if (removed) queueAccountHistoryDelete(removed);
}
window.deleteFromHistory = deleteFromHistory;

function downloadFromHistory(index, event) {
  event.stopPropagation();
  const item = history[index];
  if (!item) return;
  let url, name;
  if (item.type === '3d') {
    url = item.modelDownloadUrl || item.glbUrl;
    const ext = item.modelFormat || 'glb';
    name = `model-${item.timestamp || Date.now()}.${ext}`;
  } else if (item.type === 'video') {
    url = item.url;
    name = `generation-${item.timestamp || Date.now()}.mp4`;
  } else {
    url = item.url;
    name = `generation-${item.timestamp || Date.now()}.png`;
  }
  forceDownload(url, name);
}
window.downloadFromHistory = downloadFromHistory;

function displayResult(item) {
  currentPreview = item;

  const img = qs('resultImage');
  const vid = qs('resultVideo');
  const model = qs('resultModel');
  const placeholder = qs('placeholder');
  const dl = qs('downloadBtn');

  if (placeholder) placeholder.style.display = 'none';
  const assetBtn = qs('useAsAssetBtn');

  if (item.type === 'video') {
    if (img) img.style.display = 'none';
    if (model) model.style.display = 'none';
    if (vid) {
      vid.style.display = 'block';
      vid.poster = item.thumbnailUrl || '';
      vid.src = item.url;
    }
    if (dl) {
      dl.style.display = 'inline-flex';
      dl.dataset.dlUrl = item.url;
      dl.dataset.dlName = `generation-${item.timestamp || Date.now()}.mp4`;
    }
  } else if (item.type === '3d') {
    if (vid) vid.style.display = 'none';
    const dlUrl = item.modelDownloadUrl || item.glbUrl;
    const dlExt = item.modelFormat || 'glb';
    if (item.glbUrl) {
      if (img) img.style.display = 'none';
      if (model) { model.style.display = 'block'; model.src = item.glbUrl; }
    } else {
      // OBJ-only: show thumbnail, hide model-viewer
      if (model) model.style.display = 'none';
      if (img) { img.style.display = 'block'; img.src = item.url || ''; }
    }
    if (dl) {
      dl.style.display = 'inline-flex';
      dl.dataset.dlUrl = dlUrl;
      dl.dataset.dlName = `model-${item.timestamp || Date.now()}.${dlExt}`;
    }
  } else {
    if (vid) vid.style.display = 'none';
    if (model) model.style.display = 'none';
    if (img) {
      img.style.display = 'block';
      img.src = item.url;
    }
    if (dl) {
      dl.style.display = 'inline-flex';
      dl.dataset.dlUrl = item.url;
      dl.dataset.dlName = `generation-${item.timestamp || Date.now()}.png`;
    }
  }

  if (assetBtn) assetBtn.style.display = dl && dl.style.display !== 'none' ? 'inline-flex' : 'none';

  const editBtn = qs('editImageBtn');
  const isImage = item.type === 'image' || (!item.type);
  if (editBtn) editBtn.style.display = isImage ? 'inline-flex' : 'none';

  const previewArea = qs('previewArea');
  if (previewArea) bindAssetDragSource(previewArea, item);
  if (img) bindAssetDragSource(img, item.type === 'image' ? item : null, { badge: false });
  if (vid) bindAssetDragSource(vid, item.type === 'video' ? item : null, { badge: false });

  updateGalleryNav();

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function setGalleryItems(items) {
  galleryItems = items || [];
  galleryIndex = 0;
  if (galleryItems.length > 0) {
    displayResult(galleryItems[0]);
  }
}

function showGalleryItem(index) {
  if (index < 0 || index >= galleryItems.length) return;
  galleryIndex = index;
  displayResult(galleryItems[galleryIndex]);
}

function galleryPrev() {
  if (galleryIndex > 0) {
    showGalleryItem(galleryIndex - 1);
  }
}

function galleryNext() {
  if (galleryIndex < galleryItems.length - 1) {
    showGalleryItem(galleryIndex + 1);
  }
}

window.galleryPrev = galleryPrev;
window.galleryNext = galleryNext;

function updateGalleryNav() {
  let nav = qs('galleryNav');
  const previewArea = qs('previewArea');
  
  if (galleryItems.length <= 1) {
    if (nav) nav.style.display = 'none';
    return;
  }
  
  if (!nav && previewArea) {
    nav = document.createElement('div');
    nav.id = 'galleryNav';
    nav.className = 'gallery-nav';
    nav.innerHTML = `
      <button class="gallery-nav-btn" onclick="galleryPrev()" id="galleryPrevBtn">
        <i data-lucide="chevron-left"></i>
      </button>
      <span class="gallery-counter" id="galleryCounter">1 / 1</span>
      <button class="gallery-nav-btn" onclick="galleryNext()" id="galleryNextBtn">
        <i data-lucide="chevron-right"></i>
      </button>
    `;
    previewArea.appendChild(nav);
    if (window.lucide) window.lucide.createIcons();
  }
  
  if (nav) {
    nav.style.display = 'flex';
    const counter = qs('galleryCounter');
    const prevBtn = qs('galleryPrevBtn');
    const nextBtn = qs('galleryNextBtn');
    
    if (counter) counter.textContent = `${galleryIndex + 1} / ${galleryItems.length}`;
    if (prevBtn) prevBtn.disabled = galleryIndex === 0;
    if (nextBtn) nextBtn.disabled = galleryIndex === galleryItems.length - 1;
  }
}

const TASK_QUEUE_STALE_MS = 15 * 1000;
const TASK_SUBMITTING_STALE_MS = 8 * 60 * 1000;
const TASK_FAILED_VISIBLE_MS = 15 * 60 * 1000;

function markTaskActivity(task) {
  if (!task || typeof task !== 'object') return;
  task.lastActivityAt = Date.now();
}

function normalizeTasksForDisplay() {
  const now = Date.now();
  let changed = false;
  const seenIds = new Set();
  const nextTasks = [];

  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || !task.id) {
      changed = true;
      continue;
    }
    if (seenIds.has(task.id)) {
      changed = true;
      continue;
    }
    seenIds.add(task.id);

    const age = Math.max(0, now - (task.lastActivityAt || task.startedAt || task.createdAt || now));
    if (task.status === 'QUEUED' && age > TASK_QUEUE_STALE_MS) {
      task.status = 'FAILED';
      task.failedAt = task.failedAt || now;
      task.error = task.error || 'Interrupted - please try again';
      changed = true;
    }
    if (task.status === 'SUBMITTING' && age > TASK_SUBMITTING_STALE_MS) {
      task.status = 'FAILED';
      task.failedAt = task.failedAt || now;
      task.error = task.error || 'Task expired after being active too long. Please try again.';
      changed = true;
    }

    const failedAge = Math.max(0, now - (task.failedAt || task.createdAt || now));
    if (task.status === 'FAILED' && failedAge > TASK_FAILED_VISIBLE_MS) {
      changed = true;
      continue;
    }

    nextTasks.push(task);
  }

  if (changed) {
    tasks = nextTasks;
    saveTasks();
  }
}

function removeTask(taskId) {
  if (pollTimers.has(taskId)) {
    clearTimeout(pollTimers.get(taskId));
    pollTimers.delete(taskId);
  }

  const removedTasks = tasks.filter((t) => t && t.id === taskId);
  if (!removedTasks.length) return;

  tasks = tasks.filter((t) => !t || t.id !== taskId);
  saveTasks();
  renderTasks();

  removedTasks.forEach((task) => {
    if (!task || task.blobCleanupDone) return;
    cleanupTaskUploads(task)
      .then(() => {
        if (task.blobCleanupError) {
          console.warn('Task upload cleanup issue:', task.blobCleanupError);
        }
      })
      .catch((e) => {
        console.warn('Task upload cleanup failed:', e && e.message ? e.message : e);
      });
  });
}
window.removeTask = removeTask;

function renderTasks() {
  const panel = qs('generationsPanel');
  if (!panel) return;

  normalizeTasksForDisplay();

  const active = tasks.filter((t) => t && t.status && t.status !== 'COMPLETED');
  if (active.length === 0) {
    panel.style.display = 'none';
    panel.innerHTML = '';
    return;
  }

  panel.style.display = 'block';
  panel.innerHTML = active
    .slice(0, 10)
    .map((t) => {
      const age = Math.max(0, Date.now() - (t.startedAt || t.createdAt || Date.now()));
      const secs = (age / 1000).toFixed(1);
      const status = escapeHtml(getTaskStatusLabel(t.status));
      const prompt = escapeHtml((t.prompt || '').slice(0, 120));
      const errText = formatErrorForDisplay(t.error || '');
      const err = errText ? `<div class="task-error">${escapeHtml(errText)}</div>` : '';
      const isFailed = t.status === 'FAILED';
      const canDismiss = t.status !== 'COMPLETED';
      const actionLabel = isFailed
        ? i18nText('task_action_dismiss', 'Dismiss')
        : i18nText('task_action_cancel', 'Cancel');
      const removeBtn = canDismiss
        ? `<button class="task-remove" onclick="removeTask('${t.id}')" title="${escapeHtml(actionLabel)}" aria-label="${escapeHtml(actionLabel)}">&times;</button>`
        : '';
      return `
        <div class="task-card ${isFailed ? 'task-failed' : 'task-running'}">
          <div class="task-row">
            <div class="task-status-label">${status}</div>
            <div class="task-meta">
              <span class="task-time">${secs}s</span>
              ${removeBtn}
            </div>
          </div>
          <div class="task-prompt">${prompt}</div>
          ${err}
        </div>
      `;
    })
    .join('');
}
async function readFileAsDataUri(file) {
  if (!file) return null;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function generateVideoThumbnail(videoUrl) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'metadata';
    
    video.onloadeddata = () => {
      video.currentTime = 0.1;
    };
    
    video.onseeked = () => {
      try {
        const MAX = 88;
        let w = video.videoWidth || 320, h = video.videoHeight || 180;
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, w, h);
        const thumbnail = canvas.toDataURL('image/jpeg', 0.6);
        resolve(thumbnail);
      } catch (e) {
        resolve(null);
      }
      video.src = '';
      video.load();
    };
    
    video.onerror = () => resolve(null);
    
    setTimeout(() => resolve(null), 8000);
    
    video.src = videoUrl;
    video.load();
  });
}

// Generate a small thumbnail data URI from an image URL (88px max, JPEG)
function generateImageThumbnail(imageUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const MAX = 88; // 2× the 44px display size for retina
        let w = img.naturalWidth, h = img.naturalHeight;
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else { w = Math.round(w * MAX / h); h = MAX; }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      } catch (e) {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    setTimeout(() => resolve(null), 8000);
    img.src = imageUrl;
  });
}

function extractMediaUrl(data, type) {
  if (type === 'video') {
    return (
      (data && data.video && data.video.url) ||
      (Array.isArray(data && data.videos) && data.videos[0] && data.videos[0].url) ||
      null
    );
  }
  return (
    (data && data.image && data.image.url) ||
    (Array.isArray(data && data.images) && data.images[0] && data.images[0].url) ||
    null
  );
}

function extractAllMediaUrls(data, type) {
  const urls = [];
  const pushUnique = (url) => {
    const next = String(url || '').trim();
    if (!next || urls.includes(next)) return;
    urls.push(next);
  };
  if (type === 'video') {
    if (data && data.video && data.video.url) pushUnique(data.video.url);
    if (Array.isArray(data && data.videos)) {
      for (const v of data.videos) {
        if (v && v.url) pushUnique(v.url);
      }
    }
  } else {
    if (data && data.image && data.image.url) pushUnique(data.image.url);
    if (Array.isArray(data && data.images)) {
      for (const img of data.images) {
        if (img && img.url) pushUnique(img.url);
      }
    }
  }
  return urls;
}

function isGlbFile(fileObj) {
  if (!fileObj || !fileObj.url) return false;
  const ct = (fileObj.content_type || '').toLowerCase();
  const fn = (fileObj.file_name || fileObj.url || '').toLowerCase();
  if (ct.includes('gltf') || ct.includes('glb')) return true;
  if (fn.endsWith('.glb') || fn.endsWith('.gltf')) return true;
  return false;
}

function extract3dOutput(resultJson) {
  if (!resultJson || typeof resultJson !== 'object') return null;
  const modelUrls = (resultJson.model_urls && typeof resultJson.model_urls === 'object') ? resultJson.model_urls : null;
  const thumbnailUrl = (resultJson.thumbnail && resultJson.thumbnail.url) ? resultJson.thumbnail.url : null;

  // Try to find a real GLB URL
  let glbUrl = null;
  // Check model_urls.glb first (most reliable)
  if (modelUrls && modelUrls.glb && modelUrls.glb.url && isGlbFile(modelUrls.glb)) {
    glbUrl = modelUrls.glb.url;
  }
  // Check model_glb only if it's actually a GLB (Rapid model returns OBJ here)
  if (!glbUrl && resultJson.model_glb && resultJson.model_glb.url && isGlbFile(resultJson.model_glb)) {
    glbUrl = resultJson.model_glb.url;
  }

  // Best downloadable model URL (GLB preferred, then OBJ, then whatever model_glb has)
  let modelDownloadUrl = glbUrl;
  let modelFormat = glbUrl ? 'glb' : null;
  if (!modelDownloadUrl) {
    if (modelUrls && modelUrls.obj && modelUrls.obj.url) {
      modelDownloadUrl = modelUrls.obj.url;
      modelFormat = 'obj';
    } else if (resultJson.model_glb && resultJson.model_glb.url) {
      modelDownloadUrl = resultJson.model_glb.url;
      const fn = (resultJson.model_glb.file_name || resultJson.model_glb.url || '').toLowerCase();
      modelFormat = fn.endsWith('.obj') ? 'obj' : (fn.endsWith('.fbx') ? 'fbx' : 'glb');
    }
  }

  return { glbUrl, modelDownloadUrl, modelFormat, thumbnailUrl, modelUrls };
}

function sanitizePathPart(s) {
  return String(s || '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 80);
}

const MIME_BY_EXT = {
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.obj': 'application/octet-stream',
  '.fbx': 'application/octet-stream',
  '.stl': 'application/octet-stream',
  '.usdz': 'application/octet-stream',
};

function resolveMime(file) {
  if (file.type) return file.type;
  const name = (file.name || '').toLowerCase();
  const dot = name.lastIndexOf('.');
  if (dot !== -1) {
    const ext = name.slice(dot);
    if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  }
  return 'application/octet-stream';
}

function ensureTaskUploadList(task) {
  if (!task || typeof task !== 'object') return null;
  if (!Array.isArray(task.uploadedBlobUrls)) {
    task.uploadedBlobUrls = [];
  }
  return task.uploadedBlobUrls;
}

function registerTaskBlobUrl(task, url) {
  if (!task || !url) return;
  const list = ensureTaskUploadList(task);
  if (!list) return;
  // Keep only a tiny bounded record for legacy task compatibility.
  if (!list.includes(url) && list.length < 4) list.push(url);
}

async function cleanupTaskUploads(task) {
  if (!task || typeof task !== 'object') return;
  if (task.blobCleanupDone) return;

  task.uploadedBlobUrls = [];
  task.blobCleanupDone = true;
  task.blobCleanupAt = Date.now();
  task.blobCleanupError = null;
}

function isDirectRemoteUrl(value) {
  return typeof value === 'string' && /^(https?:)?\/\//i.test(value.trim());
}

function canPassThroughRemoteUrl(value) {
  if (!isDirectRemoteUrl(value)) return false;
  try {
    const url = new URL(String(value).trim(), window.location.href);
    // Same-origin assets on this private app are not publicly reachable by Fal.
    return url.origin !== window.location.origin;
  } catch (_) {
    return false;
  }
}

const VIDEO_IMAGE_UPLOAD_FOLDERS = new Set([
  'video-image',
  'video-end-image',
]);
const VIDEO_IMAGE_UPLOAD_MAX_EDGE_PX = 2048;
const VIDEO_IMAGE_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;
const VIDEO_IMAGE_UPLOAD_LARGE_BYTES = 4 * 1024 * 1024;

function shouldOptimizeVideoUploadImage(file, folder) {
  if (!file || !(file instanceof Blob)) return false;
  if (!VIDEO_IMAGE_UPLOAD_FOLDERS.has(String(folder || ''))) return false;
  const type = String(file.type || '').toLowerCase();
  if (!type.startsWith('image/')) return false;
  if (type.includes('svg')) return false;
  return true;
}

function getOptimizedImageExtension(type, fallbackName = 'upload') {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'image/png') return '.png';
  if (normalized === 'image/webp') return '.webp';
  if (normalized === 'image/avif') return '.avif';
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return '.jpg';
  const match = String(fallbackName || '').match(/(\.[a-z0-9]+)$/i);
  return match ? match[1] : '.jpg';
}

function buildOptimizedImageFilename(name, type) {
  const base = String(name || 'upload')
    .replace(/(\.[a-z0-9]+)$/i, '')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'upload';
  return `${base}${getOptimizedImageExtension(type, name)}`;
}

function createUploadCanvas(width, height) {
  const safeWidth = Math.max(1, Math.round(Number(width) || 1));
  const safeHeight = Math.max(1, Math.round(Number(height) || 1));
  const canvas = document.createElement('canvas');
  canvas.width = safeWidth;
  canvas.height = safeHeight;
  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.toBlob !== 'function') {
      reject(new Error('Canvas export unavailable'));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas export failed'));
    }, type, quality);
  });
}

async function decodeImageForUpload(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        cleanup() {
          if (typeof bitmap.close === 'function') bitmap.close();
        },
      };
    } catch (_) {
      // Fall back to Image element below.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.decoding = 'async';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image decode failed'));
      el.src = objectUrl;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width || 0,
      height: img.naturalHeight || img.height || 0,
      cleanup() {
        URL.revokeObjectURL(objectUrl);
      },
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function detectImageHasAlpha(source) {
  try {
    const sampleCanvas = createUploadCanvas(32, 32);
    const ctx = sampleCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.clearRect(0, 0, sampleCanvas.width, sampleCanvas.height);
    ctx.drawImage(source, 0, 0, sampleCanvas.width, sampleCanvas.height);
    const pixels = ctx.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height).data;
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] < 250) return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}

async function optimizeImageForVideoUpload(file, folder) {
  if (!shouldOptimizeVideoUploadImage(file, folder)) return file;

  let decoded = null;
  try {
    decoded = await decodeImageForUpload(file);
    const width = Number(decoded.width) || 0;
    const height = Number(decoded.height) || 0;
    if (!width || !height) return file;

    const longestEdge = Math.max(width, height);
    const needsResize = longestEdge > VIDEO_IMAGE_UPLOAD_MAX_EDGE_PX;
    const isLargeFile = Number(file.size) > VIDEO_IMAGE_UPLOAD_LARGE_BYTES;
    if (!needsResize && !isLargeFile) return file;

    const scale = Math.min(1, VIDEO_IMAGE_UPLOAD_MAX_EDGE_PX / longestEdge);
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = createUploadCanvas(targetWidth, targetHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(decoded.source, 0, 0, targetWidth, targetHeight);

    const hasAlpha = detectImageHasAlpha(decoded.source);
    const attempts = hasAlpha
      ? [
          { type: 'image/webp', quality: 0.92 },
          { type: 'image/webp', quality: 0.84 },
          { type: 'image/png' },
        ]
      : [
          { type: 'image/jpeg', quality: 0.9 },
          { type: 'image/jpeg', quality: 0.82 },
          { type: 'image/webp', quality: 0.84 },
          { type: 'image/jpeg', quality: 0.74 },
        ];

    let bestBlob = null;
    for (const attempt of attempts) {
      let blob = null;
      try {
        blob = await canvasToBlob(canvas, attempt.type, attempt.quality);
      } catch (_) {
        blob = null;
      }
      if (!blob) continue;
      if (!bestBlob || blob.size < bestBlob.size) bestBlob = blob;
      if (blob.size <= VIDEO_IMAGE_UPLOAD_MAX_BYTES) {
        bestBlob = blob;
        break;
      }
    }

    if (!bestBlob) return file;
    const optimizedType = bestBlob.type || (hasAlpha ? 'image/webp' : 'image/jpeg');
    const optimizedFile = new File(
      [bestBlob],
      buildOptimizedImageFilename(file.name, optimizedType),
      { type: optimizedType, lastModified: Date.now() }
    );

    // Only replace when we materially improve upload cost or dimensions.
    if (optimizedFile.size >= file.size * 0.97 && !needsResize) return file;
    return optimizedFile;
  } catch (error) {
    console.warn('Video upload image optimization skipped:', error);
    return file;
  } finally {
    if (decoded && typeof decoded.cleanup === 'function') decoded.cleanup();
  }
}

let _falStorageClientPromise = null;

async function getFalStorageClient() {
  if (_falStorageClientPromise) return _falStorageClientPromise;
  _falStorageClientPromise = (async () => {
    let mod = null;
    try {
      mod = await import('https://esm.sh/@fal-ai/client@1.9.5?bundle');
    } catch (_) {
      mod = await import('https://esm.sh/@fal-ai/client@1.9.5');
    }
    const fal = mod && mod.fal ? mod.fal : null;
    if (!fal || typeof fal.config !== 'function' || !fal.storage || typeof fal.storage.upload !== 'function') {
      throw new Error('fal upload client not available');
    }
    fal.config({ proxyUrl: '/api/fal/proxy' });
    return fal.storage;
  })();
  return _falStorageClientPromise;
}

async function uploadFileToFal(file, folder, task) {
  if (!file) return null;
  const preparedFile = await optimizeImageForVideoUpload(file, folder);
  const storage = await getFalStorageClient();
  let url = null;
  try {
    markTaskActivity(task);
    url = await storage.upload(preparedFile, {
      lifecycle: {
        expiresIn: '1d',
      },
    });
  } catch (error) {
    if (preparedFile !== file) {
      console.warn('Optimized video image upload failed, retrying original file:', error);
      markTaskActivity(task);
      url = await storage.upload(file, {
        lifecycle: {
          expiresIn: '1d',
        },
      });
    } else {
      throw error;
    }
  }
  if (url) {
    markTaskActivity(task);
    registerTaskBlobUrl(task, url);
  }
  return url;
}

async function resolveUploadItemUrl(item, folder, task) {
  if (!item) return null;
  markTaskActivity(task);
  if (typeof item === 'string' && isDirectRemoteUrl(item)) {
    if (canPassThroughRemoteUrl(item)) return item.trim();
    const file = await fetchUrlAsFile(item.trim(), {});
    return uploadFileToFal(file, folder, task);
  }
  if (isRemoteAssetItem(item)) {
    if (canPassThroughRemoteUrl(item.url)) return item.url || null;
    const file = await ensureFileLikeAssetItem(item);
    return uploadFileToFal(file, folder, task);
  }
  return uploadFileToFal(item, folder, task);
}

async function resolveUploadItemUrls(items, folder, task, limit = Infinity) {
  const source = Array.isArray(items) ? items.filter(Boolean).slice(0, limit) : [];
  const urls = [];
  for (const item of source) {
    const url = await resolveUploadItemUrl(item, folder, task);
    if (url) urls.push(url);
  }
  return urls;
}

async function submitImageRequest(task) {
  const prompt = task.prompt;
  const modelId = task.model_id;

  const body = {
    model_id: modelId,
    prompt,
  };

  if (task.mode === 'text') {
    // Common settings
    const aspect = qs('aspectRatioBase') ? qs('aspectRatioBase').value : '';
    if (aspect) body.aspect_ratio = aspect;

    const numImages = qs('textNumImages') ? qs('textNumImages').value : '1';
    body.num_images = Number(numImages) || 1;

    const outputFormat = qs('textOutputFormat') ? qs('textOutputFormat').value : '';
    if (outputFormat) body.output_format = outputFormat;

    // Flux Pro specific settings
    if (modelId === 'flux-pro-v1.1-ultra') {
      const safetyTolerance = qs('textSafetyTolerance') ? qs('textSafetyTolerance').value : '';
      if (safetyTolerance) body.safety_tolerance = safetyTolerance;

      const enhancePrompt = qs('textEnhancePrompt') ? qs('textEnhancePrompt').value : '';
      if (enhancePrompt === 'true') body.enhance_prompt = true;

      const rawMode = qs('textRawMode') ? qs('textRawMode').value : '';
      if (rawMode === 'true') body.raw = true;

      const seed = qs('textSeed') ? String(qs('textSeed').value || '').trim() : '';
      if (seed) body.seed = Number(seed);
    }

    // GPT Image specific settings
    if (modelId === 'gpt-image-1.5') {
      const imageSize = qs('gptImageSize') ? qs('gptImageSize').value : '';
      if (imageSize) body.image_size = imageSize;

      const quality = qs('gptQuality') ? qs('gptQuality').value : '';
      if (quality) body.quality = quality;

      const background = qs('gptBackground') ? qs('gptBackground').value : '';
      if (background) body.background = background;
    }

    // Nano Banana Pro specific settings
    if (modelId === 'nano-banana-pro') {
      const resolution = qs('nanoResolution') ? qs('nanoResolution').value : '';
      if (resolution) body.resolution = resolution;

      const webSearch = qs('nanoWebSearch') ? qs('nanoWebSearch').value : '';
      if (webSearch === 'true') body.enable_web_search = true;
    }

    // Nano Banana 2 specific settings
    if (modelId === 'nano-banana-2') {
      const resolution = qs('nano2Resolution') ? qs('nano2Resolution').value : '';
      if (resolution) body.resolution = resolution;

      const safetyTolerance = qs('nano2SafetyTolerance') ? qs('nano2SafetyTolerance').value : '';
      if (safetyTolerance) body.safety_tolerance = safetyTolerance;

      const seed = qs('nano2Seed') ? String(qs('nano2Seed').value || '').trim() : '';
      if (seed) body.seed = Number(seed);

      const webSearch = qs('nano2WebSearch') ? qs('nano2WebSearch').value : '';
      if (webSearch === 'true') body.enable_web_search = true;

      const googleSearch = qs('nano2GoogleSearch') ? qs('nano2GoogleSearch').value : '';
      if (googleSearch === 'true') body.enable_google_search = true;
    }
  } else {
    // Image editing mode
    const imageUrls = await resolveUploadItemUrls(uploadedImageFiles, 'image-input', task);
    if (imageUrls.length === 0) throw new Error(window.I18N ? I18N.t('toast_upload_image') : 'Upload at least one image for Style mode');
    body.image_urls = imageUrls;

    const maskSource = getManagedUploadRemoteItems(MANAGED_UPLOADS.maskInput)[0] || uploadedMaskFile;
    if (maskSource) {
      const mu = await resolveUploadItemUrl(maskSource, 'mask', task);
      if (mu) body.mask_image_url = mu;
    }

    // GPT Image 1.5 Edit settings
    if (modelId === 'gpt-image-1.5/edit') {
      const imageSize = qs('editImageSize') ? qs('editImageSize').value : '';
      if (imageSize) body.image_size = imageSize;

      const quality = qs('editQuality') ? qs('editQuality').value : '';
      if (quality) body.quality = quality;

      const background = qs('editBackground') ? qs('editBackground').value : '';
      if (background) body.background = background;

      const inputFidelity = qs('editInputFidelity') ? qs('editInputFidelity').value : '';
      if (inputFidelity) body.input_fidelity = inputFidelity;
    }

    // Nano Banana Pro Edit settings
    if (modelId === 'nano-banana-pro/edit') {
      const resolution = qs('editNanoResolution') ? qs('editNanoResolution').value : '';
      if (resolution) body.resolution = resolution;

      const webSearch = qs('editNanoWebSearch') ? qs('editNanoWebSearch').value : '';
      if (webSearch === 'true') body.enable_web_search = true;

      const aspectRatio = qs('editNanoAspectRatio') ? qs('editNanoAspectRatio').value : '';
      if (aspectRatio) body.aspect_ratio = aspectRatio;
    }

    // Nano Banana 2 Edit settings
    if (modelId === 'nano-banana-2/edit') {
      const resolution = qs('editNano2Resolution') ? qs('editNano2Resolution').value : '';
      if (resolution) body.resolution = resolution;

      const safetyTolerance = qs('editNano2SafetyTolerance') ? qs('editNano2SafetyTolerance').value : '';
      if (safetyTolerance) body.safety_tolerance = safetyTolerance;

      const seed = qs('editNano2Seed') ? String(qs('editNano2Seed').value || '').trim() : '';
      if (seed) body.seed = Number(seed);

      const webSearch = qs('editNano2WebSearch') ? qs('editNano2WebSearch').value : '';
      if (webSearch === 'true') body.enable_web_search = true;

      const googleSearch = qs('editNano2GoogleSearch') ? qs('editNano2GoogleSearch').value : '';
      if (googleSearch === 'true') body.enable_google_search = true;

      const aspectRatio = qs('editNano2AspectRatio') ? qs('editNano2AspectRatio').value : '';
      if (aspectRatio) body.aspect_ratio = aspectRatio;
    }

    const outputFormat = qs('editOutputFormat') ? qs('editOutputFormat').value : '';
    if (outputFormat) body.output_format = outputFormat;
  }

  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await createResponseError(res, 'Image generation failed');
  return await res.json();
}

async function submit3dRequest(task) {
  const modelId = getSelected3dModelId() || 'fal-ai/hunyuan3d-v3/image-to-3d';

  const body = {
    model_id: modelId,
  };

  const front3dSource = getManagedUploadRemoteItems(MANAGED_UPLOADS.threeDFrontInput)[0] || uploaded3dFrontFile;
  const back3dSource = getManagedUploadRemoteItems(MANAGED_UPLOADS.threeDBackInput)[0] || uploaded3dBackFile;
  const left3dSource = getManagedUploadRemoteItems(MANAGED_UPLOADS.threeDLeftInput)[0] || uploaded3dLeftFile;
  const right3dSource = getManagedUploadRemoteItems(MANAGED_UPLOADS.threeDRightInput)[0] || uploaded3dRightFile;
  const meshyTextureSource = getManagedUploadRemoteItems(MANAGED_UPLOADS.threeDMeshyTextureImageInput)[0] || uploaded3dMeshyTextureImageFile;
  const retextureStyleSource = getManagedUploadRemoteItems(MANAGED_UPLOADS.threeDRetextureStyleImageInput)[0] || uploaded3dRetextureStyleImageFile;

  if (modelId === 'fal-ai/hunyuan3d-v3/image-to-3d') {
    if (!front3dSource) throw new Error('Front image is required for 3D generation');
    body.input_image_url = await resolveUploadItemUrl(front3dSource, '3d-front', task);
    body.generate_type = qs('threeDGenerateType') ? qs('threeDGenerateType').value : 'Normal';
    body.enable_pbr = (qs('threeDEnablePbr') ? qs('threeDEnablePbr').value : 'false') === 'true';
    body.polygon_type = qs('threeDPolygonType') ? qs('threeDPolygonType').value : 'triangle';

    const faceCount = qs('threeDFaceCount') ? String(qs('threeDFaceCount').value || '').trim() : '';
    if (faceCount) body.face_count = Number(faceCount);

    if (back3dSource) body.back_image_url = await resolveUploadItemUrl(back3dSource, '3d-back', task);
    if (left3dSource) body.left_image_url = await resolveUploadItemUrl(left3dSource, '3d-left', task);
    if (right3dSource) body.right_image_url = await resolveUploadItemUrl(right3dSource, '3d-right', task);
  }

  if (modelId === 'fal-ai/hunyuan3d-v3/text-to-3d') {
    const prompt = String(task && task.prompt ? task.prompt : '').trim();
    if (!prompt) throw new Error('Prompt is required for Hunyuan3D Text to 3D');
    body.prompt = prompt;
    body.generate_type = qs('threeDGenerateType') ? qs('threeDGenerateType').value : 'Normal';
    body.enable_pbr = (qs('threeDEnablePbr') ? qs('threeDEnablePbr').value : 'false') === 'true';
    body.polygon_type = qs('threeDPolygonType') ? qs('threeDPolygonType').value : 'triangle';

    const faceCount = qs('threeDFaceCount') ? String(qs('threeDFaceCount').value || '').trim() : '';
    if (faceCount) body.face_count = Number(faceCount);
  }

  if (modelId === 'fal-ai/meshy/v6-preview/image-to-3d') {
    if (!front3dSource) throw new Error('Front image is required for 3D generation');
    body.image_url = await resolveUploadItemUrl(front3dSource, '3d-front', task);
    body.topology = qs('threeDMeshyTopology') ? qs('threeDMeshyTopology').value : 'triangle';
    body.symmetry_mode = qs('threeDMeshySymmetryMode') ? qs('threeDMeshySymmetryMode').value : 'auto';
    body.should_remesh = (qs('threeDMeshyShouldRemesh') ? qs('threeDMeshyShouldRemesh').value : 'true') === 'true';
    body.should_texture = (qs('threeDMeshyShouldTexture') ? qs('threeDMeshyShouldTexture').value : 'true') === 'true';
    body.enable_pbr = (qs('threeDMeshyEnablePbr') ? qs('threeDMeshyEnablePbr').value : 'false') === 'true';
    body.is_a_t_pose = (qs('threeDMeshyIsATPose') ? qs('threeDMeshyIsATPose').value : 'false') === 'true';
    body.enable_safety_checker = (qs('threeDMeshyEnableSafetyChecker') ? qs('threeDMeshyEnableSafetyChecker').value : 'true') === 'true';

    const poly = qs('threeDMeshyTargetPolycount') ? String(qs('threeDMeshyTargetPolycount').value || '').trim() : '';
    if (poly) body.target_polycount = Number(poly);

    const tp = qs('threeDMeshyTexturePrompt') ? String(qs('threeDMeshyTexturePrompt').value || '').trim() : '';
    if (tp) body.texture_prompt = tp;

    const tUrl = qs('threeDMeshyTextureImageUrl') ? String(qs('threeDMeshyTextureImageUrl').value || '').trim() : '';
    if (tUrl) body.texture_image_url = tUrl;
    if (meshyTextureSource) body.texture_image_url = await resolveUploadItemUrl(meshyTextureSource, '3d-texture', task);
  }

  if (modelId === 'fal-ai/meshy/v6-preview/text-to-3d') {
    const prompt = String(task && task.prompt ? task.prompt : '').trim();
    if (!prompt) throw new Error('Prompt is required for Meshy Text to 3D');
    body.prompt = prompt;
    body.mode = qs('threeDMeshyMode') ? qs('threeDMeshyMode').value : 'full';
    body.art_style = qs('threeDMeshyArtStyle') ? qs('threeDMeshyArtStyle').value : 'realistic';
    body.topology = qs('threeDMeshyTopology') ? qs('threeDMeshyTopology').value : 'triangle';
    body.symmetry_mode = qs('threeDMeshySymmetryMode') ? qs('threeDMeshySymmetryMode').value : 'auto';
    body.should_remesh = (qs('threeDMeshyShouldRemesh') ? qs('threeDMeshyShouldRemesh').value : 'true') === 'true';
    body.enable_pbr = (qs('threeDMeshyEnablePbr') ? qs('threeDMeshyEnablePbr').value : 'false') === 'true';
    body.is_a_t_pose = (qs('threeDMeshyIsATPose') ? qs('threeDMeshyIsATPose').value : 'false') === 'true';
    body.enable_prompt_expansion = (qs('threeDMeshyEnablePromptExpansion') ? qs('threeDMeshyEnablePromptExpansion').value : 'false') === 'true';
    body.enable_safety_checker = (qs('threeDMeshyEnableSafetyChecker') ? qs('threeDMeshyEnableSafetyChecker').value : 'true') === 'true';

    const poly = qs('threeDMeshyTargetPolycount') ? String(qs('threeDMeshyTargetPolycount').value || '').trim() : '';
    if (poly) body.target_polycount = Number(poly);

    const seed = qs('threeDMeshySeed') ? String(qs('threeDMeshySeed').value || '').trim() : '';
    if (seed) body.seed = Number(seed);

    const tp = qs('threeDMeshyTexturePrompt') ? String(qs('threeDMeshyTexturePrompt').value || '').trim() : '';
    if (tp) body.texture_prompt = tp;

    const tUrl = qs('threeDMeshyTextureImageUrl') ? String(qs('threeDMeshyTextureImageUrl').value || '').trim() : '';
    if (tUrl) body.texture_image_url = tUrl;
    if (meshyTextureSource) body.texture_image_url = await resolveUploadItemUrl(meshyTextureSource, '3d-texture', task);
  }

  if (modelId === 'fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d') {
    if (!front3dSource) throw new Error('Front image is required for Rapid Image to 3D');
    body.input_image_url = await resolveUploadItemUrl(front3dSource, '3d-rapid-front', task);
    body.enable_pbr = (qs('threeDRapidEnablePbr') ? qs('threeDRapidEnablePbr').value : 'false') === 'true';
    body.enable_geometry = (qs('threeDRapidEnableGeometry') ? qs('threeDRapidEnableGeometry').value : 'false') === 'true';
  }

  if (modelId === 'fal-ai/hunyuan-3d/v3.1/smart-topology') {
    if (!uploaded3dTopologyFile) throw new Error('3D file (GLB/OBJ) is required for Smart Topology');
    body.input_file_url = await uploadFileToFal(uploaded3dTopologyFile, '3d-topology', task);
    // Auto-detect file type from extension, fallback to dropdown
    const topoFileName = (uploaded3dTopologyFile.name || '').toLowerCase();
    const autoType = topoFileName.endsWith('.obj') ? 'obj' : (topoFileName.endsWith('.glb') ? 'glb' : null);
    body.input_file_type = autoType || (qs('threeDTopologyFileType') ? qs('threeDTopologyFileType').value : 'glb');
    body.polygon_type = qs('threeDTopologyPolygonType') ? qs('threeDTopologyPolygonType').value : 'triangle';
    body.face_level = qs('threeDTopologyFaceLevel') ? qs('threeDTopologyFaceLevel').value : 'medium';
  }

  if (modelId === 'fal-ai/meshy/v5/retexture') {
    if (!uploaded3dRetextureModelFile) throw new Error('3D model file is required for Retexture');
    body.model_url = await uploadFileToFal(uploaded3dRetextureModelFile, '3d-retexture-model', task);

    const stylePrompt = qs('threeDRetextureStylePrompt') ? String(qs('threeDRetextureStylePrompt').value || '').trim() : '';
    if (stylePrompt) body.text_style_prompt = stylePrompt;

    if (retextureStyleSource) {
      body.image_style_url = await resolveUploadItemUrl(retextureStyleSource, '3d-retexture-style', task);
    }

    if (!stylePrompt && !body.image_style_url) {
      throw new Error('Either a style prompt or style image is required for Retexture');
    }

    body.enable_original_uv = (qs('threeDRetextureOriginalUv') ? qs('threeDRetextureOriginalUv').value : 'true') === 'true';
    body.enable_pbr = (qs('threeDRetextureEnablePbr') ? qs('threeDRetextureEnablePbr').value : 'false') === 'true';
    body.enable_safety_checker = (qs('threeDRetextureEnableSafety') ? qs('threeDRetextureEnableSafety').value : 'true') === 'true';
  }

  const res = await fetch('/api/3d-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await createResponseError(res, '3D generation failed');
  return await res.json();
}

async function submitVideoRequest(task) {
  ensureVideoControls();
  const modelId = qs('videoModel') ? qs('videoModel').value : '';
  const modelMeta = modelId ? (VIDEO_MODEL_MAP.get(modelId) || null) : null;
  if (modelMeta && isKling3VideoKind(modelMeta.kind)) {
    syncKling3StateFromVideoModelId(modelId, { skipSave: true });
    return submitKling3Request({ ...task, model_id: modelId });
  }
  const prompt = task.prompt;

  const body = { model_id: modelId, prompt };

  const { options, top } = collectVideoOptionsFromUI();
  // Pass duration variants to backend options so it can map them correctly
  if (top.duration != null) body.duration = top.duration;
  if (top.aspect_ratio != null) body.aspect_ratio = top.aspect_ratio;
  if (top.keep_audio != null) body.keep_audio = top.keep_audio;

  // Merge options and duration variants
  const mergedOptions = { ...(options || {}) };
  if (top.duration_sora != null) mergedOptions.duration_sora = top.duration_sora;
  if (top.duration_hailuo != null) mergedOptions.duration_hailuo = top.duration_hailuo;
  if (Object.keys(mergedOptions).length > 0) body.options = mergedOptions;

  if (modelMeta && modelMeta.kind === 'video-id-to-video') {
    const vid = qs('videoIdInput') ? String(qs('videoIdInput').value || '').trim() : '';
    if (vid) body.video_id = vid;
  }

  const videoUrl = qs('videoUrlInput') ? String(qs('videoUrlInput').value || '').trim() : '';
  if (videoUrl) body.video_url = videoUrl;

  const videoSource = getManagedUploadPrimarySource(MANAGED_UPLOADS.videoInput, uploadedVideoFile);
  const videoImageSource = getManagedUploadPrimarySource(MANAGED_UPLOADS.videoImageInput, uploadedVideoImageFile);

  const endImageSource = getManagedUploadPrimarySource(MANAGED_UPLOADS.videoEndImageInput, uploadedEndImageFile);

  const referenceSources = [
    ...getManagedUploadRemoteItems(MANAGED_UPLOADS.referenceImagesInput),
    ...(Array.isArray(uploadedReferenceImages) ? uploadedReferenceImages : []),
  ];

  const audioSource = getManagedUploadPrimarySource(MANAGED_UPLOADS.audioInput, uploadedAudioFile);

  if (videoSource) {
    const vu = await resolveUploadItemUrl(videoSource, 'video', task);
    if (vu) body.video_url = vu;
  }

  if (videoImageSource) {
    const iu = await resolveUploadItemUrl(videoImageSource, 'video-image', task);
    if (iu) body.image_url = iu;
  }
  if (
    modelMeta
    && modelMeta.requiresImage !== false
    && ['image-to-video', 'audio-to-video', 'reference-to-video', 'motion-control'].includes(modelMeta.kind)
    && !body.image_url
  ) {
    throw new Error('Failed to attach the start image for this video model. Please reselect the image and try again.');
  }

  if (endImageSource) {
    const eu = await resolveUploadItemUrl(endImageSource, 'video-end-image', task);
    if (eu) body.end_image_url = eu;
  }

  if (referenceSources.length > 0) {
    const imageUrls = await resolveUploadItemUrls(referenceSources, 'video-reference', task);
    if (imageUrls.length > 0) body.image_urls = imageUrls;
  }

  if (audioSource) {
    const au = await resolveUploadItemUrl(audioSource, 'audio', task);
    if (au) body.audio_url = au;
  }

  const res = await fetch('/api/video-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await createResponseError(res, 'Video generation failed');
  return await res.json();
}

async function pollTask(taskId) {
  const t = tasks.find((x) => x && x.id === taskId);
  if (!t || t.status !== 'RUNNING' || !t.status_url) return;

  try {
    const data = await fetchFalViaStatusProxy(t.status_url);
    t.retryCount = 0;
    t.error = null;

    if (data.status === 'COMPLETED') {
      if (!t.response_url) throw new Error('Missing response_url');

      const out = await fetchFalViaStatusProxy(t.response_url);

      if (t.mode === '3d') {
        const o = extract3dOutput(out);
        if (!o || !o.modelDownloadUrl) throw new Error('No 3D model URL in response');
        t.status = 'COMPLETED';
        t.completedAt = Date.now();
        t.mediaUrl = o.glbUrl || o.modelDownloadUrl;
        t.thumbUrl = o.thumbnailUrl || null;
        t.model_urls = o.modelUrls || null;
        t.modelFormat = o.modelFormat || 'glb';

        if (!t.savedToHistory) {
          const placeholder3d = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#000"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-family="Arial" font-size="14">3D</text></svg>')}`;
          const item = buildTaskHistoryItem(t, '3d', t.thumbUrl || placeholder3d, {
            suffix: '3d',
            timestamp: t.completedAt,
            meta: {
              glbUrl: o.glbUrl || null,
              modelDownloadUrl: o.modelDownloadUrl,
              modelFormat: o.modelFormat || 'glb',
              model_urls: t.model_urls || null,
            },
          });
          item.glbUrl = o.glbUrl || null;
          item.modelDownloadUrl = o.modelDownloadUrl;
          item.modelFormat = o.modelFormat || 'glb';
          item.model_urls = t.model_urls || null;
          t.savedToHistory = true;
          addToHistory(item);
          displayResult(item);
          // Generate small thumbnail for the 3D item
          if (item.url && !item.url.startsWith('data:') && !isPrimaryCoarsePointer()) {
            generateImageThumbnail(item.url).then((thumb) => {
              if (thumb) {
                item.thumbnailUrl = thumb;
                _pendingHistorySave = true;
                debouncedSaveHistory();
              }
            });
          }
        }
      } else {
        const isVideoMode = t.mode === 'video' || t.mode === 'kling3';
        const urls = extractAllMediaUrls(out, isVideoMode ? 'video' : 'image');
        if (!urls || urls.length === 0) throw new Error('No media URL in response');
        t.status = 'COMPLETED';
        t.completedAt = Date.now();
        t.mediaUrl = urls[0];
        t.allMediaUrls = urls;

        if (!t.savedToHistory) {
          t.savedToHistory = true;
          // Build gallery items for all outputs — batch insert (single save + single UI update)
          const items = [];
          for (let i = 0; i < urls.length; i++) {
            const item = buildTaskHistoryItem(t, isVideoMode ? 'video' : 'image', urls[i], {
              suffix: (isVideoMode ? 'video' : 'image') + '_' + i,
              timestamp: t.completedAt + i,
              outputIndex: i,
            });
            addToHistorySilent(item);
            items.push(item);
            if (isVideoMode) queueHistoryThumbnailForItem(item, i);
          }
          // Single save + single UI update for the whole batch
          saveHistory();
          scheduleHistoryUIUpdate();
          queueAccountHistoryPersist(items);
          // Set gallery items for navigation
          setGalleryItems(items);
        }
      }

      await cleanupTaskUploads(t);
      saveTasks();
      renderTasks();
      showToast(window.I18N ? I18N.t('toast_complete') : 'Masterpiece ready!', 'info');
      return;
    }

    if (data.status === 'FAILED') {
      t.status = 'FAILED';
      t.failedAt = Date.now();
      t.error = normalizeErrorMessageFromPayload(data, 'Generation failed');
      await cleanupTaskUploads(t);
      saveTasks();
      renderTasks();
      showToast(formatErrorForDisplay(t.error), 'error');
      return;
    }

    saveTasks();
    renderTasks();
    schedulePoll(taskId, 2000);
  } catch (e) {
    if (isTransientPollError(e)) {
      t.retryCount = (Number.isFinite(t.retryCount) ? t.retryCount : 0) + 1;
      if (t.retryCount > MAX_POLL_RETRIES) {
        t.status = 'FAILED';
        t.failedAt = Date.now();
        t.error = 'Connection lost after multiple retries. Please try again.';
        await cleanupTaskUploads(t);
        saveTasks();
        renderTasks();
        showToast(formatErrorForDisplay(t.error), 'error');
        return;
      }
      const delay = computeRetryDelayMs(t.retryCount);
      t.error = 'Temporary connection issue. Retrying…';
      saveTasks();
      renderTasks();
      schedulePoll(taskId, delay);
      return;
    }

    t.status = 'FAILED';
    t.failedAt = Date.now();
    t.error = getErrorMessage(e, 'Generation failed');
    await cleanupTaskUploads(t);
    saveTasks();
    renderTasks();
    showToast(formatErrorForDisplay(t.error), 'error');
  }
}

async function startTask(taskId) {
  const t = tasks.find((x) => x && x.id === taskId);
  if (!t) return;
  t.status = 'SUBMITTING';
  t.error = null;
  t.startedAt = Date.now();
  t.lastActivityAt = t.startedAt;
  saveTasks();
  renderTasks();

  try {
    let res;
    if (t.mode === 'tools') res = await submitToolsRequest(t);
    else if (t.mode === 'video') res = await submitVideoRequest(t);
    else if (t.mode === '3d') res = await submit3dRequest(t);
    else if (t.mode === 'kling3') res = await submitKling3Request(t);
    else res = await submitImageRequest(t);

    t.status = 'RUNNING';
    t.status_url = res.status_url;
    t.response_url = res.response_url || null;
    markTaskActivity(t);
    saveTasks();
    renderTasks();

    pollTask(t.id);
  } catch (e) {
    t.status = 'FAILED';
    t.failedAt = Date.now();
    t.error = getErrorMessage(e, 'Generation failed');
    await cleanupTaskUploads(t);
    saveTasks();
    renderTasks();
    showToast(formatErrorForDisplay(t.error), 'error');
  }
}

function captureGenerationContext() {
  const ctx = {
    mode: currentMode === 'kling3' ? 'video' : currentMode,
    videoTab: currentVideoTab,
    kling3Family: currentKling3Family,
    kling3Tab: currentKling3Tab,
    prompt: qs('promptInput') ? qs('promptInput').value : '',
    selects: {},
    inputs: {},
  };
  for (const id of PERSISTED_SELECTS) {
    const el = qs(id);
    if (el) ctx.selects[id] = el.value;
  }
  for (const id of PERSISTED_INPUTS) {
    const el = qs(id);
    if (el) ctx.inputs[id] = el.value;
  }
  const klingModelId = getSelectedKling3ModelId();
  if (klingModelId) ctx.selects.kling3Model = klingModelId;
  return ctx;
}

async function handleGenerate() {
  const activeCount = getActiveTaskCount();
  if (activeCount >= MAX_CONCURRENT_TASKS) {
    showToast((window.I18N ? I18N.t('toast_max_tasks') : 'Maximum {n} generations at once. Please wait.').replace('{n}', MAX_CONCURRENT_TASKS), 'error');
    return;
  }

  // Tools mode: assemble prompt from form fields instead of promptInput
  let prompt;
  if (currentMode === 'tools') {
    prompt = '/' + assembleWbCardPrompt(uploadedToolsImages.length);
  } else {
    const _rawPrompt = qs('promptInput') ? substituteImageRefs(qs('promptInput').value.trim()) : '';
    prompt = _rawPrompt ? `/${_rawPrompt}` : '';
  }
  const currentVideoModelMeta = currentMode === 'video' ? getSelectedVideoModel() : null;
  const currentVideoUsesKling3 = !!(currentVideoModelMeta && isKling3VideoKind(currentVideoModelMeta.kind));
  if (currentMode === 'video' && !currentVideoUsesKling3 && !prompt) {
    if (!(currentVideoModelMeta && currentVideoModelMeta.requiresPrompt === false)) {
      showToast(window.I18N ? I18N.t('toast_enter_prompt') : 'Please enter a prompt', 'error');
      return;
    }
  }
  if (currentMode === 'video' && currentVideoModelMeta && currentVideoModelMeta.kind === 'audio-to-video') {
    const manualAudioUrlInput = document.querySelector('#videoOptionsDynamic [data-opt-key="audio_url"]');
    const hasAudioUrl = !!(manualAudioUrlInput && String(manualAudioUrlInput.value || '').trim());
    const hasAudioSource = !!(getManagedUploadPrimarySource(MANAGED_UPLOADS.audioInput, uploadedAudioFile) || hasAudioUrl);
    const hasGuideImage = !!getManagedUploadPrimarySource(MANAGED_UPLOADS.videoImageInput, uploadedVideoImageFile);
    if (!hasAudioSource) {
      showToast(window.I18N ? I18N.t('select_audio') : 'Select audio', 'error');
      return;
    }
    if (!prompt && !hasGuideImage) {
      showToast(window.I18N ? I18N.t('toast_enter_prompt') : 'Please enter a prompt', 'error');
      return;
    }
  }
  if (currentMode === 'video' && currentVideoModelMeta && !currentVideoUsesKling3) {
    const kind = currentVideoModelMeta.kind;
    const needsStartImage =
      currentVideoModelMeta.requiresImage !== false
      && (kind === 'image-to-video' || kind === 'audio-to-video' || kind === 'reference-to-video' || kind === 'motion-control');
    if (needsStartImage && !getManagedUploadPrimarySource(MANAGED_UPLOADS.videoImageInput, uploadedVideoImageFile)) {
      showToast(window.I18N ? I18N.t('select_image') : 'Select image', 'error');
      return;
    }
  }
  // Kling 3 mode - check for prompt or multi-prompt
  if (currentMode === 'kling3' || currentVideoUsesKling3) {
    const selectedModelId = getSelectedKling3ModelId(currentVideoModelMeta ? currentVideoModelMeta.id : '');
    const isMotion = isKling3MotionModelId(selectedModelId) || currentKling3Tab === 'v3-motion-control';
    const useMultiPrompt = !isMotion && qs('kling3UseMultiPrompt') && qs('kling3UseMultiPrompt').checked;
    if (!isMotion && !useMultiPrompt && !prompt) {
      showToast(window.I18N ? I18N.t('toast_enter_prompt') : 'Please enter a prompt', 'error');
      return;
    }
    if (useMultiPrompt && kling3MultiPrompts.filter(p => p.prompt.trim()).length === 0) {
      showToast(window.I18N ? I18N.t('toast_add_shot') : 'Please add at least one shot prompt', 'error');
      return;
    }
    // Check for required media based on tab/model
    const tab = currentKling3Tab;
    const isI2V = tab === 'v3-image-to-video' || tab === 'o3-image-to-video';
    const isRef = tab === 'o3-reference-to-video';
    const isV2V = tab === 'o3-video-to-video';
    if ((isI2V || isRef || isMotion) && !(getManagedUploadRemoteItems(MANAGED_UPLOADS.kling3StartImageInput)[0] || uploadedKling3StartImage)) {
      showToast(window.I18N ? I18N.t('toast_upload_start') : 'Please upload a start image', 'error');
      return;
    }
    if ((isV2V || isMotion) && !(getManagedUploadRemoteItems(MANAGED_UPLOADS.kling3VideoInput)[0] || uploadedKling3Video) && !qs('kling3VideoUrlInput')?.value.trim()) {
      showToast(window.I18N ? I18N.t('toast_upload_video') : 'Please upload a video or enter a video URL', 'error');
      return;
    }
  }

  if (currentMode !== '3d' && currentMode !== 'video' && currentMode !== 'kling3' && currentMode !== 'tools' && !prompt) {
    showToast(window.I18N ? I18N.t('toast_enter_prompt') : 'Please enter a prompt', 'error');
    return;
  }

  if (currentMode === '3d') {
    const meta = getSelected3dModelMeta();
    if (meta && meta.kind === 'text-to-3d' && !prompt) {
      showToast(window.I18N ? I18N.t('toast_enter_prompt') : 'Please enter a prompt', 'error');
      return;
    }
    if (meta && meta.kind === 'image-to-3d' && !(getManagedUploadRemoteItems(MANAGED_UPLOADS.threeDFrontInput)[0] || uploaded3dFrontFile)) {
      showToast(window.I18N ? I18N.t('toast_upload_front') : 'Please upload a front image', 'error');
      return;
    }
    if (meta && meta.kind === 'topology' && !uploaded3dTopologyFile) {
      showToast(window.I18N ? I18N.t('toast_upload_3d_file') : 'Please upload a 3D file (GLB/OBJ)', 'error');
      return;
    }
    if (meta && meta.kind === 'retexture' && !uploaded3dRetextureModelFile) {
      showToast(window.I18N ? I18N.t('toast_upload_3d_model') : 'Please upload a 3D model file', 'error');
      return;
    }
    if (meta && meta.kind === 'retexture') {
      const sp = qs('threeDRetextureStylePrompt') ? qs('threeDRetextureStylePrompt').value.trim() : '';
      if (!sp && !(getManagedUploadRemoteItems(MANAGED_UPLOADS.threeDRetextureStyleImageInput)[0] || uploaded3dRetextureStyleImageFile)) {
        showToast(window.I18N ? I18N.t('toast_style_or_image') : 'Please provide a style prompt or style image', 'error');
        return;
      }
    }
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  let model_id;
  if (currentMode === 'tools') model_id = qs('toolsModel') ? qs('toolsModel').value : DEFAULT_TOOLS_MODEL;
  else if (currentMode === 'text') model_id = qs('imageModelText') ? qs('imageModelText').value : DEFAULT_IMAGE_TEXT_MODEL;
  else if (currentMode === 'image') model_id = qs('imageModelEdit') ? qs('imageModelEdit').value : DEFAULT_IMAGE_EDIT_MODEL;
  else if (currentMode === 'video') model_id = qs('videoModel') ? qs('videoModel').value : '';
  else if (currentMode === 'kling3') model_id = getSelectedKling3ModelId();
  else if (currentMode === '3d') model_id = qs('threeDModel') ? qs('threeDModel').value : DEFAULT_3D_MODEL;

  const task = {
    id,
    mode: currentMode,
    prompt,
    model_id,
    status: 'QUEUED',
    createdAt: Date.now(),
    startedAt: null,
    status_url: null,
    response_url: null,
    error: null,
    retryCount: 0,
    savedToHistory: false,
    genCtx: captureGenerationContext(),
  };

  tasks.unshift(task);
  saveTasks();
  renderTasks();
  startTask(id);
}

window.handleGenerate = handleGenerate;

function initModels() {
  const textSel = qs('imageModelText');
  if (textSel) {
    setSelectOptions(textSel, IMAGE_MODELS_TEXT);
    if (!textSel.value) textSel.value = DEFAULT_IMAGE_TEXT_MODEL;
  }

  const editSel = qs('imageModelEdit');
  if (editSel) {
    setSelectOptions(editSel, IMAGE_MODELS_EDIT);
    if (!editSel.value) editSel.value = DEFAULT_IMAGE_EDIT_MODEL;
  }

  const toolsSel = qs('toolsModel');
  if (toolsSel) {
    setSelectOptions(toolsSel, TOOLS_MODELS);
    if (!toolsSel.value) toolsSel.value = DEFAULT_TOOLS_MODEL;
  }

  const threeDSel = qs('threeDModel');
  if (threeDSel) {
    setSelectOptions(threeDSel, THREE_D_MODELS);
    if (!threeDSel.value) threeDSel.value = DEFAULT_3D_MODEL;
  }

  if (_toolsInitialized) wizUpdateToolsSettings();
  refreshModelNews();
}
function initInputs() {
  const imageInput = qs('imageInput');
  if (imageInput) {
    imageInput.addEventListener('change', (e) => {
      const newFiles = Array.from(e.target.files || []);
      const max = editMaxImages();
      const remaining = max - uploadedImageFiles.length;
      if (remaining <= 0) {
        showToast(window.I18N ? I18N.t('wiz_max_images').replace('{n}', max) : `Maximum ${max} images allowed`, 'error');
        e.target.value = '';
        return;
      }
      uploadedImageFiles = [...uploadedImageFiles, ...newFiles.slice(0, remaining)];
      if (uploadedImageFiles.length >= max) {
        showToast(window.I18N ? I18N.t('wiz_max_images').replace('{n}', max) : `Maximum ${max} images allowed`);
      }
      updateImagePreview();
      e.target.value = '';
    });
  }

  ['maskInput', 'threeDFrontInput', 'threeDBackInput', 'threeDLeftInput', 'threeDRightInput', 'threeDMeshyTextureImageInput', 'threeDTopologyFileInput', 'threeDRetextureModelInput', 'threeDRetextureStyleImageInput'].forEach((inputId) => {
    bindManagedUploadById(inputId);
  });
  const m = qs('threeDModel');
  if (m) m.addEventListener('change', update3dUiVisibility);

  const gt = qs('threeDGenerateType');
  if (gt) gt.addEventListener('change', update3dUiVisibility);
  const pbr = qs('threeDEnablePbr');
  if (pbr) pbr.addEventListener('change', update3dUiVisibility);

  // Text model selector - update options when model changes
  const textModelSel = qs('imageModelText');
  if (textModelSel) textModelSel.addEventListener('change', updateTextModelOptions);

  // Edit model selector - update options and re-clamp images when model changes
  const editModelSel = qs('imageModelEdit');
  if (editModelSel) editModelSel.addEventListener('change', () => {
    updateEditModelOptions();
    updateImagePreview(); // re-clamp if new limit is lower
  });

  // --- Download buttons (forceDownload) ---
  const dlBtn = qs('downloadBtn');
  if (dlBtn) dlBtn.addEventListener('click', () => {
    forceDownload(dlBtn.dataset.dlUrl, dlBtn.dataset.dlName);
  });
  const modalDlBtn = qs('mediaModalDownload');
  if (modalDlBtn) modalDlBtn.addEventListener('click', () => {
    forceDownload(modalDlBtn.dataset.dlUrl, modalDlBtn.dataset.dlName);
  });

  // --- Drag & Drop for all static upload zones ---
  setupDropZone(qs('imageDropzone'), qs('imageInput'));
  setupDropZone(qs('maskDropzone'), qs('maskInput'));
  setupDropZone(qs('threeDFrontDropzone'), qs('threeDFrontInput'));
  setupDropZone(qs('threeDBackDropzone'), qs('threeDBackInput'));
  setupDropZone(qs('threeDLeftDropzone'), qs('threeDLeftInput'));
  setupDropZone(qs('threeDRightDropzone'), qs('threeDRightInput'));
  setupDropZone(qs('threeDMeshyTextureImageDropzone'), qs('threeDMeshyTextureImageInput'));
  setupDropZone(qs('threeDTopologyFileDropzone'), qs('threeDTopologyFileInput'));
  setupDropZone(qs('threeDRetextureModelDropzone'), qs('threeDRetextureModelInput'));
  setupDropZone(qs('threeDRetextureStyleImageDropzone'), qs('threeDRetextureStyleImageInput'));
}

function initTasks() {
  let changed = false;

  // Handle interrupted submissions - mark QUEUED/SUBMITTING as FAILED on page reload
  for (const t of tasks) {
    if (!t) continue;
    if (t.status === 'QUEUED' || t.status === 'SUBMITTING') {
      t.status = 'FAILED';
      t.failedAt = Date.now();
      t.error = 'Interrupted - please try again';
      changed = true;
    }
  }

  // Finalize any previously uploaded transient task assets for tasks already in terminal states.
  for (const t of tasks) {
    if (!t) continue;
    if ((t.status === 'COMPLETED' || t.status === 'FAILED') && !t.blobCleanupDone) {
      cleanupTaskUploads(t)
        .then(() => {
          saveTasks();
          renderTasks();
        })
        .catch(() => {
          saveTasks();
        });
    }
  }

  for (const t of tasks) {
    if (!t) continue;

    if (t.status === 'COMPLETED' && !t.savedToHistory) {
      if (t.mode === '3d' && t.mediaUrl) {
        const placeholder3d = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#000"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-family="Arial" font-size="14">3D</text></svg>')}`;
        const fmt = t.modelFormat || 'glb';
        const item = buildTaskHistoryItem(t, '3d', t.thumbUrl || placeholder3d, {
          suffix: '3d',
          timestamp: t.completedAt || Date.now(),
          meta: {
            glbUrl: fmt === 'glb' ? t.mediaUrl : null,
            modelDownloadUrl: t.mediaUrl,
            modelFormat: fmt,
            model_urls: t.model_urls || null,
          },
        });
        item.glbUrl = fmt === 'glb' ? t.mediaUrl : null;
        item.modelDownloadUrl = t.mediaUrl;
        item.modelFormat = fmt;
        item.model_urls = t.model_urls || null;
        t.savedToHistory = true;
        addToHistory(item);
        changed = true;
      }
      if (t.mode !== '3d' && t.mediaUrl) {
        const item = buildTaskHistoryItem(t, t.mode === 'video' ? 'video' : 'image', t.mediaUrl, {
          suffix: t.mode === 'video' ? 'video' : 'image',
          timestamp: t.completedAt || Date.now(),
        });
        t.savedToHistory = true;
        addToHistory(item);
        changed = true;
      }
    }
  }

  const MAX_TASK_AGE_MS = 60 * 60 * 1000; // 1 hour max age for running tasks

  for (const t of tasks) {
    if (!t) continue;
    const age = Date.now() - (t.startedAt || t.createdAt || Date.now());

    // Kill tasks that are too old
    if (t.status === 'RUNNING' && age > MAX_TASK_AGE_MS) {
      t.status = 'FAILED';
      t.failedAt = Date.now();
      t.error = 'Task expired after being active too long. Please try again.';
      changed = true;
      continue;
    }

    if (t.status === 'FAILED' && t.status_url && isTransientPollError(t.error || '')) {
      if (age > MAX_TASK_AGE_MS) continue; // don't resurrect old tasks
      t.status = 'RUNNING';
      t.error = null;
      t.failedAt = null;
      // preserve retryCount so the 30-retry limit isn't reset across reloads
      changed = true;
    }

    if (t.status === 'RUNNING' && t.status_url) {
      pollTask(t.id);
    }
  }

  if (changed) saveTasks();
}

// Wire global mode buttons if user clicks without inline handler (defensive)
document.addEventListener('click', (e) => {
  const t = e.target;
  if (!t) return;
  const btn = t.closest && t.closest('button');
  if (!btn) return;
  if (btn.id === 'mode-text') switchMode('text');
  if (btn.id === 'mode-image') switchMode('image');
  if (btn.id === 'mode-video') switchMode('video');
  if (btn.id === 'mode-3d') switchMode('3d');
});

// Generate thumbnails for history items that don't have them (video + image)
async function generateMissingThumbnails(items = null) {
  if (shouldSkipClientHistoryThumbnailWork()) return;
  const source = Array.isArray(items) && items.length
    ? items
    : history.slice(0, Math.min(history.length, 24)).map((item, index) => ({ item, index }));
  queueVisibleHistoryThumbnails(source);
}

// Prevent model-viewer from opening new windows on touch/click
function initModelViewerTouchFix() {
  document.addEventListener('click', (e) => {
    const mv = e.target.closest && e.target.closest('model-viewer');
    if (mv) {
      // Prevent any default link behavior
      if (e.target.tagName === 'A' || e.target.closest('a')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }
  }, true);

  // Block context menu on model-viewer (long press on mobile)
  document.addEventListener('contextmenu', (e) => {
    const mv = e.target.closest && e.target.closest('model-viewer');
    if (mv) {
      e.preventDefault();
    }
  });

  // Prevent touch events from triggering navigation
  document.addEventListener('touchstart', (e) => {
    const mv = e.target.closest && e.target.closest('model-viewer');
    if (mv) {
      // Let model-viewer handle camera controls but prevent navigation
      e.target.style.touchAction = 'pan-x pan-y';
    }
  }, { passive: true });
}

// ---- IndexedDB image persistence ----
const WIZ_IDB_NAME = 'nano_wiz_images';
const WIZ_IDB_VER = 1;
function _wizIdbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(WIZ_IDB_NAME, WIZ_IDB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function wizIdbSaveImages() {
  try {
    const toB64 = (f) => new Promise((res) => {
      if (isRemoteAssetItem(f)) {
        res({ __remoteAsset: true, url: f.url, name: f.name, type: f.type, assetType: f.assetType || 'image' });
        return;
      }
      const r = new FileReader(); r.onload = () => res({ name: f.name, type: f.type, data: r.result }); r.readAsDataURL(f);
    });
    // Convert ALL files BEFORE opening the transaction to avoid TransactionInactiveError
    const prodArr = await Promise.all(uploadedToolsImages.map(toB64));
    const inspoArr = await Promise.all(uploadedInspoImages.map(toB64));
    const db = await _wizIdbOpen();
    const tx = db.transaction('files', 'readwrite');
    const store = tx.objectStore('files');
    store.put(prodArr, 'productImages');
    store.put(inspoArr, 'inspoImages');
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
    db.close();
  } catch (e) { console.warn('IDB save failed', e); }
}
async function wizIdbRestoreImages() {
  try {
    const db = await _wizIdbOpen();
    // Issue BOTH requests synchronously before any await to keep the transaction active
    const [prodArr, inspoArr] = await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly');
      const store = tx.objectStore('files');
      const prodReq = store.get('productImages');
      const inspoReq = store.get('inspoImages');
      let prod, inspo, prodDone = false, inspoDone = false;
      const check = () => { if (prodDone && inspoDone) resolve([prod, inspo]); };
      prodReq.onsuccess  = () => { prod  = prodReq.result  || null; prodDone  = true; check(); };
      prodReq.onerror    = () => { prod  = null;                     prodDone  = true; check(); };
      inspoReq.onsuccess = () => { inspo = inspoReq.result || null; inspoDone = true; check(); };
      inspoReq.onerror   = () => { inspo = null;                    inspoDone = true; check(); };
      tx.onerror = reject;
    });
    db.close();
    const b64ToFile = (item) => {
      if (item && item.__remoteAsset && item.url) {
        return createRemoteAssetItem(item);
      }
      if (!item || !item.data) return null;
      const arr = item.data.split(','); const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]); const u8 = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) u8[i] = bstr.charCodeAt(i);
      return new File([u8], item.name || 'image.jpg', { type: mime });
    };
    if (Array.isArray(prodArr)) {
      uploadedToolsImages = prodArr.map(b64ToFile).filter(Boolean);
      updateToolsImagePreview();
    }
    if (Array.isArray(inspoArr)) {
      uploadedInspoImages = inspoArr.map(b64ToFile).filter(Boolean);
      wizRenderInspoThumbs();
    }
  } catch (e) { console.warn('IDB restore failed', e); }
}

// ---- localStorage Persistence ----
const APP_STATE_KEY = 'nano_app_state';

const PERSISTED_SELECTS = [
  'imageModelText', 'imageModelEdit', 'editOutputFormat', 'editImageSize', 'editQuality',
  'editBackground', 'editInputFidelity', 'editNanoResolution', 'editNanoWebSearch', 'editNanoAspectRatio',
  'nano2Resolution', 'nano2SafetyTolerance', 'nano2WebSearch', 'nano2GoogleSearch',
  'editNano2Resolution', 'editNano2SafetyTolerance', 'editNano2WebSearch', 'editNano2GoogleSearch', 'editNano2AspectRatio',
  'threeDModel', 'threeDGenerateType', 'threeDEnablePbr', 'threeDPolygonType',
  'threeDMeshyMode', 'threeDMeshyArtStyle', 'threeDMeshyTopology', 'threeDMeshySymmetryMode',
  'threeDMeshyShouldRemesh', 'threeDMeshyShouldTexture', 'threeDMeshyEnablePbr',
  'threeDMeshyIsATPose', 'threeDMeshyEnablePromptExpansion', 'threeDMeshyEnableSafetyChecker',
  'threeDRapidEnablePbr', 'threeDRapidEnableGeometry',
  'threeDTopologyFileType', 'threeDTopologyPolygonType', 'threeDTopologyFaceLevel',
  'threeDRetextureOriginalUv', 'threeDRetextureEnablePbr', 'threeDRetextureEnableSafety',
  'videoModel',
  'kling3Duration', 'kling3AspectRatio', 'kling3ShotType', 'kling3CfgScale',
  'kling3GenerateAudio', 'kling3KeepAudio',
  'kling3MotionOrientation', 'kling3KeepOriginalSound',
  'aspectRatioBase',
  'toolsModel', 'toolsResolution', 'toolsAspectRatio', 'toolsWebSearch', 'toolsGoogleSearch',
];

const PERSISTED_INPUTS = [
  'promptInput',
  'threeDFaceCount', 'threeDMeshyTargetPolycount', 'threeDMeshySeed',
  'threeDMeshyTexturePrompt', 'threeDMeshyTextureImageUrl',
  'threeDRetextureStylePrompt',
  'kling3VoiceIds', 'kling3NegativePrompt', 'kling3VideoUrlInput',
  'nano2Seed', 'editNano2Seed',
  'toolsTitleInput', 'toolsFontInput', 'toolsWishesInput', 'toolsSeed',
];

const PERSISTED_CHECKBOXES = [
  'toolsInspoMatchBg',
];

function saveAppState() {
  try {
    const state = {
      mode: currentMode,
      videoTab: currentVideoTab,
      kling3Family: currentKling3Family,
      kling3Tab: currentKling3Tab,
      selects: {},
      inputs: {},
      checkboxes: {},
    };
    for (const id of PERSISTED_SELECTS) {
      const el = qs(id);
      if (el) state.selects[id] = el.value;
    }
    for (const id of PERSISTED_INPUTS) {
      const el = qs(id);
      if (el) state.inputs[id] = el.value;
    }
    for (const id of PERSISTED_CHECKBOXES) {
      const el = qs(id);
      if (el) state.checkboxes[id] = !!el.checked;
    }
    const klingModelId = getSelectedKling3ModelId();
    if (klingModelId) state.selects.kling3Model = klingModelId;
    // Wizard-specific state
    if (typeof _wizStep === 'number') state.wizStep = _wizStep;
    // Characteristics
    const charEls = document.querySelectorAll('.tools-char-item input[type="text"], .tools-char-item textarea.wiz-char-input');
    const charVals = [];
    charEls.forEach(inp => { if (inp.value.trim()) charVals.push(inp.value.trim()); });
    if (charVals.length) state.wizChars = charVals;
    // Selected inspiration presets
    if (_wizSelectedPresets && _wizSelectedPresets.size > 0) {
      state.wizSelectedPresets = Array.from(_wizSelectedPresets);
    }
    localStorage.setItem(APP_STATE_KEY, JSON.stringify(state));
    wizIdbSaveImages();
  } catch (e) { /* quota exceeded or private mode */ }
}

function restoreAppState() {
  try {
    const raw = localStorage.getItem(APP_STATE_KEY);
    if (!raw) return false;
    const state = JSON.parse(raw);
    if (!state || typeof state !== 'object') return false;

    // Restore select values
    if (state.selects) {
      for (const [id, val] of Object.entries(state.selects)) {
        const el = qs(id);
        if (el) {
          el.value = val;
          if (!el.value && el.options && el.options.length > 0) {
            el.value = el.options[0].value;
          }
        }
      }
    }

    // Restore input values
    if (state.inputs) {
      for (const [id, val] of Object.entries(state.inputs)) {
        const el = qs(id);
        if (el) el.value = val || '';
      }
    }

    // Restore checkbox values
    if (state.checkboxes) {
      for (const [id, val] of Object.entries(state.checkboxes)) {
        const el = qs(id);
        if (el) el.checked = !!val;
      }
    }

    // Restore mode and tabs
    if (state.videoTab) currentVideoTab = state.videoTab;
    if (state.kling3Family) currentKling3Family = state.kling3Family;
    if (state.kling3Tab) currentKling3Tab = state.kling3Tab;
    if (!state.videoTab && state.kling3Tab) {
      const mappedVideoTab = getVideoTabForKling3Tab(state.kling3Tab);
      if (mappedVideoTab) currentVideoTab = mappedVideoTab;
    }
    const restoredKlingModelId = state.selects
      ? String(state.selects.videoModel || state.selects.kling3Model || '')
      : '';
    const restoredKlingTab = getKling3TabForModelId(restoredKlingModelId);
    if (restoredKlingTab) {
      currentKling3Tab = restoredKlingTab;
      currentKling3Family = getKling3FamilyForTab(restoredKlingTab);
      kling3SelectedModelByTab[restoredKlingTab] = restoredKlingModelId;
      if (!state.videoTab) {
        const mappedVideoTab = getVideoTabForKling3Tab(restoredKlingTab);
        if (mappedVideoTab) currentVideoTab = mappedVideoTab;
      }
    } else if (state.selects && state.selects.kling3Model && currentKling3Tab) {
      kling3SelectedModelByTab[currentKling3Tab] = state.selects.kling3Model;
    }

    // Stash wizard state for initToolsControls to pick up
    window._wizRestoredState = {
      step: typeof state.wizStep === 'number' ? state.wizStep : null,
      chars: Array.isArray(state.wizChars) ? state.wizChars : null,
      selectedPresets: Array.isArray(state.wizSelectedPresets) ? state.wizSelectedPresets : null,
    };

    requestAnimationFrame(autoResizePromptInput);

    return state.mode === 'kling3' ? 'video' : (state.mode || false);
  } catch (e) {
    return false;
  }
}

function hookPersistence() {
  for (const id of PERSISTED_SELECTS) {
    const el = qs(id);
    if (el) el.addEventListener('change', saveAppState);
  }
  for (const id of PERSISTED_INPUTS) {
    const el = qs(id);
    if (el) el.addEventListener('input', saveAppState);
  }
  for (const id of PERSISTED_CHECKBOXES) {
    const el = qs(id);
    if (el) el.addEventListener('change', saveAppState);
  }
}

function refreshLocalizedDynamicUi() {
  refreshAllManagedUploads();
  localizeVideoOptionFields(qs('videoOptionsDynamic'));
  if (typeof renderKling3Elements === 'function') renderKling3Elements();

  const previewArea = qs('previewArea');
  if (previewArea) bindAssetDragSource(previewArea, currentPreview);
  const img = qs('resultImage');
  if (img) bindAssetDragSource(img, currentPreview && currentPreview.type === 'image' ? currentPreview : null, { badge: false });
  const vid = qs('resultVideo');
  if (vid) bindAssetDragSource(vid, currentPreview && currentPreview.type === 'video' ? currentPreview : null, { badge: false });

  const modalBody = qs('mediaModalBody');
  if (modalBody) {
    bindAssetDragSource(modalBody, currentPreview);
    const modalMedia = modalBody.querySelector('img, video');
    if (modalMedia) bindAssetDragSource(modalMedia, currentPreview, { badge: false });
  }
}

function hookNewsLocaleUpdates() {
  if (!window.I18N || !window.I18N.applyLocale || window._localeUiHooked) return;
  window._localeUiHooked = true;
  const originalApplyLocale = window.I18N.applyLocale.bind(window.I18N);
  window.I18N.applyLocale = function() {
    originalApplyLocale.call(this);
    refreshModelNews(true);
    renderTasks();
    if (typeof updateHistoryUI === 'function') updateHistoryUI();
    refreshLocalizedDynamicUi();
  };
}

function clearPreviewDisplay() {
  currentPreview = null;
  galleryItems = [];
  galleryIndex = 0;
  const img = qs('resultImage');
  const vid = qs('resultVideo');
  const model = qs('resultModel');
  const placeholder = qs('placeholder');
  const dl = qs('downloadBtn');
  const assetBtn = qs('useAsAssetBtn');
  if (img) { img.style.display = 'none'; img.removeAttribute('src'); }
  if (vid) { if (typeof vid.pause === 'function') vid.pause(); vid.style.display = 'none'; vid.removeAttribute('src'); vid.removeAttribute('poster'); }
  if (model) { model.style.display = 'none'; model.removeAttribute('src'); }
  if (placeholder) placeholder.style.display = 'flex';
  if (dl) dl.style.display = 'none';
  if (assetBtn) assetBtn.style.display = 'none';
}

function getTextPresetStoresSnapshot() {
  return {
    titleStore: _getStoreForKey(TITLE_PRESETS_KEY),
    charStore: _getStoreForKey(CHAR_PRESETS_KEY),
  };
}

function normalizePresetCreatedAt(value) {
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

function normalizeCustomPresetForState(preset) {
  if (!preset) return null;
  return {
    id: preset.id,
    name: preset.name || 'Custom Preset',
    dataUrl: preset.dataUrl || null,
    src: preset.src || preset.dataUrl || null,
    storagePath: preset.storagePath || null,
    createdAt: normalizePresetCreatedAt(preset.createdAt || preset.addedAt),
  };
}

function getDesignPresetStateSnapshot() {
  return {
    hiddenBuiltins: [..._wizHiddenBuiltins],
    nameOverrides: { ..._wizPresetNameOverrides },
    customPresets: _wizCustomPresets.map((preset) => normalizeCustomPresetForState(preset)).filter(Boolean),
  };
}

async function getLegacyCustomPresets() {
  const items = await _inspoIdbLoadAll('__guest__');
  return items.map((preset) => normalizeCustomPresetForState(preset)).filter(Boolean);
}

function getLegacyStoreForKey(key) {
  const store = readStoredJson(key, {});
  return store && typeof store === 'object' ? store : {};
}

async function getLegacyMigrationPayload() {
  const historyItems = readStoredJson('nano_history', []);
  const titleStore = getLegacyStoreForKey(TITLE_PRESETS_KEY);
  const charStore = getLegacyStoreForKey(CHAR_PRESETS_KEY);
  const hiddenBuiltinsRaw = readStoredJson(INSPO_HIDDEN_KEY, []);
  const hiddenBuiltins = Array.isArray(hiddenBuiltinsRaw) ? hiddenBuiltinsRaw : [];
  const nameOverrides = readStoredJson(INSPO_NAMES_KEY, {});
  const customPresets = await getLegacyCustomPresets();
  return {
    history: Array.isArray(historyItems) ? historyItems : [],
    titleStore,
    charStore,
    designPresetState: {
      hiddenBuiltins,
      nameOverrides: nameOverrides && typeof nameOverrides === 'object' ? nameOverrides : {},
      customPresets,
    },
  };
}

async function clearLegacyMigrationData(markerUserId) {
  ['nano_history', 'nano_tasks', TITLE_PRESETS_KEY, CHAR_PRESETS_KEY, INSPO_HIDDEN_KEY, INSPO_NAMES_KEY, INSPO_STATE_META_KEY].forEach((key) => localStorage.removeItem(key));
  try {
    await _inspoIdbReplaceAllForOwner('__guest__', []);
  } catch (error) {
    console.warn('Failed to clear guest design preset cache', error);
  }
  localStorage.setItem('nano_account_migration', JSON.stringify({
    consumed: true,
    userId: markerUserId || null,
    consumedAt: new Date().toISOString(),
  }));
}

function applyTextPresetStores(titleStore, charStore) {
  withAccountSyncSuspended(() => {
    _saveStoreForKey(TITLE_PRESETS_KEY, titleStore || {});
    _saveStoreForKey(CHAR_PRESETS_KEY, charStore || {});
  });
}

async function applyDesignPresetState(state) {
  const nextState = state || {};
  const ownerKey = getInspoPresetOwnerKey();
  withAccountSyncSuspended(() => {
    _wizHiddenBuiltins = new Set(Array.isArray(nextState.hiddenBuiltins) ? nextState.hiddenBuiltins : []);
    _wizPresetNameOverrides = nextState.nameOverrides && typeof nextState.nameOverrides === 'object' ? { ...nextState.nameOverrides } : {};
    _wizCustomPresets = (Array.isArray(nextState.customPresets) ? nextState.customPresets : []).map((preset) => ({
      ...normalizeCustomPresetForState(preset),
      ownerKey,
    })).filter(Boolean);
    inspoSaveLocalMeta({ markDirty: false });
  });
  try {
    await _inspoIdbReplaceAllForOwner(ownerKey, _wizCustomPresets);
  } catch (error) {
    console.warn('Failed to cache scoped design presets', error);
  }
  wizRenderInspoPresets();
}

function mergePersistedHistoryItems(localItems, savedItems) {
  const list = Array.isArray(localItems) ? localItems : [localItems];
  const saved = Array.isArray(savedItems) ? savedItems : [savedItems];
  saved.forEach((savedItem, index) => {
    const target = list[index];
    if (!target || !savedItem) return;
    Object.assign(target, savedItem, { cloud: true });
    delete target.__accountPersistQueued;
    if (currentPreview === target) displayResult(target);
  });
  saveHistory();
  scheduleHistoryUIUpdate();
}

function replaceHistoryFromAccount(items, options = {}) {
  const persist = options.persist !== false;
  history = dedupeHistoryItems(Array.isArray(items) ? items.slice() : []);
  if (persist) saveHistory();
  else persistHistoryCacheMeta(history, undefined, { persistedCount: Math.min(Array.isArray(history) ? history.length : 0, LOCAL_HISTORY_CACHE_LIMIT) });
  scheduleHistoryUIUpdate();
  if (_fhgState.open) renderFhgGallery();
  generateMissingThumbnails();
}

function appendHistoryFromAccount(items, options = {}) {
  if (!Array.isArray(items) || !items.length) return;
  const persist = options.persist !== false;
  const previousKeys = new Set((Array.isArray(history) ? history : []).map((item, index) => getHistoryIdentityKey(item, index)));
  history = dedupeHistoryItems([...(Array.isArray(history) ? history : []), ...items]);
  const changed = items.some((incoming) => !previousKeys.has(getHistoryIdentityKey(incoming))) || history.length !== previousKeys.size;
  if (!changed) {
    if (!persist) persistHistoryCacheMeta(history, undefined, { persistedCount: Math.min(Array.isArray(history) ? history.length : 0, LOCAL_HISTORY_CACHE_LIMIT) });
    return;
  }
  if (persist) saveHistory();
  else persistHistoryCacheMeta(history, undefined, { persistedCount: Math.min(Array.isArray(history) ? history.length : 0, LOCAL_HISTORY_CACHE_LIMIT) });
  scheduleHistoryUIUpdate();
  if (_fhgState.open) renderFhgGallery();
  generateMissingThumbnails();
}

function replaceTasksFromScopedStorage() {
  tasks = loadStoredArray('nano_tasks');
  initTasks();
  renderTasks();
}

function setAccountStorageScope(userId, options = {}) {
  setActiveAccountStorageScope(userId);
  if (options.loadHistory) replaceHistoryFromAccount(loadStoredArray('nano_history'));
  if (options.loadTasks !== false) replaceTasksFromScopedStorage();
}

function readScopedStoreSnapshot(baseKey, scope) {
  const store = readStoredJson(getScopedStorageKey(baseKey, scope), {});
  return store && typeof store === 'object' ? store : {};
}

function countScopedCustomEntries(store) {
  return Object.values(store || {}).reduce((sum, entry) => sum + (Array.isArray(entry && entry.custom) ? entry.custom.length : 0), 0);
}

async function getScopedLocalAccountData(userId, options = {}) {
  const scope = userId ? String(userId) : null;
  const includeHistory = options.includeHistory !== false;
  const historyItems = includeHistory ? readStoredJson(getScopedStorageKey('nano_history', scope), []) : [];
  const historyMeta = getScopedHistoryCacheMeta(scope);
  const titleStore = readScopedStoreSnapshot(TITLE_PRESETS_KEY, scope);
  const charStore = readScopedStoreSnapshot(CHAR_PRESETS_KEY, scope);
  const hiddenBuiltinsRaw = readStoredJson(getScopedStorageKey(INSPO_HIDDEN_KEY, scope), []);
  const nameOverridesRaw = readStoredJson(getScopedStorageKey(INSPO_NAMES_KEY, scope), {});
  const designMeta = readInspoLocalStateMeta(scope);
  let customPresets = [];
  try {
    customPresets = await _inspoIdbLoadAll(getInspoPresetOwnerKey(scope));
  } catch (error) {
    console.warn('Failed to read scoped local account preset cache', error);
  }
  const designPresetState = {
    hiddenBuiltins: Array.isArray(hiddenBuiltinsRaw) ? hiddenBuiltinsRaw : [],
    nameOverrides: nameOverridesRaw && typeof nameOverridesRaw === 'object' ? nameOverridesRaw : {},
    customPresets: customPresets.map((preset) => normalizeCustomPresetForState(preset)).filter(Boolean),
    meta: designMeta,
  };
  const normalizedHistory = Array.isArray(historyItems) ? dedupeHistoryItems(historyItems) : [];
  return {
    history: normalizedHistory,
    historyMeta,
    titlePresetStore: titleStore,
    charPresetStore: charStore,
    designPresetState,
    summary: {
      historyCount: Number.isFinite(Number(historyMeta && historyMeta.count))
        ? Number(historyMeta.count)
        : normalizedHistory.length,
      presetCount: countScopedCustomEntries(titleStore) + countScopedCustomEntries(charStore),
      customDesignPresetCount: designPresetState.customPresets.length,
    },
  };
}

async function applyAccountData(data, options = {}) {
  const skipHistory = !!options.skipHistory;
  applyTextPresetStores(data && data.titlePresetStore ? data.titlePresetStore : {}, data && data.charPresetStore ? data.charPresetStore : {});
  await applyDesignPresetState(data && data.designPresetState ? data.designPresetState : {});
  if (!skipHistory) replaceHistoryFromAccount(data && Array.isArray(data.history) ? data.history : []);
  wizBuildTitleChips();
  wizBuildCharChips();
  if (typeof _pmRender === 'function') _pmRender();
  refreshLocalizedDynamicUi();
}

async function hydrateHistoryFromScopedCache(userId) {
  const cached = await getScopedLocalAccountData(userId, { includeHistory: true });
  replaceHistoryFromAccount(Array.isArray(cached.history) ? cached.history : [], { persist: false });
  return cached;
}

function persistHistoryCache() {
  saveHistory();
}

async function clearSignedInAccountData() {
  withAccountSyncSuspended(() => {
    _wizHiddenBuiltins = new Set();
    _wizPresetNameOverrides = {};
    _wizCustomPresets = [];
  });
  wizRenderInspoPresets();
  history = [];
  scheduleHistoryUIUpdate();
  if (_fhgState.open) renderFhgGallery();
  tasks = [];
  initTasks();
  renderTasks();
  clearPreviewDisplay();
}

function getAccountSummarySnapshot() {
  const { titleStore, charStore } = getTextPresetStoresSnapshot();
  const titleCustom = Object.values(titleStore || {}).reduce((sum, entry) => sum + (Array.isArray(entry && entry.custom) ? entry.custom.length : 0), 0);
  const charCustom = Object.values(charStore || {}).reduce((sum, entry) => sum + (Array.isArray(entry && entry.custom) ? entry.custom.length : 0), 0);
  return {
    historyCount: Array.isArray(history) ? history.length : 0,
    presetCount: titleCustom + charCustom,
    customDesignPresetCount: Array.isArray(_wizCustomPresets) ? _wizCustomPresets.length : 0,
  };
}

window.NanoApp = {
  setAccountStorageScope,
  applyAccountData,
  clearSignedInAccountData,
  getLegacyMigrationPayload,
  clearLegacyMigrationData,
  getTextPresetStoresSnapshot,
  getDesignPresetStateSnapshot,
  hasDesignPresetStateContent,
  getScopedLocalAccountData,
  getScopedHistoryCacheMeta,
  hydrateHistoryFromScopedCache,
  persistHistoryCache,
  markDesignPresetSyncClean: markInspoLocalStateClean,
  mergePersistedHistoryItems,
  getAccountSummarySnapshot,
  replaceHistoryFromAccount,
  appendHistoryFromAccount,
  replaceTasksFromScopedStorage,
  setHistoryHydrating,
  clearPreviewDisplay,
};
// Init
initModels();
initInputs();
initModelViewerTouchFix();
initHistoryControls();
// History UI is lazy — built on first drawer open (see toggleHistory)
renderTasks();
initTasks();
generateMissingThumbnails();
requestAnimationFrame(autoResizePromptInput);

// Restore saved state or default
const savedMode = restoreAppState();
hookPersistence();
taskTicker = setInterval(renderTasks, 1500);
if (savedMode) {
  switchMode(savedMode);
  // Restore sub-tabs after mode switch
  if (savedMode === 'video' && currentVideoTab) {
    switchVideoTab(currentVideoTab);
  }
  if (savedMode === '3d') {
    update3dUiVisibility();
  }
} else {
  switchMode('text');
}

// Apply i18n LAST — after all selects and models are populated
hookNewsLocaleUpdates();
if (window.I18N) window.I18N.init();
refreshModelNews(true);






























