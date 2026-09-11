/**
 * Where a program might start.
 *
 * `CardBlock` is matched bare because it is the conventional root and streams
 * in before any assignment is written. Everything else has to arrive as an
 * assignment with a capitalised callee — the same shape a continuation
 * statement takes — so ordinary prose containing brackets is not mistaken for
 * code. Anchoring on `CardBlock` alone meant an answer opening with a table or
 * a paragraph block was shown to the reader as its own source.
 */
const OPENUI_ASSIGNMENT_SEARCH_PATTERN =
	/\b(?:\w+\s*=\s*)?CardBlock\s*\(|\b[A-Za-z_$][\w$]*\s*=\s*[A-Z][\w$]*\s*\(/g;

export type OpenUIContentSegment =
	| { kind: "text"; text: string; start: number; end: number }
	| {
			kind: "openui";
			content: string;
			start: number;
			end: number;
			complete: boolean;
	  };

export interface SplitOpenUIContentOptions {
	includeIncomplete?: boolean;
}

export interface AppendAwareOpenUISplitter {
	split(
		content: string,
		options?: SplitOpenUIContentOptions,
	): OpenUIContentSegment[];
	reset(): void;
}

export function isOpenUILang(content: string): boolean {
	return extractOpenUILang(content) !== null;
}

export function extractOpenUILang(content: string): string | null {
	const openUISegment = splitOpenUIContent(content).find(
		(segment) => segment.kind === "openui",
	);
	return openUISegment?.content ?? null;
}

export function normalizeOpenUILang(content: string): string {
	return replaceBareIdentifier(content, "undefined", "null");
}

export function splitOpenUIContent(
	content: string,
	options: SplitOpenUIContentOptions = {},
): OpenUIContentSegment[] {
	const segments: OpenUIContentSegment[] = [];
	let cursor = 0;

	OPENUI_ASSIGNMENT_SEARCH_PATTERN.lastIndex = 0;
	while (true) {
		const match = OPENUI_ASSIGNMENT_SEARCH_PATTERN.exec(content);
		if (match === null) break;

		const start = match.index;
		const expressionEnd = findRootExpressionEnd(content, start);
		if (expressionEnd === -1 && !options.includeIncomplete) continue;

		const program =
			expressionEnd === -1
				? { end: content.length, complete: false }
				: findOpenUIProgramEnd(
						content,
						expressionEnd,
						options.includeIncomplete === true,
					);
		const end = program.end;

		const fenceStart = findOpeningFenceStart(content, start);
		const textEnd = fenceStart ?? start;
		if (textEnd > cursor) {
			segments.push({
				kind: "text",
				text: content.slice(cursor, textEnd),
				start: cursor,
				end: textEnd,
			});
		}

		const rawSlice = content.slice(start, end).trim();
		const repaired = program.complete
			? closeUnbalancedBrackets(rawSlice)
			: rawSlice;
		const normalized = normalizeOpenUILang(repaired);
		const openUIContent =
			rawSlice && !/^\w+\s*=/.test(normalized)
				? `root = ${normalized}`
				: normalized;
		segments.push({
			kind: "openui",
			content: openUIContent,
			start,
			end,
			complete: program.complete,
		});

		cursor = program.complete ? skipClosingFence(content, end) : end;
		OPENUI_ASSIGNMENT_SEARCH_PATTERN.lastIndex = cursor;
	}

	if (cursor < content.length) {
		segments.push({
			kind: "text",
			text: content.slice(cursor),
			start: cursor,
			end: content.length,
		});
	}

	return segments.length > 0
		? segments
		: [{ kind: "text", text: content, start: 0, end: content.length }];
}

export function createAppendAwareOpenUISplitter(): AppendAwareOpenUISplitter {
	let previousContent = "";
	let openUIStart: number | null = null;
	const streamingPattern = /\b(?:\w+\s*=\s*)?CardBlock\s*\(/;

	const reset = () => {
		previousContent = "";
		openUIStart = null;
	};

	return {
		reset,
		split(content, options = {}) {
			const isAppend = content.startsWith(previousContent);
			if (!options.includeIncomplete || !isAppend) {
				reset();
				previousContent = content;
				return splitOpenUIContent(content, options);
			}

			if (openUIStart === null) {
				const overlapStart = Math.max(0, previousContent.length - 256);
				const appendedWindow = content.slice(overlapStart);
				const match = streamingPattern.exec(appendedWindow);
				if (match) openUIStart = overlapStart + match.index;
			}
			previousContent = content;

			if (openUIStart === null) {
				return [{ kind: "text", text: content, start: 0, end: content.length }];
			}

			const fenceStart = findOpeningFenceStart(content, openUIStart);
			const textEnd = fenceStart ?? openUIStart;
			const segments: OpenUIContentSegment[] = [];
			if (textEnd > 0) {
				segments.push({
					kind: "text",
					text: content.slice(0, textEnd),
					start: 0,
					end: textEnd,
				});
			}
			const rawSlice = content.slice(openUIStart).trim();
			const normalized = normalizeOpenUILang(rawSlice);
			segments.push({
				kind: "openui",
				content:
					rawSlice && !/^\w+\s*=/.test(normalized)
						? `root = ${normalized}`
						: normalized,
				start: openUIStart,
				end: content.length,
				complete: false,
			});
			return segments;
		},
	};
}

const OPENUI_STATEMENT_PATTERN =
	/^[ \t]*[A-Za-z_$][\w$]*\s*=\s*[A-Za-z_$][\w$]*\s*\(/;

function findOpenUIProgramEnd(
	content: string,
	rootEnd: number,
	includeIncomplete: boolean,
): { end: number; complete: boolean } {
	let end = rootEnd;
	while (end < content.length) {
		const remainder = content.slice(end);
		const leadingWhitespace =
			/^[ \t]*(?:\r?\n[ \t]*)*/.exec(remainder)?.[0] ?? "";
		const statementStart = end + leadingWhitespace.length;
		const next = content.slice(statementStart);
		if (next.startsWith("```")) break;
		const statement = OPENUI_STATEMENT_PATTERN.exec(next);
		if (!statement) break;

		const statementEnd = findRootExpressionEnd(content, statementStart);
		if (statementEnd === -1) {
			// Still arriving: wait for the rest rather than guessing at it.
			if (includeIncomplete) return { end: content.length, complete: false };

			// Finished, but this statement never closed its brackets. Models drop
			// one often enough that stopping here is the wrong answer — it showed
			// every later section to the reader as raw source. Run on to the next
			// statement and let the segment be closed off instead.
			const nextStart = findNextStatementStart(content, statementStart);
			if (nextStart === -1) return { end: content.length, complete: true };
			end = nextStart;
			continue;
		}
		end = statementEnd;
	}
	return { end, complete: true };
}

/** The next line that reads as a new top-level statement. */
function findNextStatementStart(content: string, from: number): number {
	let newline = content.indexOf("\n", from);
	while (newline !== -1) {
		const candidate = newline + 1;
		if (OPENUI_STATEMENT_PATTERN.test(content.slice(candidate))) {
			return candidate;
		}
		newline = content.indexOf("\n", candidate);
	}
	return -1;
}

/**
 * Close whatever brackets a program left open.
 *
 * A no-op for well-formed source. For source that lost a bracket it is the
 * difference between the answer rendering and the reader being handed its code.
 */
export function closeUnbalancedBrackets(source: string): string {
	const closers: string[] = [];
	let inString = false;
	let escaped = false;

	for (const char of source) {
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (char === "\\") {
				escaped = true;
			} else if (char === '"') {
				inString = false;
			}
			continue;
		}
		if (char === '"') {
			inString = true;
			continue;
		}
		if (char === "(") closers.push(")");
		else if (char === "[") closers.push("]");
		else if (char === "{") closers.push("}");
		else if (char === ")" || char === "]" || char === "}") closers.pop();
	}

	const tail = closers.reverse().join("");
	if (inString) return `${source}"${tail}`;
	return tail ? source + tail : source;
}

function replaceBareIdentifier(
	content: string,
	identifier: string,
	replacement: string,
): string {
	let result = "";
	let cursor = 0;
	let inString = false;
	let escaped = false;

	for (let i = 0; i < content.length; i += 1) {
		const char = content[i];

		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === "\\") {
				escaped = true;
				continue;
			}
			if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			continue;
		}

		if (
			content.startsWith(identifier, i) &&
			!isIdentifierChar(content[i - 1]) &&
			!isIdentifierChar(content[i + identifier.length])
		) {
			result += content.slice(cursor, i) + replacement;
			i += identifier.length - 1;
			cursor = i + 1;
		}
	}

	return result + content.slice(cursor);
}

function isIdentifierChar(char: string | undefined): boolean {
	return !!char && /[A-Za-z0-9_$]/.test(char);
}

function findRootExpressionEnd(content: string, start: number): number {
	let depth = 0;
	let inString = false;
	let escaped = false;
	const expressionStart = content.indexOf("(", start);

	if (expressionStart === -1) return -1;

	for (let i = expressionStart; i < content.length; i += 1) {
		const char = content[i];

		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (char === "\\") {
				escaped = true;
				continue;
			}
			if (char === '"') {
				inString = false;
			}
			continue;
		}

		if (char === '"') {
			inString = true;
			continue;
		}

		if (char === "(" || char === "[" || char === "{") {
			depth += 1;
			continue;
		}

		if (char === ")" || char === "]" || char === "}") {
			depth -= 1;
			if (depth === 0) {
				return i + 1;
			}
		}
	}

	return -1;
}

function findOpeningFenceStart(content: string, start: number): number | null {
	const lineStart = content.lastIndexOf("\n", start - 1) + 1;
	const beforeLine = content.slice(0, lineStart);
	const match = /(^|\r?\n)[ \t]*```\w*[ \t]*\r?\n[ \t]*$/.exec(beforeLine);
	if (!match) return null;
	return match.index + match[1].length;
}

function skipClosingFence(content: string, end: number): number {
	const match = /^[ \t]*(?:\r?\n)?[ \t]*```[ \t]*(?:\r?\n|$)/.exec(
		content.slice(end),
	);
	if (!match) return end;
	return end + match[0].length;
}
