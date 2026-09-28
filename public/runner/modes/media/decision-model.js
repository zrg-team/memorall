// Typed decisions (`/systemone`) on the device.
//
// A decision model scores one `[MASK]` marker per answer option: the prompt is
// `[CLS] <type> question: <instructions> [SEP] [MASK] opt0 [MASK] opt1 … [SEP]
// <state> [SEP]`, the graph returns one logit per marker, and a softmax over a
// question's markers (after the repo's fitted temperature) is its answer.
//
// These graphs are not transformers.js pipelines, so this file drives ONNX
// Runtime directly: WebGPU through ORT's WebGPU bundle, WASM through ORT's
// plain build (the only CPU build with every contrib kernel the quantized
// exports use). Which files make up a model comes from the host's config
// (`config.decision`, built from the repo's file list); what the graph expects
// is read from the graph's own input names. Nothing here knows a model by name.
import { withGPULock } from "../../utils/gpu-lock.js";
import { fetchCachedWithProgress } from "./cache.js";
import { MediaInputError } from "./cancellation.js";
import { runOnDevice } from "./device.js";
import { mediaWasmPaths } from "./transformers-env.js";

const QUESTION_TYPES = { choice: 0, score: 1, noul: 2 };
/** Tokens an option text keeps, as the models were trained. */
const OPTION_TOKENS = 48;
const TEMPERATURE_RANGE = [0.5, 5];
const HUB = "https://huggingface.co";

/** Standard special-token spellings, used when the tokenizer config names none. */
const SPECIAL_TOKEN_FALLBACKS = {
	cls: ["[CLS]", "<cls>", "<s>", "<bos>"],
	sep: ["[SEP]", "<sep>", "</s>", "<eos>"],
	mask: ["[MASK]", "<mask>"],
	pad: ["[PAD]", "<pad>"],
};

const ortModules = new Map();

/** ORT for a device, loaded once per worker from the vendored bundles. */
export function loadOrt(device) {
	const bundle =
		device === "webgpu"
			? "ort.webgpu.bundle.min.mjs"
			: "ort.wasm.bundle.min.mjs";
	if (!ortModules.has(bundle)) {
		const url = new URL(bundle, mediaWasmPaths()).href;
		const loading = import(/* @vite-ignore */ url)
			.then((module) => {
				const ort = module.default?.InferenceSession ? module.default : module;
				ort.env.wasm.wasmPaths = mediaWasmPaths();
				// Extension CSP allows no blob: workers, which the proxy needs.
				ort.env.wasm.proxy = false;
				return ort;
			})
			.catch((error) => {
				ortModules.delete(bundle);
				throw error;
			});
		ortModules.set(bundle, loading);
	}
	return ortModules.get(bundle);
}

const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");

export const hubFileUrl = (repoId, path) =>
	`${HUB}/${repoId}/resolve/main/${encodePath(path)}`;

/** The variant `config.decision` selects, else the first (smallest). */
export function selectedVariant(config) {
	const decision = config?.decision;
	const variants = Array.isArray(decision?.variants) ? decision.variants : [];
	return (
		variants.find((variant) => variant.id === decision?.variant) ?? variants[0]
	);
}

const basename = (path) => path.slice(path.lastIndexOf("/") + 1);

/**
 * External data as ORT wants it: `{ path, data }` named the way the graph
 * refers to it. `.partNNN` chunks are one file split for upload and are joined
 * back; `_data_N` files are separate files and stay separate.
 */
export function externalDataEntries(files, buffers) {
	const groups = new Map();
	files.forEach((file, index) => {
		const name = basename(file).replace(/\.part\d+$/i, "");
		const group = groups.get(name) ?? [];
		group.push(buffers[index]);
		groups.set(name, group);
	});
	return [...groups].map(([path, parts]) => {
		if (parts.length === 1) return { path, data: parts[0] };
		const size = parts.reduce((total, part) => total + part.byteLength, 0);
		const data = new Uint8Array(size);
		let offset = 0;
		for (const part of parts) {
			data.set(part, offset);
			offset += part.byteLength;
		}
		return { path, data };
	});
}

/**
 * Fetches every file of a variant, reporting progress per file in the shape
 * `progress.js` produces.
 */
