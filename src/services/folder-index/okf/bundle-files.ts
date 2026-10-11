import { OKF_VERSION } from "../constants";

/**
 * The two reserved files of a bundle (OKF §3.1): `index.md`, what a folder
 * holds (§8), and `log.md`, what changed (§9).
 */

export interface IndexEntry {
	/** Link target, relative to the folder: "invoice.pdf.md" or "sub/". */
	href: string;
	title: string;
	description?: string;
	/** Shown before the description, e.g. the concept type. */
	label?: string;
}

const escapeLinkText = (text: string): string =>
	text.replace(/[[\]\\]/g, (character) => `\\${character}`);

const encodeHref = (href: string): string =>
	href
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/");

const entryLine = (entry: IndexEntry): string => {
	const detail = [entry.label, entry.description].filter(Boolean).join(": ");
	return `* [${escapeLinkText(entry.title)}](${encodeHref(entry.href)})${detail ? ` - ${detail.replace(/\s+/g, " ").trim()}` : ""}`;
};

/**
 * A folder's index.md: its subfolders, then its files. Only the bundle root
 * carries frontmatter, and only `okf_version` (§8, §12).
 */
export const renderIndexFile = (options: {
	title: string;
	isBundleRoot: boolean;
	folders: IndexEntry[];
	files: IndexEntry[];
}): string => {
	const sections: string[] = [];
	if (options.isBundleRoot)
		sections.push(`---\nokf_version: "${OKF_VERSION}"\n---`);
	sections.push(`# ${options.title}`);
	if (options.folders.length) {
		sections.push(
			["# Folders", "", ...options.folders.map(entryLine)].join("\n"),
		);
	}
	if (options.files.length) {
		sections.push(["# Files", "", ...options.files.map(entryLine)].join("\n"));
	}
	if (!options.folders.length && !options.files.length) {
		sections.push("No indexed files yet.");
	}
	return `${sections.join("\n\n")}\n`;
};

/** One line of a log day: `**Update**: Changed [a](a.md).` */
export interface LogEntry {
	kind: "Creation" | "Update" | "Removal" | "Initialization" | "Deprecation";
	text: string;
}

/** Date groups kept in a log; older ones are dropped. */
const MAX_LOG_DAYS = 90;

/**
 * Adds a day's entries to a log, newest first, with ISO date headings (§9).
 * Entries for a day that already has a heading join it, at the top.
 */
export const appendLogEntries = (
	existing: string,
	date: Date,
	entries: LogEntry[],
	title = "Index Update Log",
): string => {
	const day = date.toISOString().slice(0, 10);
	const days = new Map<string, string[]>();
	const order: string[] = [];
	let current: string | null = null;
	for (const line of existing.split(/\r?\n/)) {
		const heading = /^##\s+(\d{4}-\d{2}-\d{2})\s*$/.exec(line);
		if (heading) {
			current = heading[1];
			if (!days.has(current)) {
				days.set(current, []);
				order.push(current);
			}
			continue;
		}
		if (current && line.trim().startsWith("*"))
			days.get(current)?.push(line.trim());
	}

	if (entries.length) {
		const lines = entries.map((entry) => `* **${entry.kind}**: ${entry.text}`);
		days.set(day, [...lines, ...(days.get(day) ?? [])]);
		if (!order.includes(day)) order.push(day);
	}

	const sorted = [...new Set(order)]
		.sort((left, right) => right.localeCompare(left))
		.slice(0, MAX_LOG_DAYS);
	const body = sorted
		.filter((key) => days.get(key)?.length)
		.map((key) => [`## ${key}`, ...(days.get(key) ?? [])].join("\n"));
	return `${[`# ${title}`, ...body].join("\n\n")}\n`;
};

/** Names in a log line, with "and N more" past a few. */
export const summarizeNames = (names: string[], shown = 5): string => {
	const listed = names.slice(0, shown).join(", ");
	return names.length > shown
		? `${listed} and ${names.length - shown} more`
		: listed;
};
