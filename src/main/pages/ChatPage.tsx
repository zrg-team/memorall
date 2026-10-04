"use client";
import { useWorkspaceModeStore } from "@/main/stores/workspace-mode";
import { ArrowUp, History, Menu, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import React, { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import type {
	AgentGreetingContext,
	AgentScreenContent,
} from "@/components/AgentIcon";
import { ChatPanelSkeleton } from "@/main/components/atoms/AppSkeletons";
import { ChatSidePanel } from "@/main/components/molecules/ChatSidePanel";
import { Button } from "@/main/components/ui/button";
import {
	useWorkspaceHeaderLeadingSlot,
	useWorkspaceHeaderSlot,
} from "@/main/components/workspace-header-slot";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/main/components/ui/shadcn-io/ai/conversation";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import { getAgentIconScreenFromMetadata } from "@/main/modules/agents/types";
import {
	AgentContextWarningBanner,
	ChatEmptyState,
	ChatInput,
	ModelLoadPrompt,
	NoModelsScreen,
	SmartSelectContextBanner,
	useChat,
	useCurrentModel,
	useSmartSelectContext,
} from "@/main/modules/chat/components";
import type { MessageActionRequest } from "@/main/modules/chat/components/artifacts/ArtifactActionsMenu";
import { ChatHeaderActions } from "@/main/modules/chat/components/ChatHeaderActions";
import { logError } from "@/utils/logger";
import { MessageGroup } from "@/main/modules/chat/components/MessageGroup";
import { translateCommonKey } from "@/main/modules/chat/utils/i18n-helpers";
import {
	ModelDownloadingScreen,
	useDownloadProgress,
} from "@/main/modules/llm/components";
import {
	formatOpenUIFormStateContext,
	getOpenUISendMessageText,
	isAllowedOpenUIRoute,
	type MemorallOpenUIActionDetail,
	normalizeOpenUIDocumentPath,
	resolveOpenUITemplate,
} from "@/main/modules/openui/actions";
import { topicService } from "@/main/modules/topics/services/topic-service";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import { findBlockingRun, useChatStore } from "@/main/stores/chat";
import { useChatMessageQueueStore } from "@/main/stores/chat-message-queue";
import { useCoAgentToggle } from "@/main/stores/co-agent-activation";
import { LOCAL_PROVIDERS } from "@/main/hooks/selectable-model";
import { useRefreshOnFocus } from "@/main/modules/chat/hooks/use-refresh-on-focus";
import { useRuntimeSessionsStore } from "@/main/stores/runtime-sessions";
import {
	useAgentComputer,
	useMemonAutoOpen,
} from "@/main/components/molecules/MemonComputer";
import { useMemonMachineStore } from "@/main/stores/memon-machine";
import { useShellLayoutStore } from "@/main/stores/shell-layout";
import { useWebChallengeHandoffStore } from "@/main/stores/web-challenge-handoff";
import { serviceManager } from "@/services";
import type { Flow, Topic } from "@/services/database/types";
import type { FeatureCatalogMetadata } from "@/services/flow-feature-catalog-service";
import {
	type MemonFeatureConfig,
	memonConfigFromFlow,
} from "@/services/memon/feature-config";
import type { AttachedDocumentRef } from "@/types/chat";
import { isPopupSurface } from "@/utils/dom";

type AgentFlowOption = Pick<Flow, "id" | "name" | "metadata">;

const RETRIEVAL_STEP_NAMES = new Set([
	"context-smart-retrieve",
	"context-quick-retrieve",
	"context-llm-retrieve",
	"structmem-retrieval",
]);

interface ChatPageProps {
	onOpenAgentWorkspace?: () => void;
	isNarrowChatPanel?: boolean;
	onCompactChatListOpenChange?: (open: boolean) => void;
	useIconOnlyHistoryButton?: boolean;
}

export const ChatPage: React.FC<ChatPageProps> = ({
	onOpenAgentWorkspace,
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
	const [selectedAgentComputer, setSelectedAgentComputer] =
		React.useState<MemonFeatureConfig | null>(null);
	const { isOpen, open } = useAgentConfigStore();
	const refreshRuntimeSessions = useRuntimeSessionsStore(
		(state) => state.refresh,
	);
	const setRightPanelCollapsed = useShellLayoutStore(
		(state) => state.setRightPanelCollapsed,
	);
	const currentConversation = useChatStore(
		(state) => state.currentConversation,
	);
	const currentConversationCost = useChatStore((state) =>
		state.currentConversation
			? state.conversationCosts[state.currentConversation.id]
			: undefined,
	);
	const refreshConversationCosts = useChatStore(
		(state) => state.refreshConversationCosts,
	);
	// An older chat may be beyond the listed ones: add up its cost on opening.
	React.useEffect(() => {
		if (currentConversation?.id) {
			void refreshConversationCosts([currentConversation.id]);
		}
	}, [currentConversation?.id, refreshConversationCosts]);
	const restoreSelectedAgentFlowId = useChatStore(
		(state) => state.restoreSelectedAgentFlowId,
	);

	// The co-agent writes into this same conversation from a content script, and
	// nothing tells this page about it. Re-read when the user comes back, so a
	// turn taken on the web page is not missing here.
	const loadConversation = useChatStore((state) => state.loadConversation);
	const createNewConversation = useChatStore(
		(state) => state.createNewConversation,
	);
	const loadConversations = useChatStore((state) => state.loadConversations);
	useRefreshOnFocus(
		currentConversation?.id
			? () => loadConversation(currentConversation.id)
			: undefined,
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
	const headerLeadingSlot = useWorkspaceHeaderLeadingSlot();
	const headerSlot = useWorkspaceHeaderSlot();
	/** Bumped to put the cursor in the composer (after New chat). */
	const [composerFocusKey, setComposerFocusKey] = React.useState(0);
	const [expandedMessageGroupId, setExpandedMessageGroupId] = React.useState<
		string | null
	>(null);
	const latestPreviousGroupRef = useRef<HTMLDivElement | null>(null);
	const completedGroupRefs = useRef(new Map<string, HTMLDivElement>());
	const shouldScrollToPreviousGroupsRef = useRef(false);
	const pendingGroupScrollRef = useRef<string | null>(null);
	// A local model serves one request at a time and an agent's computer is one
	// screen; anything else can run while other chats run.
	const canRunConcurrently =
		!!current &&
		!LOCAL_PROVIDERS.has(current.provider) &&
		!selectedAgentComputer;
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
		enqueueMessage,
		injectMessage,
		sendQueuedMessage,
	} = useChat(model, { concurrent: canRunConcurrently });
	const coAgentToggle = useCoAgentToggle();
	const agentComputer = useAgentComputer(
		selectedAgentFlowId,
		selectedAgentComputer,
	);
	useMemonAutoOpen(selectedAgentFlowId);
	const setMemonChatAgent = useMemonMachineStore((state) => state.setChatAgent);
	React.useEffect(() => {
		setMemonChatAgent(
			selectedAgentFlowId && selectedAgentComputer
				? { agentId: selectedAgentFlowId, config: selectedAgentComputer }
				: null,
		);
		return () => setMemonChatAgent(null);
	}, [selectedAgentFlowId, selectedAgentComputer, setMemonChatAgent]);
	// The run shows only in the chat it belongs to.
	const visibleInProgressMessage =
		inProgressMessage &&
		inProgressMessage.conversationId === currentConversation?.id
			? inProgressMessage
			: null;
	const hasInProgressMessage = visibleInProgressMessage != null;
	// A run in another chat that this one has to wait for: runs share the time
	// only on a remote model and without an agent computer on either side.
	const runs = useChatStore((state) => state.runs);
	const blockingRun = findBlockingRun(
		runs,
		currentConversation?.id,
		canRunConcurrently,
	);
	const runningElsewhereId =
		blockingRun && blockingRun.conversationId !== currentConversation?.id
			? blockingRun.conversationId
			: null;
	const runningElsewhere = React.useMemo(() => {
		if (!runningElsewhereId) return null;
		const title =
			useChatStore
				.getState()
				.conversations.find((item) => item.id === runningElsewhereId)?.title ||
			t("conversation.untitled", { defaultValue: "another chat" });
		return {
			title,
			onOpen: () => void loadConversation(runningElsewhereId),
		};
	}, [runningElsewhereId, loadConversation, t]);
	const currentHistoryBoundary = messageGroups.find((group) => group.isLatest)
		?.previousSeparator?.id;

	const queuedMessages = useChatMessageQueueStore((state) =>
		currentConversation ? state.queued[currentConversation.id] : undefined,
	);
	const pendingMessages = useChatMessageQueueStore((state) =>
		currentConversation ? state.pending[currentConversation.id] : undefined,
	);
	const isQueuePaused = useChatMessageQueueStore((state) =>
		currentConversation ? Boolean(state.paused[currentConversation.id]) : false,
	);
	const removeQueuedMessage = useChatMessageQueueStore((state) => state.remove);

	/** The composer as it stands, taken out of it. */
	const takeComposerDraft = (
		images: File[],
		docRefs: AttachedDocumentRef[],
	) => {
		const draft = {
			text: inputValue,
			images,
			documentRefs: docRefs,
			contextPrefix: smartSelectContext
				? `[Smart Select: ${smartSelectContext.label}]\n${smartSelectContext.content}`
				: undefined,
		};
		setInputValue("");
		setSmartSelectContext(null);
		setAttachedImages([]);
		setAttachedDocumentRefs([]);
		return draft;
	};

	const handleChatSubmit = (
		e: React.FormEvent,
		images: File[],
		docRefs: AttachedDocumentRef[],
	) => {
		e.preventDefault();
		if (!inputValue.trim()) return;
		// This chat's run takes it before the agent's next step.
		if (isLoading && currentConversation) {
			injectMessage(currentConversation.id, takeComposerDraft(images, docRefs));
			return;
		}
		// A run in another chat that this one waits for keeps the draft as it is.
		if (runningElsewhere) return;
		const contextPrefix = smartSelectContext
			? `[Smart Select: ${smartSelectContext.label}]\n${smartSelectContext.content}`
			: undefined;
		handleSubmit(e, images, docRefs, contextPrefix);
		setSmartSelectContext(null);
		setAttachedImages([]);
		setAttachedDocumentRefs([]);
	};

	/** Sent after this chat's run finishes. */
	const handleQueueMessage = () => {
		if (!currentConversation || !inputValue.trim()) return;
		enqueueMessage(
			currentConversation.id,
			takeComposerDraft(attachedImages, attachedDocumentRefs),
		);
	};

	const handleEditQueuedMessage = (id: string) => {
		if (!currentConversation) return;
		const message = removeQueuedMessage(currentConversation.id, id);
		if (!message) return;
		setInputValue(
			inputValue.trim() ? `${message.text}\n${inputValue}` : message.text,
		);
		setAttachedImages((current) => [...message.images, ...current]);
		setAttachedDocumentRefs((current) => [...message.documentRefs, ...current]);
	};

	const handleMessageAction = React.useCallback(
		async (action: MessageActionRequest) => {
			if (action.type === "openui_action") {
				const detail = action.payload?.detail as MemorallOpenUIActionDetail;
				if (!detail?.action) return;
				const { action: openUIAction } = detail;

				if (openUIAction.type === "send_message") {
					const message = getOpenUISendMessageText(
						openUIAction,
						detail.formState,
						detail.formName,
						detail.humanFriendlyMessage,
					);
					const shouldIncludeFormState =
						openUIAction.includeFormState ?? Boolean(detail.formName);
					const formContext = shouldIncludeFormState
						? formatOpenUIFormStateContext(detail.formState, detail.formName)
						: undefined;
					await submitMessage({
						inputText: message,
						contextPrefix: formContext,
						clearComposer: false,
					});
					return;
				}

				if (openUIAction.type === "add_message_to_input") {
					const text = resolveOpenUITemplate(
						openUIAction.text,
						detail.formState,
						detail.formName,
					);
					setInputValue(
						openUIAction.mode === "replace"
							? text
							: inputValue.trim()
								? `${inputValue}\n${text}`
								: text,
					);
					return;
				}

				if (openUIAction.type === "open_document") {
					const path = normalizeOpenUIDocumentPath(
						resolveOpenUITemplate(
							openUIAction.path,
							detail.formState,
							detail.formName,
						),
					);
					if (path) navigate("/files", { state: { openDocumentPath: path } });
					return;
				}

				if (openUIAction.type === "open_route") {
					const route = resolveOpenUITemplate(
						openUIAction.route,
						detail.formState,
						detail.formName,
					).trim();
					if (isAllowedOpenUIRoute(route)) navigate(route);
				}
				return;
			}

			if (action.type === "artifact.preview.error.report") {
				const errors = Array.isArray(action.payload?.errors)
					? action.payload.errors.filter(
							(error): error is string => typeof error === "string",
						)
					: [];
				const title = action.title?.trim() || action.identifier?.trim();
				const errorLines = errors
					.slice(0, 12)
					.map((error, index) => `${index + 1}. ${error}`)
					.join("\n");
				const prompt = [
					`Please update the latest ${action.component} artifact to resolve the preview errors.`,
					title ? `Artifact: ${title}` : null,
					"",
					"Errors from the preview iframe:",
					errorLines || "- No error details were captured.",
					"",
					"Return an updated artifact that resolves these runtime/resource errors.",
				]
					.filter((part): part is string => part !== null)
					.join("\n");

				await submitMessage({ inputText: prompt, clearComposer: false });
			}
		},
		[inputValue, navigate, setInputValue, submitMessage],
	);

	// A tool call cannot block waiting for a person, so when a web tool hits a bot
	// wall the turn ends and the warning card takes over. Once the user has solved
	// the challenge and pressed Continue, the card leaves a prompt here and this
	// sends it — the card itself has no way to reach `submitMessage`.
	const pendingContinuation = useWebChallengeHandoffStore(
		(state) => state.pendingContinuation,
	);
	const takeContinuation = useWebChallengeHandoffStore(
		(state) => state.takeContinuation,
	);

	// A studio sent text here (a transcript, say): drop it into the composer
	// rather than sending it, so the user decides what to ask about it.
	const pendingChatText = useWorkspaceModeStore(
		(state) => state.pendingChatText,
	);
	useEffect(() => {
		if (pendingChatText === null) return;
		const text = useWorkspaceModeStore.getState().takePendingChatText();
		if (text) {
			setInputValue(
				inputValue.trim()
					? `${inputValue}

${text}`
					: text,
			);
		}
	}, [pendingChatText, inputValue, setInputValue]);

	// Files sent from elsewhere (the MemonOS Bot computer) join the attachments,
	// the same chips an @mention adds.
	const pendingChatDocumentRefs = useWorkspaceModeStore(
		(state) => state.pendingChatDocumentRefs,
	);
	useEffect(() => {
		if (pendingChatDocumentRefs === null) return;
		const refs = useWorkspaceModeStore.getState().takePendingChatDocumentRefs();
		if (!refs?.length) return;
		setAttachedDocumentRefs((current) => [
			...current,
			...refs.filter((ref) => !current.some((item) => item.path === ref.path)),
		]);
	}, [pendingChatDocumentRefs]);

	useEffect(() => {
		if (!pendingContinuation) return;
		const prompt = takeContinuation();
		if (!prompt) return;
		void submitMessage({ inputText: prompt, clearComposer: false });
	}, [pendingContinuation, takeContinuation, submitMessage]);

	useEffect(() => {
		onCompactChatListOpenChange?.(isCompactSidePanelOpen);
	}, [isCompactSidePanelOpen, onCompactChatListOpenChange]);

	useEffect(() => {
		if (!isNarrowChatPanel && isCompactSidePanelOpen) {
			setIsCompactSidePanelOpen(false);
		}
	}, [isCompactSidePanelOpen, isNarrowChatPanel]);

	useEffect(() => {
		if (!isCompactSidePanelOpen) return;
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") setIsCompactSidePanelOpen(false);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isCompactSidePanelOpen]);

	// Refresh after each assistant response finishes
	const wasInProgressRef = useRef(false);
	useEffect(() => {
		const isNow = hasInProgressMessage;
		if (!isNow && wasInProgressRef.current) {
			void (async () => {
				await refreshRuntimeSessions();
				const hasRuntimeActivity =
					useRuntimeSessionsStore.getState().servers.length > 0 ||
					useRuntimeSessionsStore.getState().commands.length > 0 ||
					useRuntimeSessionsStore.getState().activeWebSession.isOpen;
				if (
					hasRuntimeActivity &&
					!["/agents", "/llm", "/memory", "/files"].includes(location.pathname)
				) {
					setRightPanelCollapsed(false);
					navigate("/runtime");
				}
			})();
		}
		wasInProgressRef.current = isNow;
	}, [
		hasInProgressMessage,
		navigate,
		refreshRuntimeSessions,
		setRightPanelCollapsed,
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
		latestGroup?.messages.length === 0 && !hasInProgressMessage;
	const isConversationEmpty =
		completedGroups.length === 0 && latestGroupIsEmpty;

	/**
	 * The header's New chat. A chat with nothing in it yet already is a new
	 * one: it is kept, rather than leaving an empty chat behind in the list.
	 */
	const handleNewChat = React.useCallback(async () => {
		setIsCompactSidePanelOpen(false);
		setShowPreviousGroups(false);
		setExpandedMessageGroupId(null);
		if (!isConversationEmpty) {
			try {
				await createNewConversation();
				await loadConversations();
			} catch (error) {
				logError("[CHAT] Failed to start a new chat:", error);
				return;
			}
		}
		setComposerFocusKey((key) => key + 1);
	}, [createNewConversation, isConversationEmpty, loadConversations]);
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
					onMessageAction={handleMessageAction}
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
		handleMessageAction,
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
				if (!selectedAgentFlowId) {
					// The agent picked last time, when it is still there.
					await restoreSelectedAgentFlowId(mapped.map((flow) => flow.id));
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
	}, [selectedAgentFlowId, setSelectedAgentFlowId, restoreSelectedAgentFlowId]);

	// Saving the selected agent in Agents changes its features and computer
	// settings here too (pi code turned off leaves its computer at once).
	const savedAgentConfig = useAgentConfigStore((state) =>
		state.currentFlowId === selectedAgentFlowId
			? state.savedUnifiedConfig
			: null,
	);

	useEffect(() => {
		let cancelled = false;

		const loadSelectedAgentFeatures = async () => {
			if (!selectedAgentFlowId || selectedAgentFlowId === "chat") {
				setSelectedAgentFeatureNames([]);
				setSelectedAgentFeatureLabels([]);
				setSelectedAgentComputer(null);
				return;
			}

			try {
				const [config, catalog] = await Promise.all([
					savedAgentConfig ??
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
						translateCommonKey(metadata.nameKey, t) ??
							metadata.displayName ??
							step.name,
					);
				}

				setSelectedAgentFeatureNames(names);
				setSelectedAgentFeatureLabels(labels);
				setSelectedAgentComputer(memonConfigFromFlow(config));
			} catch {
				if (!cancelled) {
					setSelectedAgentFeatureNames([]);
					setSelectedAgentFeatureLabels([]);
					setSelectedAgentComputer(null);
				}
			}
		};

		void loadSelectedAgentFeatures();
		return () => {
			cancelled = true;
		};
	}, [selectedAgentFlowId, savedAgentConfig, t]);

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
	const compactSidePanelToggleLabel = isCompactSidePanelOpen
		? t("sidebar.close")
		: t("header.openChats");
	const compactSidePanelToggle = isCompactSidePanelAvailable ? (
		<Button
			type="button"
			data-chat-side-panel-toggle
			variant="ghost"
			size="icon"
			className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-muted hover:text-foreground"
			aria-label={compactSidePanelToggleLabel}
			aria-expanded={isCompactSidePanelOpen}
			title={compactSidePanelToggleLabel}
			onClick={() => setIsCompactSidePanelOpen((open) => !open)}
		>
			<Menu size={16} />
		</Button>
	) : null;

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
		return <ChatPanelSkeleton />;
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
			data-chat-conversation-id={currentConversation?.id ?? ""}
			data-chat-history-boundary={currentHistoryBoundary ?? ""}
			data-chat-selected-agent-flow={selectedAgentFlowId ?? ""}
			data-copilot="chat-center"
			data-agent-cursor-point="copilot-chat-center"
		>
			{isWideChatSidePanelVisible ? (
				<ChatSidePanel
					onShowConversationGroup={handleConversationGroupSelect}
				/>
			) : null}
			<div className="chat-panel-container relative flex min-w-0 flex-1 flex-col overflow-hidden">
				<AnimatePresence>
					{isCompactSidePanelAvailable && isCompactSidePanelOpen ? (
						<>
							<motion.button
								type="button"
								initial={{ opacity: 0 }}
								animate={{ opacity: 1 }}
								exit={{ opacity: 0 }}
								className="absolute inset-0 z-40 bg-black/45 backdrop-blur-[1px]"
								onClick={() => setIsCompactSidePanelOpen(false)}
								aria-label={t("sidebar.close")}
							/>
							<motion.div
								initial={{ opacity: 0, x: -24 }}
								animate={{ opacity: 1, x: 0 }}
								exit={{ opacity: 0, x: -24 }}
								transition={{ duration: 0.18, ease: "easeOut" }}
								className="absolute inset-y-0 left-0 z-50 w-[min(88%,22rem)] max-w-full bg-background shadow-2xl"
								role="dialog"
								aria-modal="true"
								aria-label={t("sidebar.label")}
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
						</>
					) : null}
				</AnimatePresence>

				{/* In the header beside the mode switcher, at the edge the drawer
				    slides in from, so it never sits on top of a message. */}
				{compactSidePanelToggle ? (
					headerLeadingSlot ? (
						createPortal(compactSidePanelToggle, headerLeadingSlot)
					) : (
						<div className="absolute left-2 top-2 z-30">
							{compactSidePanelToggle}
						</div>
					)
				) : null}

				{/* New chat and the agent's computer, at the header's end. */}
				{headerSlot
					? createPortal(
							<ChatHeaderActions
								cost={currentConversationCost}
								onNewChat={() => void handleNewChat()}
								onOpenComputer={agentComputer.open}
								isComputerWorking={agentComputer.working}
								coAgent={coAgentToggle}
							/>,
							headerSlot,
						)
					: null}

				<Conversation
					className="min-h-0 flex-1 bg-transparent"
					resize={hasInProgressMessage ? "instant" : "smooth"}
				>
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
								onSelectPrompt={setInputValue}
								compact={isCompactChatSurface}
							/>
						) : latestGroup ? (
							<MessageGroup
								key={latestGroup.id}
								group={latestGroup}
								inProgressMessage={visibleInProgressMessage}
								defaultCollapsed={false}
								selectedTopic={selectedTopic}
								onLoadMessages={loadMessageGroup}
								onMessageAction={handleMessageAction}
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
					runningElsewhere={runningElsewhere}
					onQueue={handleQueueMessage}
					queue={{
						queued: queuedMessages ?? [],
						pending: pendingMessages ?? [],
						paused: isQueuePaused,
						onSend: (id) => {
							if (currentConversation) {
								sendQueuedMessage(currentConversation.id, id);
							}
						},
						onEdit: handleEditQueuedMessage,
						onRemove: (id) => {
							if (currentConversation) {
								removeQueuedMessage(currentConversation.id, id);
							}
						},
					}}
					model={model}
					currentModel={current}
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
					focusKey={composerFocusKey}
					isFullWidth={isChatFullWidth}
					onToggleFullWidth={() => setIsChatFullWidth((value) => !value)}
					placeholder={t("input.messageAgent", {
						agent: selectedAgent?.name ?? t("flowSelector.chat"),
					})}
					onOpenAgentSettings={() => {
						open(selectedAgentFlowId);
						setRightPanelCollapsed(false);
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
