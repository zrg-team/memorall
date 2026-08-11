import z from "zod";
import type {
	Tool,
	ToolFactory,
} from "@/services/flows-legacy/interfaces/engine/tool";
import type { AllServices } from "@/services/flows-legacy/interfaces/services/services";
import { toolRegistry } from "@/services/flows-legacy/registries/tool-registry";
import type { HyperframesToolConfig } from "@/services/flows-legacy/tools/hyperframes/config";
import {
	createDefaultWebErrorResult,
	createWebResult,
	requireWebBrowserService,
} from "@/services/flows-legacy/tools/web/web-tool-utils";

const TOOL_NAME = "hyperframes_remote_assets_explore" as const;

const PROVIDERS = [
	"google_images",
	"cleanpng",
	"openverse",
	"pexels",
	"unsplash",
	"svgrepo",
] as const;
type Provider = (typeof PROVIDERS)[number];
type AssetKind = "image" | "photo" | "svg" | "icon" | "illustration" | "any";

interface Candidate {
	provider: Provider;
	url: string;
	sourceUrl: string;
	imageUrlPreview?: string;
	title?: string;
	alt?: string;
	width?: number;
	height?: number;
	score: number;
}

interface ProviderAttempt {
	provider: Provider;
	url: string;
	success: boolean;
	reason?: string;
	candidateCount: number;
}

interface PartialResult {
	provider: Provider;
	sessionId: string;
	searchUrl: string;
	candidates: Candidate[];
}

const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_HTML_CHARS = 240_000;

const schema = z.object({
	query: z
		.string()
		.min(1)
		.describe("Search query for remote visual assets, e.g. Vietnam skyline"),
	kind: z
		.enum(["image", "photo", "svg", "icon", "illustration", "any"])
		.optional()
		.describe(
			"Asset type to prioritize. Default: image. Use svg/icon for vector assets.",
		),
	max_results: z
		.number()
		.int()
		.min(1)
		.max(20)
		.optional()
		.describe(
			"Maximum candidates to return from the first successful provider.",
		),
	min_results: z
		.number()
		.int()
		.min(1)
		.max(10)
		.optional()
		.describe(
			"Fallback to next provider unless this many candidates are found.",
		),
	providers: z
		.array(z.enum(PROVIDERS))
		.optional()
		.describe(
			"Optional provider order override. Default uses the best supported order.",
		),
});

type Input = z.infer<typeof schema>;
type Services = Pick<AllServices, "webBrowser">;

const normalizeQueryForPath = (query: string): string =>
	encodeURIComponent(query.trim()).replace(/%20/g, "-");

const providerSearchUrl = (provider: Provider, query: string): string => {
	const q = query.trim();
	switch (provider) {
		case "google_images":
			return `https://www.google.com/search?udm=2&q=${encodeURIComponent(q)}`;
		case "cleanpng":
			return `https://www.cleanpng.com/free/${normalizeQueryForPath(q)}.html`;
		case "openverse":
			return `https://openverse.org/search/image?q=${encodeURIComponent(q)}`;
		case "pexels":
			return `https://www.pexels.com/search/${normalizeQueryForPath(q)}/`;
		case "unsplash":
			return `https://unsplash.com/s/photos/${encodeURIComponent(q)}`;
		case "svgrepo":
			return `https://www.svgrepo.com/vectors/${normalizeQueryForPath(q)}/`;
	}
};

const defaultProvidersForKind = (kind: AssetKind): Provider[] => {
	if (kind === "svg" || kind === "icon" || kind === "illustration") {
		return [
			"google_images",
			"svgrepo",
			"cleanpng",
			"openverse",
			"pexels",
			"unsplash",
		];
	}
	return [
		"google_images",
		"cleanpng",
		"openverse",
		"pexels",
		"unsplash",
		"svgrepo",
	];
};

