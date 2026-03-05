// Icons
if (window.lucide && typeof window.lucide.createIcons === 'function') {
  window.lucide.createIcons();
}

// State
let currentMode = 'text';
let currentVideoTab = 'text-to-video';
let history = JSON.parse(localStorage.getItem('nano_history') || '[]');
let tasks = JSON.parse(localStorage.getItem('nano_tasks') || '[]');

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
let toolsCharsCount = 0;
let currentKling3Tab = 'v3-text-to-video';
let currentKling3Family = 'v3';
let kling3MultiPrompts = [];
let kling3Elements = []; // KlingV3ElementInput: { id, frontalImageFile, referenceImageFiles, videoFile }
let kling3SelectedModelByTab = {};
let kling3LastTabByFamily = { v3: 'v3-text-to-video', o3: 'o3-text-to-video' };

const IMAGE_MODELS_TEXT = [
  { id: 'nano-banana-2', label: 'Nano Banana 2' },
  { id: 'nano-banana-pro', label: 'Nano Banana Pro' },
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
  const id = sel ? sel.value : 'nano-banana-2/edit';
  return EDIT_MAX_IMAGES[id] || 4;
}

const IMAGE_MODELS_EDIT = [
  { id: 'nano-banana-2/edit', label: 'Nano Banana 2 (Edit)' },
  { id: 'nano-banana-pro/edit', label: 'Nano Banana Pro (Edit)' },
  { id: 'gpt-image-1.5/edit', label: 'GPT-Image 1.5 (Edit)' },
];

const THREE_D_MODELS = [
  { id: 'fal-ai/hunyuan3d-v3/image-to-3d', label: 'Hunyuan3D V3 (Image to 3D)', kind: 'image-to-3d', provider: 'fal' },
  { id: 'fal-ai/hunyuan3d-v3/text-to-3d', label: 'Hunyuan3D V3 (Text to 3D)', kind: 'text-to-3d', provider: 'fal' },
  { id: 'fal-ai/meshy/v6-preview/image-to-3d', label: 'Meshy V6 Preview (Image to 3D)', kind: 'image-to-3d', provider: 'fal' },
  { id: 'fal-ai/meshy/v6-preview/text-to-3d', label: 'Meshy V6 Preview (Text to 3D)', kind: 'text-to-3d', provider: 'fal' },
  { id: 'fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d', label: 'Hunyuan3D V3.1 Rapid (Image to 3D)', kind: 'image-to-3d', provider: 'fal' },
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
    { id: 'kling-o3-pro-v2v-edit', label: 'Kling O3 Pro (V2V Edit)' },
    { id: 'kling-o3-pro-v2v-ref', label: 'Kling O3 Pro (V2V Reference)' },
  ],
};

let VIDEO_MODELS = [];
let VIDEO_MODEL_MAP = new Map();
let videoModelsLoaded = false;

function qs(id) {
  return document.getElementById(id);
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

function setupDropZone(zoneEl, inputEl) {
  if (!zoneEl || !inputEl) return;
  zoneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zoneEl.classList.add('drag-over');
  });
  zoneEl.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zoneEl.classList.add('drag-over');
  });
  zoneEl.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!zoneEl.contains(e.relatedTarget)) {
      zoneEl.classList.remove('drag-over');
    }
  });
  zoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    zoneEl.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;
    const accept = inputEl.accept || '';
    const multi = inputEl.multiple;
    const dt = new DataTransfer();
    for (let i = 0; i < files.length; i++) {
      if (accept && !fileMatchesAccept(files[i], accept)) continue;
      dt.items.add(files[i]);
      if (!multi) break;
    }
    if (dt.files.length === 0) return;
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

// Prevent browser from opening files dropped outside upload zones
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => { e.preventDefault(); });

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
    { label: 'Kling3 → Start Image', i18nKey: 'asset_kling3_start', mode: 'kling3', inputId: 'kling3StartImageInput', kling3Tab: 'image-to-video' },
    { label: 'Kling3 → End Image', i18nKey: 'asset_kling3_end', mode: 'kling3', inputId: 'kling3EndImageInput', kling3Tab: 'image-to-video' },
  ],
  video: [
    { label: 'Video → Video Input', i18nKey: 'asset_video_input', mode: 'video', inputId: 'videoInput', videoTab: 'video-to-video' },
    { label: 'Kling3 → Video Input', i18nKey: 'asset_kling3_video', mode: 'kling3', inputId: 'kling3VideoInput', kling3Tab: 'video-to-video' },
  ],
  '3d': [
    { label: '3D Topology → 3D File', i18nKey: 'asset_3d_topology', mode: '3d', inputId: 'threeDTopologyFileInput', select3dModel: 'fal-ai/hunyuan-3d/v3.1/smart-topology' },
    { label: '3D Retexture → 3D Model', i18nKey: 'asset_3d_retexture_model', mode: '3d', inputId: 'threeDRetextureModelInput', select3dModel: 'fal-ai/meshy/v5/retexture' },
  ],
};

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

  if (target.videoTab) {
    ensureVideoControls();
    switchVideoTab(target.videoTab);
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
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const blob = await resp.blob();

    // Derive filename from URL
    const urlPath = new URL(url).pathname;
    const filename = urlPath.split('/').pop() || ('asset.' + (item.type === 'video' ? 'mp4' : item.type === '3d' ? 'glb' : 'png'));

    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    const inputEl = qs(target.inputId);
    if (!inputEl) { showToast(window.I18N ? I18N.t('toast_input_not_found') : 'Input not found – section may not be loaded', 'error'); return; }

    const dt = new DataTransfer();
    dt.items.add(file);
    inputEl.files = dt.files;
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));

    // Close media modal if open so user can see the target section
    const modal = qs('mediaModal');
    if (modal && modal.style.display && modal.style.display !== 'none') {
      closeMediaModal();
    }

    // Scroll the target into view
    const scrollTarget = inputEl.closest('.upload-zone, .upload-item, .setting-group, .form-group');
    if (scrollTarget) {
      setTimeout(() => scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
    }

    showToast(window.I18N ? I18N.t('toast_asset_applied') : 'Asset applied!');
  } catch (e) {
    console.error('Apply asset failed:', e);
    showToast((window.I18N ? I18N.t('toast_failed_asset') : 'Failed to set asset: ') + (e.message || e), 'error');
  }
}

