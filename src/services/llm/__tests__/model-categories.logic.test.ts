import { describe, expect, it, vi } from "vitest";

vi.mock("@/services", () => ({
	serviceManager: { databaseService: { use: vi.fn() } },
}));

import { modelCategoriesOf } from "../interfaces/model-category";
import {
	LOCAL_RUNNER_PROVIDERS,
	PROVIDER_ORDER,
	PROVIDER_REGISTRY,
	providersForCategory,
} from "../provider-registry";
import {
	CATEGORY_TASKS,
	TASK_CATEGORY,
	imageToolTaskOf,
	primaryCategoryOf,
	resolveModelCategories,
} from "../registry/media-model-registry";
import {
	discoverVoices,
	estimateDownloadBytes,
	estimateHubDownload,
	fetchHubDownloadSizes,
	inspectHubModel,
	browserRunnability,
	hubBrowseUrl,
	isBrowserRunnable,
	repoIdFromInput,
	searchHubModels,
} from "../registry/media-model-store";
import {
	classifyByModalities,
	classifyRemoteModel,
} from "../utils/remote-model-categories";

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});

describe("classifyRemoteModel", () => {
	it.each([
		["some-chat-model", ["chat"]],
		["vendor/model-7b-instruct", ["chat"]],
		["acme-tts-2", ["text-to-speech"]],
		["acme-speech-hd", ["text-to-speech"]],
		["acme-transcribe", ["speech-to-text"]],
		["acme-asr-v3", ["speech-to-text"]],
		["acme-image-1", ["image-generation"]],
		["acme-embedding-small", ["embedding"]],
		["acme-moderation", []],
		["acme-realtime", []],
	])("%s -> %j", (id, expected) => {
		expect(classifyRemoteModel(id)).toEqual(expected);
	});

	it("reads published output modalities", () => {
		expect(classifyByModalities({ output: ["text"] })).toEqual(["chat"]);
		expect(classifyByModalities({ output: ["image", "text"] })).toEqual([
			"chat",
			"image-generation",
		]);
		expect(classifyByModalities({})).toBeNull();
	});
});

describe("provider registry", () => {
	it("describes every provider exactly once, in order", () => {
		expect(new Set(PROVIDER_ORDER).size).toBe(PROVIDER_ORDER.length);
		expect([...PROVIDER_ORDER].sort()).toEqual(
			Object.keys(PROVIDER_REGISTRY).sort(),
		);
	});

	it("counts only browser-hosted runners as resident", () => {
		expect([...LOCAL_RUNNER_PROVIDERS].sort()).toEqual([
			"transformer",
			"transformer-media",
			"webllm",
			"wllama",
		]);
	});

	it("routes each category to providers that can serve it", () => {
		expect(providersForCategory("text-to-speech")).toEqual([
			"transformer-media",
			"openai",
		]);
		expect(providersForCategory("image-tools")).toEqual(["transformer-media"]);
		expect(providersForCategory("image-generation")).not.toContain(
			"transformer-media",
		);
	});

	it("maps every pipeline task to a studio its provider serves", () => {
		for (const [task, category] of Object.entries(TASK_CATEGORY)) {
			expect(PROVIDER_REGISTRY["transformer-media"].categories, task).toContain(
				category,
			);
			expect(CATEGORY_TASKS[category]).toContain(task);
		}
	});
});

describe("resolveModelCategories", () => {
	it("prefers categories the runner reported", () => {
		expect(
			resolveModelCategories("transformer-media", "org/any-model", {
				categories: ["speech-to-text"],
			}),
		).toEqual(["speech-to-text"]);
	});

	it("does not guess chat for a media runner model it knows nothing about", () => {
		expect(primaryCategoryOf("transformer-media", "org/unknown")).toBeNull();
	});

	it("treats single-purpose chat runners as chat", () => {
		expect(resolveModelCategories("wllama", "org/repo/model.gguf")).toEqual([
			"chat",
		]);
	});

	it("classifies hosted models by id", () => {
		expect(primaryCategoryOf("openai", "acme-transcribe")).toBe(
			"speech-to-text",
		);
		expect(primaryCategoryOf("openrouter", "vendor/model")).toBe("chat");
	});

	it("defaults a model without categories to chat", () => {
		expect(modelCategoriesOf({})).toEqual(["chat"]);
	});
});

