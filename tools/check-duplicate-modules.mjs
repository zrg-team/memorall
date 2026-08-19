import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Rejects byte-identical modules under `src/`.
 *
 * `web-browser-protocol.ts` existed twice — 479 identical lines under
 * `services/web-browser/` and again under `flows-integrations/tools/web/` — with
 * one consumer for the copy. Adding a command to the protocol meant editing both
 * or silently breaking one, and nothing pointed that out.
 *
 * Small files are exempt: barrel re-exports and one-line stubs collide honestly
 * and often, and flagging them would train people to ignore this check.
 */
const MIN_SIZE_BYTES = 400;
const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const IGNORED_DIRECTORIES = new Set(["node_modules", "dist", "__snapshots__"]);

export function findDuplicateGroups(files) {
	const byDigest = new Map();
	for (const { path: filePath, contents } of files) {
		if (Buffer.byteLength(contents) < MIN_SIZE_BYTES) continue;
		const digest = createHash("sha256").update(contents).digest("hex");
		const group = byDigest.get(digest);
		if (group) {
			group.push(filePath);
		} else {
			byDigest.set(digest, [filePath]);
		}
	}
	return [...byDigest.values()]
		.filter((group) => group.length > 1)
		.map((group) => [...group].sort());
}

async function collectSourceFiles(directory) {
	const files = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (IGNORED_DIRECTORIES.has(entry.name)) continue;
			files.push(...(await collectSourceFiles(entryPath)));
			continue;
		}
		if (!SOURCE_EXTENSIONS.includes(path.extname(entry.name))) continue;
		files.push({
			path: entryPath,
			contents: await readFile(entryPath, "utf8"),
		});
	}
	return files;
}

async function main() {
	const root = path.join(
		path.dirname(fileURLToPath(import.meta.url)),
		"..",
		"src",
	);
	const duplicates = findDuplicateGroups(await collectSourceFiles(root));

	if (duplicates.length > 0) {
		const report = duplicates
			.map(
				(group) =>
					`  identical:\n${group
						.map((file) => `    ${path.relative(process.cwd(), file)}`)
						.join("\n")}`,
			)
			.join("\n");
		console.error(
			`❌ Found ${duplicates.length} set(s) of byte-identical modules under src/:\n${report}\nKeep one module and import it from the other location.`,
		);
		process.exitCode = 1;
		return;
	}

	console.log("✅ No byte-identical modules under src/.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main();
}
