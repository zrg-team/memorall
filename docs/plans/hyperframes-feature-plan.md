# HyperFrames Feature — Implementation Plan

## What We're Building

A new agent feature that lets the agent **compose, preview, and export HyperFrames video compositions** — structured HTML+GSAP files that render deterministically to MP4.

**Three phases:**
- **Phase 1 ✅ Done** — Feature step + official system prompt + inline preview
- **Phase 2** — `@hyperframes/core` HTML generation tools (programmatic scaffolding)
- **Phase 3** — In-browser video export via WebCodecs (deterministic, no CLI needed)

**Official docs:** https://hyperframes.heygen.com/introduction  
**GitHub repo:** https://github.com/heygen-com/hyperframes  
**Official Claude system prompt:** https://github.com/heygen-com/hyperframes/blob/main/docs/guides/claude-design-hyperframes.md  
**Agent skill definition:** https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/SKILL.md  
**Prompt guide:** https://hyperframes.heygen.com/guides/prompting

---

## Package Analysis

| Package | Browser safe? | Phase | Reason |
|---|---|---|---|
| `@hyperframes/core` | Partial | Phase 2 | Browser-safe: HTML generation, parsing, element manipulation, timing compiler, runtime IIFE. Node-only: `compileHtml` (needs media probing), `bundleToSingleHtml`. Docs: https://hyperframes.heygen.com/packages/core |
| `@hyperframes/player` | Yes | Phase 3 | Web component. `iframeElement` getter exposes the sandboxed iframe for frame capture. Docs: https://hyperframes.heygen.com/packages/player |
| `@hyperframes/shader-transitions` | Yes (CDN) | All | Loaded from CDN inside composition HTML — no install needed |
| `@hyperframes/engine` | **No** | Never | Requires `chrome-headless-shell` + CDP + FFmpeg binary — Node.js only. Docs: https://hyperframes.heygen.com/packages/engine |
| `@hyperframes/producer` | **No** | Never | Orchestrates the engine — Node.js only |
| `mp4-muxer` | Yes | Phase 3 | Muxes WebCodecs `EncodedVideoChunk` output into a playable MP4. No SharedArrayBuffer needed. https://github.com/Vanilagy/mp4-muxer |
| `@ffmpeg/ffmpeg` + `@ffmpeg/core` | Conditional | Skip | Requires SharedArrayBuffer + COOP/COEP headers. Extension can set these via `declarativeNetRequest` but adds 10MB bundle. WebCodecs + mp4-muxer is cleaner. |

**Phase 1 requires zero new npm packages.**  
**Phase 2 requires:** `@hyperframes/core`  
**Phase 3 requires:** `@hyperframes/player` + `mp4-muxer`  

---

## Phase 1 — Feature Step + System Prompt ✅ COMPLETE

**Files created:**
- [`src/services/flows/steps/features/hyperframes-feature/hyperframes-feature.ts`](../src/services/flows/steps/features/hyperframes-feature/hyperframes-feature.ts)
- [`src/services/flows/steps/features/hyperframes-feature/index.ts`](../src/services/flows/steps/features/hyperframes-feature/index.ts)
- [`src/services/flows/steps/features/index.ts`](../src/services/flows/steps/features/index.ts) — +1 import line

**What it does:**
- Injects the full official HyperFrames system prompt (adapted: `fs_write` instead of ZIP, `render_memorall_artifact` instead of CLI preview)
- Adds `render_memorall_artifact` to the agent's tool list for inline composition preview
- Follows the exact same pattern as [`pdf-generate-feature.ts`](../src/services/flows/steps/features/pdf-generate-feature.ts)

**Preview flow:** Agent writes composition HTML → calls `fs_read` → passes full HTML to `render_memorall_artifact` with `type: "text/html"` → composition plays back in sandboxed artifact iframe (GSAP + HF runtime load from CDN inside the iframe).

---

## Phase 2 — `@hyperframes/core` HTML Generation Tools

**Goal:** Give the agent programmatic tools for scaffolding and modifying compositions, reducing structural errors vs. raw HTML authoring.