describe("download size estimates", () => {
	const repo = [
		{ rfilename: "config.json", size: 10 },
		{ rfilename: "tokenizer.json", size: 20 },
		{ rfilename: "model.safetensors", size: 9000 },
		{ rfilename: "onnx/encoder_model.onnx", size: 400 },
		{ rfilename: "onnx/encoder_model_quantized.onnx", size: 100 },
		{ rfilename: "onnx/encoder_model_q4.onnx", size: 60 },
		{ rfilename: "onnx/decoder_model.onnx", size: 300 },
		{ rfilename: "onnx/decoder_model.onnx_data", size: 700 },
		{ rfilename: "onnx/decoder_model_q4f16.onnx", size: 90 },
	];

	it("counts one copy of each graph in the precision, never other frameworks' weights", () => {
		expect(estimateDownloadBytes(repo, "fp32")).toBe(10 + 20 + 400 + 300 + 700);
		// No quantized decoder: its full-precision copy is what gets loaded.
		expect(estimateDownloadBytes(repo, "q8")).toBe(10 + 20 + 100 + 300 + 700);
		expect(estimateDownloadBytes(repo, "q4")).toBe(10 + 20 + 60 + 300 + 700);
		expect(estimateDownloadBytes(repo, "q4f16")).toBe(10 + 20 + 400 + 90);
	});

	it("counts a merged decoder instead of the graphs it replaces", () => {
		const seq2seq = [
			{ rfilename: "onnx/encoder_model.onnx", size: 30 },
			{ rfilename: "onnx/encoder_model_quantized.onnx", size: 10 },
			{ rfilename: "onnx/decoder_model.onnx", size: 110 },
			{ rfilename: "onnx/decoder_model_quantized.onnx", size: 28 },
			{ rfilename: "onnx/decoder_with_past_model.onnx", size: 105 },
			{ rfilename: "onnx/decoder_with_past_model_quantized.onnx", size: 27 },
			{ rfilename: "onnx/decoder_model_merged.onnx", size: 112 },
			{ rfilename: "onnx/decoder_model_merged_quantized.onnx", size: 29 },
		];
		expect(estimateDownloadBytes(seq2seq, "fp32")).toBe(30 + 112);
		expect(estimateDownloadBytes(seq2seq, "q8")).toBe(10 + 29);
	});

	it("gives each device its default precision and the range across precisions", () => {
		expect(estimateHubDownload(repo)).toEqual({
			byDevice: { webgpu: 1430, wasm: 1130 },
			smallest: 10 + 20 + 400 + 90,
			largest: 1430,
		});
	});

	it("fetches a repo's sizes once per session", async () => {
		const fetchMock = vi.fn(async () =>
			json({ id: "org/sized", siblings: repo }),
		);
		const options = { fetch: fetchMock as unknown as typeof fetch };

		const [first, second] = await Promise.all([
			fetchHubDownloadSizes("org/sized", options),
			fetchHubDownloadSizes("ORG/sized", options),
		]);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock).toHaveBeenCalledWith(
			"https://huggingface.co/api/models/org/sized?blobs=true",
		);
		expect(first?.byDevice.webgpu).toBe(1430);
		expect(second).toBe(first);
	});
});

