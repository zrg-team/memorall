import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drives the real wllama runner over its postMessage protocol with a stand-in
 * for the wllama library, so the runner's own decisions — which backend to
 * offload to, how big a context to ask for, what it does with an OpenAI image
 * part — are exercised rather than asserted against its source text.
 */

type RunnerMessageHandler = (event: MessageEvent) => void | Promise<void>;

interface LoadCall {
	loadArgs: Record<string, unknown>;
	options: Record<string, unknown>;
}

interface CompletionCall {
	messages: unknown[];
	tools?: unknown;
	tool_choice?: unknown;
	stream?: boolean;
	max_tokens?: number;
}

interface CacheEntry {
	name: string;
	size: number;
	metadata: { originalURL: string; mmprojURL?: string; originalSize: number };
}

const RUNNER_PATH = "../../../../../public/runner/modes/wllama-runner.js";

/** Everything a test can steer about the fake library, reset between tests. */
const lab = {
	loadCalls: [] as LoadCall[],
	completionCalls: [] as CompletionCall[],
	/** Consulted per attempt, so a retry ladder can be steered attempt by attempt. */
	loadFailure: null as
		| ((call: LoadCall, attempt: number) => Error | null)
		| null,
	chatTemplate: "{{ messages }}" as string | null,
	modalities: new Set<string>(),
	cacheEntries: [] as CacheEntry[],
	deletedPredicates: [] as ((entry: CacheEntry) => boolean)[],
	completionResult: null as unknown,
	streamChunks: [] as unknown[],
	loadedContextInfo: { n_ctx: 4096 } as Record<string, unknown>,
	exitCalls: 0,
};

class FakeCacheManager {
	async list() {
		return lab.cacheEntries;
	}
	async delete() {}
	async deleteMany(predicate: (entry: CacheEntry) => boolean) {
		lab.deletedPredicates.push(predicate);
	}
}

class FakeWllama {
	cacheManager = new FakeCacheManager();
	_usesGPU = false;

	async loadModelFromHF(
		loadArgs: Record<string, unknown>,
		options: Record<string, unknown>,
	) {
		const call = { loadArgs, options };
		lab.loadCalls.push(call);
		const failure = lab.loadFailure?.(call, lab.loadCalls.length) ?? null;
		if (failure) throw failure;
	}

	getChatTemplate() {
		return lab.chatTemplate;
	}

	supportInputModality(modality: string) {
		return lab.modalities.has(modality);
	}

	getLoadedContextInfo() {
		return lab.loadedContextInfo;
	}

	async createChatCompletion(params: CompletionCall) {
		lab.completionCalls.push(params);
		if (params.stream) {
			const chunks = lab.streamChunks;
			return (async function* () {
				for (const chunk of chunks) yield chunk;
			})();
		}
		return lab.completionResult;
	}

	async exit() {
		lab.exitCalls += 1;
	}
}

class FakeModelManager {
	static parseModelUrl(url: string) {
		const match = url.match(/^(.+)-(\d{5})-of-(\d{5})\.gguf$/);
		if (!match) return [url];
		const total = Number(match[3]);
		return Array.from(
			{ length: total },
			(_unused, index) =>
				`${match[1]}-${String(index + 1).padStart(5, "0")}-of-${match[3]}.gguf`,
		);
	}
}

// vi.mock is hoisted above the const declarations, so the path is inline.
vi.mock("../../../../../public/runner/libs/wllama.js", () => ({
	Wllama: FakeWllama,
	ModelManager: FakeModelManager,
}));

interface RunnerReply {
	type: string;
	// biome-ignore lint/suspicious/noExplicitAny: assertions read arbitrary payloads
	payload: any;
}

interface Runner {
	send: (type: string, payload?: unknown) => Promise<RunnerReply[]>;
}

/**
 * Fresh runner module with a chosen WebGPU verdict. The runner memoises the
 * adapter probe, so each backend scenario needs its own module instance.
 */
