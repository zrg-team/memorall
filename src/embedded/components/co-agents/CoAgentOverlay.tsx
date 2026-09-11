import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgentCursorOverlay, hideAgentCursor } from "@/components/AgentCursor";
import { BACKGROUND_EVENTS } from "@/constants/events";
import { embeddedChatHistoryService } from "@/embedded/chat-history-service";
import { createSmartSelectOverlay } from "@/embedded/components/SmartSelectOverlay";
import {
	latestToolName,
	progressForNode,
	progressForTool,
} from "@/embedded/utils/co-agent/progress-status";
import {
	buildEmbeddedContextMessageContent,
	createEmbeddedContextItem,
} from "@/embedded/context-items";
import { useEmbeddedCustomOptions } from "@/embedded/hooks/use-embedded-custom-options";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import { useEmbeddedModelStatus } from "@/embedded/hooks/use-embedded-model-status";
import { coAgentChatService } from "@/embedded/pages/CoAgent/co-agent-chat";
import { CO_AGENT_STATUS_EVENT } from "@/embedded/pages/CoAgent/constants";
import {
	COAGENT_SESSION_END,
	COAGENT_SESSION_START,
	isCoAgentSessionOpen,
} from "@/services/chat/coagent-session";
import {
	createEmbeddedChatModal,
	EMBEDDED_CHAT_MODAL_STATE_EVENT,
} from "@/embedded/pages/EmbeddedChat";
import type { EmbeddedContextItem } from "@/embedded/types";
import {
	type CoAgentContextAnchor,
	refreshContextAnchor,
} from "@/embedded/utils/co-agent/context-anchor";
import { getPageDescription } from "@/embedded/utils/co-agent/dom-utils";
import type { MessageActionRequest } from "@/main/modules/chat/components/artifacts/ArtifactActionsMenu";
import {
	getOpenUISendMessageText,
	type MemorallOpenUIActionDetail,
	resolveOpenUITemplate,
} from "@/main/modules/openui/actions";
import {
	CoAgentAnchorTrigger,
	overlapsCoAgentDock,
} from "./CoAgentAnchorPrompt";
import { CoAgentDock } from "./CoAgentDock";
import { useCoAgentContextAnchor } from "./useCoAgentContextAnchor";

interface CoAgentOverlayProps {
	portalRoot: ShadowRoot;
	onDestroy: () => void;
}

