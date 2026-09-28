// Single-shot text tasks, one handler per pipeline task. Outputs are shaped by
// what the task returns, never by which model returned it.
import { MediaInputError } from "./cancellation.js";
import { runOnDevice } from "./device.js";

const MAX_LABELS = 50;
const MAX_DOCUMENTS = 200;

const cleanList = (values, limit) =>
	(Array.isArray(values) ? values : [])
		.map((value) => String(value ?? "").trim())
		.filter(Boolean)
		.slice(0, limit);

const sigmoid = (value) => 1 / (1 + Math.exp(-value));

/** One relevance score per row of `[rows, classes]` logits. */
export function relevanceScores(logits) {
	const [rows, classes] = logits.dims;
	const data = logits.data;
	const scores = [];
	for (let row = 0; row < rows; row++) {
		if (classes === 1) {
			scores.push(sigmoid(Number(data[row])));
			continue;
		}
		// Several classes: the last one is "relevant"; softmax over the row.
		const offset = row * classes;
		let max = Number.NEGATIVE_INFINITY;
		for (let index = 0; index < classes; index++) {
			max = Math.max(max, Number(data[offset + index]));
		}
		let sum = 0;
		for (let index = 0; index < classes; index++) {
			sum += Math.exp(Number(data[offset + index]) - max);
		}
		scores.push(Math.exp(Number(data[offset + classes - 1]) - max) / sum);
	}
	return scores;
}

const TASK_HANDLERS = {
	"text-classification": async ({ run, bundle, input }) => {
		const labelCount = Object.keys(
			bundle.pipe.model?.config?.id2label ?? {},
		).length;
		const output = await run(input, { top_k: Math.max(labelCount, 2) });
		const rows = Array.isArray(output?.[0]) ? output[0] : output;
		return {
			labels: (Array.isArray(rows) ? rows : [rows])
				.filter((item) => item && typeof item.score === "number")
				.map((item) => ({ label: String(item.label), score: item.score }))
				.sort((left, right) => right.score - left.score),
		};
	},
	"zero-shot-classification": async ({ run, input, options }) => {
		const labels = cleanList(options.labels, MAX_LABELS);
		if (labels.length === 0) {
			throw new MediaInputError("Add at least one label to choose from");
		}
		const template = String(options.hypothesisTemplate ?? "").includes("{}")
			? options.hypothesisTemplate
			: undefined;
		const output = await run(input, labels, {
			multi_label: Boolean(options.multiLabel),
			...(template ? { hypothesis_template: template } : {}),
		});
		return {
			labels: (output?.labels ?? []).map((label, index) => ({
				label: String(label),
				score: output.scores[index],
			})),
		};
	},
	"text-ranking": async ({ bundle, device, input, options }) => {
		const documents = cleanList(options.documents, MAX_DOCUMENTS);
		if (documents.length === 0) {
			throw new MediaInputError("Add at least one document to rank");
		}
		const { tokenizer, model } = bundle.pipe;
		const scores = await runOnDevice(device, async () => {
			const inputs = tokenizer(
				documents.map(() => input),
				{ text_pair: documents, padding: true, truncation: true },
			);
			const { logits } = await model(inputs);
			return relevanceScores(logits);
		});
		return {
			ranking: documents
				.map((document, index) => ({ index, document, score: scores[index] }))
				.sort((left, right) => right.score - left.score),
		};
	},
};

export const TEXT_TOOL_TASKS = Object.keys(TASK_HANDLERS);

/**
 * @returns {Promise<{ labels?: object[], ranking?: object[] }>}
 */
export async function runTextTool({ bundle, payload, cancellation }) {
	const task = payload?.task;
	const handler = TASK_HANDLERS[task];
	if (!handler) throw new MediaInputError(`Unsupported text task: ${task}`);
	if (bundle.task !== task) {
		throw new MediaInputError(
			`${bundle.id} is a ${bundle.task} model and cannot run ${task}`,
		);
	}
	const input = String(payload?.input ?? "").trim();
	if (!input) throw new MediaInputError("Enter some text first");
	cancellation.throwIfCancelled();
	const run = (...args) =>
		runOnDevice(bundle.device, () => bundle.pipe(...args));
	const result = await handler({
		run,
		bundle,
		device: bundle.device,
		input,
		options: payload.options ?? {},
	});
	cancellation.throwIfCancelled();
	return result;
}
