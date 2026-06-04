export function normalizeDocumentPath(inputPath: string): string {
	const raw = inputPath.trim().replace(/\\/g, "/");
	if (!raw) return "/";
	const candidate = raw.startsWith("/") ? raw : `/${raw}`;
	const parts = candidate.split("/").filter(Boolean);
	const resolved: string[] = [];
	for (const part of parts) {
		if (part === ".") continue;
		if (part === "..") {
			resolved.pop();
			continue;
		}
		resolved.push(part);
	}
	let normalized = resolved.length ? `/${resolved.join("/")}` : "/";
	if (normalized === "/documents") return "/";
	if (normalized.startsWith("/documents/")) {
		normalized = normalized.slice("/documents".length) || "/";
	}
	return normalized;
}
