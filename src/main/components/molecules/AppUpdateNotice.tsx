import React from "react";
import { Download, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import {
	type AppUpdateStatus,
	applyAppUpdate,
	getAppUpdateStatus,
	subscribeToAppUpdate,
} from "@/main/service-worker-update";

export function useAppUpdateStatus(): AppUpdateStatus {
	return React.useSyncExternalStore(
		subscribeToAppUpdate,
		getAppUpdateStatus,
		() => "idle" as const,
	);
}

/**
 * Sits at the bottom of the right panel and only appears once a newer build of
 * the Web app exists: first while it downloads in the background, then as the
 * button that takes it. Every other surface leaves the status at `idle`, so
 * this renders nothing there.
 */
export const AppUpdateNotice: React.FC = () => {
	const { t } = useTranslation();
	const status = useAppUpdateStatus();
	if (status === "idle") return null;

	const isReady = status === "ready";
	const label = isReady
		? t("rightPanel.update.ready")
		: t("rightPanel.update.downloading");

	return (
		<div className="flex flex-shrink-0 items-center gap-2 border-t border-border/60 bg-app/60 px-3 py-1.5">
			{isReady ? (
				<button
					type="button"
					onClick={applyAppUpdate}
					data-app-update-action="reload"
					className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] font-medium text-blue-500 transition-colors hover:bg-blue-500/10"
				>
					<RefreshCw size={13} className="flex-shrink-0" />
					<span className="truncate">{label}</span>
					<span className="ml-auto flex-shrink-0 text-[11px] text-blue-500/80">
						{t("rightPanel.update.reload")}
					</span>
				</button>
			) : (
				<div
					data-app-update-status="downloading"
					className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-[11px] font-medium text-muted-foreground"
				>
					<Download size={13} className="flex-shrink-0 animate-pulse" />
					<span className="truncate">{label}</span>
				</div>
			)}
		</div>
	);
};

/**
 * The collapsed rail has no room for the row above, so the same states become a
 * single icon at the bottom of the rail.
 */
export const AppUpdateRailNotice: React.FC = () => {
	const { t } = useTranslation();
	const status = useAppUpdateStatus();
	if (status === "idle") return null;

	const isReady = status === "ready";
	const label = isReady
		? `${t("rightPanel.update.ready")} — ${t("rightPanel.update.reload")}`
		: t("rightPanel.update.downloading");

	return (
		<TooltipProvider>
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={isReady ? applyAppUpdate : undefined}
						aria-label={label}
						data-app-update-rail={isReady ? "ready" : "downloading"}
						className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
							isReady
								? "text-blue-500 hover:bg-blue-500/10"
								: "cursor-default text-muted-foreground"
						}`}
					>
						{isReady ? (
							<RefreshCw size={16} />
						) : (
							<Download size={16} className="animate-pulse" />
						)}
					</button>
				</TooltipTrigger>
				<TooltipContent side="left">
					<p>{label}</p>
				</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
};
