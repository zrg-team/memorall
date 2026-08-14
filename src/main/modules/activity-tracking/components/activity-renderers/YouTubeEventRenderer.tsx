/**
 * YouTube Event Renderer
 * User-friendly display for YouTube video watching
 */

import React from "react";
import { SiYoutube as Youtube } from "@icons-pack/react-simple-icons";
import { Clock, Play } from "lucide-react";
import type { Activity } from "@/types/activity-tracking";

interface YouTubeEventRendererProps {
	activity: Activity;
	expanded?: boolean;
}

export const YouTubeEventRenderer: React.FC<YouTubeEventRendererProps> = ({
	activity,
	expanded = false,
}) => {
	const data = activity.data as any;

	// Extract YouTube data
	const videoTitle = data.title || "Untitled Video";
	const channelName = data.channelName || "Unknown Channel";
	const videoUrl = data.videoUrl || "";
	const watchDuration = data.watchDuration || 0; // seconds
	const videoDuration = data.videoDuration || 0; // seconds
	const thumbnail = data.thumbnail || "";

	// Calculate watch percentage
	const watchPercentage =
		videoDuration > 0 ? Math.round((watchDuration / videoDuration) * 100) : 0;
	const watchTime = Math.round(watchDuration / 60); // minutes

	return (
		<div className="space-y-3">
			{/* Header with thumbnail */}
			<div className="flex items-start gap-3">
				{thumbnail && expanded && (
					<div className="w-32 h-18 rounded-lg overflow-hidden flex-shrink-0 relative group">
						<img
							src={thumbnail}
							alt={videoTitle}
							className="w-full h-full object-cover"
						/>
						<div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
							<Play className="w-8 h-8 text-white" fill="white" />
						</div>
					</div>
				)}
				<div className="flex-1 min-w-0">
					<div className="flex items-start gap-2">
						<div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center flex-shrink-0">
							<Youtube className="w-5 h-5 text-red-500" />
						</div>
						<div className="flex-1 min-w-0">
							<h4 className="font-semibold text-base mb-1 line-clamp-2">
								{videoTitle}
							</h4>
							<p className="text-sm text-muted-foreground">{channelName}</p>
						</div>
					</div>
				</div>
			</div>

			{/* Watch Stats */}
			<div className="flex items-center gap-4 text-sm text-muted-foreground">
				<div className="flex items-center gap-1.5">
					<Clock className="w-4 h-4" />
					<span>Watched {watchTime} min</span>
				</div>
				{watchPercentage > 0 && (
					<div className="flex items-center gap-2">
						<div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
							<div
								className="h-full bg-red-500 transition-all"
								style={{ width: `${Math.min(watchPercentage, 100)}%` }}
							/>
						</div>
						<span className="text-xs">{watchPercentage}%</span>
					</div>
				)}
			</div>

			{/* Video Link */}
			{videoUrl && (
				<a
					href={videoUrl}
					target="_blank"
					rel="noopener noreferrer"
					className="text-sm text-primary hover:underline inline-flex items-center gap-1"
				>
					Watch on YouTube →
				</a>
			)}
		</div>
	);
};
