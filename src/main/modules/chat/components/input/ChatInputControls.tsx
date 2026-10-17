import {
	Brain,
	Check,
	ChevronDown,
	FileText,
	ListPlus,
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
	Users,
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
import type { SelectableModel } from "@/main/hooks/selectable-model";
import { getAgentIconScreenFromMetadata } from "@/main/modules/agents/types";
import { AgentTeamAvatars } from "@/main/modules/agents/components/AgentTeamAvatars";
import { FavoriteAgentStar } from "@/main/modules/agents/components/FavoriteAgentStar";
import {
	agentTeamNames,
	sortFavoritesFirst,
} from "@/main/modules/agents/utils/agent-display";
import type { ModelReasoning } from "@/services/llm/interfaces/base-llm";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import type { ReasoningEffort } from "@/types/openai";
import { ModelSelector } from "./ModelSelector";
import { ReasoningEffortSelector } from "./ReasoningEffortSelector";
import type { FlowMetadata } from "@/services/database/entities/flows";
import type { ChatStatus } from "@/types/chat";

/** One box for every control on the bar, so nothing shifts when state changes. */
const CONTROL =
	"h-8 rounded-xl text-xs text-muted-foreground hover:text-foreground";
const ICON_CONTROL = `${CONTROL} w-8 px-0`;
/** Headings inside the agent picker: Favorites, Other agents. */
const GROUP_LABEL =
	"pb-0.5 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground";
const NO_FAVORITES: string[] = [];

/** Another agent, as the picker draws it. */
interface AgentFlowSummary {
	id: string;
	name: string;
	/** Carries the agent's icon screen; drawn by AgentIcon. */
	metadata?: FlowMetadata | null;
}

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
	agentFlows: Array<
		AgentFlowSummary & {
			/** The agents it hands work to (Multi-Agent Delegation), if any. */
			team?: AgentFlowSummary[];
		}
	>;
	/** Starred agents: listed first, under Favorites. */
	favoriteAgentIds?: string[];
	/** Stars or unstars an agent; without it the picker shows no stars. */
	onToggleFavoriteAgent?: (agentId: string) => void;
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
	/**
	 * Folds the view actions (agent settings, full width, split) into the
	 * overflow menu; by default only when narrow. The composer folds them
	 * sooner, so the agent and model chips keep their names.
	 */
	foldActions?: boolean;
	isCustomMode: boolean;
	onAttachFileClick: () => void;
	onAttachDocumentClick: () => void;
	canSubmit: boolean;
	isFullWidth?: boolean;
	onToggleFullWidth?: () => void;
	/**
	 * While this chat's run goes on, a typed message can go two ways: submit
	 * hands it to the run before the agent's next step, this keeps it to send
	 * once the run finishes.
	 */
	onQueue?: () => void;
	/** Switching model without leaving the conversation. */
	selectableModels?: SelectableModel[];
	selectableModelsByProvider?: Map<ServiceProvider, SelectableModel[]>;
	lockedModelProviders?: ServiceProvider[];
	isLoadingModels?: boolean;
	onSelectModel?: (model: SelectableModel) => void;
	onRefreshModels?: () => void;
	/** The selected model's reasoning controls, when it has any. */
	reasoning?: ModelReasoning;
	reasoningEffort?: ReasoningEffort;
	onReasoningEffortChange?: (effort: ReasoningEffort | undefined) => void;
	/**
	 * The dictation button, rendered by the composer. A slot rather than a
	 * component import: it reaches the service tree, which this toolbar is
	 * kept free of.
	 */
	dictation?: React.ReactNode;
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
	favoriteAgentIds = NO_FAVORITES,
	onToggleFavoriteAgent,
	selectedAgentFlowId,
	setSelectedAgentFlowId,
	onCreateAgentFlow,
	onDeleteChat,
	onOpenAgentSettings,
	isNarrow = false,
	foldActions,
	isCustomMode,
	onAttachFileClick,
	onAttachDocumentClick,
	canSubmit,
	isFullWidth = false,
	onToggleFullWidth,
	onQueue,
	selectableModels,
	selectableModelsByProvider,
	lockedModelProviders,
	isLoadingModels = false,
	onSelectModel,
	onRefreshModels,
	reasoning,
	reasoningEffort,
	onReasoningEffortChange,
	dictation,
}) => {
	const { t } = useTranslation("chat");
	// Shown beside the model only when the model has levels to choose from.
	const reasoningControl =
		reasoning && onReasoningEffortChange
			? { reasoning, onChange: onReasoningEffortChange }
			: null;
	const flowOptions: ChatInputControlsProps["agentFlows"] = [
		{ id: "chat", name: t("flowSelector.chat") },
		...agentFlows,
	];
	const selectedFlow = flowOptions.find(
		(flow) => flow.id === selectedAgentFlowId,
	);
	const selectedTeam = selectedFlow?.team ?? [];
	// Starred agents first, under their own heading; the rest keep their order.
	const favoriteSet = new Set(favoriteAgentIds);
	const orderedAgents = sortFavoritesFirst(agentFlows, favoriteAgentIds);
	const favoriteAgents = orderedAgents.filter((flow) =>
		favoriteSet.has(flow.id),
	);
	const otherAgents = orderedAgents.filter((flow) => !favoriteSet.has(flow.id));
	const renderAgentOption = (
		flow: ChatInputControlsProps["agentFlows"][number],
	) => {
		const isSelected = flow.id === selectedAgentFlowId;
		const starred = favoriteSet.has(flow.id);
		const team = flow.team ?? [];
		return (
			<DropdownMenuItem
				key={flow.id}
				onClick={() => setSelectedAgentFlowId(flow.id)}
				className={cn(
					"group flex items-center gap-2 py-1.5",
					isSelected && "bg-accent/60 text-accent-foreground",
				)}
			>
				<AgentIcon
					size={24}
					reactive={false}
					aria-label={flow.name}
					screenContent={toAgentScreenContent(
						getAgentIconScreenFromMetadata(flow.metadata),
						flow.name,
					)}
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate">{flow.name}</span>
					{team.length > 0 ? (
						<span
							className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground"
							title={team.map((member) => member.name).join(", ")}
						>
							<Users size={11} className="shrink-0" />
							<span className="truncate">
								{t("flowSelector.team", {
									count: team.length,
									names: agentTeamNames(team.map((member) => member.name)),
								})}
							</span>
						</span>
					) : null}
				</span>
				{onToggleFavoriteAgent ? (
					<FavoriteAgentStar
						starred={starred}
						onToggle={() => onToggleFavoriteAgent(flow.id)}
						label={t(starred ? "flowSelector.unstar" : "flowSelector.star", {
							name: flow.name,
						})}
					/>
				) : null}
				<Check
					size={13}
					className={cn(
						"shrink-0 text-primary",
						isSelected ? "opacity-100" : "opacity-0",
					)}
				/>
			</DropdownMenuItem>
		);
	};
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
	// Below this width every action on the right folds into the overflow menu,
	// where each one finally carries a written label. What stays on the bar is
	// the overflow trigger and submit — the two the user cannot do without.
	const foldViewControls = foldActions ?? isNarrow;
	// While the run goes on, a typed message is sent into it or queued.
	const showRunSendControls = isLoading && canSubmit;
	const sendLabel = isLoading
		? t("tooltips.sendToRun", "Send now: the agent reads it at its next step")
		: t("tooltips.sendMessage");
	const queueLabel = t(
		"tooltips.queueMessage",
		"Queue: send when this reply finishes",
	);

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

						{dictation}

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
												) : selectedFlow && selectedTeam.length > 0 ? (
													// A team lead: its face in front of two of its team's;
													// the tooltip names everyone it hands work to.
													<AgentTeamAvatars
														agents={[selectedFlow, ...selectedTeam]}
														max={3}
														size={18}
														showRest={false}
														className="mr-0.5"
													/>
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
														isNarrow ? "max-w-14" : "max-w-24",
													)}
												>
													{selectedFlow?.name ?? t("flowSelector.chat")}
												</span>
												<ChevronDown size={10} className="opacity-50" />
											</Button>
										</DropdownMenuTrigger>
									</TooltipTrigger>
									<DropdownMenuContent
										align="start"
										className="max-h-[min(32rem,70vh)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto"
									>
										<DropdownMenuLabel>
											{t("tooltips.flowSelector")}
										</DropdownMenuLabel>
										<DropdownMenuItem
											onClick={() => setSelectedAgentFlowId("chat")}
											className={cn(
												"flex items-center gap-2",
												selectedAgentFlowId === "chat" &&
													"bg-accent/60 text-accent-foreground",
											)}
										>
											<span className="flex h-6 w-6 shrink-0 items-center justify-center">
												<MessageCircle size={14} />
											</span>
											<span className="flex-1">{t("flowSelector.chat")}</span>
											<Check
												size={13}
												className={cn(
													"shrink-0 text-primary",
													selectedAgentFlowId === "chat"
														? "opacity-100"
														: "opacity-0",
												)}
											/>
										</DropdownMenuItem>
										{favoriteAgents.length > 0 ? (
											<>
												<DropdownMenuLabel className={GROUP_LABEL}>
													{t("flowSelector.favorites")}
												</DropdownMenuLabel>
												{favoriteAgents.map(renderAgentOption)}
												{otherAgents.length > 0 ? (
													<DropdownMenuLabel className={GROUP_LABEL}>
														{t("flowSelector.otherAgents")}
													</DropdownMenuLabel>
												) : null}
											</>
										) : null}
										{otherAgents.map(renderAgentOption)}
										{onToggleFavoriteAgent &&
										favoriteAgents.length === 0 &&
										otherAgents.length > 2 ? (
											<p className="px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground">
												{t("flowSelector.starHint")}
											</p>
										) : null}
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
								<TooltipContent className="max-w-72">
									{selectedTeam.length > 0 ? (
										<>
											<p className="text-xs font-medium">
												{selectedFlow?.name}
											</p>
											<p className="text-xs opacity-80">
												{t("flowSelector.teamTooltip", {
													names: selectedTeam
														.map((member) => member.name)
														.join(", "),
												})}
											</p>
										</>
									) : (
										<p className="text-xs">{t("tooltips.flowSelector")}</p>
									)}
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
																isNarrow ? "max-w-10" : "max-w-20",
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

						{/*
						 * Right of the agent, because the two are read together: which
						 * agent, running on which model. Its own pill rather than a third
						 * segment of that one — the agent and its memory belong together,
						 * the model is a separate choice.
						 */}
						{onSelectModel && selectableModelsByProvider ? (
							<div className="flex h-8 min-w-0 items-center rounded-xl bg-muted/40">
								<ModelSelector
									models={selectableModels ?? []}
									byProvider={selectableModelsByProvider}
									currentModelId={model}
									isLoading={isLoadingModels}
									onSelect={onSelectModel}
									lockedProviders={lockedModelProviders}
									onOpen={onRefreshModels}
									isNarrow={isNarrow}
									disabled={isLoading}
									className={reasoningControl ? "rounded-r-none" : undefined}
								/>
								{/* The model and how hard it thinks, split like agent and memory. */}
								{reasoningControl ? (
									<>
										<span
											aria-hidden="true"
											className="h-4 w-px shrink-0 bg-border/70"
										/>
										<ReasoningEffortSelector
											reasoning={reasoningControl.reasoning}
											value={reasoningEffort}
											onChange={reasoningControl.onChange}
											disabled={isLoading}
											isNarrow={isNarrow}
											className="rounded-l-none"
										/>
									</>
								) : null}
							</div>
						) : null}
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

					{!foldViewControls ? (
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
					) : null}

					{/* At full width every action in here already has its own button,
					    so the menu only duplicated them. It stays for the narrow layout,
					    which is where those buttons are folded away. */}
					{foldViewControls ? (
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
									{foldViewControls ? (
										<DropdownMenuItem
											onClick={onInsertSeparator}
											className="flex items-center gap-2"
										>
											<ScissorsLineDashed size={14} />
											<span>{t("tooltips.splitChat")}</span>
										</DropdownMenuItem>
									) : null}
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
					) : null}

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
					) : null}

					{/* Left of send: the slower of the two ways a message can go. */}
					{showRunSendControls && onQueue ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="outline"
									size="sm"
									onClick={onQueue}
									aria-label={queueLabel}
									data-chat-queue
									className={ICON_CONTROL}
								>
									<ListPlus size={14} />
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p className="text-xs">{queueLabel}</p>
							</TooltipContent>
						</Tooltip>
					) : null}

					{!isLoading || showRunSendControls ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<PromptInputSubmit
									data-chat-submit
									aria-label={sendLabel}
									disabled={!canSubmit || !model}
									// After a failed turn it still sends: the error is shown
									// in the turn, and an X here read as "close". During a run
									// it sends too, into the run.
									status={isLoading || status === "error" ? "ready" : status}
									className="h-8 w-8 rounded-xl bg-foreground/90 px-0 text-background shadow-sm transition hover:bg-foreground disabled:bg-muted/70 disabled:text-muted-foreground disabled:opacity-100"
								/>
							</TooltipTrigger>
							<TooltipContent>
								<p className="text-xs">{sendLabel}</p>
							</TooltipContent>
						</Tooltip>
					) : null}
				</div>
			</div>
		</PromptInputToolbar>
	);
};
