# Desktop E2E

Run the native smoke test for the current host:

```sh
yarn test:e2e:desktop
```

That command selects `desktop:build:windows`, `desktop:build:macos`, or
`desktop:build:linux`, builds the shared frontend and Tauri shell, starts the
resulting executable for ten seconds, and then terminates the exact child process.
To test an already-built executable, run `yarn test:e2e:desktop:built`.

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
bundle launch. These tests stay local/on-demand; no GitHub Actions workflow is
installed.
