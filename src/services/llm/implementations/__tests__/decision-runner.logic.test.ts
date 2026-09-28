import { describe, expect, it } from "vitest";
import {
	answerFor,
	buildSequence,
	describeSessions,
	externalDataEntries,
	hubFileUrl,
	renderOptions,
	runDecision,
	selectedVariant,
	serializeState,
	specialTokenId,
	temperatureFor,
} from "../../../../../public/runner/modes/media/decision-model.js";
import { createMediaEngine } from "../../../../../public/runner/modes/media/engine.js";
import { loadAttempts } from "../../../../../public/runner/modes/media/loaders.js";

const cancellation = {
	cancelled: false,
	throwIfCancelled: () => undefined,
	onCancel: () => () => undefined,
};

/** One id per word: enough to check the layout without a real tokenizer. */
const tokens = {
	encode: (text: string) =>
		text
			.trim()
			.split(/\s+/)
			.filter(Boolean)
			.map((word) => 1000 + word.length),
	cls: 1,
	sep: 2,
	mask: 3,
	maskText: "[MASK]",
	pad: 0,
};

class FakeTensor {
	constructor(
		public type: string,
		public data: ArrayLike<number | bigint>,
		public dims: number[],
	) {}
}
const ort = { Tensor: FakeTensor };

const QTYPE_LOGITS: Record<number, number[]> = {
	0: [0, 2, 0],
	1: [0, 0, 4],
	2: [-1, 1, 0],
};

/** A single-graph session answering by question type; records its feeds. */
function fakeSession(inputNames: string[], seen: Record<string, FakeTensor>[]) {
	return {
		inputNames,
		outputNames: ["logits", "act_logits"],
		run: async (feeds: Record<string, FakeTensor>) => {
			seen.push(feeds);
			const [batch, markers] = feeds.marker_pos?.dims ?? [0, 0];
			const types = Array.from(feeds.qtype?.data ?? [], Number);
			const data: number[] = [];
			for (let row = 0; row < (batch ?? 0); row++) {
				data.push(
					...(QTYPE_LOGITS[types[row] ?? 0] ?? []).slice(0, markers ?? 0),
				);
			}
			return {
				logits: new FakeTensor("float32", data, [batch ?? 0, markers ?? 0]),
			};
		},
	};
}

const QUESTIONS = {
	team: {
		type: "choice",
		instructions: "Which team?",
		criteria: { billing: "money", bug: null },
	},
	urgency: {
		type: "score",
		instructions: "How urgent?",
		criteria: ["low", "medium", "high"],
	},
	refund: { type: "noul", instructions: "Wants a refund." },
};

const AGENT_CONFIG = { max_len: 64, head_max_len: 32, temperature: [1, 1, 1] };

describe("decision prompt", () => {
	it("renders options the way the models were trained", () => {
		expect(renderOptions(QUESTIONS.team)).toEqual(["billing: money", "bug"]);
		expect(renderOptions(QUESTIONS.urgency)).toEqual([
			"level 0: low",
			"level 1: medium",
			"level 2: high",
		]);
		expect(renderOptions(QUESTIONS.refund)).toEqual([
			"false: no, the statement does not hold",
			"true: yes, the statement holds",
		]);
		expect(
			renderOptions({
				type: "noul",
				instructions: "x",
				criteria: { true: "it is", false: "it is not" },
			}),
		).toEqual(["false: it is not", "true: it is"]);
	});

	it("lays out a question with one mask marker per option", () => {
		const { ids, markers } = buildSequence(
			tokens,
			"x y",
			{
				type: "choice",
				instructions: "pick one",
				criteria: { a: null, b: "bee" },
			},
			64,
			32,
		);
		expect(ids).toEqual([
			1, 1006, 1009, 1004, 1003, 2, 3, 1001, 3, 1002, 1003, 2, 1001, 1001, 2,
		]);
		expect(markers).toEqual([6, 8]);
	});

	it("shrinks options evenly when they overflow the question budget", () => {
		const criteria = Object.fromEntries(
			Array.from({ length: 6 }, (_, index) => [
				`option${index}`,
				"a b c d e f g h",
			]),
		);
		const { markers } = buildSequence(
			tokens,
			"state",
			{ type: "choice", instructions: "pick", criteria },
			128,
			40,
		);
		expect(markers).toHaveLength(6);
		// Each option keeps (40 - 16) / 6 = 4 tokens, marker included.
		expect(markers[1]! - markers[0]!).toBe(4);
	});

	it("strips the mask token from user text", () => {
		const { ids } = buildSequence(
			tokens,
			"a [MASK] b",
			{ type: "noul", instructions: "[MASK] here" },
			64,
			32,
		);
		expect(ids.filter((id) => id === tokens.mask)).toHaveLength(2);
	});

	it("serializes JSON state like Python's json.dumps", () => {
		expect(serializeState({ a: [1, "x"], b: { c: null } })).toBe(
			'{"a": [1, "x"], "b": {"c": null}}',
		);
		expect(serializeState("text")).toBe("text");
	});
});

