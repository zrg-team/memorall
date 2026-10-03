import type { MemonNoteStatus } from "./types";

/**
 * A `.notes` file: the Notes app's checklist and notes, as JSON. Notes keeps
 * ~/my.notes current as it changes; the user can open any `.notes` file in
 * Notes, or read and edit it as text.
 *
 * {
 *   "items": [{ "text": "Search sources", "status": "done" }],
 *   "text": "Findings, sources, decisions…"
 * }
 */
export interface MemonNotesFile {
	items: Array<{ text: string; status: MemonNoteStatus }>;
	text: string;
}

const STATUSES: ReadonlySet<string> = new Set(["todo", "doing", "done"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads a `.notes` file; an empty one is empty notes. Throws on anything else. */
export const parseNotesFile = (content: string): MemonNotesFile => {
	if (!content.trim()) return { items: [], text: "" };
	let data: unknown;
	try {
		data = JSON.parse(content);
	} catch (error) {
		throw new Error(
			`it is not valid JSON (${error instanceof Error ? error.message : String(error)})`,
		);
	}
	if (!isRecord(data)) {
		throw new Error('it must be a JSON object with "items" and "text"');
	}
	const items = Array.isArray(data.items) ? data.items : [];
	return {
		items: items.flatMap((item) => {
			// A step may be written as just its text.
			const text =
				typeof item === "string" ? item : isRecord(item) ? item.text : "";
			if (typeof text !== "string" || !text.trim()) return [];
			const status =
				isRecord(item) &&
				typeof item.status === "string" &&
				STATUSES.has(item.status)
					? (item.status as MemonNoteStatus)
					: "todo";
			return [{ text: text.trim(), status }];
		}),
		text: typeof data.text === "string" ? data.text : "",
	};
};

export const serializeNotesFile = (notes: MemonNotesFile): string =>
	`${JSON.stringify(
		{
			items: notes.items.map(({ text, status }) => ({ text, status })),
			text: notes.text,
		},
		null,
		2,
	)}\n`;
