import { Check, ChevronDown, Library, Loader2, Share2 } from "lucide-react";
import type React from "react";
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
import { useFolderIndex } from "./FolderIndexContext";
import { IndexTypeBadge } from "./IndexTypeBadge";

/**
 * The header's Indexes menu: index types for the folder you are in (the
 * open file's folder when a file is open), and the settings for all folders.
 */
export const FolderIndexesButton: React.FC<{
	className?: string;
	compact?: boolean;
}> = ({ className, compact = false }) => {
	const { t } = useTranslation("documents");
	const index = useFolderIndex();
	if (!index) return null;
	const count = (index.state?.folders ?? []).filter(
		(folder) => folder.on.length,
	).length;
	const folder = index.currentFolder;
	const folderName = folder === "/" ? t("title") : folder.split("/").pop();
	const effective = index.effectiveAt(folder);
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className={cn("h-8 flex-shrink-0 gap-1.5 px-2.5 text-xs", className)}
					title={t("folderIndex.buttonHint")}
				>
					{index.isRunning() ? (
						<Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600 motion-reduce:animate-none dark:text-sky-400" />
					) : (
						<Library className="h-3.5 w-3.5 text-sky-600 dark:text-sky-400" />
					)}
					<span
						className={
							compact ? "hidden min-[520px]:inline" : "hidden sm:inline"
						}
					>
						{t("folderIndex.title")}
					</span>
					{count > 0 && (
						<span className="rounded-full bg-sky-500/15 px-1.5 text-[10px] text-sky-700 dark:text-sky-300">
							{count}
						</span>
					)}
					<ChevronDown className="h-3 w-3 opacity-60" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72">
				<DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
					{t("folderIndex.perFolder", { folder: folderName })}
				</DropdownMenuLabel>
				{index.types.map((type) => {
					const on = effective.includes(type.id);
					return (
						<DropdownMenuItem
							key={type.id}
							title={type.beta ? t("folderIndex.betaNote") : undefined}
							onClick={() => void index.setFolderType(folder, type.id, !on)}
						>
							<span className="mr-2 flex h-4 w-4 items-center justify-center">
								{on && <Check className="h-3.5 w-3.5" />}
							</span>
							<IndexTypeBadge
								label={type.label}
								beta={type.beta}
								className="mr-2"
							/>
							{on
								? t("folderIndex.removeFrom", { folder: folderName })
								: t("folderIndex.addTo", { folder: folderName })}
						</DropdownMenuItem>
					);
				})}
				{effective.includes("okf") && (
					<DropdownMenuItem onClick={() => index.openGraph(folder)}>
						<Share2 className="mr-2 h-4 w-4" />
						{t("folderIndex.graph.open")}
					</DropdownMenuItem>
				)}
				<DropdownMenuSeparator />
				<DropdownMenuItem onClick={() => index.setDialogOpen(true)}>
					{t("folderIndex.manage")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

/** The sidebar's way into Files › Indexes, under the folder tree. */
export const FolderIndexesSidebarLink: React.FC = () => {
	const { t } = useTranslation("documents");
	const index = useFolderIndex();
	if (!index) return null;
	const count = (index.state?.folders ?? []).filter(
		(folder) => folder.on.length,
	).length;
	return (
		<button
			type="button"
			onClick={() => index.setDialogOpen(true)}
			className="flex w-full flex-shrink-0 items-center gap-1.5 border-t px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
		>
			<Library className="h-3 w-3 flex-shrink-0 text-sky-600 dark:text-sky-400" />
			{t("folderIndex.title")}
			{count > 0 && (
				<span className="ml-auto rounded-full bg-sky-500/15 px-1.5 text-[10px] font-medium normal-case tracking-normal text-sky-700 dark:text-sky-300">
					{t("folderIndex.folderCount", { count })}
				</span>
			)}
		</button>
	);
};