async function loadRunner({ webgpu }: { webgpu: boolean }): Promise<Runner> {
	vi.resetModules();

	let handleMessage: RunnerMessageHandler | undefined;
	const nativeAddEventListener = window.addEventListener.bind(window);
	vi.spyOn(window, "addEventListener").mockImplementation(((
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	) => {
		if (type === "message") {
			handleMessage = listener as RunnerMessageHandler;
			return;
		}
		nativeAddEventListener(type, listener, options);
	}) as typeof window.addEventListener);

	Object.defineProperty(navigator, "gpu", {
		configurable: true,
		value: webgpu ? { requestAdapter: async () => ({}) } : undefined,
	});

	await import(RUNNER_PATH);
	if (!handleMessage) throw new Error("runner did not register a listener");
	const dispatch = handleMessage;

	let counter = 0;
	return {
		async send(type, payload) {
			counter += 1;
			const messageId = `req-${counter}`;
			const replies: RunnerReply[] = [];
			const source = {
				postMessage: (message: {
					messageId: string;
					type: string;
					payload: unknown;
				}) => {
					if (message.messageId === messageId) {
						replies.push({ type: message.type, payload: message.payload });
					}
				},
			};
			await dispatch({
				data: { messageId, type, payload },
				origin: window.location.origin,
				source,
			} as unknown as MessageEvent);
			return replies;
		},
	};
}

const MODEL = "LiquidAI/LFM2.5-350M-GGUF/LFM2.5-350M-Q4_K_M.gguf";
const PNG_BASE64 = "iVBORw0KGgo=";
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const textReply = {
	id: "chatcmpl-1",
	object: "chat.completion",
	choices: [
		{
			index: 0,
			message: { role: "assistant", content: "ok" },
			finish_reason: "stop",
		},
	],
};

beforeEach(() => {
	lab.loadCalls = [];
	lab.completionCalls = [];
	lab.loadFailure = null;
	lab.chatTemplate = "{{ messages }}";
	lab.modalities = new Set();
	lab.cacheEntries = [];
	lab.deletedPredicates = [];
	lab.completionResult = textReply;
	lab.streamChunks = [];
	lab.loadedContextInfo = { n_ctx: 4096 };
	lab.exitCalls = 0;
	vi.spyOn(console, "log").mockImplementation(() => undefined);
	vi.spyOn(console, "warn").mockImplementation(() => undefined);
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: true, json: async () => ({ siblings: [] }) })),
	);
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

const lastLoad = () => lab.loadCalls[lab.loadCalls.length - 1];

describe("WebGPU offload", () => {
	it("offloads every layer when the device has an adapter", async () => {
		const runner = await loadRunner({ webgpu: true });

		const [reply] = await runner.send("serve", { model: MODEL });

		expect(reply.type).toBe("complete");
		expect(lastLoad().options.n_gpu_layers).toBe(999);
		expect(reply.payload.capabilities.usesGPU).toBe(true);
	});

	it("offloads even for a model catalogued as not requiring a GPU", async () => {
		// Every wllama entry is catalogued requiresWebGPU:false because each one
		// also runs on CPU. That must not read as "keep this model off the GPU".
		const runner = await loadRunner({ webgpu: true });

		await runner.send("serve", {
			model: MODEL,
			_memoryHint: {
				availableGB: 8,
				webgpuAvailableGB: 8,
				sizeGB: 0.3,
				kvBytesPerToken: 12288,
				contextLength: 128000,
				usesWebGPU: false,
			},
		});

		expect(lastLoad().options.n_gpu_layers).toBe(999);
	});

	it("stays on the CPU when the device has no adapter", async () => {
		const runner = await loadRunner({ webgpu: false });

		const [reply] = await runner.send("serve", { model: MODEL });

		expect(lastLoad().options.n_gpu_layers).toBe(0);
		expect(reply.payload.capabilities.usesGPU).toBe(false);
	});

	it("falls back to the CPU when the GPU load fails", async () => {
		const runner = await loadRunner({ webgpu: true });
		lab.loadFailure = (call) =>
			call.options.n_gpu_layers === 999 ? new Error("device lost") : null;

		const [reply] = await runner.send("serve", { model: MODEL });

		expect(reply.type).toBe("complete");
		expect(lab.loadCalls.map((call) => call.options.n_gpu_layers)).toEqual([
			999, 0,
		]);
		expect(reply.payload.capabilities.usesGPU).toBe(false);
	});

	it("sizes the GPU context against VRAM, not system RAM", async () => {
		const runner = await loadRunner({ webgpu: true });

		await runner.send("serve", {
			model: MODEL,
			_memoryHint: {
				// 2 GB of VRAM affords far less KV cache than 16 GB of RAM would.
				availableGB: 16,
				webgpuAvailableGB: 2,
				sizeGB: 0.3,
				kvBytesPerToken: 1024 * 1024,
				contextLength: 128000,
				usesWebGPU: false,
			},
		});

		expect(lastLoad().options.n_ctx).toBe(1024);
	});
});

