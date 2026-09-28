import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services", () => ({
	serviceManager: { databaseService: { use: vi.fn() } },
}));

import {
	decisionVariantsOf,
	selectedDecisionVariant,
} from "../registry/decision-model-layout";
import {
	browserRunnability,
	estimateHubDownload,
	inspectHubModel,
	searchHubModels,
} from "../registry/media-model-store";
import {
	decisionSchemaOf,
	decisionStateOf,
	decisionToMarkdown,
	formatDecisionSchema,
	normalizeSystemOneResponse,
	parseDecisionSchema,
	validateDecisionQuestions,
} from "../utils/decision-schema";
import {
	createSystemOneDecision,
	type OpenAIMediaTransport,
} from "../utils/openai-media-client";
import { classifyByModalities } from "../utils/remote-model-categories";

const MB = 1_000_000;

/** File listings of real typed-decision repos, as the Hub reports them. */
const REPOS = {
	// Two roots, each a single graph with inline weights.
	subfolders: [
		{ rfilename: "README.md", size: 1000 },
		{ rfilename: "en/model_int4.onnx", size: 275 * MB },
		{ rfilename: "en/model_int8.onnx", size: 581 * MB },
		{ rfilename: "en/rl_agent_config.json", size: 700 },
		{ rfilename: "en/tokenizer.json", size: 3 * MB },
		{ rfilename: "en/tokenizer_config.json", size: 300 },
		{ rfilename: "multilingual/model_int8.onnx", size: 915 * MB },
		{ rfilename: "multilingual/rl_agent_config.json", size: 500 },
		{ rfilename: "multilingual/tokenizer.json", size: 34 * MB },
		{ rfilename: "multilingual/tokenizer_config.json", size: 500 },
		{ rfilename: "scripts/export.py", size: 3000 },
	],
	// Root graph, tokenizer in a subfolder.
	tokenizerFolder: [
		{ rfilename: "model.onnx", size: 646 * MB },
		{ rfilename: "onnx_config.json", size: 400 },
		{ rfilename: "rl_agent_config.json", size: 500 },
		{ rfilename: "tokenizer/tokenizer.json", size: 34 * MB },
		{ rfilename: "tokenizer/tokenizer_config.json", size: 500 },
	],
	// Encoder + head pair with external data, in a version folder.
	split: [
		{ rfilename: "v1/encoder_q8.onnx", size: 2.9 * MB },
		{ rfilename: "v1/encoder_q8.onnx.data", size: 468 * MB },
		{ rfilename: "v1/head_q8.onnx", size: 0.2 * MB },
		{ rfilename: "v1/head_q8.onnx.data", size: 53 * MB },
		{ rfilename: "v1/rl_agent_config.json", size: 700 },
		{ rfilename: "v1/tokenizer.json", size: 3.6 * MB },
		{ rfilename: "v1/tokenizer_config.json", size: 300 },
	],
	// External data uploaded in chunks.
	chunked: [
		{ rfilename: "laya_q4e8.onnx", size: 3.6 * MB },
		{ rfilename: "laya_q4e8.onnx.data.part001", size: 25 * MB },
		{ rfilename: "laya_q4e8.onnx.data.part000", size: 25 * MB },
		{ rfilename: "laya_q4e8.onnx.data.part002", size: 14 * MB },
		{ rfilename: "manifest.json", size: 1000 },
		{ rfilename: "rl_agent_config.json", size: 700 },
		{ rfilename: "tokenizer.json", size: 3.6 * MB },
		{ rfilename: "tokenizer_config.json", size: 300 },
	],
	// A transformers.js classifier: not a decision model.
	classifier: [
		{ rfilename: "config.json", size: 700 },
		{ rfilename: "onnx/model.onnx", size: 400 * MB },
		{ rfilename: "tokenizer.json", size: 3 * MB },
	],
};

