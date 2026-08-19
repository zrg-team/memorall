import {
	Brain,
	Check,
	ChevronDown,
	FileText,
	Maximize2,
	MessageCircle,
	Minimize2,
	MoreHorizontal,
	Paperclip,
	Plus,
	ScissorsLineDashed,
	Settings2,
	Square,
	Tags,
	Trash2,
} from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { AgentIcon, toAgentScreenContent } from "@/components/AgentIcon";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import {
	PromptInputSubmit,
	PromptInputToolbar,
	PromptInputTools,
} from "@/main/components/ui/shadcn-io/ai/prompt-input";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import { getAgentIconScreenFromMetadata } from "@/main/modules/agents/types";
import type { FlowMetadata } from "@/services/database/entities/flows";
import type { ChatStatus } from "@/types/chat";

/** One box for every control on the bar, so nothing shifts when state changes. */
const CONTROL =
	"h-8 rounded-xl text-xs text-muted-foreground hover:text-foreground";
const ICON_CONTROL = `${CONTROL} w-8 px-0`;

export interface ChatInputControlsProps {
	isLoading: boolean;
	model: string;
	status: ChatStatus;
	selectedTopic: string;
	setSelectedTopic: (topicId: string) => void;
	onInsertSeparator: () => void;
	onStop: () => void;
	abortController: AbortController | null;
	isLoadingTopics: boolean;
	topics: Array<{ id: string; name: string; agentId?: string | null }>;
	agentFlows: Array<{
		id: string;
		name: string;
		/** Carries the agent's icon screen; drawn by AgentIcon. */
		metadata?: FlowMetadata | null;
	}>;
	selectedAgentFlowId: string | null;
	setSelectedAgentFlowId: (flowId: string) => void;
	onCreateAgentFlow?: () => void;
	onDeleteChat: () => void;
	onOpenAgentSettings?: () => void;
	/**
	 * Measured from the composer itself, not the window — the composer lives in
	 * a resizable panel, a desktop pane and an embedded frame whose widths have
	 * nothing to do with the viewport.
	 */
	isNarrow?: boolean;
	isCustomMode: boolean;
	onAttachFileClick: () => void;
	onAttachDocumentClick: () => void;
	canSubmit: boolean;
	isFullWidth?: boolean;
	onToggleFullWidth?: () => void;
}