describe("context window ladder", () => {
	it("retries smaller only for allocation failures", async () => {
		const runner = await loadRunner({ webgpu: false });
		lab.loadFailure = (_call, attempt) =>
			attempt < 3 ? new Error("failed to allocate KV cache") : null;

		const [reply] = await runner.send("serve", { model: MODEL });

		expect(reply.type).toBe("complete");
		expect(lab.loadCalls.map((call) => call.options.n_ctx)).toEqual([
			65536, 16384, 4096,
		]);
	});

	it("gives up immediately on an error that is not about memory", async () => {
		const runner = await loadRunner({ webgpu: false });
		lab.loadFailure = () => new Error('No GGUF file found in repo "x/y"');

		const [reply] = await runner.send("serve", { model: MODEL });

		expect(reply.type).toBe("error");
		expect(lab.loadCalls).toHaveLength(1);
		expect(reply.payload.error.message).toMatch(/No GGUF file found/);
	});

	it("never asks for more context than the device budget allows", async () => {
		// This budget affords ~1536 tokens, which rounds down to 1024 — below the
		// ladder's floor. The floor must not inflate the request back up to 2048.
		const runner = await loadRunner({ webgpu: false });

		await runner.send("serve", {
			model: MODEL,
			_memoryHint: {
				availableGB: 3,
				webgpuAvailableGB: 3,
				sizeGB: 1,
				kvBytesPerToken: 1024 * 1024,
				contextLength: 32768,
				usesWebGPU: false,
			},
		});

		expect(lab.loadCalls.map((call) => call.options.n_ctx)).toEqual([1024]);
	});

	it("refuses a model that cannot fit at all rather than thrashing the ladder", async () => {
		const runner = await loadRunner({ webgpu: false });

		const [reply] = await runner.send("serve", {
			model: MODEL,
			_memoryHint: {
				availableGB: 1.4,
				webgpuAvailableGB: 1.4,
				sizeGB: 1,
				kvBytesPerToken: 1024 * 1024,
				contextLength: 32768,
				usesWebGPU: false,
			},
		});

		expect(reply.type).toBe("error");
		expect(reply.payload.error.message).toMatch(
			/does not fit available device/,
		);
		expect(lab.loadCalls).toEqual([]);
	});
});