### When to implement
Only if the agent struggles to produce structurally valid compositions from the system prompt alone (e.g., broken data attributes, misaligned scene timings). The system prompt already embeds all the rules and skeleton templates, so this phase may not be needed.

### New packages
```bash
yarn add @hyperframes/core
```

### Browser-safe APIs from `@hyperframes/core`

**HTML generation:**
```typescript
import {
  generateHyperframesHtml,        // generate composition shell
  generateGsapTimelineScript,     // generate GSAP timeline <script>
  generateHyperframesStyles,      // generate <style> block
  generateBaseHtml,               // generate minimal wrapper HTML
} from "@hyperframes/core";
```

**Element manipulation:**
```typescript
import {
  addElementToHtml,               // add a timeline element
  updateElementInHtml,            // update element properties
  removeElementFromHtml,          // remove element by id
  validateCompositionHtml,        // validate structure
} from "@hyperframes/core";
```

**Parsing:**
```typescript
import { parseHtml, extractCompositionMetadata } from "@hyperframes/core";
```

**Runtime (for Phase 3 frame capture):**
```typescript
import { loadHyperframeRuntimeSource } from "@hyperframes/core/runtime";
// Returns pre-built IIFE string to inject into composition HTML
```

**Timing compiler (browser-safe):**
```typescript
import { compileTimingAttrs } from "@hyperframes/core/compiler";
// Resolves data-start / data-duration attributes
```

### New tool files

```
src/services/flows/tools/hyperframes/
  index.ts                          — re-export all tools + import for side-effect registration
  hyperframes-scaffold.ts           — hyperframes_scaffold tool
  hyperframes-add-element.ts        — hyperframes_add_element tool
  hyperframes-update-element.ts     — hyperframes_update_element tool
  hyperframes-remove-element.ts     — hyperframes_remove_element tool
  hyperframes-validate.ts           — hyperframes_validate tool
```

### Tool contracts

All tools follow the pattern of [`fs/fs-read.ts`](../src/services/flows/tools/fs/fs-read.ts) — `ToolFactory<Input, Services>` with `AllServices` injection.

**`hyperframes_scaffold`** — generate a fresh composition shell from a high-level spec:
```typescript
// Input
{
  resolution: "1920x1080" | "1080x1920",
  duration: number,          // total seconds
  scene_count: number,
  shader_count?: number,     // defaults to 2
}
// Output: { html: string }  — valid skeleton HTML ready to fill
// Uses: generateBaseHtml + generateHyperframesStyles + generateGsapTimelineScript
```

**`hyperframes_add_element`** — add a text/image/video element to an existing composition:
```typescript
// Input
{
  html: string,              // current composition HTML
  element: TimelineElement,  // @hyperframes/core TimelineElement type
}
// Output: { html: string }
// Uses: addElementToHtml(html, element)
```

**`hyperframes_update_element`** — update element properties:
```typescript
// Input
{
  html: string,
  element_id: string,
  properties: Partial<KeyframeProperties>,
}
// Output: { html: string }
// Uses: updateElementInHtml(html, elementId, properties)
```

**`hyperframes_remove_element`**:
```typescript
// Input: { html: string, element_id: string }
// Output: { html: string }
// Uses: removeElementFromHtml(html, elementId)
```

**`hyperframes_validate`** — lint composition HTML for structural errors:
```typescript
// Input: { html: string }
// Output: { ok: boolean, errors: string[], warnings: string[] }
// Uses: validateCompositionHtml(html) + lintHyperframeHtml from "@hyperframes/core/lint"
```

### Feature step update

Add the 5 new tool names to `HYPERFRAMES_FEATURE_TOOLS` in [`hyperframes-feature.ts`](../src/services/flows/steps/features/hyperframes-feature/hyperframes-feature.ts):

```typescript
export const HYPERFRAMES_FEATURE_TOOLS = [
  "render_memorall_artifact",
  "hyperframes_scaffold",
  "hyperframes_add_element",
  "hyperframes_update_element",
  "hyperframes_remove_element",
  "hyperframes_validate",
] as const;
```

