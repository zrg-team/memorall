# Static web E2E and GitHub Pages

Build and test the exact Pages layout locally:

```sh
yarn test:e2e:web
```

The test server maps
`http://127.0.0.1:4173/memorall/studio/` to `publish/web/studio/`, matching the
production project-site URL `https://zrg-team.github.io/memorall/studio/`. The
suite verifies initial loading, the PWA service-worker scope, manifest placement,
first-party asset requests, and hash-route reloads.

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
