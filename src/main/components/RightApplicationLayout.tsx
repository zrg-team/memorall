import React from "react";
import { Link, useLocation } from "react-router-dom";
import {
	Bug,
	ChevronDown,
	ExternalLink,
	ChevronsLeft,
	ChevronsRight,
} from "lucide-react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";
import { ProcessMonitor } from "@/main/components/molecules/ProcessMonitor";
import { openStandalonePage } from "@/utils/open-standalone";
import { isPopupSurface } from "@/utils/dom";
import { useIsWideViewport } from "@/main/hooks/use-viewport";
import { SettingPanel } from "@/main/components/molecules/SettingPanel";
import { HarnessStatusBar } from "@/main/components/molecules/HarnessStatusBar";
import { Button } from "@/main/components/ui/button";
import { useRuntimeSessionsStore } from "@/main/stores/runtime-sessions";
import {
	debugNavigationItems,
	getCopilotNavigationId,
	WORKSPACE_FALLBACK_PATH,
	workspaceNavigationItems,
} from "@/main/components/app-navigation";
interface RightApplicationLayoutProps {
	children: React.ReactNode;
	collapsed?: boolean;
	onCollapsedChange?: (collapsed: boolean) => void;
}

type SettingsPanelStateProps = Pick<
	React.ComponentProps<typeof SettingPanel>,
	"setIsReloadingModel" | "setReloadProgress"
>;

type RightPanelVerticalRailProps = SettingsPanelStateProps & {
	runtimeCount: number;
	onOpenPanel: () => void;
	renderRuntimeBadge: (count: number) => React.ReactNode;
};

const RightPanelVerticalRail: React.FC<RightPanelVerticalRailProps> = ({
	runtimeCount,
	onOpenPanel,
	renderRuntimeBadge,
	setIsReloadingModel,
	setReloadProgress,
}) => {
	const { t } = useTranslation();
	const expandPanelLabel = t("rightPanel.expandWorkspacePanel");

	return (
		<aside className="flex h-full min-h-0 w-14 flex-col items-center border-l bg-app py-2">
			<Button
				type="button"
				variant="ghost"
				size="icon"
				className="h-9 w-9 text-muted-foreground hover:text-foreground"
				aria-label={expandPanelLabel}
				title={expandPanelLabel}
				onClick={onOpenPanel}
			>
				<ChevronsLeft size={17} />
			</Button>
			<div className="mt-3 flex flex-col items-center gap-1">
				<TooltipProvider>
					{workspaceNavigationItems.map((item) => {
						const IconComponent = item.icon;
						const copilotId = getCopilotNavigationId(item.path);
						return (
							<Tooltip key={item.path}>
								<TooltipTrigger asChild>
									<Link
										to={item.path}
										onClick={onOpenPanel}
										data-copilot={
											copilotId ? `rail-nav-${copilotId}` : undefined
										}
										data-agent-cursor-point={
											copilotId ? `copilot-rail-nav-${copilotId}` : undefined
										}
										className="relative flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
									>
										<IconComponent size={16} />
										{item.path === "/runtime"
											? renderRuntimeBadge(runtimeCount)
											: null}
									</Link>
								</TooltipTrigger>
								<TooltipContent side="left">
									<p>{t(item.nameKey)}</p>
								</TooltipContent>
							</Tooltip>
						);
					})}
				</TooltipProvider>
			</div>
			<div className="mt-auto flex flex-col items-center gap-1 pb-1">
				<ProcessMonitor
					tooltipSide="left"
					popoverSide="left"
					popoverAlign="end"
					triggerClassName="h-9 w-9 text-muted-foreground hover:text-foreground"
				/>
				<SettingPanel
					setIsReloadingModel={setIsReloadingModel}
					setReloadProgress={setReloadProgress}
					tooltipSide="left"
				/>
			</div>
		</aside>
	);
};

