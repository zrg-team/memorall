export const WEB_BROWSER_COMMAND_SOURCE =
	"memorall:web-browser-command" as const;

export type BrowserMode = "tab" | "window";
export type BrowserEngine = "direct" | "lightpanda" | "browseros" | "chromium";
export type BrowserReadiness =
	| "initializing"
	| "ready"
	| "degraded"
	| "needs-user"
	| "unavailable";

export interface BrowserSettings {
	persistProfile: boolean;
	visible: boolean;
}

export interface BrowserSnapshot {
	url: string;
	title: string;
	html: string;
	text: string;
	domAccessible: boolean;
	/** `document.contentType`: a file type when the page is a PDF or image. */
	contentType?: string;
}

export interface EngineFailure {
	code: string;
	message: string;
}

export interface EngineStatus {
	engine: BrowserEngine;
	readiness: "ready" | "unavailable";
	version: string | null;
	failure?: EngineFailure;
}

export interface BrowserAutomationStatus {
	ready: boolean;
	readiness: BrowserReadiness;
	engine: BrowserEngine | null;
	engineVersion: string | null;
	rendererVersion: string | null;
	engines: EngineStatus[];
	persistProfile: boolean;
	visible: boolean;
	activeSessions: number;
	sessions: Array<{
		tabId: number;
		engine: BrowserEngine;
		url: string;
		paused: boolean;
	}>;
	error?: EngineFailure;
	exists?: boolean;
}

export type BrowserCommand = Record<string, unknown> & {
	source: typeof WEB_BROWSER_COMMAND_SOURCE;
	command:
		| "open"
		| "snapshot"
		| "dom-query"
		| "dom-action"
		| "wait-selector"
		| "close"
		| "screenshot"
		| "fetch-image"
		| "reload"
		| "outline"
		| "outline-action"
		| "history"
		| "navigate";
	sessionId: string;
};

