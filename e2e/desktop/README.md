# Desktop E2E

Run the native smoke test for the current host:

```sh
yarn test:e2e:desktop
```

That command selects `build:desktop:windows`, `build:desktop:macos`, or
`build:desktop:linux`, builds the shared frontend and Tauri shell, starts the
resulting executable for ten seconds, and then terminates the exact child process.
To test an already-built executable, run `yarn test:e2e:desktop:built`.

On Windows, `yarn test:e2e:desktop:windows:local-model` adds the slower real
local-model acceptance flow. It drives the packaged WebView2 UI, loads the
smallest CPU/WASM Wllama GGUF model, selects it, submits through the Chat
composer, and requires a newly completed, non-error assistant response.

On Windows, the smoke test also reads the packaged PE header and requires the GUI
subsystem. This prevents a release regression where launching Memorall opens a
terminal window behind the WebView2 application. It also connects to the real
packaged WebView2 instance over a loopback-only debugging port and requires a
non-empty initialized Memorall UI with no service/database initialization error.
This catches package-only WASM, CSP, storage, and browser-global regressions that
a process-survival check cannot detect.

The test intentionally validates a real native executable, not only the shared
Vite frontend. On Windows, a successful build also emits MSI and NSIS installers
under `publish/desktop/windows/bundle/`. macOS and Linux artifacts use the
equivalent `publish/desktop/macos/` and `publish/desktop/linux/` roots.

Native package creation is deliberately not cross-compiled by these scripts.
Windows packages require a Windows runner and MSVC/WebView2, macOS application
bundles require macOS and Xcode, and Linux packages require the target Linux
distribution's WebKit/GTK packaging dependencies.

Tauri WebDriver UI automation is available on Windows and Linux. macOS does not
provide a WKWebView WebDriver interface, so release acceptance there combines
this native process test with platform-native UI automation and a manual signed
bundle launch. GitHub Actions blocks on native build/process smoke tests for
Windows x64, macOS arm64, and Linux x64. Manual, non-blocking jobs cover macOS
x64 and Linux arm64. CI also requires each configured installer format and the
exact staged Node 22 runtime. The workflow never uploads or publishes release
packages.