describe("decision model layout", () => {
	it("finds one variant per graph in every root, smallest first", () => {
		const variants = decisionVariantsOf(REPOS.subfolders);
		expect(variants.map((variant) => variant.id)).toEqual([
			"en/model_int4",
			"en/model_int8",
			"multilingual/model_int8",
		]);
		expect(variants[2]).toMatchObject({
			config: "multilingual/rl_agent_config.json",
			tokenizer: "multilingual/tokenizer.json",
			tokenizerConfig: "multilingual/tokenizer_config.json",
			graphs: {
				layout: "single",
				model: { file: "multilingual/model_int8.onnx", data: [] },
			},
			sizeBytes: 915 * MB,
		});
	});

	it("reads a tokenizer from its own folder", () => {
		const [variant] = decisionVariantsOf(REPOS.tokenizerFolder);
		expect(variant).toMatchObject({
			id: "model",
			tokenizer: "tokenizer/tokenizer.json",
			tokenizerConfig: "tokenizer/tokenizer_config.json",
		});
	});

	it("pairs an encoder with its head and keeps their weights", () => {
		const variants = decisionVariantsOf(REPOS.split);
		expect(variants).toHaveLength(1);
		expect(variants[0]).toMatchObject({
			id: "v1/encoder_q8+head_q8",
			label: "v1/encoder_q8 + head_q8",
			graphs: {
				layout: "split",
				encoder: {
					file: "v1/encoder_q8.onnx",
					data: ["v1/encoder_q8.onnx.data"],
				},
				head: { file: "v1/head_q8.onnx", data: ["v1/head_q8.onnx.data"] },
			},
		});
	});

	it("orders chunked weights by part number", () => {
		const [variant] = decisionVariantsOf(REPOS.chunked);
		expect(
			variant?.graphs.layout === "single" && variant.graphs.model.data,
		).toEqual([
			"laya_q4e8.onnx.data.part000",
			"laya_q4e8.onnx.data.part001",
			"laya_q4e8.onnx.data.part002",
		]);
		expect(variant?.sizeBytes).toBe(67.6 * MB);
	});

	it("finds nothing in a repo without decision files", () => {
		expect(decisionVariantsOf(REPOS.classifier)).toEqual([]);
		expect(decisionVariantsOf([])).toEqual([]);
	});

	it("uses the chosen variant, else the smallest", () => {
		const variants = decisionVariantsOf(REPOS.subfolders);
		expect(selectedDecisionVariant({ variants })?.id).toBe("en/model_int4");
		expect(
			selectedDecisionVariant({ variants, variant: "multilingual/model_int8" })
				?.id,
		).toBe("multilingual/model_int8");
		expect(selectedDecisionVariant({ variants, variant: "gone" })?.id).toBe(
			"en/model_int4",
		);
	});
});

describe("decision discovery", () => {
	afterEach(() => vi.restoreAllMocks());

	it("classifies OpenRouter decision models from their modality", () => {
		expect(classifyByModalities({ output: ["decisions"] })).toEqual([
			"decision",
		]);
	});

	it("runs decision repos by their files, not a transformers.js architecture", () => {
		expect(
			browserRunnability({ siblings: REPOS.split }, "typed-decisions"),
		).toEqual({ runnable: true });
		expect(
			browserRunnability({ siblings: REPOS.classifier }, "typed-decisions"),
		).toEqual({ runnable: false, reason: "not-decision-model" });
	});

	it("sizes a decision repo by its variants", () => {
		expect(estimateHubDownload(REPOS.subfolders)).toEqual({
			byDevice: { webgpu: 275 * MB, wasm: 275 * MB },
			smallest: 275 * MB,
			largest: 915 * MB,
		});
	});

	it("adds any repo with decision files as a decision model", async () => {
		const fetcher = vi.fn(async () =>
			Response.json({
				id: "someone/decider",
				pipeline_tag: "text-classification",
				siblings: REPOS.subfolders,
				cardData: { license: "apache-2.0" },
			}),
		);
		const config = await inspectHubModel("someone/decider", {
			fetch: fetcher as unknown as typeof fetch,
		});
		expect(config).toMatchObject({
			id: "someone/decider",
			provider: "transformer-media",
			task: "typed-decisions",
			category: "decision",
			decision: { variant: "en/model_int4" },
		});
		expect(config.decision?.variants).toHaveLength(3);
	});

	it("searches ONNX repos by capability tags and keeps decision models", async () => {
		const urls: string[] = [];
		const fetcher = vi.fn(async (url: string) => {
			urls.push(url);
			const tag = new URL(url).searchParams.getAll("filter")[1];
			return Response.json(
				tag === "system-one"
					? [
							{ id: "a/decider", downloads: 5, siblings: REPOS.split },
							{ id: "b/classifier", downloads: 50, siblings: REPOS.classifier },
						]
					: tag === "typed-decisions"
						? [{ id: "a/decider", downloads: 5, siblings: REPOS.split }]
						: [],
			);
		});
		const found = await searchHubModels("decision", "", {
			fetch: fetcher as unknown as typeof fetch,
		});
		expect(found.map((model) => model.id)).toEqual(["a/decider"]);
		expect(found[0]).toMatchObject({ task: "typed-decisions", runnable: true });
		for (const url of urls) {
			const params = new URL(url).searchParams;
			expect(params.getAll("filter")[0]).toBe("onnx");
			expect(params.has("pipeline_tag")).toBe(false);
		}
		expect(urls).toHaveLength(4);
	});
});