const toNumber = (value: string | null): number | undefined => {
	const n = Number.parseInt(value ?? "", 10);
	return Number.isFinite(n) && n > 0 ? n : undefined;
};

const parseSrcset = (srcset: string | null): string | null => {
	if (!srcset) return null;
	const candidates = srcset
		.split(",")
		.map((part) => {
			const [url = "", descriptor = ""] = part.trim().split(/\s+/, 2);
			const width = Number.parseInt(descriptor.replace(/[^\d]/g, ""), 10);
			return {
				url,
				width: Number.isFinite(width) ? width : 0,
			};
		})
		.filter((item) => item.url);
	candidates.sort((a, b) => b.width - a.width);
	return candidates[0]?.url ?? null;
};

const resolveUrl = (value: string | null, baseUrl: string): string | null => {
	if (!value) return null;
	if (value.startsWith("data:") || value.startsWith("blob:")) return null;
	try {
		return new URL(value, baseUrl).toString();
	} catch {
		return null;
	}
};

const decodeHtmlEntities = (value: string): string =>
	value
		.replace(/&amp;/g, "&")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">");

const normalizeAssetUrl = (url: string, provider: Provider): string => {
	try {
		const parsed = new URL(url);
		if (provider === "pexels" && parsed.hostname === "images.pexels.com") {
			parsed.search = "";
			return parsed.toString();
		}
		if (
			provider === "unsplash" &&
			parsed.hostname === "images.unsplash.com" &&
			/^\/photo-/.test(parsed.pathname)
		) {
			parsed.search = "auto=format&fit=crop&w=1920&q=80";
			return parsed.toString();
		}
		return parsed.toString();
	} catch {
		return url;
	}
};

const isRobotOrBlockedPage = (html: string, text: string): string | null => {
	const haystack = `${html}\n${text}`.toLowerCase();
	if (haystack.includes("please respect our robot policy")) {
		return "robot_policy";
	}
	if (
		haystack.includes("our systems have detected unusual traffic") ||
		haystack.includes("unusual traffic from your computer network")
	) {
		return "unusual_traffic";
	}
	if (haystack.includes("captcha") || haystack.includes("not a robot")) {
		return "captcha";
	}
	if (
		haystack.includes("before you continue to google") ||
		haystack.includes("consent.google.com")
	) {
		return "google_consent";
	}
	if (haystack.includes("performing security verification")) {
		return "security_verification";
	}
	if (haystack.includes("just a moment") && haystack.includes("cloudflare")) {
		return "cloudflare_verification";
	}
	if (haystack.includes("sorry, you have been blocked")) {
		return "blocked";
	}
	return null;
};

const isUiAsset = (url: string, alt: string): boolean => {
	const value = `${url} ${alt}`.toLowerCase();
	return /logo|avatar|profile|sprite|favicon|wordmark|icon\/|\/icons\/|placeholder|spinner|loading/.test(
		value,
	);
};

const providerAllowsUrl = (
	url: string,
	provider: Provider,
	kind: AssetKind,
): boolean => {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname;
		const path = parsed.pathname;

		if (provider === "google_images") {
			return (
				(host === "www.google.com" || host.endsWith(".google.com")) &&
				path === "/imgres"
			);
		}
		if (provider === "cleanpng") {
			return host === "icon2.cleanpng.com";
		}
		if (provider === "openverse") {
			return (
				host === "api.openverse.org" ||
				host.endsWith("staticflickr.com") ||
				host === "live.staticflickr.com" ||
				host === "upload.wikimedia.org"
			);
		}
		if (provider === "pexels") {
			return host === "images.pexels.com" && path.includes("/photos/");
		}
		if (provider === "unsplash") {
			return host === "images.unsplash.com" && /^\/photo-/.test(path);
		}
		if (provider === "svgrepo") {
			return (
				host === "www.svgrepo.com" &&
				(path.includes("/show/") || path.endsWith(".svg")) &&
				(kind === "svg" ||
					kind === "icon" ||
					kind === "illustration" ||
					kind === "any")
			);
		}
		return false;
	} catch {
		return false;
	}
};

