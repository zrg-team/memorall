# HyperFrames video

Agents make videos as **HyperFrames compositions**: an HTML page with a paused
GSAP timeline, played and exported to MP4 in the browser. This page covers how
the pieces fit, the license position, and how to verify changes.

- Upstream: <https://github.com/heygen-com/hyperframes> (`@hyperframes/*` 0.8.164)
- Agent feature: `hyperframes-feature` (wizard template "Video creator")
- Where users see videos: the chat preview, the Runtime panel, and the MemonOS
  **Video** app

## Flow

```
agent ── hyperframes_init ──▶ /projects/<slug>/index.html  (scaffold returned)
      ── hyperframes_write / _edit ──▶ index.html  (validation report returned)
      ── hyperframes_show ──▶ validates, then puts a project reference in chat
chat  ── HyperframesArtifact ──▶ reads index.html from Files ──▶ HyperframesPlayer
                                                              └▶ sandbox page (runner)
user  ── Export MP4 ──▶ runner captures frames ──▶ MP4 ──▶ /projects/<slug>/renders/<slug>.mp4
```

### Agent tools (`src/services/flows-integrations/tools/hyperframes/`)

| Tool | Notes |
|---|---|
| `hyperframes_init` | Writes a template and **returns it**, so the next call is the write that fills it. `frame_preset` and `design_path` add a design spec (below). |
| `hyperframes_write`, `hyperframes_edit` | Save `index.html` and **return the lint report**: no separate validate round trip. `file: "frame.md" \| "design.md"` saves the spec instead. |
| `hyperframes_show` | Lints first and **refuses on errors** (`force` overrides a false positive); otherwise appends a reference artifact. |
| `hyperframes_read` | `file` picks the composition (default) or a spec; reading the composition names the project's spec. |
| `hyperframes_validate`, `_list` | Unchanged roles. Validation also checks the composition against the spec. |
| `hyperframes_remote_assets_explore`, `_remote_asset_import` | Remote images into `{project}/resources/`. |

A typical new video is `init → write → show`: three model turns instead of five.

### Design specs: design.md describes the brand, frame.md directs the composition

This follows HyperFrames' design-spec contract (`skills/hyperframes-creative`,
<https://www.hyperframes.dev/design>). A project may carry a spec next to its
`index.html`. The first one found wins: `frame.md` → `design.md` →
`DESIGN.md`. Its YAML frontmatter (`colors`, `typography`, `spacing`,
`rounded`, `components`) is normative. The prose is context. It governs brand,
not layout.

- **Presets.** The 13 upstream frame presets (biennale-yellow, blockframe,
  blue-professional, bold-poster, broadside, capsule, cartesian, cobalt-grid,
  code-editorial, coral, creative-mode, daisy-days, editorial-forest) ship
  verbatim in `frame-presets.generated.ts`, pinned to an upstream commit.
  `hyperframes_init { frame_preset }` saves one as the project's `frame.md`.
  The tool description gives each preset's look and when to pick it.
- **The user's spec.** `hyperframes_init { design_path }` copies a design.md /
  DESIGN.md / frame.md from Files into the project. With a preset too, the
  preset becomes `frame.md` and the user's file becomes `design.md`. The agent
  is told to move the brand's colors and fonts into frame.md.
- **Theming.** `frame-presets.ts` parses the frontmatter (tolerating `key:{`
  without a space, which several presets use). It derives color roles (named
  roles first, then luminance and saturation) and font roles: display is the
  family of the largest type token. It replaces the scaffold's `:root` with
  `--bg`, `--ink`, `--accent`, `--accent2`, `--muted`, `--font-display`,
  `--font-body`, `--font-data` and `--c-<name>` for every spec color. With a
  spec and no template, the scaffold is `scaffold-launch-teaser`.
- **Adherence.** Validation warns on hex colors outside the spec palette
  (`off_palette_color`; scripts excluded) and fonts outside its typography
  (`off_spec_font`).

Update the presets with `node tools/sync-hyperframes-frame-presets.mjs <commit>`.
Then review the diff and run the tool tests.

### Reference artifacts (`reference.ts`)

`hyperframes_show` used to paste the whole composition into the assistant
message. That HTML was saved with the message and re-sent to the model on every
later turn, and its scripts could trip the OpenUI splitter. Now the artifact
body is a small JSON pointer:

```html
<artifact type="application/hyperframes" project-path="/projects/launch" …>
{"kind":"hyperframes-project","path":"/projects/launch","revision":"…","width":1920,"height":1080,"duration":18}
</artifact>
```

