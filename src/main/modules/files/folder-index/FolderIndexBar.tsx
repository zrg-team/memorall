import {
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

/**
 * Above a folder's files when the folder has an index: which types, how many
 * files have an entry, and quick actions. Also loads the folder's entries for
 * the list.
 */
export const FolderIndexBar: React.FC<{
	folderPath: string;
	fileCount: number;
}> = ({ folderPath, fileCount }) => {
	const { t } = useTranslation("documents");
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
	const activity = Object.entries(index.state?.activity ?? {}).filter(
		([key]) => {
			const root = key.slice(key.indexOf(":") + 1);
			return isSameOrInside(path, root) || isSameOrInside(root, path);
		},
	);
	const checking =
		activity.length > 0 && activity.every(([, phase]) => phase === "checking");

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
			<span className="min-w-0 flex-1 text-muted-foreground">
				{busy ? (
					<span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
						<Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" />
						{t(checking ? "folderIndex.checking" : "folderIndex.indexing")}
					</span>
				) : (
					t("folderIndex.barStatus", { count: withEntry, total: fileCount })
				)}
			</span>
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
