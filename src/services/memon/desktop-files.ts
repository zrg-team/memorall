import {
	MEMON_BOT_FILE_NAME,
	MEMON_LEGACY_DESKTOP_DIR,
	MEMON_LEGACY_NOTES_FILE_NAME,
	MEMON_LEGACY_TERMINAL_FILE_NAME,
	MEMON_MEMORY_FILE_NAME,
	memonHomePaths,
} from "./constants";

/**
 * Bot.md and Memory.md in the agent's home. Bot.md is the user's own
 * instructions for the bot; Memory.md is what the bot remembers between
 * chats. Both are plain files the user and the bot can edit.
 */

export const MEMON_BOT_TEMPLATE = `# Bot.md

Write how MemonOS Bot should work for you: your goals, tone, rules, and what
it should always or never do. The bot reads this file at the start of every
chat.
`;

export const MEMON_MEMORY_TEMPLATE = `# Memory.md

What MemonOS Bot remembers between chats. The bot adds facts here as it learns
them; you can edit or delete anything.
`;

/** Longest part of each file that goes into the prompt. */
export const MEMON_DESKTOP_FILE_MAX_CHARS = 6_000;

export interface MemonDesktopFileIO {
	read(path: string): Promise<string>;
	write(path: string, content: string): Promise<void>;
}

export interface MemonDesktopFiles {
	bot: string;
	memory: string;
}

const readOrCreate = async (
	io: MemonDesktopFileIO,
	path: string,
	template: string,
	legacyPath: string,
): Promise<string> => {
	try {
		return await io.read(path);
	} catch {
		// A new home starts from the shared desktop's file when there is one,
		// so nothing written there before is lost; that file stays as it is.
		let initial = template;
		try {
			initial = await io.read(legacyPath);
		} catch {
			initial = template;
		}
		await io.write(path, initial);
		return initial;
	}
};

/**
 * Reads both files of an agent's home, creating them the first time.
 */
export const loadMemonDesktopFiles = async (
	io: MemonDesktopFileIO,
	home: string,
): Promise<MemonDesktopFiles> => {
	const paths = memonHomePaths(home);
	return {
		bot: await readOrCreate(
			io,
			paths.bot,
			MEMON_BOT_TEMPLATE,
			`${MEMON_LEGACY_DESKTOP_DIR}/${MEMON_BOT_FILE_NAME}`,
		),
		memory: await readOrCreate(
			io,
			paths.memory,
			MEMON_MEMORY_TEMPLATE,
			`${MEMON_LEGACY_DESKTOP_DIR}/${MEMON_MEMORY_FILE_NAME}`,
		),
	};
};

export interface MemonHomeFilesIO extends MemonDesktopFileIO {
	exists(path: string): Promise<boolean>;
	move(from: string, to: string): Promise<void>;
}

/** A name in `dir` nothing has yet: "Notes.md", else "Notes 2.md"… */
const freeFilePath = async (
	io: MemonHomeFilesIO,
	dir: string,
	stem: string,
	extension: string,
): Promise<string> => {
	for (let n = 1; ; n += 1) {
		const path = `${dir}/${stem}${n === 1 ? "" : ` ${n}`}${extension}`;
		if (!(await io.exists(path))) return path;
	}
};

/**
 * Moves what an older version kept in sight to the hidden files that hold
 * it now: my.notes becomes ~/.tasks (its steps one task; its free-form
 * notes, if any, go to Notes.md) and my.terminal ~/.terminal_history. A
 * hidden file that is already there wins; the old one is left alone.
 */
export const migrateMemonHomeFiles = async (
	io: MemonHomeFilesIO,
	home: string,
): Promise<void> => {
	const paths = memonHomePaths(home);
	const moves: Array<[string, string]> = [
		[`${home}/${MEMON_LEGACY_NOTES_FILE_NAME}`, paths.tasks],
		[`${home}/${MEMON_LEGACY_TERMINAL_FILE_NAME}`, paths.terminalHistory],
	];
	for (const [from, to] of moves) {
		try {
			if (!(await io.exists(from)) || (await io.exists(to))) continue;
			if (from.endsWith(MEMON_LEGACY_NOTES_FILE_NAME)) {
				const data = JSON.parse((await io.read(from)) || "{}") as {
					text?: unknown;
				};
				const text = typeof data.text === "string" ? data.text.trim() : "";
				if (text) {
					await io.write(
						await freeFilePath(io, home, "Notes", ".md"),
						`# Notes\n\n${text}\n`,
					);
				}
			}
			await io.move(from, to);
		} catch {
			// Another computer of this agent moved it first, or the old file is
			// not what it should be: it stays where it is.
		}
	}
};