Register the new tools via their `index.ts` side-effect import in [`src/services/flows/tools/index.ts`](../src/services/flows/tools/index.ts) (if it exists) or directly in the feature file.

---

## Phase 3 — In-Browser Video Export

**Goal:** Convert a HyperFrames composition to MP4 directly in the browser extension — no CLI, no Node.js.

### Why `@hyperframes/engine` cannot be used
The engine uses Chrome's `BeginFrame` CDP API (DevTools Protocol) through `chrome-headless-shell`. This API is only available in headless Node.js — impossible in a browser context.  
Docs: https://hyperframes.heygen.com/packages/engine

### Chosen approach: WebCodecs + `mp4-muxer` (deterministic, frame-accurate)

**Why WebCodecs over FFmpeg WASM:**
- No `SharedArrayBuffer` requirement (no COOP/COEP header complexity)
- 10× faster than real-time (vs. FFmpeg WASM which is ~1–2× real-time)
- Native browser API — Chrome/Edge 94+, Firefox 130+, Safari 26+
- `mp4-muxer` produces standard H.264 MP4 in ~3KB

**Why not `MediaRecorder`:**
MediaRecorder captures in real-time (1 second of video takes 1 second to record). It's also non-deterministic — frame timing depends on the system. For a 60s composition this means 60s of waiting.

### The `window.__hf` seek protocol

The HyperFrames runtime exposes a control protocol on `window.__hf` inside each composition iframe:

```typescript
interface HyperframeRuntime {
  duration: number;           // total composition duration in seconds
  seek(time: number): void;   // seek to time and synchronously render that frame
}
// Accessed via: iframe.contentWindow.__hf
// Also: iframe.contentWindow.__timelines["main"] — direct GSAP timeline access
```

The `@hyperframes/player` web component exposes its inner iframe via:
```typescript
const player = document.querySelector('hyperframes-player');
const iframe = player.iframeElement;
// iframe.contentWindow.__hf.duration
// iframe.contentWindow.__hf.seek(time)
```

Player docs: https://hyperframes.heygen.com/packages/player  
Runtime source: `@hyperframes/core/runtime` → `loadHyperframeRuntimeSource()`

### Cross-origin canvas capture

**The problem:** `ctx.drawImage(iframe)` is blocked when the iframe is cross-origin. HyperFrames compositions load scripts from `cdn.jsdelivr.net` (GSAP, shader-transitions), which taints the iframe for canvas purposes.

**The solution:** Load the composition HTML as a `blob:` URL in the **same extension origin**:
```typescript
// Read composition HTML from OPFS/FS
const html = await readCompositionFile(path);
// Create a blob URL — this is same-origin (blob: scheme, no host)
const blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
// Mount player with blobUrl — iframe now loads from blob: (same origin)
player.setAttribute("src", blobUrl);
```

A `blob:` URL is owned by the creating origin, so scripts loaded inside it (CDN GSAP etc.) do NOT taint the parent canvas — **only cross-origin `src` attributes taint**, not scripts loaded inside the blob document. The canvas capture works.

### Complete export pipeline

```
┌─────────────────────────────────────────────────────┐
│  hyperframes_export_video tool (browser context)    │
├─────────────────────────────────────────────────────┤
│ 1. Read HTML from FS (documentFileSystem service)   │
│ 2. Inject HF runtime IIFE via loadHyperframeRuntimeSource() │
│    (ensures window.__hf is always available)        │
│ 3. Create blob: URL from the HTML string            │
│ 4. Mount hidden <hyperframes-player src=blobUrl>    │
│ 5. Wait for player 'ready' event → get duration     │
│ 6. Create OffscreenCanvas(width, height)            │
│ 7. Configure VideoEncoder (avc1, bitrate, fps)      │
│ 8. Configure Mp4Muxer (ArrayBufferTarget, fastStart)│
│                                                     │
│ Frame loop (i = 0 to totalFrames):                  │
│   a. player.seek(i / fps)                           │
│   b. await requestAnimationFrame (render settles)   │
│   c. ctx.drawImage(player.iframeElement, 0, 0)      │
│   d. new VideoFrame(canvas, { timestamp: i*1e6/fps })│
│   e. encoder.encode(frame, { keyFrame: i%30===0 })  │
│   f. frame.close()                                  │
│                                                     │
│ 9. await encoder.flush()                            │
│ 10. muxer.finalize()                                │
│ 11. Write MP4 bytes to FS via fs_write              │
│ 12. Revoke blob URL                                 │
└─────────────────────────────────────────────────────┘
```

