import { ArrowUpRight } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/main/components/ui/card";
import { providerLabel, shortModelName } from "@/main/hooks/selectable-model";
import { STUDIO_MODE_DESCRIPTORS } from "@/main/modules/studio/studio-modes";
import { useWorkspaceModeStore } from "@/main/stores/workspace-mode";
import { serviceManager } from "@/services";
import type { CurrentModelsByCategory } from "@/services/llm/interfaces/llm-service.interface";
import {
	isMediaCategory,
	type WorkspaceMode,
} from "@/services/llm/interfaces/model-category";

interface StudioModelsCardProps {
	onBrowseCategory: (category: WorkspaceMode) => void;
}

/**
 * The model behind each studio, next to the chat model card. Each row opens
 * its studio; an empty row jumps to that kind of model in the catalog.
 */
export const StudioModelsCard: React.FC<StudioModelsCardProps> = ({
	onBrowseCategory,
}) => {
	const { t } = useTranslation("llm");
	const { t: tStudio } = useTranslation("studio");
	const setWorkspaceMode = useWorkspaceModeStore((state) => state.setMode);
	const [selections, setSelections] = useState<CurrentModelsByCategory>({});

	useEffect(() => {
		let active = true;
		const llm = serviceManager.llmService;
		void llm.getCurrentModels().then((value) => {
			if (active) setSelections(value);
		});
		const unsubscribe = llm.onCurrentModelsChange((category, model) => {
			if (!active || !isMediaCategory(category)) return;
			setSelections((previous) => {
				const next = { ...previous };
				if (model) next[category] = model;
				else delete next[category];
				return next;
			});
		});
		return () => {
			active = false;
			unsubscribe();
		};
	}, []);

	return (
		<Card className="rounded-none md:rounded-lg" data-studio-models-card>
			<CardHeader className="p-3 pb-0">
				<CardTitle className="text-lg">
					{t("studioModels.title", { defaultValue: "Studio models" })}
				</CardTitle>
				<CardDescription>
					{t("studioModels.description", {
						defaultValue:
							"The model each studio uses. Only one on-device model is kept in memory at a time.",
					})}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-1 p-3">
				{STUDIO_MODE_DESCRIPTORS.filter((entry) =>
					isMediaCategory(entry.mode),
				).map((entry) => {
					const category = entry.mode;
					const Icon = entry.icon;
					const selection = isMediaCategory(category)
						? selections[category]
						: undefined;
					return (
						<button
							key={category}
							type="button"
							onClick={() =>
								selection
									? setWorkspaceMode(category)
									: onBrowseCategory(category)
							}
							className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
							data-studio-model-row={category}
							data-current-media-model-id={selection?.modelId ?? ""}
						>
							<Icon size={14} className="shrink-0 text-muted-foreground" />
							<span className="w-20 shrink-0 text-xs text-muted-foreground">
								{tStudio(`modes.${category}.label`, {
									defaultValue: entry.label,
								})}
							</span>
							<span className="min-w-0 flex-1 truncate text-xs font-medium">
								{selection
									? `${shortModelName({ id: selection.modelId, name: selection.modelId })} · ${providerLabel(selection.provider)}`
									: t("studioModels.none", {
											defaultValue: "Not set — browse",
										})}
							</span>
							<ArrowUpRight
								size={12}
								className="shrink-0 text-muted-foreground"
							/>
						</button>
					);
				})}
			</CardContent>
		</Card>
	);
};
