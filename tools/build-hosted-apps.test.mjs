import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { DIST_REWRITES, HOSTED_APP_BUILDS, HOSTED_APPS_SOURCE } from "./hosted-apps/apps.mjs";
import { transformIndexHtml } from "./build-hosted-apps.mjs";

const PAGE = `<!doctype html>
<html><head>
  <script>
    try { document.documentElement.dataset.theme = localStorage.getItem('t'); } catch {}
  </script>
  <script type="application/ld+json">{"@type":"WebApplication"}</script>
  <!-- Privacy-friendly analytics by Plausible -->
  <script async src="https://plausible.io/js/pa-x.js"></script>
  <script>
    window.plausible = window.plausible || function () {};
  </script>
  <script src="https://js.puter.com/v2/" defer></script>
  <link rel="manifest" href="./manifest.json" />
</head><body>
  <script type="module" src="/src/main.js"></script>
</body></html>`;

test("an app's page runs no remote or inline code and keeps its entry", () => {
	const { html, inline } = transformIndexHtml(PAGE);
	assert.doesNotMatch(html, /https?:\/\//);
	assert.doesNotMatch(html, /plausible/i);
	assert.match(html, /<script type="module" src="\/src\/main\.js"><\/script>/);
	assert.match(html, /<script src="\.\/memorall-inline-0\.js"><\/script>/);
	// Data blocks stay: they are not scripts.
	assert.match(html, /application\/ld\+json/);
	assert.equal(inline.length, 1);
	assert.match(inline[0].body, /localStorage\.getItem/);
	// The stores accept one manifest.json per package: the extension's.
	assert.doesNotMatch(html, /manifest/i);
});

test("a page without exactly one main.js entry is refused", () => {
	assert.throws(() => transformIndexHtml("<html><body></body></html>"), /expected one src\/main\.js entry/);
});

test("every app builds from the pinned commit with an engine and exact edits", () => {
	assert.match(HOSTED_APPS_SOURCE.commit, /^[0-9a-f]{40}$/);
	const engines = new Set(readdirSync(new URL("./hosted-apps/engines/", import.meta.url)));
	for (const app of HOSTED_APP_BUILDS) {
		assert.ok(engines.has(`${app.id}.js`), `${app.id} has an engine`);
		for (const edit of app.edits ?? []) {
			assert.ok(edit.find && edit.find !== edit.replace, `${app.id}: an edit changes something`);
			assert.ok(Number.isInteger(edit.count) && edit.count > 0, `${app.id}: an edit says how often it applies`);
		}
	}
	for (const [find] of DIST_REWRITES) assert.match(find, /^https?:\/\//);
});
