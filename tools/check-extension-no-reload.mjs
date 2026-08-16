import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

const normalize = (value) => value.replace(/\r\n/g, "\n");

const requireFragment = (source, fragment, message, errors) => {
	if (!source.includes(fragment)) errors.push(message);
};

export function analyzeExtensionDevelopV4Source(rawSource) {
	const source = normalize(rawSource);
	const errors = [];

	requireFragment(
		source,
		"function getDevServerHmrImports(compiler) {\n    if ('true' === process.env.EXTENSION_NO_RELOAD) return [];",
		"getDevServerHmrImports must return no dev-server imports when EXTENSION_NO_RELOAD=true",
		errors,
	);
	requireFragment(
		source,
		"if ('development' === compiler.options.mode && 'true' !== process.env.EXTENSION_NO_RELOAD) {\n                    if (devServerHmrImports.length > 0) fileAssets.unshift(...devServerHmrImports);\n                    fileAssets.unshift(resolveDevelopDistFile('preact-refresh-shim'));",
		"HTML entries must not receive dev-server, refresh, or minimum-script imports when reload is disabled",
		errors,
	);
	requireFragment(
		source,
		"if ('production' !== (compiler.options.mode || 'development') && 'true' !== process.env.EXTENSION_NO_RELOAD) {\n            const contentScriptEntryPaths = new Set();",
		"the ensure-hmr loader must not be installed when reload is disabled",
		errors,
	);
	requireFragment(
		source,
		"if ('development' === compiler.options.mode) {\n                    if ('true' !== process.env.EXTENSION_NO_RELOAD && patchedManifest.content_scripts) patchedManifest.content_scripts = this.applyDevOverrides(patchedManifest);\n                    patchedManifest = patchDevContentScriptManifestPaths(compilation, patchedManifest);",
		"content-script dev overrides must be disabled while canonical dev asset paths remain enabled",
		errors,
	);
	requireFragment(
		source,
		"if ('production' === compiler.options.mode || 'true' === process.env.EXTENSION_NO_RELOAD) return;",
		"ReloadPlugin must remain disabled by EXTENSION_NO_RELOAD",
		errors,
	);

	return errors;
}

function analyzeExtensionDevelopV3Source(rawSource) {
	const source = normalize(rawSource);
	const errors = [];

	requireFragment(
		source,
		"function isReloadDisabledByEnv() {\n    return true;\n}",
		"the legacy Extension.js 3 patch no longer disables reload injection",
		errors,
	);
	for (const fragment of [
		"if (isReloadDisabledByEnv()) return [];",
		"if ('development' === compiler.options.mode && !isReloadDisabledByEnv()) {",
		"if ('production' !== compiler.options.mode && !isReloadDisabledByEnv()) {",
	]) {
		requireFragment(
			source,
			fragment,
			`the legacy Extension.js 3 patch is missing: ${fragment}`,
			errors,
		);
	}
	return errors;
}

