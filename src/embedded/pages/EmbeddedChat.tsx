import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ChatHeader } from "@/embedded/components/MessageControl";
import { EmbeddedChatConversation } from "@/embedded/components/EmbeddedChatConversation";
import { EmbeddedChatInput } from "@/embedded/components/EmbeddedChatInput";
import { EmbeddedCloseConfirmation } from "@/embedded/components/EmbeddedCloseConfirmation";
import { EmbeddedContextRevealButton } from "@/embedded/components/EmbeddedContextRevealButton";
import { EmbeddedContextSections } from "@/embedded/components/ContextSections";
import { EmbeddedSmartSelectNotice } from "@/embedded/components/EmbeddedSmartSelectNotice";
import { useConversationAutoScroll } from "@/embedded/hooks/use-conversation-auto-scroll";
import { useEmbeddedChatDisplayMode } from "@/embedded/hooks/use-embedded-chat-display-mode";
import { useEmbeddedChatSession } from "@/embedded/hooks/use-embedded-chat-session";
import { useEmbeddedContextAttachments } from "@/embedded/hooks/use-embedded-context-attachments";
import { useEmbeddedCustomOptions } from "@/embedded/hooks/use-embedded-custom-options";
import { useEmbeddedModelStatus } from "@/embedded/hooks/use-embedded-model-status";
import { useEmbeddedSmartSelect } from "@/embedded/hooks/use-embedded-smart-select";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import { customStyles } from "@/embedded/styles/customStyles";
import type { ChatModalProps } from "@/embedded/types";
import { createShadowPage } from "@/embedded/utils/create-shadow-page";
import { BACKGROUND_EVENTS } from "@/constants/events";
import type { MessageActionRequest } from "@/main/modules/chat/components/artifacts/ArtifactActionsMenu";
import {
	formatOpenUIFormStateContext,
	getOpenUISendMessageText,
	isAllowedOpenUIRoute,
	normalizeOpenUIDocumentPath,
	resolveOpenUITemplate,
	type MemorallOpenUIActionDetail,
} from "@/main/modules/openui/actions";
import { backgroundJob } from "@/services/background-jobs/background-job";

export const EMBEDDED_CHAT_MODAL_STATE_EVENT =
	"memorall:embedded-chat-modal-state";

const getPageHost = (pageUrl: string): string => {
	try {
		return new URL(pageUrl).hostname.replace(/^www\./, "");
	} catch {
		return pageUrl;
	}
};

const openFullPage = async (navigationState?: {
	navigateTo: string;
	openDocumentPath?: string;
}) => {
	try {
		if (navigationState) {
			await chrome.storage?.session?.set?.(navigationState);
		}
	} finally {
		await chrome.runtime.sendMessage({
			type: BACKGROUND_EVENTS.OPEN_FULL_PAGE,
		});
	}
};

