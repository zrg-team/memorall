/**
 * Where the fx terminal keeps what outlives it: the model and mode the user
 * picked, their prompt history, and their conversations. In MemonOS these
 * live in the agent's home, under `.fx/terminal/`, next to the rest of fx's
 * files there, so they survive the computer shutting down and show in Files.
 */

import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";

/** fx's own folder in the home. */
export const fxDir = (home: string): string => `${home}/.fx`;
const terminalDir = (home: string): string => `${fxDir(home)}/terminal`;

/** A prompt longer than this is not kept in the history. */
const MAX_HISTORY_RECORD_CHARS = 64 * 1024;

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

/** What the user typed at fx's prompt, per workspace, oldest first. */
export const createFxPromptHistoryStore = (
	fs: IFlowFileSystem,
	home: string,
) => {
	const path = `${terminalDir(home)}/history.jsonl`;
	const queue = serial();
	const parse = (text: string): HistoryRecord[] =>
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
	const records = async (): Promise<HistoryRecord[]> =>
		parse((await readText(fs, path)) ?? "");
	return {
		load: async (workspaceRoot: string, limit: number): Promise<string[]> =>
			(await records())
				.filter((record) => record.root === workspaceRoot)
				.slice(-Math.max(0, limit))
				.map((record) => record.value),
		append: (
			workspaceRoot: string,
			value: string,
			timestampMs: number,
		): Promise<"duplicate" | "record_too_large" | undefined> =>
			queue(async () => {
				if (value.length > MAX_HISTORY_RECORD_CHARS) return "record_too_large";
				const text = (await readText(fs, path)) ?? "";
				const mine = parse(text).filter(
					(record) => record.root === workspaceRoot,
				);
				if (mine.at(-1)?.value === value) return "duplicate";
				const line = `${JSON.stringify({ root: workspaceRoot, value, at: timestampMs })}\n`;
				// Written whole: the Memon file system appends only to a file that
				// is already there.
				await writeText(fs, path, text + line);
				return undefined;
			}),
		clear: (workspaceRoot: string): Promise<void> =>
			queue(async () => {
				const kept = (await records()).filter(
					(record) => record.root !== workspaceRoot,
				);
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
}

export const FX_SESSION_REVISION_CONFLICT = "FX_SESSION_REVISION_CONFLICT";

/** fx's saved conversations; `fx -c` continues the latest one. */
export const createFxSessionStore = (fs: IFlowFileSystem, home: string) => {
	const dir = `${terminalDir(home)}/sessions`;
	const indexPath = `${dir}/index.json`;
	const fileOf = (id: string) => `${dir}/${encodeURIComponent(id)}.fxsession`;
	const queue = serial();
	let seq = 0;
	const index = async (): Promise<Record<string, SessionIndexEntry>> => {
		try {
			const parsed = JSON.parse((await readText(fs, indexPath)) ?? "{}");
			return parsed && typeof parsed === "object" ? parsed : {};
		} catch {
			return {};
		}
	};
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
				entries[id] = { revision, updatedAtMs: Date.now() };
				await saveIndex(entries);
				return { revision };
			}),
		list: async (): Promise<Array<{ id: string; updatedAtMs: number }>> =>
			Object.entries(await index()).map(([id, entry]) => ({
				id,
				updatedAtMs: entry.updatedAtMs,
			})),
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