### VideoEncoder configuration

```typescript
import type { Mp4Muxer } from "mp4-muxer";

const FPS = 30;
const KEYFRAME_INTERVAL = 30; // keyframe every second

const muxer = new Mp4Muxer({
  target: new ArrayBufferTarget(),
  video: { codec: "avc", width, height },
  fastStart: "in-memory",
});

const encoder = new VideoEncoder({
  output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
  error: (e) => { throw e; },
});

encoder.configure({
  codec: "avc1.42001f",      // H.264 Baseline Level 3.1
  width,
  height,
  bitrate: 5_000_000,        // 5 Mbps — good quality for 1920×1080
  bitrateMode: "constant",
  framerate: FPS,
});
```

### New tool file

```
src/services/flows/tools/hyperframes/
  hyperframes-export-video.ts    — hyperframes_export_video tool
```

**Tool contract:**
```typescript
// Input
{
  path: string,        // workspace path to composition HTML, e.g. /workspaces/proj/index.html
  output_path: string, // where to save the MP4, e.g. /workspaces/proj/output.mp4
  fps?: number,        // default: 30
  bitrate?: number,    // default: 5_000_000 (5 Mbps)
}

// Output (tool result string)
"Exported to /workspaces/proj/output.mp4 (duration: 15.0s, frames: 450, size: 3.2 MB)"
```

**Services needed:**
```typescript
type Services = Pick<AllServices, "documentFileSystem">;
```

The tool uses `documentFileSystem` to read the source HTML and write the output MP4 bytes.

### Feature step update for Phase 3

Add to `HYPERFRAMES_FEATURE_TOOLS`:
```typescript
"hyperframes_export_video",
```

Add a system prompt section:
```
## VIDEO EXPORT

Use `hyperframes_export_video` to render a composition to MP4 in the browser.
- Only do this when the user explicitly requests a video file
- Preview first with `render_memorall_artifact` — export is slow (real-time × frames)
- Output saves to the workspace filesystem
- Users can also run `npx hyperframes render index.html -o output.mp4` locally (faster, CLI)
```

### Known limitations of the browser export approach

| Limitation | Cause | Mitigation |
|---|---|---|
| No audio in MP4 | `drawImage` captures video only | Document this — audio requires separate pipeline |
| GPU shader transitions may differ | `seek()` is software-side; WebGL shaders run async | Add 2× `rAF` wait between seek and capture |
| Large compositions are slow | Frame-by-frame capture — 30s @ 30fps = 900 frames | Show progress; export in a Web Worker |
| `avc1` codec availability | Not guaranteed on all platforms (Linux) | Fallback to `vp8` / WebM |

### Fallback: MediaRecorder (real-time, simpler, Phase 3b)

If WebCodecs availability is a concern, implement a faster fallback:

```typescript
// Works on all modern browsers, outputs WebM
const stage = player.iframeElement.contentDocument.querySelector("#main");
const stream = (stage as HTMLElement & { captureStream(fps: number): MediaStream })
  .captureStream(fps);
const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
// Play composition → stop recorder → save blob
```

**Trade-off:** Real-time speed (a 60s video takes 60s to record), no determinism guarantee, outputs WebM not MP4. Good for quick exports; bad for production quality.

---

## Architecture Decision: Where Does Export Logic Live?

