import re

# ========== 1. REWRITE HTML ==========
html = open('public/index.html', encoding='utf-8').read()

blocks = [
    ('gptEditCustomSizeFields', 'editImageWidth', 'editImageHeight', 1024, 1536),
    ('toolsGptCustomSizeFields', 'toolsGptImageWidth', 'toolsGptImageHeight', 1200, 1600),
    ('gptTextCustomSizeFields', 'gptImageWidth', 'gptImageHeight', 1536, 2048),
]

for cid, wid, hid, wd, hd in blocks:
    tag = f'id="{ cid }"'
    si = html.find(tag)
    if si == -1:
        print(f'SKIP { cid }')
        continue
    div_start = html.rfind('<div', 0, si)
    depth = 0
    pos = si
    while pos < len(html):
        no = html.find('<div', pos + 1)
        nc = html.find('</div>', pos + 1)
        if nc == -1:
            break
        if no != -1 and no < nc:
            depth += 1
            pos = no
        else:
            if depth == 0:
                pos = nc + 6
                break
            depth -= 1
            pos = nc
    old = html[div_start:pos]
    sm = re.search(r'style="([^"]*)"', old)
    cm = re.search(r'class="([^"]*)"', old)
    sty = sm.group(1) if sm else 'display:none;'
    cls = cm.group(1) if cm else 'settings-row gpt-custom-size-fields'
    nw = f'''<div class="{ cls }" id="{ cid }" style="{ sty }">
                                <div class="field gpt-size-slider-field">
                                    <div class="gpt-size-slider-head">
                                        <label for="{ wid }">Width</label>
                                        <input type="number" class="gpt-size-slider-value gpt-size-slider-value-input" id="{ wid }Value" step="1" value="{ wd }" aria-label="Width">
                                    </div>
                                    <input type="range" id="{ wid }" min="1" max="4096" step="1" value="{ wd }">
                                </div>
                                <div class="field gpt-size-slider-field">
                                    <div class="gpt-size-slider-head">
                                        <label for="{ hid }">Height</label>
                                        <input type="number" class="gpt-size-slider-value gpt-size-slider-value-input" id="{ hid }Value" step="1" value="{ hd }" aria-label="Height">
                                    </div>
                                    <input type="range" id="{ hid }" min="1" max="4096" step="1" value="{ hd }">
                                </div>
                            </div>'''
    html = html[:div_start] + nw + html[pos:]
    print(f'Replaced { cid }')

open('public/index.html', 'w', encoding='utf-8').write(html)
print('HTML done')

# ========== 2. REWRITE JS ==========
app = open('public/app.js', encoding='utf-8').read()

# Remove old constant
app = re.sub(r'const GPT_IMAGE_2_SLIDER_WINDOW_RADIUS = \d+;\r?\n', '', app)

js_start = app.find('function parseGptImageDimension(value) {')
js_end = app.find('function updateGptTextControls()')
if js_start == -1 or js_end == -1:
    print('JS markers not found')
    exit(1)

new_js = """function parseGptImageDimension(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num);
}

function updateGptSizeRangeFill(rangeEl) {
  if (!rangeEl) return;
  const min = Number(rangeEl.min) || 0;
  const max = Number(rangeEl.max) || 100;
  const val = Number(rangeEl.value) || min;
  const pct = max > min ? ((val - min) / (max - min)) * 100 : 50;
  rangeEl.style.setProperty('--range-fill', Math.max(0, Math.min(100, pct)) + '%');
}

function bindGptSizePair(rangeId) {
  const rangeEl = qs(rangeId);
  const inputEl = qs(rangeId + 'Value');
  if (!rangeEl || !inputEl) return;
  const onRange = () => {
    inputEl.value = rangeEl.value;
    updateGptSizeRangeFill(rangeEl);
    if (typeof saveAppState === 'function') saveAppState();
  };
  rangeEl.addEventListener('input', onRange);
  rangeEl.addEventListener('change', onRange);
  const onInput = () => {
    const v = parseGptImageDimension(inputEl.value);
    if (v !== null) {
      const mn = Number(rangeEl.min) || 1;
      const mx = Number(rangeEl.max) || 4096;
      rangeEl.value = String(Math.max(mn, Math.min(mx, v)));
      updateGptSizeRangeFill(rangeEl);
    }
    if (typeof saveAppState === 'function') saveAppState();
  };
  inputEl.addEventListener('input', onInput);
  inputEl.addEventListener('change', onInput);
  updateGptSizeRangeFill(rangeEl);
}

function bindGptImage2CustomSizePair(widthId, heightId, hintId, selectId) {
  bindGptSizePair(widthId);
  bindGptSizePair(heightId);
}

function buildGptImageSizePayload(selectId, widthId, heightId, hintId, modelId) {
  const selectEl = qs(selectId);
  const sizeValue = selectEl ? String(selectEl.value || '').trim() : '';
  if (!sizeValue) return null;
  if (modelId !== GPT_IMAGE_2_TEXT_MODEL_ID && modelId !== GPT_IMAGE_2_EDIT_MODEL_ID) {
    return sizeValue;
  }
  if (sizeValue !== 'custom') return sizeValue;
  const inputW = qs(widthId + 'Value');
  const inputH = qs(heightId + 'Value');
  const rangeW = qs(widthId);
  const rangeH = qs(heightId);
  const rawWidth = parseGptImageDimension((inputW && inputW.value) || (rangeW && rangeW.value));
  const rawHeight = parseGptImageDimension((inputH && inputH.value) || (rangeH && rangeH.value));
  return { width: rawWidth, height: rawHeight };
}

"""

app = app[:js_start] + new_js + app[js_end:]
open('public/app.js', 'w', encoding='utf-8').write(app)
print('JS done')

# ========== 3. FIX CSS ==========
css = open('public/index.css', encoding='utf-8').read()
css = re.sub(r'\.gpt-size-slider-value-input::-webkit-outer-spin-button,\s*\n\.gpt-size-slider-value-input:::-webkit-inner-spin-button\s*\{[^}]*\}\s*', '', css)
css = re.sub(r'\.gpt-size-slider-value-input\s*\{[^}]*\}',
    '.gpt-size-slider-value-input {\n    width: 100px;\n    text-align: center;\n    outline: none;\n}', css, count=1)
css = re.sub(r'\.gpt-size-slider-meta\s*\{[^}]*\}', '.gpt-size-slider-meta { display: none; }', css)
open('public/index.css', 'w', encoding='utf-8').write(css)
print('CSS done')

print('All rewrites complete.')
