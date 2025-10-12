import React from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Download, Play, Square, Bot } from "lucide-react";
import type { ModelInfo } from "@/services/llm";
import type { CurrentModel } from "../../../../../hooks/use-current-model";
import type { Provider } from "../../../../../hooks/use-provider-config";

interface DownloadedModelsSectionProps {
	downloadedOnly: ModelInfo[];
	current: CurrentModel | null;
	title: string;
	modelsLoading: boolean;
	loading: boolean;
	fetchDownloadedModels: () => Promise<void>;
	loadDownloadedModel: (model: ModelInfo, provider: Provider) => Promise<void>;
	unloadDownloadedModel: (
		model: ModelInfo,
		provider: Provider,
	) => Promise<void>;
	showDownloadMoreButton?: boolean;
	onDownloadMore?: () => void;
}

export const DownloadedModelsSection: React.FC<
	DownloadedModelsSectionProps
> = ({
	downloadedOnly,
	current,
	title,
	modelsLoading,
	loading,
	fetchDownloadedModels,
	loadDownloadedModel,
	unloadDownloadedModel,
	showDownloadMoreButton,
	onDownloadMore,
}) => {
	if (downloadedOnly.length === 0) {
		return null;
	}

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2 min-w-0">
					<h3 className="text-sm font-semibold flex items-center gap-2 shrink-0">
						<Bot size={16} />
						{title}
					</h3>
					{current && (
						<Badge
							variant="secondary"
							className="rounded-full text-[10px] px-2 py-0.5 max-w-[50%] truncate"
						>
							<span className="text-green-600 mr-1">●</span>
							<span className="truncate">
								{current.modelId} • {current.provider}
							</span>
						</Badge>
					)}
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={fetchDownloadedModels}
					disabled={modelsLoading}
				>
					{modelsLoading ? (
						<Loader2 className="w-4 h-4 animate-spin" />
					) : (
						<Download className="w-4 h-4" />
					)}
					Refresh
				</Button>
			</div>
			<div className="space-y-2">
				{downloadedOnly.map((model) => (
					<div
						key={model.id}
						className="flex items-center justify-between p-3 border rounded-lg bg-card"
					>
						<div className="flex-1">
							<div className="font-medium text-sm">
								{model.name || model.id}
							</div>
							<div className="text-xs text-muted-foreground">
								{model.loaded ? (
									<span className="text-green-600 font-medium">● Loaded</span>
								) : (
									<span className="text-gray-500">○ Available</span>
								)}
								{model.filename && (
									<span className="ml-2">• {model.filename}</span>
								)}
								{model.size && (
									<span className="ml-2">
										({(model.size / (1024 * 1024)).toFixed(0)} MB)
									</span>
								)}
							</div>
						</div>
						<div className="flex gap-2">
							{model.loaded &&
							current?.modelId === model.id &&
							(!model.provider || current.provider === model.provider) ? (
								<Button
									variant="outline"
									size="sm"
									onClick={() =>
										unloadDownloadedModel(model, model.provider as Provider)
									}
									disabled={loading}
								>
									{loading ? (
										<Loader2 className="w-4 h-4 animate-spin" />
									) : (
										<Square className="w-4 h-4" />
									)}
									Unload
								</Button>
							) : (
								<Button
									size="sm"
									onClick={() =>
										loadDownloadedModel(model, model.provider as Provider)
									}
									disabled={loading}
								>
									{loading ? (
										<Loader2 className="w-4 h-4 animate-spin" />
									) : (
										<Play className="w-4 h-4" />
									)}
									Load
								</Button>
							)}
						</div>
					</div>
				))}
			</div>
			{showDownloadMoreButton && (
				<div className="pt-4 border-t">
					<Button onClick={onDownloadMore} variant="outline" className="w-full">
						<Download className="w-4 h-4 mr-2" />
						Download More Models
					</Button>
				</div>
			)}
		</div>
	);
};
