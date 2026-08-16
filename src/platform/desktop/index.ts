import type { PlatformComposition } from "../contracts/core";
import { BaseUrlAssetResolver } from "../core/asset-resolver";
import { MutableCapabilityRegistry } from "../core/capability-registry";
import { IndexedDbKeyValueStore } from "../core/indexeddb-key-value-store";
import { InMemoryKeyValueStore } from "../core/in-memory-key-value-store";
import { NoopNavigationPort } from "../core/noop-ports";
import { WindowExternalLinkPort } from "../core/window-external-link-port";
import { UnavailableRuntimeDiagnostics } from "../core/unavailable-runtime-diagnostics";
import { DesktopBrowserCommandPort } from "./desktop-browser-command-port";

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
});

const persistentStore = new IndexedDbKeyValueStore({
	databaseName: "memorall-desktop-platform",
});

const browserAutomation = new DesktopBrowserCommandPort(
	capabilities,
	persistentStore,
);

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
	lifecycle: {
		onSurfaceOpened: () => {
			void browserAutomation.initialize();
		},
	},
};