const scoreCandidate = ({
	url,
	alt,
	width,
	height,
	provider,
}: {
	url: string;
	alt: string;
	width?: number;
	height?: number;
	provider: Provider;
}): number => {
	let score = 0;
	if (provider === "cleanpng") score += 35;
	if (provider === "google_images") score += 32;
	if (provider === "openverse") score += 30;
	if (provider === "pexels") score += 25;
	if (provider === "unsplash") score += 22;
	if (provider === "svgrepo") score += 18;
	if (alt.trim()) score += 5;
	if ((width ?? 0) >= 600 || (height ?? 0) >= 600) score += 10;
	if ((width ?? 0) >= 1200 || (height ?? 0) >= 1200) score += 10;
	if (/thumb|w=40|h=40|w=80|h=80/.test(url.toLowerCase())) score -= 15;
	if (/premium|plus\.unsplash/.test(url.toLowerCase())) score -= 50;
	return score;
};

const googleImgresInfoFromUrl = (
	url: string,
	baseUrl: string,
): {
	url: string;
	sourceUrl: string;
	imageUrlPreview?: string;
	width?: number;
	height?: number;
} | null => {
	const resolved = resolveUrl(decodeHtmlEntities(url), baseUrl);
	if (!resolved) return null;
	try {
		const parsed = new URL(resolved);
		if (
			parsed.pathname !== "/imgres" ||
			!(
				parsed.hostname === "www.google.com" ||
				parsed.hostname.endsWith(".google.com")
			)
		) {
			return null;
		}
		const imageUrlPreview = parsed.searchParams.get("imgurl") ?? undefined;
		const sourceUrl =
			parsed.searchParams.get("imgrefurl") ?? imageUrlPreview ?? baseUrl;
		return {
			url: parsed.toString(),
			sourceUrl,
			imageUrlPreview,
			width: toNumber(parsed.searchParams.get("w")),
			height: toNumber(parsed.searchParams.get("h")),
		};
	} catch {
		return null;
	}
};

const titleFromHtml = (html: string): string | undefined => {
	const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
	return title ? decodeHtmlEntities(title).trim() || undefined : undefined;
};

const attrFromHtml = (html: string, attr: string): string | undefined => {
	const match = new RegExp(`\\b${attr}=([\"'])(.*?)\\1`, "i").exec(html);
	return match ? decodeHtmlEntities(match[2]) : undefined;
};

