/** What can start right after a quote that is part of the text, not its end. */
const TEXT_AFTER_QUOTE = /[\p{L}\p{N}(]/u;

/**
 * Escapes the quotes a model leaves inside a string, as in
 * "now called "Fast mode" (renamed)", which would otherwise end the string
 * early and lose the whole statement. Inside a string, a quote ends it only
 * when what follows can follow a string (a comma, a bracket, an operator, the
 * end of the line); before a word, a number or "(" it is part of the text.
 * Valid OpenUI Lang comes back unchanged.
 */
export const escapeStrayQuotes = (source: string): string => {
	let out = "";
	let inString = false;
	for (let index = 0; index < source.length; index++) {
		const char = source[index] as string;
		if (!inString) {
			if (char === '"') inString = true;
			out += char;
			continue;
		}
		if (char === "\\") {
			out += char + (source[index + 1] ?? "");
			index++;
			continue;
		}
		if (char === "\n") {
			// A string does not run past its line: the next line starts fresh.
			inString = false;
			out += char;
			continue;
		}
		if (char === '"') {
			let next = index + 1;
			while (source[next] === " " || source[next] === "\t") next++;
			if (
				next < source.length &&
				TEXT_AFTER_QUOTE.test(source[next] as string)
			) {
				out += '\\"';
				continue;
			}
			inString = false;
		}
		out += char;
	}
	return out;
};