function reuseFromHistory(index) {
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
  if (ctx.mode) switchMode(ctx.mode);

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
  if (ctx.mode === '3d') {
    update3dUiVisibility();
  }
  if (ctx.mode === 'video') {
    ensureVideoControls();
    if (ctx.videoTab) switchVideoTab(ctx.videoTab);
  }
  if (ctx.mode === 'kling3') {
    if (ctx.kling3Family) switchKling3Family(ctx.kling3Family);
    if (ctx.kling3Tab) switchKling3Tab(ctx.kling3Tab);
    updateKling3UiVisibility();
  }

  // 6. Save restored state
  if (typeof saveAppState === 'function') saveAppState();

  // 7. Scroll to the prompt input
  setTimeout(() => {
    const promptArea = qs('promptInput');
    if (promptArea) promptArea.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

// Toggle history drawer
let _historyRendered = false;
function toggleHistory() {
  const drawer = qs('historyDrawer');
  const overlay = qs('drawerOverlay');
  if (!drawer) return;
  
  const isOpen = drawer.classList.contains('open');
  const opening = !isOpen;
  drawer.classList.toggle('open', opening);
  if (overlay) overlay.classList.toggle('open', opening);

  // Lazy render: build history DOM only when first opened, deferred so animation isn't blocked
  if (opening && !_historyRendered) {
    _historyRendered = true;
    requestAnimationFrame(() => updateHistoryUI());
  }
}
window.toggleHistory = toggleHistory;

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
    img.src = URL.createObjectURL(file);
    img.alt = file.name;
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

function saveHistory() {
  const key = 'nano_history';
  try {
    localStorage.setItem(key, JSON.stringify(history));
  } catch (e) {
    // localStorage quota exceeded – trim oldest items until it fits
    while (history.length > 1) {
      history.pop();
      try {
        localStorage.setItem(key, JSON.stringify(history));
        return;
      } catch (_) { /* keep trimming */ }
    }
  }
}

function saveTasks() {
  localStorage.setItem('nano_tasks', JSON.stringify(tasks));
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

async function fetchFalViaStatusProxy(url) {
  const res = await fetch(`/api/status?statusUrl=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 422) {
      const err = new Error('Request expired or invalid. Please re-generate.');
      err.__httpStatus = 422;
      throw err;
    }
    const err = new Error(text);
    err.__transient = res.status === 429 || res.status >= 500;
    err.__httpStatus = res.status;
    throw err;
  }
  return await res.json();
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
  const res = await fetch('/api/video-generate');
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  const models = Array.isArray(json && json.models) ? json.models : [];
  VIDEO_MODELS = models.map((m) => ({ id: m.id, label: m.label || m.id, kind: m.kind || '' }));
  VIDEO_MODEL_MAP = new Map(models.map((m) => [m.id, m]));
  VIDEO_OPTION_DEFS = (json && json.optionDefs) ? json.optionDefs : {};
  videoModelsLoaded = true;
}

function getSelectedVideoModel() {
  const id = qs('videoModel') ? qs('videoModel').value : '';
  return id ? (VIDEO_MODEL_MAP.get(id) || null) : null;
}

function getVideoModelsForTab(tab) {
  const t = String(tab || '').trim();
  if (!t) return VIDEO_MODELS;

  return VIDEO_MODELS.filter((m) => {
    const k = m && m.kind ? m.kind : '';
    if (k === t) return true;
    if (t === 'video-to-video' && (k === 'motion-control' || k === 'video-id-to-video')) return true;
    return false;
  });
}

function refreshVideoModelDropdown() {
  const sel = qs('videoModel');
  if (!sel) return;
  const prev = sel.value;
  const items = getVideoModelsForTab(currentVideoTab);
  setSelectOptions(sel, items);
  if (!sel.value && items[0]) sel.value = items[0].id;
  if (prev && Array.isArray(items) && items.some((m) => m.id === prev)) {
    sel.value = prev;
  }
}

function coerceBoolFromUi(v) {
  if (typeof v === 'boolean') return v;
  const s = String(v || '').trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  return null;
}

function buildVideoOptionInput(key, modelMeta) {
  const def = VIDEO_OPTION_DEFS[key] || null;
  
  const wrap = document.createElement('div');
  wrap.className = 'field';

  const label = document.createElement('label');
  label.textContent = def && def.label ? def.label : key.replace(/_/g, ' ');
  wrap.appendChild(label);

  // Use optionDefs type if available
  const optType = def ? def.type : null;

  if (optType === 'select' && Array.isArray(def.values)) {
    const sel = document.createElement('select');
    sel.dataset.optKey = key;
    for (const v of def.values) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      if (def.default !== undefined && String(def.default) === String(v)) {
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
    [{ v: 'false', l: 'Off' }, { v: 'true', l: 'On' }].forEach(({ v, l }) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = l;
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
    if (def.default !== undefined) input.placeholder = String(def.default);
    wrap.appendChild(input);
    return wrap;
  }

  // Text input fallback
  const input = document.createElement('input');
  input.dataset.optKey = key;
  input.type = 'text';
  input.placeholder = def && def.label ? def.label : key;
  wrap.appendChild(input);
  return wrap;
}

function renderVideoOptionsUI() {
  const host = qs('videoOptionsDynamic');
  if (!host) return;

  host.innerHTML = '';

  const modelMeta = getSelectedVideoModel();
  if (!modelMeta) return;

  const allowed = Array.isArray(modelMeta.allowedOptions) ? modelMeta.allowedOptions : [];
  if (allowed.length === 0) return;

  const grid = document.createElement('div');
  grid.className = 'settings-grid';
  grid.style.marginTop = '0.5rem';

  for (const key of allowed) {
    grid.appendChild(buildVideoOptionInput(key, modelMeta));
  }

  host.appendChild(grid);
}

function collectVideoOptionsFromUI() {
  const modelMeta = getSelectedVideoModel();
  if (!modelMeta) return { options: {}, top: {} };

  const allowed = new Set(Array.isArray(modelMeta.allowedOptions) ? modelMeta.allowedOptions : []);
  const els = Array.from(document.querySelectorAll('[data-opt-key]'));

  const options = {};
  const top = {};

  for (const el of els) {
    const key = el.dataset.optKey;
    if (!key || !allowed.has(key)) continue;
    let v = (el && 'value' in el) ? el.value : null;
    if (v === null || typeof v === 'undefined') continue;
    if (String(v).trim() === '') continue;

    if (key === 'voice_ids') {
      const arr = String(v).split(',').map((s) => s.trim()).filter(Boolean);
      if (arr.length > 0) options[key] = arr;
      continue;
    }

    const b = coerceBoolFromUi(v);
    if (b !== null && (
      key === 'enable_safety_checker' ||
      key === 'enable_output_safety_checker' ||
      key === 'enable_prompt_expansion' ||
      key === 'pro_mode' ||
      key === 'generate_audio' ||
      key === 'generate_audio_switch' ||
      key === 'generate_multi_clip_switch' ||
      key === 'camera_fixed' ||
      key === 'keep_audio' ||
      key === 'keep_original_sound' ||
      key === 'auto_fix' ||
      key === 'use_turbo' ||
      key === 'return_frames_zip' ||
      key === 'delete_video' ||
      key === 'prompt_optimizer'
    )) {
      v = b;
    }

    if (
      key === 'duration' ||
      key === 'seed' ||
      key === 'num_frames' ||
      key === 'num_inference_steps' ||
      key === 'cfg_scale' ||
      key === 'guidance_scale' ||
      key === 'shift'
    ) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) v = n;
    }

    // Map duration variants to top-level duration
    if (key === 'duration' || key === 'duration_sora' || key === 'duration_hailuo') {
      top[key] = v;
    } else if (key === 'aspect_ratio' || key === 'keep_audio' || key === 'video_id') {
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
  if (qs('videoModel')) return;

  const wrap = document.createElement('div');
  wrap.id = 'videoControls';

  wrap.innerHTML = `
    <div class="settings-row" style="margin-top:0.75rem;">
      <div class="field" style="flex:2;">
        <label>Model</label>
        <select id="videoModel"></select>
      </div>
    </div>

    <div class="settings-row" style="margin-top:0.5rem;" id="videoUrlGroup">
      <div class="field">
        <label>Video URL</label>
        <input id="videoUrlInput" type="text" placeholder="https://...mp4" />
      </div>
    </div>

    <div class="settings-row" style="margin-top:0.5rem;">
      <div class="field" id="videoFileGroup">
        <label>Upload Video</label>
        <div class="upload-zone small" onclick="document.getElementById('videoInput').click()">
          <i data-lucide="film"></i>
          <span id="videoFileLabel">Select video</span>
          <input id="videoInput" type="file" accept="video/*" hidden />
        </div>
      </div>
      <div class="field" id="videoImageFileGroup">
        <label>Upload Image</label>
        <div class="upload-zone small" onclick="document.getElementById('videoImageInput').click()">
          <i data-lucide="image"></i>
          <span id="videoImageLabel">Select image</span>
          <input id="videoImageInput" type="file" accept="image/*" hidden />
        </div>
      </div>
    </div>

    <div class="field" id="referenceImagesGroup" style="margin-top:0.5rem;">
      <label>Reference Images (1-7)</label>
      <div class="upload-zone small" onclick="document.getElementById('referenceImagesInput').click()">
        <i data-lucide="images"></i>
        <span id="refImagesLabel">Select images</span>
        <input id="referenceImagesInput" type="file" accept="image/*" multiple hidden />
      </div>
    </div>

    <div class="settings-row" style="margin-top:0.5rem;" id="videoEndImageGroup">
      <div class="field">
        <label>End Frame (optional)</label>
        <div class="upload-zone small" onclick="document.getElementById('videoEndImageInput').click()">
          <i data-lucide="image"></i>
          <span id="endImageLabel">Select image</span>
          <input id="videoEndImageInput" type="file" accept="image/*" hidden />
        </div>
      </div>
    </div>

    <div class="settings-row" style="margin-top:0.5rem;" id="videoIdGroup">
      <div class="field">
        <label>Video ID</label>
        <input id="videoIdInput" type="text" placeholder="Enter video ID" />
      </div>
    </div>

    <div class="settings-row" style="margin-top:0.5rem;" id="audioFileGroup">
      <div class="field">
        <label>Audio File</label>
        <div class="upload-zone small" onclick="document.getElementById('audioInput').click()">
          <i data-lucide="music"></i>
          <span id="audioFileLabel">Select audio</span>
          <input id="audioInput" type="file" accept="audio/*" hidden />
        </div>
      </div>
    </div>

    <div id="videoOptionsDynamic"></div>
  `;

  host.appendChild(wrap);

  const modelSel = qs('videoModel');

  loadVideoModels()
    .then(() => {
      refreshVideoModelDropdown();
      // Restore saved video model from localStorage
      try {
        const saved = JSON.parse(localStorage.getItem('nano_app_state') || '{}');
        if (saved.selects && saved.selects.videoModel && modelSel) {
          modelSel.value = saved.selects.videoModel;
        }
      } catch (_) {}
      if (modelSel && !modelSel.value && VIDEO_MODELS[0]) modelSel.value = VIDEO_MODELS[0].id;
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

  qs('videoInput').addEventListener('change', (e) => {
    uploadedVideoFile = (e.target.files || [])[0] || null;
    const label = qs('videoFileLabel');
    if (label) label.textContent = uploadedVideoFile ? uploadedVideoFile.name : 'Select video';
    e.target.value = '';
  });
  qs('videoImageInput').addEventListener('change', (e) => {
    uploadedVideoImageFile = (e.target.files || [])[0] || null;
    const label = qs('videoImageLabel');
    if (label) label.textContent = uploadedVideoImageFile ? uploadedVideoImageFile.name : 'Select image';
    e.target.value = '';
  });
  qs('referenceImagesInput').addEventListener('change', (e) => {
    uploadedReferenceImages = Array.from(e.target.files || []);
    const label = qs('refImagesLabel');
    if (label) label.textContent = uploadedReferenceImages.length > 0 ? `${uploadedReferenceImages.length} images` : 'Select images';
    e.target.value = '';
  });

  const endImg = qs('videoEndImageInput');
  if (endImg) {
    endImg.addEventListener('change', (e) => {
      uploadedEndImageFile = (e.target.files || [])[0] || null;
      const label = qs('endImageLabel');
      if (label) label.textContent = uploadedEndImageFile ? uploadedEndImageFile.name : 'Select image';
      e.target.value = '';
    });
  }

  const audioInput = qs('audioInput');
  if (audioInput) {
    audioInput.addEventListener('change', (e) => {
      uploadedAudioFile = (e.target.files || [])[0] || null;
      const label = qs('audioFileLabel');
      if (label) label.textContent = uploadedAudioFile ? uploadedAudioFile.name : 'Select audio';
      e.target.value = '';
    });
  }

  // --- Drag & Drop for video upload zones ---
  const vInput = qs('videoInput');
  if (vInput) setupDropZone(vInput.closest('.upload-zone'), vInput);
  const viInput = qs('videoImageInput');
  if (viInput) setupDropZone(viInput.closest('.upload-zone'), viInput);
  const riInput = qs('referenceImagesInput');
  if (riInput) setupDropZone(riInput.closest('.upload-zone'), riInput);
  const veiInput = qs('videoEndImageInput');
  if (veiInput) setupDropZone(veiInput.closest('.upload-zone'), veiInput);
  const aiInput = qs('audioInput');
  if (aiInput) setupDropZone(aiInput.closest('.upload-zone'), aiInput);

  // Reinitialize Lucide icons for dynamically added elements
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function updateVideoUiVisibility() {
  ensureVideoControls();
  const modelMeta = getSelectedVideoModel();
  const kind = (modelMeta && modelMeta.kind) ? modelMeta.kind : currentVideoTab;

  const showVideo = kind === 'video-to-video' || kind === 'motion-control';
  const showImage = kind === 'image-to-video' || kind === 'motion-control' || kind === 'reference-to-video';
  const showRefs = kind === 'reference-to-video' || kind === 'video-to-video';

  if (qs('videoUrlGroup')) qs('videoUrlGroup').style.display = showVideo ? 'block' : 'none';
  if (qs('videoFileGroup')) qs('videoFileGroup').style.display = showVideo ? 'block' : 'none';
  if (qs('videoImageFileGroup')) qs('videoImageFileGroup').style.display = showImage ? 'block' : 'none';
  if (qs('referenceImagesGroup')) qs('referenceImagesGroup').style.display = showRefs ? 'block' : 'none';

  const showEndImage = !!(modelMeta && modelMeta.supportsEndImage && kind === 'image-to-video');
  if (qs('videoEndImageGroup')) qs('videoEndImageGroup').style.display = showEndImage ? 'block' : 'none';

  const showVideoId = kind === 'video-id-to-video';
  if (qs('videoIdGroup')) qs('videoIdGroup').style.display = showVideoId ? 'block' : 'none';

  // Show audio file upload for models that support audio_url
  const allowedOpts = (modelMeta && Array.isArray(modelMeta.allowedOptions)) ? modelMeta.allowedOptions : [];
  const showAudio = allowedOpts.includes('audio_url');
  if (qs('audioFileGroup')) qs('audioFileGroup').style.display = showAudio ? 'block' : 'none';
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

function switchVideoTab(tab) {
  currentVideoTab = tab;
  const ids = ['vtab-text', 'vtab-image', 'vtab-video', 'vtab-reference'];
  for (const id of ids) {
    const el = qs(id);
    if (el) el.classList.remove('active');
  }
  const map = {
    'text-to-video': 'vtab-text',
    'image-to-video': 'vtab-image',
    'video-to-video': 'vtab-video',
    'reference-to-video': 'vtab-reference',
  };
  if (map[tab] && qs(map[tab])) qs(map[tab]).classList.add('active');

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

function refreshKling3ModelDropdown() {
  const sel = qs('kling3Model');
  if (!sel) return;
  const prev = sel.value;
  const items = getKling3ModelsForTab(currentKling3Tab);
  setSelectOptions(sel, items);
  const remembered = kling3SelectedModelByTab[currentKling3Tab];
  if (remembered && Array.isArray(items) && items.some((m) => m.id === remembered)) {
    sel.value = remembered;
  } else if (prev && Array.isArray(items) && items.some((m) => m.id === prev)) {
    sel.value = prev;
  } else if (items[0]) {
    sel.value = items[0].id;
  }
}

function switchKling3Tab(tab) {
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
  const tabIds = ['k3tab-v3-text', 'k3tab-v3-image', 'k3tab-o3-text', 'k3tab-o3-image', 'k3tab-o3-ref', 'k3tab-o3-v2v'];
  for (const id of tabIds) {
    const el = qs(id);
    if (el) el.classList.remove('active');
  }
  const map = {
    'v3-text-to-video': 'k3tab-v3-text',
    'v3-image-to-video': 'k3tab-v3-image',
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

  refreshKling3ModelDropdown();
  updateKling3UiVisibility();
  if (typeof saveAppState === 'function') saveAppState();
}
window.switchKling3Tab = switchKling3Tab;

function switchKling3Family(family) {
  if (family !== 'v3' && family !== 'o3') return;
  currentKling3Family = family;
  const nextTab = kling3LastTabByFamily[family] || (family === 'v3' ? 'v3-text-to-video' : 'o3-text-to-video');
  switchKling3Tab(nextTab);
}
window.switchKling3Family = switchKling3Family;

function updateKling3UiVisibility() {
  const tab = currentKling3Tab;
  const isT2V = tab === 'v3-text-to-video' || tab === 'o3-text-to-video';
  const isI2V = tab === 'v3-image-to-video' || tab === 'o3-image-to-video';
  const isRef = tab === 'o3-reference-to-video';
  const isV2V = tab === 'o3-video-to-video';
  const isV3 = tab.startsWith('v3-');
  const isO3 = tab.startsWith('o3-');
  const selectedModelId = qs('kling3Model') ? qs('kling3Model').value : '';
  const isV2VEdit = selectedModelId === 'kling-o3-pro-v2v-edit';
  const isV2VRef = selectedModelId === 'kling-o3-pro-v2v-ref';

  // Start image (for I2V and Ref modes)
  if (qs('kling3StartImageGroup')) qs('kling3StartImageGroup').style.display = (isI2V || isRef) ? 'block' : 'none';
  // End image (for I2V and O3 Ref modes)
  if (qs('kling3EndImageGroup')) qs('kling3EndImageGroup').style.display = (isI2V || isRef) ? 'block' : 'none';
  // Video upload (for V2V modes)
  if (qs('kling3VideoGroup')) qs('kling3VideoGroup').style.display = isV2V ? 'block' : 'none';
  // Reference images (for Ref and V2V modes)
  if (qs('kling3RefImagesGroup')) qs('kling3RefImagesGroup').style.display = (isRef || isV2V) ? 'block' : 'none';
  // Elements (for V3 I2V and O3 Ref/V2V)
  if (qs('kling3ElementsGroup')) qs('kling3ElementsGroup').style.display = ((isV3 && isI2V) || isRef || isV2V) ? 'block' : 'none';

  // Shot type - V3 T2V has intelligent option, others only customize
  const shotTypeGroup = qs('kling3ShotTypeGroup');
  const shotTypeSel = qs('kling3ShotType');
  if (shotTypeGroup && shotTypeSel) {
    shotTypeGroup.style.display = (isT2V || isI2V || isRef || isV2V) ? 'block' : 'none';
    // Update options based on mode
    if (tab === 'v3-text-to-video') {
      shotTypeSel.innerHTML = '<option value="customize" selected>Customize</option><option value="intelligent">Intelligent</option>';
    } else {
      shotTypeSel.innerHTML = '<option value="customize" selected>Customize</option>';
    }
  }

  // CFG Scale (V3 only)
  if (qs('kling3CfgScaleGroup')) qs('kling3CfgScaleGroup').style.display = isV3 ? 'block' : 'none';
  // Negative prompt (V3 only)
  if (qs('kling3NegativePromptGroup')) qs('kling3NegativePromptGroup').style.display = isV3 ? 'block' : 'none';

  // Duration/Aspect for V2V: only V2V Reference supports these
  if (qs('kling3DurationGroup')) {
    qs('kling3DurationGroup').style.display = isV2V && isV2VEdit ? 'none' : 'block';
  }
  if (qs('kling3AspectRatioGroup')) {
    qs('kling3AspectRatioGroup').style.display = isV2V && isV2VEdit ? 'none' : 'block';
  }

  // Audio settings (V3, O3 T2V, O3 I2V, O3 Ref, and V2V have generate_audio)
  if (qs('kling3AudioSettings')) qs('kling3AudioSettings').style.display = (isV3 || isT2V || isRef || tab === 'o3-image-to-video' || isV2V) ? 'grid' : 'none';
  // Keep audio only for V2V
  if (qs('kling3KeepAudioGroup')) qs('kling3KeepAudioGroup').style.display = isV2V ? 'block' : 'none';

  // Voice IDs (V3 and O3 T2V)
  if (qs('kling3VoiceGroup')) qs('kling3VoiceGroup').style.display = (isV3 || tab === 'o3-text-to-video') ? 'block' : 'none';

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

  // Multi-prompt section
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
  const startImg = qs('kling3StartImageInput');
  if (startImg) {
    startImg.addEventListener('change', (e) => {
      uploadedKling3StartImage = (e.target.files || [])[0] || null;
      const label = qs('kling3StartImageLabel');
      if (label) label.textContent = uploadedKling3StartImage ? uploadedKling3StartImage.name : 'Select image';
      e.target.value = '';
    });
  }

  const endImg = qs('kling3EndImageInput');
  if (endImg) {
    endImg.addEventListener('change', (e) => {
      uploadedKling3EndImage = (e.target.files || [])[0] || null;
      const label = qs('kling3EndImageLabel');
      if (label) label.textContent = uploadedKling3EndImage ? uploadedKling3EndImage.name : 'Select image';
      e.target.value = '';
    });
  }

  const videoInput = qs('kling3VideoInput');
  if (videoInput) {
    videoInput.addEventListener('change', (e) => {
      uploadedKling3Video = (e.target.files || [])[0] || null;
      const label = qs('kling3VideoLabel');
      if (label) label.textContent = uploadedKling3Video ? uploadedKling3Video.name : 'Upload video';
      e.target.value = '';
    });
  }

  const refImgs = qs('kling3RefImagesInput');
  if (refImgs) {
    refImgs.addEventListener('change', (e) => {
      uploadedKling3RefImages = Array.from(e.target.files || []);
      const label = qs('kling3RefImagesLabel');
      if (label) label.textContent = uploadedKling3RefImages.length > 0 ? `${uploadedKling3RefImages.length} images` : 'Select images';
      e.target.value = '';
    });
  }

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
      updateKling3UiVisibility();
    });
  }

  // --- Drag & Drop for Kling3 upload zones ---
  const k3Start = qs('kling3StartImageInput');
  if (k3Start) setupDropZone(k3Start.closest('.upload-zone'), k3Start);
  const k3End = qs('kling3EndImageInput');
  if (k3End) setupDropZone(k3End.closest('.upload-zone'), k3End);
  const k3Vid = qs('kling3VideoInput');
  if (k3Vid) setupDropZone(k3Vid.closest('.upload-zone'), k3Vid);
  const k3Ref = qs('kling3RefImagesInput');
  if (k3Ref) setupDropZone(k3Ref.closest('.upload-zone'), k3Ref);
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

// Elements handling for V3 I2V
function addKling3Element() {
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

  list.innerHTML = kling3Elements.map((item, idx) => {
    const frontalLabel = item.frontalImageFile ? item.frontalImageFile.name : 'Upload frontal';
    const refLabel = item.referenceImageFiles && item.referenceImageFiles.length > 0 
      ? `${item.referenceImageFiles.length} image(s)` 
      : 'Upload refs';
    const videoLabel = item.videoFile ? item.videoFile.name : 'Upload video';
    
    return `
    <div class="multi-prompt-item" data-id="${item.id}">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.35rem;">
        <strong style="font-size:0.75rem;">@Element${idx + 1}</strong>
        <button type="button" onclick="removeKling3Element(${item.id})" style="background:var(--error);border:none;color:#fff;padding:0.25rem 0.4rem;border-radius:var(--radius-xs);cursor:pointer;font-size:0.7rem;">
          <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
        </button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.35rem;">
        <div class="field">
          <label style="font-size:0.65rem;">Frontal Image</label>
          <div class="upload-zone small" onclick="document.getElementById('k3-el-frontal-${item.id}').click()" style="padding:0.3rem;font-size:0.65rem;">
            <i data-lucide="image" style="width:12px;height:12px;"></i>
            <span style="font-size:0.6rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60px;">${escapeHtml(frontalLabel)}</span>
            <input type="file" id="k3-el-frontal-${item.id}" data-id="${item.id}" accept="image/*" hidden class="k3-el-frontal-input" />
          </div>
        </div>
        <div class="field">
          <label style="font-size:0.65rem;">Ref Images</label>
          <div class="upload-zone small" onclick="document.getElementById('k3-el-refs-${item.id}').click()" style="padding:0.3rem;font-size:0.65rem;">
            <i data-lucide="images" style="width:12px;height:12px;"></i>
            <span style="font-size:0.6rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60px;">${escapeHtml(refLabel)}</span>
            <input type="file" id="k3-el-refs-${item.id}" data-id="${item.id}" accept="image/*" multiple hidden class="k3-el-refs-input" />
          </div>
        </div>
        <div class="field">
          <label style="font-size:0.65rem;">Video (opt)</label>
          <div class="upload-zone small" onclick="document.getElementById('k3-el-video-${item.id}').click()" style="padding:0.3rem;font-size:0.65rem;">
            <i data-lucide="film" style="width:12px;height:12px;"></i>
            <span style="font-size:0.6rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:60px;">${escapeHtml(videoLabel)}</span>
            <input type="file" id="k3-el-video-${item.id}" data-id="${item.id}" accept="video/*" hidden class="k3-el-video-input" />
          </div>
        </div>
      </div>
    </div>
  `;
  }).join('');

  // Attach file input event listeners
  list.querySelectorAll('.k3-el-frontal-input').forEach(el => {
    el.addEventListener('change', (e) => {
      const id = Number(e.target.dataset.id);
      if (e.target.files && e.target.files[0]) {
        handleElementFrontalUpload(id, e.target.files[0]);
      }
      e.target.value = '';
    });
  });
  list.querySelectorAll('.k3-el-refs-input').forEach(el => {
    el.addEventListener('change', (e) => {
      const id = Number(e.target.dataset.id);
      if (e.target.files && e.target.files.length > 0) {
        handleElementRefUpload(id, e.target.files);
      }
      e.target.value = '';
    });
  });
  list.querySelectorAll('.k3-el-video-input').forEach(el => {
    el.addEventListener('change', (e) => {
      const id = Number(e.target.dataset.id);
      if (e.target.files && e.target.files[0]) {
        handleElementVideoUpload(id, e.target.files[0]);
      }
      e.target.value = '';
    });
  });

  // --- Drag & Drop for Kling3 element upload zones ---
  list.querySelectorAll('.k3-el-frontal-input').forEach(el => {
    setupDropZone(el.closest('.upload-zone'), el);
  });
  list.querySelectorAll('.k3-el-refs-input').forEach(el => {
    setupDropZone(el.closest('.upload-zone'), el);
  });
  list.querySelectorAll('.k3-el-video-input').forEach(el => {
    setupDropZone(el.closest('.upload-zone'), el);
  });

  if (window.lucide) window.lucide.createIcons();
}

function collectKling3Options() {
  const options = {};

  // Use the specific option keys that match allowedOptions in VIDEO_MODELS
  const duration = qs('kling3Duration') ? qs('kling3Duration').value : '5';
  options.duration_kling3 = duration;

  const aspectRatio = qs('kling3AspectRatio') ? qs('kling3AspectRatio').value : '16:9';
  options.aspect_ratio_kling3 = aspectRatio;

  // Shot type - V3 T2V uses shot_type_v3 (customize/intelligent), others use shot_type_customize
  const shotType = qs('kling3ShotType') ? qs('kling3ShotType').value : 'customize';
  const currentTab = currentKling3Tab || 'v3-text-to-video';
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

  // Elements will be handled separately in submitKling3Request (file uploads)
  // Just mark that we have elements to process
  const validElements = kling3Elements.filter(e => e.frontalImageFile || e.videoFile);
  if (validElements.length > 0) {
    options.hasElements = true;
  }

  return options;
}

async function submitKling3Request(task) {
  const modelId = qs('kling3Model') ? qs('kling3Model').value : '';
  const prompt = task.prompt;
  const options = collectKling3Options();

  const body = { model_id: modelId };

  // Check for multi-prompt mode
  const useMultiPrompt = qs('kling3UseMultiPrompt') && qs('kling3UseMultiPrompt').checked;
  if (useMultiPrompt && kling3MultiPrompts.length > 0) {
    const validPrompts = kling3MultiPrompts.filter(p => p.prompt.trim());
    if (validPrompts.length === 0) throw new Error('At least one multi-prompt shot is required');
    body.multi_prompt = validPrompts.map(p => ({
      prompt: p.prompt.trim(),
      duration: p.duration,
    }));
  } else {
    if (!prompt) throw new Error('Prompt is required');
    body.prompt = prompt;
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
  if (options.hasElements && kling3Elements.length > 0) {
    const elementsArray = [];
    for (const el of kling3Elements) {
      if (!el.frontalImageFile && !el.videoFile) continue;
      const elementObj = {};
      
      // Upload frontal image
      if (el.frontalImageFile) {
        const u = await uploadFileToBlob(el.frontalImageFile, 'kling3-el-frontal');
        if (u) elementObj.frontal_image_url = u;
      }
      
      // Upload reference images
      if (el.referenceImageFiles && el.referenceImageFiles.length > 0) {
        const refUrls = [];
        for (const rf of el.referenceImageFiles) {
          const u = await uploadFileToBlob(rf, 'kling3-el-ref');
          if (u) refUrls.push(u);
        }
        if (refUrls.length > 0) elementObj.reference_image_urls = refUrls;
      }
      
      // Upload video
      if (el.videoFile) {
        const u = await uploadFileToBlob(el.videoFile, 'kling3-el-video');
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
  if (uploadedKling3StartImage) {
    const u = await uploadFileToBlob(uploadedKling3StartImage, 'kling3-start');
    if (u) body.image_url = u;
  }

  if (uploadedKling3EndImage) {
    const u = await uploadFileToBlob(uploadedKling3EndImage, 'kling3-end');
    if (u) body.end_image_url = u;
  }

  // Video URL or upload
  const videoUrl = qs('kling3VideoUrlInput') ? qs('kling3VideoUrlInput').value.trim() : '';
  if (videoUrl) body.video_url = videoUrl;
  if (uploadedKling3Video) {
    const u = await uploadFileToBlob(uploadedKling3Video, 'kling3-video');
    if (u) body.video_url = u;
  }

  // Reference images
  if (uploadedKling3RefImages && uploadedKling3RefImages.length > 0) {
    const imageUrls = [];
    for (const f of uploadedKling3RefImages.slice(0, 4)) {
      const u = await uploadFileToBlob(f, 'kling3-ref');
      if (u) imageUrls.push(u);
    }
    if (imageUrls.length > 0) body.image_urls = imageUrls;
  }

  const res = await fetch('/api/video-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
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
  if (mode === 'kling3') {
    const el = qs('kling3UploadGroup');
    if (el) {
      el.style.display = 'block';
      animateSection(el);
    }
    initKling3Controls();
    switchKling3Family(currentKling3Family);
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
const WIZ_MAX_IMAGES = {
  'nano-banana-2/edit': 14,
  'nano-banana-pro/edit': 14,
  'gpt-image-1.5/edit': 4,
};
function wizMaxImages() {
  const m = qs('toolsModel') ? qs('toolsModel').value : 'nano-banana-2/edit';
  return WIZ_MAX_IMAGES[m] || 4;
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
  strip.innerHTML = '';
  if (uploadedToolsImages.length === 0 || _wizStep === 0) return;

  uploadedToolsImages.forEach((file, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'wiz-img-thumb';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
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
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch(_) { return {}; }
}
function _saveStoreForKey(key, store) {
  try { localStorage.setItem(key, JSON.stringify(store)); } catch(_) {}
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
  const model = qs('toolsModel') ? qs('toolsModel').value : 'nano-banana-2/edit';
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

// Delegate auto-resize to all .wiz-input-grow and .wiz-char-input textareas
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t && (t.classList.contains('wiz-input-grow') || t.classList.contains('wiz-char-input'))) {
    wizAutoResize(t);
  }
});

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
  grid.innerHTML = '';
  if (label) label.textContent = uploadedToolsImages.length > 0
    ? `${uploadedToolsImages.length} image(s)` : (window.I18N ? I18N.t('wiz_upload_text') : 'Click or drag product images');

  uploadedToolsImages.forEach((file, i) => {
    const item = document.createElement('div');
    item.className = 'upload-preview-item';
    item.style.position = 'relative';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(file);
    img.alt = file.name;
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
let _wizCustomPresets = [];        // user-added presets {id, name, dataUrl, addedAt}
let _wizSelectedPresets = new Set();
let _wizHiddenBuiltins = new Set(); // built-in preset IDs hidden by user
let _wizPresetNameOverrides = {};   // {presetId: overriddenName}
let uploadedInspoImages = [];       // kept for backwards compat

// --- Storage keys ---
const INSPO_HIDDEN_KEY  = 'nano_inspo_hidden';
const INSPO_NAMES_KEY   = 'nano_inspo_names';
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
async function _inspoIdbSave(preset) {
  const db = await _inspoIdbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(INSPO_IDB_STORE, 'readwrite');
    tx.objectStore(INSPO_IDB_STORE).put(preset);
    tx.oncomplete = res; tx.onerror = rej;
  });
}
async function _inspoIdbDelete(id) {
  const db = await _inspoIdbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(INSPO_IDB_STORE, 'readwrite');
    tx.objectStore(INSPO_IDB_STORE).delete(id);
    tx.oncomplete = res; tx.onerror = rej;
  });
}
async function _inspoIdbLoadAll() {
  const db = await _inspoIdbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(INSPO_IDB_STORE, 'readonly');
    const req = tx.objectStore(INSPO_IDB_STORE).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror = rej;
  });
}

// --- localStorage helpers ---
function inspoLoadLocalMeta() {
  try { _wizHiddenBuiltins = new Set(JSON.parse(localStorage.getItem(INSPO_HIDDEN_KEY) || '[]')); } catch(_) { _wizHiddenBuiltins = new Set(); }
  try { _wizPresetNameOverrides = JSON.parse(localStorage.getItem(INSPO_NAMES_KEY) || '{}'); } catch(_) { _wizPresetNameOverrides = {}; }
}
function inspoSaveLocalMeta() {
  try {
    localStorage.setItem(INSPO_HIDDEN_KEY, JSON.stringify([..._wizHiddenBuiltins]));
    localStorage.setItem(INSPO_NAMES_KEY, JSON.stringify(_wizPresetNameOverrides));
  } catch(_) {}
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
    ..._wizCustomPresets.map(p => ({ id: p.id, name: _wizPresetNameOverrides[p.id] || p.name || '', src: p.dataUrl, isCustom: true })),
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
      if (cp) { cp.name = newName; try { await _inspoIdbSave(cp); } catch(_) {} }
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
    if (custom && custom.dataUrl) urls.push(custom.dataUrl);
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
ultra-sharp \u00b7 4K detail \u00b7 cinematic lighting \u00b7 premium composition \u00b7 masterpiece${wishes ? `\n\n\u2550\u2550\u2550 ADDITIONAL WISHES \u2550\u2550\u2550\n${wishes}` : ''}${textOverlays ? `\n\n\u2550\u2550\u2550 ADDITIONAL TEXT TO RENDER (reproduce exactly as written) \u2550\u2550\u2550\n${textOverlays}` : ''}`;
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
photorealistic \u00b7 award-winning product photography \u00b7 ultra-sharp focus on product \u00b7 4K detail \u00b7 cinematic lighting \u00b7 premium composition \u00b7 masterpiece \u00b7 high fidelity${imageRolesBlock}${wishes ? `\n\n\u2550\u2550\u2550 USER REQUESTS (important) \u2550\u2550\u2550\n${wishes}` : ''}${textOverlays ? `\n\n\u2550\u2550\u2550 ADDITIONAL TEXT TO RENDER (user specified \u2014 reproduce exactly as written) \u2550\u2550\u2550\n${textOverlays}` : ''}`;
}

async function submitToolsRequest(task) {
  const modelId = qs('toolsModel') ? qs('toolsModel').value : 'nano-banana-2/edit';
  const isNano2 = modelId === 'nano-banana-2/edit';
  const isGpt = modelId === 'gpt-image-1.5/edit';
  const body = { model_id: modelId, prompt: task.prompt };

  const imageUrls = [];
  for (const f of uploadedToolsImages) {
    const u = await uploadFileToBlob(f, 'tools-ref');
    if (u) imageUrls.push(u);
  }
  const presetUrls = getInspoPresetUrls();
  for (const pUrl of presetUrls) {
    try {
      const resp = await fetch(pUrl);
      if (!resp.ok) continue;
      const blob = await resp.blob();
      const ext = pUrl.split('.').pop().split('?')[0] || 'jpg';
      const file = new File([blob], `preset-${Date.now()}.${ext}`, { type: blob.type || 'image/jpeg' });
      const u = await uploadFileToBlob(file, 'tools-inspo-preset');
      if (u) imageUrls.push(u);
    } catch (e) { console.warn('Preset upload failed:', pUrl, e); }
  }
  for (const f of uploadedInspoImages) {
    const u = await uploadFileToBlob(f, 'tools-inspo');
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
  if (!res.ok) throw new Error(await res.text());
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

function openSketchEditor(imageIndex, sourceArr, updateFn) {
  SK.imgIndex = imageIndex;
  SK.sourceArray = sourceArr || uploadedToolsImages;
  SK.updateFn = updateFn || updateToolsImagePreview;
  const file = SK.sourceArray[imageIndex];
  if (!file) return;
  const modal = qs('sketchModal');
  if (!modal) return;
  modal.style.display = 'flex';
  SK.textOverlays = []; SK.selectedTextId = null;
  SK.textBold = false; SK.textItalic = false; SK.textIdCounter = 0;
  SK.zoom = 1; SK.redoStack = [];

  const canvas = qs('sketchCanvas');
  if (!canvas) return;
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
  if (body) body.innerHTML = '';
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

// Get appropriate thumbnail for history item — prefer small thumbnailUrl over full-res url
function getHistoryThumb(item) {
  if (item.type === 'video') {
    return item.thumbnailUrl || `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect fill="#1a1a2e" width="64" height="64" rx="8"/><polygon fill="#fff" points="26,20 26,44 46,32"/></svg>')}`;
  }
  if (item.type === '3d') {
    return item.thumbnailUrl || item.url || `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect fill="#1a1a2e" width="64" height="64" rx="8"/><path fill="#fff" d="M32 16L48 26V42L32 52L16 42V26L32 16Z" stroke="#fff" stroke-width="2" fill="none"/></svg>')}`;
  }
  // For images: prefer the small thumbnailUrl data URI over the full-res url
  return item.thumbnailUrl || item.url || '';
}

const MAX_HISTORY_RENDER = 100; // cap rendered items for performance

function updateHistoryUI() {
  const list = qs('historyList');
  const empty = qs('emptyHistory');
  if (!list || !empty) return;

  if (!history || history.length === 0) {
    list.innerHTML = '';
    empty.style.display = 'flex';
    return;
  }
  empty.style.display = 'none';

  const renderCount = Math.min(history.length, MAX_HISTORY_RENDER);

  // Build HTML string — much faster than N createElement + innerHTML calls
  const parts = [];
  for (let idx = 0; idx < renderCount; idx++) {
    const item = history[idx];
    const icon = item.type === 'video' ? 'play' : (item.type === '3d' ? 'box' : 'image');
    const thumbSrc = getHistoryThumb(item);
    const promptText = item.prompt || (item.type === '3d' ? '3D Model' : (item.type === 'video' ? 'Video' : 'Image'));

    parts.push(`<div class="history-item" data-index="${idx}"><div class="history-content"><div class="history-thumb-wrap"><img src="${escapeHtml(thumbSrc)}" class="history-thumb" loading="lazy" alt=""><div class="history-icon">${_hIcon(icon)}</div></div><div class="history-info"><div class="history-prompt">${escapeHtml(promptText)}</div><div class="history-time">${new Date(item.timestamp).toLocaleTimeString()}</div></div></div><div class="history-actions"><button class="history-action-btn" data-action="reuse" title="Reuse Prompt & Settings">${_hIcon('repeat-2')}</button><button class="history-action-btn" data-action="use-asset" title="Use as Asset">${_hIcon('package-plus')}</button><button class="history-action-btn" data-action="download" title="Download">${_hIcon('download')}</button><button class="history-action-btn history-action-btn--danger" data-action="delete" title="Delete">${_hIcon('trash-2')}</button></div></div>`);
  }

  list.innerHTML = parts.join('');

  // Single event listener for all history items (event delegation)
  list.onclick = handleHistoryClick;

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
  history.unshift(item);
  saveHistory();
  scheduleHistoryUIUpdate();
}

// Silent version: adds to array without triggering save/UI (for batch inserts)
function addToHistorySilent(item) {
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
  history.splice(index, 1);
  saveHistory();
  updateHistoryUI();
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

function removeTask(taskId) {
  if (pollTimers.has(taskId)) {
    clearTimeout(pollTimers.get(taskId));
    pollTimers.delete(taskId);
  }
  const idx = tasks.findIndex((t) => t && t.id === taskId);
  if (idx >= 0) {
    tasks.splice(idx, 1);
    saveTasks();
    renderTasks();
  }
}
window.removeTask = removeTask;

function renderTasks() {
  const panel = qs('generationsPanel');
  if (!panel) return;

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
      const status = escapeHtml(t.status);
      const prompt = escapeHtml((t.prompt || '').slice(0, 120));
      const err = t.error ? `<div class="task-error">${escapeHtml(t.error)}</div>` : '';
      const isFailed = t.status === 'FAILED';
      const canDismiss = isFailed || t.status === 'RUNNING' || t.status === 'SUBMITTING';
      const removeBtn = canDismiss
        ? `<button class="task-remove" onclick="removeTask('${t.id}')" title="${isFailed ? 'Dismiss' : 'Cancel'} task" aria-label="${isFailed ? 'Dismiss' : 'Cancel'} task">&times;</button>`
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
  if (type === 'video') {
    if (data && data.video && data.video.url) urls.push(data.video.url);
    if (Array.isArray(data && data.videos)) {
      for (const v of data.videos) {
        if (v && v.url) urls.push(v.url);
      }
    }
  } else {
    if (data && data.image && data.image.url) urls.push(data.image.url);
    if (Array.isArray(data && data.images)) {
      for (const img of data.images) {
        if (img && img.url) urls.push(img.url);
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

async function uploadFileToBlob(file, folder) {
  if (!file) return null;

  const namePart = sanitizePathPart(file.name || 'upload');
  const rand = Math.random().toString(16).slice(2);
  const pathname = `${sanitizePathPart(folder || 'uploads')}/${Date.now()}-${rand}-${namePart}`;

  let mod = null;
  try {
    mod = await import('https://esm.sh/@vercel/blob@0.27.0/client?bundle');
  } catch {
    mod = await import('https://esm.sh/@vercel/blob@0.27.0/client');
  }

  const upload = mod && typeof mod.upload === 'function' ? mod.upload : null;
  if (!upload) throw new Error('Blob upload client not available');

  const result = await upload(pathname, file, {
    access: 'public',
    handleUploadUrl: '/api/blob-upload',
    contentType: resolveMime(file),
  });

  return result && result.url ? result.url : null;
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
    const imageUrls = [];
    for (const f of uploadedImageFiles) {
      const u = await uploadFileToBlob(f, 'image-input');
      if (u) imageUrls.push(u);
    }
    if (imageUrls.length === 0) throw new Error(window.I18N ? I18N.t('toast_upload_image') : 'Upload at least one image for Style mode');
    body.image_urls = imageUrls;

    if (uploadedMaskFile) {
      const mu = await uploadFileToBlob(uploadedMaskFile, 'mask');
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
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

async function submit3dRequest(task) {
  const modelId = getSelected3dModelId() || 'fal-ai/hunyuan3d-v3/image-to-3d';

  const body = {
    model_id: modelId,
  };

  if (modelId === 'fal-ai/hunyuan3d-v3/image-to-3d') {
    if (!uploaded3dFrontFile) throw new Error('Front image is required for 3D generation');
    body.input_image_url = await uploadFileToBlob(uploaded3dFrontFile, '3d-front');
    body.generate_type = qs('threeDGenerateType') ? qs('threeDGenerateType').value : 'Normal';
    body.enable_pbr = (qs('threeDEnablePbr') ? qs('threeDEnablePbr').value : 'false') === 'true';
    body.polygon_type = qs('threeDPolygonType') ? qs('threeDPolygonType').value : 'triangle';

    const faceCount = qs('threeDFaceCount') ? String(qs('threeDFaceCount').value || '').trim() : '';
    if (faceCount) body.face_count = Number(faceCount);

    if (uploaded3dBackFile) body.back_image_url = await uploadFileToBlob(uploaded3dBackFile, '3d-back');
    if (uploaded3dLeftFile) body.left_image_url = await uploadFileToBlob(uploaded3dLeftFile, '3d-left');
    if (uploaded3dRightFile) body.right_image_url = await uploadFileToBlob(uploaded3dRightFile, '3d-right');
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
    if (!uploaded3dFrontFile) throw new Error('Front image is required for 3D generation');
    body.image_url = await uploadFileToBlob(uploaded3dFrontFile, '3d-front');
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
    if (uploaded3dMeshyTextureImageFile) body.texture_image_url = await uploadFileToBlob(uploaded3dMeshyTextureImageFile, '3d-texture');
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
    if (uploaded3dMeshyTextureImageFile) body.texture_image_url = await uploadFileToBlob(uploaded3dMeshyTextureImageFile, '3d-texture');
  }

  if (modelId === 'fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d') {
    if (!uploaded3dFrontFile) throw new Error('Front image is required for Rapid Image to 3D');
    body.input_image_url = await uploadFileToBlob(uploaded3dFrontFile, '3d-rapid-front');
    body.enable_pbr = (qs('threeDRapidEnablePbr') ? qs('threeDRapidEnablePbr').value : 'false') === 'true';
    body.enable_geometry = (qs('threeDRapidEnableGeometry') ? qs('threeDRapidEnableGeometry').value : 'false') === 'true';
  }

  if (modelId === 'fal-ai/hunyuan-3d/v3.1/smart-topology') {
    if (!uploaded3dTopologyFile) throw new Error('3D file (GLB/OBJ) is required for Smart Topology');
    body.input_file_url = await uploadFileToBlob(uploaded3dTopologyFile, '3d-topology');
    // Auto-detect file type from extension, fallback to dropdown
    const topoFileName = (uploaded3dTopologyFile.name || '').toLowerCase();
    const autoType = topoFileName.endsWith('.obj') ? 'obj' : (topoFileName.endsWith('.glb') ? 'glb' : null);
    body.input_file_type = autoType || (qs('threeDTopologyFileType') ? qs('threeDTopologyFileType').value : 'glb');
    body.polygon_type = qs('threeDTopologyPolygonType') ? qs('threeDTopologyPolygonType').value : 'triangle';
    body.face_level = qs('threeDTopologyFaceLevel') ? qs('threeDTopologyFaceLevel').value : 'medium';
  }

  if (modelId === 'fal-ai/meshy/v5/retexture') {
    if (!uploaded3dRetextureModelFile) throw new Error('3D model file is required for Retexture');
    body.model_url = await uploadFileToBlob(uploaded3dRetextureModelFile, '3d-retexture-model');

    const stylePrompt = qs('threeDRetextureStylePrompt') ? String(qs('threeDRetextureStylePrompt').value || '').trim() : '';
    if (stylePrompt) body.text_style_prompt = stylePrompt;

    if (uploaded3dRetextureStyleImageFile) {
      body.image_style_url = await uploadFileToBlob(uploaded3dRetextureStyleImageFile, '3d-retexture-style');
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
  if (!res.ok) throw new Error(await res.text());
  return await res.json();
}

async function submitVideoRequest(task) {
  ensureVideoControls();
  const modelId = qs('videoModel') ? qs('videoModel').value : '';
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

  const modelMeta = getSelectedVideoModel();
  if (modelMeta && modelMeta.kind === 'video-id-to-video') {
    const vid = qs('videoIdInput') ? String(qs('videoIdInput').value || '').trim() : '';
    if (vid) body.video_id = vid;
  }

  const videoUrl = qs('videoUrlInput') ? String(qs('videoUrlInput').value || '').trim() : '';
  if (videoUrl) body.video_url = videoUrl;

  if (uploadedVideoFile) {
    const vu = await uploadFileToBlob(uploadedVideoFile, 'video');
    if (vu) body.video_url = vu;
  }

  if (uploadedVideoImageFile) {
    const iu = await uploadFileToBlob(uploadedVideoImageFile, 'video-image');
    if (iu) body.image_url = iu;
  }

  if (uploadedEndImageFile) {
    const eu = await uploadFileToBlob(uploadedEndImageFile, 'video-end-image');
    if (eu) body.end_image_url = eu;
  }

  if (uploadedReferenceImages && uploadedReferenceImages.length > 0) {
    const imageUrls = [];
    for (const f of uploadedReferenceImages) {
      const u = await uploadFileToBlob(f, 'video-reference');
      if (u) imageUrls.push(u);
    }
    if (imageUrls.length > 0) body.image_urls = imageUrls;
  }

  // Upload audio file if provided
  if (uploadedAudioFile) {
    const au = await uploadFileToBlob(uploadedAudioFile, 'audio');
    if (au) body.audio_url = au;
  }

  const res = await fetch('/api/video-generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
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
          const item = {
            type: '3d',
            url: t.thumbUrl || placeholder3d,
            glbUrl: o.glbUrl || null,
            modelDownloadUrl: o.modelDownloadUrl,
            modelFormat: o.modelFormat || 'glb',
            model_urls: t.model_urls || null,
            prompt: t.prompt || '',
            timestamp: t.completedAt,
            genCtx: t.genCtx || null,
          };
          t.savedToHistory = true;
          addToHistory(item);
          displayResult(item);
          // Generate small thumbnail for the 3D item
          if (item.url && !item.url.startsWith('data:')) {
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
            const item = {
              type: isVideoMode ? 'video' : 'image',
              url: urls[i],
              prompt: t.prompt || '',
              timestamp: t.completedAt + i,
              genCtx: t.genCtx || null,
            };
            // Generate small thumbnail — avoids loading full-res images as 44px thumbs
            const thumbGenerator = isVideoMode ? generateVideoThumbnail : generateImageThumbnail;
            thumbGenerator(urls[i]).then((thumb) => {
              if (thumb) {
                item.thumbnailUrl = thumb;
                _pendingHistorySave = true;
                debouncedSaveHistory();
                // Patch thumbnail in-place if the DOM element exists
                const list = qs('historyList');
                if (list) {
                  const el = list.querySelector(`.history-item[data-index="${history.indexOf(item)}"]`);
                  if (el) {
                    const img = el.querySelector('.history-thumb');
                    if (img) img.src = thumb;
                  }
                }
              }
            });
            addToHistorySilent(item);
            items.push(item);
          }
          // Single save + single UI update for the whole batch
          saveHistory();
          scheduleHistoryUIUpdate();
          // Set gallery items for navigation
          setGalleryItems(items);
        }
      }

      saveTasks();
      renderTasks();
      showToast(window.I18N ? I18N.t('toast_complete') : 'Masterpiece ready!', 'info');
      return;
    }

    if (data.status === 'FAILED') {
      t.status = 'FAILED';
      t.failedAt = Date.now();
      t.error = data.error || 'Generation failed';
      saveTasks();
      renderTasks();
      showToast(t.error, 'error');
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
        t.error = window.I18N ? I18N.t('err_connection_lost') : 'Connection lost after multiple retries. Please try again.';
        saveTasks();
        renderTasks();
        showToast(t.error, 'error');
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
    t.error = e && e.message ? e.message : String(e);
    saveTasks();
    renderTasks();
    showToast(t.error, 'error');
  }
}

async function startTask(taskId) {
  const t = tasks.find((x) => x && x.id === taskId);
  if (!t) return;
  t.status = 'SUBMITTING';
  t.error = null;
  t.startedAt = Date.now();
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
    saveTasks();
    renderTasks();

    pollTask(t.id);
  } catch (e) {
    t.status = 'FAILED';
    t.failedAt = Date.now();
    t.error = e && e.message ? e.message : String(e);
    saveTasks();
    renderTasks();
    showToast(t.error, 'error');
  }
}

function captureGenerationContext() {
  const ctx = {
    mode: currentMode,
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
  if (currentMode === 'video' && !prompt) {
    const vm = getSelectedVideoModel();
    if (!(vm && vm.requiresPrompt === false)) {
      showToast(window.I18N ? I18N.t('toast_enter_prompt') : 'Please enter a prompt', 'error');
      return;
    }
  }

  // Kling 3 mode - check for prompt or multi-prompt
  if (currentMode === 'kling3') {
    const useMultiPrompt = qs('kling3UseMultiPrompt') && qs('kling3UseMultiPrompt').checked;
    if (!useMultiPrompt && !prompt) {
      showToast(window.I18N ? I18N.t('toast_enter_prompt') : 'Please enter a prompt', 'error');
      return;
    }
    if (useMultiPrompt && kling3MultiPrompts.filter(p => p.prompt.trim()).length === 0) {
      showToast(window.I18N ? I18N.t('toast_add_shot') : 'Please add at least one shot prompt', 'error');
      return;
    }
    // Check for required images based on tab
    const tab = currentKling3Tab;
    const isI2V = tab === 'v3-image-to-video' || tab === 'o3-image-to-video';
    const isRef = tab === 'o3-reference-to-video';
    const isV2V = tab === 'o3-video-to-video';
    if ((isI2V || isRef) && !uploadedKling3StartImage) {
      showToast(window.I18N ? I18N.t('toast_upload_start') : 'Please upload a start image', 'error');
      return;
    }
    if (isV2V && !uploadedKling3Video && !qs('kling3VideoUrlInput')?.value.trim()) {
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
    if (meta && meta.kind === 'image-to-3d' && !uploaded3dFrontFile) {
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
      if (!sp && !uploaded3dRetextureStyleImageFile) {
        showToast(window.I18N ? I18N.t('toast_style_or_image') : 'Please provide a style prompt or style image', 'error');
        return;
      }
    }
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  let model_id;
  if (currentMode === 'tools') model_id = qs('toolsModel') ? qs('toolsModel').value : 'nano-banana-2/edit';
  else if (currentMode === 'text') model_id = qs('imageModelText') ? qs('imageModelText').value : 'nano-banana-pro';
  else if (currentMode === 'image') model_id = qs('imageModelEdit') ? qs('imageModelEdit').value : 'nano-banana-pro/edit';

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
    if (!textSel.value) textSel.value = 'nano-banana-pro';
  }

  const editSel = qs('imageModelEdit');
  if (editSel) {
    setSelectOptions(editSel, IMAGE_MODELS_EDIT);
    if (!editSel.value) editSel.value = 'nano-banana-pro/edit';
  }

  const threeDSel = qs('threeDModel');
  if (threeDSel) {
    setSelectOptions(threeDSel, THREE_D_MODELS);
    if (!threeDSel.value) threeDSel.value = 'fal-ai/hunyuan3d-v3/image-to-3d';
  }
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

  const maskInput = qs('maskInput');
  if (maskInput) {
    maskInput.addEventListener('change', (e) => {
      uploadedMaskFile = (e.target.files || [])[0] || null;
      const label = qs('maskUploadLabel');
      if (label) label.textContent = uploadedMaskFile ? uploadedMaskFile.name : 'Click to upload mask (optional)';
      e.target.value = '';
    });
  }

  const f = qs('threeDFrontInput');
  if (f) f.addEventListener('change', (e) => {
    uploaded3dFrontFile = (e.target.files || [])[0] || null;
    const label = qs('threeDFrontLabel');
    if (label) label.textContent = uploaded3dFrontFile ? uploaded3dFrontFile.name : 'Click to upload front view';
    e.target.value = '';
  });
  const b = qs('threeDBackInput');
  if (b) b.addEventListener('change', (e) => {
    uploaded3dBackFile = (e.target.files || [])[0] || null;
    const label = qs('threeDBackLabel');
    if (label) label.textContent = uploaded3dBackFile ? uploaded3dBackFile.name : 'Click to upload back view';
    e.target.value = '';
  });
  const l = qs('threeDLeftInput');
  if (l) l.addEventListener('change', (e) => {
    uploaded3dLeftFile = (e.target.files || [])[0] || null;
    const label = qs('threeDLeftLabel');
    if (label) label.textContent = uploaded3dLeftFile ? uploaded3dLeftFile.name : 'Click to upload left view';
    e.target.value = '';
  });
  const r = qs('threeDRightInput');
  if (r) r.addEventListener('change', (e) => {
    uploaded3dRightFile = (e.target.files || [])[0] || null;
    const label = qs('threeDRightLabel');
    if (label) label.textContent = uploaded3dRightFile ? uploaded3dRightFile.name : 'Click to upload right view';
    e.target.value = '';
  });

  const tex = qs('threeDMeshyTextureImageInput');
  if (tex) tex.addEventListener('change', (e) => {
    uploaded3dMeshyTextureImageFile = (e.target.files || [])[0] || null;
    const label = qs('threeDMeshyTextureImageLabel');
    if (label) label.textContent = uploaded3dMeshyTextureImageFile ? uploaded3dMeshyTextureImageFile.name : 'Click to upload texture guide';
    e.target.value = '';
  });

  const topoInput = qs('threeDTopologyFileInput');
  if (topoInput) topoInput.addEventListener('change', (e) => {
    uploaded3dTopologyFile = (e.target.files || [])[0] || null;
    const label = qs('threeDTopologyFileLabel');
    if (label) label.textContent = uploaded3dTopologyFile ? uploaded3dTopologyFile.name : 'Upload GLB or OBJ';
    e.target.value = '';
  });

  const retexModelInput = qs('threeDRetextureModelInput');
  if (retexModelInput) retexModelInput.addEventListener('change', (e) => {
    uploaded3dRetextureModelFile = (e.target.files || [])[0] || null;
    const label = qs('threeDRetextureModelLabel');
    if (label) label.textContent = uploaded3dRetextureModelFile ? uploaded3dRetextureModelFile.name : 'Upload 3D model';
    e.target.value = '';
  });

  const retexStyleInput = qs('threeDRetextureStyleImageInput');
  if (retexStyleInput) retexStyleInput.addEventListener('change', (e) => {
    uploaded3dRetextureStyleImageFile = (e.target.files || [])[0] || null;
    const label = qs('threeDRetextureStyleImageLabel');
    if (label) label.textContent = uploaded3dRetextureStyleImageFile ? uploaded3dRetextureStyleImageFile.name : 'Upload style';
    e.target.value = '';
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
      t.error = window.I18N ? I18N.t('err_interrupted') : 'Interrupted - please try again';
      changed = true;
    }
  }

  for (const t of tasks) {
    if (!t) continue;

    if (t.status === 'COMPLETED' && !t.savedToHistory) {
      if (t.mode === '3d' && t.mediaUrl) {
        const placeholder3d = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#000"/><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" fill="#fff" font-family="Arial" font-size="14">3D</text></svg>')}`;
        const fmt = t.modelFormat || 'glb';
        const item = {
          type: '3d',
          url: t.thumbUrl || placeholder3d,
          glbUrl: fmt === 'glb' ? t.mediaUrl : null,
          modelDownloadUrl: t.mediaUrl,
          modelFormat: fmt,
          model_urls: t.model_urls || null,
          prompt: t.prompt || '',
          timestamp: t.completedAt || Date.now(),
          genCtx: t.genCtx || null,
        };
        t.savedToHistory = true;
        addToHistory(item);
        changed = true;
      }

      if (t.mode !== '3d' && t.mediaUrl) {
        const item = {
          type: t.mode === 'video' ? 'video' : 'image',
          url: t.mediaUrl,
          prompt: t.prompt || '',
          timestamp: t.completedAt || Date.now(),
          genCtx: t.genCtx || null,
        };
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
      t.error = window.I18N ? I18N.t('err_task_expired') : 'Task expired after being active too long. Please try again.';
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
async function generateMissingThumbnails() {
  let changed = false;
  // Process in small batches to avoid blocking the main thread
  for (const item of history) {
    if (!item.thumbnailUrl && item.url) {
      let thumb = null;
      if (item.type === 'video') {
        thumb = await generateVideoThumbnail(item.url);
      } else if (item.type === 'image' || (!item.type && item.url)) {
        thumb = await generateImageThumbnail(item.url);
      }
      if (thumb) {
        item.thumbnailUrl = thumb;
        changed = true;
      }
    }
  }
  if (changed) {
    saveHistory();
    // Only update UI if drawer has been rendered; otherwise next open will pick up changes
    if (_historyRendered) updateHistoryUI();
  }
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

function saveAppState() {
  try {
    const state = {
      mode: currentMode,
      videoTab: currentVideoTab,
      kling3Family: currentKling3Family,
      kling3Tab: currentKling3Tab,
      selects: {},
      inputs: {},
    };
    for (const id of PERSISTED_SELECTS) {
      const el = qs(id);
      if (el) state.selects[id] = el.value;
    }
    for (const id of PERSISTED_INPUTS) {
      const el = qs(id);
      if (el) state.inputs[id] = el.value;
    }
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

    // Restore mode and tabs
    if (state.videoTab) currentVideoTab = state.videoTab;
    if (state.kling3Family) currentKling3Family = state.kling3Family;
    if (state.kling3Tab) currentKling3Tab = state.kling3Tab;

    // Stash wizard state for initToolsControls to pick up
    window._wizRestoredState = {
      step: typeof state.wizStep === 'number' ? state.wizStep : null,
      chars: Array.isArray(state.wizChars) ? state.wizChars : null,
      selectedPresets: Array.isArray(state.wizSelectedPresets) ? state.wizSelectedPresets : null,
    };

    return state.mode || false;
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
}

// Init
initModels();
initInputs();
initModelViewerTouchFix();
// History UI is lazy — built on first drawer open (see toggleHistory)
renderTasks();
initTasks();
generateMissingThumbnails();

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
  if (savedMode === 'kling3') {
    if (currentKling3Family) switchKling3Family(currentKling3Family);
    if (currentKling3Tab) switchKling3Tab(currentKling3Tab);
  }
  if (savedMode === '3d') {
    update3dUiVisibility();
  }
} else {
  switchMode('text');
}

// Apply i18n LAST — after all selects and models are populated
if (window.I18N) window.I18N.init();
