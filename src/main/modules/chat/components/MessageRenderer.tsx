import React, { Suspense, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";

import { ThreeDotsLoader } from "@/main/components/atoms/ThreeDotsLoader";
import {
	Message,
	MessageContent,
} from "@/main/components/ui/shadcn-io/ai/message";
import type { Message as DBMessage } from "@/services/database/types";
import type { MessageActionItem } from "@/main/modules/chat/components/types";
import type {
	AssistantExecutionPart,
	AttachedDocumentRef,
	ComplexContent,
	MessageParts,
} from "@/types/chat";
import { cn } from "@/lib/utils";
import { MessageActions } from "./MessageActions";
import { MessageFooter, type MessageFooterMetadata } from "./MessageFooter";
import { MessageComplexImages } from "./message/ChatImagePart";
import { MessageAttachedDocuments } from "./message/MessageAttachedDocuments";
import { UserMessageContent } from "./message/UserMessageContent";
import { MessageContentWithArtifacts } from "./message/MessageContentWithArtifacts";
import type { MessageActionRequest } from "./artifacts/ArtifactActionsMenu";
import {
	AssistantContentFlow,
	isAssistantContentPart,
	type AssistantContentPart,
} from "./message/AssistantContentFlow";
import { MessageErrorNotice } from "./message/MessageErrorNotice";
import {
	buildAssistantContentParts,
	hasAssistantContentParts,
} from "./message/message-parts-adapter";

interface MessageMetadata extends MessageFooterMetadata {
	actions?: MessageActionItem[];
	attachedDocuments?: AttachedDocumentRef[];
	agentFlowName?: string;
	error?: {
		message: string;
		rawMessage?: string;
		statusCode?: number;
		code?: string | number;
		providerName?: string | null;
	};
	executeState?: {
		node: string;
		metadata?: Record<string, unknown>;
	};
	executions?: AssistantExecutionPart[];
}

interface MessageRendererProps {
	message: DBMessage;
	index: number;
	isLastMessage: boolean;
	isStreaming: boolean;
	groupMessages?: DBMessage[];
	selectedTopic?: string;
	showMessageControls?: boolean;
	onMessageAction?: (action: MessageActionRequest) => void | Promise<void>;
}

export const MessageRenderer: React.FC<MessageRendererProps> = React.memo(
	({
		message,
		isLastMessage,
		isStreaming,
		groupMessages,
		selectedTopic,
		showMessageControls = true,
		onMessageAction,
	}) => {
		const location = useLocation();
		const formattedDate = useMemo(
			() => dayjs(message.createdAt).format("MMM D, YYYY h:mm A"),
			[message.createdAt],
		);
		const { t } = useTranslation("chat");

		const complexContent = useMemo<ComplexContent | null>(() => {
			if (!message.complexContent || !Array.isArray(message.complexContent))
				return null;
			return message.complexContent as ComplexContent;
		}, [message.complexContent]);

		const assistantContentParts = useMemo<AssistantContentPart[]>(() => {
			if (message.role !== "assistant" || !complexContent) return [];
			const parts = (complexContent as unknown[]).filter(
				isAssistantContentPart,
			);
			return parts.some((part) =>
				part.type === "text" ? part.text.trim() : true,
			)
				? parts
				: [];
		}, [complexContent, message.role]);
		const messageParts = useMemo<MessageParts | null>(() => {
			if (message.role !== "assistant") return null;
			if (!message.parts || !Array.isArray(message.parts)) return null;
			return message.parts as MessageParts;
		}, [message.parts, message.role]);
		const metadata = message.metadata as MessageMetadata | undefined;
		const actions = useMemo<MessageActionItem[]>(() => {
			if (!message.metadata || typeof message.metadata !== "object") return [];
			if (!("actions" in message.metadata)) return [];
			if (!Array.isArray(message.metadata.actions)) return [];
			return message.metadata.actions;
		}, [message.metadata]);

		const attachedDocuments = useMemo<AttachedDocumentRef[]>(() => {
			if (!message.metadata || typeof message.metadata !== "object") return [];
			if (!("attachedDocuments" in message.metadata)) return [];
			if (!Array.isArray(message.metadata.attachedDocuments)) return [];
			return message.metadata.attachedDocuments as AttachedDocumentRef[];
		}, [message.metadata]);

		const executeState = useMemo(() => metadata?.executeState, [metadata]);
		const executionParts = useMemo<AssistantExecutionPart[]>(
			() => (Array.isArray(metadata?.executions) ? metadata.executions : []),
			[metadata],
		);
		const partsContentParts = useMemo<AssistantContentPart[]>(
			() =>
				message.role === "assistant"
					? buildAssistantContentParts({
							parts: messageParts,
							executions: executionParts,
							executeState: isStreaming ? executeState : undefined,
						})
					: [],
			[executeState, executionParts, isStreaming, message.role, messageParts],
		);
		const renderedAssistantContentParts =
			partsContentParts.length > 0 ? partsContentParts : assistantContentParts;
		const hasStructuredAssistantContent = hasAssistantContentParts(
			renderedAssistantContentParts,
		);
		const hasRenderableContent =
			message.content.trim().length > 0 || hasStructuredAssistantContent;
		const showGenericStreamingStatus =
			isStreaming && actions.length === 0 && !hasStructuredAssistantContent;

		const messageError = useMemo(() => {
			return metadata?.error;
		}, [metadata]);

		const agentFlowName = useMemo(() => {
			return metadata?.agentFlowName;
		}, [metadata]);

		const executionLabel = useMemo(() => {
			if (!executeState?.node) return "";
			const key = `execution.nodes.${executeState.node}`;
			const translated = t(key);
			if (translated !== key) return translated;
			return executeState.node;
		}, [executeState?.node, t]);

		const executionText = useMemo(() => {
			if (!executeState?.node) return "";
			const toolName =
				typeof executeState.metadata?.tool === "string"
					? executeState.metadata.tool
					: undefined;
			if (toolName) {
				return t("execution.tool", { name: toolName });
			}
			return t("execution.default", { node: executionLabel });
		}, [executeState, executionLabel, t]);

		if (message.type === "separator") {
			return (
				<div key={message.id} className="my-4 flex items-center">
					<div className="flex-1 border-t border-border/60"></div>
					<div className="mx-4 rounded-full border border-border/60 bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
						{formattedDate}
					</div>
					<div className="flex-1 border-t border-border/60"></div>
				</div>
			);
		}

		const isUserMessage = message.role === "user";

		return (
			<div
				key={message.id}
				className={cn(
					"flex flex-col gap-2",
					isUserMessage ? "items-end" : "items-start",
				)}
			>
				{!isUserMessage ? (
					<div className="flex items-center justify-start gap-2 px-1 text-[11px] font-medium tracking-normal text-muted-foreground/80">
						<span>{agentFlowName ?? t("messages.assistant")}</span>
						<span className="h-1 w-1 rounded-full bg-muted-foreground/35" />
						<time dateTime={new Date(message.createdAt).toISOString()}>
							{formattedDate}
						</time>
					</div>
				) : null}
				{showMessageControls &&
				actions.length > 0 &&
				!hasStructuredAssistantContent ? (
					<div className="w-full">
						<MessageActions actions={actions} />
					</div>
				) : null}
				{hasRenderableContent || showGenericStreamingStatus ? (
					<Message key={message.id} from={message.role}>
						<MessageContent
							className={cn(
								"relative",
								hasStructuredAssistantContent &&
									"group-[.is-assistant]:overflow-visible group-[.is-assistant]:rounded-none group-[.is-assistant]:border-0 group-[.is-assistant]:bg-transparent group-[.is-assistant]:px-0 group-[.is-assistant]:py-0 group-[.is-assistant]:shadow-none",
							)}
						>
							{message.role === "user" && attachedDocuments.length > 0 && (
								<MessageAttachedDocuments documents={attachedDocuments} />
							)}
							{complexContent && (
								<MessageComplexImages complexContent={complexContent} />
							)}
							{!hasRenderableContent && isLastMessage && isStreaming ? (
								<div className="py-2 flex items-center gap-2">
									<ThreeDotsLoader className="text-muted-foreground" />
									{executionText ? (
										<span className="text-muted-foreground animate-pulse">
											{executionText}
										</span>
									) : null}
								</div>
							) : (
								<Suspense
									fallback={
										<div className="py-2">
											<ThreeDotsLoader className="text-muted-foreground" />
										</div>
									}
								>
									<div className="relative z-10">
										{isUserMessage ? (
											<UserMessageContent
												content={message.content}
												isStreaming={isStreaming}
											/>
										) : hasStructuredAssistantContent ? (
											<>
												<AssistantContentFlow
													parts={renderedAssistantContentParts}
													isStreaming={isStreaming}
													suppressArtifactPreviews={
														location.pathname === "/runtime"
													}
													onMessageAction={onMessageAction}
												/>
												{messageError ? (
													<MessageErrorNotice error={messageError} />
												) : null}
											</>
										) : (
											<>
												<MessageContentWithArtifacts
													content={message.content}
													isStreaming={isStreaming}
													suppressArtifactPreviews={
														location.pathname === "/runtime"
													}
													onMessageAction={onMessageAction}
												/>
												{messageError ? (
													<MessageErrorNotice error={messageError} />
												) : null}
											</>
										)}
										{showGenericStreamingStatus && (
											<>
												<div className="mt-4 flex items-center gap-2">
													<ThreeDotsLoader
														className="text-muted-foreground"
														size="sm"
													/>
													{executionText ? (
														<span className="text-muted-foreground animate-pulse">
															{executionText}
														</span>
													) : null}
												</div>
												<div
													className="absolute -bottom-6 -left-6 -right-6 h-10 pointer-events-none rounded-b-lg z-0"
													style={{
														background:
															"linear-gradient(to top, hsl(var(--background) / 0.2) 0%, hsl(var(--background) / 0.08) 55%, transparent 100%)",
													}}
												/>
											</>
										)}
										{showMessageControls &&
										!isStreaming &&
										message.role === "assistant" &&
										message.metadata &&
										groupMessages &&
										groupMessages.length > 0 ? (
											<MessageFooter
												message={message}
												groupMessages={groupMessages}
												selectedTopic={selectedTopic}
												metadata={message.metadata as MessageMetadata}
											/>
										) : null}
									</div>
								</Suspense>
							)}
						</MessageContent>
					</Message>
				) : null}
			</div>
		);
	},
	(prev, next) => {
		return (
			prev.message.id === next.message.id &&
			prev.message.content === next.message.content &&
			prev.message.complexContent === next.message.complexContent &&
			prev.message.parts === next.message.parts &&
			prev.message.metadata === next.message.metadata &&
			prev.isLastMessage === next.isLastMessage &&
			prev.isStreaming === next.isStreaming &&
			prev.showMessageControls === next.showMessageControls &&
			prev.onMessageAction === next.onMessageAction
		);
	},
);
