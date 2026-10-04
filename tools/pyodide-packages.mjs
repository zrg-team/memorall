/*
 Bundles Python packages for the sandbox's `py` command (Pyodide).

 Pyodide's npm package has the interpreter and the standard library, but no
 package wheels: those live on Pyodide's CDN. An extension must not load code
 from a server while it runs, so the packages listed in
 src/services/sandbox-container/python-packages.json are downloaded here, at
 build time, checked against a pinned sha256, cached under node_modules/.cache,
 and copied next to the interpreter.

 Packages come from two places: Pyodide's own index (its lock file has the
 hash), and pure-Python wheels from PyPI that Pyodide does not build (the
 config pins their version, file and hash, and says what they import and
 depend on). Both end up in the lock file shipped with them, which lists only
 what was bundled: `import numpy` loads the local wheel and an import of
 anything else fails as "No module named …".

 Without a network (and no cache), the build goes on without the packages:
 `py` still runs the standard library.
*/

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const CDN = (version) => `https://cdn.jsdelivr.net/pyodide/v${version}/full/`;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** A package name as the lock file keys it: "jsonschema_specifications" → "jsonschema-specifications". */
const lockKey = (name) => name.toLowerCase().replace(/[-_.]+/g, "-");

/**
 * A pinned PyPI wheel as a lock file entry, the shape Pyodide's own pure-Python
 * packages have, so it loads and auto-loads the same way.
 */
const toLockEntry = (wheel) => ({
	name: lockKey(wheel.name),
	version: wheel.version,
	file_name: wheel.file,
	install_dir: "site",
	sha256: wheel.sha256,
	package_type: "package",
	imports: wheel.imports,
	depends: (wheel.depends ?? []).map(lockKey),
	unvendored_tests: false,
	source: "pypi",
});

/** The packages and everything they depend on, by the lock file. */
const withDependencies = (lock, requested) => {
	const closure = new Set();
	const visit = (name) => {
		const key = lockKey(name);
		if (closure.has(key)) return;
		const entry = lock.packages[key];
		if (!entry) {
			throw new Error(
				`"${name}" is neither in Pyodide's index nor a pinned PyPI wheel.`,
			);
		}
		closure.add(key);
		for (const dependency of entry.depends ?? []) visit(dependency);
	};
	for (const name of requested) visit(name);
	return [...closure].sort();
};

/** Where a pinned PyPI wheel downloads from, by PyPI's own listing of that release. */
const pypiUrl = async (entry) => {
	const response = await fetch(
		`https://pypi.org/pypi/${entry.name}/${entry.version}/json`,
	);
	if (!response.ok)
		throw new Error(`${entry.name}: PyPI HTTP ${response.status}`);
	const release = await response.json();
	const file = release.urls.find((item) => item.filename === entry.file_name);
	if (!file) throw new Error(`${entry.file_name}: not in the PyPI release`);
	return file.url;
};

/** A wheel's bytes: from the cache when its hash still matches, else downloaded. */
const fetchWheel = async (entry, version, cacheDir) => {
	const cached = path.join(cacheDir, entry.file_name);
	if (fs.existsSync(cached)) {
		const bytes = fs.readFileSync(cached);
		if (sha256(bytes) === entry.sha256) return bytes;
	}
	const url =
		entry.source === "pypi"
			? await pypiUrl(entry)
			: `${CDN(version)}${entry.file_name}`;
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`${entry.file_name}: HTTP ${response.status}`);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	if (sha256(bytes) !== entry.sha256) {
		throw new Error(`${entry.file_name}: checksum does not match the pin`);
	}
	fs.mkdirSync(cacheDir, { recursive: true });
	fs.writeFileSync(cached, bytes);
	return bytes;
};

/**
 * Writes the wheels and a lock file listing only them into `outDir`.
 * Returns the names bundled.
 */
export async function bundlePyodidePackages({
	pyodideDir,
	outDir,
	configFile,
}) {
	const pyodideLock = JSON.parse(
		fs.readFileSync(path.join(pyodideDir, "pyodide-lock.json"), "utf8"),
	);
	const { packages: requested, pypi = [] } = JSON.parse(
		fs.readFileSync(configFile, "utf8"),
	);
	const lock = {
		info: pyodideLock.info,
		packages: {
			...pyodideLock.packages,
			...Object.fromEntries(
				pypi.map((wheel) => [lockKey(wheel.name), toLockEntry(wheel)]),
			),
		},
	};
	// The lock file stopped naming the version (0.29); the package always does.
	const { version } = JSON.parse(
		fs.readFileSync(path.join(pyodideDir, "package.json"), "utf8"),
	);
	const cacheDir = path.resolve(
		process.cwd(),
		"node_modules/.cache/pyodide-packages",
		version,
	);
	const names = withDependencies(lock, requested);

	// A wheel left by an earlier build with a longer list goes.
	if (fs.existsSync(outDir)) {
		for (const file of fs.readdirSync(outDir)) {
			if (/\.(whl|zip)$/.test(file) && file !== "python_stdlib.zip") {
				fs.rmSync(path.join(outDir, file), { force: true });
			}
		}
	}

	const bundled = {};
	try {
		for (const name of names) {
			const entry = lock.packages[name];
			fs.mkdirSync(outDir, { recursive: true });
			fs.writeFileSync(
				path.join(outDir, entry.file_name),
				await fetchWheel(entry, version, cacheDir),
			);
			const { source: _source, ...shipped } = entry;
			bundled[name] = shipped;
		}
	} catch (error) {
		console.warn(
			`⚠️  Python packages not bundled (${error.message}); py keeps the standard library only.\n`,
		);
		for (const entry of Object.values(bundled)) {
			fs.rmSync(path.join(outDir, entry.file_name), { force: true });
		}
		for (const name of Object.keys(bundled)) delete bundled[name];
	}

	fs.writeFileSync(
		path.join(outDir, "pyodide-lock.json"),
		JSON.stringify({ info: lock.info, packages: bundled }),
	);
	const bytes = Object.values(bundled).reduce(
		(total, entry) =>
			total + fs.statSync(path.join(outDir, entry.file_name)).size,
		0,
	);
	console.log(
		`✅ Python packages bundled: ${Object.keys(bundled).join(", ") || "none"} (${(bytes / 1024 / 1024).toFixed(1)} MB)\n`,
	);
	return Object.keys(bundled);
}