export function analyzeExtensionCliSource(source) {
	return /process\.env\.EXTENSION_NO_RELOAD\s*=\s*['"]true['"]/.test(source)
		? []
		: ["the Extension.js CLI must map --no-reload to EXTENSION_NO_RELOAD=true"];
}

export function analyzeSandboxRuntimeSource(rawSource) {
	const source = normalize(rawSource);
	const errors = [];
	requireFragment(
		source,
		"const assetUrl = new URL(self.location.href);",
		"sandbox runtime assets must resolve from the runtime page without a bundler module context",
		errors,
	);
	requireFragment(
		source,
		'const sandboxRootMarker = "/sandbox/";',
		"sandbox runtime assets must remain rooted under the packaged /sandbox/ directory",
		errors,
	);
	if (/new URL\(`\.\.\/\$\{normalizedPath\}`,\s*import\.meta\.url\)/.test(source)) {
		errors.push(
			"sandbox runtime assets must not use a dynamic new URL(..., import.meta.url) expression that Rspack converts to an unresolved context module",
		);
	}
	return errors;
}

export function analyzeExtensionConfig(configExport) {
	const errors = [];
	if (typeof configExport?.config !== "function") {
		return ["extension.config.cjs must expose the Extension.js 4 config hook"];
	}
	for (const legacyKey of ["output", "resolve", "plugins"]) {
		if (legacyKey in configExport) {
			errors.push(
				`extension.config.cjs must not use the ignored top-level ${legacyKey} field`,
			);
		}
	}

	const sentinelPlugin = { name: "sentinel-plugin" };
	const input = {
		entry: { sentinelEntry: "sentinel-entry" },
		externals: ["sentinel-externalizer"],
		output: { path: "sentinel-output" },
		resolve: {
			alias: { sentinelAlias: "sentinel-alias" },
			fallback: { sentinelFallback: "sentinel-fallback" },
		},
		plugins: [sentinelPlugin],
	};
	const result = configExport.config(input);
	if (result?.entry?.sentinelEntry !== "sentinel-entry") {
		errors.push("the Extension.js config hook must preserve generated entries");
	}
	if (typeof result?.entry?.["scripts/offscreen"] !== "string") {
		errors.push(
			"the Extension.js config hook must compile the offscreen processor entry",
		);
	}
	if (!Array.isArray(result?.externals) || result.externals.length !== 0) {
		errors.push(
			"the Extension.js config hook must disable browser-incompatible CommonJS externalization",
		);
	}
	if (result?.output?.path !== input.output.path) {
		errors.push(
			"the Extension.js config hook must preserve generated output fields",
		);
	}
	if (result?.output?.publicPath !== "/") {
		errors.push(
			"the Extension.js config hook must keep extension chunks rooted at /",
		);
	}
	if (result?.resolve?.alias?.sentinelAlias !== "sentinel-alias") {
		errors.push("the Extension.js config hook must preserve generated aliases");
	}
	if (typeof result?.resolve?.alias?.["@"] !== "string") {
		errors.push("the Extension.js config hook must install Memorall's @ alias");
	}
	if (result?.resolve?.fallback?.sentinelFallback !== "sentinel-fallback") {
		errors.push(
			"the Extension.js config hook must preserve generated fallbacks",
		);
	}
	if (result?.resolve?.fallback?.fs !== false) {
		errors.push(
			"the Extension.js config hook must keep Node-only fs unavailable",
		);
	}
	if (!result?.plugins?.includes(sentinelPlugin) || result.plugins.length < 2) {
		errors.push(
			"the Extension.js config hook must preserve generated plugins and append polyfills",
		);
	}
	return errors;
}

const forbiddenArtifactSignatures = [
	["webpack dev-server client", /webpack-dev-server\/client/i],
	["webpack hot runtime", /webpack\/hot\/dev-server/i],
	[
		"extension-page hot query shim",
		/rspack-dev-server-hot=false|webpack-dev-server-hot=false/i,
	],
	[
		"Extension.js pending content-script reinjection",
		/__extjsDevPendingReinject/,
	],
	["Extension.js reload-state bridge", /extjs-dev-reload-state/],
	["Extension.js reload acknowledgement", /["']reload-ack["']/],
];

export function analyzeNoReloadArtifactContents(entries) {
	const errors = [];
	const entryPaths = new Set(entries.map(([relative]) => relative));
	const manifestEntry = entries.find(
		([relative]) => relative === "manifest.json",
	);
	if (!manifestEntry) {
		errors.push("artifact is missing manifest.json");
	} else {
		try {
			const manifest = JSON.parse(manifestEntry[1]);
			for (const [index, contentScript] of (
				manifest.content_scripts ?? []
			).entries()) {
				for (const asset of [
					...(contentScript.js ?? []),
					...(contentScript.css ?? []),
				]) {
					if (/^(?:https?|wss?):\/\//i.test(asset)) {
						errors.push(
							`manifest content_scripts[${index}] contains a remote dev asset: ${asset}`,
						);
					}
				}
			}
		} catch (error) {
			errors.push(`artifact manifest.json is invalid: ${error.message}`);
		}
	}

	const scriptEntries = entries.filter(([relative]) =>
		/\.(?:c|m)?js$/i.test(relative),
	);
	if (scriptEntries.length === 0)
		errors.push("artifact contains no JavaScript assets");
	for (const [relative, content] of entries) {
		if (
			relative !== "offscreen.html" &&
			!relative.startsWith("options/") &&
			!/^sandbox\/page-\d+\.html$/.test(relative)
		)
			continue;
		for (const match of content.matchAll(
			/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi,
		)) {
			const source = match[1].split(/[?#]/, 1)[0];
			if (/^(?:[a-z]+:|\/\/)/i.test(source)) continue;
			const resolved = path.posix.normalize(
				source.startsWith("/")
					? source.slice(1)
					: path.posix.join(path.posix.dirname(relative), source),
			);
			if (!entryPaths.has(resolved)) {
				errors.push(`${relative} references a missing local script: ${source}`);
			}
		}
	}
	for (const [relative, content] of entries) {
		if (
			relative === "sandbox/page-1.js" &&
			content.includes("vendors/almostnode.bundle.js") &&
			!content.includes("Sandbox asset root is unavailable")
		) {
			errors.push(
				`${relative} does not contain the bundler-safe sandbox asset resolver`,
			);
		}
		const browserRequires = [
			...content.matchAll(
				/module\.exports\s*=\s*require\(["']([^"']+)["']\)/g,
			),
		].map((match) => match[1]);
		if (
			browserRequires.length > 0 &&
			!content.includes("MEMORALL_BROWSER_REQUIRE_SHIM")
		) {
			errors.push(`${relative} contains CommonJS requests without the browser shim`);
		}
		for (const request of browserRequires) {
			if (!["canvas", "source-map-js", "url"].includes(request)) {
				errors.push(`${relative} contains an unsupported CommonJS request: ${request}`);
			}
		}
		for (const [label, pattern] of forbiddenArtifactSignatures) {
			if (pattern.test(content)) {
				errors.push(`${relative} contains ${label}`);
			}
		}
	}
	return errors;
}

async function textFilesUnder(directory, relative = "") {
	const entries = [];
	for (const item of await readdir(path.join(directory, relative), {
		withFileTypes: true,
	})) {
		const nextRelative = path.join(relative, item.name);
		if (item.isDirectory()) {
			entries.push(...(await textFilesUnder(directory, nextRelative)));
		} else if (/\.(?:c|m)?js$|\.html$|\.json$/i.test(item.name)) {
			entries.push([
				nextRelative.replaceAll(path.sep, "/"),
				await readFile(path.join(directory, nextRelative), "utf8"),
			]);
		}
	}
	return entries;
}

async function packageSource(packageRoot, pattern) {
	const dist = path.join(packageRoot, "dist");
	const sources = [];
	for (const item of await readdir(dist, { withFileTypes: true })) {
		if (item.isFile() && pattern.test(item.name)) {
			sources.push(await readFile(path.join(dist, item.name), "utf8"));
		}
	}
	return sources.join("\n");
}

async function main() {
	const root = process.cwd();
	const developRoot = path.join(root, "node_modules", "extension-develop");
	const developManifest = JSON.parse(
		await readFile(path.join(developRoot, "package.json"), "utf8"),
	);
	const major = Number.parseInt(developManifest.version.split(".")[0], 10);
	const developSource = await readFile(
		path.join(developRoot, "dist", "0~rspack-config.mjs"),
		"utf8",
	);
	const errors =
		major >= 4
			? analyzeExtensionDevelopV4Source(developSource)
			: analyzeExtensionDevelopV3Source(developSource);

	const extensionRoot = path.join(root, "node_modules", "extension");
	errors.push(
		...analyzeExtensionCliSource(
			await packageSource(extensionRoot, /\.(?:c|m)?js$/i),
		),
	);
	errors.push(
		...analyzeExtensionConfig(require(path.join(root, "extension.config.cjs"))),
	);
	errors.push(
		...analyzeSandboxRuntimeSource(
			await readFile(
				path.join(root, "public", "sandbox", "runtime", "shared.js"),
				"utf8",
			),
		),
	);

	for (const artifactPath of process.argv.slice(2)) {
		const absoluteArtifactPath = path.resolve(root, artifactPath);
		const artifactErrors = analyzeNoReloadArtifactContents(
			await textFilesUnder(absoluteArtifactPath),
		);
		errors.push(
			...artifactErrors.map(
				(error) => `${path.relative(root, absoluteArtifactPath)}: ${error}`,
			),
		);
	}

	if (errors.length > 0) {
		console.error(errors.join("\n"));
		process.exitCode = 1;
		return;
	}
	console.log(
		`Extension.js ${developManifest.version} no-reload source/config gates passed${
			process.argv.length > 2 ? " with artifact scan" : ""
		}.`,
	);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;
if (invokedPath === fileURLToPath(import.meta.url)) {
	await main();
}
