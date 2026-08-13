import React, { useState } from "react";
import {
	ExternalLink,
	Globe,
	Loader2,
	Power,
	RotateCw,
	Terminal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { serviceManager } from "@/services";
import { cn } from "@/lib/utils";
import type { SandboxServerInfo, RuntimeSessionsVariant } from "./types";
import {
	ActionIconButton,
	KindBadge,
	VerticalResizeHandle,
} from "./SharedComponents";
import { useResizeHeight } from "./useResizeHeight";
import { BrowserViewer } from "./BrowserViewer";
import { PostmanTool } from "./PostmanTool";
import { platform } from "@/platform/current";

type ActiveView = "browser" | "postman" | null;

export const ServerCard: React.FC<{
	server: SandboxServerInfo;
	onChanged: () => void | Promise<void>;
	variant: RuntimeSessionsVariant;
}> = ({ server, onChanged }) => {
	const { t } = useTranslation();
	const [activeView, setActiveView] = useState<ActiveView>(null);
	const [isRestarting, setIsRestarting] = useState(false);
	const [isStopping, setIsStopping] = useState(false);
	const [actionError, setActionError] = useState<string | null>(null);
	const {
		height: cardBodyHeight,
		isDragging,
		handleMouseDown: handleCardResizeMouseDown,
	} = useResizeHeight(400, 120, 1200);

	const toggle = (view: "browser" | "postman") =>
		setActiveView((prev) => (prev === view ? null : view));

	const openServerUrl = () => {
		void platform.externalLinks.open(server.url);
	};

	const handleRestart = async () => {
		setIsRestarting(true);
		setActionError(null);
		try {
			await serviceManager.getSandboxContainerService().startServer({
				kind: server.kind,
				port: server.port,
				rootDir: server.rootDir,
				autoInstall: false,
			});
			void onChanged();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsRestarting(false);
		}
	};

	const handleStop = async () => {
		setIsStopping(true);
		setActionError(null);
		try {
			await serviceManager
				.getSandboxContainerService()
				.stopServer({ port: server.port });
			void onChanged();
		} catch (error) {
			setActionError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsStopping(false);
		}
	};

	return (
		<div className="overflow-hidden rounded-md border border-border">
			<div className="flex items-center gap-1.5 bg-muted/20 px-2 py-1.5">
				<KindBadge kind={server.kind} />
				<span className="text-xs font-mono text-muted-foreground">
					:{server.port}
				</span>
				{server.rootDir ? (
					<span
						className="flex-1 truncate text-[10px] text-muted-foreground"
						title={server.rootDir}
					>
						{server.rootDir}
					</span>
				) : null}
				<div className="ml-auto flex gap-1">
					<ActionIconButton
						title={t("sandboxPanel.openInTab")}
						onClick={openServerUrl}
						icon={<ExternalLink size={14} />}
					/>
					<ActionIconButton
						title={t("sandboxPanel.restartServer")}
						onClick={() => void handleRestart()}
						disabled={isRestarting || isStopping}
						icon={
							isRestarting ? (
								<Loader2 size={14} className="animate-spin" />
							) : (
								<RotateCw size={14} />
							)
						}
					/>
					<ActionIconButton
						title={t("sandboxPanel.stopServer")}
						onClick={() => void handleStop()}
						disabled={isRestarting || isStopping}
						variant="danger"
						icon={
							isStopping ? (
								<Loader2 size={14} className="animate-spin" />
							) : (
								<Power size={14} />
							)
						}
					/>
					<button
						type="button"
						title={t("sandboxPanel.browser")}
						onClick={() => toggle("browser")}
						className={cn(
							"inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-transparent transition-colors",
							activeView === "browser"
								? "bg-primary text-primary-foreground shadow-sm"
								: "text-muted-foreground hover:border-border hover:bg-muted/80 hover:text-foreground",
						)}
					>
						<Globe size={14} />
					</button>
					<button
						type="button"
						title={t("sandboxPanel.api")}
						onClick={() => toggle("postman")}
						className={cn(
							"inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-transparent transition-colors",
							activeView === "postman"
								? "bg-primary text-primary-foreground shadow-sm"
								: "text-muted-foreground hover:border-border hover:bg-muted/80 hover:text-foreground",
						)}
					>
						<Terminal size={14} />
					</button>
				</div>
			</div>
			{actionError ? (
				<div className="border-t border-destructive/20 bg-destructive/5 px-2 py-1.5 text-[11px] text-destructive">
					{actionError}
				</div>
			) : null}
			{activeView !== null ? (
				<div
					style={{ height: cardBodyHeight }}
					className="flex flex-col overflow-hidden"
				>
					{activeView === "browser" ? (
						<BrowserViewer server={server} showOverlay={isDragging} />
					) : null}
					{activeView === "postman" ? <PostmanTool server={server} /> : null}
				</div>
			) : null}
			{activeView !== null ? (
				<VerticalResizeHandle onMouseDown={handleCardResizeMouseDown} />
			) : null}
		</div>
	);
};
