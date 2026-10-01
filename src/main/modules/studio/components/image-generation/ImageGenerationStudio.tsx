import { ImageIcon, Sparkles } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
	WorkspaceEmptyState,
	WorkspaceEmptyVisual,
} from "@/main/components/molecules/WorkspaceEmptyState";
import { useStudioStore } from "@/main/stores/studio";
import { readStoredMedia } from "@/services/llm/utils/media-persistence";
import type { MediaPayload } from "@/types/openai-media";
import type {
	ImageComment,
	StudioContentPart,
	StudioItem,
} from "@/types/studio";
import { logError } from "@/utils/logger";
import {
	generateImages,
	isCancellation,
	saveStudioInput,
} from "../../services/studio-service";
import { MAX_INPUT_BYTES } from "../image-tools/detection-geometry";
import { formatBytes } from "../image-tools/ImageToolInput";
import { StudioThread } from "../shared/StudioThread";
import type { StudioCanvasProps } from "../studio-canvas";
import { generatedImagesOf, ImageGenerationCard } from "./ImageGenerationCard";
import {
	type GalleryImage,
	type ImageCommenting,
	ImageLightbox,
} from "./ImageLightbox";
import {
	basePromptOf,
	commentsOf,
	feedbackOf,
	withComments,
} from "./image-feedback";
import {
	buildFeedbackRequest,
	type FeedbackRequest,
	type FeedbackSource,
} from "./image-feedback-request";
import {
	type ImageComposerCapabilities,
	ImagePromptComposer,
	type ImagePromptComposerHandle,
	type ImageSettings,
} from "./ImagePromptComposer";
import {
	clampImageCount,
	IMAGE_SIZES,
	sizeParam,
	IMAGE_QUALITIES,
	type ImageQuality,
} from "./image-generation-options";

const EXAMPLES = [
	{
		key: "fox",
		defaultValue:
			"A red fox curled up in fresh snow at dawn, soft golden light, shallow depth of field",
	},
	{
		key: "city",
		defaultValue:
			"Isometric illustration of a tiny floating city with waterfalls, pastel colors",
	},
	{
		key: "poster",
		defaultValue:
			"Minimalist travel poster of Ha Long Bay, bold shapes, limited palette",
	},
	{
		key: "product",
		defaultValue:
			"Studio photo of a ceramic coffee cup on a linen cloth, morning window light",
	},
] as const;

interface GenerationRequest {
	prompt: string;
	size: string;
	n: number;
	quality?: ImageQuality;
	seed?: number;
	/** A follow-up to an image; its files are made when the run starts. */
	feedback?: {
		source: FeedbackSource;
		basePrompt: string;
		comments: ImageComment[];
	};
	/** Images to start from; saved, as this run's own, when it starts. */
	attachments?: readonly File[];
}

type FilePayload = Extract<MediaPayload, { kind: "file" }>;

/** How many images one request may start from. */
const MAX_ATTACHMENTS = 4;

const isEditableTarget = (target: EventTarget | null) =>
	target instanceof HTMLElement &&
	(target.isContentEditable || /^(INPUT|SELECT)$/.test(target.tagName));

/** The images a request started from (a follow-up's marked copy aside). */
const attachedImagesOf = (item: StudioItem) =>
	feedbackOf(item)
		? []
		: item.parts.flatMap((part) =>
				part.type === "image" && part.image.role === "input"
					? [part.image]
					: [],
			);

/**
 * An item's images read back into files: deleting the item deletes its
 * files, so a new run must not point at them.
 */
const filesOfItem = (item: StudioItem): Promise<File[]> =>
	Promise.all(
		attachedImagesOf(item).map(
			async (image, index) =>
				new File(
					[(await readStoredMedia(image.path)) as BlobPart],
					image.path.split("/").pop() ?? `image-${index + 1}`,
					{ type: image.mimeType },
				),
		),
	);

const settingsFromParams = (
	params: Record<string, unknown>,
	current: ImageSettings,
	capabilities: ImageComposerCapabilities,
): ImageSettings => ({
	size:
		typeof params.size === "string" && capabilities.sizes.includes(params.size)
			? params.size
			: current.size,
	n: capabilities.count ? clampImageCount(params.n) : 1,
	quality: IMAGE_QUALITIES.includes(params.quality as ImageQuality)
		? (params.quality as ImageQuality)
		: current.quality,
	seed:
		capabilities.seed && typeof params.seed === "number"
			? String(params.seed)
			: current.seed,
});

