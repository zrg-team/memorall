// Splits speech input into synthesis-sized pieces.
//
// TTS models degrade (and allocate quadratically) on long inputs, and the host
// wants audio as early as possible, so text is synthesized sentence by
// sentence. Pure functions: covered by `media-runner-helpers.logic.test.ts`.

export const DEFAULT_MAX_CHUNK_CHARS = 300;
/** Fragments shorter than this ("Hi.", "OK!") ride along with a neighbour. */
export const DEFAULT_MIN_CHUNK_CHARS = 40;

// Sentence terminators: Latin (also used by Vietnamese), CJK full-width,
// ellipsis. A terminator may be followed by closing quotes/brackets.
const SENTENCE_END = /[.!?…。！？]+["'”’)\]»]*(?=\s|$)|[。！？]+/gu;
// Soft break points for over-long sentences.
const CLAUSE_END = /[,;:，、；：]+(?=\s|$)|[，、；：]+/gu;

function splitAfterMatches(text, pattern) {
	const parts = [];
	let start = 0;
	pattern.lastIndex = 0;
	for (const match of text.matchAll(pattern)) {
		const end = match.index + match[0].length;
		parts.push(text.slice(start, end));
		start = end;
	}
	parts.push(text.slice(start));
	return parts.map((part) => part.trim()).filter(Boolean);
}

function splitAtWhitespace(text, maxChars) {
	const pieces = [];
	let rest = text;
	while (rest.length > maxChars) {
		let cut = rest.lastIndexOf(" ", maxChars);
		if (cut <= 0) cut = maxChars;
		pieces.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	if (rest) pieces.push(rest);
	return pieces.filter(Boolean);
}

/** Greedily packs parts into pieces of at most `maxChars`. */
function pack(parts, maxChars) {
	const pieces = [];
	let current = "";
	for (const part of parts) {
		if (!current) {
			current = part;
		} else if (current.length + 1 + part.length <= maxChars) {
			current = `${current} ${part}`;
		} else {
			pieces.push(current);
			current = part;
		}
	}
	if (current) pieces.push(current);
	return pieces;
}

function splitLongSentence(sentence, maxChars) {
	if (sentence.length <= maxChars) return [sentence];
	const clauses = splitAfterMatches(sentence, CLAUSE_END).flatMap((clause) =>
		clause.length <= maxChars ? [clause] : splitAtWhitespace(clause, maxChars),
	);
	return pack(clauses, maxChars);
}

/**
 * @param {string} text
 * @param {{ maxChars?: number, minChars?: number }} [options]
 * @returns {string[]} Non-empty pieces, each at most `maxChars` long.
 */
export function splitSpeechText(text, options = {}) {
	const maxChars = Math.max(20, options.maxChars ?? DEFAULT_MAX_CHUNK_CHARS);
	const minChars = Math.min(
		maxChars,
		Math.max(0, options.minChars ?? DEFAULT_MIN_CHUNK_CHARS),
	);
	const normalized = String(text ?? "")
		.replace(/\s+/g, " ")
		.trim();
	if (!normalized) return [];

	const pieces = splitAfterMatches(normalized, SENTENCE_END).flatMap(
		(sentence) => splitLongSentence(sentence, maxChars),
	);

	// Merge tiny fragments into the previous piece when it still fits.
	const merged = [];
	for (const piece of pieces) {
		const previous = merged[merged.length - 1];
		if (
			previous !== undefined &&
			(previous.length < minChars || piece.length < minChars) &&
			previous.length + 1 + piece.length <= maxChars
		) {
			merged[merged.length - 1] = `${previous} ${piece}`;
		} else {
			merged.push(piece);
		}
	}
	return merged;
}
