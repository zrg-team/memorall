import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Drives the real media runner frame over its postMessage protocol. The worker
 * is a stand-in that serves a scripted engine through the real
 * `engine-port.js`, so the frame's routing, abort bookkeeping, cache scan and
 * worker hand-off are exercised without transformers.js.
 */

type RunnerMessageHandler = (event: MessageEvent) => void | Promise<void>;

interface RunnerReply {
	type: string;
	// biome-ignore lint/suspicious/noExplicitAny: assertions read arbitrary payloads
	payload: any;
	transfer: Transferable[];
}

interface EngineHandleCall {
	id: string;
	type: string;
	// biome-ignore lint/suspicious/noExplicitAny: scripted engine inspects payloads
	payload: any;
}

type Emit = (
	id: string | null,
	type: string,
	payload: unknown,
	transfer?: Transferable[],
) => void;

type Script = (call: EngineHandleCall, emit: Emit) => Promise<void>;

const RUNNER_PATH = "../../../../../public/runner/modes/media-runner.js";
const ENGINE_PORT_PATH =
	"../../../../../public/runner/modes/media/engine-port.js";

const lab = {
	scripts: {} as Record<string, Script>,
	handleCalls: [] as EngineHandleCall[],
	aborts: [] as string[],
	enginesCreated: 0,
	workerUrls: [] as string[],
	cacheUrls: [] as string[],
	deletedUrls: [] as string[],
	decodedAudio: [] as unknown[],
};

// vi.mock is hoisted above the const declarations, so paths are inline.
vi.mock("../../../../../public/runner/modes/media/engine.js", () => ({
	createMediaEngine: ({ emit }: { emit: Emit }) => {
		lab.enginesCreated += 1;
		return {
			async handle(id: string, type: string, payload: unknown) {
				const call = { id, type, payload };
				lab.handleCalls.push(call);
				const script = lab.scripts[type];
				if (!script) {
					emit(id, "error", {
						error: {
							message: `Unknown message type: ${type}`,
							type: "Error",
							code: null,
						},
					});
					return;
				}
				await script(call, emit);
			},
			abort(id: string) {
				lab.aborts.push(id);
			},
		};
	},
}));

vi.mock("../../../../../public/runner/modes/media/audio-decode.js", () => ({
	decodeAudioToMono16k: async (bytes: ArrayBuffer) => {
		lab.decodedAudio.push(bytes);
		return { pcm: new Float32Array(32000), sampleRate: 16000, duration: 2 };
	},
}));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const callOf = (type: string) => {
	const call = lab.handleCalls.find((entry) => entry.type === type);
	if (!call) throw new Error(`the engine never received ${type}`);
	return call;
};

/** A Worker that serves the mocked engine through the real engine port. */
async function installFakeWorker() {
	const { createMediaEngine } = await import(
		"../../../../../public/runner/modes/media/engine.js"
	);
	const { serveEngineOnPort } = await import(ENGINE_PORT_PATH);

	class FakeWorker {
		private frameListeners = new Set<(event: MessageEvent) => void>();
		private workerListeners = new Set<(event: MessageEvent) => void>();

		constructor(url: URL | string) {
			lab.workerUrls.push(String(url));
			const workerScope = {
				postMessage: (data: unknown) => {
					setTimeout(() => {
						for (const listener of this.frameListeners) {
							listener({ data } as MessageEvent);
						}
					}, 0);
				},
				addEventListener: (
					type: string,
					listener: (event: MessageEvent) => void,
				) => {
					if (type === "message") this.workerListeners.add(listener);
				},
			};
			// Module evaluation is asynchronous in a real worker.
			setTimeout(() => serveEngineOnPort(workerScope, createMediaEngine), 0);
		}

		addEventListener(type: string, listener: (event: MessageEvent) => void) {
			if (type === "message") this.frameListeners.add(listener);
		}

		postMessage(data: unknown) {
			setTimeout(() => {
				for (const listener of this.workerListeners) {
					listener({ data } as MessageEvent);
				}
			}, 0);
		}

		terminate() {}
	}

	vi.stubGlobal("Worker", FakeWorker);
}

