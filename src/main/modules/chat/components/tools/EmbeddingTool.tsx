import React, { useEffect, useMemo, useState } from "react";
import { FileText, Image, Music, Video, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { Badge } from "@/main/components/ui/badge";
import { requestAppNavigation } from "@/main/navigation/app-navigation";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { memonFileKind, memonMimeType } from "@/services/memon/file-kinds";
import { chunkLocationLabel } from "@/services/folder-index/embedding/types";
import type { ActionRenderer, MessageActionItem } from "../types";
import {
	parseEmbeddingToolOutput,
	type EmbeddingDisplayHit,
} from "./embedding-tool-output";
import { ToolItemRawIO, ToolSection } from "./ToolCommon";

const ICONS = { text: FileText, image: Image, audio: Music, video: Video };
const openSource = (path: string) =>
	requestAppNavigation({ path: "/files", state: { openDocumentPath: path } });

const ImagePreview: React.FC<{
	hit: EmbeddingDisplayHit;
	attached?: string;
}> = ({ hit, attached }) => {
	const [url, setUrl] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		setUrl(null);
		setFailed(false);
		if (attached || memonFileKind(hit.path) !== "image") return;
		let cancelled = false;
		let objectUrl: string | undefined;
		void documentFileSystemService
			.readFile(hit.path)
			.then((bytes) => {
				if (cancelled) return;
				objectUrl = URL.createObjectURL(
					new Blob([bytes.slice()], { type: memonMimeType(hit.path) }),
				);
				setUrl(objectUrl);
			})
			.catch(() => {});
		return () => {
			cancelled = true;
			if (objectUrl) URL.revokeObjectURL(objectUrl);
		};
	}, [hit.path, attached]);
	return !failed && (attached || url) ? (
		<button
			type="button"
			className="flex h-32 w-full items-center justify-center overflow-hidden rounded-md bg-muted/20"
			onClick={() => openSource(hit.path)}
		>
			<img
				src={attached ?? url!}
				alt={hit.title || hit.path.split("/").at(-1)}
				className="h-full w-full object-contain"
				onError={() => setFailed(true)}
			/>
		</button>
	) : (
		<div className="flex h-20 items-center justify-center rounded-md bg-muted/20">
			<Image className="h-6 w-6 text-muted-foreground" />
		</div>
	);
};

export const EmbeddingToolDetails: React.FC<{ item: MessageActionItem }> = ({
	item,
}) => {
	const { t } = useTranslation("chat");
	const result = useMemo(
		() => parseEmbeddingToolOutput(item.description, item.metadata),
		[item.description, item.metadata],
	);
	const [showAll, setShowAll] = useState(false);
	useEffect(() => setShowAll(false), [item.description]);
	if (!result)
		return (
			<ToolSection>
				<p className="whitespace-pre-wrap break-words text-sm">
					{item.description}
				</p>
				<ToolItemRawIO item={item} />
			</ToolSection>
		);
	const files = new Map<string, { hit: EmbeddingDisplayHit; count: number }>();
	for (const hit of result.hits) {
		const previous = files.get(hit.path);
		if (!previous) files.set(hit.path, { hit, count: 1 });
		else {
			previous.count++;
			if ((hit.score ?? 0) > (previous.hit.score ?? 0)) previous.hit = hit;
		}
	}
	const entries = [...files.values()];
	return (
		<div className="space-y-3">
			<ToolSection>
				<div className="space-y-1">
					{result.query && (
						<p className="break-words text-sm font-medium">{result.query}</p>
					)}
					<p className="text-xs text-muted-foreground">
						{t("embeddingTool.summary", {
							matches: result.matched,
							files: files.size,
							chunks: result.searched,
						})}
					</p>
					{result.truncated && (
						<p className="text-xs text-muted-foreground">
							{t("embeddingTool.truncated")}
						</p>
					)}
				</div>
				{!entries.length && (
					<p className="mt-3 text-sm text-muted-foreground">
						{t("embeddingTool.empty")}
					</p>
				)}
				<div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
					{(showAll ? entries : entries.slice(0, 6)).map(({ hit, count }) => {
						const Icon = ICONS[hit.kind];
						const name = hit.title || hit.path.split("/").at(-1) || hit.path;
						return (
							<div
								key={hit.path}
								className="min-w-0 space-y-2 rounded-lg border border-border/60 bg-muted/10 p-3"
							>
								{hit.kind === "image" && (
									<ImagePreview
										hit={hit}
										attached={result.previewUrls.get(hit.path)}
									/>
								)}
								<div className="flex items-center gap-2">
									<Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
									<span
										className="min-w-0 flex-1 truncate text-sm font-medium"
										title={hit.path}
									>
										{name}
									</span>
									<Badge variant="outline" className="text-[10px]">
										{hit.kind}
									</Badge>
								</div>
								<p
									className="truncate text-[11px] text-muted-foreground"
									title={hit.path}
								>
									{hit.path}
								</p>
								<div className="flex flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
									<span>
										{hit.locationLabel ??
											(Object.keys(hit.location).length
												? chunkLocationLabel(hit.location)
												: t(
														hit.kind === "image"
															? "embeddingTool.wholeImage"
															: "embeddingTool.wholeFile",
													))}
									</span>
									{Number.isFinite(hit.score) && (
										<span title={t("embeddingTool.similarityHint")}>
											{t("embeddingTool.similarity")} {hit.score!.toFixed(3)}
										</span>
									)}
									{count > 1 && (
										<span>{t("embeddingTool.locations", { count })}</span>
									)}
								</div>
								{hit.text && (
									<p className="line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">
										{hit.text}
									</p>
								)}
								<Button
									variant="outline"
									size="sm"
									className="h-7 gap-1.5 text-xs"
									onClick={() => openSource(hit.path)}
								>
									<ExternalLink className="h-3 w-3" />
									{t("embeddingTool.open")}
								</Button>
							</div>
						);
					})}
				</div>
				{entries.length > 6 && (
					<Button
						variant="ghost"
						size="sm"
						className="mt-2 text-xs"
						onClick={() => setShowAll(!showAll)}
					>
						{t(showAll ? "embeddingTool.showLess" : "embeddingTool.showAll", {
							count: entries.length,
						})}
					</Button>
				)}
			</ToolSection>
			<ToolItemRawIO item={item} />
		</div>
	);
};

export const embeddingToolRenderer: ActionRenderer = (item, isOpen) =>
	isOpen ? <EmbeddingToolDetails item={item} /> : null;
