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
	lifecycle: AppLifecyclePort;
}
