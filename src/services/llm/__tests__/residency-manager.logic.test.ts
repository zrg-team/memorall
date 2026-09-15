import { describe, expect, it, vi } from "vitest";

vi.mock("@/utils/logger", () => ({
	logInfo: vi.fn(),
	logWarn: vi.fn(),
}));

import type { ModelsResponse } from "../interfaces/base-llm";
import { ResidencyBusyError, ResidencyManager } from "../residency-manager";

type Loaded = Record<string, string[]>;

/** A fake fleet of runners that load whatever `acquire` lets through. */
function createFleet(initial: Loaded = {}) {
	const loaded: Loaded = {
		wllama: [],
		transformer: [],
		"transformer-media": [],
		openai: [],
		...initial,
	};
	const unloads: string[] = [];
	const released: string[] = [];
	const local = new Set(["wllama", "transformer", "transformer-media"]);

	const manager = new ResidencyManager({
		list: () => Object.keys(loaded),
		isResidentLocal: (name) => local.has(name),
		modelsFor: async (name): Promise<ModelsResponse> => ({
			object: "list",
			data: (loaded[name] ?? []).map((id) => ({
				id,
				object: "model",
				created: 0,
				owned_by: name,
				loaded: true,
			})),
		}),
		unloadFor: async (name, modelId) => {
			unloads.push(`${name}/${modelId}`);
			loaded[name] = (loaded[name] ?? []).filter((id) => id !== modelId);
		},
		releaseRunner: (name) => released.push(name),
	});

	const load = async (name: string, modelId: string) => {
		const release = await manager.acquire(name, modelId);
		if (!loaded[name]?.includes(modelId)) {
			loaded[name] = [...(loaded[name] ?? []), modelId];
		}
		return release;
	};

	return { manager, loaded, unloads, released, load };
}

describe("ResidencyManager", () => {
	it("unloads the chat model before a speech model loads", async () => {
		const fleet = createFleet({ wllama: ["chat.gguf"] });

		const release = await fleet.load("transformer-media", "org/speech-model");
		release();

		expect(fleet.unloads).toEqual(["wllama/chat.gguf"]);
		expect(fleet.loaded.wllama).toEqual([]);
		expect(fleet.manager.current).toEqual({
			serviceName: "transformer-media",
			modelId: "org/speech-model",
		});
	});

	it("tears down a media runner it evicted, but leaves chat runners alive", async () => {
		const fleet = createFleet({ "transformer-media": ["org/asr-model"] });

		(await fleet.load("wllama", "chat.gguf"))();
		expect(fleet.released).toEqual(["transformer-media"]);

		(await fleet.load("transformer-media", "tts"))();
		// wllama was evicted too; the release hook decides what to destroy.
		expect(fleet.released).toEqual(["transformer-media", "wllama"]);
	});

	it("never evicts a model mid-operation", async () => {
		const fleet = createFleet();
		const releaseChat = await fleet.load("wllama", "chat.gguf");

		let speechReady = false;
		const speech = fleet.load("transformer-media", "tts").then((release) => {
			speechReady = true;
			return release;
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(speechReady).toBe(false);
		expect(fleet.unloads).toEqual([]);

		releaseChat();
		(await speech)();
		expect(speechReady).toBe(true);
		expect(fleet.unloads).toEqual(["wllama/chat.gguf"]);
	});

	it("lets concurrent operations share the resident model", async () => {
		const fleet = createFleet();
		const first = await fleet.load("wllama", "chat.gguf");
		const second = await fleet.load("wllama", "chat.gguf");

		expect(fleet.unloads).toEqual([]);
		first();
		second();
	});

	it("ignores remote providers entirely", async () => {
		const fleet = createFleet({ wllama: ["chat.gguf"] });

		const release = await fleet.manager.acquire("openai", "hosted-tts");
		release();

		expect(fleet.unloads).toEqual([]);
		expect(fleet.loaded.wllama).toEqual(["chat.gguf"]);
	});

	it("evicts models a runner loaded outside the manager", async () => {
		// Chat runners lazy-load on request, so what is actually in memory can
		// differ from what the manager last granted.
		const fleet = createFleet({
			transformer: ["org/chat-model"],
			"transformer-media": ["org/asr-model"],
		});

		(await fleet.load("wllama", "chat.gguf"))();

		expect(fleet.unloads.sort()).toEqual([
			"transformer-media/org/asr-model",
			"transformer/org/chat-model",
		]);
	});

	it("releaseAll frees every local model once work drains", async () => {
		const fleet = createFleet();
		const release = await fleet.load("wllama", "chat.gguf");

		const releasing = fleet.manager.releaseAll();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(fleet.unloads).toEqual([]);

		release();
		await releasing;
		expect(fleet.unloads).toEqual(["wllama/chat.gguf"]);
		expect(fleet.manager.current).toBeNull();
	});

	it("keeps working after an unload fails", async () => {
		const fleet = createFleet({ wllama: ["stuck.gguf"] });
		const manager = new ResidencyManager({
			list: () => ["wllama", "transformer-media"],
			isResidentLocal: () => true,
			modelsFor: async (name) => ({
				object: "list",
				data:
					name === "wllama"
						? [
								{
									id: "stuck.gguf",
									object: "model",
									created: 0,
									owned_by: "wllama",
									loaded: true,
								},
							]
						: [],
			}),
			unloadFor: async () => {
				throw new Error("runner gone");
			},
		});

		const release = await manager.acquire("transformer-media", "tts");
		release();
		expect(manager.current?.serviceName).toBe("transformer-media");
		expect(fleet.unloads).toEqual([]);
	});
	it("gives up on a switch that would wait on a model busy forever", async () => {
		vi.useFakeTimers();
		try {
			const manager = new ResidencyManager(
				{
					list: () => ["wllama", "transformer-media"],
					isResidentLocal: () => true,
					modelsFor: async () => ({ object: "list", data: [] }),
					unloadFor: async () => undefined,
				},
				{ drainTimeoutMs: 1_000 },
			);
			await manager.acquire("wllama", "chat.gguf"); // never released
			const switching = manager.acquire(
				"transformer-media",
				"org/speech-model",
			);
			const outcome =
				expect(switching).rejects.toBeInstanceOf(ResidencyBusyError);
			await vi.advanceTimersByTimeAsync(1_000);
			await outcome;
		} finally {
			vi.useRealTimers();
		}
	});

	it("skips stopped runners and tears down a runner when it switches models itself", async () => {
		const asked: string[] = [];
		const released: string[] = [];
		const loaded: Record<string, string[]> = {
			"transformer-media": ["org/asr-model"],
			transformer: ["org/chat-model"],
		};
		const manager = new ResidencyManager({
			list: () => Object.keys(loaded),
			isResidentLocal: () => true,
			isRunnerActive: (name) => name === "transformer-media",
			modelsFor: async (name) => {
				asked.push(name);
				return {
					object: "list",
					data: (loaded[name] ?? []).map((id) => ({
						id,
						object: "model" as const,
						created: 0,
						owned_by: name,
						loaded: true,
					})),
				};
			},
			unloadFor: async (name, id) => {
				loaded[name] = (loaded[name] ?? []).filter((entry) => entry !== id);
			},
			releaseRunner: (name) => released.push(name),
		});

		(await manager.acquire("transformer-media", "org/speech-model"))();

		expect(asked).toEqual(["transformer-media"]);
		expect(released).toEqual(["transformer-media"]);
	});
});
