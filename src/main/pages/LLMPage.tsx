import React from "react";
import {
	ProviderPanel,
	useLLMState,
	useLLMActions,
	useProgressListener,
	useRepoEffect,
} from "@/main/modules/llm/components";
import { YourModels } from "@/main/modules/llm/components/YourModels";
import { OffscreenServicesCard } from "@/main/modules/llm/components/OffscreenServicesCard";
import {
	Card,
	CardHeader,
	CardTitle,
	CardDescription,
	CardContent,
} from "@/main/components/ui/card";
import { Badge } from "@/main/components/ui/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import { Button } from "@/main/components/ui/button";
import {
	Brain,
	CheckCircle2,
	Info,
	PanelLeftClose,
	PanelLeftOpen,
} from "lucide-react";
import { useCurrentModel } from "@/main/hooks/use-current-model";
import { useResponsiveWorkspacePanels } from "@/main/hooks/use-responsive-workspace-panels";
import { useTranslation } from "react-i18next";
import { getModel } from "@/services/llm/registry/model-registry";
import { PageHeader } from "@/main/components/ui/page-header";
import { WorkspaceCollapsedSidebarDataItem } from "@/main/components/molecules/WorkspaceCollapsedSidebarDataItem";
import { WorkspaceCollapsedSidebarItem } from "@/main/components/molecules/WorkspaceCollapsedSidebarItem";
import { WorkspaceCollapsedSidebarSection } from "@/main/components/molecules/WorkspaceCollapsedSidebarSection";

// No local quick-connect card; configuration handled in AdvancedSection

function formatTokenCount(value: number): string {
	return value.toLocaleString();
}

const PANEL_STORAGE_KEY = "memorall.llm.workspace-panels.v3";