describe("Hub model inspection", () => {
	it("builds a studio config for any runnable repo from its metadata", async () => {
		const fetchMock = vi.fn(async () =>
			json({
				id: "org/speaker-model",
				pipeline_tag: "text-to-speech",
				library_name: "transformers.js",
				config: { model_type: "vits" },
				cardData: { language: ["en", "fr"], license: "mit" },
				siblings: [
					{ rfilename: "config.json", size: 100 },
					{ rfilename: "onnx/model.onnx", size: 1000 },
					{ rfilename: "onnx/model_fp16.onnx", size: 500 },
					{ rfilename: "onnx/model_quantized.onnx", size: 250 },
					{ rfilename: "model.safetensors", size: 4000 },
					{ rfilename: "voices/alice.bin", size: 50 },
					{ rfilename: "voices/bob.bin", size: 50 },
				],
			}),
		);

		const config = await inspectHubModel("org/speaker-model", {
			fetch: fetchMock as unknown as typeof fetch,
		});

		expect(fetchMock).toHaveBeenCalledWith(
			"https://huggingface.co/api/models/org/speaker-model?blobs=true",
		);
		expect(config).toMatchObject({
			id: "org/speaker-model",
			provider: "transformer-media",
			task: "text-to-speech",
			category: "text-to-speech",
			languages: ["en", "fr"],
			license: "mit",
			sizeBytes: 1200,
			// WASM loads the quantized graph: config, 250 and the voices.
			sizeByDevice: { webgpu: 1200, wasm: 450 },
		});
		expect(config.voices?.map((voice) => voice.name)).toEqual(["alice", "bob"]);
		expect(config.voices?.[0]?.path).toBe(
			"https://huggingface.co/org/speaker-model/resolve/main/voices/alice.bin",
		);
	});

	it("rejects tasks no studio runs and repos without browser weights", async () => {
		await expect(
			inspectHubModel("org/chat", {
				fetch: (async () =>
					json({
						id: "org/chat",
						pipeline_tag: "text-generation",
						library_name: "transformers.js",
					})) as unknown as typeof fetch,
			}),
		).rejects.toThrow('"text-generation"');

		await expect(
			inspectHubModel("org/pytorch-only", {
				fetch: (async () =>
					json({
						id: "org/pytorch-only",
						pipeline_tag: "automatic-speech-recognition",
						library_name: "transformers",
						siblings: [{ rfilename: "model.safetensors" }],
					})) as unknown as typeof fetch,
			}),
		).rejects.toThrow("ONNX");
	});

	it("names image-tools tasks after their pipeline task", () => {
		expect(imageToolTaskOf({ task: "object-detection" })).toBe(
			"object-detection",
		);
		expect(imageToolTaskOf({ task: "text-to-speech" })).toBeUndefined();
	});

	it("finds voices by file convention, not by model", () => {
		expect(
			discoverVoices("org/m", [
				{ rfilename: "voices/a.bin" },
				{ rfilename: "speaker_embeddings/b.bin" },
				{ rfilename: "onnx/model.bin" },
				{ rfilename: "voices/readme.md" },
			]).map((voice) => voice.id),
		).toEqual(["speaker_embeddings/b.bin", "voices/a.bin"]);
		expect(isBrowserRunnable({ tags: ["transformers.js"] })).toBe(true);
	});

	it("tells a transformers.js model from ONNX graphs that need their own runtime", () => {
		const onnx = [{ rfilename: "onnx/model.onnx" }];
		expect(
			browserRunnability({ siblings: onnx, config: { model_type: "vits" } }),
		).toEqual({ runnable: true });
		expect(browserRunnability({ siblings: onnx, config: {} })).toEqual({
			runnable: false,
			reason: "custom-runtime",
		});
		expect(
			browserRunnability({ siblings: [{ rfilename: "model.safetensors" }] }),
		).toEqual({ runnable: false, reason: "no-onnx" });
	});

	it("knows which architectures each task's pipeline can load, before download", () => {
		const onnx = [{ rfilename: "onnx/model.onnx" }];
		expect(
			browserRunnability(
				{ siblings: onnx, config: { model_type: "style_text_to_speech_2" } },
				"text-to-speech",
			),
		).toEqual({
			runnable: false,
			reason: "unsupported-architecture",
			modelType: "style_text_to_speech_2",
		});
		expect(
			browserRunnability(
				{ siblings: onnx, config: { model_type: "vits" } },
				"text-to-speech",
			),
		).toEqual({ runnable: true });
		// A config that names the class instead of the type loads too.
		expect(
			browserRunnability(
				{
					siblings: onnx,
					config: { model_type: "SegformerForSemanticSegmentation" },
				},
				"background-removal",
			).runnable,
		).toBe(true);
		// Rerankers load through the text-classification pipeline.
		expect(
			browserRunnability(
				{ siblings: onnx, config: { model_type: "deberta-v2" } },
				"text-ranking",
			).runnable,
		).toBe(true);
		// A transformers.js tag does not stand in for an architecture.
		expect(
			browserRunnability({
				library_name: "onnxruntime",
				tags: ["transformers.js"],
				siblings: onnx,
				config: {},
			}),
		).toEqual({ runnable: false, reason: "custom-runtime" });
	});

	it("reads a repo id from an id or any Hugging Face model link", () => {
		expect(repoIdFromInput("org/model-name")).toBe("org/model-name");
		expect(repoIdFromInput("https://huggingface.co/org/model.v2")).toBe(
			"org/model.v2",
		);
		expect(
			repoIdFromInput("https://huggingface.co/org/model/tree/main/onnx"),
		).toBe("org/model");
		expect(repoIdFromInput("hf.co/org/model?library=onnx")).toBe("org/model");
		expect(repoIdFromInput("text to speech")).toBeNull();
	});

	it("links the same search on Hugging Face", () => {
		const url = new URL(hubBrowseUrl(["text-ranking"], "rerank"));
		expect(url.origin + url.pathname).toBe("https://huggingface.co/models");
		expect(url.searchParams.get("pipeline_tag")).toBe("text-ranking");
		expect(url.searchParams.get("library")).toBe("transformers.js");
		expect(url.searchParams.get("search")).toBe("rerank");
		expect(
			new URL(
				hubBrowseUrl(["text-classification", "text-ranking"]),
			).searchParams.has("pipeline_tag"),
		).toBe(false);
	});

	it("searches exactly the tasks it is given, across tools", async () => {
		const fetchMock = vi.fn(async (_url: string) => json([]));
		await searchHubModels(null, "", {
			fetch: fetchMock as unknown as typeof fetch,
			tasks: ["text-classification", "zero-shot-classification"],
		});
		expect(
			fetchMock.mock.calls.map((call) =>
				new URL(String(call[0])).searchParams.get("pipeline_tag"),
			),
		).toEqual(["text-classification", "zero-shot-classification"]);
	});

	it("maps text tasks to the text-tools studio", () => {
		expect(TASK_CATEGORY["zero-shot-classification"]).toBe("text-tools");
		expect(CATEGORY_TASKS["text-tools"]).toEqual([
			"text-classification",
			"zero-shot-classification",
			"text-ranking",
		]);
	});

	it("hides models the browser cannot run unless one is searched for by name", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			const params = new URL(url).searchParams;
			if (params.get("filter") === "transformers.js") {
				return json([
					{
						id: "org/tts-web",
						downloads: 10,
						likes: 1,
						tags: [],
						config: { model_type: "vits" },
						siblings: [{ rfilename: "onnx/model.onnx" }],
					},
				]);
			}
			return json([
				{
					id: "org/tts-web",
					downloads: 10,
					library_name: "transformers.js",
					config: { model_type: "vits" },
					siblings: [{ rfilename: "onnx/model.onnx" }],
				},
				{
					id: "org/custom-tts",
					downloads: 500,
					library_name: "onnx",
					config: {},
					siblings: [{ rfilename: "onnx/text_encoder.onnx" }],
				},
			]);
		});

		const options = { fetch: fetchMock as unknown as typeof fetch };

		const general = await searchHubModels("text-to-speech", "tts", options);
		expect(general.map((result) => result.id)).toEqual(["org/tts-web"]);

		for (const query of [
			"org/custom-tts",
			"https://huggingface.co/org/custom-tts",
			"custom-tts",
		]) {
			const specific = await searchHubModels("text-to-speech", query, options);
			expect(
				specific.map((result) => [result.id, result.runnable, result.reason]),
			).toContainEqual(["org/custom-tts", false, "custom-runtime"]);
		}
		const unfiltered = fetchMock.mock.calls
			.map((call) => new URL(String(call[0])).searchParams)
			.find((params) => !params.has("filter"));
		expect(unfiltered?.getAll("expand[]")).toContain("config");
	});

	it("searches every pipeline task of a studio, most downloaded first", async () => {
		const fetchMock = vi.fn(async (url: string) => {
			const task = new URL(url).searchParams.get("pipeline_tag");
			return json(
				task === "object-detection"
					? [
							{
								id: "org/detector",
								downloads: 50,
								likes: 1,
								tags: ["en"],
								config: { model_type: "detr" },
								siblings: [{ rfilename: "onnx/model.onnx" }],
							},
						]
					: task === "depth-estimation"
						? [
								{
									id: "org/depth",
									downloads: 900,
									likes: 2,
									tags: [],
									config: { model_type: "dpt" },
									siblings: [{ rfilename: "onnx/model.onnx" }],
								},
							]
						: [],
			);
		});

		const results = await searchHubModels("image-tools", "small", {
			fetch: fetchMock as unknown as typeof fetch,
		});

		// A search asks each task twice: transformers.js models, then any repo.
		expect(fetchMock).toHaveBeenCalledTimes(
			CATEGORY_TASKS["image-tools"]!.length * 2,
		);
		const firstUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
		expect(firstUrl.searchParams.get("filter")).toBe("transformers.js");
		expect(firstUrl.searchParams.get("search")).toBe("small");
		expect(results.map((result) => [result.id, result.task])).toEqual([
			["org/depth", "depth-estimation"],
			["org/detector", "object-detection"],
		]);
	});
});
