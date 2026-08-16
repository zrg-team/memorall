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
		| "fetch-image";
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