const EmbeddedChat: React.FC<ChatModalProps> = ({
	context,
	mode = "general",
	displayMode,
	coAgentEnabled: initialCoAgentEnabled = false,
	pageUrl,
	pageTitle,
	contextOptions,
	onCoAgentToggle,
	onClose,
}) => {
	const tChat = useEmbeddedTranslation("chat");
	const tContext = useEmbeddedTranslation("contextSection");
	const [inputValue, setInputValue] = useState("");
	const [showConfirmClose, setShowConfirmClose] = useState(false);
	const [coAgentEnabled, setCoAgentEnabled] = useState(initialCoAgentEnabled);
	const [isMinimized, setIsMinimized] = useState(false);

	const { currentDisplayMode, toggleDisplayMode } =
		useEmbeddedChatDisplayMode(displayMode);
	const {
		selectedModel,
		selectedProvider,
		modelAvailable,
		needsPasskey,
		noModelConfig,
		encryptedProviders,
		refreshModelStatus,
	} = useEmbeddedModelStatus();
	const {
		topics,
		agentFlows,
		selectedTopic,
		setSelectedTopic,
		topicsLoading,
		selectedAgentFlowId,
		setSelectedAgentFlowId,
		hasTopics,
	} = useEmbeddedCustomOptions();
	const {
		availableContexts,
		attachedContexts,
		showContextSection,
		setShowContextSection,
		attachContext,
		attachSmartContext,
		removeAttachedContext,
		clearAttachedContexts,
		resetContexts,
		toggleContextSection,
	} = useEmbeddedContextAttachments(contextOptions);

	const pageHost = useMemo(() => getPageHost(pageUrl), [pageUrl]);
	const suggestedPrompts = useMemo(
		() => [
			tChat("suggestSummary"),
			tChat("suggestFindFacts"),
			tChat("suggestRecallLinks"),
		],
		[tChat],
	);
	const primaryPageContext = useMemo(
		() =>
			availableContexts.find(
				(contextItem) => contextItem.kind === "viewport",
			) ??
			availableContexts.find(
				(contextItem) => contextItem.kind === "full_page",
			) ??
			availableContexts[0],
		[availableContexts],
	);

	const {
		conversationRef,
		shouldAutoScroll,
		scrollToBottom,
		handleScroll,
		handleWheel,
		setShouldAutoScroll,
	} = useConversationAutoScroll();
	const {
		messages,
		isTyping,
		submit,
		submitMessage,
		stop,
		deleteChat,
		newChat,
	} = useEmbeddedChatSession({
		context,
		mode,
		pageTitle,
		pageUrl,
		inputValue,
		setInputValue,
		attachedContexts,
		resetContexts,
		modelAvailable,
		selectedModel,
		selectedAgentFlowId,
		coAgentEnabled,
		selectedTopic,
		scrollToBottom,
		setShouldAutoScroll,
	});
	const { isSmartSelectMode, startSmartSelect, cancelSmartSelect } =
		useEmbeddedSmartSelect({
			onAttachContext: attachSmartContext,
			onSelected: () => setShowContextSection(false),
		});

	useEffect(() => {
		if (shouldAutoScroll) {
			scrollToBottom();
		}
	}, [messages, shouldAutoScroll, scrollToBottom]);

	useEffect(() => {
		setCoAgentEnabled(initialCoAgentEnabled);
	}, [initialCoAgentEnabled]);

	useEffect(() => {
		window.dispatchEvent(
			new CustomEvent(EMBEDDED_CHAT_MODAL_STATE_EVENT, {
				detail: { mounted: true, minimized: isMinimized },
			}),
		);
	}, [isMinimized]);

	useEffect(() => {
		return () => {
			window.dispatchEvent(
				new CustomEvent(EMBEDDED_CHAT_MODAL_STATE_EVENT, {
					detail: { mounted: false, minimized: false },
				}),
			);
		};
	}, []);

	const hasUnsavedContent = useCallback(
		() =>
			messages.length > 0 ||
			inputValue.trim().length > 0 ||
			attachedContexts.length > 0,
		[attachedContexts.length, inputValue, messages.length],
	);

	const closeWithConfirmation = useCallback(() => {
		if (hasUnsavedContent()) {
			setShowConfirmClose(true);
			return;
		}
		onClose();
	}, [hasUnsavedContent, onClose]);

	const handleConfirmedClose = useCallback(() => {
		setShowConfirmClose(false);
		onClose();
	}, [onClose]);

	const handleCancelClose = useCallback(() => {
		setShowConfirmClose(false);
	}, []);

	const handleOpenFullPageAndClose = useCallback(() => {
		void openFullPage();
		onClose();
	}, [onClose]);

	const handleMessageAction = useCallback(
		async (action: MessageActionRequest) => {
			if (action.type !== "openui_action") return;
			const detail = action.payload?.detail as
				| MemorallOpenUIActionDetail
				| undefined;
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
				setInputValue((current) =>
					openUIAction.mode === "replace"
						? text
						: current.trim()
							? `${current}\n${text}`
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
				if (path) {
					await openFullPage({
						navigateTo: "/documents",
						openDocumentPath: path,
					});
				}
				return;
			}

			if (openUIAction.type === "open_route") {
				const route = resolveOpenUITemplate(
					openUIAction.route,
					detail.formState,
					detail.formName,
				).trim();
				if (isAllowedOpenUIRoute(route)) {
					await openFullPage({ navigateTo: route });
				}
			}
		},
		[setInputValue, submitMessage],
	);

	const handlePasskeySubmit = useCallback(
		async (passkey: string) => {
			const result = await backgroundJob.execute(
				"unlock-and-restore-all-providers",
				{ passkey },
				{ stream: false },
			);
			if (!("promise" in result)) {
				throw new Error("Passkey unlock did not start");
			}
			const response = await result.promise;
			if (response.status !== "completed") {
				throw new Error(response.error || "Failed to unlock providers");
			}
			await refreshModelStatus();
		},
		[refreshModelStatus],
	);

	const toggleCoAgent = useCallback(() => {
		setCoAgentEnabled((current) => {
			const next = !current;
			onCoAgentToggle?.(next);
			return next;
		});
	}, [onCoAgentToggle]);

	return (
		<div
			className={`memorall-embedded-root ${
				isMinimized ? "memorall-embedded-root--minimized" : ""
			}`}
			onClick={closeWithConfirmation}
			onKeyDown={(event) => event.stopPropagation()}
			onKeyUp={(event) => event.stopPropagation()}
			onKeyPress={(event) => event.stopPropagation()}
		>
			{isMinimized ? (
				<button
					type="button"
					className="memorall-chat-minimized-button"
					aria-label={tChat("restoreChat")}
					title={tChat("restoreChat")}
					onClick={(event) => {
						event.stopPropagation();
						setIsMinimized(false);
					}}
				>
					<img
						src={chrome.runtime.getURL("logo.png")}
						alt=""
						className="memorall-chat-minimized-logo"
					/>
				</button>
			) : (
				<div
					className={`memorall-chat-shell memorall-chat-shell--${currentDisplayMode} ${
						isSmartSelectMode ? "memorall-chat-shell--smart" : ""
					}`}
					onClick={(event) => event.stopPropagation()}
					onKeyDown={(event) => event.stopPropagation()}
					onKeyUp={(event) => event.stopPropagation()}
					onKeyPress={(event) => event.stopPropagation()}
				>
					<ChatHeader
						mode={mode}
						displayMode={currentDisplayMode}
						onToggleDisplayMode={toggleDisplayMode}
						onNewChat={newChat}
						onMinimize={() => setIsMinimized(true)}
						onOpenFullVersion={() => void openFullPage()}
						onClose={closeWithConfirmation}
						coAgentEnabled={coAgentEnabled}
						onToggleCoAgent={toggleCoAgent}
						modelId={selectedModel}
						provider={selectedProvider}
						modelAvailable={modelAvailable}
					/>

					{isSmartSelectMode ? (
						<EmbeddedSmartSelectNotice onCancel={cancelSmartSelect} />
					) : (
						<EmbeddedChatConversation
							conversationRef={conversationRef}
							onScroll={handleScroll}
							onWheel={handleWheel}
							needsPasskey={needsPasskey}
							noModelConfig={noModelConfig}
							encryptedProviders={encryptedProviders}
							selectedProvider={selectedProvider}
							messages={messages}
							selectedTopic={selectedTopic}
							pageHost={pageHost}
							suggestedPrompts={suggestedPrompts}
							primaryPageContext={primaryPageContext}
							onAttachContext={attachContext}
							onSelectPrompt={setInputValue}
							onOpenMainApp={handleOpenFullPageAndClose}
							onPasskeySubmit={handlePasskeySubmit}
							onMessageAction={handleMessageAction}
						/>
					)}

					{!isSmartSelectMode &&
						!showContextSection &&
						attachedContexts.length === 0 && (
							<EmbeddedContextRevealButton
								label={tChat("context")}
								smartSelectLabel={tContext("smartSelect")}
								onClick={toggleContextSection}
								onSmartSelect={startSmartSelect}
							/>
						)}

					{!isSmartSelectMode && (
						<div
							className="overflow-hidden transition-all duration-300 ease-in-out"
							style={{
								maxHeight:
									showContextSection || attachedContexts.length > 0
										? "500px"
										: "0px",
								opacity:
									showContextSection || attachedContexts.length > 0 ? 1 : 0,
							}}
						>
							<EmbeddedContextSections
								availableContexts={availableContexts}
								attachedContexts={attachedContexts}
								onAttachContext={attachContext}
								onRemoveAttachedContext={removeAttachedContext}
								onClearAttachedContexts={clearAttachedContexts}
								onStartSmartSelect={startSmartSelect}
								showContextSection={showContextSection}
								onToggleContextSection={toggleContextSection}
							/>
						</div>
					)}

					{!isSmartSelectMode && (
						<EmbeddedChatInput
							inputValue={inputValue}
							setInputValue={setInputValue}
							onSubmit={submit}
							isTyping={isTyping}
							modelAvailable={modelAvailable}
							selectedAgentFlowId={selectedAgentFlowId}
							setSelectedAgentFlowId={setSelectedAgentFlowId}
							agentFlows={agentFlows}
							selectedTopic={selectedTopic}
							setSelectedTopic={setSelectedTopic}
							topics={topics}
							topicsLoading={topicsLoading}
							hasTopics={hasTopics}
							messages={messages}
							onDeleteChat={deleteChat}
							onStop={stop}
							onOpenSettings={handleOpenFullPageAndClose}
						/>
					)}

					{showConfirmClose && (
						<EmbeddedCloseConfirmation
							onCancel={handleCancelClose}
							onConfirm={handleConfirmedClose}
						/>
					)}
				</div>
			)}
		</div>
	);
};

// Function to create and mount the shadcn-style chat modal with Shadow DOM isolation
export async function createEmbeddedChatModal(
	props: ChatModalProps,
): Promise<() => void> {
	const { root, container } = createShadowPage({
		customStyles,
	});

	const cleanupModal = () => {
		root.unmount();
		container.remove();
	};

	const modalProps = {
		...props,
		onClose: () => {
			props.onClose();
			cleanupModal();
		},
	};

	root.render(<EmbeddedChat {...modalProps} />);
	document.body.appendChild(container);

	return cleanupModal;
}

export default EmbeddedChat;