export const extractGoogleImageCandidates = ({
	html,
	baseUrl,
	maxResults,
}: {
	html: string;
	baseUrl: string;
	maxResults: number;
}): Candidate[] => {
	const seen = new Set<string>();
	const candidates: Candidate[] = [];
	const title = titleFromHtml(html);
	const pushCandidate = ({
		href,
		innerHtml,
		alt,
		width,
		height,
	}: {
		href: string;
		innerHtml?: string;
		alt?: string;
		width?: number;
		height?: number;
	}) => {
		const info = googleImgresInfoFromUrl(href, baseUrl);
		if (!info || seen.has(info.url)) return;
		seen.add(info.url);
		const imgAlt = alt ?? attrFromHtml(innerHtml ?? "", "alt") ?? "";
		const imgWidth =
			width ?? toNumber(attrFromHtml(innerHtml ?? "", "width") ?? null);
		const imgHeight =
			height ?? toNumber(attrFromHtml(innerHtml ?? "", "height") ?? null);
		candidates.push({
			provider: "google_images",
			url: info.url,
			sourceUrl: info.sourceUrl,
			imageUrlPreview: info.imageUrlPreview,
			title,
			alt: imgAlt || undefined,
			width: info.width ?? imgWidth,
			height: info.height ?? imgHeight,
			score: scoreCandidate({
				url: info.url,
				alt: imgAlt,
				width: info.width ?? imgWidth,
				height: info.height ?? imgHeight,
				provider: "google_images",
			}),
		});
	};

	if (typeof DOMParser !== "undefined") {
		const document = new DOMParser().parseFromString(html, "text/html");
		for (const anchor of Array.from(
			document.querySelectorAll(
				'a[href*="/imgres"], a[href*="google.com/imgres"]',
			),
		)) {
			const img = anchor.querySelector("img");
			pushCandidate({
				href: anchor.getAttribute("href") ?? "",
				alt: img?.getAttribute("alt") ?? undefined,
				width: toNumber(img?.getAttribute("width") ?? null),
				height: toNumber(img?.getAttribute("height") ?? null),
			});
			if (candidates.length >= maxResults) break;
		}
	} else {
		const anchorPattern =
			/<a\b[^>]*\bhref=(["'])([^"']*(?:\/imgres|google\.com\/imgres)[^"']*)\1[^>]*>([\s\S]*?)<\/a>/gi;
		for (const match of html.matchAll(anchorPattern)) {
			pushCandidate({
				href: match[2],
				innerHtml: match[3],
			});
			if (candidates.length >= maxResults) break;
		}
	}

	candidates.sort((a, b) => b.score - a.score);
	return candidates.slice(0, maxResults);
};

const extractCandidates = ({
	html,
	baseUrl,
	provider,
	kind,
	maxResults,
}: {
	html: string;
	baseUrl: string;
	provider: Provider;
	kind: AssetKind;
	maxResults: number;
}): Candidate[] => {
	if (provider === "google_images") {
		return extractGoogleImageCandidates({ html, baseUrl, maxResults });
	}

	const document = new DOMParser().parseFromString(html, "text/html");
	const seen = new Set<string>();
	const candidates: Candidate[] = [];

	for (const img of Array.from(document.querySelectorAll("img"))) {
		const raw =
			parseSrcset(img.getAttribute("srcset")) ||
			img.getAttribute("src") ||
			img.getAttribute("data-src") ||
			img.getAttribute("data-lazy-src");
		const resolved = resolveUrl(raw, baseUrl);
		if (!resolved) continue;

		const alt = img.getAttribute("alt") ?? "";
		const normalized = normalizeAssetUrl(resolved, provider);
		if (seen.has(normalized)) continue;
		if (isUiAsset(normalized, alt)) continue;
		if (!providerAllowsUrl(normalized, provider, kind)) continue;

		seen.add(normalized);
		const width = toNumber(img.getAttribute("width"));
		const height = toNumber(img.getAttribute("height"));
		candidates.push({
			provider,
			url: normalized,
			sourceUrl: baseUrl,
			title: document.title || undefined,
			alt: alt || undefined,
			width,
			height,
			score: scoreCandidate({ url: normalized, alt, width, height, provider }),
		});
	}

	candidates.sort((a, b) => b.score - a.score);
	return candidates.slice(0, maxResults);
};

export const createHyperframesRemoteAssetsExploreTool: ToolFactory<
	Input,
	Services,
	HyperframesToolConfig
