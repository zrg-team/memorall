import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import {
	analyzeExtensionCliSource,
	analyzeExtensionConfig,
	analyzeExtensionDevelopV4Source,
	analyzeNoReloadArtifactContents,
	analyzeSandboxRuntimeSource,
} from "./check-extension-no-reload.mjs";

const require = createRequire(import.meta.url);

const patchedV4Source = `
class ReloadPlugin {
  apply(compiler) {
    if ('production' === compiler.options.mode || 'true' === process.env.EXTENSION_NO_RELOAD) return;
  }
}
function getDevServerHmrImports(compiler) {
    if ('true' === process.env.EXTENSION_NO_RELOAD) return [];
}
if ('development' === compiler.options.mode && 'true' !== process.env.EXTENSION_NO_RELOAD) {
                    if (devServerHmrImports.length > 0) fileAssets.unshift(...devServerHmrImports);
                    fileAssets.unshift(resolveDevelopDistFile('preact-refresh-shim'));
}
if ('production' !== (compiler.options.mode || 'development') && 'true' !== process.env.EXTENSION_NO_RELOAD) {
            const contentScriptEntryPaths = new Set();
}
if ('development' === compiler.options.mode) {
                    if ('true' !== process.env.EXTENSION_NO_RELOAD && patchedManifest.content_scripts) patchedManifest.content_scripts = this.applyDevOverrides(patchedManifest);
                    patchedManifest = patchDevContentScriptManifestPaths(compilation, patchedManifest);
}
`;

test("accepts the exact Extension.js 4 no-reload guards", () => {
	assert.deepEqual(analyzeExtensionDevelopV4Source(patchedV4Source), []);
});

test("rejects upstream v4 HMR and content-script injection behavior", () => {
	const upstreamSource = patchedV4Source
		.replace(
			"function getDevServerHmrImports(compiler) {\n    if ('true' === process.env.EXTENSION_NO_RELOAD) return [];",
			"function getDevServerHmrImports(compiler) {",
		)
		.replace(
			"if ('development' === compiler.options.mode && 'true' !== process.env.EXTENSION_NO_RELOAD) {",
			"if ('development' === compiler.options.mode) {",
		)
		.replace(
			"if ('production' !== (compiler.options.mode || 'development') && 'true' !== process.env.EXTENSION_NO_RELOAD) {",
			"if ('production' !== (compiler.options.mode || 'development')) {",
		)
		.replace(
			"if ('true' !== process.env.EXTENSION_NO_RELOAD && patchedManifest.content_scripts)",
			"if (patchedManifest.content_scripts)",
		);
	assert.equal(analyzeExtensionDevelopV4Source(upstreamSource).length, 4);
});

test("rejects an unconditional v4 disable that would break ordinary dev mode", () => {
	const unconditionalSource = patchedV4Source.replaceAll(
		"'true' !== process.env.EXTENSION_NO_RELOAD",
		"true",
	);
	assert.ok(analyzeExtensionDevelopV4Source(unconditionalSource).length >= 3);
});

test("requires --no-reload to set the package-wide environment contract", () => {
	assert.deepEqual(
		analyzeExtensionCliSource(
			"process.env.EXTENSION_NO_RELOAD = 'true'; nextArgv = nextArgv.filter(Boolean);",
		),
		[],
	);
	assert.equal(analyzeExtensionCliSource("const noReload = true;").length, 1);
});

test("the repository config uses and safely merges the v4 config hook", () => {
	const config = require(path.resolve("extension.config.cjs"));
	assert.deepEqual(analyzeExtensionConfig(config), []);
	assert.equal(process.env.EXTENSION_STRICT_REFS, "true");
	assert.equal(config.config({ resolve: {} }).resolve.fallback.canvas, false);
});

