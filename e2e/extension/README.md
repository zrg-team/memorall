# Extension E2E

Run the Extension.js development artifact as an unpacked extension in headed
Chromium:

```sh
yarn test:e2e:extension:dev
```

The wrapper waits for Extension.js to publish
its internal `dist/extension-js/chromium/ready.json` contract, snapshots that
artifact to `publish/extension/dev/chromium`, runs the Playwright suite from the
published path, and stops only the dev process it created.

Build the production MV3 artifact, run the remote-code audit, and load
`publish/extension/chromium` directly as an unpacked extension:

```sh
yarn test:e2e:extension:build
```

Run both paths in sequence with `yarn test:e2e:extension`. GitHub Actions runs
the development artifact and the packaged Chrome and Edge artifacts under Xvfb.
The Firefox build is available as a manual, non-blocking workflow job.

Run `yarn test:e2e:extension:local-model` for the slower real-runtime
acceptance gate. It loads the packaged Chrome artifact in two fresh extension
profiles, downloads the smallest supported CPU/WASM Wllama quick-download
model, verifies that the offscreen service is registered and ready, selects it,
sends a completion request through the Chat composer, and requires both runs to
produce a newly completed, non-error assistant response. This uses the real
model and network download rather than a mocked provider.
