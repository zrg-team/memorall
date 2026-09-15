import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheUrlMatchesRepo } from "../../../../../public/runner/modes/media/cache.js";
import { toErrorPayload } from "../../../../../public/runner/modes/media/cancellation.js";
import {
	adaptDtype,
	chooseDevice,
	dtypeLabel,
} from "../../../../../public/runner/modes/media/device.js";
import { createMediaEngine } from "../../../../../public/runner/modes/media/engine.js";
import { runImageTool } from "../../../../../public/runner/modes/media/image-tools.js";
import {
	loadAttempts,
	loadMediaBundle,
	pipelineTaskFor,
} from "../../../../../public/runner/modes/media/loaders.js";
import {
	relevanceScores,
	runTextTool,
} from "../../../../../public/runner/modes/media/text-tools.js";
import { createDownloadProgress } from "../../../../../public/runner/modes/media/progress.js";
import { splitSpeechText } from "../../../../../public/runner/modes/media/text-chunking.js";
import {
	buildAsrOptions,
	buildSegments,
	joinTranscriptParts,
} from "../../../../../public/runner/modes/media/transcript.js";
import {
	collectTransferables,
	detachableCopy,
} from "../../../../../public/runner/modes/media/transferables.js";
import {
	audioFrameRate,
	synthesize,
} from "../../../../../public/runner/modes/media/tts.js";

const cancellation = {
	cancelled: false,
	throwIfCancelled: () => undefined,
	onCancel: () => () => undefined,
};

describe("splitSpeechText", () => {
	it("splits on sentence punctuation and keeps the punctuation", () => {
		const text =
			"The quick brown fox jumps over the lazy dog today. Is this the second sentence of the text? Yes, and this is the third one here!";
		expect(splitSpeechText(text, { minChars: 0 })).toEqual([
			"The quick brown fox jumps over the lazy dog today.",
			"Is this the second sentence of the text?",
			"Yes, and this is the third one here!",
		]);
	});

	it("merges tiny fragments into a neighbour", () => {
		expect(
			splitSpeechText("Hi. How are you doing on this fine morning, friend?"),
		).toEqual(["Hi. How are you doing on this fine morning, friend?"]);
	});

	it("handles CJK and Latin-script punctuation alike", () => {
		expect(
			splitSpeechText("你好世界。今天天气很好！", { minChars: 0 }),
		).toEqual(["你好世界。", "今天天气很好！"]);
		expect(
			splitSpeechText(
				"Xin chào, hôm nay trời rất đẹp và tôi muốn đi dạo. Bạn có muốn đi cùng tôi không?",
				{ minChars: 0 },
			),
		).toEqual([
			"Xin chào, hôm nay trời rất đẹp và tôi muốn đi dạo.",
			"Bạn có muốn đi cùng tôi không?",
		]);
	});

	it("never exceeds the character budget, even without punctuation", () => {
		const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
		const pieces = splitSpeechText(long, { maxChars: 120 });
		expect(pieces.length).toBeGreaterThan(1);
		for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(120);
		expect(pieces.join(" ")).toBe(long);
	});

	it("breaks an over-long sentence at clause boundaries first", () => {
		const clause = "a".repeat(50);
		const sentence = `${clause}, ${clause}, ${clause}, ${clause}.`;
		expect(splitSpeechText(sentence, { maxChars: 110 })).toEqual([
			`${clause}, ${clause},`,
			`${clause}, ${clause}.`,
		]);
	});

	it("returns nothing for blank input", () => {
		expect(splitSpeechText("   \n ")).toEqual([]);
	});
});

describe("buildSegments", () => {
	it("maps pipeline chunks to OpenAI segments", () => {
		expect(
			buildSegments(
				[
					{ timestamp: [0, 2.5], text: " Hello there." },
					{ timestamp: [2.5, 5.123], text: " General Kenobi." },
				],
				6,
			),
		).toEqual([
			{ id: 0, start: 0, end: 2.5, text: "Hello there." },
			{ id: 1, start: 2.5, end: 5.12, text: "General Kenobi." },
		]);
	});

	it("ends an open final chunk at the audio duration", () => {
		expect(
			buildSegments([{ timestamp: [28, null], text: "tail" }], 31.4),
		).toEqual([{ id: 0, start: 28, end: 31.4, text: "tail" }]);
	});

	it("skips empty chunks without leaving id gaps", () => {
		expect(
			buildSegments(
				[
					{ timestamp: [0, 1], text: "  " },
					{ timestamp: [1, 2], text: "one" },
				],
				2,
			),
		).toEqual([{ id: 0, start: 1, end: 2, text: "one" }]);
	});

	it("tolerates missing chunks", () => {
		expect(buildSegments(undefined, 3)).toEqual([]);
	});
});