describe("sizing a model the catalogue knows nothing about", () => {
	// A 32-layer, 8-KV-head, 128-dim GGUF header, as a real ranged read returns.
	function ggufHeader() {
		const parts: Uint8Array[] = [];
		const u32 = (v: number) => {
			const b = new Uint8Array(4);
			new DataView(b.buffer).setUint32(0, v, true);
			parts.push(b);
		};
		const u64 = (v: number) => {
			const b = new Uint8Array(8);
			new DataView(b.buffer).setBigUint64(0, BigInt(v), true);
			parts.push(b);
		};
		const str = (v: string) => {
			const b = new TextEncoder().encode(v);
			u64(b.length);
			parts.push(b);
		};
		const entries: [string, number][] = [
			["llama.block_count", 32],
			["llama.context_length", 8192],
			["llama.embedding_length", 4096],
			["llama.attention.head_count", 32],
			["llama.attention.head_count_kv", 8],
		];
		u32(0x46554747);
		u32(3);
		u64(0);
		u64(entries.length + 1);
		str("general.architecture");
		u32(8);
		str("llama");
		for (const [key, value] of entries) {
			str(key);
			u32(4);
			u32(value);
		}
		const total = parts.reduce((n, p) => n + p.length, 0);
		const out = new Uint8Array(total);
		let at = 0;
		for (const p of parts) {
			out.set(p, at);
			at += p.length;
		}
		return out.buffer;
	}

	/** A device-budget-only hint, which is what an uncatalogued model now gets. */
	const DEVICE_ONLY_HINT = {
		availableGB: 8,
		webgpuAvailableGB: 8,
		usesWebGPU: false,
	};

	function stubHeaderFetch(header: ArrayBuffer, fileSizeBytes: number) {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init?: RequestInit) => {
				if (init?.headers && "Range" in (init.headers as object)) {
					return {
						ok: true,
						status: 206,
						headers: {
							get: () => `bytes 0-${header.byteLength - 1}/${fileSizeBytes}`,
						},
						arrayBuffer: async () => header,
					};
				}
				return { ok: true, json: async () => ({ siblings: [] }) };
			}),
		);
	}

	it("sizes from the model's own GGUF header when the catalogue has no figures", async () => {
		stubHeaderFetch(ggufHeader(), 700 * 1024 * 1024);
		const runner = await loadRunner({ webgpu: false });

		const [reply] = await runner.send("serve", {
			model: "someone/Custom-GGUF/custom-Q4_K_M.gguf",
			_memoryHint: DEVICE_ONLY_HINT,
		});

		expect(reply.type).toBe("complete");
		// 8192 is this header's trained context, and it is well under what 8 GB of
		// RAM affords, so the model's own limit is what bound the window.
		expect(lastLoad().options.n_ctx).toBe(8192);
	});

	it("still loads when the header cannot be read", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => ({ ok: false, status: 403 })),
		);
		const runner = await loadRunner({ webgpu: false });

		const [reply] = await runner.send("serve", {
			model: "someone/Private-GGUF/model.gguf",
			_memoryHint: DEVICE_ONLY_HINT,
		});

		// A failed probe must never be fatal: the ladder still finds a window.
		expect(reply.type).toBe("complete");
		expect(lastLoad().options.n_ctx).toBeGreaterThan(0);
	});
});

