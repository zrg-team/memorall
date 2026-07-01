#!/usr/bin/env node
import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'fs';
import { dirname, join } from 'path';

const defaultDistDirs = [
	'dist/chromium',
	'dist/chrome',
	'dist/edge',
	'dist/firefox',
];

const distDirs = process.argv.slice(2);
const targets = distDirs.length > 0 ? distDirs : defaultDistDirs;
const contentScriptCssPattern = 'content_scripts/*.css';

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

	if (createdCount > 0 || manifestChanged) {
		console.log(
			`✅ Content script assets ready in ${distDir} (${createdCount} CSS sidecar${createdCount === 1 ? '' : 's'} created)`,
		);
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
