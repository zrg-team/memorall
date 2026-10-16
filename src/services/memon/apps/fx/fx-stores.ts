/**
 * Where the fx terminal keeps what outlives it: the model and mode the user
 * picked, their prompt history, and their conversations. In MemonOS these
 * live in the agent's home, under `.fx/terminal/`, next to the rest of fx's
 * files there, so they survive the computer shutting down and show in Files.
 */

import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import type { MemonPiCodeFolder } from "../../types";

/** fx's own folder in the home. */
export const fxDir = (home: string): string => `${home}/.fx`;
const terminalDir = (home: string): string => `${fxDir(home)}/terminal`;

/** A prompt longer than this is not kept in the history. */
const MAX_HISTORY_RECORD_CHARS = 64 * 1024;
/** Folders the folder picker lists. */
const MAX_FOLDERS = 12;
const TITLE_CHARS = 120;

/** A file's text, or null when it cannot be read (it is not there yet). */
const readText = (fs: IFlowFileSystem, path: string): Promise<string | null> =>
	fs.readFile(path, { encoding: "utf8" }).catch(() => null);

const writeText = async (
	fs: IFlowFileSystem,
	path: string,
	text: string,
): Promise<void> => {
	await fs.mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
	await fs.writeFile(path, text);
};

/** Runs one change at a time, so read-modify-write never interleaves. */
const serial = () => {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(work: () => Promise<T>): Promise<T> => {
		const next = tail.then(work, work);
		tail = next.catch(() => {});
		return next;
	};
};

/** The model and mode fx restores on start. */
export const createFxConfigStore = (fs: IFlowFileSystem, home: string) => {
	const path = `${terminalDir(home)}/config.json`;
	const queue = serial();
	const load = async (): Promise<Record<string, string>> => {
		try {
			const parsed = JSON.parse((await readText(fs, path)) ?? "{}");
			return parsed && typeof parsed === "object" ? parsed : {};
		} catch {
			return {};
		}
	};
	return {
		get: (id: string): Promise<string | null> =>
			load().then((values) =>
				typeof values[id] === "string" ? values[id] : null,
			),
		set: (id: string, value: string): Promise<void> =>
			queue(async () => {
				const values = await load();
				values[id] = value;
				await writeText(fs, path, `${JSON.stringify(values, null, "\t")}\n`);
			}),
	};
};

interface HistoryRecord {
	root: string;
	value: string;
	at: number;
}

const historyPath = (home: string): string =>
	`${terminalDir(home)}/history.jsonl`;

const parseHistory = (text: string): HistoryRecord[] =>
	text
		.split("\n")
		.filter(Boolean)
		.flatMap((line) => {
			try {
				const record = JSON.parse(line) as HistoryRecord;
				return typeof record.value === "string" &&
					typeof record.root === "string"
					? [record]
					: [];
			} catch {
				return [];
			}
		});

/**
 * What the user typed at fx's prompt in the folder it works in, oldest
 * first. fx's WebAssembly terminal names every workspace `/`, so the folder
 * is the one this fx was started in, not the one fx passes.
 */
export const createFxPromptHistoryStore = (
	fs: IFlowFileSystem,
	home: string,
	cwd: string,
) => {
	const path = historyPath(home);
	const queue = serial();
	const parse = parseHistory;
	const records = async (): Promise<HistoryRecord[]> =>
		parse((await readText(fs, path)) ?? "");
	return {
		load: async (_workspaceRoot: string, limit: number): Promise<string[]> =>
			(await records())
				.filter((record) => record.root === cwd)
				.slice(-Math.max(0, limit))
				.map((record) => record.value),
		append: (
			_workspaceRoot: string,
			value: string,
			timestampMs: number,
		): Promise<"duplicate" | "record_too_large" | undefined> =>
			queue(async () => {
				if (value.length > MAX_HISTORY_RECORD_CHARS) return "record_too_large";
				const text = (await readText(fs, path)) ?? "";
				const mine = parse(text).filter((record) => record.root === cwd);
				if (mine.at(-1)?.value === value) return "duplicate";
				const line = `${JSON.stringify({ root: cwd, value, at: timestampMs })}\n`;
				// Written whole: the Memon file system appends only to a file that
				// is already there.
				await writeText(fs, path, text + line);
				return undefined;
			}),
		clear: (_workspaceRoot: string): Promise<void> =>
			queue(async () => {
				const kept = (await records()).filter((record) => record.root !== cwd);
				await writeText(
					fs,
					path,
					kept.map((record) => `${JSON.stringify(record)}\n`).join(""),
				);
			}),
	};
};

interface SessionIndexEntry {
	revision: string;
	updatedAtMs: number;
	/** The folder fx worked in; the home for sessions saved before it was kept. */
	cwd?: string;
}

