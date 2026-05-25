"use client";
import React, { useEffect, useRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUp, History, MessageSquare, X } from "lucide-react";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/main/components/ui/shadcn-io/ai/conversation";
import {
	LoadingScreen,
	NoModelsScreen,
	ChatInput,
	ChatEmptyState,
	useCurrentModel,
	useChat,
	ModelLoadPrompt,
	AgentContextWarningBanner,
	SmartSelectContextBanner,
	useSmartSelectContext,
} from "@/main/modules/chat/components";
import { MessageGroup } from "@/main/modules/chat/components/MessageGroup";
import type {
	AgentGreetingContext,
	AgentScreenContent,
} from "@/components/AgentIcon";
import { Button } from "@/main/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import { topicService } from "@/main/modules/topics/services/topic-service";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import type { Flow, Topic } from "@/services/database/types";
import {
	useDownloadProgress,
	ModelDownloadingScreen,
} from "@/main/modules/llm/components";
import { serviceManager } from "@/services";
import type { AttachedDocumentRef } from "@/types/chat";
import { ChatSidePanel } from "@/main/components/molecules/ChatSidePanel";
import { useRuntimeSessionsStore } from "@/main/stores/runtime-sessions";
import { useShellLayoutStore } from "@/main/stores/shell-layout";
import { isPopupSurface } from "@/utils/dom";
import { getAgentIconScreenFromMetadata } from "@/main/modules/agents/types";
import type { FeatureCatalogMetadata } from "@/services/flows/feature-catalog-registry";
import {
	formatOpenUIFormStateContext,
	getOpenUISendMessageText,
	isAllowedOpenUIRoute,
	MEMORALL_OPENUI_ACTION_EVENT,
	normalizeOpenUIDocumentPath,
	resolveOpenUITemplate,
	type MemorallOpenUIActionDetail,
} from "@/main/modules/openui/actions";

type AgentFlowOption = Pick<Flow, "id" | "name" | "metadata">;

const RETRIEVAL_STEP_NAMES = new Set([
	"context-smart-retrieve",
	"context-quick-retrieve",
	"context-llm-retrieve",
	"structmem-retrieval",
]);

interface ChatPageProps {
	onOpenAgentWorkspace?: () => void;
	hideWideSidePanelCollapsedToggle?: boolean;
	isNarrowChatPanel?: boolean;
	onCompactChatListOpenChange?: (open: boolean) => void;
	useIconOnlyHistoryButton?: boolean;
}