export const LLMPage: React.FC = () => {
	const { t } = useTranslation("llm");
	const state = useLLMState();
	const actions = useLLMActions({
		...state,
	});
	const {
		collapseSidebar,
		containerRef,
		expandSidebar,
		gridTemplateColumns,
		handleResizeStart,
		isCompactSplitLayout,
		isSidebarCollapsed,
		isSplitLayout: isDesktop,
		sidebarOverlayWidth,
	} = useResponsiveWorkspacePanels({ storageKey: PANEL_STORAGE_KEY });

	// Hooks for current model display
	const { current } = useCurrentModel();
	const currentLocalModel = React.useMemo(() => {
		if (!current) {
			return null;
		}

		if (
			current.provider !== "transformer" &&
			current.provider !== "webllm" &&
			current.provider !== "wllama"
		) {
			return null;
		}

		return getModel(current.modelId, current.provider) ?? null;
	}, [current]);
	const currentModelLabel =
		currentLocalModel?.displayName ??
		(current?.modelId?.trim()
			? current.modelId
			: t("currentModel.noModelSelected"));
	const currentModelStatus = current?.modelId?.trim()
		? t("currentModel.status.active")
		: current?.provider
			? t("currentModel.status.configured")
			: t("currentModel.status.inactive");

	// Setup event listeners and effects
	useProgressListener({
		setDownloadProgress: state.setDownloadProgress,
		setStatus: state.setStatus,
		setLogs: state.setLogs,
	});

	useRepoEffect({
		repo: state.repo,
		fetchRepoFiles: actions.fetchRepoFiles,
		setAvailableFiles: state.setAvailableFiles,
		setFilePath: state.setFilePath,
		setStatus: state.setStatus,
	});

	return (
		<div
			data-llm-page
			data-current-model-id={current?.modelId ?? ""}
			data-current-model-provider={current?.provider ?? ""}
			className="flex h-full flex-col overflow-auto bg-background sm:overflow-hidden"
		>
			<div
				ref={containerRef}
				className={
					isDesktop
						? "relative grid min-h-0 flex-1 overflow-hidden bg-background"
						: "min-h-0 flex-1 overflow-auto bg-background"
				}
				style={
					isDesktop
						? {
								gridTemplateColumns,
							}
						: undefined
				}
			>
				<aside
					className={
						isDesktop
							? `relative z-20 flex min-h-0 flex-col border-r bg-background transition-[width] ${
									(isCompactSplitLayout && !isSidebarCollapsed) ||
									isSidebarCollapsed
										? "overflow-visible"
										: "overflow-hidden"
								}`
							: "bg-background"
					}
				>
					{isDesktop && isSidebarCollapsed ? (
						<div className="flex h-full min-h-0 flex-col items-center py-3">
							<section
								aria-label="Actions"
								className="flex w-full flex-col items-center gap-1"
							>
								<WorkspaceCollapsedSidebarSection label="Actions" />
								<WorkspaceCollapsedSidebarItem
									icon={<PanelLeftOpen className="h-4 w-4" />}
									label={t("sidebar.show")}
									onClick={expandSidebar}
									className="border border-input bg-background hover:bg-accent"
								/>
							</section>
							<section
								aria-label="Lists"
								className="mt-3 flex min-h-0 w-full flex-1 flex-col items-center"
							>
								<WorkspaceCollapsedSidebarSection label="Lists" />
								<div className="mt-1 flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto px-1">
									<WorkspaceCollapsedSidebarDataItem
										label={currentModelLabel}
										description={
											current?.provider
												? `${current.provider} · ${currentModelStatus}`
												: currentModelStatus
										}
										indicatorClassName={
											current?.modelId?.trim()
												? "bg-emerald-500"
												: current?.provider
													? "bg-amber-500"
													: "bg-muted-foreground/50"
										}
										onClick={expandSidebar}
									/>
								</div>
							</section>
						</div>
					) : (
						<div
							className={
								isDesktop && isCompactSplitLayout
									? "absolute left-0 top-0 flex h-full min-h-0 flex-col overflow-hidden border-r bg-background shadow-2xl"
									: "contents"
							}
							style={
								isDesktop && isCompactSplitLayout
									? { width: sidebarOverlayWidth }
									: undefined
							}
						>
							<div className="relative">
								<PageHeader
									icon={<Brain size={20} />}
									title={t("title")}
									description={t("yourModels.description")}
									collapseButton={
										isDesktop ? (
											<Button
												type="button"
												variant="ghost"
												size="icon"
												className="h-8 w-8 shrink-0"
												onClick={() => {
													collapseSidebar();
												}}
												aria-label={t("sidebar.hide")}
												title={t("sidebar.hide")}
											>
												<PanelLeftClose className="h-4 w-4" />
											</Button>
										) : undefined
									}
								/>
							</div>

							<div
								className={
									isDesktop
										? "min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
										: "space-y-3 p-3"
								}
							>
								{/* Current Model Status */}
								<Card
									className="rounded-none md:rounded-lg"
									data-copilot="current-model"
								>
									<CardHeader className="p-3 pb-0">
										<CardTitle className="text-lg">
											{t("currentModel.title")}
										</CardTitle>
										<CardDescription>
											{t("currentModel.description")}
										</CardDescription>
									</CardHeader>
									<CardContent className="p-3">
										{current &&
										current.modelId &&
										current.modelId.trim() !== "" ? (
											<TooltipProvider>
												<div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/10 p-3">
													<CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
													<div className="min-w-0 flex-1">
														<div className="flex min-w-0 items-center gap-2">
															<div className="truncate font-semibold text-foreground">
																{currentLocalModel?.displayName ??
																	current.modelId}
															</div>
															{currentLocalModel && (
																<Tooltip>
																	<TooltipTrigger asChild>
																		<Button
																			type="button"
																			variant="ghost"
																			size="icon"
																			className="h-6 w-6 shrink-0 text-muted-foreground"
																			aria-label={t(
																				"currentModel.details.tooltipLabel",
																			)}
																		>
																			<Info className="h-4 w-4" />
																		</Button>
																	</TooltipTrigger>
																	<TooltipContent
																		side="right"
																		className="max-w-sm space-y-2 p-3"
																	>
																		<div className="font-medium">
																			{currentLocalModel.displayName}
																		</div>
																		<div className="break-all text-xs text-muted-foreground">
																			{currentLocalModel.id}
																		</div>
																		<div className="text-xs">
																			{currentLocalModel.description}
																		</div>
																		<div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
																			<div>
																				<span className="text-muted-foreground">
																					{t("currentModel.details.provider")}
																				</span>{" "}
																				{current.provider}
																			</div>
																			<div>
																				<span className="text-muted-foreground">
																					{t("currentModel.details.size")}
																				</span>{" "}
																				{currentLocalModel.sizeLabel}
																			</div>
																			<div>
																				<span className="text-muted-foreground">
																					{t("currentModel.details.context")}
																				</span>{" "}
																				{formatTokenCount(
																					currentLocalModel.contextLength,
																				)}
																			</div>
																			<div>
																				<span className="text-muted-foreground">
																					{t("currentModel.details.output")}
																				</span>{" "}
																				{formatTokenCount(
																					currentLocalModel.defaultMaxNewTokens,
																				)}
																			</div>
																			<div>
																				<span className="text-muted-foreground">
																					{t("currentModel.details.memory")}
																				</span>{" "}
																				{currentLocalModel.minMemoryGB} GB
																			</div>
																			<div>
																				<span className="text-muted-foreground">
																					{t("currentModel.details.release")}
																				</span>{" "}
																				{currentLocalModel.releaseDate}
																			</div>
																			{currentLocalModel.provider ===
																				"transformer" &&
																				currentLocalModel.runnerConfig && (
																					<>
																						<div>
																							<span className="text-muted-foreground">
																								{t(
																									"currentModel.details.runtime",
																								)}
																							</span>{" "}
																							{
																								currentLocalModel.runnerConfig
																									.runtime
																							}
																						</div>
																						<div>
																							<span className="text-muted-foreground">
																								{t(
																									"currentModel.details.dtype",
																								)}
																							</span>{" "}
																							{
																								currentLocalModel.runnerConfig
																									.dtype
																							}
																						</div>
																					</>
																				)}
																			{currentLocalModel.provider ===
																				"wllama" &&
																				currentLocalModel.wllamaConfig
																					?.filename && (
																					<div className="col-span-2 break-all">
																						<span className="text-muted-foreground">
																							{t("currentModel.details.file")}
																						</span>{" "}
																						{
																							currentLocalModel.wllamaConfig
																								.filename
																						}
																					</div>
																				)}
																		</div>
																	</TooltipContent>
																</Tooltip>
															)}
														</div>
														<div className="truncate text-sm text-muted-foreground">
															{currentLocalModel
																? currentLocalModel.id
																: t("currentModel.provider", {
																		provider: current.provider,
																	})}
														</div>
														{currentLocalModel && (
															<div className="mt-2 flex flex-wrap gap-2">
																<Badge variant="outline" className="text-xs">
																	{t("currentModel.details.contextShort", {
																		value: formatTokenCount(
																			currentLocalModel.contextLength,
																		),
																	})}
																</Badge>
																<Badge variant="outline" className="text-xs">
																	{t("currentModel.details.outputShort", {
																		value: formatTokenCount(
																			currentLocalModel.defaultMaxNewTokens,
																		),
																	})}
																</Badge>
																<Badge variant="outline" className="text-xs">
																	{currentLocalModel.sizeLabel}
																</Badge>
															</div>
														)}
													</div>
													<Badge
														variant="secondary"
														className="bg-primary/10 text-primary border-primary/20"
													>
														{t("currentModel.status.active")}
													</Badge>
												</div>
											</TooltipProvider>
										) : current && current.provider ? (
											<div className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-800 dark:bg-orange-950">
												<div className="h-5 w-5 rounded-full bg-orange-400 animate-pulse" />
												<div className="min-w-0 flex-1">
													<div className="font-semibold text-foreground">
														{t("currentModel.providerConfigured", {
															provider: current.provider,
														})}
													</div>
													<div className="text-sm text-muted-foreground">
														{t("currentModel.noModelLoaded")}
													</div>
												</div>
												<Badge
													variant="outline"
													className="border-orange-300 text-orange-600 dark:border-orange-700 dark:text-orange-400"
												>
													{t("currentModel.status.configured")}
												</Badge>
											</div>
										) : (
											<div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 p-3">
												<div className="h-5 w-5 rounded-full bg-muted" />
												<div className="min-w-0 flex-1">
													<div className="font-semibold text-muted-foreground">
														{t("currentModel.noModelSelected")}
													</div>
													<div className="text-sm text-muted-foreground">
														{t("currentModel.selectModel")}
													</div>
												</div>
												<Badge
													variant="outline"
													className="text-muted-foreground"
												>
													{t("currentModel.status.inactive")}
												</Badge>
											</div>
										)}
									</CardContent>
								</Card>

								<OffscreenServicesCard />

								<Card
									className="rounded-none md:rounded-lg"
									data-copilot="quick-setup"
								>
									<CardHeader className="p-3">
										<CardTitle className="text-lg">
											{t("yourModels.title")}
										</CardTitle>
										<CardDescription>
											{t("yourModels.description")}
										</CardDescription>
									</CardHeader>
									<CardContent className="p-3">
										<YourModels
											onModelLoaded={actions.handleModelLoaded}
											showQuickDownload={false}
										/>
									</CardContent>
								</Card>
							</div>
						</div>
					)}
				</aside>

				<div
					role="separator"
					aria-orientation="vertical"
					className={
						isDesktop && !isSidebarCollapsed && !isCompactSplitLayout
							? "group relative z-10 -mx-[5px] flex w-3 cursor-col-resize items-center justify-center bg-transparent"
							: "hidden"
					}
					onMouseDown={handleResizeStart}
				>
					<div className="h-full w-px bg-border/80 transition-all group-hover:w-[2px] group-hover:bg-foreground/20" />
				</div>

				<main className={isDesktop ? "min-h-0 min-w-0 overflow-y-auto" : ""}>
					<div className="w-full">
						<ProviderPanel
							{...state}
							onLoadProviderModel={actions.loadProviderModel}
							onUnloadModel={actions.unloadModel}
							onGenerate={actions.generate}
							onFetchRepoFiles={actions.fetchRepoFiles}
							onProviderChange={actions.handleProviderChange}
							onWebLLMTabSelect={actions.handleWebLLMTabSelect}
							onOpenAITabSelect={actions.handleOpenAITabSelect}
							onModelLoaded={actions.handleModelLoaded}
						/>
					</div>
				</main>
			</div>
		</div>
	);
};