const sessionsDir = (home: string): string => `${terminalDir(home)}/sessions`;

const readSessionIndex = async (
	fs: IFlowFileSystem,
	home: string,
): Promise<Record<string, SessionIndexEntry>> => {
	try {
		const parsed = JSON.parse(
			(await readText(fs, `${sessionsDir(home)}/index.json`)) ?? "{}",
		);
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
};

export const FX_SESSION_REVISION_CONFLICT = "FX_SESSION_REVISION_CONFLICT";

/** fx's saved conversations; `fx -c` continues the latest one. */
export const createFxSessionStore = (
	fs: IFlowFileSystem,
	home: string,
	cwd: string,
) => {
	const dir = sessionsDir(home);
	const indexPath = `${dir}/index.json`;
	const fileOf = (id: string) => `${dir}/${encodeURIComponent(id)}.fxsession`;
	const queue = serial();
	let seq = 0;
	const index = () => readSessionIndex(fs, home);
	const saveIndex = (entries: Record<string, SessionIndexEntry>) =>
		writeText(fs, indexPath, `${JSON.stringify(entries, null, "\t")}\n`);

	return {
		load: async (
			id: string,
		): Promise<{ bytes: Uint8Array; revision: string } | null> => {
			const entry = (await index())[id];
			if (!entry) return null;
			const bytes = await fs.readFile(fileOf(id)).catch(() => null);
			return bytes ? { bytes, revision: entry.revision } : null;
		},
		commit: (
			id: string,
			bytes: Uint8Array,
			expectedRevision: string | undefined,
		): Promise<{ revision: string }> =>
			queue(async () => {
				const entries = await index();
				if (entries[id]?.revision !== expectedRevision) {
					throw Object.assign(
						new Error(`fx session ${id} changed since it was read.`),
						{
							code: FX_SESSION_REVISION_CONFLICT,
						},
					);
				}
				const revision = `${Date.now().toString(36)}-${(++seq).toString(36)}`;
				await fs.mkdir(dir, { recursive: true });
				await fs.writeFile(fileOf(id), bytes);
				entries[id] = { revision, updatedAtMs: Date.now(), cwd };
				await saveIndex(entries);
				return { revision };
			}),
		// A folder's own conversations: what /resume lists and `--resume last`
		// continues.
		list: async (): Promise<Array<{ id: string; updatedAtMs: number }>> =>
			Object.entries(await index())
				.filter(([, entry]) => (entry.cwd ?? home) === cwd)
				.map(([id, entry]) => ({ id, updatedAtMs: entry.updatedAtMs })),
		remove: (id: string): Promise<void> =>
			queue(async () => {
				const entries = await index();
				if (!entries[id]) return;
				delete entries[id];
				await saveIndex(entries);
				// Out of the index it is gone for fx; a file left behind is harmless.
				await fs.unlink(fileOf(id)).catch(() => {});
			}),
	};
};

/**
 * The folders fx kept conversations in, the one used last first, for the
 * folder picker. Each is labelled with the last prompt typed there. Folders
 * gone from disk are left out.
 */
export const listFxFolders = async (
	fs: IFlowFileSystem,
	home: string,
): Promise<MemonPiCodeFolder[]> => {
	const byPath = new Map<string, MemonPiCodeFolder>();
	for (const [id, entry] of Object.entries(await readSessionIndex(fs, home))) {
		const path = entry.cwd ?? home;
		const known = byPath.get(path);
		if (!known) {
			byPath.set(path, {
				path,
				lastUsed: entry.updatedAtMs,
				sessions: 1,
				latest: { file: id },
			});
			continue;
		}
		known.sessions += 1;
		if (entry.updatedAtMs > known.lastUsed) {
			known.lastUsed = entry.updatedAtMs;
			known.latest = { file: id };
		}
	}
	const recent = [...byPath.values()]
		.sort((a, b) => b.lastUsed - a.lastUsed)
		.slice(0, MAX_FOLDERS);
	const lastPrompt = new Map<string, string>();
	for (const record of parseHistory(
		(await readText(fs, historyPath(home))) ?? "",
	)) {
		lastPrompt.set(record.root, record.value);
	}
	const there = await Promise.all(
		recent.map((folder) =>
			fs.stat(folder.path).then(
				(stat) => stat.isDirectory(),
				() => false,
			),
		),
	);
	return recent
		.filter((_, index) => there[index])
		.map((folder) => {
			const prompt = lastPrompt.get(folder.path)?.replace(/\s+/g, " ").trim();
			if (!prompt) return folder;
			const title =
				prompt.length > TITLE_CHARS
					? `${prompt.slice(0, TITLE_CHARS - 1)}…`
					: prompt;
			return { ...folder, latest: { ...folder.latest, title } };
		});
};