export const ChatPage: React.FC<ChatPageProps> = ({
	onOpenAgentWorkspace,
	hideWideSidePanelCollapsedToggle = false,
	isNarrowChatPanel = false,
	onCompactChatListOpenChange,
	useIconOnlyHistoryButton = false,
}) => {
	const navigate = useNavigate();
	const location = useLocation();
	const { t } = useTranslation(["chat"]);
	const { model, current, isInitialized, handleModelLoaded } =
		useCurrentModel();
	const {
		downloadProgress,
		setDownloadProgress,
		quickDownloadModel,
		setQuickDownloadModel,
	} = useDownloadProgress();
	const [topics, setTopics] = React.useState<
		Array<Pick<Topic, "id" | "name" | "agentId" | "growType" | "recallType">>
	>([]);
	const [isLoadingTopics, setIsLoadingTopics] = React.useState(false);
	const [agentFlows, setAgentFlows] = React.useState<AgentFlowOption[]>([]);
	const [selectedAgentFeatureNames, setSelectedAgentFeatureNames] =
		React.useState<string[]>([]);
	const [selectedAgentFeatureLabels, setSelectedAgentFeatureLabels] =
		React.useState<string[]>([]);
	const { isOpen, open } = useAgentConfigStore();
	const refreshRuntimeSessions = useRuntimeSessionsStore(
		(state) => state.refresh,
	);
	const setRightPanelCollapsed = useShellLayoutStore(
		(state) => state.setRightPanelCollapsed,
	);
	const setRightWorkspaceTab = useShellLayoutStore(
		(state) => state.setRightWorkspaceTab,
	);
	const [attachedImages, setAttachedImages] = React.useState<File[]>([]);
	const [attachedDocumentRefs, setAttachedDocumentRefs] = React.useState<
		AttachedDocumentRef[]
	>([]);
	const topicSelectionSourceRef = useRef<"auto" | "manual">("auto");
	const { smartSelectContext, setSmartSelectContext } = useSmartSelectContext();
	const [isChatInputModelReady, setIsChatInputModelReady] =
		React.useState(true);
	const [showPreviousGroups, setShowPreviousGroups] = React.useState(false);
	const [isCompactSidePanelOpen, setIsCompactSidePanelOpen] =
		React.useState(false);
	const [isChatFullWidth, setIsChatFullWidth] = React.useState(false);
	const [expandedMessageGroupId, setExpandedMessageGroupId] = React.useState<
		string | null
	>(null);
	const latestPreviousGroupRef = useRef<HTMLDivElement | null>(null);
	const completedGroupRefs = useRef(new Map<string, HTMLDivElement>());
	const shouldScrollToPreviousGroupsRef = useRef(false);
	const pendingGroupScrollRef = useRef<string | null>(null);

	const {
		inputValue,
		setInputValue,
		status,
		chatMode,
		selectedTopic,
		setSelectedTopic,
		selectedAgentFlowId,
		setSelectedAgentFlowId,
		messageGroups,
		isLoading,
		abortController,
		inProgressMessage,
		handleSubmit,
		handleStop,
		insertSeparator,
		loadMessageGroup,
		deleteMessages,
		submitMessage,
	} = useChat(model);

	const handleChatSubmit = (
		e: React.FormEvent,
		images: File[],
		docRefs: AttachedDocumentRef[],
	) => {
		const contextPrefix = smartSelectContext
			? `[Smart Select: ${smartSelectContext.label}]\n${smartSelectContext.content}`
			: undefined;
		handleSubmit(e, images, docRefs, contextPrefix);
		setSmartSelectContext(null);
		setAttachedImages([]);
		setAttachedDocumentRefs([]);
	};

	useEffect(() => {
		onCompactChatListOpenChange?.(isCompactSidePanelOpen);
	}, [isCompactSidePanelOpen, onCompactChatListOpenChange]);

	useEffect(() => {
		if (!isNarrowChatPanel && isCompactSidePanelOpen) {
			setIsCompactSidePanelOpen(false);
		}
	}, [isCompactSidePanelOpen, isNarrowChatPanel]);

	useEffect(() => {
		const handleOpenUIAction = (event: Event) => {
			const detail = (event as CustomEvent<MemorallOpenUIActionDetail>).detail;
			if (!detail?.action) return;

			const action = detail.action;
			if (action.type === "send_message") {
				const message = getOpenUISendMessageText(
					action,
					detail.formState,
					detail.formName,
					detail.humanFriendlyMessage,
				);
				const shouldIncludeFormState =
					action.includeFormState ?? Boolean(detail.formName);
				const formContext = shouldIncludeFormState
					? formatOpenUIFormStateContext(detail.formState, detail.formName)
					: undefined;
				submitMessage({
					inputText: message,
					contextPrefix: formContext,
					clearComposer: false,
				});
				return;
			}

			if (action.type === "add_message_to_input") {
				const text = resolveOpenUITemplate(
					action.text,
					detail.formState,
					detail.formName,
				);
				if (action.mode === "replace") {
					setInputValue(text);
					return;
				}
				setInputValue(inputValue.trim() ? `${inputValue}\n${text}` : text);
				return;
			}

			if (action.type === "open_document") {
				const path = normalizeOpenUIDocumentPath(
					resolveOpenUITemplate(action.path, detail.formState, detail.formName),
				);
				if (!path) return;
				navigate("/documents", {
					state: { openDocumentPath: path },
				});
				return;
			}

			if (action.type === "open_route") {
				const route = resolveOpenUITemplate(
					action.route,
					detail.formState,
					detail.formName,
				).trim();
				if (isAllowedOpenUIRoute(route)) {
					navigate(route);
				}
			}
		};

		window.addEventListener(MEMORALL_OPENUI_ACTION_EVENT, handleOpenUIAction);
		return () =>
			window.removeEventListener(
				MEMORALL_OPENUI_ACTION_EVENT,
				handleOpenUIAction,
			);
	}, [inputValue, navigate, setInputValue, submitMessage]);

	// Refresh after each assistant response finishes
	const wasInProgressRef = useRef(false);
	useEffect(() => {
		const isNow = inProgressMessage != null;
		if (!isNow && wasInProgressRef.current) {
			void (async () => {
				await refreshRuntimeSessions();
				const hasSandboxServer =
					useRuntimeSessionsStore.getState().servers.length > 0;
				if (hasSandboxServer) {
					setRightPanelCollapsed(false);
					setRightWorkspaceTab("page");
					navigate("/runtime");
				}
			})();
		}
		wasInProgressRef.current = isNow;
	}, [
		inProgressMessage,
		navigate,
		refreshRuntimeSessions,
		setRightPanelCollapsed,
		setRightWorkspaceTab,
	]);

	const completedGroups = useMemo(
		() => messageGroups.filter((group) => !group.isLatest),
		[messageGroups],
	);
	const latestGroup = useMemo(
		() => messageGroups.find((group) => group.isLatest) ?? null,
		[messageGroups],
	);
	const latestGroupIsEmpty =
		latestGroup?.messages.length === 0 && !inProgressMessage;
	const completedGroupsIds = useMemo(
		() =>
			completedGroups
				.map((group) => `${group.id}:${group.isLoaded ? "loaded" : "empty"}`)
				.join(","),
		[completedGroups],
	);

	const setCompletedGroupRef = React.useCallback(
		(groupId: string, element: HTMLDivElement | null) => {
			if (element) {
				completedGroupRefs.current.set(groupId, element);
				return;
			}
			completedGroupRefs.current.delete(groupId);
		},
		[],
	);

	// Memoized completed components - only re-render when completed groups actually change
	const completedMessageGroups = useMemo(() => {
		return completedGroups.map((group, index) => (
			<div
				key={group.id}
				ref={(element) => {
					setCompletedGroupRef(group.id, element);
					if (index === completedGroups.length - 1) {
						latestPreviousGroupRef.current = element;
					}
				}}
			>
				<MessageGroup
					group={group}
					inProgressMessage={null}
					defaultCollapsed={true}
					selectedTopic={selectedTopic}
					forceExpanded={expandedMessageGroupId === group.id}
					suppressSeparator={
						!showPreviousGroups &&
						latestGroupIsEmpty &&
						latestGroup?.previousSeparator?.id === group.separator?.id
					}
					onLoadMessages={loadMessageGroup}
				/>
			</div>
		));
	}, [
		completedGroupsIds,
		completedGroups,
		latestGroup?.previousSeparator?.id,
		latestGroupIsEmpty,
		loadMessageGroup,
		selectedTopic,
		setCompletedGroupRef,
		expandedMessageGroupId,
		showPreviousGroups,
	]);

	const scrollToPreviousGroups = React.useCallback(() => {
		latestPreviousGroupRef.current?.scrollIntoView({
			behavior: "smooth",
			block: "end",
		});
	}, []);

	const scrollToGroup = React.useCallback(
		(groupId: string) => {
			const groupElement = completedGroupRefs.current.get(groupId);
			if (groupElement) {
				groupElement.scrollIntoView({
					behavior: "smooth",
					block: "center",
				});
				return;
			}
			scrollToPreviousGroups();
		},
		[scrollToPreviousGroups],
	);

	const handlePreviousGroupsClick = React.useCallback(() => {
		if (showPreviousGroups) {
			scrollToPreviousGroups();
			return;
		}

		shouldScrollToPreviousGroupsRef.current = true;
		setShowPreviousGroups(true);
	}, [scrollToPreviousGroups, showPreviousGroups]);

	const handleConversationGroupSelect = React.useCallback(
		(groupId: string) => {
			const group = messageGroups.find((item) => item.id === groupId);
			if (!group || group.isLatest) {
				setShowPreviousGroups(false);
				setExpandedMessageGroupId(null);
				return;
			}

			pendingGroupScrollRef.current = groupId;
			setExpandedMessageGroupId(groupId);
			setShowPreviousGroups(true);
			if (showPreviousGroups) {
				requestAnimationFrame(() => scrollToGroup(groupId));
			}
		},
		[messageGroups, scrollToGroup, showPreviousGroups],
	);

	useEffect(() => {
		if (!showPreviousGroups || !shouldScrollToPreviousGroupsRef.current) return;

		shouldScrollToPreviousGroupsRef.current = false;
		requestAnimationFrame(() => {
			scrollToPreviousGroups();
		});
	}, [scrollToPreviousGroups, showPreviousGroups]);

	useEffect(() => {
		if (!showPreviousGroups || !pendingGroupScrollRef.current) return;

		const groupId = pendingGroupScrollRef.current;
		pendingGroupScrollRef.current = null;
		requestAnimationFrame(() => {
			scrollToGroup(groupId);
		});
	}, [scrollToGroup, showPreviousGroups]);

	// Fetch topics when custom mode is selected
	useEffect(() => {
		if (chatMode === "custom") {
			const fetchTopics = async () => {
				try {
					setIsLoadingTopics(true);
					const result = await topicService.getTopics();
					setTopics(
						result.map((topic) => ({
							id: topic.id,
							name: topic.name,
							agentId: topic.agentId,
							growType: topic.growType,
							recallType: topic.recallType,
						})),
					);
				} catch (error) {
					setTopics([]);
				} finally {
					setIsLoadingTopics(false);
				}
			};

			fetchTopics();
		}
	}, [chatMode]);

	useEffect(() => {
		const loadFlows = async () => {
			try {
				const flows =
					await serviceManager.flowBuilderService.listPredefinedFlows(
						"foundation",
					);
				const mapped = flows
					.filter((flow) => flow.status === "active")
					.map((flow) => ({
						id: flow.id,
						name: flow.name,
						metadata: flow.metadata,
					}));
				setAgentFlows(mapped);
				if (!selectedAgentFlowId && mapped.length > 0) {
					setSelectedAgentFlowId(mapped[0].id);
				} else if (
					selectedAgentFlowId &&
					selectedAgentFlowId !== "chat" &&
					!mapped.some((flow) => flow.id === selectedAgentFlowId)
				) {
					setSelectedAgentFlowId(mapped[0]?.id ?? "chat");
				}
			} catch {
				setAgentFlows([]);
			}
		};
		loadFlows();
	}, [selectedAgentFlowId, setSelectedAgentFlowId]);

	useEffect(() => {
		let cancelled = false;

		const loadSelectedAgentFeatures = async () => {
			if (!selectedAgentFlowId || selectedAgentFlowId === "chat") {
				setSelectedAgentFeatureNames([]);
				setSelectedAgentFeatureLabels([]);
				return;
			}

			try {
				const [config, catalog] = await Promise.all([
					serviceManager.flowBuilderService.getUnifiedFlowConfig({
						flowId: selectedAgentFlowId,
					}),
					Promise.resolve(serviceManager.flowBuilderService.getCatalog()),
				]);
				if (cancelled) return;

				const catalogFeatures = new Map(
					catalog.steps
						.filter((step) => step.type === "feature")
						.map((step) => [
							step.name,
							step.metadata as FeatureCatalogMetadata,
						]),
				);
				const names: string[] = [];
				const labels: string[] = [];
				const addFeature = (name: string, label: string) => {
					if (names.includes(name)) return;
					names.push(name);
					labels.push(label);
				};

				if (
					config.steps.some(
						(step) => step.enabled && RETRIEVAL_STEP_NAMES.has(step.name),
					)
				) {
					addFeature(
						"knowledge-retrieval",
						t("agentSettings.contextRetrieval"),
					);
				}
				if (
					config.steps.some(
						(step) => step.enabled && step.name === "entities-facts-citation",
					)
				) {
					addFeature("citations", t("agentSettings.citations"));
				}

				for (const step of config.steps) {
					if (!step.enabled) continue;
					const metadata = catalogFeatures.get(step.name);
					if (!metadata) continue;
					addFeature(
						step.name,
						metadata.nameKey
							? t(metadata.nameKey)
							: (metadata.displayName ?? step.name),
					);
				}

				setSelectedAgentFeatureNames(names);
				setSelectedAgentFeatureLabels(labels);
			} catch {
				if (!cancelled) {
					setSelectedAgentFeatureNames([]);
					setSelectedAgentFeatureLabels([]);
				}
			}
		};

		void loadSelectedAgentFeatures();
		return () => {
			cancelled = true;
		};
	}, [selectedAgentFlowId, t]);

	const getAgentTopicId = React.useCallback(
		(flowId: string) =>
			flowId === "chat"
				? "default"
				: (topics.find((topic) => topic.agentId === flowId)?.id ?? "default"),
		[topics],
	);

	const handleSelectAgentFlow = React.useCallback(
		(flowId: string) => {
			topicSelectionSourceRef.current = "auto";
			setSelectedAgentFlowId(flowId);
			setSelectedTopic(getAgentTopicId(flowId));
		},
		[getAgentTopicId, setSelectedAgentFlowId, setSelectedTopic],
	);

	const handleSelectTopic = React.useCallback(
		(topicId: string) => {
			topicSelectionSourceRef.current = "manual";
			setSelectedTopic(topicId);
		},
		[setSelectedTopic],
	);

	useEffect(() => {
		const requestedAgentFlowId = (
			location.state as { selectedAgentFlowId?: string } | null
		)?.selectedAgentFlowId;
		if (!requestedAgentFlowId) return;
		if (
			requestedAgentFlowId !== "chat" &&
			!agentFlows.some((flow) => flow.id === requestedAgentFlowId)
		) {
			return;
		}

		topicSelectionSourceRef.current = "auto";
		if (selectedAgentFlowId !== requestedAgentFlowId) {
			setSelectedAgentFlowId(requestedAgentFlowId);
		}
		setSelectedTopic(getAgentTopicId(requestedAgentFlowId));
		navigate(`${location.pathname}${location.search}`, {
			replace: true,
			state: null,
		});
	}, [
		agentFlows,
		getAgentTopicId,
		location.pathname,
		location.search,
		location.state,
		navigate,
		selectedAgentFlowId,
		setSelectedAgentFlowId,
		setSelectedTopic,
	]);

	useEffect(() => {
		if (!selectedAgentFlowId || topicSelectionSourceRef.current === "manual") {
			return;
		}

		const agentTopicId = getAgentTopicId(selectedAgentFlowId);
		if (selectedTopic !== agentTopicId) {
			setSelectedTopic(agentTopicId);
		}
	}, [getAgentTopicId, selectedAgentFlowId, selectedTopic, setSelectedTopic]);

	useEffect(() => {
		if (!isOpen) return;
		void useAgentConfigStore.getState().initialize(selectedAgentFlowId);
	}, [isOpen, selectedAgentFlowId]);

	const handleCreateAgentFlow = async () => {
		const input = window.prompt("Flow name", "");
		const name = input?.trim();
		if (!name) return;
		try {
			const created =
				await serviceManager.flowBuilderService.createPredefinedFlow(
					"foundation",
					name,
				);
			const nextFlows = [
				{ id: created.id, name: created.name, metadata: created.metadata },
				...agentFlows,
			];
			setAgentFlows(nextFlows);
			topicSelectionSourceRef.current = "auto";
			setSelectedAgentFlowId(created.id);
			setSelectedTopic("default");
			if (isOpen) {
				await useAgentConfigStore.getState().initialize(created.id);
			}
		} catch {
			// no-op for now
		}
	};

	const navigateToModels = () => {
		navigate("/llm");
	};

	const isPopup = isPopupSurface();
	const isCompactChatSurface =
		isPopup || useIconOnlyHistoryButton || isNarrowChatPanel;
	const isWideChatSidePanelVisible = !isCompactChatSurface;
	const isCompactSidePanelAvailable = !isWideChatSidePanelVisible;
	const isCompactEmptyLanding =
		isCompactChatSurface && latestGroupIsEmpty && !showPreviousGroups;

	const selectedAgent = useMemo(
		() => agentFlows.find((flow) => flow.id === selectedAgentFlowId),
		[agentFlows, selectedAgentFlowId],
	);
	const selectedAgentIconScreenContent = useMemo(() => {
		const iconScreen = getAgentIconScreenFromMetadata(selectedAgent?.metadata);
		if (!iconScreen) return undefined;

		return {
			kind: iconScreen.kind,
			value: iconScreen.value,
			color: iconScreen.color,
			scale: iconScreen.kind === "emoji" ? 0.72 : 0.52,
		} satisfies AgentScreenContent;
	}, [selectedAgent]);
	const agentGreetingContext = useMemo<AgentGreetingContext>(
		() => ({
			selectedAgentName: selectedAgent?.name,
			agentNames: agentFlows.map((flow) => flow.name),
			agentCount: agentFlows.length,
			featureNames: selectedAgentFeatureNames,
			featureLabels: selectedAgentFeatureLabels,
		}),
		[
			agentFlows,
			selectedAgent?.name,
			selectedAgentFeatureLabels,
			selectedAgentFeatureNames,
		],
	);
	const shouldShowAgentBuilderCallout = agentFlows.length === 1;
	const handleOpenAgentWizard = React.useCallback(() => {
		navigate("/agents", { state: { openAgentWizard: true } });
	}, [navigate]);

	if (!isInitialized) {
		return <LoadingScreen />;
	}

	// Check if model is currently downloading
	const isModelDownloading =
		downloadProgress.percent > 0 && downloadProgress.percent < 100;

	// Show download progress if model is being downloaded
	if (isModelDownloading) {
		return (
			<ModelDownloadingScreen
				downloadProgress={downloadProgress}
				modelName={quickDownloadModel}
			/>
		);
	}

	// Show YourModels component if no loaded models available
	if (!model) {
		return (
			<NoModelsScreen
				onModelLoaded={handleModelLoaded}
				onNavigateToModels={navigateToModels}
			/>
		);
	}

	return (
		<div
			className="flex h-full bg-background text-foreground [background-image:linear-gradient(180deg,hsl(var(--muted)/0.28)_0%,transparent_190px)]"
			data-copilot="chat-center"
			data-agent-cursor-point="copilot-chat-center"
		>
			{isWideChatSidePanelVisible ? (
				<ChatSidePanel
					showCollapsedToggle={!hideWideSidePanelCollapsedToggle}
					onShowConversationGroup={handleConversationGroupSelect}
				/>
			) : null}
			<div className="chat-panel-container relative flex min-w-0 flex-1 flex-col overflow-hidden">
				<AnimatePresence>
					{isCompactSidePanelAvailable && isCompactSidePanelOpen ? (
						<motion.div
							initial={{ opacity: 0, x: -18 }}
							animate={{ opacity: 1, x: 0 }}
							exit={{ opacity: 0, x: -18 }}
							transition={{ duration: 0.18, ease: "easeOut" }}
							className="absolute inset-y-0 left-0 z-40 w-full max-w-full bg-background/95 shadow-xl backdrop-blur-xl"
						>
							<ChatSidePanel
								defaultCollapsed={false}
								allowCollapse={false}
								allowResize={false}
								onClose={() => setIsCompactSidePanelOpen(false)}
								onShowConversationGroup={(groupId) => {
									handleConversationGroupSelect(groupId);
									setIsCompactSidePanelOpen(false);
								}}
							/>
						</motion.div>
					) : null}
				</AnimatePresence>
				<Conversation className="min-h-0 flex-1 bg-transparent">
					{isCompactSidePanelAvailable ? (
						<div className="absolute left-2 top-2 z-30">
							<Button
								type="button"
								variant="ghost"
								size="icon"
								className="h-8 w-8 text-muted-foreground hover:bg-muted hover:text-foreground"
								aria-label="Open chat side panel"
								onClick={() => setIsCompactSidePanelOpen(true)}
							>
								<MessageSquare size={16} />
							</Button>
						</div>
					) : null}

					{completedGroups.length > 0 ? (
						<div className="pointer-events-none absolute left-0 right-0 top-4 z-20 flex justify-center">
							<TooltipProvider>
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											type="button"
											variant="ghost"
											size={useIconOnlyHistoryButton ? "icon" : "sm"}
											className={`pointer-events-auto h-9 rounded-full border border-border/70 bg-background/90 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-xl hover:bg-accent/70 hover:text-foreground ${
												useIconOnlyHistoryButton ? "w-9 px-0" : "px-4"
											}`}
											onClick={handlePreviousGroupsClick}
											aria-label={
												showPreviousGroups
													? t("history.scrollUp")
													: t("history.showPrevious", {
															count: completedGroups.length,
														})
											}
										>
											{useIconOnlyHistoryButton ? (
												showPreviousGroups ? (
													<ArrowUp size={14} />
												) : (
													<History size={14} />
												)
											) : showPreviousGroups ? (
												<>
													<ArrowUp size={13} />
													<span>{t("history.scrollUp")}</span>
												</>
											) : (
												t("history.showPrevious", {
													count: completedGroups.length,
												})
											)}
										</Button>
									</TooltipTrigger>
									<TooltipContent side="bottom">
										{showPreviousGroups
											? t("history.scrollUp")
											: t("history.showPrevious", {
													count: completedGroups.length,
												})}
									</TooltipContent>
								</Tooltip>
							</TooltipProvider>
							{showPreviousGroups ? (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									className="pointer-events-auto ml-2 h-9 w-9 rounded-full border border-border/70 bg-background/90 text-muted-foreground shadow-sm backdrop-blur-xl hover:bg-accent/70 hover:text-foreground"
									aria-label={t("history.hidePrevious")}
									onClick={() => setShowPreviousGroups(false)}
								>
									<X size={14} />
								</Button>
							) : null}
						</div>
					) : null}
					<ConversationContent
						className={`mx-auto flex w-full flex-col ${
							isChatFullWidth ? "max-w-full" : "max-w-4xl"
						} ${
							isCompactEmptyLanding
								? "chat-conversation-content h-full min-h-0 space-y-3 pb-2 pt-12"
								: isCompactChatSurface
									? "chat-conversation-content min-h-full space-y-8 pb-8 pt-16"
									: "chat-conversation-content min-h-full space-y-8 pb-8 pt-16 sm:px-6 lg:px-8"
						}`}
					>
						{showPreviousGroups ? (
							<div className="space-y-8">{completedMessageGroups}</div>
						) : null}

						{latestGroupIsEmpty ? (
							<ChatEmptyState
								screenContent={selectedAgentIconScreenContent}
								greetingContext={agentGreetingContext}
								showAgentBuilderCallout={shouldShowAgentBuilderCallout}
								onOpenAgentWizard={handleOpenAgentWizard}
								compact={isCompactChatSurface}
							/>
						) : latestGroup ? (
							<MessageGroup
								key={latestGroup.id}
								group={latestGroup}
								inProgressMessage={inProgressMessage}
								defaultCollapsed={false}
								selectedTopic={selectedTopic}
								onLoadMessages={loadMessageGroup}
							/>
						) : undefined}
					</ConversationContent>
					<ConversationScrollButton />
				</Conversation>

				<ModelLoadPrompt
					current={current}
					onModelLoaded={handleModelLoaded}
					onDownloadProgress={setDownloadProgress}
					onDownloadModelName={setQuickDownloadModel}
					onReadyChange={setIsChatInputModelReady}
				/>

				<SmartSelectContextBanner
					context={smartSelectContext}
					onClear={() => setSmartSelectContext(null)}
				/>

				<AgentContextWarningBanner
					current={current}
					selectedAgentFlowId={selectedAgentFlowId}
					selectedAgentName={selectedAgent?.name}
					onUseChatMode={() => handleSelectAgentFlow("chat")}
				/>

				<ChatInput
					inputValue={inputValue}
					setInputValue={setInputValue}
					onSubmit={handleChatSubmit}
					isLoading={isLoading}
					model={model}
					status={status}
					selectedTopic={selectedTopic}
					setSelectedTopic={handleSelectTopic}
					onInsertSeparator={insertSeparator}
					onStop={handleStop}
					onDeleteChat={deleteMessages}
					abortController={abortController}
					isLoadingTopics={isLoadingTopics}
					topics={topics}
					agentFlows={agentFlows}
					selectedAgentFlowId={selectedAgentFlowId}
					setSelectedAgentFlowId={handleSelectAgentFlow}
					onCreateAgentFlow={handleCreateAgentFlow}
					attachedImages={attachedImages}
					onAttachedImagesChange={setAttachedImages}
					attachedDocumentRefs={attachedDocumentRefs}
					onAttachedDocumentRefsChange={setAttachedDocumentRefs}
					isModelReady={isChatInputModelReady}
					isFullWidth={isChatFullWidth}
					onToggleFullWidth={() => setIsChatFullWidth((value) => !value)}
					compactControls={isNarrowChatPanel}
					onOpenAgentSettings={() => {
						open(selectedAgentFlowId);
						setRightPanelCollapsed(false);
						setRightWorkspaceTab("agent");
						onOpenAgentWorkspace?.();
						navigate("/agents", {
							state: { selectedAgentFlowId },
						});
					}}
				/>
			</div>
		</div>
	);
};
