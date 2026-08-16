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
	close(session: BackendSession): Promise<void>;
	stop(): Promise<void>;
}
