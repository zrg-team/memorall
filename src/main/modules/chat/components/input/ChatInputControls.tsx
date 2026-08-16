import React from "react";
import { useTranslation } from "react-i18next";
import {
	Square,
	Plus,
	Brain,
	MessageCircle,
	ChevronDown,
	Tags,
	Trash2,
	MoreHorizontal,
	Settings2,
	Paperclip,
	FileText,
	Check,
	Maximize2,
	Minimize2,
} from "lucide-react";

import {
	PromptInputSubmit,
	PromptInputToolbar,
	PromptInputTools,
} from "@/main/components/ui/shadcn-io/ai/prompt-input";
import { Button } from "@/main/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import type { ChatStatus } from "@/types/chat";
import { cn } from "@/lib/utils";

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
	agentFlows: Array<{ id: string; name: string }>;
	selectedAgentFlowId: string | null;
	setSelectedAgentFlowId: (flowId: string) => void;
	onCreateAgentFlow?: () => void;
	onDeleteChat: () => void;
	onOpenAgentSettings?: () => void;
	compactControls?: boolean;
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
	compactControls = false,
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

	return (
		<PromptInputToolbar className="items-center gap-1 p-1.5">
			<div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1.5">
				<div className="min-w-0 flex-1 basis-[13rem] overflow-hidden">
					<PromptInputTools className="min-w-0 flex-wrap gap-x-1 gap-y-1">
						<DropdownMenu>
							<Tooltip>
								<TooltipTrigger asChild>
									<DropdownMenuTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											disabled={isLoading}
											className="h-9 min-w-9 rounded-xl px-2 text-xs text-muted-foreground hover:text-foreground"
										>
											<Paperclip size={12} />
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

						<Tooltip>
							<DropdownMenu>
								<TooltipTrigger asChild>
									<DropdownMenuTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											className="h-9 min-w-0 max-w-[11rem] gap-1 rounded-xl px-2 text-xs text-muted-foreground hover:text-foreground"
										>
											{selectedFlow?.id === "chat" ? (
												<MessageCircle size={12} />
											) : (
												<Brain size={12} />
											)}
											<span className="min-w-0 max-w-24 truncate max-[420px]:max-w-16">
												{selectedFlow?.name ?? t("flowSelector.chat")}
											</span>
											<ChevronDown size={10} className="opacity-50" />
										</Button>
									</DropdownMenuTrigger>
								</TooltipTrigger>
								<DropdownMenuContent align="start">
									{flowOptions.map((flow) => (
										<DropdownMenuItem
											key={flow.id}
											onClick={() => setSelectedAgentFlowId(flow.id)}
											className="flex items-center gap-2"
										>
											{flow.id === "chat" ? (
												<MessageCircle size={14} />
											) : (
												<Brain size={14} />
											)}
											<span>{flow.name}</span>
										</DropdownMenuItem>
									))}
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
								<Tooltip>
									<DropdownMenu>
										<TooltipTrigger asChild>
											<DropdownMenuTrigger asChild>
												<Button
													type="button"
													variant="ghost"
													size="sm"
													disabled={isLoadingTopics}
													className="h-9 min-w-0 max-w-[9rem] gap-1 rounded-xl px-2 text-xs text-muted-foreground hover:text-foreground"
												>
													<Tags size={12} />
													<span className="min-w-0 max-w-20 truncate max-[420px]:max-w-12">
														{isLoadingTopics
															? t("topic.loading")
															: selectedTopicName}
													</span>
													<ChevronDown size={10} className="opacity-50" />
												</Button>
											</DropdownMenuTrigger>
										</TooltipTrigger>
										<DropdownMenuContent align="start">
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

								{!compactControls ? (
									<Tooltip>
										<TooltipTrigger asChild>
											<Button
												type="button"
												variant="ghost"
												size="sm"
												onClick={onOpenAgentSettings}
												className="h-9 min-w-9 rounded-xl px-2 text-xs text-muted-foreground hover:text-foreground"
											>
												<Settings2 size={12} />
											</Button>
										</TooltipTrigger>
										<TooltipContent>
											<p className="text-xs">{t("tooltips.agentSettings")}</p>
										</TooltipContent>
									</Tooltip>
								) : null}
							</>
						)}
					</PromptInputTools>
				</div>

				<div className="ml-auto flex shrink-0 items-center gap-1">
					{onToggleFullWidth ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									disabled={isLoading}
									onClick={onToggleFullWidth}
									aria-label={
										isFullWidth
											? "Constrain chat width"
											: "Expand chat to full width"
									}
									title={
										isFullWidth
											? "Constrain chat width"
											: "Expand chat to full width"
									}
									className="h-9 w-9 rounded-xl px-0 text-xs text-muted-foreground hover:text-foreground"
								>
									{isFullWidth ? (
										<Minimize2 size={12} />
									) : (
										<Maximize2 size={12} />
									)}
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<p className="text-xs">
									{isFullWidth
										? "Constrain chat width"
										: "Expand chat to full width"}
								</p>
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
								aria-label={t("tooltips.newMessage")}
								title={t("tooltips.newMessage")}
								className="h-8 w-8 rounded-xl px-0 text-xs text-muted-foreground hover:text-foreground"
							>
								<Plus size={12} />
							</Button>
						</TooltipTrigger>
						<TooltipContent>
							<p className="text-xs">{t("tooltips.newMessage")}</p>
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
										className="h-8 w-8 rounded-xl px-0 text-muted-foreground hover:text-foreground"
									>
										<MoreHorizontal size={14} />
									</Button>
								</DropdownMenuTrigger>
							</TooltipTrigger>
							<DropdownMenuContent align="end">
								{compactControls && isCustomMode && onOpenAgentSettings ? (
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
									className="h-10 w-10 rounded-[16px] border-red-200 px-0 text-red-600 hover:bg-red-50"
								>
									<Square size={16} />
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
									className="h-9 w-9 rounded-xl bg-foreground/90 text-background shadow-sm transition hover:bg-foreground disabled:bg-muted/70 disabled:text-muted-foreground disabled:opacity-100"
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