> = (services, _config): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Explore free remote visual assets for HyperFrames. Tries supported sources in best order (CleanPNG first, then Openverse, Pexels, Unsplash; SVG Repo first for vectors), falls back when a source is blocked or has too few candidates, and returns candidate image/SVG URLs to import with hyperframes_remote_asset_import.",
	schema,
	execute: async (input) => {
		const webBrowser = requireWebBrowserService(services);
		const kind = input.kind ?? "image";
		const maxResults = input.max_results ?? DEFAULT_MAX_RESULTS;
		const minResults = input.min_results ?? Math.min(4, maxResults);
		const providers = input.providers?.length
			? input.providers
			: defaultProvidersForKind(kind);
		const attempts: ProviderAttempt[] = [];
		let bestPartial: PartialResult | null = null;
		let keepSessionId: string | undefined;

		try {
			for (const provider of providers) {
				const url = providerSearchUrl(provider, input.query);
				let sessionId: string | undefined;
				try {
					const opened = await webBrowser.openSession({
						url,
						timeoutMs: DEFAULT_TIMEOUT_MS,
						maxHtmlChars: MAX_HTML_CHARS,
						persist: true,
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
					const blocked = isRobotOrBlockedPage(session.html, session.text);
					if (blocked) {
						attempts.push({
							provider,
							url,
							success: false,
							reason: blocked,
							candidateCount: 0,
						});
						continue;
					}

					const candidates = extractCandidates({
						html: session.html,
						baseUrl: session.currentUrl || url,
						provider,
						kind,
						maxResults,
					});
					attempts.push({
						provider,
						url,
						success: candidates.length >= minResults,
						reason:
							candidates.length >= minResults
								? undefined
								: "too_few_candidates",
						candidateCount: candidates.length,
					});

					if (candidates.length >= minResults) {
						if (bestPartial?.sessionId && bestPartial.sessionId !== sessionId) {
							await webBrowser
								.closeSession(bestPartial.sessionId)
								.catch(() => undefined);
						}
						keepSessionId = sessionId;
						return createWebResult({
							actionType: TOOL_NAME,
							success: true,
							query: input.query,
							kind,
							provider,
							sessionId,
							searchUrl: session.currentUrl || url,
							candidates,
							attempts,
							nextStep:
								"Pick a candidate.url and call hyperframes_remote_asset_import with project_path and candidate.url. Save under {project_path}/resources and use the returned ./resources/... html_src in HyperFrames HTML.",
						});
					}

					if (
						candidates.length > 0 &&
						(!bestPartial ||
							candidates.length > bestPartial.candidates.length ||
							candidates[0].score > bestPartial.candidates[0].score)
					) {
						if (bestPartial?.sessionId && bestPartial.sessionId !== sessionId) {
							await webBrowser
								.closeSession(bestPartial.sessionId)
								.catch(() => undefined);
						}
						bestPartial = {
							provider,
							sessionId,
							searchUrl: session.currentUrl || url,
							candidates,
						};
						keepSessionId = sessionId;
					}
				} catch (error) {
					attempts.push({
						provider,
						url,
						success: false,
						reason: error instanceof Error ? error.message : String(error),
						candidateCount: 0,
					});
				} finally {
					// Keep only the useful provider session available for follow-up
					// import. Failed provider tabs are noisy and not useful.
					const shouldKeep = sessionId && keepSessionId === sessionId;
					if (sessionId && !shouldKeep) {
						await webBrowser.closeSession(sessionId).catch(() => undefined);
					}
				}
			}

			if (bestPartial) {
				return createWebResult({
					actionType: TOOL_NAME,
					success: true,
					fallback: "partial_candidates",
					query: input.query,
					kind,
					provider: bestPartial.provider,
					sessionId: bestPartial.sessionId,
					searchUrl: bestPartial.searchUrl,
					candidates: bestPartial.candidates,
					attempts,
					nextStep:
						"These are the best partial candidates found. Pick a candidate.url and call hyperframes_remote_asset_import with project_path and candidate.url. Save under {project_path}/resources and use the returned ./resources/... html_src in HyperFrames HTML.",
				});
			}

			return createWebResult({
				actionType: TOOL_NAME,
				success: false,
				query: input.query,
				kind,
				providers,
				attempts,
				candidates: [],
				hint: "No supported source returned enough usable candidates. Try a broader English query or kind='svg' for vector assets.",
			});
		} catch (error) {
			return createDefaultWebErrorResult(error);
		}
	},
});

toolRegistry.register(TOOL_NAME, createHyperframesRemoteAssetsExploreTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: Services;
			config: HyperframesToolConfig;
		};
	}
}
