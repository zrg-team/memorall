import type { ModelInfo } from "@/services/llm/interfaces/base-llm";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type { MeteredLlmService } from "@/services/model-usage/metered-llm";
import type {
	ImageToolTask,
	MediaCategory,
	TextToolTask,
} from "@/services/llm/interfaces/model-category";
import {
	decisionToMarkdown,
	scoreLevelsOf,
	validateDecisionQuestions,
} from "@/services/llm/utils/decision-schema";
import type {
	DecisionOptions,
	ImageGenerationOptions,
	ImageToolOptions,
	SpeechOptions,
	StudioGenerationResult,
	TextToolOptions,
	TranscriptionOptions,
} from "@/services/studio/studio-generations";
import type {
	StoredStudioRun,
	StudioRunRecord,
} from "@/services/studio/studio-history";
import {
	type ModelUsageScope,
	STUDIO_USAGE_SOURCE,
} from "@/services/model-usage/model-usage-ledger";
import type { DecisionAnswer, DecisionQuestions } from "@/types/openai-media";
import type {
	StudioContentPart,
	StudioGenerationMetadata,
} from "@/types/studio";
import {
	MEMON_STUDIO_LABELS,
	MEMON_STUDIO_MODES,
	MEMON_STUDIO_TOOL,
	MEMON_STUDIO_TOOL_IDS,
	type MemonStudioToolId,
} from "./constants";
import { memonFileKind, memonMimeType } from "./file-kinds";
import type { MemonStudioToolState } from "./types";

/** How much of a text result (a transcript, say) the agent reads at once. */
export const MEMON_STUDIO_TEXT_CHARS = 4_000;
/** The speech studio's input limit. */
const SPEECH_MAX_CHARS = 4_096;
const MAX_LISTED = 20;

/** One studio run, as the agent asks for it. */
export interface MemonStudioRequest {
	tool: MemonStudioToolId;
	/** Text to decide about, speak, classify or rank by; or a prompt. */
	text?: string;
	/** A file in Files: audio to transcribe, an image to work on. */
	path?: string;
	questions?: unknown;
	labels?: string[];
	multiLabel?: boolean;
	documents?: string[];
	task?: string;
	voice?: string;
	speed?: number;
	instructions?: string;
	language?: string;
	translate?: boolean;
	size?: string;
	count?: number;
	/** Seconds, for Audio. */
	duration?: number;
	threshold?: number;
}

export interface MemonStudioOutcome {
	/** The input in short, for the window. */
	input: string;
	/** The result as the agent reads it, cut to a screen's worth. */
	text: string;
	/** The whole text result, for saving to a file. */
	fullText: string;
	parts: StudioContentPart[];
	model: string;
	conversationId?: string;
	itemId?: string;
}

export interface MemonStudioPort {
	/** Which tools have a model; `detailed` also reads voices and tasks. */
	tools(detailed?: boolean): Promise<MemonStudioToolState[]>;
	run(
		request: MemonStudioRequest,
		context: {
			sessionKey: string;
			/** The agent (flow id) the run is booked to, if any. */
			agentId?: string | null;
			signal?: AbortSignal;
		},
	): Promise<MemonStudioOutcome>;
}

export interface MemonStudioGenerators {
	speech(options: SpeechOptions): Promise<StudioGenerationResult>;
	transcribe(options: TranscriptionOptions): Promise<StudioGenerationResult>;
	image(options: ImageGenerationOptions): Promise<StudioGenerationResult>;
	imageTool(options: ImageToolOptions): Promise<StudioGenerationResult>;
	textTool(options: TextToolOptions): Promise<StudioGenerationResult>;
	decision(options: DecisionOptions): Promise<StudioGenerationResult>;
}

/** What the Studio app runs on; injected so tests need no models. */
export interface MemonStudioDeps {
	currentModel(mode: MediaCategory): Promise<CurrentModelInfo | null>;
	modelInfo(model: CurrentModelInfo): Promise<ModelInfo | undefined>;
	/** Loads an on-device model before it runs. */
	prepare(model: CurrentModelInfo, mode: MediaCategory): Promise<void>;
	generators: MemonStudioGenerators;
	/**
	 * The metered LLM service a run uses, booked to the computer's Studio
	 * session and agent (without it the run is booked to plain "Studio").
	 */
	models?(scope: ModelUsageScope): Promise<MeteredLlmService>;
	record(record: StudioRunRecord): Promise<StoredStudioRun>;
}

