/** The API root, including any version prefix (for example /v1). */
export function normalizeCustomBaseURL(value: string): string {
	const url = new URL(value.trim());
	if (
		!["http:", "https:"].includes(url.protocol) ||
		url.username ||
		url.password ||
		url.search ||
		url.hash
	) {
		throw new Error(
			"Use an HTTP or HTTPS API base URL without credentials, query parameters, or a fragment",
		);
	}
	return url.href.replace(/\/+$/, "");
}

export function normalizeCustomModelIds(values: readonly string[]): string[] {
	return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
