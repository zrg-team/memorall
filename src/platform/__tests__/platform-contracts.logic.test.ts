import { describe, expect, it, vi } from "vitest";
import {
	BaseUrlAssetResolver,
	normalizeAssetPath,
} from "../core/asset-resolver";
import { MutableCapabilityRegistry } from "../core/capability-registry";
import { InMemoryKeyValueStore } from "../core/in-memory-key-value-store";
import { runKeyValueStoreContract } from "./key-value-store-contract";
import { WindowExternalLinkPort } from "../core/window-external-link-port";
import { UnavailableBrowserCommandPort } from "../core/unavailable-browser-command-port";
import { UnavailableRuntimeDiagnostics } from "../core/unavailable-runtime-diagnostics";

runKeyValueStoreContract("in-memory", () => new InMemoryKeyValueStore());

describe("AssetResolver contract", () => {
	it("resolves nested and encoded paths under a base", () => {
		const resolver = new BaseUrlAssetResolver("/memorall/studio/");
		expect(resolver.url("models/local model/model.bin")).toBe(
			"/memorall/studio/models/local%20model/model.bin",
		);
		expect(resolver.url("/vendors/runtime.wasm")).toBe(
			"/memorall/studio/vendors/runtime.wasm",
		);
	});

	it("rejects traversal, protocols, null bytes, and empty paths", () => {
		for (const path of [
			"../secret",
			"a/../../secret",
			"https://example.com/a",
			"\0",
			"",
		]) {
			expect(() => normalizeAssetPath(path)).toThrow();
		}
	});
});

describe("CapabilityRegistry contract", () => {
	it("returns unavailable for unknown capabilities and defensive copies", () => {
		const registry = new MutableCapabilityRegistry({
			"ai.webgpu": { available: true },
		});
		const state = registry.get("ai.webgpu");
		state.available = false;
		expect(registry.get("ai.webgpu").available).toBe(true);
		expect(registry.get("executor.local").available).toBe(false);
	});

	it("notifies only for material changes and cleans up subscriptions", () => {
		const registry = new MutableCapabilityRegistry();
		const listener = vi.fn();
		const unsubscribe = registry.subscribe(listener);
		registry.set("executor.local", {
			available: false,
			reason: "Approval required",
			requiresAction: "approval",
		});
		registry.set("executor.local", {
			available: false,
			reason: "Approval required",
			requiresAction: "approval",
		});
		expect(listener).toHaveBeenCalledTimes(1);
		unsubscribe();
		registry.set("executor.local", { available: true });
		expect(listener).toHaveBeenCalledTimes(1);
	});
});

describe("environment-neutral port fallbacks", () => {
	it("opens external links with opener isolation and reports popup blocking", async () => {
		const open = vi.fn().mockReturnValue({});
		vi.stubGlobal("open", open);
		const port = new WindowExternalLinkPort();
		await port.open("https://example.com/");
		expect(open).toHaveBeenCalledWith(
			"https://example.com/",
			"_blank",
			"noopener,noreferrer",
		);

		open.mockReturnValueOnce(null);
		await expect(port.open("https://blocked.example/")).rejects.toThrow(
			"blocked",
		);
		vi.unstubAllGlobals();
	});

	it("declares unavailable browser commands and runtime diagnostics", async () => {
		const browser = new UnavailableBrowserCommandPort();
		await expect(browser.tabExists(1)).resolves.toBe(false);
		await expect(browser.request({ command: "open" })).rejects.toThrow(
			"unavailable",
		);

		const diagnostics = new UnavailableRuntimeDiagnostics();
		await expect(diagnostics.status()).resolves.toEqual({
			alive: false,
			statuses: {
				webllm: { registered: false, ready: false },
				wllama: { registered: false, ready: false },
				transformer: { registered: false, ready: false },
			},
		});
		await expect(diagnostics.reset("webllm")).rejects.toThrow("unavailable");
	});
});
