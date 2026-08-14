# Dependency upgrade implementation status

This branch implements the staged dependency upgrade, clean-install validation,
and packaged Web, Extension, and Windows desktop acceptance. Native macOS arm64
and Linux x64 acceptance remains assigned to the blocking host-specific CI
matrix because those binaries cannot be built faithfully on Windows.

## Runtime and repository guardrails

- Node is constrained to the latest selected Node 22 line (`>=22.23.1 <23`) in
  the root and desktop sidecar, with `.nvmrc` and `.node-version` set to
  `22.23.1`.
- Yarn is pinned to `4.18.0`.
- Rust is pinned to `1.97.1` in `rust-toolchain.toml`.
- Node types remain on the Node 22 contract (`@types/node 22.20.1`).
- TypeScript 7.0.2 is the native application compiler. The named TypeScript 6
  compatibility alias remains available to compiler-API consumers and all
  harness workspaces use the same declaration.
- `tools/check-dependency-cohorts.mjs` rejects drift across Univer, TipTap,
  HyperFrames, Tauri CLI, React, Node, and TypeScript declarations.
- The working branch uses the conventional
  `chore/upgrade-web-extension-desktop-dependencies` name. Husky validates
  every new or updated local branch against the repository's conventional
  type and lowercase kebab-case standard in Git's prepared reference
  transaction. Pre-commit, pre-push, the aggregate repository check, and CI
  validate the checked-out branch too.
- Legacy PGlite and IndexedDB fixtures cover documents, topics,
  conversations, graph data, settings, jobs, close/reopen, and idempotent
  migrations without clearing user data.

## Patch lifecycle outcome

`tools/check-patch-package.mjs` and `patches/patch-targets.json` require every
patch filename/version, installed package, lockfile resolution, diff target,
and documented intent to agree. Its focused suite covers scoped, nested,
ordered, stale, missing, orphaned, and mismatched patches.

The active patch inventory is:

- `@electric-sql+pglite+0.4.6.patch`
- `@hyperframes+core+0.7.108.patch`
- `@hyperframes+lint+0.7.108.patch`
- `@hyperframes+studio-server+0.7.108.patch`
- `extension-develop+4.0.32.patch`
- `jspdf+4.2.1.patch`
- `util+0.12.5.patch`

The obsolete HyperFrames 0.6.33 and Extension.js 3.16.1 patches were removed.
The new patches were reverse-apply checked against the installed upgraded
packages; the Extension.js and PGlite patches were also generated and checked
against clean package contents before activation. Normal installation now
runs `patch-package --error-on-fail` explicitly. The PGlite patch replaces
four Node-only `process.exitCode` accesses in the consumed browser ESM bundle
with guarded `globalThis.process` access; its focused source and artifact scan
prevents the unsafe form from returning.

The jsPDF and `util` package versions have not changed and upstream still
contains the patched behavior. Their exact pins and regression requirements
remain. The 52.5 MB jsPDF patch includes source-map churn and is retained as
known debt rather than being silently regenerated during an unrelated cohort;
a later lean-patch change must prove Web, Extension, and Desktop PDF behavior
and scan built artifacts for the removed remote PDFObject URL.
`tools/check-patched-dependencies.mjs` now performs that regression work for
the retained patch too: it generates a PDF byte stream, checks both consumed
jsPDF entrypoints for the local fallback and absence of the remote CDN URL,
checks the patched `util` entry for an inert debug value, and scans every built
Web/Extension/Desktop JavaScript artifact for either forbidden expression.

## Implemented package cohorts

- Build/test: Vite 8.2.1, Vitest/coverage 4.1.10, jsdom 30.0.1, Biome 2.5.8,
  and aligned build utilities.
- UI: React/ReactDOM 19.2.8, React Router 7.18.2, Zustand 5.0.15, current
  Radix packages, i18n, icons, and motion packages.
- Styling: Tailwind 4.3.3 with the PostCSS plugin migration and font imports
  moved to the application bootstrap.
- Editors/renderers: TipTap 3.30.1 aligned exactly, Shiki 4.4.3, Mermaid
  11.16.1, Recharts 3.10.1, PDF.js 6.2.108, Three 0.185.1, and related media
  packages. Three's removed UMD build is replaced by a packaged ESM runtime
  while retaining the composition-facing `window.THREE` API.
- Agent/provider: aligned LangChain/LangGraph/MCP/Zod declarations, AI SDK 6,
  and OpenAI 7.4.0, with Agent Harness package/consumer gates preserved.
- Storage/local models: PGlite 0.4.6 (the newest storage-compatible patch;
  0.5.x requires an explicit dump/restore migration) with its bundled vector
  extension,
  Wllama 3.5.1, WebLLM 0.2.84, Transformers 4.2.0, and aligned ZenFS peers.
- HyperFrames: core/lint/player/shader/studio-server 0.7.108, async lint
  migration, local GSAP/CustomEase/MotionPath assets, and exact-count player
  localization/sandbox rewrites.
- Extension: Extension.js 4.0.32, its v4 configuration hook, and a minimal
  no-reload patch that gates only the four remaining HMR/reload injection
  paths. Source, config, and staged-artifact scanners are part of the gate.
- Univer: all 13 direct packages exactly aligned at 0.25.1 with RxJS 7.8.2.
  The viewer uses namespaced locales, supported read-only UI and workbook
  permissions, cancellation-safe cleanup, and a typed SheetJS adapter for
  strings, numbers, booleans, zero, Unicode, cached formula values, multiple
  sheets, and merged ranges.
- SheetJS: Community Edition 0.20.3 is vendored as an exact local tarball,
  with its upstream URL and SHA-256 recorded in `vendor/README.md`. Spreadsheet
  adapter tests cover booleans, zero, Unicode, formulas, merged ranges, and
  multiple sheets without a live supply-chain fetch during installation.
