# Static web E2E and GitHub Pages

Build and test the exact Pages layout locally:

```sh
yarn test:e2e:web
```

Run the opt-in real local-model acceptance separately:

```sh
yarn test:e2e:web:local-model
```

It selects and downloads the CPU/WASM Wllama fixture through the production
Pages artifact, submits through the real Chat composer, and requires a newly
completed non-error assistant response.

The test server maps
`http://127.0.0.1:4173/memorall/studio/` to `publish/web/studio/`, matching the
production project-site URL `https://zrg-team.github.io/memorall/studio/`. The
suite verifies initial loading, the PWA service-worker scope, manifest placement,
first-party asset requests, and hash-route reloads.

`pwa.spec.ts` covers the installable/offline behaviour on top of that: the
manifest advertises icons that are actually deployed, the app boots with the
network switched off, and a new deployment surfaces in the right panel as a
"New version ready" action that reloads into it. The update test temporarily
rewrites the build id in `publish/web/studio/sw.js` to stand in for a deploy and
restores the file afterwards, so run it against a build you can regenerate.

GitHub Actions runs this suite under Xvfb against the production artifact, scans
the Web bundle for platform-boundary regressions, and executes the Pages deploy
dry run. It never pushes the Pages branch or changes the live site.

To inspect it manually:

```sh
yarn build:web
yarn serve:web
```

To publish manually to the repository's `gh-pages` branch:

```sh
yarn deploy:web:github-pages:dry-run
yarn deploy:web:github-pages
```

The build preserves the landing page at `/memorall/`, the privacy policy at
`/memorall/privacy_policy.html` (with `/memorall/privacy/` as an alias), and the
shared application at `/memorall/studio/`. The deploy command force-publishes the
complete `publish/web` tree to `gh-pages` and configures Pages to deploy from that
branch. The dry run performs the same artifact and Git checks without changing
the branch, repository Pages setting, or live site. Deployment is intentionally
not wired to GitHub Actions.