async function fetchVariantFiles(repoId, paths, notifyProgress) {
	const bytes = new Map();
	await Promise.all(
		paths.map(async (path) => {
			let last = -1;
			const data = await fetchCachedWithProgress(
				hubFileUrl(repoId, path),
				(loaded, total) => {
					const progress = total > 0 ? (loaded / total) * 100 : 0;
					if (progress < 100 && progress - last < 1) return;
					last = progress;
					notifyProgress?.({
						status: "progress",
						file: path,
						progress,
						loaded,
						total,
					});
				},
			);
			bytes.set(path, data);
		}),
	);
	return bytes;
}

const tokenContent = (value) =>
	typeof value === "string"
		? value
		: value && typeof value.content === "string"
			? value.content
			: undefined;

/** Id of a special token, from the tokenizer config or its standard names. */
export function specialTokenId(tokenizerJson, tokenizerConfig, role) {
	const added = Array.isArray(tokenizerJson?.added_tokens)
		? tokenizerJson.added_tokens
		: [];
	const vocab = tokenizerJson?.model?.vocab;
	const idOf = (content) => {
		const token = added.find((entry) => entry.content === content);
		if (token) return token.id;
		if (vocab && !Array.isArray(vocab) && typeof vocab[content] === "number") {
			return vocab[content];
		}
		return undefined;
	};
	const named = tokenContent(tokenizerConfig?.[`${role}_token`]);
	for (const content of [named, ...SPECIAL_TOKEN_FALLBACKS[role]]) {
		if (!content) continue;
		const id = idOf(content);
		if (typeof id === "number") return { id, content };
	}
	return undefined;
}

/** JSON the way the models saw it in training (Python's `json.dumps`). */
export function serializeState(state) {
	if (typeof state === "string") return state;
	const write = (value) => {
		if (Array.isArray(value)) return `[${value.map(write).join(", ")}]`;
		if (value && typeof value === "object") {
			return `{${Object.entries(value)
				.map(([key, entry]) => `${JSON.stringify(key)}: ${write(entry)}`)
				.join(", ")}}`;
		}
		return JSON.stringify(value ?? null);
	};
	return write(state);
}

const criteriaEntries = (criteria) =>
	Array.isArray(criteria)
		? criteria.map((label) => [String(label), null])
		: criteria && typeof criteria === "object"
			? Object.entries(criteria)
			: [];

/** Option texts in answer order (noul is always [false, true]). */
export function renderOptions(question) {
	if (question.type === "choice") {
		return criteriaEntries(question.criteria).map(([label, description]) =>
			description ? `${label}: ${description}` : label,
		);
	}
	if (question.type === "score") {
		return (Array.isArray(question.criteria) ? question.criteria : []).map(
			(level, index) => `level ${index}: ${level}`,
		);
	}
	const criteria =
		question.criteria &&
		typeof question.criteria === "object" &&
		!Array.isArray(question.criteria)
			? question.criteria
			: {};
	return [
		`false: ${criteria.false || "no, the statement does not hold"}`,
		`true: ${criteria.true || "yes, the statement holds"}`,
	];
}

/**
 * One question's token ids and marker positions.
 * @param {{ encode: (text: string) => number[], cls: number, sep: number, mask: number, maskText: string }} tokens
 */
export function buildSequence(tokens, state, question, maxLen, headMaxLen) {
	const strip = (text) => String(text).split(tokens.maskText).join(" ");
	const instructions =
		typeof question.instructions === "string"
			? question.instructions
			: JSON.stringify(question.instructions);
	let head = tokens.encode(`${question.type} question: ${strip(instructions)}`);
	let options = renderOptions(question).map((option) => [
		tokens.mask,
		...tokens.encode(` ${strip(option)}`).slice(0, OPTION_TOKENS),
	]);
	const length = (list) => list.reduce((total, ids) => total + ids.length, 0);
	let budget = headMaxLen - length(options);
	if (budget < 16) {
		// Too many or too long options: shrink every option evenly.
		const per = Math.max(
			4,
			Math.floor((headMaxLen - 16) / Math.max(1, options.length)),
		);
		options = options.map((ids) => ids.slice(0, per));
		budget = headMaxLen - length(options);
	}
	head = head.slice(0, Math.max(8, budget));
	const ids = [tokens.cls, ...head, tokens.sep];
	const markers = [];
	for (const option of options) {
		markers.push(ids.length);
		ids.push(...option);
	}
	ids.push(tokens.sep);
	const room = Math.max(0, maxLen - ids.length - 1);
	const stateIds = tokens.encode(strip(serializeState(state))).slice(0, room);
	const sequence = [...ids, ...stateIds, tokens.sep].slice(0, maxLen);
	return { ids: sequence, markers: markers.filter((at) => at < maxLen) };
}

