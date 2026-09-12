export type AppEnvironment = "extension" | "web" | "desktop";

export type CapabilityId =
	| "page.capture"
	| "activity.browser"
	| "browser.automation"
	/**
	 * Whether the co-agent can attach to anything here.
	 *
	 * Distinct from `browser.automation`, which means "the bundled Chromium is
	 * ready" and is false on the extension. Desktop can run the co-agent over its
	 * own window with no managed browser at all, so gating the button on
	 * `browser.automation` would hide the feature exactly when Chromium failed to
	 * start — the case where the in-app surface is most useful.
	 */
	| "co-agent"
	| "sandbox.browser"
	| "executor.local"
	| "filesystem.native"
	| "mcp.stdio"
	| "notifications.native"
	| "updates.native"
	| "ai.webgpu"
	| "ai.wasmThreads"
	| "storage.opfs";

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

/**
 * Permission to reach a third-party host without the browser's CORS rules.
 *
 * Only the extension has one: a browser extension page is a normal web origin
 * until Chrome grants it the host, and a host declared in the manifest can
 * still be withheld — Chrome withholds host permissions added by an update
 * until the user accepts them, and the site-access menu can take them back at
 * any time. Web and desktop builds leave this undefined; nothing gates them.
 */
export interface HostAccessPort {
	/** Whether requests to `origins` currently bypass CORS. */
	has(origins: string[]): Promise<boolean>;
	/**
	 * Ask the user for `origins`. Chrome only shows the prompt from inside a
	 * user gesture, so call this from a click handler, never on mount.
	 */
	request(origins: string[]): Promise<boolean>;
}

/**
 * Why a native filesystem call failed, in terms the virtual filesystem can map
 * onto POSIX errno values. Kept as a closed union so a new native failure mode
 * cannot quietly arrive as an unhandled string.
 */
export type NativeFilesystemErrorCode =
	| "UNKNOWN_ROOT"
	| "OUT_OF_SCOPE"
	| "NOT_FOUND"
	| "EXISTS"
	| "NOT_DIR"
	| "IS_DIR"
	| "NOT_EMPTY"
	| "PERMISSION"
	| "TOO_LARGE"
	| "READ_ONLY"
	| "IO";

export interface NativeFilesystemEntry {
	name: string;
	kind: "file" | "directory";
	size: number;
	mtimeMs: number;
	birthtimeMs: number;
	readOnly: boolean;
}

export interface NativeMountRoot {
	id: string;
	/** Folder name as shown in the library; de-duplicated across roots. */
	label: string;
	/** For display only. Never used to address the filesystem. */
	displayPath: string;
	readOnly: boolean;
	/** False when the folder has gone away — unplugged, renamed, or revoked. */
	available: boolean;
}

/**
 * A live, read-write window onto real on-disk folders the user has picked.
 *
 * Every call addresses a file as `(rootId, relative)`, never as an absolute
 * path. That is the whole security model: a root can only come into existence
 * through {@link NativeFilesystemPort.addRoot}, which opens the platform's own
 * folder picker, so code running in the web view cannot name a path the user
 * has not chosen. Anything that reaches outside a registered root — `..`, an
 * absolute path, or a symlink that resolves out of it — is refused natively.
 *
 * Undefined on platforms with no real filesystem to map.
 */
export interface NativeFilesystemPort {
	listRoots(): Promise<NativeMountRoot[]>;
	/** Opens the native folder picker. Resolves null if the user cancels. */
	addRoot(): Promise<NativeMountRoot | null>;
	/** Forgets the mapping. Never touches the files on disk. */
	removeRoot(rootId: string): Promise<void>;
	/** One call per directory: entries carry their own metadata so that listing
	 *  a folder costs one round trip rather than one plus one per file. */
	list(rootId: string, path: string): Promise<NativeFilesystemEntry[]>;
	stat(rootId: string, path: string): Promise<NativeFilesystemEntry>;
	read(
		rootId: string,
		path: string,
		start: number,
		end: number,
	): Promise<Uint8Array>;
	write(
		rootId: string,
		path: string,
		offset: number,
		data: Uint8Array,
		truncate: boolean,
	): Promise<void>;
	createFile(rootId: string, path: string): Promise<NativeFilesystemEntry>;
	mkdir(rootId: string, path: string): Promise<NativeFilesystemEntry>;
	unlink(rootId: string, path: string): Promise<void>;
	rmdir(rootId: string, path: string): Promise<void>;
	rename(rootId: string, from: string, to: string): Promise<void>;
	touch(rootId: string, path: string, mtimeMs: number): Promise<void>;
	/**
	 * A cheap, non-recursive change probe for one directory.
	 *
	 * A fallback for when watching is unavailable — some network and virtual
	 * filesystems do not raise change events at all.
	 */
	revision(
		rootId: string,
		path: string,
	): Promise<{ entries: number; maxMtimeMs: number }>;
	/**
	 * Report changes made to mapped folders outside Memorall.
	 *
	 * `paths` are root-relative; an empty array means the change was too large to
	 * enumerate and the subtree should be refreshed wholesale. Resolves to an
	 * unsubscribe function.
	 */
	watch(listener: (change: NativeFolderChange) => void): Promise<() => void>;
}

export interface NativeFolderChange {
	rootId: string;
	paths: string[];
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
	/** Undefined where the platform needs no permission to call out. */
	hostAccess?: HostAccessPort;
	/** Undefined where the platform has no real filesystem to map. */
	nativeFilesystem?: NativeFilesystemPort;
	lifecycle: AppLifecyclePort;
}