describe("model addressing", () => {
	it("keeps a quantization folder in the requested filename", async () => {
		const runner = await loadRunner({ webgpu: false });

		await runner.send("serve", {
			model:
				"unsloth/Qwen3-30B-GGUF/Q4_K_M/Qwen3-30B-Q4_K_M-00001-of-00002.gguf",
		});

		expect(lastLoad().loadArgs).toMatchObject({
			repo: "unsloth/Qwen3-30B-GGUF",
			file: "Q4_K_M/Qwen3-30B-Q4_K_M-00001-of-00002.gguf",
		});
	});

	it("lists a split model once, sized as all of its shards", async () => {
		const runner = await loadRunner({ webgpu: false });
		const base = "https://huggingface.co/acme/big-GGUF/resolve/main/big-Q4_K_M";
		lab.cacheEntries = [
			{
				name: "a.gguf",
				size: 10,
				metadata: {
					originalURL: `${base}-00001-of-00002.gguf`,
					originalSize: 10,
				},
			},
			{
				name: "b.gguf",
				size: 20,
				metadata: {
					originalURL: `${base}-00002-of-00002.gguf`,
					originalSize: 20,
				},
			},
		];

		const [reply] = await runner.send("models");

		expect(reply.payload.data).toHaveLength(1);
		expect(reply.payload.data[0]).toMatchObject({
			id: "acme/big-GGUF/big-Q4_K_M-00001-of-00002.gguf",
			size: 30,
		});
	});

	it("never lists a projector as a model of its own", async () => {
		const runner = await loadRunner({ webgpu: false });
		const model =
			"https://huggingface.co/acme/vl-GGUF/resolve/main/vl-Q4_0.gguf";
		const projector =
			"https://huggingface.co/acme/vl-GGUF/resolve/main/mmproj-vl-Q8_0.gguf";
		lab.cacheEntries = [
			{
				name: "vl.gguf",
				size: 400,
				metadata: {
					originalURL: model,
					mmprojURL: projector,
					originalSize: 400,
				},
			},
			{
				name: "mmproj.gguf",
				size: 200,
				metadata: {
					originalURL: projector,
					mmprojURL: projector,
					originalSize: 200,
				},
			},
		];

		const [reply] = await runner.send("models");

		expect(reply.payload.data.map((entry: { id: string }) => entry.id)).toEqual(
			["acme/vl-GGUF/vl-Q4_0.gguf"],
		);
	});

	it("deletes every shard and the projector, not just the addressed file", async () => {
		const runner = await loadRunner({ webgpu: false });
		const base = "https://huggingface.co/acme/vl-GGUF/resolve/main/vl-Q4_0";
		const projector =
			"https://huggingface.co/acme/vl-GGUF/resolve/main/mmproj-vl-Q8_0.gguf";
		lab.cacheEntries = [
			{
				name: "a",
				size: 1,
				metadata: {
					originalURL: `${base}-00001-of-00002.gguf`,
					mmprojURL: projector,
					originalSize: 1,
				},
			},
			{
				name: "b",
				size: 1,
				metadata: {
					originalURL: `${base}-00002-of-00002.gguf`,
					originalSize: 1,
				},
			},
			{
				name: "p",
				size: 1,
				metadata: { originalURL: projector, originalSize: 1 },
			},
		];

		await runner.send("delete", {
			model: "acme/vl-GGUF/vl-Q4_0-00001-of-00002.gguf",
		});

		const [predicate] = lab.deletedPredicates;
		expect(predicate).toBeTypeOf("function");
		const kept = lab.cacheEntries.filter((entry) => !predicate(entry));
		expect(kept).toEqual([]);
	});
});