const bucketOf = (type, count) =>
	`${type}:${count <= 2 ? "2" : count <= 5 ? "3-5" : count <= 10 ? "6-10" : "11+"}`;

/** The fitted temperature for a question type and option count. */
export function temperatureFor(agentConfig, type, count) {
	const byOptions = agentConfig?.temperature_by_options ?? {};
	const perType = Array.isArray(agentConfig?.temperature)
		? agentConfig.temperature
		: [1, 1, 1];
	const value = Number(
		byOptions[bucketOf(type, count)] ?? perType[QUESTION_TYPES[type]] ?? 1,
	);
	const [low, high] = TEMPERATURE_RANGE;
	return Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : 1;
}

const round = (value) => Math.round(value * 10_000) / 10_000;

function softmax(logits, temperature) {
	const scaled = logits.map((logit) => logit / temperature);
	const max = Math.max(...scaled);
	const exps = scaled.map((value) => Math.exp(value - max));
	const sum = exps.reduce((total, value) => total + value, 0);
	return exps.map((value) => value / sum);
}

/** 1 - normalised entropy: how settled the distribution is. */
function confidenceOf(probabilities) {
	const count = probabilities.length;
	if (count < 2) return 1;
	const entropy = -probabilities.reduce(
		(total, p) => total + (p > 0 ? p * Math.log(Math.max(p, 1e-12)) : 0),
		0,
	);
	return 1 - entropy / Math.log(count);
}

/** Logits of one question -> its answer in the `/systemone` shape. */
export function answerFor(question, logits, agentConfig) {
	const probabilities = softmax(
		logits,
		temperatureFor(agentConfig, question.type, logits.length),
	);
	const confidence = round(confidenceOf(probabilities));
	if (question.type === "choice") {
		const labels = criteriaEntries(question.criteria).map(([label]) => label);
		const best = probabilities.indexOf(Math.max(...probabilities));
		return {
			type: "choice",
			choice: labels[best],
			probabilities: Object.fromEntries(
				labels.map((label, index) => [label, round(probabilities[index])]),
			),
			confidence,
		};
	}
	if (question.type === "score") {
		const levels = Array.isArray(question.criteria) ? question.criteria : [];
		return {
			type: "score",
			score: round(
				probabilities.reduce((total, p, index) => total + index * p, 0),
			),
			legend: Object.fromEntries(
				levels.map((level, index) => [String(index), String(level)]),
			),
			probabilities: Object.fromEntries(
				probabilities.map((p, index) => [String(index), round(p)]),
			),
			confidence,
		};
	}
	return { type: "noul", noul: round(probabilities[1] ?? 0) };
}

/** Graph shape, from the graphs' own input names. */
export function describeSessions(sessions) {
	const inputs = (session) => new Set(session.inputNames ?? []);
	if (sessions.model) {
		const names = inputs(sessions.model);
		if (names.has("input_ids") && names.has("marker_pos")) return "single";
	}
	if (sessions.encoder && sessions.head) {
		const encoder = inputs(sessions.encoder);
		const head = inputs(sessions.head);
		if (
			encoder.has("input_ids") &&
			head.has("hidden_states") &&
			head.has("marker_pos")
		) {
			return "split";
		}
	}
	return null;
}

async function createSession(ort, device, bytes, external, optimization) {
	const options = {
		executionProviders: [device],
		...(optimization ? { graphOptimizationLevel: optimization } : {}),
		...(external.length ? { externalData: external } : {}),
	};
	const create = () => ort.InferenceSession.create(bytes, options);
	return device === "webgpu" ? withGPULock(create) : create();
}

/**
 * Loads a decision model: its files, tokenizer and ONNX sessions.
 * @returns {Promise<{ id: string, task: string, device: string, dtype: string, pipe: { dispose: () => Promise<void> }, decision: object }>}
 */
