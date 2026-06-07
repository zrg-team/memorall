import z from "zod";
import type { Tool, ToolFactory } from "flow-core/interfaces/engine/tool";
import type { AllServices } from "flow-core/interfaces/services/services";
import { toolRegistry } from "flow-core/registries/tool-registry";
import { writeFileBytes } from "flow-core/tools/fs/util";
import {
	createDefaultWebErrorResult,
	createWebResult,
	requireWebBrowserService,
} from "flow-core/tools/web/web-tool-utils";
import {
	downloadResourceBytes,
	filenameFromUrl,
} from "flow-core/utils/download-resource";
import { normalizeProjectPath } from "flow-core/tools/hyperframes/util";
import type { HyperframesToolConfig } from "flow-core/tools/hyperframes/config";

const TOOL_NAME = "hyperframes_remote_asset_import" as const;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_HTML_CHARS = 240_000;

const schema = z.object({
	project_path: z
		.string()
		.min(1)
		.describe("HyperFrames project directory, e.g. /projects/product-launch."),
	url: z.string().url().describe("Remote image or SVG URL to import."),
	sessionId: z
		.string()
		.optional()
		.describe(
			"Deprecated. Remote asset import downloads the candidate URL directly.",
		),
	asset_path: z
		.string()
		.optional()
		.describe(
			"Optional relative path inside the project's resources folder, e.g. images/hero.jpg. Do not include project_path.",
		),
});

type Input = z.infer<typeof schema>;