export const ImageGenerationStudio: React.FC<StudioCanvasProps> = ({
	mode,
	model,
	items,
	ensureModelReady,
	isNarrow,
}) => {
	const { t } = useTranslation("studioImage");
	const deleteItem = useStudioStore((store) => store.deleteItem);
	const updateItem = useStudioStore((store) => store.updateItem);

	// Every option is an optional field of the OpenAI images API: offered for
	// any model, sent only when set, and a server that does not take one says
	// so on the card.
	const capabilities = useMemo<ImageComposerCapabilities>(
		() => ({
			sizes: [...IMAGE_SIZES],
			count: true,
			quality: true,
			seed: true,
		}),
		[],
	);

	const [prompt, setPrompt] = useState("");
	const [settings, setSettings] = useState<ImageSettings>(() => ({
		size: capabilities.sizes[0] ?? "1024x1024",
		n: 1,
		quality: "auto",
		seed: "",
	}));
	const [running, setRunning] = useState(false);
	const [progress, setProgress] = useState<number | null>(null);
	const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
	const [commenting, setCommenting] = useState(false);
	const [attachments, setAttachments] = useState<File[]>([]);
	const [attachError, setAttachError] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);
	const abortRef = useRef<AbortController | null>(null);
	const composerRef = useRef<ImagePromptComposerHandle>(null);
	const attachmentsRef = useRef(attachments);
	attachmentsRef.current = attachments;

	const attach = useCallback(
		(files: readonly File[], replace = false) => {
			const images = files.filter((file) => file.type.startsWith("image/"));
			const tooLarge = images.find((file) => file.size > MAX_INPUT_BYTES);
			const accepted = images.filter((file) => file.size <= MAX_INPUT_BYTES);
			const kept = replace ? [] : attachmentsRef.current;
			const added = accepted.slice(
				0,
				Math.max(0, MAX_ATTACHMENTS - kept.length),
			);
			const overLimit = kept.length + accepted.length > MAX_ATTACHMENTS;
			setAttachError(
				images.length === 0
					? t("composer.notImage", {
							defaultValue: "That file is not an image.",
						})
					: tooLarge
						? t("composer.tooLarge", {
								size: formatBytes(tooLarge.size),
								max: formatBytes(MAX_INPUT_BYTES),
								defaultValue: `This image is ${formatBytes(tooLarge.size)}; the limit is ${formatBytes(MAX_INPUT_BYTES)}.`,
							})
						: overLimit
							? t("composer.tooMany", {
									max: MAX_ATTACHMENTS,
									defaultValue: `Up to ${MAX_ATTACHMENTS} images can be used at once.`,
								})
							: null,
			);
			const next = [...kept, ...added];
			attachmentsRef.current = next;
			setAttachments(next);
			composerRef.current?.focus();
		},
		[t],
	);

	const removeAttachment = (index: number) => {
		setAttachError(null);
		const next = attachmentsRef.current.filter((_, at) => at !== index);
		attachmentsRef.current = next;
		setAttachments(next);
	};

	/** Clears the composer's images once a run has taken them. */
	const clearAttachments = () => {
		attachmentsRef.current = [];
		setAttachments([]);
		setAttachError(null);
	};

	// An image pasted anywhere in the studio, the prompt included, is one to
	// start from; pasted text is left to the field it goes to.
	useEffect(() => {
		const onPaste = (event: ClipboardEvent) => {
			if (isEditableTarget(event.target)) return;
			const files = Array.from(event.clipboardData?.files ?? []).filter(
				(file) => file.type.startsWith("image/"),
			);
			if (files.length === 0) return;
			event.preventDefault();
			attach(files);
		};
		window.addEventListener("paste", onPaste);
		return () => window.removeEventListener("paste", onPaste);
	}, [attach]);

	// A different model may not offer the chosen size or several images;
	// fall back to what it does support instead of sending a request it rejects.
	useEffect(() => {
		setSettings((current) => {
			const size = capabilities.sizes.includes(current.size)
				? current.size
				: (capabilities.sizes[0] ?? current.size);
			const n = capabilities.count ? current.n : 1;
			return size === current.size && n === current.n
				? current
				: { ...current, size, n };
		});
	}, [capabilities]);

	const galleryImages = useMemo<GalleryImage[]>(
		() =>
			items.flatMap((item) =>
				item.generation.status === "done"
					? generatedImagesOf(item).map((image, index) => ({
							key: `${item.id}:${index}`,
							itemId: item.id,
							path: image.path,
							mimeType: image.mimeType,
							prompt: item.content,
							index,
						}))
					: [],
			),
		[items],
	);

	const newestRunningId = useMemo(() => {
		for (let index = items.length - 1; index >= 0; index--) {
			if (items[index]?.generation.status === "running")
				return items[index]?.id;
		}
		return undefined;
	}, [items]);

	const run = useCallback(
		async (request: GenerationRequest) => {
			if (abortRef.current) return;
			const controller = new AbortController();
			abortRef.current = controller;
			setRunning(true);
			setProgress(null);
			try {
				const ready = await ensureModelReady();
				if (controller.signal.aborted) return;
				let follow: FeedbackRequest | undefined;
				if (request.feedback) {
					follow = await buildFeedbackRequest(
						request.feedback.source,
						request.feedback.basePrompt,
						request.feedback.comments,
					);
					if (controller.signal.aborted) return;
				}
				let references: FilePayload[] | undefined = follow?.references;
				let inputParts: StudioContentPart[] | undefined = follow?.inputParts;
				if (!follow && request.attachments?.length) {
					references = await Promise.all(
						request.attachments.map((file) => saveStudioInput(file, "image")),
					);
					inputParts = references.map((image) => ({
						type: "image" as const,
						image: {
							path: image.path,
							mimeType: image.mimeType,
							role: "input" as const,
						},
					}));
					if (controller.signal.aborted) return;
				}
				await generateImages({
					model: ready,
					prompt: follow?.prompt ?? request.prompt,
					references,
					mask: follow?.mask,
					inputParts,
					size: sizeParam(request.size),
					n: request.n > 1 ? request.n : undefined,
					quality: request.quality === "auto" ? undefined : request.quality,
					seed: request.seed,
					signal: controller.signal,
					onProgress: (percent) => setProgress(percent),
				});
			} catch (error) {
				// The item already shows the failure; model load errors show in the shell.
				if (!isCancellation(error))
					logError("[ImageGenerationStudio] generation failed", error);
			} finally {
				if (abortRef.current === controller) {
					abortRef.current = null;
					setRunning(false);
					setProgress(null);
				}
			}
		},
		[ensureModelReady],
	);

	const requestFrom = (
		text: string,
		from: ImageSettings,
	): GenerationRequest => ({
		prompt: text,
		size: from.size,
		n: capabilities.count ? clampImageCount(from.n) : 1,
		quality: capabilities.quality ? from.quality : undefined,
		seed: capabilities.seed && from.seed ? Number(from.seed) : undefined,
	});

	const submit = () => {
		const text = prompt.trim();
		if (!text || running) return;
		setPrompt("");
		const files = attachments;
		clearAttachments();
		void run({ ...requestFrom(text, settings), attachments: files });
	};

	const stop = () => abortRef.current?.abort();

	const reuse = (item: StudioItem) => {
		setPrompt(item.content);
		setSettings((current) =>
			settingsFromParams(item.generation.params ?? {}, current, capabilities),
		);
		composerRef.current?.focus();
		if (attachedImagesOf(item).length > 0) {
			void filesOfItem(item)
				.then((files) => attach(files, true))
				.catch((error) =>
					logError("[ImageGenerationStudio] could not read the images", error),
				);
		}
	};

	const retry = (item: StudioItem) => {
		if (running) return;
		const from = settingsFromParams(
			item.generation.params ?? {},
			settings,
			capabilities,
		);
		const feedback = feedbackOf(item);
		if (!feedback && attachedImagesOf(item).length > 0) {
			// Its images are read before the failed item, and its files, go.
			void filesOfItem(item)
				.then((files) => {
					void run({ ...requestFrom(item.content, from), attachments: files });
					void deleteItem(mode, item.id);
				})
				.catch((error) =>
					logError("[ImageGenerationStudio] could not read the images", error),
				);
			return;
		}
		// A follow-up is made again from its source and notes, with new copies of
		// the files it sends: the failed item's own are deleted with it.
		void run({
			...requestFrom(item.content, from),
			...(feedback
				? {
						feedback: {
							source: feedback.source,
							basePrompt: feedback.basePrompt,
							comments: feedback.comments,
						},
					}
				: {}),
		});
		// The retry replaces the failed card rather than stacking a second one.
		void deleteItem(mode, item.id);
	};

	const openImage = (itemId: string, index: number, withComments = false) => {
		const position = galleryImages.findIndex(
			(image) => image.itemId === itemId && image.index === index,
		);
		if (position < 0) return;
		setCommenting(withComments);
		setLightboxIndex(position);
	};

	const itemOf = (itemId: string) => items.find((item) => item.id === itemId);

	const setImageComments = (
		itemId: string,
		imagePath: string,
		comments: readonly ImageComment[],
	) => {
		const item = itemOf(itemId);
		if (!item) return;
		void updateItem(mode, item.id, {
			parts: withComments(item.parts, imagePath, comments),
		});
	};

	// The notes move to the follow-up they produce, so the source image is left
	// with none and pressing again does not send them twice.
	const generateNext = (image: {
		itemId: string;
		path: string;
		mimeType: string;
	}) => {
		const item = itemOf(image.itemId);
		if (!item || running) return;
		const comments = commentsOf(item, image.path);
		if (comments.length === 0) return;
		const from = settingsFromParams(
			item.generation.params ?? {},
			settings,
			capabilities,
		);
		setImageComments(item.id, image.path, []);
		setLightboxIndex(null);
		setCommenting(false);
		void run({
			...requestFrom(item.content, { ...from, n: 1 }),
			feedback: {
				source: { itemId: item.id, path: image.path, mimeType: image.mimeType },
				basePrompt: basePromptOf(item),
				comments,
			},
		});
	};

	const commentingProps: ImageCommenting = {
		commentsFor: (image) => {
			const item = itemOf(image.itemId);
			return item ? commentsOf(item, image.path) : [];
		},
		onCommentsChange: (image, comments) =>
			setImageComments(image.itemId, image.path, comments),
		onGenerateNext: generateNext,
		busy: running,
	};

	const generateNextFromCard = (itemId: string, index: number) => {
		const image = galleryImages.find(
			(candidate) => candidate.itemId === itemId && candidate.index === index,
		);
		if (image) generateNext(image);
	};

	return (
		<section
			className={cn(
				"relative flex h-full min-h-0 flex-col",
				dragging && "ring-2 ring-inset ring-primary/60",
			)}
			data-studio-canvas={mode}
			aria-label={t("canvas.label", { defaultValue: "Create images" })}
			data-image-dragging={dragging || undefined}
			onDragOver={(event) => {
				if (!Array.from(event.dataTransfer.types).includes("Files")) return;
				event.preventDefault();
				event.dataTransfer.dropEffect = "copy";
				setDragging(true);
			}}
			onDragLeave={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
					setDragging(false);
				}
			}}
			onDrop={(event) => {
				if (!Array.from(event.dataTransfer.types).includes("Files")) return;
				event.preventDefault();
				setDragging(false);
				const files = Array.from(event.dataTransfer.files);
				if (files.length) attach(files);
			}}
		>
			<StudioThread empty={items.length === 0} isNarrow={isNarrow}>
				{items.length === 0 ? (
					<WorkspaceEmptyState
						compact={isNarrow}
						visual={
							<WorkspaceEmptyVisual icon={ImageIcon} compact={isNarrow} />
						}
						title={t("empty.title", { defaultValue: "Create an image" })}
						description={t("empty.description", {
							defaultValue:
								"Describe the subject, the setting and the style. Specific prompts give better images.",
						})}
						suggestions={EXAMPLES.map((example) => {
							const text = t(`examples.${example.key}`, {
								defaultValue: example.defaultValue,
							});
							return {
								key: example.key,
								label: text,
								icon: Sparkles,
								attributes: { "data-image-example": example.key },
								onSelect: () => {
									setPrompt(text);
									composerRef.current?.focus();
								},
							};
						})}
						columns={2}
					/>
				) : (
					items.map((item) => (
						<ImageGenerationCard
							key={item.id}
							item={item}
							isNarrow={isNarrow}
							progress={
								running && item.id === newestRunningId ? progress : undefined
							}
							onOpenImage={(itemId, index) => openImage(itemId, index)}
							onCommentImage={(itemId, index) => openImage(itemId, index, true)}
							onGenerateNext={generateNextFromCard}
							busy={running}
							onReuse={reuse}
							onRetry={retry}
							onDelete={(target) => void deleteItem(mode, target.id)}
						/>
					))
				)}
			</StudioThread>

			<ImagePromptComposer
				ref={composerRef}
				prompt={prompt}
				onPromptChange={setPrompt}
				settings={settings}
				onSettingsChange={setSettings}
				capabilities={capabilities}
				running={running}
				onSubmit={submit}
				onStop={stop}
				isNarrow={isNarrow}
				attachments={attachments}
				onAttach={attach}
				onRemoveAttachment={removeAttachment}
				attachError={attachError}
			/>

			<ImageLightbox
				images={galleryImages}
				openIndex={lightboxIndex}
				onIndexChange={setLightboxIndex}
				commenting={commenting}
				onCommentingChange={setCommenting}
				comments={commentingProps}
			/>
		</section>
	);
};