function installFakeCaches() {
	vi.stubGlobal("caches", {
		has: async (name: string) => name === "transformers-cache",
		open: async () => ({
			keys: async () => lab.cacheUrls.map((url) => ({ url })),
			delete: async (request: { url: string }) => {
				lab.deletedUrls.push(request.url);
				lab.cacheUrls = lab.cacheUrls.filter((url) => url !== request.url);
				return true;
			},
		}),
	});
}

interface Runner {
	readyMessages: unknown[];
	dispatch: (data: unknown, source?: unknown) => Promise<void>;
	send: (
		type: string,
		payload?: unknown,
	) => {
		messageId: string;
		replies: RunnerReply[];
		done: Promise<RunnerReply>;
	};
}

async function loadRunner(): Promise<Runner> {
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

	const readyMessages: unknown[] = [];
	const previousOpener = window.opener;
	window.opener = {
		postMessage: (message: unknown) => readyMessages.push(message),
	};
	try {
		await import(RUNNER_PATH);
	} finally {
		window.opener = previousOpener;
	}
	if (!handleMessage) throw new Error("runner did not register a listener");
	const listener = handleMessage;

	let counter = 0;
	const dispatch = async (data: unknown, source?: unknown) => {
		await listener({
			data,
			origin: window.location.origin,
			source: source ?? { postMessage: () => undefined },
		} as unknown as MessageEvent);
	};

	return {
		readyMessages,
		dispatch,
		send(type, payload) {
			counter += 1;
			const messageId = `media-${counter}`;
			const replies: RunnerReply[] = [];
			let settle: (reply: RunnerReply) => void = () => undefined;
			const done = new Promise<RunnerReply>((resolve) => {
				settle = resolve;
			});
			const source = {
				postMessage: (
					message: { messageId: string; type: string; payload: unknown },
					_origin: string,
					transfer: Transferable[],
				) => {
					if (message.messageId !== messageId) return;
					const reply = {
						type: message.type,
						payload: message.payload,
						transfer: transfer ?? [],
					};
					replies.push(reply);
					if (["complete", "error", "stream_end"].includes(reply.type)) {
						settle(reply);
					}
				},
			};
			void dispatch({ messageId, type, payload }, source);
			return { messageId, replies, done };
		},
	};
}

const SPEECH = {
	id: "org/speech-model",
	task: "text-to-speech",
	voices: [
		{
			id: "voices/a.bin",
			path: "https://huggingface.co/org/speech-model/resolve/main/voices/a.bin",
		},
	],
};
const ASR = {
	id: "org/asr-model",
	task: "automatic-speech-recognition",
};
const DETECTOR = {
	id: "org/detector",
	task: "object-detection",
	device: "wasm",
};

