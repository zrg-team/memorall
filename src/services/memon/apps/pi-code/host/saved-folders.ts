import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import type { MemonPiCodeFolder } from "../../../types";
import {
	getDefaultSessionDir,
	parseSessionEntries,
	savedSessionInfo,
} from "../coding-agent/core/session-manager";
import { join } from "../platform/path";
import { PI_CONFIG_DIR } from "./resources";

/** Folders the picker lists: each costs a read of its latest session. */
const MAX_FOLDERS = 12;
/** A folder's sessions checked for the one pi wrote to last. */
const RECENT_SESSIONS = 10;
const TITLE_CHARS = 120;

const shorten = (text: string): string => {
	const line = text.replace(/\s+/g, " ").trim();
	return line.length > TITLE_CHARS
		? `${line.slice(0, TITLE_CHARS - 1)}…`
		: line;
};

/** A folder's sessions, the one pi wrote to last first. */
const sessionsIn = async (
	fs: IFlowFileSystem,
	dir: string,
): Promise<{ files: string[]; count: number }> => {
	// Named by when they started, so the last names are the newest.
	const names = (await fs.readdir(dir).catch(() => [] as string[]))
		.filter((name) => name.endsWith(".jsonl"))
		.sort()
		.reverse();
	const recent = await Promise.all(
		names.slice(0, RECENT_SESSIONS).map(async (name, order) => {
			const path = join(dir, name);
			const modified = await fs.stat(path).then(
				(stat) => stat.mtime.getTime(),
				() => 0,
			);
			return { path, modified, order };
		}),
	);
	recent.sort((a, b) => b.modified - a.modified || a.order - b.order);
	return { files: recent.map((session) => session.path), count: names.length };
};

/**
 * The folders pi saved sessions in (~/.pi/agent/sessions), the one used
 * last first, each with the session pi wrote to last there, to continue.
 * Only that session is read: its header names the folder. Folders gone
 * from disk are left out. With `cwd`, only that folder's sessions.
 */
export const listSavedFolders = async (
	fs: IFlowFileSystem,
	home: string,
	cwd?: string,
): Promise<MemonPiCodeFolder[]> => {
	const agentDir = join(home, PI_CONFIG_DIR, "agent");
	const root = join(agentDir, "sessions");
	const dirs = cwd
		? [getDefaultSessionDir(cwd, agentDir)]
		: (await fs.readdir(root, { withFileTypes: true }).catch(() => []))
				.filter((entry) => entry.isDirectory())
				.map((entry) => join(root, entry.name));
	const listed = await Promise.all(
		dirs.map(async (dir) => {
			const names = (await fs.readdir(dir).catch(() => [] as string[]))
				.filter((name) => name.endsWith(".jsonl"))
				.sort();
			const newest = names.at(-1);
			return newest ? { dir, newest } : null;
		}),
	);
	const candidates = listed
		.filter((item): item is { dir: string; newest: string } => item !== null)
		.sort((a, b) => b.newest.localeCompare(a.newest))
		.slice(0, MAX_FOLDERS);
	const folders = await Promise.all(
		candidates.map(async ({ dir }): Promise<MemonPiCodeFolder | null> => {
			const { files, count } = await sessionsIn(fs, dir);
			const file = files[0];
			if (!file) return null;
			const content = await fs
				.readFile(file, { encoding: "utf8" })
				.catch(() => undefined);
			const info = content
				? savedSessionInfo(file, parseSessionEntries(content))
				: null;
			if (!info?.cwd || (cwd && info.cwd !== cwd)) return null;
			const there = await fs.stat(info.cwd).then(
				(stat) => stat.isDirectory(),
				() => false,
			);
			if (!there) return null;
			const title =
				info.name ?? (info.messageCount ? info.firstMessage : undefined);
			return {
				path: info.cwd,
				lastUsed: info.modified.getTime(),
				sessions: count,
				latest: { file, title: title ? shorten(title) : undefined },
			};
		}),
	);
	const byPath = new Map<string, MemonPiCodeFolder>();
	for (const folder of folders) {
		if (!folder) continue;
		const known = byPath.get(folder.path);
		if (!known || known.lastUsed < folder.lastUsed)
			byPath.set(folder.path, folder);
	}
	return [...byPath.values()].sort((a, b) => b.lastUsed - a.lastUsed);
};