export class BrowserAutomationError extends Error {
	constructor(
		readonly code: string,
		message: string,
	) {
		super(message);
		this.name = "BrowserAutomationError";
	}
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const requiredString = (
	value: Record<string, unknown>,
	key: string,
): string => {
	const result = value[key];
	if (typeof result !== "string" || result.length === 0) {
		throw new BrowserAutomationError(
			"INVALID_BROWSER_REQUEST",
			`Browser request field ${key} must be a non-empty string.`,
		);
	}
	return result;
};

export const requiredNumber = (
	value: Record<string, unknown>,
	key: string,
): number => {
	const result = value[key];
	if (typeof result !== "number" || !Number.isFinite(result)) {
		throw new BrowserAutomationError(
			"INVALID_BROWSER_REQUEST",
			`Browser request field ${key} must be a finite number.`,
		);
	}
	return result;
};

export const parseBrowserCommand = (value: unknown): BrowserCommand => {
	if (!isRecord(value) || value.source !== WEB_BROWSER_COMMAND_SOURCE) {
		throw new BrowserAutomationError(
			"INVALID_BROWSER_REQUEST",
			"Browser request has an invalid source.",
		);
	}
	const command = requiredString(value, "command");
	if (
		![
			"open",
			"snapshot",
			"dom-query",
			"dom-action",
			"wait-selector",
			"close",
			"screenshot",
			"fetch-image",
			"reload",
			"outline",
			"outline-action",
			"history",
			"navigate",
		].includes(command)
	) {
		throw new BrowserAutomationError(
			"INVALID_BROWSER_REQUEST",
			`Unsupported browser command: ${command}`,
		);
	}
	requiredString(value, "sessionId");
	if (command === "open") {
		requiredString(value, "url");
		const mode = requiredString(value, "mode");
		if (mode !== "tab" && mode !== "window") {
			throw new BrowserAutomationError(
				"INVALID_BROWSER_REQUEST",
				`Unsupported browser mode: ${mode}`,
			);
		}
		requiredNumber(value, "timeoutMs");
		requiredNumber(value, "maxHtmlChars");
	} else if (command !== "close") {
		requiredNumber(value, "tabId");
	}
	if (command === "snapshot") {
		requiredNumber(value, "timeoutMs");
		requiredNumber(value, "maxHtmlChars");
	}
	if (command === "dom-query") {
		requiredString(value, "selector");
		requiredNumber(value, "maxResults");
		requiredNumber(value, "timeoutMs");
		requiredNumber(value, "maxHtmlChars");
	}
	if (command === "dom-action") {
		requiredString(value, "selector");
		const action = requiredString(value, "action");
		if (
			![
				"read",
				"click",
				"input",
				"focus",
				"scrollBottom",
				"scrollTop",
			].includes(action)
		) {
			throw new BrowserAutomationError(
				"INVALID_BROWSER_REQUEST",
				`Unsupported DOM action: ${action}`,
			);
		}
		requiredNumber(value, "timeoutMs");
		requiredNumber(value, "maxHtmlChars");
	}
	if (command === "wait-selector") {
		requiredString(value, "selector");
		const state = requiredString(value, "state");
		if (state !== "present" && state !== "absent") {
			throw new BrowserAutomationError(
				"INVALID_BROWSER_REQUEST",
				`Unsupported selector state: ${state}`,
			);
		}
		requiredNumber(value, "timeoutMs");
		requiredNumber(value, "intervalMs");
		requiredNumber(value, "maxHtmlChars");
	}
	if (command === "fetch-image") requiredString(value, "url");
	if (command === "outline" || command === "outline-action") {
		requiredNumber(value, "timeoutMs");
		requiredNumber(value, "maxChars");
	}
	if (command === "outline-action") {
		const request = value.request;
		if (!isRecord(request) || typeof request.action !== "string") {
			throw new BrowserAutomationError(
				"INVALID_BROWSER_REQUEST",
				"Browser request field request must describe an outline action.",
			);
		}
		if (
			![
				"click",
				"hover",
				"press",
				"toggle",
				"input",
				"focus",
				"submit",
				"scrollScreen",
				"describe",
			].includes(request.action)
		) {
			throw new BrowserAutomationError(
				"INVALID_BROWSER_REQUEST",
				`Unsupported outline action: ${request.action}`,
			);
		}
	}
	if (command === "navigate") {
		requiredString(value, "url");
		requiredNumber(value, "timeoutMs");
		requiredNumber(value, "maxHtmlChars");
	}
	if (command === "history") {
		requiredNumber(value, "timeoutMs");
		requiredNumber(value, "maxHtmlChars");
		const direction = requiredString(value, "direction");
		if (direction !== "back" && direction !== "forward") {
			throw new BrowserAutomationError(
				"INVALID_BROWSER_REQUEST",
				`Unsupported history direction: ${direction}`,
			);
		}
	}
	return value as BrowserCommand;
};

export const checkedHttpUrl = (rawUrl: string): string => {
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new BrowserAutomationError("INVALID_URL", `Invalid URL: ${rawUrl}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new BrowserAutomationError(
			"UNSUPPORTED_URL_SCHEME",
			`Desktop browser automation only supports HTTP(S) URLs: ${url.protocol}`,
		);
	}
	if (url.username || url.password) {
		throw new BrowserAutomationError(
			"URL_CREDENTIALS_NOT_ALLOWED",
			"Credentials embedded in browser URLs are not allowed.",
		);
	}
	return url.toString();
};

/**
 * An empty tab: the one non-HTTP(S) page a real browser may be opened on.
 *
 * Needed for the co-agent, which is switched on before the user has picked a
 * page — the desktop equivalent of the extension attaching to the tab already
 * in front of them. Both real browsers create a blank tab before navigating
 * anyway, so opening this means creating the tab and not navigating at all.
 */
export const BLANK_PAGE_URL = "about:blank";

/**
 * {@link checkedHttpUrl}, plus an empty tab.
 *
 * Only for backends that are real browsers and only for opening a page; every
 * navigation keeps using `checkedHttpUrl`. URLs usually come from the agent,
 * which web content can steer, so this stays a single exact string rather than
 * the `about:` scheme — `about:config`-style internal pages, `about:blank#…`
 * and different casings are all still refused.
 */
export const checkedPageUrl = (rawUrl: string): string =>
	rawUrl === BLANK_PAGE_URL ? BLANK_PAGE_URL : checkedHttpUrl(rawUrl);

export const responseError = (request: BrowserCommand, error: unknown) => ({
	source: WEB_BROWSER_COMMAND_SOURCE,
	command: request.command,
	success: false,
	sessionId: request.sessionId,
	error:
		error instanceof BrowserAutomationError
			? `${error.code}: ${error.message}`
			: error instanceof Error
				? error.message
				: String(error),
});

/** Which part of the page a screenshot keeps, in CSS pixels. */
export interface ScreenshotOptions {
	/** The whole page, top to bottom, not only what the viewport shows. */
	fullPage?: boolean;
	/** Of the viewport, or with `fullPage`, of the page from its top-left. */
	clip?: { x: number; y: number; width: number; height: number };
}

/** The tallest picture a screenshot makes, in pixels: a longer page is cut. */
export const SCREENSHOT_MAX_HEIGHT = 16_384;

export const screenshotOptions = (
	request: BrowserCommand,
): ScreenshotOptions => {
	const options: ScreenshotOptions = {};
	if (request.fullPage === true) options.fullPage = true;
	const clip = request.clip;
	if (clip !== undefined) {
		if (
			!isRecord(clip) ||
			!["x", "y", "width", "height"].every((key) => Number.isFinite(clip[key]))
		) {
			throw new BrowserAutomationError(
				"INVALID_BROWSER_REQUEST",
				"A screenshot's clip needs x, y, width and height.",
			);
		}
		options.clip = {
			x: Number(clip.x),
			y: Number(clip.y),
			width: Number(clip.width),
			height: Number(clip.height),
		};
	}
	return options;
};

/** What `Page.getLayoutMetrics` says of the page, in CSS pixels. */
export interface CdpLayoutMetrics {
	cssLayoutViewport?: {
		pageX?: number;
		pageY?: number;
		clientWidth?: number;
		clientHeight?: number;
	};
	cssContentSize?: { width?: number; height?: number };
}

/**
 * The CDP `clip` of a screenshot, in page coordinates as CDP takes it, and
 * whether a page too long to keep was cut. Throws when the rectangle misses
 * the viewport (or, with `fullPage`, the page).
 */
export const screenshotClip = (
	options: ScreenshotOptions,
	layout: CdpLayoutMetrics,
): {
	clip: { x: number; y: number; width: number; height: number; scale: 1 };
	cut: boolean;
} => {
	const viewport = layout.cssLayoutViewport ?? {};
	const scrollX = viewport.pageX ?? 0;
	const scrollY = viewport.pageY ?? 0;
	const width = viewport.clientWidth ?? 0;
	const height = viewport.clientHeight ?? 0;
	const bounds = options.fullPage
		? {
				x: 0,
				y: 0,
				width,
				height: Math.max(layout.cssContentSize?.height ?? 0, height),
			}
		: { x: scrollX, y: scrollY, width, height };
	const clip = options.clip;
	const wanted =
		clip && !options.fullPage
			? { ...clip, x: clip.x + scrollX, y: clip.y + scrollY }
			: (clip ?? bounds);
	const x = Math.max(wanted.x, bounds.x);
	const y = Math.max(wanted.y, bounds.y);
	const keptWidth =
		Math.min(wanted.x + wanted.width, bounds.x + bounds.width) - x;
	const keptHeight =
		Math.min(wanted.y + wanted.height, bounds.y + bounds.height) - y;
	if (!(keptWidth >= 1 && keptHeight >= 1)) {
		throw new BrowserAutomationError(
			"SCREENSHOT_AREA_EMPTY",
			options.fullPage
				? "That rectangle is not on the page."
				: "That rectangle is not in the viewport: give x, y within it, or take the whole page.",
		);
	}
	const cut = keptHeight > SCREENSHOT_MAX_HEIGHT;
	return {
		clip: {
			x,
			y,
			width: keptWidth,
			height: cut ? SCREENSHOT_MAX_HEIGHT : keptHeight,
			scale: 1,
		},
		cut,
	};
};

export const pngDimensions = (
	bytes: Buffer,
): { width: number; height: number } =>
	bytes.length < 24
		? { width: 0, height: 0 }
		: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };

export const withTimeoutSignal = (
	timeoutMs: number,
	signal?: AbortSignal,
): { signal: AbortSignal; dispose: () => void } => {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));
	const abort = () => controller.abort();
	signal?.addEventListener("abort", abort, { once: true });
	if (signal?.aborted) controller.abort();
	return {
		signal: controller.signal,
		dispose: () => {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", abort);
		},
	};
};
