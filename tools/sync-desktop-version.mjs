// Keeps the desktop application's version equal to the root package.json.
//
// The extension already has a single source of truth: build-manifest.mjs writes
// package.json's version into manifest.json. The desktop build had none — the
// version lived, hardcoded, in three files at once, so a release bump moved the
// extension to 0.5.4 while the installer, the about box and the build log kept
// saying 0.5.1.
//
// Tauri can read its version from a package.json directly, but Cargo cannot, and
// the crate version is what `cargo build` prints and what the lockfile records.
// So this writes all three rather than leaving two of them to drift.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauriDirectory = join(root, "apps", "desktop", "src-tauri");

/** `version = "0.5.1"` in the `[package]` table, and only there. */
export const setCargoVersion = (source, version) =>
	source.replace(
		/(\[package\][^[]*?\bversion\s*=\s*")[^"]*(")/,
		`$1${version}$2`,
	);

/** The `memorall-desktop` entry in Cargo.lock, and only that entry. */
export const setCargoLockVersion = (source, version) =>
	source.replace(
		/(name = "memorall-desktop"\nversion = ")[^"]*(")/,
		`$1${version}$2`,
	);

export const setTauriConfigVersion = (source, version) =>
	source.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);

const targets = [
	{ file: join(tauriDirectory, "Cargo.toml"), apply: setCargoVersion },
	{ file: join(tauriDirectory, "Cargo.lock"), apply: setCargoLockVersion },
	{
		file: join(tauriDirectory, "tauri.conf.json"),
		apply: setTauriConfigVersion,
	},
];

const run = (checkOnly) => {
	const { version } = JSON.parse(
		readFileSync(join(root, "package.json"), "utf8"),
	);
	const stale = [];

	for (const { file, apply } of targets) {
		const source = readFileSync(file, "utf8");
		const next = apply(source, version);
		if (next === source) continue;
		stale.push(file.slice(root.length + 1).replace(/\\/g, "/"));
		if (!checkOnly) writeFileSync(file, next, "utf8");
	}

	if (stale.length === 0) {
		console.log(`✅ Desktop version matches package.json (${version})`);
		return 0;
	}

	if (checkOnly) {
		console.error(
			`❌ Desktop version is not ${version}. Run \`yarn sync:desktop:version\` and commit:\n  ${stale.join("\n  ")}`,
		);
		return 1;
	}

	console.log(`✅ Desktop version set to ${version}:\n  ${stale.join("\n  ")}`);
	return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exit(run(process.argv.includes("--check")));
}
