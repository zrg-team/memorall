# Memorall desktop shell

This directory is intentionally a thin shell around the shared application in
`src/main` and shared services in `src/services`.

Development frontend:

```sh
yarn dev:desktop:frontend
```

Native development app on the current operating system:

```sh
yarn dev:desktop
```

Frontend production artifact:

```sh
yarn build:desktop:frontend
```

Build and open-smoke the native app on the current operating system:

```sh
yarn build:desktop:windows # Windows host
yarn build:desktop:macos   # macOS host
yarn build:desktop:linux   # Linux host
yarn test:e2e:desktop      # build and open-smoke the current host
yarn test:e2e:desktop:built # open-smoke an existing build
```

Tauri packages depend on the host SDK and must be produced on their native OS.
The target-specific commands fail early on the wrong OS instead of presenting a
frontend-only build as a native package. `yarn test:e2e:desktop` builds the native
target for the current host, starts the executable, verifies it remains alive,
and terminates only that test process.

On Windows, the build produces the standalone executable plus MSI and NSIS
installers under `../../publish/desktop/windows/`. macOS and Linux use sibling
platform directories. Cargo intermediates stay under `../../publish/.cache/tauri/`.
The native smoke test verifies process health; release acceptance should
additionally inspect the real window on each host OS.

The local build command stages the real Node executable running Yarn at
`../../publish/.cache/tauri-sidecars/memorall-node-<target-triple>[.exe]`.
Release packaging must replace that development convenience with a pinned Node
22 distribution paired with npm; do not replace it with a single-file
JavaScript wrapper.

Desktop preparation compiles the Node sidecar to one production ESM artifact and
stages a checksum-pinned browser runtime in
`../../publish/.cache/tauri-resources/browser-runtime/`. Every installer carries
one full Chromium renderer, the BrowserOS MCP server, and Lightpanda where that
project publishes a native binary. There is no first-use browser download and no
inspection of installed Chrome, Edge, extensions, or user profiles. The full
renderer deliberately increases installer size.

Automation is routed by capability: direct HTTP handles static reads,
Lightpanda handles fast JavaScript rendering where available, BrowserOS supplies
agent-oriented browser tools on its compatible distribution, and standards-based
Chrome DevTools Protocol is the full fallback. The public web-tool contract and
numeric session handles remain stable across lanes. The router is intended to
improve compatibility and recovery; it does not spoof identity or promise to
defeat site access controls. A visible managed-browser setting supports legitimate
human verification and then pauses automation until the user resumes it.

The managed browser is headless and uses a temporary, isolated profile by
default. Runtime → Desktop Browser can restart it visibly, opt into one
Memorall-owned persistent profile, or clear that profile. Visibility and profile
changes close active browser sessions. Browser readiness and failures are based
on native runtime health rather than a static download prompt.

The implementation follows the official [Tauri sidecar/resource
model](https://v2.tauri.app/develop/sidecar/), the [Chrome DevTools
Protocol](https://chromedevtools.github.io/devtools-protocol/), the
[BrowserOS](https://github.com/browseros-ai/BrowserOS) agent-browser project, and
the [Lightpanda](https://github.com/lightpanda-io/browser) automation-browser
project. macOS signing must eventually sign Chromium's nested helper applications
as part of release hardening.

Other native RPC implementations remain development checkpoints. See
`docs/plans/multi-environment-architecture.md` before publishing desktop
artifacts.
