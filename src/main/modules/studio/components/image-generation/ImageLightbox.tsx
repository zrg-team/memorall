import { ChevronLeft, ChevronRight, MessageSquarePlus } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/main/components/ui/dialog";
import type { ImageComment, ImageRegion } from "@/types/studio";
import { StoredImage } from "../shared/StoredImage";
import { CopyTextButton, DownloadImageLink } from "./ImageActions";
import { ImageCommentLayer, ImageCommentPanel } from "./ImageComments";
import { downloadFileName } from "./image-generation-options";

export interface GalleryImage {
	/** Unique across the session: item id + index. */
	key: string;
	itemId: string;
	path: string;
	mimeType: string;
	prompt: string;
	/** Position inside its generation, for download names. */
	index: number;
}

export interface ImageCommenting {
	commentsFor: (image: GalleryImage) => ImageComment[];
	onCommentsChange: (image: GalleryImage, comments: ImageComment[]) => void;
	onGenerateNext: (image: GalleryImage) => void;
	/** An image is being generated. */
	busy: boolean;
}

interface ImageLightboxProps {
	images: GalleryImage[];
	/** Index into `images`, or null when closed. */
	openIndex: number | null;
	onIndexChange: (index: number | null) => void;
	/** Show the comment panel. */
	commenting: boolean;
	onCommentingChange: (commenting: boolean) => void;
	comments: ImageCommenting;
}

const isTyping = (target: EventTarget) =>
	target instanceof HTMLElement &&
	(target.isContentEditable ||
		/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/**
 * Full-size view of the session's images, where they are also commented on.
 *
 * Browsing is across the whole session rather than one generation: comparing
 * variations of a prompt is the main reason to open a lightbox at all.
 */
export const ImageLightbox: React.FC<ImageLightboxProps> = ({
	images,
	openIndex,
	onIndexChange,
	commenting,
	onCommentingChange,
	comments,
}) => {
	const { t } = useTranslation("studioImage");
	const index =
		openIndex === null || images.length === 0
			? null
			: Math.min(Math.max(openIndex, 0), images.length - 1);
	const image = index === null ? null : images[index];
	const hasMany = images.length > 1;
	const [pending, setPending] = useState<ImageRegion | null>(null);
	const [highlighted, setHighlighted] = useState<string | null>(null);
	const imageComments = image ? comments.commentsFor(image) : [];

	// A selection belongs to the image it was drawn on.
	const imageKey = image?.key;
	useEffect(() => {
		void imageKey;
		setPending(null);
		setHighlighted(null);
	}, [imageKey]);

	const go = (delta: number) => {
		if (index === null || !hasMany) return;
		onIndexChange((index + delta + images.length) % images.length);
	};

	return (
		<Dialog
			open={image !== null}
			onOpenChange={(open) => {
				if (!open) onIndexChange(null);
			}}
		>
			<DialogContent
				className={cn(
					"flex max-h-[96vh] w-[calc(100vw-1rem)] flex-col gap-2 border-border/60 p-2 sm:p-3",
					commenting ? "max-w-6xl" : "max-w-5xl",
				)}
				data-image-lightbox
				onKeyDown={(event) => {
					if (isTyping(event.target)) return;
					if (event.key === "ArrowLeft") {
						event.preventDefault();
						go(-1);
					} else if (event.key === "ArrowRight") {
						event.preventDefault();
						go(1);
					}
				}}
			>
				{image ? (
					<>
						<DialogTitle className="sr-only">
							{t("lightbox.title", { defaultValue: "Image" })}
						</DialogTitle>
						<DialogDescription className="sr-only">
							{image.prompt}
						</DialogDescription>
						<div
							className={cn(
								"mt-8 flex min-h-0 flex-1 gap-3",
								commenting ? "flex-col md:flex-row" : "flex-col",
							)}
						>
							<div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-muted/40">
								<StoredImage
									key={image.key}
									path={image.path}
									mimeType={image.mimeType}
									alt={image.prompt}
									className={cn(
										"w-auto max-w-full object-contain",
										commenting
											? "max-h-[45vh] md:max-h-[80vh]"
											: "max-h-[80vh]",
									)}
									placeholderClassName="h-64 w-full"
									draggable={false}
									data-lightbox-image={image.path}
								/>
								<ImageCommentLayer
									comments={imageComments}
									active={commenting}
									pending={pending}
									onPendingChange={setPending}
									highlightedId={highlighted}
								/>
								{hasMany ? (
									<>
										<Button
											type="button"
											variant="secondary"
											size="icon"
											className="absolute left-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full bg-background/80 shadow"
											onClick={() => go(-1)}
											aria-label={t("lightbox.previous", {
												defaultValue: "Previous image",
											})}
											data-lightbox-previous
										>
											<ChevronLeft size={18} />
										</Button>
										<Button
											type="button"
											variant="secondary"
											size="icon"
											className="absolute right-2 top-1/2 h-9 w-9 -translate-y-1/2 rounded-full bg-background/80 shadow"
											onClick={() => go(1)}
											aria-label={t("lightbox.next", {
												defaultValue: "Next image",
											})}
											data-lightbox-next
										>
											<ChevronRight size={18} />
										</Button>
									</>
								) : null}
							</div>
							{commenting ? (
								<ImageCommentPanel
									key={image.key}
									className="max-h-[40vh] w-full shrink-0 md:max-h-none md:w-72"
									comments={imageComments}
									onCommentsChange={(next) =>
										comments.onCommentsChange(image, next)
									}
									pending={pending}
									onClearPending={() => setPending(null)}
									onHighlight={setHighlighted}
									onGenerate={() => comments.onGenerateNext(image)}
									busy={comments.busy}
								/>
							) : null}
						</div>
						<div className="flex min-w-0 items-center gap-2">
							<p
								className="line-clamp-2 min-w-0 flex-1 text-xs text-muted-foreground"
								title={image.prompt}
							>
								{image.prompt}
							</p>
							{hasMany && index !== null ? (
								<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
									{t("lightbox.position", {
										index: index + 1,
										total: images.length,
										defaultValue: `${index + 1} / ${images.length}`,
									})}
								</span>
							) : null}
							<Button
								type="button"
								variant={commenting ? "secondary" : "ghost"}
								size="sm"
								className="h-7 shrink-0 gap-1 px-2 text-xs"
								onClick={() => onCommentingChange(!commenting)}
								aria-pressed={commenting}
								data-image-comment-toggle
							>
								<MessageSquarePlus size={14} />
								{t("comments.toggle", { defaultValue: "Comment" })}
								{imageComments.length > 0 ? (
									<span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-semibold tabular-nums text-black">
										{imageComments.length}
									</span>
								) : null}
							</Button>
							<CopyTextButton
								text={image.prompt}
								label={t("card.copyPrompt", { defaultValue: "Copy prompt" })}
							/>
							<DownloadImageLink
								path={image.path}
								mimeType={image.mimeType}
								fileName={downloadFileName(
									image.prompt,
									image.mimeType,
									String(image.index + 1),
								)}
							/>
						</div>
					</>
				) : null}
			</DialogContent>
		</Dialog>
	);
};
