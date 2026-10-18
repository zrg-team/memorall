import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Loader2, Play, Square, Search } from "lucide-react";
import { type ModelInfo } from "@/services/llm";
import { serviceManager } from "@/services";
import { DEFAULT_SERVICES } from "@/services/llm/constants";
import { logInfo } from "@/utils/logger";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import type { CurrentModel } from "@/main/hooks/use-current-model";
import type { WorkspaceMode } from "@/services/llm/interfaces/model-category";
import { useWorkspaceModeStore } from "@/main/stores/workspace-mode";

interface LocalModelsListProps {
	localModels: ModelInfo[];
	quickProvider: ServiceProvider;
	loading: boolean;
	current: CurrentModel | null;
	onModelLoaded?: (modelId: string, provider: ServiceProvider) => void;
	category?: WorkspaceMode;
}

export const LocalModelsList: React.FC<LocalModelsListProps> = ({
	localModels,
	quickProvider,
	loading,
	current,
	onModelLoaded,
	category = "chat",
}) => {
	const { t } = useTranslation("llm");
	const setWorkspaceMode = useWorkspaceModeStore((state) => state.setMode);
	const [searchFilter, setSearchFilter] = useState("");

	// Filter models by name
	const filteredModels = useMemo(() => {
		if (!searchFilter.trim()) {
			return localModels;
		}
		const searchLower = searchFilter.toLowerCase();
		return localModels.filter((model) => {
			const name = (model.name || model.id).toLowerCase();
			return name.includes(searchLower);
		});
	}, [localModels, searchFilter]);
	if (localModels.length === 0) {
		return (
			<div className="flex items-center justify-center p-4 border rounded-lg border-dashed">
				<span className="text-sm text-muted-foreground">
					No models available in {quickProvider}. Make sure {quickProvider} is
					running and has models installed.
				</span>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{/* Search filter */}
			<div className="relative">
				<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
				<Input
					type="text"
					placeholder="Filter models by name..."
					value={searchFilter}
					onChange={(e) => setSearchFilter(e.target.value)}
					className="pl-9"
				/>
			</div>

			{/* Models list */}
			{filteredModels.length === 0 ? (
				<div className="flex items-center justify-center p-4 border rounded-lg border-dashed">
					<span className="text-sm text-muted-foreground">
						No models match "{searchFilter}"
					</span>
				</div>
			) : (
				<div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
					{filteredModels.map((model) => {
						const isLoaded =
							serviceManager.llmService.has(quickProvider) &&
							current?.modelId === model.id &&
							current?.provider === quickProvider;
						return (
							<div
								key={model.id}
								className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 transition-colors"
							>
								<div className="flex-1">
									<div className="flex items-center gap-2">
										<div className="font-medium text-sm">
											{model.name || model.id}
										</div>
										{isLoaded && (
											<span className="text-xs text-green-600 font-medium">
												● Loaded
											</span>
										)}
									</div>
									<div className="text-xs text-muted-foreground">
										{quickProvider} model
									</div>
								</div>
								<Button
									size="sm"
									onClick={async () => {
										// Set current model when clicking Use
										// Let LLMService handle the state and notify via events
										const serviceName =
											quickProvider === "openai"
												? DEFAULT_SERVICES.OPENAI
												: quickProvider;
										await serviceManager.llmService.setCurrentModelFor(
											category,
											quickProvider,
											model.id,
											serviceName,
										);
										if (category !== "chat") setWorkspaceMode(category);
										logInfo(`${model.name || model.id} set as current model`);
										onModelLoaded?.(model.id, quickProvider);
									}}
									disabled={loading || isLoaded}
									variant={isLoaded ? "outline" : "default"}
								>
									{loading ? (
										<Loader2 className="w-4 h-4 animate-spin" />
									) : isLoaded ? (
										<>
											<Square className="w-4 h-4" />
											Ready
										</>
									) : (
										<>
											<Play className="w-4 h-4" />
											Use
										</>
									)}
								</Button>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};