export async function loadDecisionBundle({
	transformers,
	config,
	device,
	optimization,
	notifyProgress,
}) {
	const variant = selectedVariant(config);
	if (!variant) {
		throw new MediaInputError(
			`${config.id} lists no decision model files; add it again from the Hub`,
		);
	}
	const graphs =
		variant.graphs.layout === "split"
			? { encoder: variant.graphs.encoder, head: variant.graphs.head }
			: { model: variant.graphs.model };
	const paths = [
		variant.config,
		variant.tokenizer,
		...(variant.tokenizerConfig ? [variant.tokenizerConfig] : []),
		...Object.values(graphs).flatMap((graph) => [graph.file, ...graph.data]),
	];
	const [ort, files] = await Promise.all([
		loadOrt(device),
		fetchVariantFiles(config.id, paths, notifyProgress),
	]);
	const json = (path) => JSON.parse(new TextDecoder().decode(files.get(path)));
	const agentConfig = json(variant.config);
	const tokenizerJson = json(variant.tokenizer);
	const tokenizerConfig = variant.tokenizerConfig
		? json(variant.tokenizerConfig)
		: {};
	const tokenizer = new transformers.PreTrainedTokenizer(
		tokenizerJson,
		tokenizerConfig,
	);
	const special = Object.fromEntries(
		Object.keys(SPECIAL_TOKEN_FALLBACKS).map((role) => [
			role,
			specialTokenId(tokenizerJson, tokenizerConfig, role),
		]),
	);
	const missing = Object.entries(special)
		.filter(([role, token]) => role !== "pad" && !token)
		.map(([role]) => role);
	if (missing.length > 0) {
		throw new MediaInputError(
			`${config.id}: the tokenizer has no ${missing.join("/")} token`,
		);
	}

	const sessions = {};
	try {
		for (const [role, graph] of Object.entries(graphs)) {
			sessions[role] = await createSession(
				ort,
				device,
				files.get(graph.file),
				externalDataEntries(
					graph.data,
					graph.data.map((path) => files.get(path)),
				),
				optimization,
			);
		}
	} catch (error) {
		await releaseSessions(device, sessions);
		throw error;
	}
	const layout = describeSessions(sessions);
	if (!layout) {
		await releaseSessions(device, sessions);
		throw new MediaInputError(
			`${config.id} (${variant.label}) is not a decision graph: it needs input_ids and marker_pos inputs`,
		);
	}

	return {
		id: config.id,
		task: config.task,
		device,
		dtype: variant.label,
		pipe: { dispose: () => releaseSessions(device, sessions, false) },
		decision: {
			ort,
			layout,
			sessions,
			agentConfig,
			tokens: {
				encode: (text) =>
					Array.from(tokenizer.encode(text, { add_special_tokens: false })),
				cls: special.cls.id,
				sep: special.sep.id,
				mask: special.mask.id,
				maskText: special.mask.content,
				pad: special.pad?.id ?? 0,
			},
		},
	};
}

async function releaseSessions(device, sessions, lock = true) {
	const release = async () => {
		for (const session of Object.values(sessions)) {
			try {
				await session?.release?.();
			} catch (error) {
				console.warn("[media-runner] decision session release failed", error);
			}
		}
	};
	// `disposeMediaBundle` already holds the device lock; the lock is not
	// reentrant, so only a failed load takes it here.
	return lock && device === "webgpu" ? withGPULock(release) : release();
}

const tensorType = (session, name, fallback) => {
	const metadata = Array.isArray(session.inputMetadata)
		? session.inputMetadata.find((entry) => entry?.name === name)
		: undefined;
	return metadata?.type ?? fallback;
};

function makeTensor(ort, session, name, type, values, dims) {
	const wanted = tensorType(session, name, type);
	if (wanted === "bool") {
		return new ort.Tensor("bool", Uint8Array.from(values, Number), dims);
	}
	if (wanted === "int32") {
		return new ort.Tensor("int32", Int32Array.from(values, Number), dims);
	}
	return new ort.Tensor("int64", BigInt64Array.from(values, BigInt), dims);
}