describe("decision schema", () => {
	it("accepts a questions map or a whole request and normalizes it", () => {
		const request = {
			state: "x",
			questions: {
				topic: {
					type: "choice",
					instructions: "What is this about?",
					criteria: ["billing", "bug", " ", "billing"],
				},
				urgency: {
					type: "score",
					instructions: "How urgent?",
					criteria: ["low", "high"],
				},
				refund: { type: "noul", instructions: "Asks for money back." },
			},
		};
		const result = validateDecisionQuestions(request);
		expect(result.errors).toEqual([]);
		expect(result.questions?.topic).toEqual({
			type: "choice",
			instructions: "What is this about?",
			criteria: { billing: null, bug: null },
		});
		expect(result.questions?.refund).toEqual({
			type: "noul",
			instructions: "Asks for money back.",
		});
	});

	it("names what is wrong with each question", () => {
		const { errors } = validateDecisionQuestions({
			a: { type: "choice", instructions: "Pick", criteria: { only: null } },
			b: { type: "score", instructions: "Rate", criteria: ["one"] },
			c: { type: "maybe", instructions: "?" },
			d: { type: "noul", instructions: "  " },
		});
		expect(errors.map((error) => [error.questionId, error.field])).toEqual([
			["a", "criteria"],
			["b", "criteria"],
			["c", "type"],
			["d", "instructions"],
		]);
		expect(validateDecisionQuestions({}).errors[0]?.message).toMatch(
			/at least one/,
		);
		expect(validateDecisionQuestions([]).questions).toBeNull();
	});

	it("round-trips the JSON view", () => {
		const questions = {
			sentiment: {
				type: "choice" as const,
				instructions: "Mood",
				criteria: { positive: "happy", negative: null },
			},
		};
		const text = formatDecisionSchema(questions);
		expect(JSON.parse(text)).toEqual({ questions });
		expect(parseDecisionSchema(text)).toMatchObject({ questions, errors: [] });
		expect(parseDecisionSchema("{ nope").syntaxError).toBeTruthy();
	});

	it("reads a session's stored questions", () => {
		expect(
			decisionSchemaOf({
				decisionSchema: { a: { type: "noul", instructions: "A" } },
			}),
		).toEqual({ a: { type: "noul", instructions: "A" } });
		expect(decisionSchemaOf({})).toBeNull();
		expect(decisionSchemaOf(null)).toBeNull();
	});

	it("sends JSON objects as JSON and anything else as text", () => {
		expect(decisionStateOf('{"ticket": 1}')).toEqual({ ticket: 1 });
		expect(decisionStateOf("{ not json")).toBe("{ not json");
		expect(decisionStateOf("[1, 2]")).toBe("[1, 2]");
		expect(decisionStateOf("plain")).toBe("plain");
	});

	it("keeps well-formed answers of a response and drops the rest", () => {
		expect(
			normalizeSystemOneResponse(
				{
					model: "jev-1.13",
					answers: {
						queue: {
							type: "choice",
							choice: "billing",
							confidence: 1,
							probabilities: { billing: 1, bug: 0 },
						},
						urgent: { type: "noul", noul: 0.29 },
						level: { type: "score", score: 1.4, legend: { 0: "low" } },
						broken: { type: "choice" },
					},
					usage: { input_tokens: 385, output_tokens: 63, cost: 0.0001 },
				},
				"fallback",
			),
		).toEqual({
			object: "systemone",
			model: "jev-1.13",
			answers: {
				queue: {
					type: "choice",
					choice: "billing",
					confidence: 1,
					probabilities: { billing: 1, bug: 0 },
				},
				urgent: { type: "noul", noul: 0.29 },
				level: {
					type: "score",
					score: 1.4,
					legend: { 0: "low" },
					probabilities: undefined,
					confidence: undefined,
				},
			},
			usage: { input_tokens: 385, output_tokens: 63, cost: 0.0001 },
		});
		expect(normalizeSystemOneResponse(null, "m")).toEqual({
			object: "systemone",
			model: "m",
			answers: {},
			usage: undefined,
		});
	});

	it("writes a run as markdown", () => {
		const markdown = decisionToMarkdown({
			state: "charged twice",
			model: "jev",
			questions: {
				queue: {
					type: "choice",
					instructions: "Which team?",
					criteria: { billing: null, bug: null },
				},
				urgent: { type: "noul", instructions: "Urgent?" },
			},
			answers: {
				queue: {
					type: "choice",
					choice: "billing",
					probabilities: { billing: 0.9, bug: 0.1 },
				},
				urgent: { type: "noul", noul: 0.25 },
			},
		});
		expect(markdown).toContain("## Input\n\ncharged twice");
		expect(markdown).toContain("**billing**");
		expect(markdown).toContain("- billing: 90%");
		expect(markdown).toContain("**25%** true");
	});
});

