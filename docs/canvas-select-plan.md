# Canvas select — implementation plan

A second selection mode alongside smart select: drag a rectangle anywhere on the
page and attach what is inside it as an image. Unlike smart select it snaps to
nothing — no element, no DOM node, no bounding box. Whatever the user can see
between `(x1, y1)` and `(x2, y2)` is what gets captured.

## Why this is mostly assembly, not new machinery

Three of the four pieces already exist and are already correct.

| Piece | Where | State |
| --- | --- | --- |
| Free rectangle drag + crop | `src/embedded/components/ImageSelectorOverlay.tsx` | Built. Drags a rect over a full-page canvas, crops it, emits a base64 PNG. |
| Honest capture | `src/embedded/utils/capture-region.ts` | Built. `captureViewport()` + `cropCapture()` on top of `chrome.tabs.captureVisibleTab`. |
| Attach as an image | `selected_image` kind in `src/embedded/context-items.ts` | Built. Emits an `image_url` content part; the label reads "Selected Region". |
| Reachable as a mode | — | **Missing.** `ImageSelectorOverlay` is only invoked from the `SHOW_IMAGE_SELECTOR` context-menu entry. |

So the work is: give it a peer entry point next to smart select, and make its
lifecycle behave like smart select's.

### Why not html2canvas

It was measured against a page whose image is served from another origin with no
CORS header — every map tile, most CDN images:

| tile serves CORS? | browser shows it | html2canvas result | refetches |
| --- | --- | --- | --- |
| **no** (the normal case) | yes | **white — silently missing** | 2× per image |
| yes | yes | rendered | 2× per image |

No error, no taint, just a blank rectangle where the content was. `captureVisibleTab`
returns what the compositor already painted, at zero extra requests, and was
measured capturing the same cross-origin tile correctly. This is settled; the
plan uses `capture-region.ts` throughout and html2canvas gets deleted from this
path.

## Plan

### 1. Make the overlay a mode, not a one-shot

`ImageSelectorOverlay` is mounted by the context-menu handler and unmounted when
it resolves. Smart select has a factory (`createSmartSelectOverlay`) that returns
a teardown and tracks the live instance in a module-level `activeOverlayCleanup`.

Give the region selector the same shape — `createCanvasSelectOverlay(onSelect, onCancel)`
returning a cleanup — so the two modes are mutually exclusive by construction:
opening one tears down the other, exactly as two `createSmartSelectOverlay` calls
already do.

### 2. Entry points

- **Dock button** in `CoAgentDock`, beside the existing smart-select control,
  with the same toggle semantics: a second click puts it away, `aria-pressed`
  and the filled style show it is on. (Smart select needed that fixed; do not
  reintroduce the bug here.)
- **Context menu** keeps working unchanged.

Both route through the same factory so the mode can only be open once.

### 3. Capture path

Replace the overlay's html2canvas call with `captureViewport()`, then
`cropCapture(dataUrl, rect)` with the dragged rectangle in CSS pixels.

Two details that are easy to get wrong and are already handled in
`capture-region.ts`:

- **Scale from the image, not `devicePixelRatio`.** A capture of an 800 px
  viewport comes back 1600 px wide on a 2× display, and `devicePixelRatio`
  disagrees with reality the moment the page is zoomed or the window moves
  between monitors. `computeCropBox` takes the ratio from the capture itself.
- **Hide the overlay before capturing.** The selection chrome is part of the
  page; `captureElementRegion` already does this via its `hide` option and the
  region selector needs the same, or the user gets a picture of the selection
  rectangle.

### 4. Permission

`captureVisibleTab` needs `activeTab`, granted when the user starts Memorall
from the context menu and held for that tab until it navigates. That covers both
entry points today, and needs **no manifest change** — `<all_urls>` would widen
the store listing.

Two consequences to handle rather than discover:

- The grant dies on navigation while the co-agent survives it, so capture can
  start failing mid-session. `RegionCaptureError.needsActivation` already
  distinguishes this; the overlay should show the "open Memorall from the
  right-click menu first" message rather than a blank result.
- Do not fall back to html2canvas on permission failure. A blank image that
  looks like a capture is worse than an error.

### 5. Attach

Reuse the `selected_image` kind — no new context kind, no new message plumbing.
Give it a label that says what it is (`Region: 420×260`) so an attachment list
carrying both modes is readable.

## What is explicitly out of scope

- **Scrolling capture.** Only the viewport can be captured. A drag that would
  extend past the fold is clamped; stitching multiple captures is a separate
  piece of work with its own failure modes (sticky headers duplicating, lazy
  content shifting mid-scroll).
- **Annotation.** No arrows, no highlighting. Crop and attach.
- **Re-editing a previous selection.** Each capture is a fresh drag.

## Risks

| Risk | Handling |
| --- | --- |
| `activeTab` missing (dock button after navigation) | Detected via `needsActivation`; show the context-menu route. Never silently degrade. |
| Very large selections | Cap the encoded PNG the same way `web_read_images` caps at 4 MB per image; base64 inflates by a third and the attachment stays in the transcript for the whole run. |
| Fixed/sticky elements over the region | Inherent to capturing what is painted. This is correct behaviour — it is what the user sees. |
| Two overlays open at once | Prevented by sharing the single-active-overlay factory. |

## Testing

- `computeCropBox` is pure and already covered; extend for the drag-direction
  cases — right-to-left and bottom-to-top drags must normalise, so `(x2, y2)`
  above and left of `(x1, y1)` yields the same rectangle.
- Overlay lifecycle: opening canvas select closes smart select and vice versa;
  a second click closes; unmount tears down.
- Permission failure surfaces `needsActivation` rather than an empty image.
- A real-browser probe of the whole path, as used for `capture-region`: a page
  with a cross-origin image, assert the captured pixels contain it and that no
  extra network requests were made.