export const ChatInputControls: React.FC<ChatInputControlsProps> = ({
	isLoading,
	model,
	status,
	selectedTopic,
	setSelectedTopic,
	onInsertSeparator,
	onStop,
	abortController,
	isLoadingTopics,
	topics,
	agentFlows,
	selectedAgentFlowId,
	setSelectedAgentFlowId,
	onCreateAgentFlow,
	onDeleteChat,
	onOpenAgentSettings,
	isNarrow = false,
	isCustomMode,
	onAttachFileClick,
	onAttachDocumentClick,
	canSubmit,
	isFullWidth = false,
	onToggleFullWidth,
}) => {
	const { t } = useTranslation("chat");
	const flowOptions = [
		{ id: "chat", name: t("flowSelector.chat") },
		...agentFlows,
	];
	const selectedFlow = flowOptions.find(
		(flow) => flow.id === selectedAgentFlowId,
	);
	const currentAgentTopicId = topics.find(
		(topic) =>
			selectedAgentFlowId &&
			selectedAgentFlowId !== "chat" &&
			topic.agentId === selectedAgentFlowId,
	)?.id;
	const isDefaultTopicSelected = selectedTopic === "default" || !selectedTopic;
	const selectedTopicName =
		selectedTopic === "__all__"
			? t("topic.all")
			: isDefaultTopicSelected
				? t("topic.default")
				: topics.find((topic) => topic.id === selectedTopic)?.name ||
					t("topic.select");

	const fullWidthLabel = isFullWidth
		? t("tooltips.constrainChatWidth")
		: t("tooltips.expandChatWidth");
	const showAgentSettings = isCustomMode && Boolean(onOpenAgentSettings);
	// Below this width the two view controls fold into the overflow menu, where
	// they finally carry a written label. Split chat never folds: it changes what
	// the agent can see and is used mid-conversation.
	const foldViewControls = isNarrow;

	return (
		<PromptInputToolbar className="items-center gap-1 p-1.5">
			<div className="flex min-w-0 flex-1 items-center gap-1">
				<div className="min-w-0 flex-1 overflow-hidden">
					<PromptInputTools className="min-w-0 flex-nowrap gap-1">
						<DropdownMenu>
							<Tooltip>
								<TooltipTrigger asChild>
									<DropdownMenuTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											disabled={isLoading}
											className={ICON_CONTROL}
										>
											<Paperclip size={14} />
										</Button>
									</DropdownMenuTrigger>
								</TooltipTrigger>
								<TooltipContent>
									<p className="text-xs">{t("input.attachImage")}</p>
								</TooltipContent>
							</Tooltip>
							<DropdownMenuContent align="start">
								<DropdownMenuItem
									onClick={onAttachFileClick}
									className="flex items-center gap-2"
								>
									<Paperclip size={14} />
									<span>{t("input.attachFile")}</span>
								</DropdownMenuItem>
								<DropdownMenuItem
									onClick={onAttachDocumentClick}
									className="flex items-center gap-2"
								>
									<FileText size={14} />
									<span>{t("input.attachDocument")}</span>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>

						{/*
						 * Agent and memory in one chip. They sat side by side as separate
						 * chips, same shape and same height, and in agent mode they usually
						 * truncated to the same word — twice.
						 */}
						<div className="flex h-8 min-w-0 items-center rounded-xl bg-muted/40">
							<Tooltip>
								<DropdownMenu>
									<TooltipTrigger asChild>
										<DropdownMenuTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												className={cn(
													CONTROL,
													"min-w-0 max-w-[11rem] gap-1 px-2",
													isCustomMode && "rounded-r-none",
												)}
											>
												{selectedFlow?.id === "chat" ? (
													<MessageCircle size={14} />
												) : (
													<AgentIcon
														size={18}
														reactive={false}
														aria-label={selectedFlow?.name ?? "Agent"}
														screenContent={toAgentScreenContent(
															getAgentIconScreenFromMetadata(
																selectedFlow?.metadata,
															),
															selectedFlow?.name,
														)}
													/>
												)}
												<span
													className={cn(
														"min-w-0 truncate",
														isNarrow ? "max-w-16" : "max-w-24",
													)}
												>
													{selectedFlow?.name ?? t("flowSelector.chat")}
												</span>
												<ChevronDown size={10} className="opacity-50" />
											</Button>
										</DropdownMenuTrigger>
									</TooltipTrigger>
									<DropdownMenuContent align="start">
										<DropdownMenuLabel>
											{t("tooltips.flowSelector")}
										</DropdownMenuLabel>
										{flowOptions.map((flow) => (
											<DropdownMenuItem
												key={flow.id}
												onClick={() => setSelectedAgentFlowId(flow.id)}
												className={cn(
													"flex items-center gap-2",
													flow.id === selectedAgentFlowId &&
														"bg-accent/60 text-accent-foreground",
												)}
											>
												{flow.id === "chat" ? (
													<MessageCircle size={14} />
												) : (
													<AgentIcon
														size={24}
														reactive={false}
														aria-label={flow.name}
														screenContent={toAgentScreenContent(
															getAgentIconScreenFromMetadata(flow.metadata),
															flow.name,
														)}
													/>
												)}
												<span>{flow.name}</span>
												{flow.id === selectedAgentFlowId && (
													<Check size={13} className="ml-auto text-primary" />
												)}
											</DropdownMenuItem>
										))}
										<DropdownMenuSeparator />
										<DropdownMenuItem
											onClick={onCreateAgentFlow}
											className="flex items-center gap-2"
										>
											<Plus size={14} />
											<span>{t("flowSelector.create")}</span>
										</DropdownMenuItem>
									</DropdownMenuContent>
								</DropdownMenu>
								<TooltipContent>
									<p className="text-xs">{t("tooltips.flowSelector")}</p>
								</TooltipContent>
							</Tooltip>

							{isCustomMode && (
								<>
									<span
										aria-hidden="true"
										className="h-4 w-px shrink-0 bg-border/70"
									/>
									<Tooltip>
										<DropdownMenu>
											<TooltipTrigger asChild>
												<DropdownMenuTrigger asChild>
													<Button
														type="button"
														variant="ghost"
														size="sm"
														disabled={isLoadingTopics}
														className={cn(
															CONTROL,
															"min-w-0 max-w-[9rem] gap-1 rounded-l-none px-2",
														)}
													>
														<Tags size={14} />
														<span
															className={cn(
																"min-w-0 truncate",
																isNarrow ? "max-w-12" : "max-w-20",
															)}
														>
															{isLoadingTopics
																? t("topic.loading")
																: selectedTopicName}
														</span>
														<ChevronDown size={10} className="opacity-50" />
													</Button>
												</DropdownMenuTrigger>
											</TooltipTrigger>
											<DropdownMenuContent align="start">
												<DropdownMenuLabel>
													{t("tooltips.topicSelector")}
												</DropdownMenuLabel>
												<DropdownMenuItem
													onClick={() => setSelectedTopic("default")}
													className={cn(
														"flex items-center gap-2",
														isDefaultTopicSelected &&
															"bg-accent/60 text-accent-foreground",
													)}
												>
													<Tags size={14} />
													<span>{t("topic.default")}</span>
													{isDefaultTopicSelected && (
														<Check size={13} className="ml-auto text-primary" />
													)}
												</DropdownMenuItem>
												{topics.map((topic) => {
													const isSelectedTopic = topic.id === selectedTopic;
													const isCurrentAgentMemory =
														topic.id === currentAgentTopicId;

													return (
														<DropdownMenuItem
															key={topic.id}
															onClick={() => setSelectedTopic(topic.id)}
															className={cn(
																"flex items-center gap-2",
																isSelectedTopic &&
																	"bg-accent/60 text-accent-foreground",
															)}
														>
															{isCurrentAgentMemory ? (
																<Brain size={14} className="text-primary" />
															) : (
																<Tags size={14} />
															)}
															<span>{topic.name}</span>
															{isSelectedTopic && (
																<Check
																	size={13}
																	className="ml-auto text-primary"
																/>
															)}
														</DropdownMenuItem>
													);
												})}
											</DropdownMenuContent>
										</DropdownMenu>
										<TooltipContent>
											<p className="text-xs">{t("tooltips.topicSelector")}</p>
										</TooltipContent>
									</Tooltip>
								</>
							)}
						</div>
					</PromptInputTools>
				</div>

				<div className="ml-auto flex shrink-0 items-center gap-1">
					{showAgentSettings && !foldViewControls ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									onClick={onOpenAgentSettings}
									aria-label={t("tooltips.agentSettings")}
									className={ICON_CONTROL}
								>
									<Settings2 size={14} />
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p className="text-xs">{t("tooltips.agentSettings")}</p>
							</TooltipContent>
						</Tooltip>
					) : null}

					{onToggleFullWidth && !foldViewControls ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={isLoading}
									onClick={onToggleFullWidth}
									aria-label={fullWidthLabel}
									title={fullWidthLabel}
									className={ICON_CONTROL}
								>
									{isFullWidth ? (
										<Minimize2 size={14} />
									) : (
										<Maximize2 size={14} />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p className="text-xs">{fullWidthLabel}</p>
							</TooltipContent>
						</Tooltip>
					) : null}

					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								disabled={isLoading}
								onClick={onInsertSeparator}
								aria-label={t("tooltips.splitChat")}
								title={t("tooltips.splitChat")}
								className={ICON_CONTROL}
							>
								<ScissorsLineDashed size={14} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p className="text-xs">{t("tooltips.splitChat")}</p>
						</TooltipContent>
					</Tooltip>

					<Tooltip>
						<DropdownMenu>
							<TooltipTrigger asChild>
								<DropdownMenuTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										disabled={isLoading}
										aria-label={t("tooltips.moreActions")}
										className={ICON_CONTROL}
									>
										<MoreHorizontal size={14} />
									</Button>
								</DropdownMenuTrigger>
							</TooltipTrigger>
							<DropdownMenuContent align="end">
								{foldViewControls && onToggleFullWidth ? (
									<DropdownMenuItem
										onClick={onToggleFullWidth}
										className="flex items-center gap-2"
									>
										{isFullWidth ? (
											<Minimize2 size={14} />
										) : (
											<Maximize2 size={14} />
										)}
										<span>{fullWidthLabel}</span>
									</DropdownMenuItem>
								) : null}
								{foldViewControls && showAgentSettings ? (
									<DropdownMenuItem
										onClick={onOpenAgentSettings}
										className="flex items-center gap-2"
									>
										<Settings2 size={14} />
										<span>{t("tooltips.agentSettings")}</span>
									</DropdownMenuItem>
								) : null}
								<DropdownMenuItem
									onClick={onDeleteChat}
									className="flex items-center gap-2 text-red-600 hover:text-red-700"
								>
									<Trash2 size={14} />
									<span>{t("actions.deleteChat")}</span>
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<TooltipContent>
							<p className="text-xs">{t("tooltips.moreActions")}</p>
						</TooltipContent>
					</Tooltip>

					{isLoading && abortController ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									onClick={onStop}
									size="sm"
									variant="outline"
									aria-label={t("tooltips.stopGeneration")}
									className={cn(
										ICON_CONTROL,
										"border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700",
									)}
								>
									<Square size={14} />
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p className="text-xs">{t("tooltips.stopGeneration")}</p>
							</TooltipContent>
						</Tooltip>
					) : (
						<Tooltip>
							<TooltipTrigger asChild>
								<PromptInputSubmit
									data-chat-submit
									disabled={!canSubmit || isLoading || !model}
									status={status}
									className="h-8 w-8 rounded-xl bg-foreground/90 px-0 text-background shadow-sm transition hover:bg-foreground disabled:bg-muted/70 disabled:text-muted-foreground disabled:opacity-100"
								/>
							</TooltipTrigger>
							<TooltipContent>
								<p className="text-xs">{t("tooltips.sendMessage")}</p>
							</TooltipContent>
						</Tooltip>
					)}
				</div>
			</div>
		</PromptInputToolbar>
	);
};