The chat reads `{path}/index.html` from Files when it shows the preview and
follows the project while it changes (an agent's edit shows without another
`show`). Saves into `renders/` are ignored, so an export does not restart it.
Messages with inline HTML (older ones, `render_artifact`) still render.

### Preview (`src/main/modules/chat/components/artifacts/hyperframes/`)

- `HyperframesPlayer`: the `<hyperframes-player>` element, the postMessage
  protocol with the sandbox page, export settings/progress/cancel, runtime
  issues. Used by the chat artifact and the MemonOS Video window.
- `use-hyperframes-composition`: resolves reference vs inline HTML, normalizes
  (local images → data URLs, bundled fonts), caches the last few, and reloads
  on project changes.
- `HyperframesArtifact`: mounts only near the viewport and pauses off screen,
  so long conversations do not run every video at once.

**The preview page must be a manifest sandbox page.**
`sandbox/pages/hyperframes-preview.html` is listed in `manifest.base.json`
(index 2, before the container runtime, which must stay last) and opened
through `platform.assets.sandboxPageUrl(…, HYPERFRAMES_PREVIEW_PAGE_INDEX)`.
An unlisted copy is an ordinary extension page whose CSP blocks the
composition's inline timeline, so the video never moves. That was the state
before this change; `html-artifact-page.logic.test.ts` now guards it.

### Runner (`runner/js/hyperframes-preview.js`, copied to `public/sandbox/pages/`)

It runs in a manifest sandbox page, which has an opaque origin. That
shapes four things:

