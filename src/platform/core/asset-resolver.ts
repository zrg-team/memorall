import type { AssetResolver } from "../contracts/core";

export function normalizeAssetPath(path: string): string {
	if (typeof path !== "string" || path.length === 0) {
		throw new Error("Asset path must be a non-empty string");
	}
	if (path.includes("\0") || /^[a-z][a-z\d+.-]*:/i.test(path)) {
		throw new Error(`Invalid asset path: ${path}`);
	}

	const segments = path.replaceAll("\\", "/").split("/");
	const normalized: string[] = [];
	for (const segment of segments) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			throw new Error(`Asset path traversal is not allowed: ${path}`);
		}
		normalized.push(encodeURIComponent(decodeURIComponent(segment)));
	}

	if (normalized.length === 0) {
		throw new Error("Asset path must resolve to a file");
	}
	return normalized.join("/");
}

export class BaseUrlAssetResolver implements AssetResolver {
	private readonly base: string;

	constructor(base: string) {
		this.base = `${base.replace(/\/+$/, "")}/`;
	}

	url(path: string): string {
		return `${this.base}${normalizeAssetPath(path)}`;
	}
}