describe("decision answers", () => {
	it("picks the fitted temperature for the type and option count", () => {
		const config = {
			temperature: [1.5, 1.2, 1.9],
			temperature_by_options: { "choice:2": 2, "choice:11+": 0.1 },
		};
		expect(temperatureFor(config, "choice", 2)).toBe(2);
		expect(temperatureFor(config, "choice", 4)).toBe(1.5);
		expect(temperatureFor(config, "score", 3)).toBe(1.2);
		// Out-of-range fits are clamped rather than trusted.
		expect(temperatureFor(config, "choice", 12)).toBe(0.5);
		expect(temperatureFor({}, "noul", 2)).toBe(1);
	});

	it("shapes answers like /systemone", () => {
		const choice = answerFor(QUESTIONS.team, [0, 2], AGENT_CONFIG);
		expect(choice).toMatchObject({ type: "choice", choice: "bug" });
		expect(choice.probabilities.bug).toBeCloseTo(0.8808, 3);
		expect(choice.confidence).toBeGreaterThan(0);

		const score = answerFor(QUESTIONS.urgency, [0, 0, 0], AGENT_CONFIG);
		expect(score).toMatchObject({
			type: "score",
			score: 1,
			legend: { 0: "low", 1: "medium", 2: "high" },
			confidence: 0,
		});

		expect(answerFor(QUESTIONS.refund, [0, 0], AGENT_CONFIG)).toEqual({
			type: "noul",
			noul: 0.5,
		});
	});
});

describe("decision model files", () => {
	it("finds special tokens from the tokenizer config or standard names", () => {
		const tokenizerJson = {
			added_tokens: [
				{ id: 7, content: "<bos>" },
				{ id: 8, content: "<eos>" },
				{ id: 9, content: "<mask>" },
			],
			model: { vocab: { "<pad>": 0 } },
		};
		expect(
			specialTokenId(tokenizerJson, { cls_token: "<bos>" }, "cls"),
		).toEqual({ id: 7, content: "<bos>" });
		expect(specialTokenId(tokenizerJson, {}, "sep")).toEqual({
			id: 8,
			content: "<eos>",
		});
		expect(
			specialTokenId(
				tokenizerJson,
				{ mask_token: { content: "<mask>" } },
				"mask",
			),
		).toEqual({ id: 9, content: "<mask>" });
		expect(specialTokenId(tokenizerJson, {}, "pad")).toEqual({
			id: 0,
			content: "<pad>",
		});
	});

	it("joins chunked weights and keeps separate files apart", () => {
		const a = new Uint8Array([1, 2]);
		const b = new Uint8Array([3]);
		const c = new Uint8Array([9]);
		const entries = externalDataEntries(
			[
				"dir/m.onnx.data.part000",
				"dir/m.onnx.data.part001",
				"dir/m.onnx_data_1",
			],
			[a, b, c],
		);
		expect(entries.map((entry: { path: string }) => entry.path)).toEqual([
			"m.onnx.data",
			"m.onnx_data_1",
		]);
		expect(Array.from(entries[0].data)).toEqual([1, 2, 3]);
		expect(entries[1].data).toBe(c);
	});

	it("resolves Hub files and the chosen variant", () => {
		expect(hubFileUrl("org/model", "v1/encoder q8.onnx")).toBe(
			"https://huggingface.co/org/model/resolve/main/v1/encoder%20q8.onnx",
		);
		const variants = [{ id: "a" }, { id: "b" }];
		expect(selectedVariant({ decision: { variants, variant: "b" } })).toEqual({
			id: "b",
		});
		expect(selectedVariant({ decision: { variants } })).toEqual({ id: "a" });
		expect(selectedVariant({})).toBeUndefined();
	});

	it("tells single and split graphs from their inputs", () => {
		const single = {
			inputNames: ["input_ids", "attention_mask", "marker_pos"],
		};
		expect(describeSessions({ model: single })).toBe("single");
		expect(
			describeSessions({
				encoder: { inputNames: ["input_ids", "attention_mask"] },
				head: { inputNames: ["hidden_states", "marker_pos", "marker_mask"] },
			}),
		).toBe("split");
		expect(
			describeSessions({ model: { inputNames: ["input_ids"] } }),
		).toBeNull();
	});

	it("tries each device with and without optimizer passes", () => {
		expect(loadAttempts("webgpu", undefined, "typed-decisions")).toEqual([
			{ device: "webgpu" },
			{ device: "webgpu", optimization: "basic" },
			{ device: "wasm" },
			{ device: "wasm", optimization: "basic" },
		]);
		expect(loadAttempts("wasm", "q8", "typed-decisions")).toEqual([
			{ device: "wasm" },
			{ device: "wasm", optimization: "basic" },
		]);
	});
});

