import type { AssetResolver } from "../contracts/core";
import { normalizeAssetPath } from "../core/asset-resolver";

interface SandboxManifest {
	sandbox?: { pages?: string[] };
}

/** Extension assets, served from the extension's own origin. */
export class ExtensionAssetResolver implements AssetResolver {
	url(path: string): string {
		return chrome.runtime.getURL(normalizeAssetPath(path));
	}

	/**
	 * The built manifest lists the sandbox page by its own path in
	 * development, and as sandbox/page-N.html, in manifest.base.json's
	 * order, in extension builds.
	 */
	sandboxPageUrl(path: string, index: number): string {
		const pages =
			(chrome.runtime.getManifest() as SandboxManifest).sandbox?.pages ?? [];
		const name = path.split("/").pop() ?? path;
		const page =
			pages.find((candidate) => candidate.endsWith(name)) ??
			pages[index] ??
			path;
		return this.url(page);
	}
}