describe("ASR options", () => {
	it("maps OpenAI transcription options onto pipeline options", () => {
		expect(buildAsrOptions({ language: "VI", task: "translate" })).toEqual({
			return_timestamps: true,
			chunk_length_s: 30,
			stride_length_s: 5,
			language: "vi",
			task: "translate",
		});
	});

	it("omits an auto language and unknown tasks", () => {
		const options = buildAsrOptions({ language: "auto", task: "summarize" });
		expect(options).not.toHaveProperty("language");
		expect(options).not.toHaveProperty("task");
		expect(joinTranscriptParts([" a ", "", "b"])).toBe("a b");
	});
});

describe("text to speech", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("passes a voice's speaker embedding and retries without optional settings", async () => {
		const calls: Record<string, unknown>[] = [];
		const pipe = async (_text: string, options: Record<string, unknown>) => {
			calls.push(options);
			if (options.speed) throw new Error("unknown option speed");
			return { audio: new Float32Array(4), sampling_rate: 22050 };
		};
		const embedding = new Float32Array([1, 2]);
		vi.stubGlobal("caches", undefined);
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => new Response(embedding.buffer)),
		);
		const chunks: unknown[] = [];

		const result = await synthesize({
			bundle: { task: "text-to-speech", device: "wasm", pipe },
			config: {
				voices: [{ id: "voices/a.bin", path: "https://hub.test/voices/a.bin" }],
			},
			payload: { input: "Hello there.", voice: "voices/a.bin", speed: 1.5 },
			cancellation,
			sendChunk: (chunk: unknown) => chunks.push(chunk),
		});

		expect(calls[0]).toMatchObject({ speed: 1.5 });
		expect(calls[0]?.speaker_embeddings).toEqual(embedding);
		expect(calls[1]).not.toHaveProperty("speed");
		expect(result.sampleRate).toBe(22050);
		expect(chunks).toHaveLength(1);
	});

	it("sends no speaker embedding for a model without voices", async () => {
		const calls: unknown[] = [];
		await synthesize({
			bundle: {
				task: "text-to-audio",
				device: "wasm",
				pipe: async (_text: string, options: unknown) => {
					calls.push(options);
					return { audio: new Float32Array(2), sampling_rate: 32000 };
				},
			},
			config: {},
			payload: { input: "calm piano. soft rain." },
			cancellation,
			sendChunk: () => undefined,
		});
		// Non-speech audio is one piece, not sentence chunks.
		expect(calls).toEqual([{}]);
	});

	it("generates audio token by token when the pipeline cannot run the model", async () => {
		const generate = vi.fn(async () => ({
			dims: [1, 1, 3],
			data: new Float32Array([0.1, 0.2, 0.3]),
		}));
		const pipe = Object.assign(
			async () => {
				throw new Error("Missing the following inputs: input_ids.");
			},
			{
				tokenizer: () => ({ input_ids: "ids", attention_mask: "mask" }),
				model: {
					generate,
					config: { audio_encoder: { frame_rate: 50, sampling_rate: 32000 } },
				},
			},
		);
		const bundle: Record<string, unknown> = {
			task: "text-to-audio",
			device: "wasm",
			pipe,
		};
		const chunks: { pcm: Float32Array }[] = [];

		const result = await synthesize({
			bundle,
			config: {},
			payload: { input: "calm piano", duration: 4 },
			cancellation,
			sendChunk: (chunk: { pcm: Float32Array }) => chunks.push(chunk),
		});

		expect(generate).toHaveBeenCalledWith({
			input_ids: "ids",
			attention_mask: "mask",
			max_new_tokens: 200,
		});
		expect(Array.from(chunks[0]!.pcm)).toEqual([
			expect.closeTo(0.1),
			expect.closeTo(0.2),
			expect.closeTo(0.3),
		]);
		expect(result.sampleRate).toBe(32000);
		expect(bundle.generatesAudio).toBe(true);
	});

	it("reads tokens per second from a codec config", () => {
		expect(audioFrameRate({ codec: { frame_rate: 75 } })).toBe(75);
		expect(
			audioFrameRate({
				audio_encoder: {
					sampling_rate: 32000,
					upsampling_ratios: [8, 5, 4, 4],
				},
			}),
		).toBe(50);
		expect(audioFrameRate({ sampling_rate: 24000, hop_length: 300 })).toBe(80);
		expect(audioFrameRate({ sampling_rate: 16000 })).toBeUndefined();
	});

	it("keeps the pipeline's error for a model that cannot generate either", async () => {
		await expect(
			synthesize({
				bundle: {
					task: "text-to-audio",
					device: "wasm",
					pipe: async () => {
						throw new Error("pipeline failed");
					},
				},
				config: {},
				payload: { input: "rain" },
				cancellation,
				sendChunk: () => undefined,
			}),
		).rejects.toThrow("pipeline failed");
	});
});