const sanitizeFilename = (filename: string): string => {
	const cleaned = filename
		.replace(/[?#].*$/, "")
		.replace(/[^a-zA-Z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return cleaned || `asset-${crypto.randomUUID()}`;
};

const normalizeResourceAssetPath = (
	assetPath: string | undefined,
	defaultFilename: string,
): string => {
	const raw = (assetPath?.trim() || `images/${defaultFilename}`)
		.replace(/\\/g, "/")
		.replace(/^\/+/, "")
		.replace(/^resources\/+/i, "");
	const parts = raw.split("/").filter(Boolean);
	if (!parts.length) return `images/${defaultFilename}`;
	if (parts.some((part) => part === "." || part === "..")) {
		throw new Error(
			"asset_path must stay inside the project resources folder.",
		);
	}
	return parts
		.map((part, index) =>
			index === parts.length - 1 ? sanitizeFilename(part) : part,
		)
		.join("/");
};

const resolveUrl = (
	value: string | null | undefined,
	baseUrl: string,
): string | null => {
	if (!value) return null;
	if (value.startsWith("data:") || value.startsWith("blob:")) return null;
	try {
		return new URL(value, baseUrl).toString();
	} catch {
		return null;
	}
};

const attrFromHtml = (html: string, attr: string): string | undefined => {
	const match = new RegExp(`\\b${attr}=([\"'])(.*?)\\1`, "i").exec(html);
	return match
		? match[2]
				.replace(/&amp;/g, "&")
				.replace(/&quot;/g, '"')
				.replace(/&#39;/g, "'")
		: undefined;
};

const isGoogleImgresUrl = (url: string): boolean => {
	try {
		const parsed = new URL(url);
		return (
			parsed.pathname === "/imgres" &&
			(parsed.hostname === "www.google.com" ||
				parsed.hostname.endsWith(".google.com"))
		);
	} catch {
		return false;
	}
};

const fallbackImageUrlFromGoogleImgres = (url: string): string | null => {
	try {
		const parsed = new URL(url);
		return parsed.searchParams.get("imgurl");
	} catch {
		return null;
	}
};

const isUsableGoogleResolvedImageUrl = (url: string): boolean => {
	if (url.startsWith("data:") || url.startsWith("blob:")) return false;
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		if (host.startsWith("encrypted-tbn") && host.endsWith("gstatic.com")) {
			return false;
		}
		if (host === "www.google.com" || host === "images.google.com") {
			return false;
		}
		if (parsed.searchParams.get("q")?.startsWith("tbn:")) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
};

export const extractGoogleResolvedImageUrl = ({
	html,
	baseUrl,
	googleResultUrl,
}: {
	html: string;
	baseUrl: string;
	googleResultUrl: string;
}): string | null => {
	const candidates: string[] = [];
	const push = (src: string | null | undefined) => {
		const resolved = resolveUrl(src, baseUrl);
		if (resolved && isUsableGoogleResolvedImageUrl(resolved)) {
			candidates.push(resolved);
		}
	};

	if (typeof DOMParser !== "undefined") {
		const document = new DOMParser().parseFromString(html, "text/html");
		for (const selector of [
			'img[jsname="kn3ccd"][src]',
			"img.iPVvYb[src]",
			"img.sFlh5c[src]",
			"img[src]",
		]) {
			for (const img of Array.from(document.querySelectorAll(selector))) {
				push(img.getAttribute("src"));
			}
			if (candidates.length) return candidates[0];
		}
	} else {
		const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)].map(
			(match) => match[0],
		);
		const preferred = imgTags.filter((tag) =>
			/(jsname=["']kn3ccd["']|class=["'][^"']*(?:iPVvYb|sFlh5c)[^"']*["'])/i.test(
				tag,
			),
		);
		for (const tag of [...preferred, ...imgTags]) {
			push(attrFromHtml(tag, "src"));
			if (candidates.length) return candidates[0];
		}
	}

	const fallback = fallbackImageUrlFromGoogleImgres(googleResultUrl);
	return fallback && isUsableGoogleResolvedImageUrl(fallback) ? fallback : null;
};

type Services = Pick<AllServices, "fs" | "webBrowser">;

export const createHyperframesRemoteAssetImportTool: ToolFactory<
	Input,
	Services,
	HyperframesToolConfig
> = (services, config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Import a remote image/SVG into a HyperFrames project's resources folder. Takes project_path and saves under {project_path}/resources/..., returning the relative ./resources/... src to use in index.html.",
	schema,
	execute: async (input) => {
		try {
			const projectPath = normalizeProjectPath(
				input.project_path,
				config?.rootPath,
			);
			let downloadUrl = input.url;
			let resolvedImageUrl: string | undefined;

			if (isGoogleImgresUrl(input.url)) {
				const webBrowser = requireWebBrowserService(services);
				let sessionId: string | undefined;
				try {
					const opened = await webBrowser.openSession({
						url: input.url,
						timeoutMs: DEFAULT_TIMEOUT_MS,
						maxHtmlChars: MAX_HTML_CHARS,
						persist: false,
						mode: "tab",
					});
					sessionId = opened.session.id;
					await webBrowser
						.waitForPageRender({
							sessionId,
							timeoutMs: 5_000,
							maxHtmlChars: MAX_HTML_CHARS,
							stabilityMs: 600,
						})
						.catch(() => null);
					const session = await webBrowser.refreshSession({
						sessionId,
						timeoutMs: 5_000,
						maxHtmlChars: MAX_HTML_CHARS,
					});
					const resolved = extractGoogleResolvedImageUrl({
						html: session.html,
						baseUrl: session.currentUrl || input.url,
						googleResultUrl: input.url,
					});
					if (!resolved) {
						throw new Error(
							"Could not resolve a direct image URL from the Google Images result page.",
						);
					}
					resolvedImageUrl = resolved;
					downloadUrl = resolved;
				} finally {
					if (sessionId) {
						await webBrowser.closeSession(sessionId).catch(() => undefined);
					}
				}
			}

			const { bytes, mimeType, finalUrl } = await downloadResourceBytes({
				url: downloadUrl,
				allowedMimeTypes: ["image/*"],
			});
			const defaultFilename = sanitizeFilename(
				filenameFromUrl(downloadUrl, mimeType),
			);
			const assetPath = normalizeResourceAssetPath(
				input.asset_path,
				defaultFilename,
			);
			const filePath = `${projectPath}/resources/${assetPath}`;
			if (!services.fs) {
				throw new Error("Filesystem service is not available.");
			}
			await writeFileBytes(services.fs, filePath, bytes, true, config);

			return createWebResult({
				actionType: TOOL_NAME,
				success: true,
				project_path: projectPath,
				file_path: filePath,
				html_src: `./resources/${assetPath}`,
				mimeType,
				size: bytes.length,
				url: input.url,
				...(resolvedImageUrl ? { resolvedImageUrl } : {}),
				finalUrl,
			});
		} catch (error) {
			return createDefaultWebErrorResult(error);
		}
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesRemoteAssetImportTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: HyperframesToolConfig;
		};
	}
}
