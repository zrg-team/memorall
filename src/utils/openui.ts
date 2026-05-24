const OPENUI_ASSIGNMENT_SEARCH_PATTERN = /\b\w+\s*=\s*CardBlock\s*\(/g;

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

		const end = expressionEnd === -1 ? content.length : expressionEnd;

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

		segments.push({
			kind: "openui",
			content:
				expressionEnd === -1
					? ""
					: normalizeOpenUILang(content.slice(start, end).trim()),
			start,
			end,
			complete: expressionEnd !== -1,
		});

		cursor = expressionEnd === -1 ? end : skipClosingFence(content, end);
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