describe("image tools", () => {
	const transformers = {
		RawImage: { fromBlob: async () => ({ width: 2, height: 2 }) },
	};
	const image = new Uint8Array([1]);

	it("shapes output by task, not by model", async () => {
		const detection = await runImageTool({
			transformers,
			bundle: {
				id: "org/any-detector",
				task: "object-detection",
				device: "wasm",
				pipe: async () => [
					{
						label: "cat",
						score: 0.9,
						box: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 },
					},
				],
			},
			payload: { task: "object-detection", image, options: { threshold: 0.3 } },
			cancellation,
		});
		expect(detection.detections).toEqual([
			{ label: "cat", score: 0.9, box: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 } },
		]);

		const classification = await runImageTool({
			transformers,
			bundle: {
				id: "org/any-classifier",
				task: "image-classification",
				device: "wasm",
				pipe: async () => [{ label: "dog", score: 0.8 }],
			},
			payload: { task: "image-classification", image },
			cancellation,
		});
		expect(classification.labels).toEqual([{ label: "dog", score: 0.8 }]);

		const caption = await runImageTool({
			transformers,
			bundle: {
				id: "org/any-captioner",
				task: "image-to-text",
				device: "wasm",
				pipe: async () => [{ generated_text: " a dog on grass " }],
			},
			payload: { task: "image-to-text", image },
			cancellation,
		});
		expect(caption.text).toBe("a dog on grass");
	});

	it("refuses a task the model was not loaded for", async () => {
		await expect(
			runImageTool({
				transformers,
				bundle: {
					id: "org/depth",
					task: "depth-estimation",
					device: "wasm",
					pipe: async () => ({}),
				},
				payload: { task: "object-detection", image },
				cancellation,
			}),
		).rejects.toThrow("depth-estimation");
	});
});

describe("device and dtype", () => {
	it("resolves auto by adapter availability", () => {
		expect(chooseDevice("auto", true)).toBe("webgpu");
		expect(chooseDevice(undefined, false)).toBe("wasm");
		expect(chooseDevice("wasm", true)).toBe("wasm");
	});

	it("refuses a WebGPU-only config without an adapter", () => {
		expect(() => chooseDevice("webgpu", false)).toThrow(/WebGPU/);
	});

	it("downgrades half precision the target cannot run", () => {
		expect(
			adaptDtype(
				{ encoder_model: "fp16", decoder_model_merged: "q4f16" },
				"webgpu",
				false,
			),
		).toEqual({ encoder_model: "fp32", decoder_model_merged: "q4" });
		expect(adaptDtype("q4f16", "wasm", true)).toBe("q4");
		expect(adaptDtype("fp16", "webgpu", true)).toBe("fp16");
		expect(adaptDtype(undefined, "wasm", false)).toBeUndefined();
		expect(dtypeLabel({ a: "q4", b: "fp32" })).toBe("a:q4,b:fp32");
	});
});

