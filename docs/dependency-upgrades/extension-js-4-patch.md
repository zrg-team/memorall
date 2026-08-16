# Extension.js 4 patch lifecycle

## Existing behavior

`extension-develop+3.16.1.patch` protects Memorall's development artifact from
depending on an Extension.js development server. It disables the reload plugin,
dev-server/HMR imports, refresh shims, and the content-script dev override. The
3.16.1 patch implements this globally (`isReloadDisabledByEnv()` returns
`true`), so even ordinary `extension dev` runs without reload support.

Memorall needs the restriction specifically for `extension dev --no-reload`,
which the Extension.js CLI maps to `EXTENSION_NO_RELOAD=true`. Ordinary local
development can retain Extension.js reload behavior.

## Upstream 4.0.32 audit

The published `extension@4.0.32` CLI still maps `--no-reload` to
`EXTENSION_NO_RELOAD=true`. The published `extension-develop@4.0.32` package
already checks that environment contract in `ReloadPlugin` and the dev-server
reload dispatcher. Those upstream fixes make the old reload-plugin hunk
obsolete.

Four injection paths remain active upstream when reload is disabled:

1. `getDevServerHmrImports()` still returns the dev-server client and hot
   runtime.
2. HTML entries still receive the dev-server imports, Preact refresh shim, and
   minimum hot-query script.
3. `HtmlPlugin` still installs the `ensure-hmr-for-scripts` loader.
4. `UpdateManifest` still applies the content-script development override.

The replacement patch gates only those four paths on
`EXTENSION_NO_RELOAD=true`. It intentionally leaves
`patchDevContentScriptManifestPaths()` enabled so development manifests still
refer to the canonical emitted assets. It also avoids the old unconditional
disable, preserving ordinary Extension.js development reload behavior.

The reviewed clean-tarball candidate is
`patches/extension-develop+4.0.32.patch.candidate`. After `extension` is exact
pinned to 4.0.32 and the lockfile resolves the matching `extension-develop`
package, rename it to `extension-develop+4.0.32.patch`, remove the 3.16.1 patch,
and run normal postinstall.

## Repository compatibility change

Extension.js 4 accepts Rspack changes through the `config(config)` hook in
`extension.config.cjs`. Memorall's output, aliases, fallbacks, and polyfill
plugin now merge through that hook while retaining Extension.js-generated
configuration. The previous top-level `output`, `resolve`, and `plugins` fields
were not part of the published file-config contract.

## Regression gates

Run the source/config tests before installation or build:

```powershell
node --test tools/check-extension-no-reload.test.mjs
node tools/check-extension-no-reload.mjs
```

After producing the no-reload development artifact, scan the staged copy:

```powershell
node tools/check-extension-no-reload.mjs publish/extension/dev/chromium
```

The artifact scan rejects remote content-script entries, webpack/Rspack
dev-server clients and hot-query shims, and Extension.js reload/reinjection
bridge signatures. Repository Playwright gates should continue to load
`publish/extension/dev/chromium` for development and
`publish/extension/{chromium|chrome|edge}` for packaged builds.
