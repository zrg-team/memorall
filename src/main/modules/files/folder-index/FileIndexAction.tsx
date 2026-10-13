import { IdCard, Library, Loader2, Layers } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { parentFolder } from "@/services/folder-index/index-config";
import { useFolderIndex } from "./FolderIndexContext";
import { IndexTypeBadge } from "./IndexTypeBadge";
import { EmbeddingSearchDialog } from "./EmbeddingSearchDialog";

const FileEmbeddingAction: React.FC<{
	filePath: string;
	iconOnly?: boolean;
}> = ({ filePath, iconOnly = false }) => {
	const { t } = useTranslation("documents");
	const index = useFolderIndex();
	const [open, setOpen] = React.useState(false);
	return (
		<>
			<Button
				variant="outline"
				size="sm"
				className={cn("gap-1.5", iconOnly ? "h-7 w-7 p-0" : "h-8 px-3")}
				title={t("folderIndex.embedding.fileChunks")}
				onClick={() => setOpen(true)}
			>
				<Layers className="h-4 w-4 text-sky-500" />
				{!iconOnly && t("folderIndex.embedding.fileChunks")}
			</Button>
			<EmbeddingSearchDialog
				open={open}
				onOpenChange={setOpen}
				folderPath={parentFolder(filePath) ?? "/"}
				filePath={filePath}
				onOpenFile={index?.openFile}
			/>
		</>
	);
};

/**
 * The index action of an open file. Indexes are kept per folder, so a file
 * without one offers to index its folder; a file with a card opens it.
 */
export const FileIndexAction: React.FC<{
	filePath: string;
	iconOnly?: boolean;
}> = ({ filePath, iconOnly = false }) => {
	const { t } = useTranslation("documents");
	const index = useFolderIndex();
	const folder = parentFolder(filePath) ?? "/";
	const effective = index?.effectiveAt(folder) ?? [];
	const effectiveKey = effective.join(",");

	// biome-ignore lint/correctness/useExhaustiveDependencies: entries load once per folder and set of types, not on every state poll.
	React.useEffect(() => {
		if (index && effectiveKey) index.loadEntries(folder);
	}, [folder, effectiveKey]);

	if (!index?.types.length) return null;
	const folderName = folder === "/" ? t("title") : folder.split("/").pop();
	const fileEntries = index.entriesOf(folder)?.byFile.get(filePath) ?? [];
	const hasCard = fileEntries.some((entry) => entry.typeId === "okf");
	const hasEmbeddings = fileEntries.some(
		(entry) => entry.typeId === "embeddings",
	);
	const label = (text: string) =>
		iconOnly ? null : <span className="hidden sm:inline">{text}</span>;
	const buttonClass = cn("gap-1.5", iconOnly ? "h-7 w-7 p-0" : "h-8 px-3");

	if (hasCard) {
		return (
			<>
				<Button
					variant="outline"
					size="sm"
					className={buttonClass}
					title={t("folderIndex.card.title")}
					onClick={() => index.openCard(filePath)}
				>
					<IdCard className="h-4 w-4 text-sky-600 dark:text-sky-400" />
					{label(t("folderIndex.card.open"))}
				</Button>
				{hasEmbeddings && (
					<FileEmbeddingAction filePath={filePath} iconOnly={iconOnly} />
				)}
			</>
		);
	}
	if (hasEmbeddings)
		return <FileEmbeddingAction filePath={filePath} iconOnly={iconOnly} />;

	if (effective.length) {
		// The folder is indexed but this file has no entry yet (being indexed,
		// or skipped by a rule): say which, and offer the settings.
		const busy = index.isRunning();
		return (
			<Button
				variant="outline"
				size="sm"
				className={buttonClass}
				title={busy ? t("folderIndex.indexing") : t("folderIndex.fileSkipped")}
				onClick={() => index.setDialogOpen(true)}
			>
				{busy ? (
					<Loader2 className="h-4 w-4 animate-spin text-sky-600 motion-reduce:animate-none dark:text-sky-400" />
				) : (
					<Library className="h-4 w-4 text-muted-foreground" />
				)}
				{label(busy ? t("folderIndex.indexing") : t("folderIndex.noCard"))}
			</Button>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="outline"
					size="sm"
					className={buttonClass}
					title={t("folderIndex.indexFolderHint", { folder: folderName })}
				>
					<Library className="h-4 w-4 text-sky-600 dark:text-sky-400" />
					{label(t("folderIndex.indexAction"))}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72">
				<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
					{t("folderIndex.perFolder", { folder: folderName })}
				</DropdownMenuLabel>
				{index.types.map((type) => (
					<DropdownMenuItem
						key={type.id}
						title={type.beta ? t("folderIndex.betaNote") : undefined}
						onClick={() => void index.setFolderType(folder, type.id, true)}
					>
						<IndexTypeBadge
							label={type.label}
							beta={type.beta}
							className="mr-2"
						/>
						{t("folderIndex.addTo", { folder: folderName })}
					</DropdownMenuItem>
				))}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => index.setDialogOpen(true)}>
					{t("folderIndex.manage")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};