- **A module script.** The extension build minifies classic page scripts into
  top-level `let` bindings (`let c`, plus the CommonJS shim's `let e`), which
  share the global scope with the composition's scripts: a template's
  `var c = {v:0}` threw `Identifier 'c' has already been declared` and no
  timeline ran. As `type="module"` nothing leaks. Harnesses use
  `window.__hyperframesRunner`.
- **Frames that never stall.** The player keeps its iframe at 0×0 (behind its
  loading card) until the composition is ready, and Chrome pauses animation
  frames in an invisible cross-origin iframe, while HyperShader's transition
  sampling and the runtime wait on frames to get ready. The runner wraps
  `requestAnimationFrame`: a callback runs on the next frame or after 100 ms,
  whichever comes first.
- **No IndexedDB.** `indexedDB.open` throws there; HyperShader then failed
  every transition capture. The runner hides `indexedDB` so HyperShader takes
  its no-cache path.
- **No html2canvas iframe clones.** A cloned iframe gets an origin of its own.
  `tools/copy-bundled-assets.mjs` adds a hook to HyperShader's scene capture
  (exact-count anchor), and the runner supplies a DOM→SVG capture there. Its
  scene samples are JPEG (quality 0.94): PNG encoding took ~235 ms a sample.
  The export also waits up to 3 s once per transition window for the
  transition's textures to upload, so the first frames of a transition do not
  show the scene underneath.

Three more rules came out of end-to-end exports in the built extension:

- **One composition per page.** The page pings "ready" every 100 ms until a
  composition arrives, and the host answers every ping. A large composition
  (300 KB of embedded fonts) took long enough that copies arrived while the
  first one rendered. Rendering again ran the composition's script a second
  time on the live page. Its `from()` tweens then recorded whatever the first
  timeline had left on screen, and HyperShader sampling had moved that
  timeline to ~12 s, so every title after that point stayed invisible: in
  the preview and in the MP4, in 2 of 4 runs. The page now renders the first
  composition only. A new composition always comes with a new key and page.
- **The composition owns the page background.** The loading page's inline
  `background:#000` on `html`/`body` used to beat the composition's
  `html,body{background:var(--bg)}`. Every scaffold, and any composition that
  puts its fill on the page, previewed and exported black. The defaults now
  sit in a zero-specificity `:where(html,body)` sheet, and the export viewport
  no longer sets a background. `yarn qa:hyperframes-export` asserts that the
  fixture's page background survives.
- **One `HyperShader.init()` per composition.** Calls share one `#gl-canvas`
  and one state entry keyed by composition id, so only the last call's
  transitions drew. The scaffolds used to call it once per shader moment; they
  now make one call over consecutive scenes. Validation reports
  `multiple_hypershader_init` as an error.

Reproduce all of this without a build by serving the runner with
`Content-Security-Policy: sandbox allow-scripts` (and CORS headers for its
module imports).

- **Tailwind v4.** The browser compiler reads `<style type="text/tailwindcss">`,
  not a `window.tailwind.config` object (Tailwind v3). The runner injects
  `@import "tailwindcss"` plus an `@theme inline` block for the `hf-*`
  utilities (`bg-hf-bg`, `text-hf-ink`, `font-hf-display`, …). Preflight stays
  on, as every existing composition was laid out with it.
- **Runtimes** load in parallel and run in order (`async = false`); `import()`
  calls carry `webpackIgnore` so the extension bundler leaves them alone.
- **Export capture.** Each frame serializes the live DOM into an SVG
  `foreignObject` image (data URL; a blob URL taints the canvas). Canvases and
  video frames are embedded as images, so Three.js and D3-canvas scenes appear
  in the MP4; html2canvas's foreignObject mode dropped them. A full-frame
  canvas on top (HyperShader's transition canvas) is drawn straight onto the
  frame instead. html2canvas is the fallback when DOM capture throws.
- **Readiness.** Export waits for the runtime (`__hfTimelinesBuilding`,
  `__hfStartupError`), then for HyperShader to finish sampling transitions
  (`window.__hf.shaderTransitions[*].ready`), and per frame for
  `__hfWaitForSeekCompletion`. Seeks use `renderSeek(t, { exact: true })`;
  without `exact` the runtime snaps to a 30 fps grid. Frame waits fall back to
  a timer, so an export keeps going in a background tab.
- Mediabunny encodes H.264 MP4 (24–60 fps; standard/high/max capture scale;
  native–2160p).

Measured on the neon-launch template (1920×1080, 18 s), headless Chromium,
standard quality:

| | Before | After |
|---|---|---|
| Normal scenes | ~203 ms/frame | ~28–41 ms/frame |
| Shader transition | ~272 ms/frame | ~89 ms/frame |
| Three.js scene | 143 ms/frame, scene missing | 36 ms/frame, matches the live view |

In the built extension, a 25 s 1920×1080 composition at 30 fps, themed by the
biennale-yellow preset (three catalog families, 18 faces), exports in 13–15 s
with the player on screen. neon-launch (18 s) exports in ~12 s. While the
player is off screen, or its tab is hidden, Chrome stops animation frames in
the sandbox iframe. Each frame then waits for the 50 ms fallback, so the same
export takes ~55 s. It still completes.

### Fonts

HyperFrames 0.8 bundles 18 families (Inter, Montserrat, Oswald, League Gothic,
Archivo Black, Playfair Display, EB Garamond, Space Mono, IBM Plex Mono,
JetBrains Mono, Source Code Pro, Roboto, Open Sans, Lato, Poppins, Nunito,
Outfit, Noto Sans JP) and maps common names onto them (Helvetica, Arial, SF Pro,
Segoe UI, …). `fonts.ts` finds the families a composition names (including
through `--font-*` custom properties) and prepends `@font-face` rules with the
embedded woff2 data URLs (`@hyperframes/core/fonts/embedded-data`, loaded
lazily). Previews and exports therefore render the same typography on every
machine. Other families fall back, and validation warns.

The design presets use 15 more families: Archivo, Barlow, Bebas Neue, Bodoni
Moda, DM Mono, Fredoka, Fredoka One, Hanken Grotesk, Instrument Serif, Libre
Baskerville, Newsreader, Quicksand, Shrikhand, Source Serif 4, Space Grotesk.
`font-catalog.json` lists their `@fontsource` packages and weights. Step 6b of
`tools/copy-bundled-assets.mjs` copies their latin, latin-ext and vietnamese
woff2 files to `public/vendors/hyperframes/fonts/` with a `manifest.json`
(119 files, ~1.8 MB; git-ignored, rebuilt by the asset step). The preview
fetches only the faces a composition names and embeds them as data URLs with
their `unicode-range`. Add a family by adding its `@fontsource` package to
`package.json` and an entry to `font-catalog.json`.

### Authoring model (0.8)

The runtime shows each clip (any element with `data-start`) only within its
`data-start … data-start + data-duration` window. Compositions must not toggle
scene visibility from the script; upstream lint now reports
`gsap_animates_clip_element`. We downgrade that finding to a warning, because
older projects written with toggles render identically (checked frame by frame).

The root `data-duration` is the video length, not the timeline's. The runner
reads it before the timeline's own duration, which counts only when the root
declares none. The init templates still end with `tl.set({}, {}, DURATION)`.

The system prompt follows the upstream skills at the preset commit (core,
creative). Its rules include:

- No CSS initial `transform` on a property GSAP also tweens.
- No `crossorigin` on media.
- `<audio>` needs an `id`.
- Finite repeats use `floor`, not `ceil`.
- No `<br>` in body text.
- Transformed elements must be block-level and sized.

We keep banning `repeat: -1`, which upstream allows under a finite root
duration.

## MemonOS Video app

`src/services/memon/apps/video/` (machine) and
`src/main/components/molecules/MemonComputer/windows/VideoWindow.tsx` (window).

- Built in, needs Files; in the dock's Create group.
- Lists HyperFrames projects in `/projects`, `~/projects` and `~` with size,
  length and renders; opens one in the full-size player, with its renders below
  (play, download). Video files play natively.
- Export saves to `{project}/renders/{name}.mp4` and logs the change for the
  agent.
- A HyperFrames `index.html` the user double-clicks in Files opens here; the
  agent's open and "open as text" still use the Editor.
- Agent: `memon_open { app: "video", path }`, and `exportMp4: true` to render.
  The export runs in the window's player, so it needs the computer open on
  screen. If no window starts it within 30 s, the call fails with that reason.
- Player and export only: no visual timeline editing (see GSAP below).

## Licenses

| Component | License | Use here |
|---|---|---|
| `@hyperframes/*` (core, lint, parsers, player, shader-transitions; studio-server via core) | Apache-2.0 (© 2026 HeyGen; the shader package README says MIT, its LICENSE file is Apache-2.0) | Bundled and patched. Compatible with Memorall's MIT license. Keep the license with the files (`public/vendors/hyperframes/LICENSE-hyperframes.txt`); modifications are documented by `patches/*.patch` and the localization step in `tools/copy-bundled-assets.mjs`. No per-render fees or commercial thresholds. Do not use HeyGen/HyperFrames marks to brand the product. |
| GSAP 3.15 (+ CustomEase, MotionPathPlugin) | GSAP "Standard no-charge" license (Webflow) | Commercial use is allowed, AI-generated code is not a prohibited use, no attribution is required, and notices must stay in the files. **Not allowed:** using GSAP in a no-code *visual animation builder* that competes with Webflow. The Video app and previews play and export agent-written code; do not add drag-and-drop timeline or keyframe editing on top of GSAP without checking the license first. |
| Mediabunny | MPL-2.0 | Shipped unmodified; MPL is file-level, so changes to its files would have to be published. |
| html2canvas | MIT | Export fallback; also inlined in shader-transitions. |
| Three.js (MIT), D3 (ISC), Lucide (ISC), Tailwind CSS (MIT) | Permissive | Packaged runtimes. |
| Bundled fonts (HyperFrames' embedded set, and the preset families via `@fontsource`) | SIL OFL 1.1 / Apache-2.0 | Embedding in videos is allowed. |
| Frame presets (`FRAME.md` files from the HyperFrames repo's `skills/`) | Apache-2.0 (repository license) | Shipped verbatim with an attribution header naming the source commit. |

## Upgrading

1. Bump `@hyperframes/{core,lint,parsers,player,shader-transitions}` together
   (`yarn check:dependencies` enforces one exact version).
2. Re-check the core (`dist/gsapCdn.js`) and lint fix-hint patches; create
   patches with the scratch-repo diff method (patch-package cannot create them
   under Yarn 4).
3. `node tools/copy-bundled-assets.mjs` checks the player's localization
   anchors (one runtime CDN literal, one probe `start()`, one `_loadSrc`); it
   throws when upstream changes them.
4. Re-sync the frame presets (`node tools/sync-hyperframes-frame-presets.mjs
   <commit>`) and compare the system prompt with the upstream `hyperframes-core`
   and `hyperframes-creative` skills at that commit.
5. Run `yarn vitest run src/services/flows-integrations/__tests__/hyperframes-tools.test.ts`
   (every template must lint without errors) and `yarn qa:hyperframes-export`.

## Verifying

- `yarn qa:hyperframes-export`: exports a fixture through the runner and
  compares MP4 frames with screenshots.
- Unit tests: `hyperframes-tools.test.ts`, `artifacts/hyperframes/__tests__`,
  `memon/apps/video/__tests__`, `MemonComputer/__tests__/VideoWindow.test.tsx`,
  and the Video cases in `memon-machine.logic.test.ts`.
- In the built extension, a composition's inline timeline must run in
  `sandbox/page-2.html`; the console shows a CSP error if the page is not a
  sandbox page. `window.__hf.shaderTransitions.main.ready` must turn true
  within seconds of loading; stuck at `phase: "capturing"` means frames or
  capture are blocked.
- `yarn qa:hyperframes-export` serves the runner as an ordinary page, so it
  cannot see sandbox-only failures. For those, serve the runner with
  `Content-Security-Policy: sandbox allow-scripts` inside a 0×0 iframe from
  another origin (`localhost` host page, `127.0.0.1` runner).
- Desktop (Tauri) serves pages with `script-src 'self' 'wasm-unsafe-eval'`,
  which also blocks inline scripts. HTML artifacts and HyperFrames previews
  need checking there; it has not been verified here.