beforeEach(async () => {
	lab.scripts = {};
	lab.handleCalls = [];
	lab.aborts = [];
	lab.enginesCreated = 0;
	lab.workerUrls = [];
	lab.cacheUrls = [];
	lab.deletedUrls = [];
	lab.decodedAudio = [];
	lab.scripts.serve = async ({ id, payload }, emit) =>
		emit(id, "complete", { id: payload.config.id, loaded: true });
	vi.spyOn(console, "log").mockImplementation(() => undefined);
	vi.spyOn(console, "warn").mockImplementation(() => undefined);
	vi.spyOn(console, "error").mockImplementation(() => undefined);
	installFakeCaches();
	await installFakeWorker();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("startup", () => {
	it("announces RUNNER_READY in media mode without starting inference", async () => {
		const runner = await loadRunner();

		expect(runner.readyMessages).toEqual([
			{
				messageId: "RUNNER_READY",
				type: "ready",
				payload: expect.objectContaining({ status: "ready", mode: "media" }),
			},
		]);
		expect(lab.workerUrls).toEqual([]);
	});

	it("completes init without starting the worker", async () => {
		const runner = await loadRunner();

		const reply = await runner.send("init").done;

		expect(reply).toMatchObject({
			type: "complete",
			payload: { status: "initialized", mode: "media" },
		});
		expect(lab.workerUrls).toEqual([]);
	});
});

describe("models", () => {
	it("reports every catalog entry from the cache alone", async () => {
		const runner = await loadRunner();
		lab.cacheUrls = [
			"https://huggingface.co/org/asr-model/resolve/main/onnx/encoder_model.onnx",
			// Only a prefix of another id: must not count as downloaded.
			"https://huggingface.co/org/speech/resolve/main/config.json",
		];

		const reply = await runner.send("models", {
			catalog: [
				SPEECH,
				ASR,
				{ id: "org/speech-model-2", task: "text-to-speech" },
			],
		}).done;

		expect(reply.type).toBe("complete");
		expect(reply.payload).toEqual({
			object: "list",
			data: [
				{ id: SPEECH.id, loaded: false, downloaded: false },
				{ id: ASR.id, loaded: false, downloaded: true },
				{ id: "org/speech-model-2", loaded: false, downloaded: false },
			],
		});
		expect(lab.workerUrls).toEqual([]);
		expect(lab.handleCalls).toEqual([]);
	});

	it("marks the model the engine holds as loaded", async () => {
		lab.scripts.serve = async ({ id, payload }, emit) => {
			emit(id, "progress", {
				status: "progress",
				file: "model.onnx",
				progress: 50,
				loaded: 5,
				total: 10,
			});
			emit(null, "state", {
				loaded: { id: payload.config.id, device: "webgpu", dtype: "fp32" },
			});
			emit(id, "complete", {
				id: payload.config.id,
				loaded: true,
				downloaded: true,
				device: "webgpu",
				dtype: "fp32",
			});
		};
		const runner = await loadRunner();

		const serve = runner.send("serve", {
			model: SPEECH.id,
			config: SPEECH,
		});
		const served = await serve.done;
		const models = await runner.send("models", {
			catalog: [SPEECH, ASR],
		}).done;

		expect(serve.replies.map((reply) => reply.type)).toEqual([
			"progress",
			"complete",
		]);
		expect(served.payload).toMatchObject({ loaded: true, device: "webgpu" });
		expect(models.payload.data).toEqual([
			{
				id: SPEECH.id,
				loaded: true,
				downloaded: true,
				device: "webgpu",
				dtype: "fp32",
			},
			{ id: ASR.id, loaded: false, downloaded: false },
		]);
		expect(lab.workerUrls).toHaveLength(1);
		expect(lab.workerUrls[0]).toMatch(/\/runner\/modes\/media\/worker\.js/);
	});
});

describe("audio/speech", () => {
	it("streams PCM chunks as transferred Float32Arrays and ends the stream", async () => {
		lab.scripts["audio/speech"] = async ({ id }, emit) => {
			for (const length of [4, 6]) {
				const pcm = new Float32Array(length);
				emit(id, "stream_chunk", { pcm, sampleRate: 44100 }, [pcm.buffer]);
			}
			emit(id, "stream_end", { sampleRate: 44100 });
		};
		const runner = await loadRunner();

		const request = runner.send("audio/speech", {
			model: SPEECH.id,
			config: SPEECH,
			input: "Hello. World.",
			voice: "F1",
		});
		const end = await request.done;

		const chunks = request.replies.filter(
			(reply) => reply.type === "stream_chunk",
		);
		expect(chunks).toHaveLength(2);
		for (const chunk of chunks) {
			expect(chunk.payload.pcm).toBeInstanceOf(Float32Array);
			expect(chunk.transfer).toEqual([chunk.payload.pcm.buffer]);
		}
		expect(end).toMatchObject({
			type: "stream_end",
			payload: { sampleRate: 44100 },
		});
		expect(lab.handleCalls.map((call) => call.type)).toEqual([
			"serve",
			"audio/speech",
		]);
		expect(callOf("audio/speech").payload).toMatchObject({
			input: "Hello. World.",
			voice: "F1",
		});
	});
});

describe("abort", () => {
	it("forwards the abort and sends nothing more for that request", async () => {
		let release: () => void = () => undefined;
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		lab.scripts["audio/speech"] = async ({ id }, emit) => {
			emit(id, "stream_chunk", { pcm: new Float32Array(2), sampleRate: 16000 });
			await released;
			emit(id, "stream_chunk", { pcm: new Float32Array(2), sampleRate: 16000 });
			emit(id, "error", {
				error: {
					message: "Operation aborted",
					type: "AbortError",
					code: "aborted",
				},
			});
		};
		const runner = await loadRunner();

		const request = runner.send("audio/speech", {
			config: SPEECH,
			input: "Long text.",
		});
		await vi.waitFor(() => expect(request.replies).toHaveLength(1));

		await runner.dispatch({ messageId: request.messageId, type: "abort" });
		await vi.waitFor(() => expect(lab.aborts).toEqual([request.messageId]));
		release();
		await vi.waitFor(() => expect(lab.handleCalls).toHaveLength(2));
		for (let i = 0; i < 5; i++) await tick();

		expect(request.replies.map((reply) => reply.type)).toEqual([
			"stream_chunk",
		]);

		// The runner keeps serving other requests afterwards.
		lab.scripts.unload = async ({ id }, emit) =>
			emit(id, "complete", { status: "unloaded" });
		const unload = await runner.send("unload", { model: SPEECH.id }).done;
		expect(unload).toMatchObject({
			type: "complete",
			payload: { status: "unloaded" },
		});
	});

	it("ignores an abort for a request that is not in flight", async () => {
		const runner = await loadRunner();

		await runner.dispatch({ messageId: "finished-long-ago", type: "abort" });

		expect(lab.workerUrls).toEqual([]);
	});
});

describe("audio/transcriptions", () => {
	it("decodes in the frame and hands 16 kHz PCM to the worker", async () => {
		lab.scripts["audio/transcriptions"] = async ({ id, payload }, emit) => {
			emit(id, "stream_chunk", { delta: "Hello" });
			emit(id, "complete", {
				text: "Hello",
				duration: payload.audio.length / payload.sampleRate,
				segments: [{ id: 0, start: 0, end: 2, text: "Hello" }],
			});
		};
		const runner = await loadRunner();
		const bytes = new Uint8Array([1, 2, 3]).buffer;

		const request = runner.send("audio/transcriptions", {
			model: ASR.id,
			config: ASR,
			audio: bytes,
			mimeType: "audio/wav",
			language: "en",
		});
		const reply = await request.done;

		expect(lab.decodedAudio).toEqual([bytes]);
		const forwarded = callOf("audio/transcriptions").payload;
		expect(forwarded.audio).toBeInstanceOf(Float32Array);
		expect(forwarded.sampleRate).toBe(16000);
		expect(forwarded.language).toBe("en");
		expect(request.replies.map((r) => r.type)).toEqual([
			"stream_chunk",
			"complete",
		]);
		expect(reply.payload).toMatchObject({ text: "Hello", duration: 2 });
	});
});

describe("images/tools", () => {
	it("returns detections and transfers encoded image buffers", async () => {
		lab.scripts["images/tools"] = async ({ id, payload }, emit) => {
			const bytes = new Uint8Array([137, 80, 78, 71]);
			emit(
				id,
				"complete",
				{
					detections: [
						{
							label: "cat",
							score: 0.9,
							box: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
						},
					],
					images: [{ bytes, mimeType: "image/png", role: "cutout" }],
					threshold: payload.options.threshold,
				},
				[bytes.buffer],
			);
		};
		const runner = await loadRunner();

		const reply = await runner.send("images/tools", {
			model: DETECTOR.id,
			config: DETECTOR,
			task: "object-detection",
			image: new Uint8Array([1]).buffer,
			mimeType: "image/png",
			options: { threshold: 0.7 },
		}).done;

		expect(reply.type).toBe("complete");
		expect(reply.payload.detections[0].label).toBe("cat");
		expect(reply.payload.threshold).toBe(0.7);
		expect(reply.transfer).toEqual([reply.payload.images[0].bytes.buffer]);
	});
});

describe("delete", () => {
	it("removes only that repo's cached files", async () => {
		const runner = await loadRunner();
		lab.cacheUrls = [
			"https://huggingface.co/org/detector/resolve/main/onnx/model.onnx",
			"https://huggingface.co/org/detector-large/resolve/main/onnx/model.onnx",
		];

		const reply = await runner.send("delete", {
			model: DETECTOR.id,
			config: DETECTOR,
		}).done;

		expect(reply).toMatchObject({
			type: "complete",
			payload: { status: "deleted" },
		});
		expect(lab.deletedUrls).toEqual([
			"https://huggingface.co/org/detector/resolve/main/onnx/model.onnx",
		]);
		// No engine was running, so none was started just to delete.
		expect(lab.workerUrls).toEqual([]);
	});

	it("releases the model in a running engine before deleting files", async () => {
		lab.scripts.serve = async ({ id }, emit) =>
			emit(id, "complete", { id: DETECTOR.id, loaded: true });
		lab.scripts.delete = async ({ id }, emit) =>
			emit(id, "complete", { status: "released" });
		const runner = await loadRunner();
		await runner.send("serve", { model: DETECTOR.id, config: DETECTOR }).done;

		const reply = await runner.send("delete", {
			model: DETECTOR.id,
			config: DETECTOR,
		}).done;

		expect(lab.handleCalls.map((call) => call.type)).toEqual([
			"serve",
			"delete",
		]);
		expect(reply.payload).toEqual({ status: "deleted" });
	});
});

describe("protocol hygiene", () => {
	it.each([
		"progress",
		"complete",
		"error",
		"stream_chunk",
		"stream_end",
		"ready",
	])("ignores an inbound %s reply", async (type) => {
		const runner = await loadRunner();
		const postMessage = vi.fn();

		await runner.dispatch(
			{ messageId: "echo", type, payload: {} },
			{ postMessage },
		);
		await tick();

		expect(postMessage).not.toHaveBeenCalled();
		expect(lab.workerUrls).toEqual([]);
	});

	it("turns an engine failure into an error reply", async () => {
		lab.scripts["audio/speech"] = async ({ id }, emit) =>
			emit(id, "error", {
				error: { message: "model failed to load", type: "Error", code: null },
			});
		const runner = await loadRunner();

		const reply = await runner.send("audio/speech", {
			model: SPEECH.id,
			config: SPEECH,
			input: "hello",
		}).done;

		expect(reply).toEqual({
			type: "error",
			payload: {
				error: { message: "model failed to load", type: "Error", code: null },
			},
			transfer: [],
		});
	});

	it("rejects an unknown request type", async () => {
		const runner = await loadRunner();

		const reply = await runner.send("video/generations", {}).done;

		expect(reply.type).toBe("error");
		expect(reply.payload.error.message).toMatch(
			/Unknown message type: video\/generations/,
		);
	});

	it("reports a frame-side validation failure as an error", async () => {
		const runner = await loadRunner();

		const reply = await runner.send("delete", {}).done;

		expect(reply.type).toBe("error");
		expect(reply.payload.error.message).toBe("model is required");
	});
});

describe("load fallbacks", () => {
	it("retries a failed load in a fresh worker with the next attempt", async () => {
		lab.scripts.serve = async ({ id, payload }, emit) => {
			if (payload.loadAttempt === 0) {
				emit(id, "error", {
					error: {
						message: "Can't create a session",
						type: "ModelLoadError",
						code: "MODEL_LOAD_FAILED",
						nextLoadAttempt: 1,
					},
				});
				return;
			}
			emit(id, "complete", { id: payload.config.id, loaded: true });
		};
		lab.scripts["images/tools"] = async ({ id }, emit) =>
			emit(id, "complete", { labels: [] });
		const runner = await loadRunner();

		const reply = await runner.send("images/tools", {
			model: DETECTOR.id,
			config: DETECTOR,
			task: "object-detection",
			image: new Uint8Array([1]).buffer,
			mimeType: "image/png",
		}).done;

		expect(reply).toMatchObject({ type: "complete", payload: { labels: [] } });
		expect(
			lab.handleCalls.map((call) => [call.type, call.payload.loadAttempt]),
		).toEqual([
			["serve", 0],
			["serve", 1],
			["images/tools", undefined],
		]);
		// ONNX Runtime cannot open a session after one failed: new worker.
		expect(lab.workerUrls).toHaveLength(2);
	});

	it("shares one load between requests for the same model, surviving a restart", async () => {
		lab.scripts.serve = async ({ id, payload }, emit) => {
			if (payload.loadAttempt === 0) {
				emit(id, "error", {
					error: {
						message: "Can't create a session",
						type: "ModelLoadError",
						code: "MODEL_LOAD_FAILED",
						nextLoadAttempt: 1,
					},
				});
				return;
			}
			emit(id, "complete", { id: payload.config.id, loaded: true });
		};
		const runner = await loadRunner();

		// Picking a model in the UI loads it twice at once: the selection and the
		// studio getting it ready.
		const first = runner.send("serve", { model: ASR.id, config: ASR });
		const second = runner.send("serve", { model: ASR.id, config: ASR });
		const [firstReply, secondReply] = await Promise.all([
			first.done,
			second.done,
		]);

		expect(firstReply.type).toBe("complete");
		expect(secondReply.type).toBe("complete");
		expect(
			lab.handleCalls.map((call) => [call.type, call.payload.loadAttempt]),
		).toEqual([
			["serve", 0],
			["serve", 1],
		]);
	});

	it("reports the load error once no attempt is left", async () => {
		lab.scripts.serve = async ({ id }, emit) =>
			emit(id, "error", {
				error: {
					message: "Can't create a session",
					type: "ModelLoadError",
					code: "MODEL_LOAD_FAILED",
					nextLoadAttempt: null,
				},
			});
		const runner = await loadRunner();

		const request = runner.send("serve", { model: ASR.id, config: ASR });
		const reply = await request.done;

		expect(reply.type).toBe("error");
		expect(reply.payload.error.message).toBe("Can't create a session");
		expect(lab.handleCalls.map((call) => call.type)).toEqual(["serve"]);
	});
});

describe("worker fallback", () => {
	it("runs the engine in the frame when a Worker cannot be created", async () => {
		vi.stubGlobal(
			"Worker",
			class {
				constructor() {
					throw new Error("Workers are disabled");
				}
			},
		);
		lab.scripts["audio/speech"] = async ({ id }, emit) => {
			emit(id, "stream_chunk", { pcm: new Float32Array(3), sampleRate: 16000 });
			emit(id, "stream_end", { sampleRate: 16000 });
		};
		const runner = await loadRunner();

		const request = runner.send("audio/speech", {
			config: SPEECH,
			input: "Hi.",
		});
		const end = await request.done;

		expect(end.type).toBe("stream_end");
		expect(request.replies[0].payload.pcm).toBeInstanceOf(Float32Array);
		expect(lab.enginesCreated).toBe(1);
	});
});
