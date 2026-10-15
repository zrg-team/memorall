import { IdCard, Layers, Library, Loader2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { ViewerAction } from "../components/DocumentViewerHeader";
import { parentFolder } from "@/services/folder-index/index-config";
import { EmbeddingSearchDialog } from "./EmbeddingSearchDialog";
import { useFolderIndex } from "./FolderIndexContext";
import { IndexTypeBadge } from "./IndexTypeBadge";

/**
 * The index actions of an open file. Indexes are kept per folder, so a file
 * without one offers to index its folder; a file with a card opens it, and
 * one with embeddings shows its chunks. They come as actions for the file's
 * header to draw (as icons, or in its menu), with the dialog they open.
 */
export const useFileIndexActions = (
	filePath: string,
	enabled = true,
): { actions: ViewerAction[]; dialogs: React.ReactNode } => {
	const { t } = useTranslation("documents");
	const index = useFolderIndex();
	const [chunksOpen, setChunksOpen] = React.useState(false);
	const folder = parentFolder(filePath) ?? "/";
	const effective = index?.effectiveAt(folder) ?? [];
	const effectiveKey = effective.join(",");

	// biome-ignore lint/correctness/useExhaustiveDependencies: entries load once per folder and set of types, not on every state poll.
	React.useEffect(() => {
		if (enabled && index && effectiveKey) index.loadEntries(folder);
	}, [enabled, folder, effectiveKey]);

	if (!enabled || !index?.types.length) return { actions: [], dialogs: null };
	const folderName = folder === "/" ? t("title") : folder.split("/").pop();
	const fileEntries = index.entriesOf(folder)?.byFile.get(filePath) ?? [];
	const hasCard = fileEntries.some((entry) => entry.typeId === "okf");
	const hasEmbeddings = fileEntries.some(
		(entry) => entry.typeId === "embeddings",
	);
	const actions: ViewerAction[] = [];

	if (hasCard)
		actions.push({
			id: "index-card",
			label: t("folderIndex.card.open"),
			hint: t("folderIndex.card.title"),
			icon: <IdCard className="h-4 w-4 text-sky-600 dark:text-sky-400" />,
			onSelect: () => index.openCard(filePath),
		});
	if (hasEmbeddings)
		actions.push({
			id: "index-chunks",
			label: t("folderIndex.embedding.fileChunks"),
			icon: <Layers className="h-4 w-4 text-sky-500" />,
			onSelect: () => setChunksOpen(true),
		});
	if (!hasCard && !hasEmbeddings) {
		if (effective.length) {
			// The folder is indexed but this file has no entry yet (being
			// indexed, or skipped by a rule): say which, and offer the settings.
			const busy = index.isRunning();
			actions.push({
				id: "index-status",
				label: busy ? t("folderIndex.indexing") : t("folderIndex.noCard"),
				hint: busy ? t("folderIndex.indexing") : t("folderIndex.fileSkipped"),
				icon: busy ? (
					<Loader2 className="h-4 w-4 animate-spin text-sky-600 motion-reduce:animate-none dark:text-sky-400" />
				) : (
					<Library className="h-4 w-4 text-muted-foreground" />
				),
				onSelect: () => index.setDialogOpen(true),
			});
		} else {
			actions.push({
				id: "index-folder",
				label: t("folderIndex.indexAction"),
				hint: t("folderIndex.indexFolderHint", { folder: folderName }),
				icon: <Library className="h-4 w-4 text-sky-600 dark:text-sky-400" />,
				choices: [
					...index.types.map((type) => ({
						id: type.id,
						title: type.beta ? t("folderIndex.betaNote") : undefined,
						label: (
							<>
								<IndexTypeBadge
									label={type.label}
									beta={type.beta}
									className="mr-2"
								/>
								{t("folderIndex.addTo", { folder: folderName })}
							</>
						),
						onSelect: () => void index.setFolderType(folder, type.id, true),
					})),
					{
						id: "manage",
						label: t("folderIndex.manage"),
						onSelect: () => index.setDialogOpen(true),
						separated: true,
					},
				],
			});
		}
	}

	return {
		actions,
		dialogs: hasEmbeddings ? (
			<EmbeddingSearchDialog
				open={chunksOpen}
				onOpenChange={setChunksOpen}
				folderPath={folder}
				filePath={filePath}
				onOpenFile={index.openFile}
			/>
		) : null,
	};
};
