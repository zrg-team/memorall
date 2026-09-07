/**
 * Refuses `preventDefault()` inside a handler for an event the browser delivers
 * passively.
 *
 * React attaches `wheel`, `touchstart` and `touchmove` to its root container as
 * passive listeners, and Chrome does the same for those events on window and
 * document. A `preventDefault()` in such a handler is silently ignored, and the
 * browser logs "Unable to preventDefault inside passive event listener
 * invocation" for every matching event. In the content script that noise lands
 * in the console of whatever page the user is on, which is how this last shipped
 * to users.
 *
 * Scroll chaining is prevented by `overscroll-behavior: contain`, not from an
 * event handler. If a handler genuinely needs to cancel one of these events, it
 * has to register the listener itself with `{ passive: false }`, which this
 * check honours.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx"]);
const ignoredDirectories = new Set([
	".git",
	".yarn",
	"node_modules",
	"dist",
	"coverage",
	"publish",
	"playwright-report",
	"test-results",
]);

/**
 * Skill payloads are page source shipped as strings for a generated site, not
 * code this bundle runs, so their listeners are none of our business.
 */
const ignoredPathPattern = /^src\/services\/filesystem\/default-skills\//;

/** React props whose underlying listener is always registered passive. */
const PASSIVE_JSX_PROPS = ["onWheel", "onTouchStart", "onTouchMove"];

/** DOM events delivered passively by default on window, document and body. */
const PASSIVE_DOM_EVENTS = new Set([
	"wheel",
	"mousewheel",
	"touchstart",
	"touchmove",
]);

const isTest = (file) =>
	/(?:^|\/)(?:__tests__|test|e2e)(?:\/|$)|\.(?:test|spec)\.[jt]sx?$/.test(file);

/**
 * Reads a balanced `{...}` or `(...)` starting at an opening character, skipping
 * anything inside string literals so a brace in a class name cannot unbalance it.
 */
function readBalanced(source, openIndex, open, close) {
	let depth = 0;
	let quote = null;
	for (let index = openIndex; index < source.length; index += 1) {
		const character = source[index];
		if (quote) {
			if (character === quote && source[index - 1] !== "\\") quote = null;
			continue;
		}
		if (character === '"' || character === "'" || character === "`") {
			quote = character;
			continue;
		}
		if (character === open) depth += 1;
		else if (character === close) {
			depth -= 1;
			if (depth === 0) return source.slice(openIndex, index + 1);
		}
	}
	return null;
}

/** The body of an arrow function, whether it is braced or a single expression. */
function readArrowBody(source, afterArrowIndex) {
	let index = afterArrowIndex;
	while (index < source.length && /\s/.test(source[index])) index += 1;
	if (source[index] === "{") return readBalanced(source, index, "{", "}");
	const end = source.indexOf(";", index);
	return source.slice(index, end === -1 ? index + 400 : end);
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

const CALLS_PREVENT_DEFAULT = /\.preventDefault\s*\(/;

/**
 * @param {{path: string, contents: string}[]} files
 * @returns {{file: string, line: number, reason: string}[]}
 */
export function findPassivePreventDefault(files) {
	const findings = [];

	for (const file of files) {
		if (isTest(file.path) || ignoredPathPattern.test(file.path)) continue;
		const source = file.contents;

		// A handler typed with one of these events, wherever it is declared.
		const typedHandler =
			/\(\s*[A-Za-z_$][\w$]*\s*:\s*(?:React\.)?(?:Wheel|Touch)Event\b[^)]*\)\s*(?::[^=]*?)?=>/g;
		for (const match of source.matchAll(typedHandler)) {
			const body = readArrowBody(source, match.index + match[0].length);
			if (body && CALLS_PREVENT_DEFAULT.test(body)) {
				findings.push({
					file: file.path,
					line: lineOf(source, match.index),
					reason: "preventDefault in a passive wheel or touch handler",
				});
			}
		}

		// An inline handler on a JSX prop React registers passively.
		for (const prop of PASSIVE_JSX_PROPS) {
			const inline = new RegExp(`${prop}\\s*=\\s*\\{`, "g");
			for (const match of source.matchAll(inline)) {
				const braceIndex = match.index + match[0].length - 1;
				const body = readBalanced(source, braceIndex, "{", "}");
				if (body && CALLS_PREVENT_DEFAULT.test(body)) {
					findings.push({
						file: file.path,
						line: lineOf(source, match.index),
						reason: `preventDefault in an inline ${prop} handler`,
					});
				}
			}
		}

		// A listener added by hand, unless it opted out of passive delivery.
		for (const match of source.matchAll(/addEventListener\s*\(/g)) {
			const parenIndex = match.index + match[0].length - 1;
			const call = readBalanced(source, parenIndex, "(", ")");
			if (!call) continue;
			const event = /^\(\s*["'`]([\w-]+)["'`]/.exec(call);
			if (!event || !PASSIVE_DOM_EVENTS.has(event[1])) continue;
			if (/passive\s*:\s*(?:false|!1)/.test(call)) continue;
			if (!CALLS_PREVENT_DEFAULT.test(call)) continue;
			findings.push({
				file: file.path,
				line: lineOf(source, match.index),
				reason: `preventDefault in a passive "${event[1]}" listener; pass { passive: false } if it must cancel`,
			});
		}
	}

	return findings.sort(
		(a, b) => a.file.localeCompare(b.file) || a.line - b.line,
	);
}

async function collectFiles(directory, root) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (ignoredDirectories.has(entry.name)) continue;
		const absolute = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await collectFiles(absolute, root)));
		} else if (sourceExtensions.has(path.extname(entry.name))) {
			files.push(absolute);
		}
	}
	return files;
}

async function main() {
	const root = path.join(process.cwd(), "src");
	const absolutePaths = await collectFiles(root, root);
	const files = await Promise.all(
		absolutePaths.map(async (absolute) => ({
			path: path.relative(process.cwd(), absolute).replaceAll(path.sep, "/"),
			contents: await readFile(absolute, "utf8"),
		})),
	);

	const findings = findPassivePreventDefault(files);
	if (findings.length > 0) {
		console.error(
			"❌ preventDefault() inside a passive event handler:\n" +
				findings
					.map(
						(finding) =>
							`  ${finding.file}:${finding.line} — ${finding.reason}`,
					)
					.join("\n") +
				"\n\nThe call is ignored and the browser logs a warning for every event." +
				"\nUse `overscroll-behavior: contain` for scroll chaining, or register the" +
				"\nlistener yourself with { passive: false } if it truly must cancel.",
		);
		process.exitCode = 1;
		return;
	}

	console.log(
		`✅ No preventDefault in passive event handlers (${files.length} files scanned).`,
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
