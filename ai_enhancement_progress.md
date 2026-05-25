# UI-Link AI / ESRGAN Progress Notes

Updated: 2026-05-25
Status: Core logic is working, but the HTML shell was rolled back to a safe baseline and some UI is now re-injected dynamically from `js/main.js`.

## What is working

### 1. Local ESRGAN test pipeline

- Button: `btnMakeClearTest`
- Flow now works end to end:
  1. Export active layer from Photoshop with `exportLayerForPipeline()`
  2. Split source PNG into RGB and Alpha in CEP canvas
  3. Run local `realesrgan-ncnn-vulkan.exe`
  4. Rebuild alpha after upscale
  5. Import final image back to Photoshop with `importFromPipeline()`

- Important fixes already made:
  - Switched image loading from fragile `file:///...png` loading to `window.cep.fs.readFile(..., Base64)` + `data:image/...`
  - Added output-file polling/retry so the panel no longer hangs at "restore alpha"
  - Prefer direct exe launch for Real-ESRGAN instead of always wrapping with `cmd /c`
  - Added fallback to `cmd.exe` only if direct process launch fails
  - Increased output wait time

### 2. Cloud AI clear flow

- Button: `btnMakeClear`
- Photoshop export helper used: `getActiveLayerExportForAI()`
- Photoshop import helper used: `replaceCurrentLayerWithFile()`

- Current capabilities:
  - Supports OpenAI-compatible gateways
  - Supports Gemini native mode in logic
  - Can fetch model list from:
    - Gemini native `/models`
    - OpenAI-compatible `/models`
  - Parses multiple response shapes for returned images
  - Writes returned images to local temp file and places them back into Photoshop

- Important fixes already made:
  - Normalize Base64 before sending to Gemini/native style payloads
  - Parse returned image payloads more defensively
  - Detect actual returned image format by `Content-Type` or file signature
  - Save AI result using the correct extension instead of always forcing `.png`
    - This fixed the Photoshop error where a JPEG payload was saved with a `.png` suffix

### 3. Dynamic UI injection strategy

- `index.html` was temporarily broken multiple times during manual HTML edits because of encoding-corrupted content and malformed tags.
- To reduce white-screen risk, `index.html` was restored to the safe baseline from git.
- New/extra UI is now being injected at runtime by `ensureEnhancedPanels()` in `js/main.js`.

## Current UI strategy

### Stable baseline

- `index.html` should be kept close to the safe git baseline unless absolutely necessary.
- New tabs/panels should preferably be added via JS DOM injection first, then migrated into static HTML only after verified stable.

### Runtime-injected UI

`ensureEnhancedPanels()` is the current entry point for rebuilding missing UI:

- Renames top tab label to `图层属性`
- Adds naming subtabs:
  - `属性`
  - `AI清晰`
- Adds setting subtabs:
  - `检查更新`
  - `AI实验室`
- Injects AI settings panel inputs:
  - `aiApiUrl`
  - `aiApiKey`
  - `aiModel`
  - `aiModelSelect`
  - `btnFetchModels`

## Important warning

The current `ensureEnhancedPanels()` function in `js/main.js` is the live integration point for UI restoration.

That means:

- If future work touches tabs/subtabs, start there first
- Do not aggressively rewrite `index.html` again unless we intentionally rebuild it from scratch
- If the panel ever whitescreens again, first suspect malformed HTML or encoding issues in `index.html`

## Known product behavior / limitations

### 1. Gemini / gateway output quality

- Third-party gateway + Gemini image models do not behave exactly like Gemini web/app image enhancement UX
- API mode still tends to "re-generate" rather than "faithfully upscale"
- Prompt tuning helps, but product-side enhancement behavior from consumer apps is not fully reproducible via simple API prompting

### 2. ESRGAN output quality

- Local ESRGAN is conservative
- It preserves structure better than generative redraw, but may look only mildly sharper if original details are already lost

## Files touched in this round

- `js/main.js`
  - Local ESRGAN pipeline fixes
  - Cloud AI request / import fixes
  - Model list fetching
  - Dynamic UI injection

- `jsx/hostscript.jsx`
  - Uses:
    - `getActiveLayerExportForAI()`
    - `exportLayerForPipeline()`
    - `importFromPipeline()`
    - `replaceCurrentLayerWithFile()`

- `index.html`
  - Restored to safe baseline from git after white-screen issues

## Recommended next steps

1. Stabilize `ensureEnhancedPanels()`
- Verify all injected subtabs render correctly after fresh panel load
- Especially confirm:
  - `图层属性 -> 属性 / AI清晰`
  - `Setting -> 检查更新 / AI实验室`

2. Merge PS扩图 into 九宫格
- Target UX:
  - `九宫格 -> 切图 / 扩图`
- Prefer doing this in `ensureEnhancedPanels()` first
- Only remove `tab-tools` from static HTML after runtime behavior is confirmed stable

3. Improve Gemini-quality path
- Keep current gateway-compatible path
- Add model-specific presets/prompts for image-preserving enhancement
- Consider adding separate modes:
  - faithful enhance
  - generative redraw

4. Clean up logging and user-facing Chinese text
- Some older strings are still mojibake in static HTML / legacy JS comments
- Functional, but ugly

5. Clean temp files
- AI result temp files
- local ESRGAN temp split files
- final pipeline temp outputs

## Safe restart point for next conversation

If continuing in a new thread, start with:

1. Open `js/main.js`
2. Inspect `ensureEnhancedPanels()`
3. Verify current runtime-injected tabs
4. Continue from the "PS扩图并入九宫格" task