- Desktop: both Tauri CLI declarations are exactly 2.11.4. Rust direct crates
  are exactly tauri 2.11.5, tauri-build 2.6.3, dialog 2.7.2, notification
  2.3.3, and shell 2.3.5. Cargo.lock already contained those versions, so no
  transitive churn was required. CSP, capabilities, feature sets, and
  least-privilege permissions were not broadened.

## Final validation outcome

- Clean install: Node 22.23.1 and Yarn 4.18.0 completed `yarn install
  --immutable`; all 7 patches applied normally. A second `postinstall`
  reproduced all 113 generated files under `public/` and `runner/`
  byte-for-byte.
- Repository gates: patch inventory 7/7, patch tests 8/8, PGlite browser guard
  3/3, Extension.js no-reload checks 12/12, platform boundaries across 1,460
  files, lint across 1,235 files, and the full unit suite at 115 files / 564
  tests all passed.
- Compiler and harness: native TypeScript 7 and legacy TypeScript 6 checks,
  sidecar typecheck, all nine Agent Harness package builds/tests/packs, and a
  fresh Node/browser/worker/service-worker consumer all passed. Sidecar tests
  passed at 2 files / 4 tests.
- Storage: the physical PGlite 0.4.5 to 0.4.6 persisted-directory fixture,
  current migrations, idempotent reopen, and IndexedDB job-store fixture passed
  at 4 files / 5 tests. The browser-process regression guard passed 3/3.
- Web: production build, Pages-path asset checks, every shared route, hash
  reload, console/network checks, bundle scan, and non-publishing GitHub Pages
  dry run passed. A separate production-artifact gate downloaded and selected
  the same Wllama CPU/WASM model used by the packaged products, submitted a
  request through the real Chat composer, and required a completed non-error
  assistant response. The bundle ratchet remains 2/2 application and 16/16
  reused static references.
- Extension: Extension.js 4 development and packaged Chrome/Edge builds passed
  MV3 and remote-code audits. Each artifact passed 5/5 Playwright tests covering
  content-script injection/capture, service-worker APIs, context menus,
  notifications, offscreen startup, extension-storage persistence, options UI
  startup, and every provider tab. The deterministic sandbox suite passed 8/8
  and its unit suites passed 9 files / 59 tests. A separate packaged-Chrome
  real-runtime gate downloaded and selected the 263 MB LFM2 VL 450M GGUF model,
  ran it through Wllama's CPU/WASM worker, and submitted through the actual
  Chat composer. The hardened gate now uses two fresh extension profiles,
  requires the offscreen Wllama service to report registered and ready, and
  requires two completed non-error assistant responses. Both fresh-profile
  runs passed. This slower gate is blocking in the Extension CI job and does
  not use a mocked provider.
- Desktop: the frontend and Node 22 sidecar passed their checks. A native
  Windows x64 Tauri build produced the standalone GUI executable, MSI, and
  NSIS installer; artifact validation confirmed the packaged sidecar is exactly
  Node 22.23.1. The packaged WebView connected over its loopback CDP endpoint,
  rendered a non-empty CSP-clean Memorall onboarding UI, survived the process
  smoke interval, and was also inspected visually. The pinned-runtime package
  was then launched again, loaded the selected Wllama GGUF model, submitted
  through the real Chat composer, and rendered a completed non-error assistant
  response before the process-liveness check. The desktop bundle ratchet remains
  2/2 application and 16/16 reused static references.
- Dependency hygiene: constraints pass, `yarn dedupe --check` reports no
  candidates, both Tauri CLI declarations resolve to 2.11.4, and all 831 peer
  requirements are satisfied. Audit findings fell from 190 (3 critical) to 17:
  0 critical, 6 high, 9 moderate, and 2 low.

The only Extension.js compiler runtime-risk diagnostic left is HyperFrames'
optional `fetch("caption-overrides.json")`. The runtime deliberately catches an
absent file and only applies the result when it is a non-empty array, so an
unrelated dummy asset is not shipped merely to silence static analysis.
Existing performance-budget warnings for the on-demand model, sandbox, and UI
bundles remain visible and are not reclassified as dependency regressions.

## Remaining native-host and upstream work

- This Windows host cannot prove native macOS arm64 or Linux x64 packaging.
  `.github/workflows/platform-products.yml` now runs those native, non-publishing
  blocking jobs along with Windows x64. Firefox and secondary architectures are
  workflow-dispatch, non-blocking checks.
- PGlite 0.5.5 is deliberately blocked because it cannot open a persisted 0.4.5
  database. `pglite-0.5-blocker.md` records the reproduction, upstream upgrade
  contract, affected feature, retained 0.4.6 release, patch, and regression
  fixture. Moving to 0.5 requires an atomic old-runtime dump/new-runtime restore
  migration; clearing user data is not acceptable.
- The 52.5 MB jsPDF 4.2.1 patch remains review debt because the applicable
  upstream release did not change. A separate lean-patch change must retain the
  Web/Extension/Desktop PDF smoke and built-artifact remote-code scan.
- The 17 remaining audit records are transitive and have no newer compatible
  direct release in this upgrade: the six high findings arrive through
  `onnxruntime-node`/`adm-zip`, Extension.js tooling/`extract-zip`,
  Less/`image-size` (two records), Transformers/`sharp`, and
  AlmostNode/Vite. They remain visible in CI and must be reevaluated when those
  parent packages publish fixes.
- The sandbox React aliases and the TypeScript 6 compatibility alias are
  intentional isolated-runtime contracts, not dedupe candidates.