const IMAGE_TOOL_TASKS: readonly ImageToolTask[] = [
	"background-removal",
	"image-segmentation",
	"depth-estimation",
	"object-detection",
	"image-to-text",
	"image-classification",
];
const TEXT_TOOL_TASKS: readonly TextToolTask[] = [
	"text-classification",
	"zero-shot-classification",
	"text-ranking",
];

const percent = (value: number | undefined): string =>
	value === undefined ? "" : `${Math.round(value * 1000) / 10}%`;

const oneLine = (text: string, max = 100): string => {
	const clean = text.replace(/\s+/g, " ").trim();
	return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const baseName = (path: string): string => path.split("/").pop() || path;

const need = (value: string | undefined, message: string): string => {
	if (!value?.trim()) throw new Error(message);
	return value.trim();
};

const fileOfKind = (
	path: string | undefined,
	kinds: readonly string[],
	message: string,
): { kind: "file"; path: string; mimeType: string } => {
	const file = need(path, message);
	if (!kinds.includes(memonFileKind(file))) {
		throw new Error(`${file} is not ${kinds.join(" or ")}. ${message}`);
	}
	return { kind: "file", path: file, mimeType: memonMimeType(file) };
};

/** A model's declared task wins; otherwise the one asked for. */
const pickTask = <T extends string>(
	tool: string,
	declared: T | undefined,
	asked: string | undefined,
	tasks: readonly T[],
): T => {
	if (declared) {
		if (asked && asked !== declared) {
			throw new Error(
				`The ${tool} model does ${declared}, not ${asked}. Leave out task, or ask the user to choose another model in Studio.`,
			);
		}
		return declared;
	}
	if (asked && (tasks as readonly string[]).includes(asked)) return asked as T;
	throw new Error(`${tool} needs task: one of ${tasks.join(", ")}.`);
};

const cut = (text: string): string =>
	text.length > MEMON_STUDIO_TEXT_CHARS
		? `${text.slice(0, MEMON_STUDIO_TEXT_CHARS)}\n… ${text.length - MEMON_STUDIO_TEXT_CHARS} more characters. Pass saveTo to keep the whole result in a file.`
		: text;

const answerLine = (
	id: string,
	questions: DecisionQuestions,
	answer: DecisionAnswer | undefined,
): string => {
	if (!answer) return `- ${id}: no answer`;
	if (answer.type === "choice") {
		const others = Object.entries(answer.probabilities ?? {})
			.sort((a, b) => b[1] - a[1])
			.slice(0, 4)
			.map(([label, value]) => `${label} ${percent(value)}`)
			.join(", ");
		return `- ${id}: ${answer.choice}${others ? ` (${others})` : ""}`;
	}
	if (answer.type === "score") {
		const question = questions[id];
		const levels = question ? scoreLevelsOf(question) : [];
		const nearest = levels[Math.round(answer.score)];
		return `- ${id}: ${answer.score.toFixed(2)}${levels.length ? ` on 0–${levels.length - 1}` : ""}${nearest ? ` (closest: ${nearest})` : ""}`;
	}
	return `- ${id}: ${percent(answer.noul)} yes`;
};

const partsOf = <T extends StudioContentPart["type"]>(
	parts: StudioContentPart[],
	type: T,
) =>
	parts.filter(
		(part): part is Extract<StudioContentPart, { type: T }> =>
			part.type === type,
	);

/** A studio result as text: what the agent reads in place of the media. */
export const describeStudioResult = (
	tool: MemonStudioToolId,
	parts: StudioContentPart[],
	questions?: DecisionQuestions,
): string => {
	const lines: string[] = [];
	for (const part of partsOf(parts, "decision")) {
		lines.push("Answers:");
		for (const id of Object.keys(questions ?? part.decision.answers)) {
			lines.push(answerLine(id, questions ?? {}, part.decision.answers[id]));
		}
	}
	for (const part of partsOf(parts, "output_audio")) {
		const { path, durationMs, voice } = part.output_audio;
		const details = [
			durationMs ? `${(durationMs / 1000).toFixed(1)} s` : null,
			voice && voice !== "default" ? `voice ${voice}` : null,
		].filter(Boolean);
		lines.push(
			`Saved the ${tool === "audio" ? "audio" : "speech"} to ${path}${details.length ? ` (${details.join(", ")})` : ""}.`,
		);
	}
	const images = partsOf(parts, "image").filter(
		(part) => part.image.role !== "input",
	);
	if (images.length) {
		lines.push(
			tool === "image"
				? `Created ${images.length} image${images.length === 1 ? "" : "s"}; you cannot see them, the user sees them in the Studio window:`
				: "Images:",
		);
		for (const { image } of images) {
			const size =
				image.width && image.height ? ` ${image.width}×${image.height}` : "";
			const role =
				image.role === "generated"
					? ""
					: ` (${image.role}${image.label ? `: ${image.label}` : ""})`;
			lines.push(`- ${image.path}${size}${role}`);
		}
	}
	for (const part of partsOf(parts, "detections")) {
		lines.push(`Detected ${part.detections.length}:`);
		for (const detection of part.detections.slice(0, MAX_LISTED)) {
			const { xmin, ymin, xmax, ymax } = detection.box;
			lines.push(
				`- ${detection.label} ${percent(detection.score)} at ${Math.round(xmin)},${Math.round(ymin)}–${Math.round(xmax)},${Math.round(ymax)}`,
			);
		}
	}
	for (const part of partsOf(parts, "labels")) {
		lines.push(
			`Labels: ${part.labels
				.slice(0, MAX_LISTED)
				.map((label) => `${label.label} ${percent(label.score)}`)
				.join(", ")}`,
		);
	}
	for (const part of partsOf(parts, "ranking")) {
		lines.push("Ranking, most relevant first:");
		for (const [position, entry] of part.ranking
			.slice(0, MAX_LISTED)
			.entries()) {
			lines.push(
				`${position + 1}. [document ${entry.index + 1}] ${percent(entry.score)} "${oneLine(entry.document, 80)}"`,
			);
		}
	}
	for (const part of partsOf(parts, "text")) {
		if (part.role === "prompt") continue;
		const segments = partsOf(parts, "segments")[0];
		lines.push(
			part.role === "transcript"
				? `Transcript${segments?.language ? ` (${segments.language})` : ""}:`
				: "Caption:",
			part.text.trim() || "(empty)",
		);
	}
	return lines.join("\n") || "The model returned nothing.";
};

interface PreparedRun {
	input: string;
	content: string;
	inputParts: StudioContentPart[];
	params: Record<string, unknown>;
	imageTask?: ImageToolTask;
	textTask?: TextToolTask;
	questions?: DecisionQuestions;
	sessionMetadata?: Record<string, unknown>;
	generate(): Promise<StudioGenerationResult>;
}

const prepareRun = (
	request: MemonStudioRequest,
	model: CurrentModelInfo,
	info: ModelInfo | undefined,
	generators: MemonStudioGenerators,
	/** Every generator gets the run's signal and LLM service. */
	run: { signal?: AbortSignal; llm?: MeteredLlmService },
): PreparedRun => {
	switch (request.tool) {
		case "decision": {
			const text = need(
				request.text,
				"decision needs text: the text or JSON object to decide about.",
			);
			const { questions, errors } = validateDecisionQuestions(
				request.questions,
			);
			if (!questions || errors.length) {
				const reasons = errors.length
					? errors
							.map((error) =>
								error.questionId
									? `${error.questionId}: ${error.message}`
									: error.message,
							)
							.join("; ")
					: "add at least one question";
				throw new Error(`The decision questions are not valid: ${reasons}.`);
			}
			return {
				input: oneLine(text),
				content: text,
				inputParts: [{ type: "text", text, role: "prompt" }],
				params: { questions },
				questions,
				sessionMetadata: { decisionSchema: questions },
				generate: () =>
					generators.decision({ model, input: text, questions, ...run }),
			};
		}
		case "speech":
		case "audio": {
			const text = need(
				request.text,
				request.tool === "audio"
					? "audio needs text: a prompt describing the sound or music."
					: "speech needs text to speak.",
			);
			if (text.length > SPEECH_MAX_CHARS) {
				throw new Error(
					`${request.tool} takes at most ${SPEECH_MAX_CHARS} characters at a time; split the text.`,
				);
			}
			const voices = info?.voices?.map((voice) => voice.id) ?? [];
			if (request.voice && voices.length && !voices.includes(request.voice)) {
				throw new Error(
					`Unknown voice "${request.voice}". Voices: ${voices.join(", ")}.`,
				);
			}
			const voice =
				request.tool === "audio"
					? "default"
					: (request.voice ?? voices[0] ?? "default");
			const duration =
				request.tool === "audio" ? (request.duration ?? 10) : undefined;
			return {
				input: oneLine(text),
				content: text,
				inputParts: [{ type: "text", text, role: "prompt" }],
				params:
					request.tool === "audio"
						? { voice, duration }
						: {
								voice,
								speed: request.speed,
								instructions: request.instructions,
							},
				generate: () =>
					generators.speech({
						mode: request.tool === "audio" ? "text-to-audio" : "text-to-speech",
						model,
						input: text,
						voice,
						speed: request.tool === "audio" ? undefined : request.speed,
						instructions:
							request.tool === "audio" ? undefined : request.instructions,
						duration,
						...run,
					}),
			};
		}
		case "transcribe": {
			const file = fileOfKind(
				request.path,
				["audio", "video"],
				"transcribe needs path: an audio or video file in Files.",
			);
			const task = request.translate ? "translate" : "transcribe";
			return {
				input: file.path,
				content: baseName(file.path),
				inputParts: [
					{
						type: "input_audio",
						input_audio: {
							path: file.path,
							mimeType: file.mimeType,
							name: baseName(file.path),
						},
					},
				],
				params: { language: request.language, task },
				generate: () =>
					generators.transcribe({
						model,
						file,
						fileName: baseName(file.path),
						language: request.language,
						task,
						...run,
					}),
			};
		}
		case "image": {
			const prompt = need(request.text, "image needs text: the prompt.");
			const reference = request.path
				? fileOfKind(
						request.path,
						["image"],
						"path is the image to start from.",
					)
				: undefined;
			const referenceParts: StudioContentPart[] = reference
				? [
						{
							type: "image",
							image: {
								path: reference.path,
								mimeType: reference.mimeType,
								role: "input",
							},
						},
					]
				: [];
			return {
				input: oneLine(prompt),
				content: prompt,
				inputParts: [
					{ type: "text", text: prompt, role: "prompt" },
					...referenceParts,
				],
				params: { size: request.size, n: request.count },
				generate: () =>
					generators.image({
						model,
						prompt,
						size: request.size,
						n: request.count,
						references: reference ? [reference] : undefined,
						...run,
					}),
			};
		}
		case "image_tools": {
			const image = fileOfKind(
				request.path,
				["image"],
				"image_tools needs path: an image in Files.",
			);
			const task = pickTask(
				"image_tools",
				info?.imageTask,
				request.task,
				IMAGE_TOOL_TASKS,
			);
			return {
				input: `${image.path} · ${task}`,
				content: baseName(image.path),
				inputParts: [
					{
						type: "image",
						image: {
							path: image.path,
							mimeType: image.mimeType,
							role: "input",
						},
					},
				],
				params: { task, threshold: request.threshold },
				imageTask: task,
				generate: () =>
					generators.imageTool({
						model,
						task,
						image,
						fileName: baseName(image.path),
						threshold: request.threshold,
						...run,
					}),
			};
		}
		case "text_tools": {
			const text = need(
				request.text,
				"text_tools needs text: the text to classify, or the query to rank documents by.",
			);
			const task = pickTask(
				"text_tools",
				info?.textTask,
				request.task,
				TEXT_TOOL_TASKS,
			);
			if (task === "zero-shot-classification" && !request.labels?.length) {
				throw new Error(
					"zero-shot-classification needs labels to choose from.",
				);
			}
			if (task === "text-ranking" && !request.documents?.length) {
				throw new Error("text-ranking needs documents to rank.");
			}
			return {
				input: `${oneLine(text, 80)} · ${task}`,
				content: text,
				inputParts: [{ type: "text", text, role: "prompt" }],
				params: {
					task,
					labels: request.labels,
					multiLabel: request.multiLabel,
					documents: request.documents,
				},
				textTask: task,
				generate: () =>
					generators.textTool({
						model,
						task,
						input: text,
						labels: request.labels,
						multiLabel: request.multiLabel,
						documents: request.documents,
						...run,
					}),
			};
		}
	}
};

/**
 * The computer's Studio app: the agent runs the studios with the models the
 * user chose for them, reads every result as text, and each run is kept in
 * Studio history like one made on the Studio page.
 */
export const createStudioPort = (deps: MemonStudioDeps): MemonStudioPort => ({
	async tools(detailed = false) {
		return Promise.all(
			MEMON_STUDIO_TOOL_IDS.map(async (id): Promise<MemonStudioToolState> => {
				try {
					const model = await deps.currentModel(MEMON_STUDIO_MODES[id]);
					if (!model) {
						return { id, ready: false, reason: "no model chosen in Studio" };
					}
					if (!detailed) return { id, ready: true, model: model.modelId };
					const info = await deps.modelInfo(model).catch(() => undefined);
					return {
						id,
						ready: true,
						model: info?.name ?? model.modelId,
						task: info?.imageTask ?? info?.textTask,
						voices: info?.voices?.map((voice) => voice.id),
					};
				} catch (error) {
					return {
						id,
						ready: false,
						reason: error instanceof Error ? error.message : String(error),
					};
				}
			}),
		);
	},

	async run(request, { sessionKey, agentId, signal }) {
		const mode = MEMON_STUDIO_MODES[request.tool];
		const label = MEMON_STUDIO_LABELS[request.tool];
		const model = await deps.currentModel(mode);
		if (!model) {
			throw new Error(
				`${label} has no model. Ask the user to choose one in Studio → ${label}.`,
			);
		}
		const info = await deps.modelInfo(model).catch(() => undefined);
		const llm = await deps.models?.({
			source: STUDIO_USAGE_SOURCE,
			tool: MEMON_STUDIO_TOOL,
			agentId,
			sessionId: sessionKey,
			title: `Studio · ${label}`,
		});
		const prepared = prepareRun(request, model, info, deps.generators, {
			signal,
			llm,
		});
		await deps.prepare(model, mode);
		const startedAt = Date.now();
		const result = await prepared.generate();
		const parts = [...prepared.inputParts, ...result.parts];
		const generation: StudioGenerationMetadata = {
			category: mode,
			provider: model.provider,
			serviceName: model.serviceName,
			modelId: model.modelId,
			status: "done",
			params: prepared.params,
			imageTask: prepared.imageTask,
			textTask: prepared.textTask,
			durationMs: Date.now() - startedAt,
		};
		// Losing the history entry must not lose the result.
		const stored = await deps
			.record({
				mode,
				sessionKey,
				sessionTitle: `MemonOS Bot · ${prepared.input}`,
				content: result.content ?? prepared.content,
				parts,
				generation,
				sessionMetadata: prepared.sessionMetadata,
			})
			.catch(() => undefined);
		const described = describeStudioResult(
			request.tool,
			result.parts,
			prepared.questions,
		);
		const name = info?.name ?? model.modelId;
		return {
			input: prepared.input,
			text: cut(described),
			fullText:
				request.tool === "decision" && prepared.questions
					? decisionToMarkdown({
							state: prepared.content,
							questions: prepared.questions,
							answers:
								partsOf(result.parts, "decision")[0]?.decision.answers ?? {},
							model: name,
						})
					: described,
			parts,
			model: name,
			conversationId: stored?.conversationId,
			itemId: stored?.itemId,
		};
	},
});