describe("runDecision", () => {
	const single = (seen: Record<string, FakeTensor>[]) => ({
		id: "org/decider",
		device: "wasm",
		decision: {
			ort,
			layout: "single",
			agentConfig: AGENT_CONFIG,
			tokens,
			sessions: {
				model: fakeSession(
					["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"],
					seen,
				),
			},
		},
	});

	it("answers every question in one padded batch", async () => {
		const seen: Record<string, FakeTensor>[] = [];
		const result = await runDecision({
			bundle: single(seen),
			payload: { state: "charged twice", questions: QUESTIONS },
			cancellation,
		});

		expect(seen).toHaveLength(1);
		const feeds = seen[0]!;
		expect(feeds.marker_pos?.dims).toEqual([3, 3]);
		expect(feeds.marker_mask?.type).toBe("bool");
		// Two-option questions pad their third marker out.
		expect(Array.from(feeds.marker_mask?.data ?? [])).toEqual([
			1, 1, 0, 1, 1, 1, 1, 1, 0,
		]);
		expect(Array.from(feeds.qtype?.data ?? [], Number)).toEqual([0, 1, 2]);
		const [rows, length] = feeds.input_ids?.dims ?? [];
		expect(rows).toBe(3);
		const attention = Array.from(feeds.attention_mask?.data ?? [], Number);
		expect(attention).toHaveLength(3 * (length ?? 0));

		const answers = result.answers as Record<string, any>;
		expect(result.model).toBe("org/decider");
		expect(answers.team).toMatchObject({ type: "choice", choice: "bug" });
		expect(answers.urgency).toMatchObject({ type: "score" });
		expect(answers.urgency.score).toBeGreaterThan(1.9);
		expect(answers.refund.type).toBe("noul");
		expect(answers.refund.noul).toBeCloseTo(0.8808, 3);
		expect(result.usage.input_tokens).toBe(
			attention.reduce((total, value) => total + value, 0),
		);
	});

	it("runs the encoder, then the head on its hidden states", async () => {
		const seen: Record<string, FakeTensor>[] = [];
		const hidden = new FakeTensor("float32", [0.5], [1, 1, 1]);
		const encoder = {
			inputNames: ["input_ids", "attention_mask"],
			outputNames: ["last_hidden_state"],
			run: async (feeds: Record<string, FakeTensor>) => {
				seen.push(feeds);
				return { last_hidden_state: hidden };
			},
		};
		const head = fakeSession(
			["hidden_states", "marker_pos", "marker_mask", "qtype", "attention_mask"],
			seen,
		);
		const result = await runDecision({
			bundle: {
				id: "org/split",
				device: "wasm",
				decision: {
					ort,
					layout: "split",
					agentConfig: AGENT_CONFIG,
					tokens,
					sessions: { encoder, head },
				},
			},
			payload: { state: "x", questions: { refund: QUESTIONS.refund } },
			cancellation,
		});
		expect(Object.keys(seen[0] ?? {})).toEqual(["input_ids", "attention_mask"]);
		expect(seen[1]?.hidden_states).toBe(hidden);
		expect(result.answers.refund).toMatchObject({ type: "noul" });
	});

	it("refuses input it can never answer", async () => {
		const bundle = single([]);
		await expect(
			runDecision({
				bundle,
				payload: { state: "x", questions: {} },
				cancellation,
			}),
		).rejects.toThrow(/at least one question/);
		await expect(
			runDecision({
				bundle,
				payload: { state: "  ", questions: QUESTIONS },
				cancellation,
			}),
		).rejects.toThrow(/Enter some text/);
		await expect(
			runDecision({
				bundle: { id: "org/tts", device: "wasm" },
				payload: { state: "x", questions: QUESTIONS },
				cancellation,
			}),
		).rejects.toThrow(/not a decision model/);
	});

	it("is served by the media engine", async () => {
		const emitted: { type: string; payload: any }[] = [];
		const engine = createMediaEngine({
			idleTimeoutMs: 0,
			emit: (_id: string | null, type: string, payload: any) =>
				emitted.push({ type, payload }),
			loadTransformers: async () => ({}),
			loadBundle: (async () => ({
				...single([]),
				task: "typed-decisions",
				dtype: "model_int4",
				pipe: { dispose: async () => undefined },
			})) as any,
			disposeBundle: async () => undefined,
		});
		await engine.handle("r1", "systemone", {
			config: { id: "org/decider", task: "typed-decisions" },
			state: "charged twice",
			questions: { team: QUESTIONS.team },
		});
		const terminal = emitted.find((entry) => entry.type === "complete");
		expect(terminal?.payload.answers.team).toMatchObject({
			type: "choice",
			choice: "bug",
		});
		await engine.dispose();
	});
});
