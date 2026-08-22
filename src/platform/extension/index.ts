import { BACKGROUND_EVENTS } from "@/constants/events";
import type { PlatformComposition } from "../contracts/core";
import { MutableCapabilityRegistry } from "../core/capability-registry";
import {
	BaseUrlAssetResolver,
	normalizeAssetPath,
} from "../core/asset-resolver";
import { ChromeStorageKeyValueStore } from "./chrome-storage-key-value-store";
import { ExtensionNavigationPort } from "./extension-navigation-port";
import { ExtensionExternalLinkPort } from "./extension-external-link-port";
import { ExtensionRuntimeDiagnostics } from "./extension-runtime-diagnostics";
import { ExtensionBrowserCommandPort } from "./extension-browser-command-port";
import { ExtensionHostAccessPort } from "./extension-host-access";

export const platform: PlatformComposition = {
	environment: "extension",
	routerMode: "browser",
	capabilities: new MutableCapabilityRegistry({
		"page.capture": { available: true },
		"activity.browser": { available: true },
		"browser.automation": { available: true },
		"sandbox.browser": { available: true },
		"executor.local": {
			available: false,
			reason: "Local process execution is only available in the desktop app.",
		},
		"filesystem.native": {
			available: false,
			reason: "The extension uses Memorall's virtual workspace.",
		},
		"mcp.stdio": {
			available: false,
			reason: "MCP stdio requires the desktop sidecar.",
		},
		"notifications.native": { available: true },
		"updates.native": { available: true },
		"ai.webgpu": {
			available: typeof navigator !== "undefined" && "gpu" in navigator,
			reason: "WebGPU depends on browser and hardware support.",
		},
		"ai.wasmThreads": {
			available: globalThis.crossOriginIsolated === true,
			reason: "WASM threads require cross-origin isolation.",
		},
	}),
	assets:
		typeof chrome !== "undefined" && chrome.runtime?.getURL
			? { url: (path) => chrome.runtime.getURL(normalizeAssetPath(path)) }
			: new BaseUrlAssetResolver("/"),
	persistentStore: new ChromeStorageKeyValueStore("local"),
	sessionStore: new ChromeStorageKeyValueStore("session"),
	navigation: new ExtensionNavigationPort(),
	externalLinks: new ExtensionExternalLinkPort(),
	runtimeDiagnostics: new ExtensionRuntimeDiagnostics(),
	browserCommands: new ExtensionBrowserCommandPort(),
	hostAccess: new ExtensionHostAccessPort(),
	lifecycle: {
		onSurfaceOpened: () => {
			void chrome.runtime.sendMessage({ type: BACKGROUND_EVENTS.POPUP_OPENED });
		},
	},
};