describe("tool calling", () => {
	const TOOLS = [
		{
			type: "function",
			function: {
				name: "get_weather",
				description: "Current weather",
				parameters: {
					type: "object",
					properties: { city: { type: "string" } },
					required: ["city"],
				},
			},
		},
	];

	it("reports native tool support for an OpenAI-style template", async () => {
		const runner = await loadRunner({ webgpu: false });
		lab.chatTemplate = "{% for tc in message.tool_calls %}{{ tc }}{% endfor %}";

		const [reply] = await runner.send("serve", { model: MODEL });

		expect(reply.payload.capabilities.supportsNativeTools).toBe(true);
		expect(reply.payload.supportsNativeTools).toBe(true);
	});

	it("reports native tool support for a Hermes-style template", async () => {
		const runner = await loadRunner({ webgpu: false });
		lab.chatTemplate = "<tool_call>{{ name }}</tool_call>";

		const [reply] = await runner.send("serve", { model: MODEL });

		expect(reply.payload.capabilities.supportsNativeTools).toBe(true);
	});

	it("reports native tool support for a template that only renders tools into the system prompt", async () => {
		// LFM2 and Phi-4-mini never mention `tool_calls`; they inject the tool list
		// and llama.cpp parses the model's calls back with a format-specific
		// parser. A live LFM2.5-350M run does emit native tool_calls, so requiring
		// the output form downgraded a genuinely capable model to prompt injection.
		const runner = await loadRunner({ webgpu: false });
		lab.chatTemplate =
			'{%- if tools -%}{{ "List of tools: [" }}{%- for tool in tools -%}{{ tool | tojson }}{%- endfor -%}{%- endif -%}';

		const [reply] = await runner.send("serve", { model: MODEL });

		expect(reply.payload.capabilities.supportsNativeTools).toBe(true);
	});

	it("does not mistake unrelated prose for tool support", async () => {
		const runner = await loadRunner({ webgpu: false });
		lab.chatTemplate = "You are a helpful assistant with many toolsets.";

		const [reply] = await runner.send("serve", { model: MODEL });

		expect(reply.payload.capabilities.supportsNativeTools).toBe(false);
	});

	it("reports no native tool support for a plain chat template", async () => {
		const runner = await loadRunner({ webgpu: false });
		lab.chatTemplate = "{% for m in messages %}{{ m.content }}{% endfor %}";

		const [reply] = await runner.send("serve", { model: MODEL });

		expect(reply.payload.capabilities.supportsNativeTools).toBe(false);
	});

	it("forwards tools and tool_choice to llama.cpp", async () => {
		const runner = await loadRunner({ webgpu: false });
		await runner.send("serve", { model: MODEL });

		await runner.send("chat/completions", {
			model: MODEL,
			messages: [{ role: "user", content: "weather in Hanoi?" }],
			tools: TOOLS,
			tool_choice: "auto",
		});

		const [call] = lab.completionCalls;
		expect(call.tools).toEqual(TOOLS);
		expect(call.tool_choice).toBe("auto");
	});

	it("sends no tools key at all when the caller passes none", async () => {
		const runner = await loadRunner({ webgpu: false });
		await runner.send("serve", { model: MODEL });

		await runner.send("chat/completions", {
			model: MODEL,
			messages: [{ role: "user", content: "hi" }],
		});

		expect(lab.completionCalls[0]).not.toHaveProperty("tools");
	});

	it("returns a tool_calls response to the caller intact", async () => {
		const runner = await loadRunner({ webgpu: false });
		await runner.send("serve", { model: MODEL });
		const toolCall = {
			id: "call_1",
			type: "function",
			function: { name: "get_weather", arguments: '{"city":"Hanoi"}' },
		};
		lab.completionResult = {
			id: "chatcmpl-2",
			object: "chat.completion",
			choices: [
				{
					index: 0,
					message: { role: "assistant", content: null, tool_calls: [toolCall] },
					finish_reason: "tool_calls",
				},
			],
		};

		const replies = await runner.send("chat/completions", {
			model: MODEL,
			messages: [{ role: "user", content: "weather?" }],
			tools: TOOLS,
		});

		const complete = replies.find((reply) => reply.type === "complete");
		expect(complete?.payload.choices[0].message.tool_calls).toEqual([toolCall]);
		expect(complete?.payload.choices[0].finish_reason).toBe("tool_calls");
	});

	it("streams tool-call deltas as they arrive and holds back only the terminal chunk", async () => {
		const runner = await loadRunner({ webgpu: false });
		await runner.send("serve", { model: MODEL });
		const delta = (toolCalls: unknown) => ({
			id: "chatcmpl-3",
			object: "chat.completion.chunk",
			choices: [
				{ index: 0, delta: { tool_calls: toolCalls }, finish_reason: null },
			],
		});
		lab.streamChunks = [
			delta([
				{
					index: 0,
					id: "call_1",
					function: { name: "get_weather", arguments: "" },
				},
			]),
			delta([{ index: 0, function: { arguments: '{"city":' } }]),
			delta([{ index: 0, function: { arguments: '"Hanoi"}' } }]),
			{
				id: "chatcmpl-3",
				object: "chat.completion.chunk",
				choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
			},
		];

		const replies = await runner.send("chat/completions", {
			model: MODEL,
			messages: [{ role: "user", content: "weather?" }],
			tools: TOOLS,
			stream: true,
		});

		const streamed = replies.filter((reply) => reply.type === "stream_chunk");
		const end = replies.find((reply) => reply.type === "stream_end");
		expect(streamed).toHaveLength(3);
		// Reassembled the way the agent harness does it.
		const args = streamed
			.map(
				(reply) =>
					reply.payload.choices[0].delta.tool_calls[0].function.arguments ?? "",
			)
			.join("");
		expect(args).toBe('{"city":"Hanoi"}');
		expect(end?.payload.choices[0].finish_reason).toBe("tool_calls");
	});

	it("passes a tool-result round trip back to the model unchanged", async () => {
		const runner = await loadRunner({ webgpu: false });
		await runner.send("serve", { model: MODEL });
		const messages = [
			{ role: "user", content: "weather in Hanoi?" },
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call_1",
						type: "function",
						function: { name: "get_weather", arguments: '{"city":"Hanoi"}' },
					},
				],
			},
			{ role: "tool", tool_call_id: "call_1", content: '{"tempC":31}' },
		];

		await runner.send("chat/completions", {
			model: MODEL,
			messages,
			tools: TOOLS,
		});

		expect(lab.completionCalls[0].messages).toEqual(messages);
	});
});