describe("download progress", () => {
	it("throttles to whole-percent steps per file", () => {
		const notify = vi.fn();
		const onProgress = createDownloadProgress(notify);
		for (const progress of [0, 0.2, 0.9, 1, 1.5, 2.4, 50, 50.5]) {
			onProgress({
				status: "progress",
				file: "model.onnx",
				progress,
				loaded: progress,
				total: 100,
			});
		}
		onProgress({
			status: "progress",
			file: "tokenizer.json",
			progress: 0.5,
			loaded: 1,
			total: 2,
		});
		onProgress({ status: "done", file: "model.onnx" });
		onProgress({ status: "initiate", file: "model.onnx" });

		expect(
			notify.mock.calls.map(([info]) => [info.file, info.progress]),
		).toEqual([
			["model.onnx", 0],
			["model.onnx", 1],
			["model.onnx", 2.4],
			["model.onnx", 50],
			["tokenizer.json", 0.5],
			["model.onnx", 100],
		]);
	});
});

describe("small helpers", () => {
	it("matches cache URLs by exact repo path", () => {
		const url =
			"https://huggingface.co/Org/Model-Small/resolve/main/onnx/model.onnx";
		expect(cacheUrlMatchesRepo(url, "org/model-small")).toBe(true);
		expect(cacheUrlMatchesRepo(url, "Org/Model")).toBe(false);
		expect(
			cacheUrlMatchesRepo(
				"https://huggingface.co/org/base/resolve/main/config.json",
				"org/base.en",
			),
		).toBe(false);
	});

	it("lists each transferable buffer once and copies partial views", () => {
		const bytes = new Uint8Array(4);
		const payload = {
			images: [{ bytes }, { bytes }],
			pcm: new Float32Array(2),
		};
		expect(collectTransferables(payload)).toEqual([
			bytes.buffer,
			payload.pcm.buffer,
		]);

		const backing = new Float32Array(8);
		const view = backing.subarray(2, 4);
		const copy = detachableCopy(view);
		expect(copy).not.toBe(view);
		expect(copy.buffer.byteLength).toBe(8);
		expect(collectTransferables({ pcm: view })).toEqual([]);
	});

	it("reports ONNX pointer errors as out-of-memory", () => {
		expect(toErrorPayload(123456).error.code).toBe("MEDIA_OOM");
		expect(toErrorPayload(new Error("bad input")).error).toEqual({
			message: "bad input",
			type: "Error",
			code: null,
		});
	});
});