/** Only the inputs a graph declares, so optional ones can be left out. */
function feedsFor(ort, session, inputs) {
	const feeds = {};
	for (const name of session.inputNames) {
		const input = inputs[name];
		if (!input) {
			throw new MediaInputError(
				`The decision graph needs an unknown input "${name}"`,
			);
		}
		feeds[name] =
			input instanceof ort.Tensor
				? input
				: makeTensor(ort, session, name, input.type, input.values, input.dims);
	}
	return feeds;
}

/**
 * Answers every question in one batch.
 * @returns {Promise<{ model: string, answers: Record<string, object>, usage: { input_tokens: number, output_tokens: number } }>}
 */
export async function runDecision({ bundle, payload, cancellation }) {
	const decision = bundle.decision;
	if (!decision) {
		throw new MediaInputError(`${bundle.id} is not a decision model`);
	}
	const questions =
		payload?.questions && typeof payload.questions === "object"
			? Object.entries(payload.questions)
			: [];
	if (questions.length === 0) {
		throw new MediaInputError("Add at least one question");
	}
	const state = payload?.state;
	if (
		state === undefined ||
		state === null ||
		(typeof state === "string" && !state.trim())
	) {
		throw new MediaInputError("Enter some text first");
	}
	const { ort, sessions, agentConfig, tokens, layout } = decision;
	const maxLen = Number(agentConfig.max_len) || 512;
	const headMaxLen = Number(agentConfig.head_max_len) || 192;

	const rows = questions.map(([id, question]) => {
		if (!(question?.type in QUESTION_TYPES)) {
			throw new MediaInputError(`Question "${id}" has an unknown type`);
		}
		const expected = renderOptions(question).length;
		const row = buildSequence(tokens, state, question, maxLen, headMaxLen);
		if (row.markers.length !== expected || expected === 0) {
			throw new MediaInputError(
				`Question "${id}": its options do not fit the model's ${headMaxLen}-token question budget`,
			);
		}
		return { id, question, ...row };
	});
	cancellation?.throwIfCancelled();

	const batch = rows.length;
	const length = Math.max(...rows.map((row) => row.ids.length));
	const markerCount = Math.max(...rows.map((row) => row.markers.length));
	const ids = [];
	const attention = [];
	const markerPos = [];
	const markerMask = [];
	for (const row of rows) {
		for (let index = 0; index < length; index++) {
			ids.push(index < row.ids.length ? row.ids[index] : tokens.pad);
			attention.push(index < row.ids.length ? 1 : 0);
		}
		for (let index = 0; index < markerCount; index++) {
			markerPos.push(row.markers[index] ?? 0);
			markerMask.push(index < row.markers.length ? 1 : 0);
		}
	}
	const inputs = {
		input_ids: { type: "int64", values: ids, dims: [batch, length] },
		attention_mask: { type: "int64", values: attention, dims: [batch, length] },
		marker_pos: {
			type: "int64",
			values: markerPos,
			dims: [batch, markerCount],
		},
		marker_mask: {
			type: "bool",
			values: markerMask,
			dims: [batch, markerCount],
		},
		qtype: {
			type: "int64",
			values: rows.map((row) => QUESTION_TYPES[row.question.type]),
			dims: [batch],
		},
	};

	const logits = await runOnDevice(bundle.device, async () => {
		if (layout === "single") {
			const output = await sessions.model.run(
				feedsFor(ort, sessions.model, inputs),
			);
			return output.logits;
		}
		const encoded = await sessions.encoder.run(
			feedsFor(ort, sessions.encoder, inputs),
		);
		const hidden =
			encoded.last_hidden_state ?? encoded[sessions.encoder.outputNames[0]];
		const output = await sessions.head.run(
			feedsFor(ort, sessions.head, { ...inputs, hidden_states: hidden }),
		);
		return output.logits;
	});
	cancellation?.throwIfCancelled();

	const data = Array.from(logits.data, Number);
	const answers = {};
	rows.forEach((row, index) => {
		const start = index * markerCount;
		answers[row.id] = answerFor(
			row.question,
			data.slice(start, start + row.markers.length),
			agentConfig,
		);
	});
	return {
		model: bundle.id,
		answers,
		usage: {
			input_tokens: rows.reduce((total, row) => total + row.ids.length, 0),
			output_tokens: 0,
		},
	};
}
