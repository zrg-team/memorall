/**
 * Vendored from @mariozechner/pi-ai 0.73.1 (MIT, see ../LICENSE). Browser
 * port: `partialParse` below stands in for the partial-json package.
 */

/**
 * Close whatever is still open in `text` (a string, objects, arrays) and drop
 * a dangling separator or key, so a truncated JSON prefix becomes parseable.
 */
function completeJsonPrefix(text: string): string {
	const stack: string[] = [];
	let inString = false;
	let escaped = false;
	for (const char of text) {
		if (inString) {
			if (escaped) escaped = false;
			else if (char === "\\") escaped = true;
			else if (char === '"') inString = false;
			continue;
		}
		if (char === '"') inString = true;
		else if (char === "{" || char === "[") stack.push(char);
		else if (char === "}" || char === "]") stack.pop();
	}
	let completed = text;
	if (inString) {
		// A trailing lone backslash would escape the closing quote.
		if (escaped) completed = completed.slice(0, -1);
		completed += '"';
	}
	completed = completed.replace(/\s+$/, "");
	// Drop a trailing comma, or a key whose value has not started.
	completed = completed
		.replace(/,$/, "")
		.replace(/(?:,|(?<=\{))\s*"(?:[^"\\]|\\.)*"\s*:$/, "");
	completed = completed.replace(/,$/, "");
	for (let index = stack.length - 1; index >= 0; index--) {
		completed += stack[index] === "{" ? "}" : "]";
	}
	return completed;
}

/** Parse a JSON prefix, cutting back to the last complete member if needed. */
function partialParse(text: string): unknown {
	let candidate = text;
	for (let attempt = 0; attempt < 64 && candidate.length > 0; attempt++) {
		try {
			return JSON.parse(completeJsonPrefix(candidate));
		} catch {
			// Cut back to before the last separator or opener and try again.
			const cut = Math.max(
				candidate.lastIndexOf(","),
				candidate.lastIndexOf("{") + 1,
				candidate.lastIndexOf("[") + 1,
			);
			if (cut <= 0 || cut >= candidate.length) {
				candidate = candidate.slice(0, -1);
			} else {
				candidate = candidate.slice(0, cut);
			}
		}
	}
	throw new SyntaxError("Unparseable JSON prefix");
}

const VALID_JSON_ESCAPES = new Set([
	'"',
	"\\",
	"/",
	"b",
	"f",
	"n",
	"r",
	"t",
	"u",
]);

function isControlCharacter(char: string): boolean {
	const codePoint = char.codePointAt(0);
	return codePoint !== undefined && codePoint >= 0x00 && codePoint <= 0x1f;
}

function escapeControlCharacter(char: string): string {
	switch (char) {
		case "\b":
			return "\\b";
		case "\f":
			return "\\f";
		case "\n":
			return "\\n";
		case "\r":
			return "\\r";
		case "\t":
			return "\\t";
		default:
			return `\\u${char.codePointAt(0)?.toString(16).padStart(4, "0") ?? "0000"}`;
	}
}

/**
 * Repairs malformed JSON string literals by:
 * - escaping raw control characters inside strings
 * - doubling backslashes before invalid escape characters
 */
export function repairJson(json: string): string {
	let repaired = "";
	let inString = false;

	for (let index = 0; index < json.length; index++) {
		const char = json[index];

		if (!inString) {
			repaired += char;
			if (char === '"') {
				inString = true;
			}
			continue;
		}

		if (char === '"') {
			repaired += char;
			inString = false;
			continue;
		}

		if (char === "\\") {
			const nextChar = json[index + 1];
			if (nextChar === undefined) {
				repaired += "\\\\";
				continue;
			}

			if (nextChar === "u") {
				const unicodeDigits = json.slice(index + 2, index + 6);
				if (/^[0-9a-fA-F]{4}$/.test(unicodeDigits)) {
					repaired += `\\u${unicodeDigits}`;
					index += 5;
					continue;
				}
			}

			if (VALID_JSON_ESCAPES.has(nextChar)) {
				repaired += `\\${nextChar}`;
				index += 1;
				continue;
			}

			repaired += "\\\\";
			continue;
		}

		repaired += isControlCharacter(char) ? escapeControlCharacter(char) : char;
	}

	return repaired;
}

export function parseJsonWithRepair<T>(json: string): T {
	try {
		return JSON.parse(json) as T;
	} catch (error) {
		const repairedJson = repairJson(json);
		if (repairedJson !== json) {
			return JSON.parse(repairedJson) as T;
		}
		throw error;
	}
}

/**
 * Attempts to parse potentially incomplete JSON during streaming.
 * Always returns a valid object, even if the JSON is incomplete.
 *
 * @param partialJson The partial JSON string from streaming
 * @returns Parsed object or empty object if parsing fails
 */
export function parseStreamingJson<T = Record<string, unknown>>(
	partialJson: string | undefined,
): T {
	if (!partialJson || partialJson.trim() === "") {
		return {} as T;
	}

	try {
		return parseJsonWithRepair<T>(partialJson);
	} catch {
		try {
			const result = partialParse(partialJson);
			return (result ?? {}) as T;
		} catch {
			try {
				const result = partialParse(repairJson(partialJson));
				return (result ?? {}) as T;
			} catch {
				return {} as T;
			}
		}
	}
}
