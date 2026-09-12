import type { PlatformComposition } from "../contracts/core";
import { BaseUrlAssetResolver } from "../core/asset-resolver";
import { MutableCapabilityRegistry } from "../core/capability-registry";
import { IndexedDbKeyValueStore } from "../core/indexeddb-key-value-store";
import { InMemoryKeyValueStore } from "../core/in-memory-key-value-store";
import { NoopNavigationPort } from "../core/noop-ports";
import { hasOriginPrivateFileSystem } from "../core/origin-private-file-system";
import { WindowExternalLinkPort } from "../core/window-external-link-port";
import { UnavailableRuntimeDiagnostics } from "../core/unavailable-runtime-diagnostics";
import { DesktopBrowserCommandPort } from "./desktop-browser-command-port";
import { DesktopNativeFilesystemPort } from "./desktop-native-filesystem-port";

const capabilities = new MutableCapabilityRegistry({
	"page.capture": { available: false, reason: "No extension tab access." },
	"activity.browser": {
		available: false,
		reason: "No extension history access.",
	},
	"browser.automation": {
		available: false,
		reason: "Initializing bundled Chromium.",
	},
	// Advertised unconditionally, but it now needs the managed browser: the
	// surface that drove Memorall's own window is gone, because pointing the
	// co-agent at the app's own UI was never what "let the agent act on the
	// page" meant. Whether a page can actually be driven is reported by
	// `browser.automation`, and activation fails with a specific reason
	// (visibility off, Chromium missing) rather than silently doing nothing.
	"co-agent": { available: true },
	"sandbox.browser": {
		available: false,
		reason: "Desktop uses the local executor.",
	},
	"executor.local": {
		available: false,
		reason: "The Local executor is disabled until explicitly enabled.",
		requiresAction: "approval",
	},
	"filesystem.native": { available: true, requiresAction: "permission" },
	"mcp.stdio": { available: true, requiresAction: "approval" },
	"notifications.native": { available: true, requiresAction: "permission" },
	"updates.native": { available: true },
	"ai.webgpu": {
		available: typeof navigator !== "undefined" && "gpu" in navigator,
		reason: "WebGPU depends on the system webview and hardware.",
	},
	"ai.wasmThreads": {
		available: globalThis.crossOriginIsolated === true,
		reason: "WASM threads depend on the system webview configuration.",
	},
	"storage.opfs": {
		available: hasOriginPrivateFileSystem(),
		reason:
			"On-device GGUF models are stored in the origin private file system.",
	},
});

const persistentStore = new IndexedDbKeyValueStore({
	databaseName: "memorall-desktop-platform",
});

const browserAutomation = new DesktopBrowserCommandPort(
	capabilities,
	persistentStore,
);

const nativeFilesystem = new DesktopNativeFilesystemPort(capabilities);

export const platform: PlatformComposition = {
	environment: "desktop",
	routerMode: "hash",
	capabilities,
	assets: new BaseUrlAssetResolver("/"),
	persistentStore,
	sessionStore: new InMemoryKeyValueStore(),
	navigation: new NoopNavigationPort(),
	externalLinks: new WindowExternalLinkPort(),
	runtimeDiagnostics: new UnavailableRuntimeDiagnostics(),
	browserCommands: browserAutomation,
	browserAutomation,
	nativeFilesystem,
	lifecycle: {
		onSurfaceOpened: () => {
			void browserAutomation.initialize();
		},
	},
};