test("the Extension.js unicount resolver shim matches the published runtime", () => {
	const config = require(path.resolve("extension.config.cjs"));
	const resolved = config.config({ resolve: {} });
	const shim = require(resolved.resolve.alias.unicount);
	const upstream = require(path.resolve("node_modules/unicount/index.js"));
	const samples = ["", "plain text", "💃123", "a😀b🧠c", "ภาษาไทย"];
	for (const sample of samples) {
		for (let offset = 0; offset <= [...sample].length; offset += 1) {
			assert.equal(
				shim.uniToStrPos(sample, offset),
				upstream.uniToStrPos(sample, offset),
			);
		}
		for (let offset = 0; offset <= sample.length; offset += 1) {
			let actual;
			let expected;
			try {
				actual = shim.strPosToUni(sample, offset);
			} catch (error) {
				actual = error.message;
			}
			try {
				expected = upstream.strPosToUni(sample, offset);
			} catch (error) {
				expected = error.message;
			}
			assert.equal(actual, expected);
		}
	}
});

test("sandbox runtime assets avoid Rspack context-module URL rewriting", () => {
	const safeSource = `
const sandboxAssetUrl = (path) => {
  const normalizedPath = String(path).replace(/^\\/+/, "");
  const assetUrl = new URL(self.location.href);
  const sandboxRootMarker = "/sandbox/";
  assetUrl.pathname = normalizedPath;
  return assetUrl.href;
};`;
	assert.deepEqual(analyzeSandboxRuntimeSource(safeSource), []);
	assert.ok(
		analyzeSandboxRuntimeSource(
			"const sandboxAssetUrl = (path) => new URL(`../${normalizedPath}`, import.meta.url).href;",
		).length >= 2,
	);
});

test("accepts a development artifact without Extension.js reload code", () => {
	const entries = [
		[
			"manifest.json",
			JSON.stringify({
				manifest_version: 3,
				content_scripts: [{ matches: ["<all_urls>"], js: ["content.js"] }],
			}),
		],
		["content.js", "console.log('Memorall content script');"],
		[
			"background/service_worker.js",
			"chrome.runtime.onInstalled.addListener(() => {});",
		],
	];
	assert.deepEqual(analyzeNoReloadArtifactContents(entries), []);
});

test("rejects a sandbox bundle whose AlmostNode URL became a context module", () => {
	const errors = analyzeNoReloadArtifactContents([
		["manifest.json", JSON.stringify({ manifest_version: 3 })],
		[
			"sandbox/page-1.js",
			'import(context(`./${path}`).href); const target = "vendors/almostnode.bundle.js";',
		],
	]);
	assert.ok(errors.some((error) => error.includes("bundler-safe sandbox asset resolver")));
});

test("accepts only browser-shimmed optional CommonJS package requests", () => {
	assert.deepEqual(
		analyzeNoReloadArtifactContents([
			["manifest.json", JSON.stringify({ manifest_version: 3 })],
			[
				"options/index.js",
				'/* MEMORALL_BROWSER_REQUIRE_SHIM */ module.exports = require("source-map-js");',
			],
		]),
		[],
	);
	assert.ok(
		analyzeNoReloadArtifactContents([
			["manifest.json", JSON.stringify({ manifest_version: 3 })],
			[
				"options/index.js",
				'/* MEMORALL_BROWSER_REQUIRE_SHIM */ module.exports = require("child_process");',
			],
		]).some((error) => error.includes("unsupported CommonJS request")),
	);
});

test("rejects copied extension HTML with a missing local script", () => {
	const errors = analyzeNoReloadArtifactContents([
		["manifest.json", JSON.stringify({ manifest_version: 3 })],
		["offscreen.html", '<script type="module" src="scripts/offscreen.js"></script>'],
		["options/index.js", "console.log('options')"],
	]);
	assert.ok(errors.some((error) => error.includes("missing local script")));
});

test("rejects remote content-script assets and every injected reload signature", () => {
	const signatures = [
		"webpack-dev-server/client",
		"webpack/hot/dev-server",
		"rspack-dev-server-hot=false",
		"__extjsDevPendingReinject",
		"extjs-dev-reload-state",
		'"reload-ack"',
	];
	for (const signature of signatures) {
		const errors = analyzeNoReloadArtifactContents([
			[
				"manifest.json",
				JSON.stringify({
					manifest_version: 3,
					content_scripts: [{ js: ["http://127.0.0.1:8080/content.js"] }],
				}),
			],
			["content.js", signature],
		]);
		assert.ok(errors.length >= 2, signature);
	}
});
