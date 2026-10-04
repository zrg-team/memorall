import config from "./python-packages.json";

/**
 * The Python packages that ship with the sandbox's `py` command, beyond the
 * standard library, by their pip names. The build downloads them (and what
 * they depend on) from Pyodide's own package index, or as pinned pure-Python
 * wheels from PyPI, checks each against its hash, and bundles them: nothing
 * is fetched while the app runs, and pip cannot add more. Change the list in
 * `python-packages.json` (see tools/pyodide-packages.mjs).
 */
export const BUNDLED_PYTHON_PACKAGES: readonly string[] = config.packages;

/**
 * The same packages for an agent or a person to read: what to import, and
 * what for where the name does not say. Kept next to the list it describes.
 */
export const BUNDLED_PYTHON_SUMMARY: string = config.summary;

/** What they cover, in a few words, for a prompt with little room. */
export const BUNDLED_PYTHON_BRIEF: string = config.brief;

/** How a package is used here when that differs from its usual docs. */
export interface PythonPackageUsage {
	/** The pip name, as `pip show` takes it. */
	name: string;
	/** The modules a script imports it by. */
	imports: readonly string[];
	note: string;
}

export const BUNDLED_PYTHON_USAGE: readonly PythonPackageUsage[] =
	Object.entries(config.usage).map(([name, usage]) => ({ name, ...usage }));

const pipKey = (name: string) => name.toLowerCase().replace(/[-_.]+/g, "-");

/** A package's usage note, by its pip name or a module it is imported by. */
export const pythonPackageUsage = (
	name: string,
): PythonPackageUsage | undefined =>
	BUNDLED_PYTHON_USAGE.find(
		(usage) =>
			pipKey(usage.name) === pipKey(name) || usage.imports.includes(name),
	);

/** How to use them in the sandbox, one tip each, for the agent. */
export const BUNDLED_PYTHON_NOTES: readonly string[] = [
	...config.notes,
	`Some packages work differently here; \`pip show <name>\` says how (${BUNDLED_PYTHON_USAGE.map((usage) => usage.name).join(", ")}).`,
];
