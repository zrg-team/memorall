import React from "react";
import { ArrowLeft, Send, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import {
	Conversation,
	ConversationContent,
	ConversationScrollButton,
} from "@/main/components/ui/shadcn-io/ai/conversation";
import {
	PromptInput,
	PromptInputSubmit,
	PromptInputTextarea,
	PromptInputToolbar,
} from "@/main/components/ui/shadcn-io/ai/prompt-input";
import { MessageRenderer } from "@/main/modules/chat/components/MessageRenderer";
import type { MessageActionRequest } from "@/main/modules/chat/components/artifacts/ArtifactActionsMenu";
import {
	getOpenUISendMessageText,
	type MemorallOpenUIActionDetail,
} from "@/main/modules/openui/actions";
import type { Message as DBMessage } from "@/services/database/types";
import type { AgentWizardMessage } from "../types";
import { cn } from "@/lib/utils";

interface AgentWizardChatPanelProps {
	messages: AgentWizardMessage[];
	inputValue: string;
	onInputChange: (value: string) => void;
	onSubmit: (contentOrEvent?: string | React.FormEvent) => void;
	onStop: () => void;
	onBack?: () => void;
	isStreaming: boolean;
	isModelReady: boolean;
	/**
	 * Connection setup rendered between the transcript and the composer. It lives
	 * here rather than on another page because wizard messages are not persisted —
	 * navigating away would discard the conversation.
	 */
	setupSlot?: React.ReactNode;
}

const toDbMessage = (message: AgentWizardMessage): DBMessage =>
	({
		id: message.id,
		conversationId: "agent-wizard",
		type: "text",
		role: message.role,
		content: message.content,
		complexContent: null,
		topicId: null,
		embeddingSmall: null,
		embedding: null,
		embeddingLarge: null,
		metadata: {},
		createdAt: message.createdAt,
		updatedAt: message.createdAt,
	}) as DBMessage;

export const AgentWizardChatPanel: React.FC<AgentWizardChatPanelProps> = ({
	messages,
	inputValue,
	onInputChange,
	onSubmit,
	onStop,
	onBack,
	isStreaming,
	isModelReady,
	setupSlot,
}) => {
	const { t } = useTranslation(["agents"]);
	const tc = (key: string) => t(`wizard.chatPanel.${key}`, { ns: "agents" });
	const dbMessages = React.useMemo(() => messages.map(toDbMessage), [messages]);
	const canSubmit = Boolean(inputValue.trim()) && !isStreaming && isModelReady;

	const handleMessageAction = React.useCallback(
		(action: MessageActionRequest) => {
			if (action.type !== "openui_action") return;
			const detail = action.payload?.detail as MemorallOpenUIActionDetail;
			if (!detail?.action) return;

			if (detail.action.type === "send_message") {
				const message = getOpenUISendMessageText(
					detail.action,
					detail.formState,
					detail.formName,
					detail.humanFriendlyMessage,
				);
				if (message.trim()) onSubmit(message.trim());
				return;
			}

			if (detail.action.type === "add_message_to_input") {
				const text = detail.action.text ?? "";
				onInputChange(
					detail.action.mode === "replace"
						? text
						: `${inputValue}${text}`.trim(),
				);
			}
		},
		[inputValue, onInputChange, onSubmit],
	);

	return (
		<section className="flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background">
			<div className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
				{onBack ? (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="h-8 gap-1.5 px-2 text-xs"
						onClick={onBack}
					>
						<ArrowLeft size={13} />
					</Button>
				) : null}
				<div className="min-w-0">
					<h2 className="text-sm font-semibold">{tc("title")}</h2>
					<p className="truncate text-xs text-muted-foreground">
						{tc("subtitle")}
					</p>
				</div>
			</div>

			<Conversation className="min-h-0 flex-1 overscroll-contain">
				<ConversationContent className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5 px-4 py-4">
					{dbMessages.map((message, index) => (
						<MessageRenderer
							key={message.id}
							message={message}
							index={index}
							isLastMessage={index === dbMessages.length - 1}
							isStreaming={
								isStreaming &&
								index === dbMessages.length - 1 &&
								message.role === "assistant"
							}
							groupMessages={dbMessages}
							showMessageControls={false}
							onMessageAction={handleMessageAction}
						/>
					))}
				</ConversationContent>
				<ConversationScrollButton />
			</Conversation>

			{setupSlot ? (
				<div className="shrink-0 border-t pt-2">{setupSlot}</div>
			) : null}

			<div className="shrink-0 border-t p-3">
				<PromptInput
					className="mx-auto max-w-3xl"
					onSubmit={(event) => {
						event.preventDefault();
						onSubmit(event);
					}}
				>
					<PromptInputTextarea
						value={inputValue}
						placeholder={
							isModelReady
								? tc("inputPlaceholder")
								: tc("inputPlaceholderNoModel")
						}
						disabled={isStreaming || !isModelReady}
						onChange={(event) => onInputChange(event.target.value)}
						className="min-h-[76px]"
					/>
					<PromptInputToolbar>
						<span
							className={cn(
								"px-2 text-xs",
								isModelReady ? "text-muted-foreground" : "text-destructive",
							)}
						>
							{isModelReady ? tc("wizardDraftOnly") : tc("noModelSelected")}
						</span>
						{isStreaming ? (
							<Button
								type="button"
								size="icon"
								variant="ghost"
								onClick={onStop}
								aria-label="Stop"
							>
								<Square size={15} />
							</Button>
						) : (
							<PromptInputSubmit disabled={!canSubmit} aria-label="Send">
								<Send size={15} />
							</PromptInputSubmit>
						)}
					</PromptInputToolbar>
				</PromptInput>
			</div>
		</section>
	);
};
