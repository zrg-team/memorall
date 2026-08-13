import type { PlatformComposition } from "../contracts/core";
import { BaseUrlAssetResolver } from "../core/asset-resolver";
import { MutableCapabilityRegistry } from "../core/capability-registry";
import { IndexedDbKeyValueStore } from "../core/indexeddb-key-value-store";
import { InMemoryKeyValueStore } from "../core/in-memory-key-value-store";
import { NoopNavigationPort, noopLifecyclePort } from "../core/noop-ports";
import { WindowExternalLinkPort } from "../core/window-external-link-port";
import { UnavailableRuntimeDiagnostics } from "../core/unavailable-runtime-diagnostics";
import { UnavailableBrowserCommandPort } from "../core/unavailable-browser-command-port";

export const platform: PlatformComposition = {
	environment: "web",
	routerMode: "hash",
	capabilities: new MutableCapabilityRegistry({
		"page.capture": { available: false, reason: "No extension tab access." },
		"activity.browser": {
			available: false,
			reason: "No extension history access.",
		},
		"browser.automation": {
			available: false,
			reason:
				"Managed browser automation requires the extension or desktop app.",
		},
		"sandbox.browser": { available: true },
		"executor.local": { available: false, reason: "No native process access." },
		"filesystem.native": {
			available: "showDirectoryPicker" in globalThis,
			reason: "Native folders require the browser file-system picker.",
			requiresAction: "permission",
		},
		"mcp.stdio": { available: false, reason: "No native stdio access." },
		"notifications.native": {
			available: typeof Notification !== "undefined",
			reason: "Browser notification permission is required.",
			requiresAction: "permission",
		},
		"updates.native": {
			available: false,
			reason: "Updates arrive with deployment.",
		},
		"ai.webgpu": {
			available: typeof navigator !== "undefined" && "gpu" in navigator,
			reason: "WebGPU depends on browser and hardware support.",
		},
		"ai.wasmThreads": {
			available: globalThis.crossOriginIsolated === true,
			reason: "GitHub Pages does not provide the required isolation headers.",
		},
	}),
	assets: new BaseUrlAssetResolver("/memorall/studio/"),
	persistentStore: new IndexedDbKeyValueStore({
		databaseName: "memorall-web-platform",
	}),
	sessionStore: new InMemoryKeyValueStore(),
	navigation: new NoopNavigationPort(),
	externalLinks: new WindowExternalLinkPort(),
	runtimeDiagnostics: new UnavailableRuntimeDiagnostics(),
	browserCommands: new UnavailableBrowserCommandPort(),
	lifecycle: noopLifecyclePort,
};