// ── Entries ──────────────────────────────────────────────────────────────────
//
// The bot edits both files one entry at a time: an entry is a `- ` (or `* `)
// list item plus any indented lines under it. Everything else in the file —
// the heading, the user's own paragraphs — is left exactly as it is.

const ENTRY_START = /^ {0,3}[-*]\s+/;
const CONTINUATION = /^\s+\S/;

interface EntryBlock {
	start: number;
	end: number;
	text: string;
}

const parseEntries = (
	content: string,
): { lines: string[]; blocks: EntryBlock[] } => {
	const lines = content.replace(/\r\n/g, "\n").split("\n");
	const blocks: EntryBlock[] = [];
	for (let index = 0; index < lines.length; index += 1) {
		if (!ENTRY_START.test(lines[index])) continue;
		let end = index + 1;
		while (
			end < lines.length &&
			CONTINUATION.test(lines[end]) &&
			!ENTRY_START.test(lines[end])
		) {
			end += 1;
		}
		blocks.push({
			start: index,
			end,
			text: [
				lines[index].replace(ENTRY_START, ""),
				...lines.slice(index + 1, end).map((line) => line.trim()),
			].join(" "),
		});
		index = end - 1;
	}
	return { lines, blocks };
};

export const listDesktopEntries = (content: string): string[] =>
	parseEntries(content).blocks.map((block) => block.text);

/** Things that must never be kept in a file the model reads every chat. */
const SECRET_PATTERN =
	/(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(password|passwd|api[_ -]?key|secret|token)\s*[:=]\s*\S+)/i;

const toEntryLines = (text: string): string[] => {
	const [first, ...rest] = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	if (!first) throw new Error("An entry needs some text.");
	if (SECRET_PATTERN.test(text)) {
		throw new Error(
			"That looks like a password or key. Bot.md and Memory.md must not hold secrets.",
		);
	}
	return [`- ${first}`, ...rest.map((line) => `  ${line}`)];
};

export type MemonDesktopEntryChange =
	| { action: "list" }
	| { action: "add"; text: string }
	| { action: "update"; entry: number; text: string }
	| { action: "remove"; entry: number };

/** Applies one entry change; the rest of the file is kept as it is. */
export const changeDesktopEntries = (
	content: string,
	change: MemonDesktopEntryChange,
): string => {
	if (change.action === "list") return content;
	const { lines, blocks } = parseEntries(content);
	if (change.action === "add") {
		const kept = [...lines];
		while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
		// A blank line between the file's text and its first entry.
		const last = kept[kept.length - 1];
		if (last !== undefined && !blocks.length && !ENTRY_START.test(last)) {
			kept.push("");
		}
		return `${[...kept, ...toEntryLines(change.text)].join("\n")}\n`;
	}
	const block = blocks[change.entry - 1];
	if (!block) {
		throw new Error(
			`There is no entry ${change.entry}; the file has ${blocks.length}.`,
		);
	}
	const replacement =
		change.action === "update" ? toEntryLines(change.text) : [];
	return [
		...lines.slice(0, block.start),
		...replacement,
		...lines.slice(block.end),
	].join("\n");
};

/**
 * The file as it goes into the prompt, entries numbered so the bot can
 * update or remove one by number, or null while it is still the template.
 */
export const desktopFileForPrompt = (
	content: string,
	template: string,
): string | null => {
	const trimmed = content.trim();
	if (!trimmed || trimmed === template.trim()) return null;
	const { lines, blocks } = parseEntries(trimmed);
	const numbered = [...lines];
	blocks.forEach((block, index) => {
		numbered[block.start] = numbered[block.start].replace(
			ENTRY_START,
			`[${index + 1}] `,
		);
	});
	const text = numbered.join("\n");
	return text.length > MEMON_DESKTOP_FILE_MAX_CHARS
		? `${text.slice(0, MEMON_DESKTOP_FILE_MAX_CHARS)}\n… (the rest of the file is cut off; remove outdated entries)`
		: text;
};
