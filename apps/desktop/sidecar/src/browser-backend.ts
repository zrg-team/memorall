import type {
	BrowserCommand,
	BrowserEngine,
	BrowserMode,
	BrowserSnapshot,
	EngineStatus,
} from "./browser-runtime-types";

export interface BackendSession {
	engine: BrowserEngine;
	handle: string | number;
	url: string;
}

export class BackendOpenError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly session?: BackendSession,
	) {
		super(message);
		this.name = "BackendOpenError";
	}
}

export interface BrowserBackend {
	readonly engine: BrowserEngine;
	status(signal?: AbortSignal): Promise<EngineStatus>;
	open(
		url: string,
		mode: BrowserMode,
		timeoutMs: number,
		maxHtmlChars: number,
		signal?: AbortSignal,
	): Promise<{ session: BackendSession; snapshot: BrowserSnapshot }>;
	snapshot(
		session: BackendSession,
		maxHtmlChars: number,
		signal?: AbortSignal,
	): Promise<BrowserSnapshot>;
	query?(
		session: BackendSession,
		request: BrowserCommand,
		signal?: AbortSignal,
	): Promise<{ snapshot: BrowserSnapshot; elements: unknown[] }>;
	action?(
		session: BackendSession,
		request: BrowserCommand,
		signal?: AbortSignal,
	): Promise<{ snapshot: BrowserSnapshot; result: unknown }>;
	waitSelector?(
		session: BackendSession,
		request: BrowserCommand,
		signal?: AbortSignal,
	): Promise<{ snapshot: BrowserSnapshot; matched: boolean }>;
	screenshot?(
		session: BackendSession,
		signal?: AbortSignal,
	): Promise<{ dataUrl: string; width: number; height: number }>;
	fetchImage?(
		session: BackendSession,
		url: string,
		signal?: AbortSignal,
	): Promise<{ base64: string; mimeType: string }>;
	/**
	 * Re-fetch the page and snapshot it again. Absent on backends that cannot
	 * navigate, which are promoted to one that can before a reload is attempted.
	 */
	reload?(
		session: BackendSession,
		timeoutMs: number,
		maxHtmlChars: number,
		signal?: AbortSignal,
	): Promise<BrowserSnapshot>;
	/**
	 * Inject the co-agent into the page and keep it there across navigation.
	 *
	 * Optional because only a real Chromium over CDP can do it: the other
	 * backends have no way to run a persistent script, and a co-agent rebuilt per
	 * command would lose its trace and its overlay on every tool call. A backend
	 * without these members reports the co-agent as unsupported rather than
	 * pretending.
	 */
	coAgentAttach?(
		session: BackendSession,
		config: Record<string, unknown>,
		signal?: AbortSignal,
	): Promise<void>;
	coAgentCommand?(
		session: BackendSession,
		request: unknown,
		timeoutMs: number,
		signal?: AbortSignal,
	): Promise<unknown>;
	coAgentDetach?(session: BackendSession, signal?: AbortSignal): Promise<void>;
	close(session: BackendSession): Promise<void>;
	stop(): Promise<void>;
}