describe("multimodal", () => {
	const imageMessages = [
		{
			role: "user",
			content: [
				{
					type: "image_url",
					image_url: {
						url: `data:image/png;base64,${PNG_BASE64}`,
						detail: "auto",
					},
				},
				{ type: "text", text: "What is in this image?" },
			],
		},
	];

	it("decodes an OpenAI image part into the bytes wllama expects", async () => {
		const runner = await loadRunner({ webgpu: false });
		lab.modalities = new Set(["image"]);
		await runner.send("serve", { model: MODEL });

		await runner.send("chat/completions", {
			model: MODEL,
			messages: imageMessages,
		});

		const sent = lab.completionCalls[0].messages[0] as {
			content: { type: string; data?: ArrayBuffer; text?: string }[];
		};
		expect(sent.content[0].type).toBe("image");
		expect([...new Uint8Array(sent.content[0].data as ArrayBuffer)]).toEqual(
			PNG_BYTES,
		);
		expect(sent.content[1]).toEqual({
			type: "text",
			text: "What is in this image?",
		});
	});

	it("refuses an image on a model with no projector instead of answering blind", async () => {
		const runner = await loadRunner({ webgpu: false });
		lab.modalities = new Set();
		await runner.send("serve", { model: MODEL });

		const replies = await runner.send("chat/completions", {
			model: MODEL,
			messages: imageMessages,
		});

		const error = replies.find((reply) => reply.type === "error");
		expect(error?.payload.error.message).toMatch(/does not accept image input/);
		expect(lab.completionCalls).toHaveLength(0);
	});

	it("reports the modalities the loaded model actually has", async () => {
		const runner = await loadRunner({ webgpu: false });
		lab.modalities = new Set(["image", "audio"]);

		const [reply] = await runner.send("serve", { model: MODEL });

		expect(reply.payload.capabilities).toMatchObject({
			supportsVision: true,
			supportsAudio: true,
		});
		expect(reply.payload.supportsVision).toBe(true);
		expect(reply.payload.supportsAudio).toBe(true);
	});

	it("keeps a multimodal model on the CPU even where WebGPU is available", async () => {
		const runner = await loadRunner({ webgpu: true });
		lab.modalities = new Set(["image"]);

		await runner.send("serve", {
			model: "LiquidAI/LFM2-VL-450M-GGUF/LFM2-VL-450M-Q4_0.gguf",
			_mmprojFile: "mmproj-LFM2-VL-450M-Q8_0.gguf",
		});

		expect(lastLoad().loadArgs.mmprojFile).toBe(
			"mmproj-LFM2-VL-450M-Q8_0.gguf",
		);
		expect(lastLoad().options.n_gpu_layers).toBe(0);
	});

	it("leaves a text-only conversation structurally untouched", async () => {
		const runner = await loadRunner({ webgpu: false });
		await runner.send("serve", { model: MODEL });
		const messages = [
			{ role: "system", content: "Be brief." },
			{ role: "user", content: "Hello" },
		];

		await runner.send("chat/completions", { model: MODEL, messages });

		expect(lab.completionCalls[0].messages).toEqual(messages);
	});
});
