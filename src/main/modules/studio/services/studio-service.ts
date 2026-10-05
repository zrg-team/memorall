import { serviceManager } from "@/services";
import type { CurrentModelInfo } from "@/services/llm/interfaces/llm-service.interface";
import type {
	ImageToolTask,
	TextToolTask,
	MediaCategory,
} from "@/services/llm/interfaces/model-category";
import { mimeTypeToExtension } from "@/services/llm/utils/media-encoding";
import {
	markGenerationActive,
	type NewStudioItem,
	useStudioStore,
} from "@/main/stores/studio";
import {
	type DecisionOptions,
	type ImageGenerationOptions,
	type ImageToolOptions,
	runDecisionGeneration,
	runImageGeneration,
	runImageToolGeneration,
	runSpeechGeneration,
	runTextToolGeneration,
	runTranscription,
	type SpeechOptions,
	type StudioRunContext,
	type TextToolOptions,
	type TranscriptionOptions,
} from "@/services/studio/studio-generations";
import type { MediaPayload } from "@/types/openai-media";
import type {
	StudioContentPart,
	StudioGenerationMetadata,
	StudioItem,
} from "@/types/studio";
import { isAbortError } from "@/utils/abort";

export type {
	DecisionOptions,
	ImageGenerationOptions,
	ImageToolOptions,
	SpeechOptions,
	TextToolOptions,
	TranscriptionOptions,
};

/** Save a user-provided file (recording, upload) and return its payload form. */
export async function saveStudioInput(
	file: Blob,
	kind: "audio" | "image",
): Promise<Extract<MediaPayload, { kind: "file" }>> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	const mimeType = file.type || (kind === "audio" ? "audio/webm" : "image/png");
	const { documentFileSystemService } = await import(
		"@/services/filesystem/document-filesystem"
	);
	const path = await documentFileSystemService.saveMediaFile(bytes, {
		kind,
		extension:
			mimeTypeToExtension(mimeType) ||
			(file instanceof File && file.name.includes(".")
				? file.name.slice(file.name.lastIndexOf("."))
				: kind === "audio"
					? ".webm"
					: ".png"),
		folder: kind === "audio" ? "recordings" : "inputs",
	});
	return { kind: "file", path, mimeType };
}

/** Where a run's model requests are booked: its Studio session. */
type StudioBooking = NonNullable<StudioRunContext["booking"]>;

interface GenerationContext {
	mode: MediaCategory;
	model: CurrentModelInfo;
	content: string;
	/** Parts known before the model runs (the prompt, the input clip). */
	inputParts: StudioContentPart[];
	params?: Record<string, unknown>;
	imageTask?: ImageToolTask;
	textTask?: TextToolTask;
}

/**
 * Record a generation as "running" immediately, then settle it.
 *
 * The placeholder is what makes a slow local model tolerable: the card shows
 * up the moment the user presses generate, with a live status, and survives a
 * reload as "failed" rather than vanishing if the tab dies mid-run.
 *
 * The run's model requests are booked to the session it lands in, so the
 * Usage page counts the Studio's tokens and cost next to the chat's.
 */
async function recordGeneration(
	context: GenerationContext,
	run: (
		update: (parts: StudioContentPart[], content?: string) => void,
		booking: StudioBooking,
	) => Promise<{ parts: StudioContentPart[]; content?: string }>,
): Promise<StudioItem> {
	const store = useStudioStore.getState();
	const startedAt = Date.now();
	const generation: StudioGenerationMetadata = {
		category: context.mode,
		provider: context.model.provider,
		serviceName: context.model.serviceName,
		modelId: context.model.modelId,
		status: "running",
		params: context.params,
		imageTask: context.imageTask,
		textTask: context.textTask,
	};
	const item = await store.addItem(context.mode, {
		content: context.content,
		parts: context.inputParts,
		generation,
	});
	markGenerationActive(item.id, true);

	const update = (parts: StudioContentPart[], content?: string) => {
		void useStudioStore.getState().updateItem(context.mode, item.id, {
			parts: [...context.inputParts, ...parts],
			...(content !== undefined ? { content } : {}),
		});
	};

	// Charged to the studio itself, e.g. decision, in the session it lands in.
	const booking: StudioBooking = {
		tool: context.mode,
		sessionId: item.conversationId,
		title:
			useStudioStore
				.getState()
				.modes[context.mode]?.conversations.find(
					(conversation) => conversation.id === item.conversationId,
				)?.title || context.content,
	};

	try {
		const result = await run(update, booking);
		const settled: NewStudioItem = {
			content: result.content ?? context.content,
			parts: [...context.inputParts, ...result.parts],
			generation: {
				...generation,
				status: "done",
				durationMs: Date.now() - startedAt,
			},
		};
		markGenerationActive(item.id, false);
		await useStudioStore.getState().updateItem(context.mode, item.id, settled);
		return { ...item, ...settled };
	} catch (error) {
		markGenerationActive(item.id, false);
		const cancelled = isAbortError(error);
		await useStudioStore.getState().updateItem(context.mode, item.id, {
			generation: {
				...generation,
				status: cancelled ? "cancelled" : "failed",
				error: cancelled
					? undefined
					: error instanceof Error
						? error.message
						: String(error),
				durationMs: Date.now() - startedAt,
			},
		});
		throw error;
	}
}

