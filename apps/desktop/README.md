# Memorall desktop shell

This directory is intentionally a thin shell around the shared application in
`src/main` and shared services in `src/services`.

Development frontend:

```sh
yarn web:desktop:dev
```

Native development app on the current operating system:

```sh
yarn desktop:dev
```

Frontend production artifact:

```sh
yarn web:desktop:build
```

Build and open-smoke the native app on the current operating system:

```sh
yarn desktop:build:windows # Windows host
yarn desktop:build:macos   # macOS host
yarn desktop:build:linux   # Linux host
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
JavaScript wrapper. Managed
Chromium is not bundled here and will be downloaded into application data when
browser automation is enabled.

The Rust supervisor and native RPC implementations are still a development
checkpoint. See `docs/plans/multi-environment-architecture.md` before publishing
desktop artifacts.
