import {
	MEMON_LEGACY_USERS_DIR,
	memonAgentFolderName,
	memonHomeDir,
} from "./constants";

/**
 * Agents' homes, `/agents/<agent name>`: one per name, so names are unique;
 * made when the agent is, moved when it is renamed, and moved in from where
 * an older version kept it (`/.users/<agent id>/Desktop`).
 */

/** What the homes need from the files. */
export interface MemonHomeIO {
	list(
		dir: string,
	): Promise<Array<{ name: string; path: string; type: "file" | "dir" }>>;
	exists(path: string): Promise<boolean>;
	isDirectory(path: string): Promise<boolean>;
	move(from: string, to: string): Promise<void>;
	mkdir(path: string): Promise<void>;
	/** Removes a folder that has nothing in it. */
	removeEmptyDir(path: string): Promise<void>;
}

const nameKey = (name: string): string =>
	memonAgentFolderName(name).toLowerCase();

/**
 * A name no other agent has: the name itself, else "Name 1", "Name 2"… Two
 * names that make the same home folder (differing only in case or in what a
 * folder cannot hold) are the same name.
 */
export const uniqueAgentName = (
	name: string,
	taken: readonly string[],
): string => {
	const base = name.trim().replace(/\s+/g, " ") || "Agent";
	const used = new Set(taken.map(nameKey));
	if (!used.has(nameKey(base))) return base;
	for (let n = 1; ; n += 1) {
		const candidate = `${base} ${n}`;
		if (!used.has(nameKey(candidate))) return candidate;
	}
};

const removeIfEmpty = async (io: MemonHomeIO, dir: string): Promise<void> => {
	try {
		if (!(await io.list(dir)).length) await io.removeEmptyDir(dir);
	} catch {
		// Left in place: an empty folder does no harm.
	}
};

/**
 * Moves everything in `from` into `to`. What `to` already has stays: an entry
 * both have is left where it was, and folders both have are merged.
 */
const mergeInto = async (
	io: MemonHomeIO,
	from: string,
	to: string,
	skip: ReadonlySet<string> = new Set(),
): Promise<void> => {
	await io.mkdir(to);
	for (const entry of await io.list(from)) {
		if (skip.has(entry.name)) continue;
		const target = `${to}/${entry.name}`;
		if (!(await io.exists(target))) {
			await io.move(entry.path, target);
		} else if (entry.type === "dir" && (await io.isDirectory(target))) {
			await mergeInto(io, entry.path, target);
		}
	}
	await removeIfEmpty(io, from);
};

/**
 * Makes a home ready: the folder exists, and an older home of the agent's is
 * moved into it, its Desktop's files to the top (homes have no Desktop now).
 */
export const prepareMemonHome = async (
	io: MemonHomeIO,
	home: string,
	legacyHomes: readonly string[] = [],
): Promise<void> => {
	for (const legacy of legacyHomes) {
		if (legacy === home || !(await io.isDirectory(legacy))) continue;
		const desktop = `${legacy}/Desktop`;
		if (await io.isDirectory(desktop)) await mergeInto(io, desktop, home);
		// What stayed on the old Desktop (a file the home has too) stays there.
		await mergeInto(io, legacy, home, new Set(["Desktop"]));
		await removeIfEmpty(io, MEMON_LEGACY_USERS_DIR);
	}
	await io.mkdir(home);
};

/**
 * Moves a home after its agent was renamed, and returns the new one. Into a
 * folder that is already there, it is merged, keeping that folder's files.
 */
export const moveMemonHome = async (
	io: MemonHomeIO,
	fromName: string,
	toName: string,
): Promise<string> => {
	const from = memonHomeDir(fromName);
	const to = memonHomeDir(toName);
	if (from === to || !(await io.isDirectory(from))) return to;
	if (from.toLowerCase() === to.toLowerCase()) {
		// Only the case changed: go through another name, for file systems
		// that see both as one.
		const step = `${to}.${Date.now().toString(36)}`;
		await io.move(from, step);
		await io.move(step, to);
		return to;
	}
	if (await io.exists(to)) await mergeInto(io, from, to);
	else await io.move(from, to);
	return to;
};
