/**
 * Pulls the web links out of a message the user typed.
 *
 * Used to offer the co-agent on a page the conversation is about — the common
 * case being a link pasted with a one-line instruction, where the agent's own
 * web tools are the wrong shape and the user really wants to drive the page.
 *
 * Deliberately conservative: only absolute http(s) URLs, only from prose the
 * user actually wrote. Code fences and inline code are stripped first, so a URL
 * inside a snippet does not turn into a button the user never asked for.
 */

const FENCED_CODE = /```[\s\S]*?```/g;
const INLINE_CODE = /`[^`\n]*`/g;
/** Markdown link targets, so `[text](url)` yields the url and not the label. */
const MARKDOWN_LINK = /\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/gi;
const BARE_URL = /https?:\/\/[^\s<>"'`]+/gi;

/**
 * Trailing punctuation almost always belongs to the sentence, not the URL —
 * "see https://example.com." — but a closing bracket can be part of the path,
 * so only drop one that has no opener.
 */
const trimTrailingPunctuation = (url: string): string => {
	let result = url;
	while (result.length > 0) {
		const last = result[result.length - 1];
		if (".,;:!?".includes(last)) {
			result = result.slice(0, -1);
			continue;
		}
		if (last === ")" || last === "]") {
			const open = last === ")" ? "(" : "[";
			const opens = result.split(open).length - 1;
			const closes = result.split(last).length - 1;
			if (closes > opens) {
				result = result.slice(0, -1);
				continue;
			}
		}
		break;
	}
	return result;
};

const isUsableHttpUrl = (value: string): boolean => {
	try {
		const parsed = new URL(value);
		return (
			(parsed.protocol === "http:" || parsed.protocol === "https:") &&
			parsed.hostname.includes(".")
		);
	} catch {
		return false;
	}
};

export const MAX_MESSAGE_LINKS = 3;

export const extractMessageLinks = (content: string): string[] => {
	if (!content) return [];

	const prose = content.replace(FENCED_CODE, " ").replace(INLINE_CODE, " ");
	const found: string[] = [];
	const seen = new Set<string>();

	const add = (raw: string) => {
		const url = trimTrailingPunctuation(raw);
		if (!isUsableHttpUrl(url) || seen.has(url)) return;
		seen.add(url);
		found.push(url);
	};

	// Markdown targets first so their urls are claimed before the bare-url sweep
	// walks the same characters.
	for (const match of prose.matchAll(MARKDOWN_LINK)) {
		add(match[1] ?? "");
	}
	for (const match of prose.matchAll(BARE_URL)) {
		add(match[0] ?? "");
	}

	return found.slice(0, MAX_MESSAGE_LINKS);
};