**Option A: Inside the tool executor** (simple, consistent with existing tools)
- Pro: follows the existing pattern — all logic in `toolRegistry`-registered executor
- Con: tool executors run in the extension's background/sidepanel context — DOM APIs available but need careful lifecycle management (creating/destroying iframes)

**Option B: New `VideoExportService`** (injectable, testable)
- Pro: separates concerns; service handles iframe lifecycle, encoder state
- Con: overkill for a single feature; adds a new service type the codebase doesn't have a pattern for yet

**Recommendation: Option A** for Phase 3. If video export grows (audio mixing, effects), extract to a service then. Follow the principle in the existing codebase — tools are self-contained executors.

---

## Complete File Structure (all phases)

```
src/services/flows/steps/features/hyperframes-feature/
  hyperframes-feature.ts        ✅ Phase 1 — step definition, system prompt
  index.ts                      ✅ Phase 1 — re-export

src/services/flows/tools/hyperframes/
  index.ts                      Phase 2 — re-export + side-effect registration
  hyperframes-scaffold.ts       Phase 2 — hyperframes_scaffold
  hyperframes-add-element.ts    Phase 2 — hyperframes_add_element
  hyperframes-update-element.ts Phase 2 — hyperframes_update_element
  hyperframes-remove-element.ts Phase 2 — hyperframes_remove_element
  hyperframes-validate.ts       Phase 2 — hyperframes_validate
  hyperframes-export-video.ts   Phase 3 — hyperframes_export_video
```

**Changes to existing files:**

| File | Change | Phase |
|---|---|---|
| [`features/index.ts`](../src/services/flows/steps/features/index.ts) | `import "./hyperframes-feature"` | ✅ 1 |
| [`hyperframes-feature.ts`](../src/services/flows/steps/features/hyperframes-feature/hyperframes-feature.ts) | Extend `HYPERFRAMES_FEATURE_TOOLS` array | 2, 3 |
| `src/services/flows/tools/index.ts` (if it exists) | Add `import "./hyperframes"` | 2 |

---

## Key Reference Files in This Codebase

| File | Why relevant |
|---|---|
| [`active-memory-feature.ts`](../src/services/flows/steps/features/active-memory-feature.ts) | Canonical feature step pattern with services injection |
| [`pdf-generate-feature.ts`](../src/services/flows/steps/features/pdf-generate-feature.ts) | Simplest feature pattern — tool name array, no services |
| [`render-memorall-artifact.ts`](../src/services/flows/tools/render-memorall-artifact.ts) | The preview tool we reuse — appends artifact + `appendAssistantOutputToState` |
| [`graph.base.ts:277`](../src/services/flows/graph/graph.base.ts#L277) | `addTool` — deduplicates by name |
| [`fs/fs-read.ts`](../src/services/flows/tools/fs/fs-read.ts) | Tool with `AllServices` injection — template for Phase 2/3 tools |
| [`features/index.ts`](../src/services/flows/steps/features/index.ts) | Where to add import for side-effect registration |

---

## External References

| Resource | URL |
|---|---|
| HyperFrames introduction | https://hyperframes.heygen.com/introduction |
| `@hyperframes/core` API | https://hyperframes.heygen.com/packages/core |
| `@hyperframes/engine` API | https://hyperframes.heygen.com/packages/engine |
| `@hyperframes/player` API | https://hyperframes.heygen.com/packages/player |
| Official Claude system prompt | https://raw.githubusercontent.com/heygen-com/hyperframes/main/docs/guides/claude-design-hyperframes.md |
| Agent skill (SKILL.md) | https://github.com/heygen-com/hyperframes/blob/main/skills/hyperframes/SKILL.md |
| `mp4-muxer` on GitHub | https://github.com/Vanilagy/mp4-muxer |
| WebCodecs canvas → MP4 guide | https://devtails.xyz/adam/how-to-save-html-canvas-to-mp4-using-web-codecs-api |
| MDN WebCodecs API | https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API |
| FFmpeg.wasm (fallback only) | https://ffmpegwasm.netlify.app/ |
