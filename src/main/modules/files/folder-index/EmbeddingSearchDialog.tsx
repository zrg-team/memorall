import { FileText, Image, Loader2, Music, Search, Video } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { cn } from "@/lib/utils";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { folderIndexClient } from "@/services/folder-index/folder-index-client";
import {
	chunkLocationLabel,
	type ChunkKind,
	type EmbeddingChunk,
} from "@/services/folder-index/embedding/types";

type Result = Omit<EmbeddingChunk, "vector"> & { score?: number };
const icons = { text: FileText, image: Image, audio: Music, video: Video };

/** Search results retain source locations and play the actual matched media segment. */
export const EmbeddingSearchDialog: React.FC<{
	open: boolean;
	onOpenChange: (open: boolean) => void;
	folderPath: string;
	filePath?: string;
	onOpenFile?: (path: string) => void;
	onOpenCard?: (path: string) => void;
}> = ({ open, onOpenChange, folderPath, filePath, onOpenFile, onOpenCard }) => {
	const { t } = useTranslation("documents");
	const [query, setQuery] = React.useState("");
	const [kind, setKind] = React.useState<ChunkKind | "">("");
	const [results, setResults] = React.useState<Result[]>([]);
	const [selected, setSelected] = React.useState<Result | null>(null);
	const [busy, setBusy] = React.useState(false);
	const [searched, setSearched] = React.useState<number | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [preview, setPreview] = React.useState<string | null>(null);
	const [previewError, setPreviewError] = React.useState<string | null>(null);
	const requestId = React.useRef(0);

	React.useEffect(() => {
		const id = ++requestId.current;
		setResults([]);
		setSelected(null);
		setError(null);
		setSearched(null);
		setBusy(false);
		if (open && filePath) {
			setBusy(true);
			void folderIndexClient
				.request("embedding.chunks", { path: filePath })
				.then((chunks) => {
					if (id !== requestId.current) return;
					setResults(chunks);
					setSelected(chunks[0] ?? null);
					setSearched(chunks.length);
				})
				.catch((value: unknown) => {
					if (id === requestId.current)
						setError(value instanceof Error ? value.message : String(value));
				})
				.finally(() => {
					if (id === requestId.current) setBusy(false);
				});
		}
		return () => {
			requestId.current++;
		};
	}, [open, filePath, folderPath]);

	React.useEffect(() => {
		setPreview(null);
		setPreviewError(null);
		if (!open || !selected || selected.kind === "text") return;
		let cancelled = false;
		let url: string | null = null;
		void Promise.all([
			documentFileSystemService.readFile(selected.path),
			documentFileSystemService.resolveNode(selected.path),
		])
			.then(([bytes, node]) => {
				if (cancelled) return;
				const mime = node?.file?.mimeType ?? "application/octet-stream";
				url = URL.createObjectURL(
					new Blob([new Uint8Array(bytes).buffer], { type: mime }),
				);
				setPreview(url);
			})
			.catch((value: unknown) => {
				if (!cancelled)
					setPreviewError(
						value instanceof Error ? value.message : String(value),
					);
			});
		return () => {
			cancelled = true;
			if (url) URL.revokeObjectURL(url);
		};
	}, [open, selected]);

	const search = async (event: React.FormEvent) => {
		event.preventDefault();
		if (!query.trim() || busy) return;
		const id = ++requestId.current;
		setBusy(true);
		setError(null);
		try {
			const result = await folderIndexClient.request("embedding.search", {
				query,
				folder: folderPath,
				...(kind ? { kind } : {}),
				limit: 20,
			});
			if (id !== requestId.current) return;
			setResults(result.hits);
			setSelected(result.hits[0] ?? null);
			setSearched(result.searched);
			if (result.truncated) setError(t("folderIndex.embedding.truncated"));
		} catch (value) {
			if (id === requestId.current)
				setError(value instanceof Error ? value.message : String(value));
		} finally {
			if (id === requestId.current) setBusy(false);
		}
	};
	const openSource = (action: ((path: string) => void) | undefined) => {
		if (!selected || !action) return;
		onOpenChange(false);
		action(selected.path);
	};
	const mediaProps = {
		controls: true,
		onLoadedMetadata: (event: React.SyntheticEvent<HTMLMediaElement>) => {
			event.currentTarget.currentTime = selected?.location.startSeconds ?? 0;
		},
		onTimeUpdate: (event: React.SyntheticEvent<HTMLMediaElement>) => {
			const end = selected?.location.endSeconds;
			if (end !== undefined && event.currentTarget.currentTime >= end) {
				event.currentTarget.pause();
				event.currentTarget.currentTime = selected?.location.startSeconds ?? 0;
			}
		},
		onError: () => setPreviewError(t("folderIndex.embedding.previewError")),
	};
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="flex max-h-[88vh] flex-col sm:max-w-5xl">
				<DialogHeader>
					<DialogTitle>
						{t(
							filePath
								? "folderIndex.embedding.fileChunks"
								: "folderIndex.embedding.search",
						)}
					</DialogTitle>
					<DialogDescription>
						EmbeddingGemma 2 · 768d · {t("folderIndex.embedding.local")}
						<br />
						{filePath ?? folderPath}
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={search} className="flex flex-wrap gap-2">
					<Input
						aria-label={t("folderIndex.embedding.query")}
						className="min-w-40 flex-1"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						maxLength={2000}
						placeholder={t("folderIndex.embedding.placeholder")}
					/>
					<select
						aria-label={t("folderIndex.embedding.kind")}
						className="rounded-md border bg-background px-2 text-xs"
						value={kind}
						onChange={(event) => setKind(event.target.value as ChunkKind | "")}
					>
						<option value="">{t("folderIndex.embedding.all")}</option>
						{(["text", "image", "audio", "video"] as const).map((value) => (
							<option key={value} value={value}>
								{t(`folderIndex.embedding.${value}`)}
							</option>
						))}
					</select>
					<Button
						type="submit"
						disabled={busy || !query.trim()}
						className="gap-2"
					>
						{busy ? (
							<Loader2 className="h-4 w-4 animate-spin" />
						) : (
							<Search className="h-4 w-4" />
						)}
						{t("folderIndex.embedding.search")}
					</Button>
				</form>
				{error && (
					<p role="alert" className="text-xs text-destructive">
						{error}
					</p>
				)}
				{searched !== null && (
					<p className="text-xs text-muted-foreground">
						{t("folderIndex.embedding.results", {
							count: results.length,
							searched,
						})}
					</p>
				)}
				{results.some((hit) => hit.score !== undefined) && (
					<p className="text-[11px] text-muted-foreground">
						{t("folderIndex.embedding.cosine")}
					</p>
				)}
				<div className="grid min-h-0 gap-4 overflow-y-auto md:grid-cols-2">
					<div className="space-y-2">
						{results.map((hit) => {
							const Icon = icons[hit.kind];
							return (
								<button
									type="button"
									key={hit.id}
									onClick={() => setSelected(hit)}
									className={cn(
										"w-full rounded-md border p-3 text-left",
										selected?.id === hit.id && "border-sky-500 bg-sky-500/5",
									)}
								>
									<div className="flex items-center gap-2 text-sm font-medium">
										<Icon className="h-4 w-4 shrink-0 text-sky-500" />
										<span className="min-w-0 flex-1 truncate">{hit.title}</span>
										{hit.score !== undefined && (
											<span
												title={t("folderIndex.embedding.cosine")}
												className="text-xs tabular-nums text-muted-foreground"
											>
												{hit.score.toFixed(3)}
											</span>
										)}
									</div>
									<p className="mt-1 break-all text-[11px] text-muted-foreground">
										{hit.path}
									</p>
									<p className="mt-2 text-xs">
										{t(`folderIndex.embedding.${hit.kind}`)} ·{" "}
										{chunkLocationLabel(hit.location)}
									</p>
									{hit.text && (
										<p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
											{hit.text}
										</p>
									)}
								</button>
							);
						})}
						{!results.length && (
							<p className="py-10 text-center text-xs text-muted-foreground">
								{busy
									? t("folderIndex.embedding.loading")
									: t(
											searched === null
												? "folderIndex.embedding.hint"
												: "folderIndex.embedding.empty",
										)}
							</p>
						)}
					</div>
					{selected && (
						<div className="min-w-0 space-y-3 rounded-md border p-4">
							<h3 className="break-all text-sm font-medium">
								{selected.title}
							</h3>
							<p className="text-xs text-muted-foreground">
								{chunkLocationLabel(selected.location)}
							</p>
							{selected.text && (
								<p className="whitespace-pre-wrap break-words text-sm">
									{selected.text}
								</p>
							)}
							{preview &&
								selected.kind === "image" &&
								(selected.location.page ? (
									<iframe
										title={selected.title}
										src={`${preview}#page=${selected.location.page}`}
										className="h-72 w-full"
									/>
								) : (
									<img
										src={preview}
										alt={selected.title}
										className="max-h-72 w-full object-contain"
										onError={mediaProps.onError}
									/>
								))}
							{preview && selected.kind === "video" && (
								<video
									key={selected.id}
									src={preview}
									className="w-full rounded-md"
									{...mediaProps}
								/>
							)}
							{preview && selected.kind === "audio" && (
								<audio
									key={selected.id}
									src={preview}
									className="w-full"
									{...mediaProps}
								/>
							)}
							{previewError && (
								<p className="text-xs text-destructive">{previewError}</p>
							)}
							<div className="flex gap-2">
								<Button
									size="sm"
									disabled={!onOpenFile}
									onClick={() => openSource(onOpenFile)}
								>
									{t("folderIndex.embedding.openFile")}
								</Button>
								{onOpenCard && (
									<Button
										size="sm"
										variant="outline"
										onClick={() => openSource(onOpenCard)}
									>
										{t("folderIndex.card.open")}
									</Button>
								)}
							</div>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
};