export const CoAgentOverlay: React.FC<CoAgentOverlayProps> = ({
	portalRoot,
	onDestroy,
}) => {
	const [message, setMessage] = useState("");
	// Transient activity ("Observing this page", "Done"), kept apart from the
	// answer. Sharing one string meant every finished tool call overwrote the
	// bubble with "Done", so a run that returned no text left only that word.
	const [statusLine, setStatusLine] = useState("");
	// Page fragment picked with Smart Select, sent alongside the next prompt.
	const [attachedSelection, setAttachedSelection] =
		useState<EmbeddedContextItem | null>(null);
	const [anchoredInputValue, setAnchoredInputValue] = useState("");
	const [collapsed, setCollapsed] = useState(false);
	const [bubbleDismissed, setBubbleDismissed] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [anchorPromptOpen, setAnchorPromptOpen] = useState(false);
	const [chatPopupOpen, setChatPopupOpen] = useState(false);
	const [externalChatModalOpen, setExternalChatModalOpen] = useState(() =>
		Boolean(document.getElementById("memorall-embedded-chat-modal")),
	);
	const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
	const { needsPasskey, modelAvailable, selectedModel } =
		useEmbeddedModelStatus();
	// Same agent list the panel offers; the dock had no way to pick one.
	const { agentFlows, selectedAgentFlowId, setSelectedAgentFlowId } =
		useEmbeddedCustomOptions();
	// Recorded on the message so the reader can see which agent answered — and,
	// when it is the built-in one, that no agent was applied.
	const answeringAgent = useMemo(
		() => agentFlows.find((flow) => flow.id === selectedAgentFlowId),
		[agentFlows, selectedAgentFlowId],
	);
	const answeringAgentName = answeringAgent?.name;
	const answeringAgentTheme = answeringAgent?.openuiTheme;
	const t = useEmbeddedTranslation("coAgent");
	const showAuthAction = needsPasskey;
	const speechMessage = showAuthAction ? t("unlockRequired") : message.trim();
	const visibleSpeechMessage = bubbleDismissed ? "" : speechMessage;

	const openPromptUi = useCallback(() => {
		setCollapsed(false);
		setBubbleDismissed(false);
		setAnchorPromptOpen(true);
	}, []);

	const { activeAnchor, freshAnchor, setActiveAnchor } =
		useCoAgentContextAnchor({
			disabled: showAuthAction,
			promptOpen: anchorPromptOpen,
			onOpenPrompt: openPromptUi,
		});

	const openPrompt = useCallback(
		(anchor?: CoAgentContextAnchor | null) => {
			if (anchor && !anchor.isStale) setActiveAnchor(anchor);
			openPromptUi();
		},
		[openPromptUi, setActiveAnchor],
	);

	/**
	 * "Ask" is deliberately not "Ask about this". Previously any live anchor was
	 * attached implicitly, so there was no way to ask a plain question while the
	 * pointer happened to rest on something.
	 */
	const openPromptWithoutAnchor = useCallback(() => {
		setActiveAnchor(null);
		openPromptUi();
	}, [openPromptUi, setActiveAnchor]);

	const detachAnchor = useCallback(() => {
		setActiveAnchor(null);
	}, [setActiveAnchor]);

	// Smart select is a mode, and the control that turns a mode on has to be able
	// to turn it off. The overlay factory already returns a teardown; the dock was
	// throwing it away and starting a fresh overlay on every click, so once it was
	// on there was no way out of it.
	const smartSelectCleanupRef = useRef<(() => void) | null>(null);
	// Mirrored into state so the dock button can show the mode is on — a toggle
	// nobody can see is on is barely better than one that cannot be turned off.
	const [isSmartSelectActive, setIsSmartSelectActive] = useState(false);

	const stopSmartSelect = useCallback(() => {
		smartSelectCleanupRef.current?.();
		smartSelectCleanupRef.current = null;
		setIsSmartSelectActive(false);
	}, []);

	const toggleSmartSelect = useCallback(() => {
		if (smartSelectCleanupRef.current) {
			stopSmartSelect();
			return;
		}
		setBubbleDismissed(false);
		smartSelectCleanupRef.current = createSmartSelectOverlay(
			(item) => {
				smartSelectCleanupRef.current = null;
				setIsSmartSelectActive(false);
				setAttachedSelection(item);
				openPromptUi();
			},
			() => {
				smartSelectCleanupRef.current = null;
				setIsSmartSelectActive(false);
			},
		);
		setIsSmartSelectActive(true);
	}, [openPromptUi, stopSmartSelect]);

	// Leaving the page, or turning the co-agent off, must not strand the picker.
	useEffect(() => stopSmartSelect, [stopSmartSelect]);

	const showAnchorTrigger =
		Boolean(freshAnchor && !freshAnchor.isStale) &&
		!(freshAnchor && overlapsCoAgentDock(freshAnchor)) &&
		!anchorPromptOpen &&
		!chatPopupOpen &&
		!collapsed &&
		!showAuthAction;

	useEffect(() => {
		const handleStatus = (event: Event) => {
			const detail = (event as CustomEvent<{ message?: string }>).detail;
			setStatusLine(detail?.message?.trim() ?? "");
		};
		window.addEventListener(CO_AGENT_STATUS_EVENT, handleStatus);
		return () =>
			window.removeEventListener(CO_AGENT_STATUS_EVENT, handleStatus);
	}, []);

	useEffect(() => {
		if (!speechMessage) {
			setBubbleDismissed(false);
		}
	}, [speechMessage]);

	useEffect(() => {
		const handleEmbeddedChatState = (event: Event) => {
			const detail = (
				event as CustomEvent<{ mounted?: boolean; minimized?: boolean }>
			).detail;
			setExternalChatModalOpen(Boolean(detail?.mounted));
		};

		window.addEventListener(
			EMBEDDED_CHAT_MODAL_STATE_EVENT,
			handleEmbeddedChatState,
		);
		return () =>
			window.removeEventListener(
				EMBEDDED_CHAT_MODAL_STATE_EVENT,
				handleEmbeddedChatState,
			);
	}, []);

	useEffect(() => {
		const bubbleContent = portalRoot.querySelector<HTMLElement>(
			".memorall-co-agent-icon .agent-speech-bubble-content",
		);
		if (bubbleContent) {
			bubbleContent.scrollTop = bubbleContent.scrollHeight;
		}
	}, [message, portalRoot]);

	useEffect(() => {
		if (!anchorPromptOpen) return;
		window.requestAnimationFrame(() => {
			promptInputRef.current?.focus();
		});
	}, [anchorPromptOpen]);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !anchorPromptOpen) return;
			event.preventDefault();
			setAnchorPromptOpen(false);
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [anchorPromptOpen]);

	const leaveCoAgentMode = () => {
		// Close the session in the transcript before the dock goes away, so the
		// reader can see where the page turns stopped.
		void embeddedChatHistoryService
			.insertCoAgentMarker(COAGENT_SESSION_END)
			.catch(() => {});
		void chrome.runtime.sendMessage({ type: BACKGROUND_EVENTS.HIDE_CO_AGENT });
		onDestroy();
	};

	const unlockExtension = () => {
		leaveCoAgentMode();
		void chrome.runtime.sendMessage({ type: BACKGROUND_EVENTS.OPEN_FULL_PAGE });
	};

	const openFullConversation = async () => {
		try {
			document.getElementById("memorall-embedded-chat-modal")?.remove();
			setChatPopupOpen(true);
			await createEmbeddedChatModal({
				mode: "general",
				coAgentEnabled: true,
				pageUrl: window.location.href,
				pageTitle: document.title,
				contextOptions: [
					createEmbeddedContextItem({
						kind: "viewport",
						label: t("visibleContent"),
						content: document.body?.innerText?.slice(0, 6_000) ?? "",
					}),
				],
				onCoAgentToggle: (enabled) => {
					void chrome.runtime.sendMessage({
						type: enabled
							? BACKGROUND_EVENTS.CO_AGENT_SET_ACTIVE
							: BACKGROUND_EVENTS.HIDE_CO_AGENT,
						url: window.location.href,
					});
					if (!enabled) onDestroy();
				},
				onClose: () => {
					setChatPopupOpen(false);
				},
			});
		} catch (error) {
			setChatPopupOpen(false);
			setBubbleDismissed(false);
			setMessage(error instanceof Error ? error.message : t("errorMessage"));
		}
	};

	/**
	 * OpenUI blocks rendered in the dock bubble can act: put text in the composer,
	 * or submit straight away. Without this the rendered controls were inert.
	 */
	const handleMessageAction = useCallback(
		async (action: MessageActionRequest) => {
			if (action.type !== "openui_action") return;
			const detail = action.payload?.detail as
				| MemorallOpenUIActionDetail
				| undefined;
			const openUIAction = detail?.action;
			if (!openUIAction) return;

			if (openUIAction.type === "add_message_to_input") {
				const text = resolveOpenUITemplate(
					openUIAction.text,
					detail.formState,
					detail.formName,
				);
				setAnchoredInputValue((current) =>
					openUIAction.mode === "replace"
						? text
						: current.trim()
							? `${current}
${text}`
							: text,
				);
				setAnchorPromptOpen(true);
				return;
			}

			if (openUIAction.type === "send_message") {
				const message = getOpenUISendMessageText(
					openUIAction,
					detail.formState,
					detail.formName,
					detail.humanFriendlyMessage,
				);
				setAnchoredInputValue(message);
				setAnchorPromptOpen(true);
				requestAnimationFrame(() => promptInputRef.current?.focus());
				return;
			}

			// Documents and routes belong to the full app, which owns those views.
			await openFullConversation();
		},
		[openFullConversation],
	);

	const submitPrompt = async (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const prompt = anchoredInputValue.trim();
		if (!prompt || isSubmitting || showAuthAction || !modelAvailable) return;
		const anchor = activeAnchor
			? refreshContextAnchor(activeAnchor)
			: undefined;
		const selection = attachedSelection;
		const composed = selection
			? buildEmbeddedContextMessageContent({
					userMessage: prompt,
					contexts: [selection],
					pageTitle: document.title || "",
					pageUrl: window.location.href,
				})
			: prompt;
		// Sent as-is, parts and all. Flattening to text here is what made an
		// attached screenshot arrive as the text of the element it was cut from:
		// the model was handed the div's screen-reader labels rather than the
		// picture, and answered about those.
		const promptWithContext = composed;

		setAnchoredInputValue("");
		setAttachedSelection(null);
		setAnchorPromptOpen(false);
		setCollapsed(false);
		setBubbleDismissed(false);
		setIsSubmitting(true);
		setMessage("");
		setStatusLine(t("thinking"));

		let assistantMessageId: string | null = null;
		let currentContent = "";
		let latestActions: Awaited<
			ReturnType<typeof coAgentChatService.chatStream>
		>["actions"] = [];
		let latestToolCalls:
			| Awaited<ReturnType<typeof coAgentChatService.chatStream>>["toolCalls"]
			| undefined;
		let latestUsage:
			| Awaited<ReturnType<typeof coAgentChatService.chatStream>>["usage"]
			| undefined;
		const startTime = Date.now();

		try {
			// Opened lazily on the first question rather than when the dock
			// appears: a session the user never used is not worth marking.
			try {
				const existing = await embeddedChatHistoryService.loadMessages();
				if (!isCoAgentSessionOpen(existing)) {
					await embeddedChatHistoryService.insertCoAgentMarker(
						COAGENT_SESSION_START,
					);
				}
			} catch {
				// A missing marker costs a visual cue, not the answer.
			}

			await embeddedChatHistoryService.addMessage({
				role: "user",
				content: prompt,
				metadata: {
					source: "co-agent",
					pageUrl: window.location.href,
					pageTitle: document.title || "",
					anchor,
				},
			});
			const assistantMessage = await embeddedChatHistoryService.addMessage({
				role: "assistant",
				content: "",
				metadata: {
					source: "co-agent",
					pageUrl: window.location.href,
					pageTitle: document.title || "",
					model: selectedModel,
				},
			});
			assistantMessageId = assistantMessage.id;

			const result = await coAgentChatService.chatStream({
				prompt: promptWithContext,
				agentFlowId: selectedAgentFlowId,
				model: selectedModel,
				pageContext: {
					url: window.location.href,
					title: document.title || "",
					description: getPageDescription(),
				},
				anchorContext: anchor && !anchor.isStale ? anchor : undefined,
				onExecuteStart: (executeState) => {
					// The node name is the machinery, not the work. Anything that is
					// the model composing reads as one steady "Thinking…"; a tool run
					// waits for the tool name, which arrives on onToolCalls.
					setStatusLine(
						progressForNode(
							typeof executeState.node === "string"
								? executeState.node
								: undefined,
							t("thinking"),
						).label,
					);
				},
				onProgress: (content) => {
					if (content.trim()) {
						currentContent = content.trim();
						setMessage(content.trim());
						// Text is arriving, so the answer has started: the status line
						// has nothing left to add.
						setStatusLine("");
					}
				},
				onAction: (actions) => {
					latestActions = actions;
				},
				onToolCalls: (toolCalls) => {
					latestToolCalls = toolCalls;
					const running = latestToolName(toolCalls);
					if (running) setStatusLine(progressForTool(running).label);
				},
				onError: (error) => {
					setStatusLine("");
					setMessage(error || t("failedMessage"));
				},
			});

			latestUsage = result.usage;
			if (result.content.trim()) {
				currentContent = result.content.trim();
				latestActions = result.actions;
				latestToolCalls = result.toolCalls;
				setMessage(result.content.trim());
			}
		} catch (error) {
			currentContent =
				error instanceof Error ? error.message : t("errorMessage");
			setMessage(currentContent);
		} finally {
			setStatusLine("");
			if (!currentContent.trim()) {
				currentContent = t("finishedNoAnswer");
				setMessage(currentContent);
			}
			const timeToAnswer = (Date.now() - startTime) / 1000;
			try {
				if (assistantMessageId) {
					await embeddedChatHistoryService.finalizeMessage(assistantMessageId, {
						content: currentContent || message || t("failedMessage"),
						metadata: {
							source: "co-agent",
							actions: latestActions,
							tool_calls: latestToolCalls,
							model: selectedModel,
							timeToAnswer,
							// The same bookkeeping a panel message carries. Without it a
							// co-agent turn had no token counts, no cache figures, and no
							// answering agent — so every one of them read as "Assistant".
							...(latestUsage ? { usage: latestUsage } : {}),
							...(answeringAgentName
								? { agentFlowName: answeringAgentName }
								: {}),
							...(answeringAgentTheme
								? { openuiTheme: answeringAgentTheme }
								: {}),
						},
					});
				}
			} catch {
				// The dock response is still useful even if history persistence fails.
			}
			setIsSubmitting(false);
			// The cursor is a progress indicator, not a decoration. co_agent_move
			// leaves it wherever it last pointed, so without this it sits on the
			// page long after the run that put it there has finished.
			hideAgentCursor();
		}
	};

	// Turning the co-agent off, or leaving the page, must not leave a cursor
	// pointing at something nothing is working on any more.
	useEffect(() => hideAgentCursor, []);

	return (
		<>
			<AgentCursorOverlay portalRoot={portalRoot} />
			{showAnchorTrigger && freshAnchor ? (
				<CoAgentAnchorTrigger
					anchor={freshAnchor}
					onAskAboutThis={() => openPrompt(freshAnchor)}
					onAsk={openPromptWithoutAnchor}
				/>
			) : null}
			{!chatPopupOpen && !externalChatModalOpen ? (
				<CoAgentDock
					collapsed={collapsed}
					showAuthAction={showAuthAction}
					visibleSpeechMessage={visibleSpeechMessage}
					statusLine={statusLine}
					isSubmitting={isSubmitting}
					promptOpen={anchorPromptOpen}
					inputValue={anchoredInputValue}
					inputRef={promptInputRef}
					modelAvailable={modelAvailable}
					attachedAnchor={activeAnchor}
					onDetachAnchor={detachAnchor}
					onMessageAction={handleMessageAction}
					agentFlows={agentFlows}
					selectedAgentFlowId={selectedAgentFlowId}
					onSelectAgentFlow={setSelectedAgentFlowId}
					attachedSelectionLabel={attachedSelection?.label ?? null}
					onDetachSelection={() => setAttachedSelection(null)}
					openuiTheme={answeringAgentTheme}
					onSmartSelect={toggleSmartSelect}
					isSmartSelectActive={isSmartSelectActive}
					onExpand={() => setCollapsed(false)}
					onOpenPrompt={() => openPrompt(freshAnchor)}
					onClosePrompt={() => setAnchorPromptOpen(false)}
					onChangeInput={setAnchoredInputValue}
					onSubmitPrompt={submitPrompt}
					onOpenConversation={() => {
						void openFullConversation();
					}}
					onUnlock={unlockExtension}
					onLeaveCoAgent={leaveCoAgentMode}
					onDismissBubble={() => setBubbleDismissed(true)}
				/>
			) : null}
		</>
	);
};
