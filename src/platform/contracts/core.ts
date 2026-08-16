export type AppEnvironment = "extension" | "web" | "desktop";

export type CapabilityId =
	| "page.capture"
	| "activity.browser"
	| "browser.automation"
	| "sandbox.browser"
	| "executor.local"
	| "filesystem.native"
	| "mcp.stdio"
	| "notifications.native"
	| "updates.native"
	| "ai.webgpu"
	| "ai.wasmThreads";

export type CapabilityAction = "permission" | "download" | "approval";

export interface CapabilityState {
	available: boolean;
	reason?: string;
	requiresAction?: CapabilityAction;
}

export interface CapabilityRegistry {
	get(id: CapabilityId): CapabilityState;
	subscribe(listener: () => void): () => void;
}

export interface RuntimeTransport {
	request<T>(method: string, params: unknown, signal?: AbortSignal): Promise<T>;
	stream<T>(
		method: string,
		params: unknown,
		signal?: AbortSignal,
	): AsyncIterable<T>;
	close(): Promise<void>;
}

export interface AssetResolver {
	url(path: string): string;
}

export interface KeyValueStore {
	get<T>(key: string): Promise<T | null>;
	set<T>(key: string, value: T): Promise<void>;
	remove(key: string): Promise<void>;
	subscribe<T>(key: string, listener: (value: T | null) => void): () => void;
}

export interface NavigationRequest {
	path: string;
	state?: unknown;
}

export interface AppNavigationPort {
	takePending(): Promise<NavigationRequest | null>;
	subscribe(listener: (request: NavigationRequest) => void): () => void;
}

export interface ExternalLinkPort {
	open(url: string): Promise<void>;
	openStandalone(): Promise<void>;
}

export type RuntimeServiceName = "webllm" | "wllama" | "transformer";

export interface RuntimeServiceStatus {
	registered: boolean;
	ready: boolean;
}

export interface RuntimeDiagnosticsSnapshot {
	alive: boolean;
	statuses: Record<RuntimeServiceName, RuntimeServiceStatus>;
}

export interface RuntimeDiagnosticsPort {
	status(): Promise<RuntimeDiagnosticsSnapshot>;
	reset(service: RuntimeServiceName): Promise<void>;
}

export interface BrowserCommandPort {
	request<T>(request: unknown): Promise<T>;
	tabExists(tabId: number): Promise<boolean>;
}

export type ManagedBrowserReadiness =
	| "initializing"
	| "ready"
	| "degraded"
	| "needs-user"
	| "unavailable";

export type ManagedBrowserEngine =
	| "direct"
	| "lightpanda"
	| "browseros"
	| "chromium";

export interface ManagedBrowserFailure {
	code: string;
	message: string;
}

export interface ManagedBrowserStatus {
	readiness: ManagedBrowserReadiness;
	engine: ManagedBrowserEngine | null;
	engineVersion: string | null;
	rendererVersion: string | null;
	engines: Array<{
		engine: ManagedBrowserEngine;
		readiness: "ready" | "unavailable";
		version: string | null;
		failure?: ManagedBrowserFailure;
	}>;
	persistProfile: boolean;
	visible: boolean;
	activeSessions: number;
	sessions: Array<{
		tabId: number;
		engine: ManagedBrowserEngine;
		url: string;
		paused: boolean;
	}>;
	failure?: ManagedBrowserFailure;
}

export interface ManagedBrowserSettings {
	persistProfile: boolean;
	visible: boolean;
}

export interface BrowserAutomationControl {
	getSnapshot(): ManagedBrowserStatus;
	refresh(): Promise<ManagedBrowserStatus>;
	configure(settings: ManagedBrowserSettings): Promise<ManagedBrowserStatus>;
	clearProfile(): Promise<ManagedBrowserStatus>;
	takeover(tabId: number): Promise<ManagedBrowserStatus>;
	resume(tabId: number): Promise<ManagedBrowserStatus>;
	subscribe(listener: () => void): () => void;
}

export type AppSurface = "popup" | "standalone" | "web" | "desktop";

export interface AppLifecyclePort {
	onSurfaceOpened(surface: AppSurface): void | Promise<void>;
}

export type RouterMode = "browser" | "hash";

export interface PlatformComposition {
	environment: AppEnvironment;
	routerMode: RouterMode;
	capabilities: CapabilityRegistry;
	assets: AssetResolver;
	persistentStore: KeyValueStore;
	sessionStore: KeyValueStore;
	navigation: AppNavigationPort;
	externalLinks: ExternalLinkPort;
	runtimeDiagnostics: RuntimeDiagnosticsPort;
	browserCommands: BrowserCommandPort;
	browserAutomation?: BrowserAutomationControl;
	lifecycle: AppLifecyclePort;
}
