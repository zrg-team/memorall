# Extension E2E

Run the Extension.js development artifact as an unpacked extension in headed
Chromium:

```sh
yarn test:e2e:extension:dev
```

The wrapper waits for Extension.js to publish
`dist/extension-js/chromium/ready.json`, loads that exact directory, runs the
Playwright suite, and stops only the dev process it created.

Build the production MV3 artifact, run the remote-code audit, and load
`dist/chromium` directly as an unpacked extension:

```sh
yarn test:e2e:extension:build
```

Run both paths in sequence with `yarn test:e2e:extension`. These tests stay
local/on-demand; no GitHub Actions workflow is installed.
