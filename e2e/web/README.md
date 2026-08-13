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
yarn web:build
yarn web:serve:static
```

To publish manually to the repository's `gh-pages` branch:

```sh
yarn web:deploy:github-pages
```

Deployment is intentionally not wired to GitHub Actions.
