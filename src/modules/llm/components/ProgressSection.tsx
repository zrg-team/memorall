import React from "react";
import { Progress } from "@/components/ui/progress";

interface ProgressData {
	loaded: number;
	total: number;
	percent: number;
	text: string;
}

interface ProgressSectionProps {
	loading: boolean;
	advancedProvider: string;
	filePath: string;
	repo: string;
	webllmModel: string;
	downloadProgress: ProgressData;
}

export const ProgressSection: React.FC<ProgressSectionProps> = ({
	loading,
	advancedProvider,
	filePath,
	repo,
	webllmModel,
	downloadProgress,
}) => {
	if (!loading) return null;

	return (
		<div className="space-y-3 p-4 border rounded-lg bg-muted/50">
			<div className="flex items-center justify-between text-sm">
				<span className="font-medium">
					Loading{" "}
					{advancedProvider === "wllama"
						? filePath
							? `${repo}/${filePath}`
							: repo
						: webllmModel || "WebLLM model"}
				</span>
				<span className="text-muted-foreground">
					{downloadProgress.percent}%
				</span>
			</div>
			<Progress value={downloadProgress.percent} className="h-2" />
			<div className="flex justify-between text-xs text-muted-foreground">
				<span>
					{downloadProgress.loaded > 0 && downloadProgress.total > 0
						? `${(downloadProgress.loaded / (1024 * 1024)).toFixed(1)} MB / ${(downloadProgress.total / (1024 * 1024)).toFixed(1)} MB`
						: "Initializing..."}
				</span>
				<span>
					{downloadProgress.loaded > 0 && downloadProgress.total > 0
						? `ETA: ${Math.round((downloadProgress.total - downloadProgress.loaded) / 1024 / 1024 / 2)}s`
						: ""}
				</span>
			</div>
		</div>
	);
};
