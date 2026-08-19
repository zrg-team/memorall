import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Guards against a Windows-only regression that no test can observe.
 *
 * `windowsHide: true` sets `CREATE_NO_WINDOW`, but `CreateProcess` ignores that
 * flag when `DETACHED_PROCESS` is also present — which is what `detached: true`
 * sets. A console-subsystem child (`powershell.exe`, `cmd.exe`, `taskkill`) then
 * allocates a console of its own and flashes a window on the user's desktop.
 *
 * Detaching is still fine where it is genuinely needed, as long as Windows is
 * excluded: `detached: process.platform !== "win32"` is the accepted form, and
 * is what the managed browser runtimes use. Only an unconditional literal is
 * rejected here.
 */
const DETACHED_LITERAL = /\bdetached:\s*true\b/g;

export function findUnconditionalDetachedSpawns(source) {
	return [...source.matchAll(DETACHED_LITERAL)].map(({ index = 0 }) => {
		const line = source.slice(0, index).split("\n").length;
		return { index, line };
	});
}

async function walkTypeScript(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await walkTypeScript(entryPath)));
			continue;
		}
		if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
			files.push(entryPath);
		}
	}
	return files;
}

async function main() {
	const root = path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
		"apps",
		"desktop",
		"sidecar",
		"src",
	);
	const failures = [];
	for (const file of await walkTypeScript(root)) {
		const source = await readFile(file, "utf8");
		for (const { line } of findUnconditionalDetachedSpawns(source)) {
			failures.push(`${path.relative(process.cwd(), file)}:${line}`);
		}
	}

	if (failures.length > 0) {
		console.error(
			`❌ Found ${failures.length} unconditional \`detached: true\` spawn option(s) in the desktop sidecar:\n${failures
				.map((entry) => `  ${entry}`)
				.join(
					"\n",
				)}\nOn Windows this defeats \`windowsHide\` and flashes a console window. Use \`detached: process.platform !== "win32"\` instead, or drop the child process.`,
		);
		process.exitCode = 1;
		return;
	}

	console.log("✅ No unconditional detached spawns in the desktop sidecar.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
