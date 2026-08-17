import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronsLeft, ChevronsRight, ExternalLink } from "lucide-react";
import { RightApplicationLayout } from "@/main/components/RightApplicationLayout";
import { ChatPage } from "@/main/pages/ChatPage";
import {
	SHELL_CHAT_WIDTH_MAX,
	SHELL_CHAT_WIDTH_MIN,
	useShellLayoutStore,
} from "@/main/stores/shell-layout";
import { useRuntimeSessionsStore } from "@/main/stores/runtime-sessions";
import { Button } from "@/main/components/ui/button";
import { useMediaQuery } from "@/main/hooks/use-viewport";
import {
	getCopilotNavigationId,
	workspaceNavigationItems,
	workspaceNavigationPaths,
} from "@/main/components/app-navigation";
import { LoadingScreen, useCurrentModel } from "@/main/modules/chat/components";
import {
	ModelDownloadingScreen,
	useDownloadProgress,
} from "@/main/modules/llm/components";
import { isPopupSurface } from "@/utils/dom";
import { openStandalonePage } from "@/utils/open-standalone";

interface AppShellProps {
	children: React.ReactNode;
}

const MOBILE_WORKSPACE_QUERY = "(max-width: 640px)";

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
	const navigate = useNavigate();
	const location = useLocation();
	const { isInitialized } = useCurrentModel();
	const { downloadProgress, quickDownloadModel } = useDownloadProgress();
	const chatShellCollapsed = useShellLayoutStore(
		(state) => state.chatShellCollapsed,
	);
	const setChatShellCollapsed = useShellLayoutStore(
		(state) => state.setChatShellCollapsed,
	);
	const chatShellWidth = useShellLayoutStore((state) => state.chatShellWidth);
	const setChatShellWidth = useShellLayoutStore(
		(state) => state.setChatShellWidth,
	);
	const rightPanelCollapsed = useShellLayoutStore(
		(state) => state.rightPanelCollapsed,
	);
	const setRightPanelCollapsed = useShellLayoutStore(
		(state) => state.setRightPanelCollapsed,
	);
	const isDraggingRef = React.useRef(false);
	const startXRef = React.useRef(0);
	const startWidthRef = React.useRef(0);
	const [isResizing, setIsResizing] = React.useState(false);
	const [isCompactChatListOpen, setIsCompactChatListOpen] =
		React.useState(false);
	const isNarrow = useMediaQuery(MOBILE_WORKSPACE_QUERY);
	const isPopup = isPopupSurface();
	const runtimeCount = useRuntimeSessionsStore((state) =>
		state.getRuntimeCount(),
	);
	const refreshRuntimeSessions = useRuntimeSessionsStore(
		(state) => state.refresh,
	);
	const effectiveChatShellCollapsed =
		!rightPanelCollapsed && chatShellCollapsed;
	const chatPanelNarrowQuery = rightPanelCollapsed
		? "(max-width: 695px)"
		: effectiveChatShellCollapsed
			? "(min-width: 0px)"
			: `(max-width: ${Math.floor(64000 / Math.max(chatShellWidth, 1))}px)`;
	const isNarrowChatPanel = useMediaQuery(chatPanelNarrowQuery);
	const chatPanelWidth = isNarrow
		? "100%"
		: rightPanelCollapsed
			? "calc(100vw - 56px)"
			: effectiveChatShellCollapsed
				? "56px"
				: `${chatShellWidth}vw`;
	const rightPanelWidth = rightPanelCollapsed
		? "56px"
		: effectiveChatShellCollapsed
			? "calc(100vw - 56px)"
			: `calc(100vw - ${chatShellWidth}vw)`;
	const panelTransitionClass = isResizing
		? ""
		: "transition-[width,flex-basis] duration-300 ease-out";
	const isMobileWorkspaceOpen =
		isNarrow && workspaceNavigationPaths.has(location.pathname);

	React.useEffect(() => {
		void refreshRuntimeSessions();
	}, [refreshRuntimeSessions]);

	React.useEffect(() => {
		if (workspaceNavigationPaths.has(location.pathname)) {
			setRightPanelCollapsed(false);
		}
	}, [location.pathname, setRightPanelCollapsed]);

	if (!isInitialized) {
		return <LoadingScreen />;
	}

	const isModelDownloading =
		downloadProgress.percent > 0 && downloadProgress.percent < 100;

	if (isModelDownloading) {
		return (
			<ModelDownloadingScreen
				downloadProgress={downloadProgress}
				modelName={quickDownloadModel}
			/>
		);
	}

	const handleResizeMouseDown = (event: React.MouseEvent) => {
		event.preventDefault();
		isDraggingRef.current = true;
		setIsResizing(true);
		startXRef.current = event.clientX;
		startWidthRef.current = chatShellWidth;

		const onMouseMove = (moveEvent: MouseEvent) => {
			if (!isDraggingRef.current) return;
			const viewportWidth = window.innerWidth || 1;
			const delta =
				((moveEvent.clientX - startXRef.current) / viewportWidth) * 100;
			const next = Math.max(
				SHELL_CHAT_WIDTH_MIN,
				Math.min(SHELL_CHAT_WIDTH_MAX, startWidthRef.current + delta),
			);
			setChatShellWidth(next);
		};

		const onMouseUp = () => {
			isDraggingRef.current = false;
			setIsResizing(false);
			window.removeEventListener("mousemove", onMouseMove);
			window.removeEventListener("mouseup", onMouseUp);
		};

		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("mouseup", onMouseUp);
	};

	return (
		<div
			className="flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground"
			data-copilot="app-layout"
			data-agent-cursor-point="copilot-app-layout"
		>
			<section
				className={`relative z-20 h-full min-h-0 flex-shrink-0 border-r bg-background max-[640px]:w-full max-[640px]:border-r-0 ${panelTransitionClass}`}
				data-copilot="chat-left-panel"
				data-agent-cursor-point="copilot-chat-left-panel"
				style={{
					width: chatPanelWidth,
					flexBasis: chatPanelWidth,
				}}
			>
				{isNarrow && !isMobileWorkspaceOpen ? (
					<div className="absolute right-3 top-3 z-40 flex items-center gap-1 rounded-lg border border-border/70 bg-background/85 p-1 shadow-sm backdrop-blur-xl">
						{workspaceNavigationItems.map((item) => {
							const Icon = item.icon;
							const isRuntime = item.path === "/runtime";
							const copilotId = getCopilotNavigationId(item.path);
							if (isPopup && isRuntime) {
								return (
									<button
										key="open-full-mode"
										type="button"
										onClick={() => void openStandalonePage()}
										className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
										aria-label="Open full mode"
										title="Open full mode"
									>
										<ExternalLink size={15} />
									</button>
								);
							}

							return (
								<Link
									key={item.path}
									to={item.path}
									data-copilot={
										copilotId ? `mobile-nav-${copilotId}` : undefined
									}
									data-agent-cursor-point={
										copilotId ? `copilot-mobile-nav-${copilotId}` : undefined
									}
									className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
									aria-label={item.mobileLabel}
									title={item.mobileLabel}
								>
									<Icon size={15} />
									{isRuntime && runtimeCount > 0 ? (
										<span className="absolute -right-1 -top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white shadow-sm">
											{runtimeCount > 9 ? "9+" : runtimeCount}
										</span>
									) : null}
								</Link>
							);
						})}
					</div>
				) : null}
				<div
					className={
						effectiveChatShellCollapsed
							? "h-full w-[56px] overflow-hidden"
							: "h-full"
					}
				>
					{effectiveChatShellCollapsed ? (
						<div className="flex h-full w-[56px] flex-col items-center border-r bg-background">
							<div className="flex h-12 w-full items-center justify-center">
								<Button
									type="button"
									variant="ghost"
									size="icon"
									onClick={() => setChatShellCollapsed(false)}
									className="h-9 w-9 text-muted-foreground hover:text-foreground"
									aria-label="Restore chat panel"
									title="Restore chat panel"
								>
									<ChevronsRight size={16} />
								</Button>
							</div>
						</div>
					) : (
						<ChatPage
							hideWideSidePanelCollapsedToggle={effectiveChatShellCollapsed}
							isNarrowChatPanel={isNarrowChatPanel}
							onCompactChatListOpenChange={setIsCompactChatListOpen}
							useIconOnlyHistoryButton={isNarrow && !isMobileWorkspaceOpen}
						/>
					)}
				</div>
				<div
					onMouseDown={handleResizeMouseDown}
					className="absolute bottom-0 right-0 top-0 hidden w-1 cursor-col-resize transition-colors hover:bg-primary/40 min-[641px]:block"
				/>
				{!rightPanelCollapsed &&
				!effectiveChatShellCollapsed &&
				!(isNarrowChatPanel && isCompactChatListOpen) ? (
					<Button
						type="button"
						variant="ghost"
						size="icon"
						onClick={() => setChatShellCollapsed(!effectiveChatShellCollapsed)}
						className="absolute right-2 top-2 z-30 hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground min-[641px]:inline-flex"
						aria-label={
							effectiveChatShellCollapsed
								? "Restore chat panel"
								: "Show full right panel"
						}
						title={
							effectiveChatShellCollapsed
								? "Restore chat panel"
								: "Show full right panel"
						}
					>
						{effectiveChatShellCollapsed ? (
							<ChevronsRight size={18} />
						) : (
							<ChevronsLeft size={18} />
						)}
					</Button>
				) : null}
			</section>

			<section
				className={`min-h-0 min-w-0 flex-shrink-0 overflow-hidden max-[640px]:!hidden ${panelTransitionClass}`}
				data-copilot="right-panel"
				data-agent-cursor-point="copilot-right-panel"
				style={{
					width: rightPanelWidth,
					flexBasis: rightPanelWidth,
				}}
			>
				<RightApplicationLayout
					collapsed={rightPanelCollapsed}
					onCollapsedChange={setRightPanelCollapsed}
				>
					{children}
				</RightApplicationLayout>
			</section>

			{isMobileWorkspaceOpen ? (
				<section className="fixed inset-0 z-50 bg-background min-[641px]:hidden">
					<RightApplicationLayout
						collapsed={false}
						onCollapsedChange={(collapsed) => {
							if (collapsed) navigate("/");
						}}
					>
						{children}
					</RightApplicationLayout>
				</section>
			) : null}
		</div>
	);
};
