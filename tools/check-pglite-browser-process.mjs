import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OFFENDING_ACCESS =
	/globalThis\.process\?\.env.{0,80}?(?<!globalThis\.)process\.exitCode/gs;
const EXIT_CODE_ACCESS = /globalThis\.process\.exitCode/g;
const GUARDED_EXIT_CODE_ACCESS =
	/globalThis\.process&&\([^)]{0,80}?globalThis\.process\.exitCode/g;

export function findUnsafeBrowserProcessAccesses(source) {
	const unsafe = [...source.matchAll(OFFENDING_ACCESS)].map(
		({ index = 0, 0: match }) => ({
			index,
			match: match.replace(/\s+/g, " "),
		}),
	);
	const accesses = [...source.matchAll(EXIT_CODE_ACCESS)];
	const guardedAccesses = [...source.matchAll(GUARDED_EXIT_CODE_ACCESS)];
	if (accesses.length !== guardedAccesses.length) {
		unsafe.push({
			index: accesses[0]?.index ?? 0,
			match: `${accesses.length} globalThis.process.exitCode access(es), but only ${guardedAccesses.length} are protected by a runtime globalThis.process check`,
		});
	}
	return unsafe;
}

async function assertSafeFile(filePath, label = filePath) {
	const source = await readFile(filePath, "utf8");
	const unsafe = findUnsafeBrowserProcessAccesses(source);
	if (unsafe.length > 0) {
		throw new Error(
			`${label}: found ${unsafe.length} PGlite browser branch(es) that guard globalThis.process but then read the undefined bare process global:\n${unsafe
				.map(({ index, match }) => `- byte ${index}: ${match}`)
				.join("\n")}`,
		);
	}
}

async function walkJavaScript(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await walkJavaScript(entryPath)));
		else if (/\.(?:c|m)?js$/.test(entry.name)) files.push(entryPath);
	}
	return files;
}

export async function checkPgliteBrowserProcess({
	root = process.cwd(),
	artifactDirectory,
} = {}) {
	const packageRoot = path.join(
		root,
		"node_modules",
		"@electric-sql",
		"pglite",
		"dist",
	);
	// Vite, Web, Extension, and Tauri all consume the ESM browser entry. The
	// CommonJS entry is Node-only, where `process` is present, and is deliberately
	// left pristine to keep the generated-package patch to the consumed bundle.
	for (const entry of ["index.js"]) {
		await assertSafeFile(path.join(packageRoot, entry), `PGlite ${entry}`);
	}

	if (artifactDirectory) {
		for (const filePath of await walkJavaScript(artifactDirectory)) {
			await assertSafeFile(filePath, path.relative(root, filePath));
		}
	}
}

const isMain =
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(new URL(import.meta.url));

if (isMain) {
	const artifactArgument = process.argv[2];
	await checkPgliteBrowserProcess({
		artifactDirectory: artifactArgument
			? path.resolve(artifactArgument)
			: undefined,
	});
	console.log(
		artifactArgument
			? `PGlite browser process guard passed for the installed package and ${artifactArgument}.`
			: "PGlite browser process guard passed for the installed ESM browser entry point.",
	);
}
