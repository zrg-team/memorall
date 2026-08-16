import assert from "node:assert/strict";
import test from "node:test";

import { desktopBuildIsAffected } from "./check-desktop-relevant-changes.mjs";

test("skips documentation and web-only changes", () => {
	assert.equal(
		desktopBuildIsAffected([
			"apps/web/src/main.tsx",
			"docs/co-agent.md",
			"README.md",
			"e2e/web/session.spec.ts",
			"playwright.web.config.ts",
		]),
		false,
	);
});

test("runs for the desktop application itself", () => {
	assert.equal(desktopBuildIsAffected(["apps/desktop/src-tauri/src/main.rs"]), true);
	assert.equal(
		desktopBuildIsAffected([
			"apps/desktop/sidecar/src/managed-browseros-runtime.ts",
		]),
		true,
	);
	assert.equal(desktopBuildIsAffected(["e2e/desktop/native-smoke.mjs"]), true);
});

test("runs for shared code the desktop build bundles", () => {
	for (const path of [
		"src/main/bootstrap.ts",
		"packages/agent-harness/src/index.ts",
		"public/vendors/hyperframes/hyperframe.runtime.iife.js",
	]) {
		assert.equal(desktopBuildIsAffected([path]), true, path);
	}
});

test("runs for dependency and staging changes", () => {
	for (const path of [
		"package.json",
		"yarn.lock",
		"patches/jspdf+4.2.1.patch",
		".yarnrc.yml",
		"tools/prepare-desktop-browser-runtime.mjs",
		"apps/desktop/browser-runtime.lock.json",
		".github/workflows/platform-products.yml",
	]) {
		assert.equal(desktopBuildIsAffected([path]), true, path);
	}
});

test("runs when one relevant file rides along with inert ones", () => {
	assert.equal(
		desktopBuildIsAffected(["README.md", "apps/web/src/main.tsx", "src/lib/db.ts"]),
		true,
	);
});

test("runs when the change set is unknown", () => {
	assert.equal(desktopBuildIsAffected([]), true);
});

test("treats unrecognised paths as relevant", () => {
	assert.equal(desktopBuildIsAffected(["runner/agent.ts"]), true);
	assert.equal(desktopBuildIsAffected(["sandbox/index.ts"]), true);
});