export function generateSpeech(options: SpeechOptions): Promise<StudioItem> {
	const mode = options.mode ?? "text-to-speech";
	return recordGeneration(
		{
			mode,
			model: options.model,
			content: options.input,
			inputParts: [{ type: "text", text: options.input, role: "prompt" }],
			params: {
				voice: options.voice,
				speed: options.speed,
				instructions: options.instructions,
				seed: options.seed,
				duration: options.duration,
			},
		},
		(_update, booking) => runSpeechGeneration({ ...options, booking }),
	);
}

export function transcribeAudio(
	options: TranscriptionOptions,
): Promise<StudioItem> {
	return recordGeneration(
		{
			mode: "speech-to-text",
			model: options.model,
			content: options.fileName ?? "Recording",
			inputParts: [
				{
					type: "input_audio",
					input_audio: {
						path: options.file.path,
						mimeType: options.file.mimeType,
						durationMs: options.durationMs,
						name: options.fileName,
					},
				},
			],
			params: { language: options.language, task: options.task },
		},
		(update, booking) => runTranscription({ ...options, booking }, update),
	);
}

export function generateImages(
	options: ImageGenerationOptions,
): Promise<StudioItem> {
	return recordGeneration(
		{
			mode: "image-generation",
			model: options.model,
			content: options.prompt,
			inputParts: [
				{ type: "text", text: options.prompt, role: "prompt" },
				...(options.inputParts ?? []),
			],
			params: {
				size: options.size,
				n: options.n,
				seed: options.seed,
				quality: options.quality,
			},
		},
		(_update, booking) => runImageGeneration({ ...options, booking }),
	);
}

export function runImageTool(options: ImageToolOptions): Promise<StudioItem> {
	return recordGeneration(
		{
			mode: "image-tools",
			model: options.model,
			content: options.fileName ?? options.task,
			imageTask: options.task,
			inputParts: [
				{
					type: "image",
					image: {
						path: options.image.path,
						mimeType: options.image.mimeType,
						role: "input",
					},
				},
			],
			params: { task: options.task, threshold: options.threshold },
		},
		(_update, booking) => runImageToolGeneration({ ...options, booking }),
	);
}

export function runTextTool(options: TextToolOptions): Promise<StudioItem> {
	const params = {
		task: options.task,
		labels: options.labels,
		multiLabel: options.multiLabel,
		hypothesisTemplate: options.hypothesisTemplate,
		documents: options.documents,
	};
	return recordGeneration(
		{
			mode: "text-tools",
			model: options.model,
			content: options.input,
			textTask: options.task,
			inputParts: [{ type: "text", text: options.input, role: "prompt" }],
			params,
		},
		(_update, booking) => runTextToolGeneration({ ...options, booking }),
	);
}

/**
 * Typed questions about a text, answered through `/systemone` by whichever
 * provider serves the model. The questions are stored with the result, so a
 * card still reads correctly after the session's questions change.
 */
export function runDecision(options: DecisionOptions): Promise<StudioItem> {
	return recordGeneration(
		{
			mode: "decision",
			model: options.model,
			content: options.input,
			inputParts: [{ type: "text", text: options.input, role: "prompt" }],
			params: { questions: options.questions },
		},
		(_update, booking) => runDecisionGeneration({ ...options, booking }),
	);
}

/**
 * Switch a local decision repo to another of its models. The runner keeps the
 * loaded model by repo id, so it is unloaded; the next run loads the new one.
 */
export async function selectDecisionVariant(
	model: CurrentModelInfo,
	variant: string,
): Promise<void> {
	const { getMediaModel, saveMediaModel } = await import(
		"@/services/llm/registry/media-model-store"
	);
	const config = await getMediaModel(model.modelId);
	if (!config?.decision || config.decision.variant === variant) return;
	await saveMediaModel({
		...config,
		decision: { ...config.decision, variant },
	});
	await serviceManager.llmService
		.unloadFor(model.serviceName, model.modelId)
		.catch(() => undefined);
}

export const isCancellation = isAbortError;
