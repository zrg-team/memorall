import {
	Clock,
	Library,
	Loader2,
	RefreshCw,
	Search,
	Settings2,
	Share2,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import {
	normalizeFolderPath,
	isSameOrInside,
} from "@/services/folder-index/index-config";
import { useFolderIndex } from "./FolderIndexContext";
import { IndexTypeBadge } from "./IndexTypeBadge";
import { EmbeddingSearchDialog } from "./EmbeddingSearchDialog";
import { FolderIndexProgress } from "./FolderIndexProgress";

/**
 * Above a folder's files when the folder has an index: which types, how many
 * files have an entry, and quick actions. Also loads the folder's entries for
 * the list.
 */
/** "2 minutes ago", in the reader's language. */
const timeAgo = (iso: string, language: string): string | null => {
	const at = new Date(iso).getTime();
	if (Number.isNaN(at)) return null;
	const seconds = Math.round((at - Date.now()) / 1_000);
	const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
	const abs = Math.abs(seconds);
	if (abs < 60) return format.format(seconds, "second");
	if (abs < 3_600) return format.format(Math.round(seconds / 60), "minute");
	if (abs < 86_400) return format.format(Math.round(seconds / 3_600), "hour");
	return format.format(Math.round(seconds / 86_400), "day");
};

export const FolderIndexBar: React.FC<{
	folderPath: string;
	fileCount: number;
}> = ({ folderPath, fileCount }) => {
	const { t, i18n } = useTranslation("documents");
	const index = useFolderIndex();
	const [searchOpen, setSearchOpen] = React.useState(false);
	const path = normalizeFolderPath(folderPath);
	const effective = index?.effectiveAt(path) ?? [];
	const effectiveKey = effective.join(",");

	// biome-ignore lint/correctness/useExhaustiveDependencies: entries load once per folder and set of types, not on every state poll.
	React.useEffect(() => {
		if (index && effectiveKey) index.loadEntries(path);
	}, [path, effectiveKey]);

	if (!index || !effective.length) return null;
	const entries = index.entriesOf(path);
	const withEntry = entries ? entries.byFile.size : 0;
	const busy = index.isRunning(path);
	const progress = index.progressAt(path);
	const activity = Object.entries(index.state?.activity ?? {}).filter(
		([key]) => {
			const root = key.slice(key.indexOf(":") + 1);
			return isSameOrInside(path, root) || isSameOrInside(root, path);
		},
	);
	const checking =
		activity.length > 0 && activity.every(([, phase]) => phase === "checking");
	const waiting = !busy && index.isWaiting(path);
	const indexedAt = index.lastIndexedAt(path);
	const indexedAgo = indexedAt ? timeAgo(indexedAt, i18n.language) : null;

	return (
		<div className="m-2 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs">
			<Library className="h-4 w-4 text-sky-600 dark:text-sky-400" />
			<span className="flex items-center gap-1">
				{effective.map((typeId) => (
					<IndexTypeBadge
						key={typeId}
						label={
							index.types.find((type) => type.id === typeId)?.label ?? typeId
						}
					/>
				))}
			</span>
			<div className="min-w-0 flex-1 basis-48 text-muted-foreground">
				{busy ? (
					<>
						<span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
							<Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
							{t(checking ? "folderIndex.checking" : "folderIndex.indexing")}
						</span>
						{progress.map((run) => (
							<FolderIndexProgress
								key={run.key}
								progress={run}
								label={
									index.types.find((type) => type.id === run.typeId)?.label ??
									run.typeId
								}
							/>
						))}
					</>
				) : waiting ? (
					<span className="inline-flex items-center gap-1 text-sky-700 dark:text-sky-300">
						<Clock className="h-3 w-3" />
						{t("folderIndex.waiting")}
					</span>
				) : (
					<>
						{fileCount > 0
							? t("folderIndex.barStatus", {
									count: withEntry,
									total: fileCount,
								})
							: t("folderIndex.noDirectFiles")}
						{indexedAgo
							? ` · ${t("folderIndex.indexedAgo", { time: indexedAgo })}`
							: null}
					</>
				)}
			</div>
			{effective.includes("okf") && (
				<Button
					variant="outline"
					size="sm"
					className="h-7 gap-1.5 px-2.5 text-xs"
					onClick={() => index.openGraph(path)}
				>
					<Share2 className="h-3.5 w-3.5" />
					{t("folderIndex.graph.open")}
				</Button>
			)}
			{effective.includes("embeddings") && (
				<>
					<Button
						variant="outline"
						size="sm"
						className="h-7 gap-1.5 px-2.5 text-xs"
						onClick={() => setSearchOpen(true)}
					>
						<Search className="h-3.5 w-3.5" />
						{t("folderIndex.embedding.search")}
					</Button>
					<EmbeddingSearchDialog
						open={searchOpen}
						onOpenChange={setSearchOpen}
						folderPath={path}
						onOpenFile={index.openFile}
						onOpenCard={effective.includes("okf") ? index.openCard : undefined}
					/>
				</>
			)}
			<Button
				variant="outline"
				size="sm"
				className="h-7 gap-1.5 px-2.5 text-xs"
				disabled={busy}
				onClick={() => void index.rebuild(path)}
			>
				<RefreshCw className="h-3.5 w-3.5" />
				{t("folderIndex.rebuild")}
			</Button>
			<Button
				variant="outline"
				size="sm"
				className="h-7 gap-1.5 px-2.5 text-xs"
				onClick={() => index.setDialogOpen(true)}
			>
				<Settings2 className="h-3.5 w-3.5" />
				{t("folderIndex.title")}
			</Button>
		</div>
	);
};
