export const MIN_WEB_MAX_HTML_CHARS = 1_024;
export const DEFAULT_WEB_MAX_HTML_CHARS = 160_000;
export const MAX_WEB_MAX_HTML_CHARS = 500_000;

export const normalizeWebMaxHtmlChars = (value?: number): number => {
	const normalizedValue =
		typeof value === "number" && Number.isFinite(value)
			? Math.trunc(value)
			: DEFAULT_WEB_MAX_HTML_CHARS;

	return Math.min(
		MAX_WEB_MAX_HTML_CHARS,
		Math.max(MIN_WEB_MAX_HTML_CHARS, normalizedValue),
	);
};
