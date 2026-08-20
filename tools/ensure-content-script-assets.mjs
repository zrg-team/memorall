#!/usr/bin/env node
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from 'fs';
import { dirname, join, relative } from 'path';

const defaultDistDirs = [
	'publish/extension/chromium',
	'publish/extension/chrome',
	'publish/extension/edge',
	'publish/extension/firefox',
];

const distDirs = process.argv.slice(2);
const targets = distDirs.length > 0 ? distDirs : defaultDistDirs;
const contentScriptCssPattern = 'content_scripts/*.css';
const unicodeNoncharacterPattern =
	/[\uFDD0-\uFDEF\uFFFE\uFFFF]|[\uD83F\uD87F\uD8BF\uD8FF\uD93F\uD97F\uD9BF\uD9FF\uDA3F\uDA7F\uDABF\uDAFF\uDB3F\uDB7F\uDBBF\uDBFF][\uDFFE\uDFFF]/g;

function addWebAccessibleContentScriptCss(manifest) {
	if (manifest.manifest_version === 3) {
		if (!Array.isArray(manifest.web_accessible_resources)) {
			manifest.web_accessible_resources = [];
		}

		let resourceEntry =
			manifest.web_accessible_resources.find((entry) =>
				Array.isArray(entry.matches) && entry.matches.includes('<all_urls>'),
			) ?? manifest.web_accessible_resources[0];

		if (!resourceEntry) {
			resourceEntry = { resources: [], matches: ['<all_urls>'] };
			manifest.web_accessible_resources.push(resourceEntry);
		}

		if (!Array.isArray(resourceEntry.resources)) {
			resourceEntry.resources = [];
		}

		if (!resourceEntry.resources.includes(contentScriptCssPattern)) {
			resourceEntry.resources.push(contentScriptCssPattern);
			return true;
		}

		return false;
	}

	if (!Array.isArray(manifest.web_accessible_resources)) {
		manifest.web_accessible_resources = [];
	}

	if (!manifest.web_accessible_resources.includes(contentScriptCssPattern)) {
		manifest.web_accessible_resources.push(contentScriptCssPattern);
		return true;
	}

	return false;
}

function expectedContentScriptCssRefs(manifest) {
	const refs = new Set();

	for (const entry of manifest.content_scripts ?? []) {
		for (const jsRef of entry.js ?? []) {
			if (
				typeof jsRef === 'string' &&
				jsRef.startsWith('content_scripts/') &&
				jsRef.endsWith('.js')
			) {
				refs.add(jsRef.replace(/\.js$/, '.css'));
			}
		}
	}

	return [...refs].sort();
}

function unicodeEscapeForCodePoint(codePoint) {
	if (codePoint <= 0xffff) {
		return `\\u${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
	}

	const offset = codePoint - 0x10000;
	const high = 0xd800 + (offset >> 10);
	const low = 0xdc00 + (offset & 0x3ff);

	return `\\u${high.toString(16).toUpperCase()}\\u${low.toString(16).toUpperCase()}`;
}

function escapeJavaScriptNoncharacters(source) {
	let escapedCount = 0;

	const escaped = source.replace(unicodeNoncharacterPattern, (char) => {
		escapedCount++;
		return unicodeEscapeForCodePoint(char.codePointAt(0));
	});

	return { escaped, escapedCount };
}

function builtJsRefs(distDir, dir = distDir) {
	const refs = [];

	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const entryPath = join(dir, entry.name);

		if (entry.isDirectory()) {
			refs.push(...builtJsRefs(distDir, entryPath));
			continue;
		}

		if (entry.isFile() && entry.name.endsWith('.js')) {
			refs.push(relative(distDir, entryPath).replaceAll('\\', '/'));
		}
	}

	return refs.sort();
}

function sanitizeExtensionJs(distDir) {
	let escapedCount = 0;
	const sanitizedRefs = [];

	for (const jsRef of builtJsRefs(distDir)) {
		const jsPath = join(distDir, ...jsRef.split('/'));

		const source = readFileSync(jsPath, 'utf8');
		const result = escapeJavaScriptNoncharacters(source);
		if (result.escapedCount === 0) continue;

		writeFileSync(jsPath, result.escaped, 'utf8');
		escapedCount += result.escapedCount;
		sanitizedRefs.push(`${jsRef} (${result.escapedCount})`);
	}

	return { escapedCount, sanitizedRefs };
}

function ensureContentScriptAssets(distDir) {
	const manifestPath = join(distDir, 'manifest.json');
	if (!existsSync(manifestPath)) return false;

	const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
	const cssRefs = expectedContentScriptCssRefs(manifest);
	let createdCount = 0;

	for (const cssRef of cssRefs) {
		const cssPath = join(distDir, ...cssRef.split('/'));
		if (existsSync(cssPath)) continue;

		mkdirSync(dirname(cssPath), { recursive: true });
		writeFileSync(
			cssPath,
			'/* Generated empty sidecar for Extension.js content-script CSS lookup. */\n',
			'utf8',
		);
		createdCount++;
	}

	const manifestChanged =
		cssRefs.length > 0 && addWebAccessibleContentScriptCss(manifest);

	if (manifestChanged) {
		writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
	}

	const jsSanitization = sanitizeExtensionJs(distDir);
	const requiredRuntimeAssets = [
		'docs/images/extension_16.png',
		'docs/images/extension_32.png',
		'docs/images/extension_48.png',
		'docs/images/extension_128.png',
		'options/index.css',
		'sandbox/pages/js/lottie-preview.js',
		'vendors/artifacts/lottie_canvas.min.js',
	];
	const missingRuntimeAssets = requiredRuntimeAssets.filter(
		(assetRef) => !existsSync(join(distDir, ...assetRef.split('/'))),
	);
	if (missingRuntimeAssets.length > 0) {
		throw new Error(
			`${distDir}: missing required runtime asset(s): ${missingRuntimeAssets.join(', ')}`,
		);
	}
	const lottiePreview = readFileSync(
		join(distDir, 'sandbox', 'pages', 'js', 'lottie-preview.js'),
		'utf8',
	);
	if (
		!lottiePreview.includes(
			'../../../vendors/artifacts/lottie_canvas.min.js',
		)
	) {
		throw new Error(
			`${distDir}: Lottie preview does not resolve the packaged root vendors runtime.`,
		);
	}

	if (
		createdCount > 0 ||
		manifestChanged ||
		jsSanitization.escapedCount > 0
	) {
		console.log(
			`✅ Content script assets ready in ${distDir} (${createdCount} CSS sidecar${createdCount === 1 ? '' : 's'} created, ${jsSanitization.escapedCount} JS noncharacter${jsSanitization.escapedCount === 1 ? '' : 's'} escaped)`,
		);
		if (jsSanitization.sanitizedRefs.length > 0) {
			const listedRefs = jsSanitization.sanitizedRefs.slice(0, 8);
			const remainingCount =
				jsSanitization.sanitizedRefs.length - listedRefs.length;
			console.log(
				`   Escaped noncharacters in ${jsSanitization.sanitizedRefs.length} JS file${jsSanitization.sanitizedRefs.length === 1 ? '' : 's'}: ${listedRefs.join(', ')}${remainingCount > 0 ? `, ...and ${remainingCount} more` : ''}`,
			);
		}
	} else {
		console.log(`✅ Content script assets already ready in ${distDir}`);
	}

	return true;
}

let foundManifest = false;

for (const target of targets) {
	foundManifest = ensureContentScriptAssets(target) || foundManifest;
}

if (!foundManifest) {
	console.warn(
		`⚠ No extension manifests found in: ${targets.join(', ')}`,
	);
}
