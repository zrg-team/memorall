import React from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Play, Square } from "lucide-react";
import { type ModelInfo } from "@/services/llm";
import { serviceManager } from "@/services";
import { DEFAULT_SERVICES } from "@/services/llm/constants";
import { logInfo } from "@/utils/logger";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import type { CurrentModel } from "@/hooks/use-current-model";

interface LocalModelsListProps {
	localModels: ModelInfo[];
	quickProvider: ServiceProvider;
	loading: boolean;
	current: CurrentModel | null;
	onModelLoaded?: (modelId: string, provider: ServiceProvider) => void;
}

export const LocalModelsList: React.FC<LocalModelsListProps> = ({
	localModels,
	quickProvider,
	loading,
	current,
	onModelLoaded,
}) => {
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
		<>
			{localModels.map((model) => {
				const isLoaded =
					serviceManager.llmService.has("openai") &&
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
								await serviceManager.llmService.setCurrentModel(
									model.id,
									quickProvider,
									serviceName,
								);
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
		</>
	);
};