export const RightApplicationLayout: React.FC<RightApplicationLayoutProps> = ({
	children,
	collapsed = false,
	onCollapsedChange,
}) => {
	const location = useLocation();
	const { t } = useTranslation();
	const isWideViewport = useIsWideViewport();
	// In standalone (non-popup) wide mode we have room to show text labels next
	// to the nav icons; the popup stays icon-only to conserve horizontal space.
	// Only the active destination is labelled. Naming all of them pushed the bar
	// into a horizontal scroll on desktop, hiding the tail of the nav behind an
	// arrow; the icons carry the row and the label names where you are. Everything
	// unlabelled gets its name from a hover tooltip.
	const showNavLabels = !isPopupSurface() && isWideViewport;

	const [isReloadingModel, setIsReloadingModel] = React.useState(false);
	const [reloadProgress, setReloadProgress] = React.useState({
		stage: "",
		progress: 0,
	});
	const commandsCount = useRuntimeSessionsStore(
		(state) => state.commands.length,
	);
	const serversCount = useRuntimeSessionsStore((state) => state.servers.length);
	const hasActiveWebSession = useRuntimeSessionsStore(
		(state) => state.activeWebSession.isOpen,
	);
	const refreshRuntimeSessions = useRuntimeSessionsStore(
		(state) => state.refresh,
	);
	const runtimeCount =
		commandsCount + serversCount + Number(hasActiveWebSession);

	React.useEffect(() => {
		void refreshRuntimeSessions();
	}, [refreshRuntimeSessions]);

	const allPaths = [...workspaceNavigationItems, ...debugNavigationItems];
	const checkIsExistNavigation = allPaths.some(
		(item) => item.path === location.pathname,
	);

	const isDebugSelected = debugNavigationItems.some(
		(item) => item.path === location.pathname,
	);
	const collapsePanelLabel = t("rightPanel.collapseWorkspacePanel");

	const openPanel = () => {
		onCollapsedChange?.(false);
	};

	const settingsPanelStateProps = {
		setIsReloadingModel,
		setReloadProgress,
	} satisfies SettingsPanelStateProps;

	const renderRuntimeBadge = (count: number) =>
		count > 0 ? (
			<span className="absolute -right-1 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[10px] font-semibold leading-none text-white shadow-sm">
				{count > 9 ? "9+" : count}
			</span>
		) : null;

	const reloadOverlay = isReloadingModel ? (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
			<div className="mx-4 w-full max-w-md rounded-lg border bg-background p-6 shadow-lg">
				<h3 className="mb-4 text-lg font-semibold">
					{t("reloading", { ns: "embedding" })}
				</h3>
				<p className="mb-4 text-sm text-muted-foreground">
					{reloadProgress.stage || t("downloadingModel", { ns: "embedding" })}
				</p>
				<div className="h-2 w-full overflow-hidden rounded-full bg-muted">
					<div
						className="h-full bg-primary transition-all duration-300"
						style={{ width: `${reloadProgress.progress}%` }}
					/>
				</div>
				<p className="mt-2 text-center text-xs text-muted-foreground">
					{+reloadProgress.progress.toFixed(2)}%
				</p>
				<p className="mt-4 text-xs text-muted-foreground">
					{t("pleaseWait", { ns: "embedding" })}
				</p>
			</div>
		</div>
	) : null;

	if (collapsed) {
		return (
			<>
				<RightPanelVerticalRail
					runtimeCount={runtimeCount}
					onOpenPanel={openPanel}
					renderRuntimeBadge={renderRuntimeBadge}
					{...settingsPanelStateProps}
				/>
				{reloadOverlay}
			</>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col bg-app">
			<nav
				className="z-30 flex-shrink-0"
				style={{
					backdropFilter: "blur(20px)",
					WebkitBackdropFilter: "blur(20px)",
					background: "var(--header-glass)",
					borderBottom: "1px solid var(--glass-border)",
				}}
			>
				<div className="px-3">
					<div className="flex h-12 items-center justify-between gap-2">
						<div className="flex min-w-0 items-center space-x-1 overflow-x-auto">
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											className="h-9 w-9 text-muted-foreground hover:text-foreground"
											aria-label={collapsePanelLabel}
											title={collapsePanelLabel}
											onClick={() => onCollapsedChange?.(true)}
										>
											<ChevronsRight size={16} />
										</Button>
									</TooltipTrigger>
									<TooltipContent side="bottom">
										<p>{collapsePanelLabel}</p>
									</TooltipContent>
								</Tooltip>
								{workspaceNavigationItems.map((item) => {
									const isSelected =
										location.pathname === item.path ||
										(!checkIsExistNavigation &&
											item.path === WORKSPACE_FALLBACK_PATH);
									const IconComponent = item.icon;
									const copilotId = getCopilotNavigationId(item.path);
									return (
										<React.Fragment key={item.path}>
											{/* Marks a harness group boundary: identity | context |
											    capability | engine | execution. */}
											{item.groupStart ? (
												<span
													aria-hidden
													className="mx-1 h-5 w-px shrink-0 bg-border/60"
												/>
											) : null}
											<Tooltip>
												<TooltipTrigger asChild>
													<Link
														to={item.path}
														onClick={() => openPanel()}
														data-copilot={
															copilotId ? `header-nav-${copilotId}` : undefined
														}
														data-agent-cursor-point={
															copilotId
																? `copilot-header-nav-${copilotId}`
																: undefined
														}
														className={`${
															isSelected
																? "bg-blue-500/10 text-blue-500 border border-blue-500/30 shadow-[0_0_0_1px_rgba(59,130,246,0.28),0_4px_20px_rgba(59,130,246,0.12)]"
																: "text-muted-foreground hover:text-foreground hover:bg-white/5"
														} relative flex items-center rounded-md text-sm font-medium transition-all duration-200 ease-in-out ${
															showNavLabels && isSelected
																? "gap-2 px-2.5 py-2"
																: "p-2"
														}`}
													>
														<IconComponent
															size={16}
															className={`flex-shrink-0 transition-transform duration-200 ease-in-out ${
																isSelected ? "scale-110" : "hover:scale-110"
															}`}
														/>
														{showNavLabels && isSelected ? (
															<span className="whitespace-nowrap">
																{t(item.nameKey)}
															</span>
														) : null}
														{item.path === "/runtime"
															? renderRuntimeBadge(runtimeCount)
															: null}
													</Link>
												</TooltipTrigger>
												{showNavLabels && isSelected ? null : (
													<TooltipContent side="bottom">
														<p>{t(item.nameKey)}</p>
													</TooltipContent>
												)}
											</Tooltip>
										</React.Fragment>
									);
								})}

								<DropdownMenu>
									<Tooltip>
										<TooltipTrigger asChild>
											<DropdownMenuTrigger asChild>
												<button
													className={`${
														isDebugSelected
															? "bg-blue-500/10 text-blue-500 border border-blue-500/30 shadow-[0_0_0_1px_rgba(59,130,246,0.28),0_4px_20px_rgba(59,130,246,0.12)]"
															: "text-muted-foreground hover:text-foreground hover:bg-white/5"
													} flex items-center rounded-md text-sm font-medium transition-all duration-200 ease-in-out ${
														showNavLabels && isDebugSelected
															? "gap-1.5 px-2.5 py-2"
															: "p-2"
													}`}
												>
													<Bug
														size={16}
														className={`flex-shrink-0 transition-transform duration-200 ease-in-out ${
															isDebugSelected ? "scale-110" : "hover:scale-110"
														}`}
													/>
													{showNavLabels && isDebugSelected ? (
														<span className="whitespace-nowrap">
															{t("navigation.debug")}
														</span>
													) : null}
													<ChevronDown size={12} className="ml-1" />
												</button>
											</DropdownMenuTrigger>
										</TooltipTrigger>
										{showNavLabels && isDebugSelected ? null : (
											<TooltipContent side="bottom">
												<p>{t("navigation.debug")}</p>
											</TooltipContent>
										)}
									</Tooltip>
									<DropdownMenuContent align="start">
										{debugNavigationItems.map((item) => {
											const IconComponent = item.icon;
											return (
												<DropdownMenuItem key={item.path} asChild>
													<Link
														to={item.path}
														onClick={() => openPanel()}
														className="flex cursor-pointer items-center gap-2"
													>
														<IconComponent size={14} />
														<span>{t(item.nameKey)}</span>
													</Link>
												</DropdownMenuItem>
											);
										})}
									</DropdownMenuContent>
								</DropdownMenu>
							</TooltipProvider>
						</div>

						<div className="flex flex-shrink-0 items-center gap-2">
							{isPopupSurface() && (
								<TooltipProvider>
									<Tooltip>
										<TooltipTrigger asChild>
											<button
												type="button"
												onClick={openStandalonePage}
												className="flex items-center rounded-md p-2 text-sm font-medium text-muted-foreground transition-all duration-200 ease-in-out hover:bg-white/5 hover:text-foreground"
											>
												<ExternalLink size={16} />
											</button>
										</TooltipTrigger>
										<TooltipContent side="bottom">
											<p>
												{t("common.openStandalone", {
													defaultValue: "Open in standalone",
												})}
											</p>
										</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							)}
							<ProcessMonitor />
							<SettingPanel {...settingsPanelStateProps} />
						</div>
					</div>
				</div>
			</nav>

			<HarnessStatusBar />

			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				{children}
			</div>

			{reloadOverlay}
		</div>
	);
};