describe("media engine", () => {
	type Emitted = { id: string | null; type: string; payload: any };

	const ttsConfig = (device: string) => ({
		id: "org/speech-model",
		task: "text-to-speech",
		device,
	});

	function setup({
		runFails = () => false,
	}: {
		runFails?: (device: string) => boolean;
	} = {}) {
		const emitted: Emitted[] = [];
		const loads: { id: string; forceDevice?: string }[] = [];
		const disposed: string[] = [];
		const engine = createMediaEngine({
			idleTimeoutMs: 0,
			emit: (id, type, payload) => emitted.push({ id, type, payload }),
			loadTransformers: async () => ({}),
			loadBundle: (async ({ config, forceDevice, notifyProgress }: any) => {
				loads.push({ id: config.id, forceDevice });
				notifyProgress?.({
					status: "progress",
					file: "model.onnx",
					progress: 100,
				});
				const device =
					forceDevice ?? (config.device === "wasm" ? "wasm" : "webgpu");
				const pipe = async (text: string) => {
					if (runFails(device)) throw new Error("webgpu session failed");
					return { audio: new Float32Array(text.length), sampling_rate: 16000 };
				};
				return { id: config.id, task: config.task, device, dtype: "q8", pipe };
			}) as any,
			disposeBundle: (async (bundle: any) => {
				disposed.push(bundle.id);
			}) as any,
		});
		return { engine, emitted, loads, disposed };
	}

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("serves a model and mirrors its state", async () => {
		const { engine, emitted } = setup();
		await engine.handle("a", "serve", {
			model: "org/speech-model",
			config: ttsConfig("wasm"),
		});

		expect(emitted.find((e) => e.type === "progress")?.id).toBe("a");
		expect(emitted.find((e) => e.type === "state")?.payload.loaded).toEqual({
			id: "org/speech-model",
			device: "wasm",
			dtype: "q8",
		});
		expect(emitted.at(-1)).toEqual({
			id: "a",
			type: "complete",
			payload: {
				id: "org/speech-model",
				loaded: true,
				downloaded: true,
				device: "wasm",
				dtype: "q8",
			},
		});
	});

	it("streams speech sentence by sentence", async () => {
		const { engine, emitted } = setup();
		await engine.handle("s", "audio/speech", {
			model: "org/speech-model",
			config: ttsConfig("wasm"),
			input:
				"This is the first sentence of the speech. And here is the second, longer sentence of it.",
		});
		const chunks = emitted.filter((e) => e.type === "stream_chunk");
		expect(chunks).toHaveLength(2);
		expect(chunks[0]?.payload.pcm).toBeInstanceOf(Float32Array);
		expect(emitted.at(-1)).toEqual({
			id: "s",
			type: "stream_end",
			payload: { sampleRate: 16000 },
		});
	});

	it("retries once on WASM when a WebGPU run fails before any output", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const { engine, emitted, loads, disposed } = setup({
			runFails: (device) => device === "webgpu",
		});
		await engine.handle("r", "audio/speech", {
			config: ttsConfig("auto"),
			input: "Hello world, this is a WebGPU fallback test.",
		});
		expect(loads.map((l) => l.forceDevice)).toEqual([undefined, "wasm"]);
		expect(disposed).toEqual(["org/speech-model"]);
		expect(emitted.at(-1)?.type).toBe("stream_end");
	});

	it("runs requests in order and reports a cancelled one as aborted", async () => {
		const { engine, emitted } = setup();
		const first = engine.handle("1", "serve", { config: ttsConfig("wasm") });
		const second = engine.handle("2", "audio/speech", {
			config: ttsConfig("wasm"),
			input: "Never synthesized because the host aborted it.",
		});
		engine.abort("2");
		await Promise.all([first, second]);

		expect(emitted.some((e) => e.id === "2" && e.type === "stream_chunk")).toBe(
			false,
		);
		expect(emitted.filter((e) => e.id === "2")).toEqual([
			{
				id: "2",
				type: "error",
				payload: { error: expect.objectContaining({ code: "aborted" }) },
			},
		]);
	});

	it("turns unknown types and bad input into error replies", async () => {
		vi.spyOn(console, "error").mockImplementation(() => undefined);
		const { engine, emitted } = setup();
		await engine.handle("x", "images/generations", {});
		await engine.handle("y", "audio/speech", {
			config: ttsConfig("wasm"),
			input: " ",
		});
		expect(emitted.filter((e) => e.type === "error").map((e) => e.id)).toEqual([
			"x",
			"y",
		]);
	});
});

describe("loadMediaBundle", () => {
	it("falls back to full precision, then WASM, for any model", () => {
		expect(loadAttempts("webgpu", undefined)).toEqual([
			{ device: "webgpu", dtype: undefined },
			{ device: "webgpu", dtype: undefined, optimization: "basic" },
			{ device: "webgpu", dtype: "fp32", optimization: "basic" },
			{ device: "wasm", dtype: undefined },
			{ device: "wasm", dtype: undefined, optimization: "basic" },
			{ device: "wasm", dtype: "fp32", optimization: "basic" },
		]);
		expect(loadAttempts("wasm", "fp32")).toEqual([
			{ device: "wasm", dtype: "fp32" },
			{ device: "wasm", dtype: "fp32", optimization: "basic" },
		]);
	});

	it("makes one attempt per call and names the next fallback on failure", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const pipe = { dispose: vi.fn() };
		const pipeline = vi
			.fn()
			.mockRejectedValueOnce(new Error("Can't create a session"))
			.mockResolvedValueOnce(pipe);
		const options = {
			transformers: { pipeline },
			config: { id: "org/asr-model", task: "automatic-speech-recognition" },
			forceDevice: "wasm" as const,
		};

		const failure = await loadMediaBundle(options).catch((error) => error);
		expect(failure).toMatchObject({
			code: "MODEL_LOAD_FAILED",
			nextLoadAttempt: 1,
			message: "Can't create a session",
		});
		expect(toErrorPayload(failure).error).toMatchObject({
			code: "MODEL_LOAD_FAILED",
			nextLoadAttempt: 1,
		});

		const bundle = await loadMediaBundle({ ...options, loadAttempt: 1 });
		expect(pipeline).toHaveBeenCalledTimes(2);
		expect(pipeline.mock.calls[0]?.[2]).not.toHaveProperty("session_options");
		expect(pipeline.mock.calls[1]?.[2]).toMatchObject({
			session_options: { graphOptimizationLevel: "basic" },
		});
		expect(bundle).toMatchObject({ device: "wasm", pipe });
	});
});

