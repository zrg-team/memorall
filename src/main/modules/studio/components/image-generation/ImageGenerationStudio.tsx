import { ImageIcon, Sparkles } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	WorkspaceEmptyState,
	WorkspaceEmptyVisual,
} from "@/main/components/molecules/WorkspaceEmptyState";
import { useStudioStore } from "@/main/stores/studio";
import type { ImageComment, StudioItem } from "@/types/studio";
import { logError } from "@/utils/logger";
import { generateImages, isCancellation } from "../../services/studio-service";
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
}

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
	const abortRef = useRef<AbortController | null>(null);
	const composerRef = useRef<ImagePromptComposerHandle>(null);

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
				await generateImages({
					model: ready,
					prompt: follow?.prompt ?? request.prompt,
					references: follow?.references,
					mask: follow?.mask,
					inputParts: follow?.inputParts,
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
		void run(requestFrom(text, settings));
	};

	const stop = () => abortRef.current?.abort();

	const reuse = (item: StudioItem) => {
		setPrompt(item.content);
		setSettings((current) =>
			settingsFromParams(item.generation.params ?? {}, current, capabilities),
		);
		composerRef.current?.focus();
	};

	const retry = (item: StudioItem) => {
		if (running) return;
		const from = settingsFromParams(
			item.generation.params ?? {},
			settings,
			capabilities,
		);
		const feedback = feedbackOf(item);
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
		<div
			className="relative flex h-full min-h-0 flex-col"
			data-studio-canvas={mode}
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
			/>

			<ImageLightbox
				images={galleryImages}
				openIndex={lightboxIndex}
				onIndexChange={setLightboxIndex}
				commenting={commenting}
				onCommentingChange={setCommenting}
				comments={commentingProps}
			/>
		</div>
	);
};