describe("POST /systemone", () => {
	const transport: OpenAIMediaTransport = {
		baseURL: "https://openrouter.ai/api/v1",
		headers: () => ({ Authorization: "Bearer key" }),
		isOpenRouter: true,
	};

	afterEach(() => vi.restoreAllMocks());

	it("sends the state and questions and returns typed answers", async () => {
		const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			Response.json({
				model: "typesafe/jev-1.13",
				answers: { urgent: { type: "noul", noul: 0.8 } },
				usage: { input_tokens: 20, output_tokens: 0, cost: 0.000001 },
			}),
		);
		const questions = { urgent: { type: "noul" as const, instructions: "?" } };
		const response = await createSystemOneDecision(transport, {
			model: "typesafe/jev-1.13",
			state: { ticket: "site down" },
			questions,
		});

		const [url, init] = fetchMock.mock.calls[0] ?? [];
		expect(url).toBe("https://openrouter.ai/api/v1/systemone");
		expect(init?.method).toBe("POST");
		expect(init?.headers).toMatchObject({
			Authorization: "Bearer key",
			"Content-Type": "application/json",
		});
		expect(JSON.parse(String(init?.body))).toEqual({
			model: "typesafe/jev-1.13",
			state: { ticket: "site down" },
			questions,
		});
		expect(response.answers.urgent).toEqual({ type: "noul", noul: 0.8 });
		expect(response.usage?.cost).toBe(0.000001);
	});

	it("reports the provider's error", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response("question 'a': options do not fit", {
				status: 422,
				statusText: "Unprocessable Entity",
			}),
		);
		await expect(
			createSystemOneDecision(transport, {
				model: "m",
				state: "x",
				questions: { a: { type: "noul", instructions: "?" } },
			}),
		).rejects.toThrow(/Decision failed: 422.*options do not fit/);
	});
});
