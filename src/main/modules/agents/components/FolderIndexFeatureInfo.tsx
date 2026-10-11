import { ExternalLink, FolderSearch } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { requestAppNavigation } from "@/main/navigation/app-navigation";
import { TOOL_DISPLAY_INFO } from "@/main/modules/chat/utils/tool-display-info";
import { IndexTypeBadge } from "@/main/modules/files/folder-index/IndexTypeBadge";
import { folderIndexClient } from "@/services/folder-index/folder-index-client";
import { FOLDER_INDEX_TYPES } from "@/services/folder-index/index-types";
import type { FolderIndexStateView } from "@/services/folder-index/operation-types";
import { logError } from "@/utils/logger";

/**
 * Folder Indexes on the agent page: the tools each index type brings, and
 * which folders the agent can search. Folders are chosen in Files › Indexes,
 * never here, so this only shows them and links there.
 */
export const FolderIndexFeatureInfo: React.FC<{ onOpenFiles?: () => void }> = ({
	onOpenFiles,
}) => {
	const { t } = useTranslation("chat");
	const [state, setState] = React.useState<FolderIndexStateView | null>(null);

	React.useEffect(() => {
		let cancelled = false;
		void folderIndexClient
			.request("state.get", {})
			.then((result) => {
				if (!cancelled) setState(result);
			})
			.catch((error: unknown) => {
				logError("[folder-index] Reading index state failed:", error);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	const roots = (state?.folders ?? []).filter(
		(folder) => folder.status.length > 0,
	);
	const cards = roots.reduce(
		(total, folder) =>
			total + folder.status.reduce((sum, status) => sum + status.entries, 0),
		0,
	);

	return (
		<div className="space-y-4">
			{FOLDER_INDEX_TYPES.map((type) => (
				<div key={type.id} className="space-y-2">
					<div className="flex items-center gap-2">
						<p className="text-xs font-semibold text-foreground/80">
							{t("agentSettings.folderIndex.tools")}
						</p>
						<IndexTypeBadge label={type.label} />
					</div>
					<div className="grid grid-cols-1 gap-1.5 min-[520px]:grid-cols-2">
						{type.tools.map((tool) => {
							const info = TOOL_DISPLAY_INFO[tool];
							return (
								<div
									key={tool}
									className="rounded-lg border border-sky-500/40 bg-sky-500/5 px-2.5 py-2"
								>
									<p className="text-[11px] font-medium">
										{info?.name ?? tool}
									</p>
									<p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80">
										{tool}
									</p>
									{info && (
										<p className="mt-0.5 line-clamp-2 text-[10px] text-muted-foreground">
											{info.descriptionKey
												? t(info.descriptionKey, {
														defaultValue: info.description,
													})
												: info.description}
										</p>
									)}
								</div>
							);
						})}
					</div>
				</div>
			))}

			<div className="flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 text-xs">
				<FolderSearch className="h-4 w-4 text-sky-600 dark:text-sky-400" />
				<span className="min-w-0 flex-1">
					{t("agentSettings.folderIndex.searches")}{" "}
					<span className="text-muted-foreground">
						{roots.length
							? t("agentSettings.folderIndex.now", {
									folders: roots.map((folder) => folder.path).join(", "),
									count: cards,
								})
							: t("agentSettings.folderIndex.none")}
					</span>
				</span>
				<Button
					type="button"
					variant="outline"
					size="sm"
					className="h-7 gap-1 px-2.5 text-xs"
					onClick={() => {
						onOpenFiles?.();
						requestAppNavigation({
							path: "/files",
							state: { openFolderIndexes: true },
						});
					}}
				>
					<ExternalLink className="h-3 w-3" />
					{t("agentSettings.folderIndex.open")}
				</Button>
			</div>
			<p className="text-[10px] text-muted-foreground">
				{t("agentSettings.folderIndex.hint")}
			</p>
		</div>
	);
};
