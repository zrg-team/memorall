import React from "react";
import { Progress } from "@/components/ui/progress";
import type { DownloadProgress } from "../hooks/use-download-progress";

interface ProgressSectionProps {
	loading: boolean;
	quickDownloadModel: string | null;
	downloadProgress: DownloadProgress;
}

export const ProgressSection: React.FC<ProgressSectionProps> = ({
	loading,
	quickDownloadModel,
	downloadProgress,
}) => {
	console.log("🔍 ProgressSection render:", {
		loading,
		quickDownloadModel,
		downloadProgress,
	});

	// Show progress only during active loading, not when complete
	const shouldShowProgress =
		loading || (downloadProgress.percent > 0 && downloadProgress.percent < 100);

	if (!shouldShowProgress) {
		console.log("❌ ProgressSection hidden - conditions not met");
		return null;
	}

	return (
		<div className="space-y-3 p-4 border rounded-lg bg-muted/50">
			<div className="flex items-center justify-between text-sm">
				<span className="font-medium">
					Loading {quickDownloadModel || "model"}
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
						: downloadProgress.text || "Initializing..."}
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
