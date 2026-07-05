import { toDocumentsLogicalPath } from "@/services/filesystem/sandbox-paths";

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
	const normalized = resolved.length ? `/${resolved.join("/")}` : "/";
	return toDocumentsLogicalPath(normalized) ?? normalized;
}
