#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";

const SCANNED_EXTENSIONS = /\.(?:c?js|mjs|html)$/i;
const CODE_CDN_PATTERN =
	/https?:\/\/(?:cdn\.jsdelivr\.net|unpkg\.com|cdn\.tailwindcss\.com|esm\.sh)\b[^\s"'`<>\\]*/gi;
const EXECUTABLE_URL_PATTERN =
	/https?:\/\/[^\s/"'`<>\\]+\/[^\s"'`<>\\]*\.(?:c?js|mjs|wasm)(?=$|[?#\s"'`<>\\])(?:[?#][^\s"'`<>\\]*)?/gi;
const REMOTE_SCRIPT_PATTERN =
	/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\/[^"']+["'][^>]*>/gi;
const REMOTE_IMPORT_PATTERN =
	/(?:importScripts|import)\s*\(\s*["'`]https?:\/\/[^"'`]+["'`]/gi;

const isDocumentationUrl = (value) =>
	/^https?:\/\/(?:github\.com|raw\.githubusercontent\.com)\//i.test(value) ||
	/^https?:\/\/huggingface\.co\/docs\//i.test(value);

const patterns = [
	["code CDN", CODE_CDN_PATTERN],
	["remote executable URL", EXECUTABLE_URL_PATTERN, isDocumentationUrl],
	["remote script tag", REMOTE_SCRIPT_PATTERN],
	["remote dynamic import", REMOTE_IMPORT_PATTERN],
];

const requestedRoots = process.argv.slice(2);
const roots = (
	requestedRoots.length > 0
		? requestedRoots
		: ["dist/chromium", "dist/chrome", "dist/edge"]
)
	.map((root) => resolve(root))
	.filter(existsSync);

if (roots.length === 0) {
	console.error(
		"MV3 audit found no build output. Build the extension or pass a dist directory.",
	);
	process.exit(1);
}

const findings = [];

const scanFile = (root, filePath) => {
	const source = readFileSync(filePath, "utf8");
	for (const [kind, pattern, ignore] of patterns) {
		pattern.lastIndex = 0;
		for (const match of source.matchAll(pattern)) {
			if (ignore?.(match[0])) continue;
			const line = source.slice(0, match.index).split("\n").length;
			findings.push({
				file: relative(root, filePath).replaceAll("\\", "/"),
				kind,
				line,
				value: match[0].slice(0, 240),
			});
		}
	}
};

const walk = (root, directory) => {
	for (const entry of readdirSync(directory)) {
		const filePath = resolve(directory, entry);
		const stat = statSync(filePath);
		if (stat.isDirectory()) {
			walk(root, filePath);
		} else if (SCANNED_EXTENSIONS.test(entry)) {
			scanFile(root, filePath);
		}
	}
};

for (const root of roots) walk(root, root);

const uniqueFindings = [
	...new Map(
		findings.map((finding) => [
			`${finding.file}:${finding.line}:${finding.value}`,
			finding,
		]),
	).values(),
];

if (uniqueFindings.length > 0) {
	console.error(
		`MV3 remote-code audit failed with ${uniqueFindings.length} finding(s):`,
	);
	for (const finding of uniqueFindings) {
		console.error(
			`- ${finding.file}:${finding.line} [${finding.kind}] ${finding.value}`,
		);
	}
	process.exit(1);
}

console.log(
	`MV3 remote-code audit passed for ${roots.map((root) => relative(process.cwd(), root)).join(", ")}.`,
);