describe("text tools", () => {
	const bundleFor = (task: string, pipe: unknown) => ({
		id: "org/text-model",
		task,
		device: "wasm",
		pipe,
	});

	it("scores rerankers with one logit or a relevant class", () => {
		const one = relevanceScores({ dims: [2, 1], data: [0, 2] });
		expect(one[0]).toBeCloseTo(0.5);
		expect(one[1]).toBeCloseTo(1 / (1 + Math.exp(-2)));
		const two = relevanceScores({ dims: [1, 2], data: [0, Math.log(3)] });
		expect(two[0]).toBeCloseTo(0.75);
	});

	it("loads rankers through the text-classification pipeline", () => {
		expect(pipelineTaskFor("text-ranking")).toBe("text-classification");
		expect(pipelineTaskFor("zero-shot-classification")).toBe(
			"zero-shot-classification",
		);
	});

	it("returns every label of a classifier, best first", async () => {
		const pipe = Object.assign(
			vi.fn(async () => [
				{ label: "negative", score: 0.1 },
				{ label: "positive", score: 0.9 },
			]),
			{ model: { config: { id2label: { 0: "negative", 1: "positive" } } } },
		);
		const result = await runTextTool({
			bundle: bundleFor("text-classification", pipe),
			payload: { task: "text-classification", input: "Great product" },
			cancellation,
		});
		expect(pipe).toHaveBeenCalledWith("Great product", { top_k: 2 });
		expect(
			(result.labels as { label: string }[] | undefined)?.map(
				(label) => label.label,
			),
		).toEqual(["positive", "negative"]);
	});

	it("asks a zero-shot model to choose among the given labels", async () => {
		const pipe = vi.fn(async () => ({
			labels: ["billing", "bug"],
			scores: [0.8, 0.2],
		}));
		const result = await runTextTool({
			bundle: bundleFor("zero-shot-classification", pipe),
			payload: {
				task: "zero-shot-classification",
				input: "I was charged twice",
				options: { labels: [" billing ", "", "bug"], multiLabel: true },
			},
			cancellation,
		});
		expect(pipe).toHaveBeenCalledWith(
			"I was charged twice",
			["billing", "bug"],
			{
				multi_label: true,
			},
		);
		expect(result.labels).toEqual([
			{ label: "billing", score: 0.8 },
			{ label: "bug", score: 0.2 },
		]);
		await expect(
			runTextTool({
				bundle: bundleFor("zero-shot-classification", pipe),
				payload: { task: "zero-shot-classification", input: "x", options: {} },
				cancellation,
			}),
		).rejects.toThrow(/label/);
	});

	it("ranks documents by the model's relevance to the query", async () => {
		const tokenizer = vi.fn(() => ({ input_ids: "ids" }));
		const model = vi.fn(async () => ({
			logits: { dims: [3, 1], data: [-1, 3, 1] },
		}));
		const result = await runTextTool({
			bundle: bundleFor("text-ranking", { tokenizer, model }),
			payload: {
				task: "text-ranking",
				input: "capital of France",
				options: { documents: ["Berlin", "Paris", "Lyon"] },
			},
			cancellation,
		});
		expect(tokenizer).toHaveBeenCalledWith(
			["capital of France", "capital of France", "capital of France"],
			{
				text_pair: ["Berlin", "Paris", "Lyon"],
				padding: true,
				truncation: true,
			},
		);
		expect(
			(result.ranking as { document: string }[] | undefined)?.map(
				(entry) => entry.document,
			),
		).toEqual(["Paris", "Lyon", "Berlin"]);
	});

	it("refuses a task the model was not made for", async () => {
		await expect(
			runTextTool({
				bundle: bundleFor("text-classification", vi.fn()),
				payload: { task: "text-ranking", input: "q", options: {} },
				cancellation,
			}),
		).rejects.toThrow(/cannot run text-ranking/);
	});
});
