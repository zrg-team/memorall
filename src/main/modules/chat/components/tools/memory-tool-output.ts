/**
 * Parses what the active-memory tools print.
 *
 * They answer in a flat `key: value` block per memory, several separated by
 * `---`, optionally behind a lead-in line ("Remembered memory:"). Rendered raw
 * that is a wall of ids and internal field names in the middle of a
 * conversation — exactly what it looked like in the transcript. Parsing it back
 * into fields lets the card show the fact first and keep the bookkeeping where
 * it belongs.
 *
 * Kept separate from the component so the shape the tools emit is pinned by
 * tests rather than by a screenshot. See `formatMemoryFact` in
 * `src/services/flows-memory/tools/active-memory/shared.ts` for the writer.
 */

export interface ParsedMemoryFact {
	id?: string;
	kind?: string;
	source?: string;
	status?: string;
	fact?: string;
	relation?: string;
	/** Anything the writer adds that this parser does not know by name. */
	extras: Array<{ label: string; value: string }>;
}

export interface ParsedMemoryOutput {
	/** "Remembered memory", "Updated memory" — present only when the tool wrote one. */
	lead?: string;
	facts: ParsedMemoryFact[];
	/** A plain sentence with no fields, e.g. "No matching memories found." */
	message?: string;
}

const KNOWN_KEYS = new Set([
	"id",
	"kind",
	"source",
	"status",
	"fact",
	"relation",
]);

const FIELD_LINE = /^([a-z_][a-z0-9_ ]*):\s*(.*)$/i;

const humanizeLabel = (key: string): string =>
	key.replace(/_/g, " ").replace(/^\w/, (letter) => letter.toUpperCase());

const parseFactBlock = (block: string): ParsedMemoryFact | null => {
	const fact: ParsedMemoryFact = { extras: [] };
	let matched = 0;

	for (const rawLine of block.split("\n")) {
		const line = rawLine.trim();
		if (!line) continue;
		const match = line.match(FIELD_LINE);
		if (!match) {
			// A continuation of the previous value — fact text can wrap.
			if (fact.fact) fact.fact = `${fact.fact}\n${line}`;
			continue;
		}
		matched += 1;
		const key = match[1].trim().toLowerCase();
		const value = match[2].trim();
		if (KNOWN_KEYS.has(key)) {
			fact[key as keyof Omit<ParsedMemoryFact, "extras">] = value;
			continue;
		}
		fact.extras.push({ label: humanizeLabel(match[1].trim()), value });
	}

	return matched > 0 ? fact : null;
};

export const parseMemoryToolOutput = (
	output: string,
): ParsedMemoryOutput | null => {
	const trimmed = output?.trim();
	if (!trimmed) return null;

	let body = trimmed;
	let lead: string | undefined;

	// A lead-in is a line ending in ':' with no value after it.
	const firstBreak = body.indexOf("\n");
	if (firstBreak > 0) {
		const firstLine = body.slice(0, firstBreak).trim();
		if (firstLine.endsWith(":") && !FIELD_LINE.test(firstLine.slice(0, -1))) {
			lead = firstLine.slice(0, -1);
			body = body.slice(firstBreak + 1);
		}
	}

	const facts = body
		.split(/\n\s*---\s*\n/)
		.map((block) => parseFactBlock(block))
		.filter((fact): fact is ParsedMemoryFact => fact !== null);

	if (facts.length === 0) {
		// No fields at all: the tool answered in a sentence. Worth showing as one.
		return { facts: [], message: trimmed, lead };
	}

	return { facts, lead };
};
