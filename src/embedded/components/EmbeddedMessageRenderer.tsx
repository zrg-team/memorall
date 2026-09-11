import type React from "react";
import { useMemo } from "react";
import {
	getEmbeddedTranslation,
	useEmbeddedTranslation,
} from "@/embedded/hooks/use-embedded-language";
import type { MessageActionRequest } from "@/main/modules/chat/components/artifacts/ArtifactActionsMenu";
import type {
	AssistantExecutionPart,
	AssistantToolPartState,
	MessageParts,
} from "@/types/chat";
import type { ChatCompletionMessageToolCall } from "@/types/openai";
import type { ChatMessage } from "../types";
import { Loader } from "./Icons";
import {
	AssistantMessageContent,
	EmbeddedToolSummaries,
	MessageActions,
	UserMessageContent,
} from "./messages";
import {
	formatJsonPreview,
	getTextContent,
	translateActionName,
} from "./messages/utils";

type EmbeddedAssistantPart =
	| { type: "text"; id: string; text: string }
	| {
			type: "tool";
			id: string;
			name: string;
			description: string;
			state: AssistantToolPartState;
			metadata?: Record<string, unknown>;
	  }
	| AssistantExecutionPart;

export interface EmbeddedMessageRendererProps {
	message: ChatMessage;
	isLoading: boolean;
	allMessages: ChatMessage[];
	selectedTopic?: string;
	onMessageAction?: (action: MessageActionRequest) => void | Promise<void>;
}

const contentToText = (
	content: MessageParts[number]["content"] | null | undefined,
): string => {
	if (!content) return "";
	if (typeof content === "string") return content;
	return content
		.map((part) => (part.type === "text" ? part.text : ""))
		.filter(Boolean)
		.join("\n");
};

const tryParseJson = (value: string): unknown => {
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const getToolResultDescription = (content: string): string => {
	const parsed = tryParseJson(content);
	if (isRecord(parsed)) {
		if (typeof parsed.error === "string" && parsed.error.trim()) {
			return parsed.error.trim();
		}
		if (typeof parsed.actionType === "string") {
			const scope =
				typeof parsed.scope === "string" && parsed.scope.trim()
					? `scope: ${parsed.scope.trim()}`
					: "";
			const page =
				typeof parsed.pageTitle === "string" && parsed.pageTitle.trim()
					? `page: ${parsed.pageTitle.trim()}`
					: "";
			return [parsed.actionType, scope, page].filter(Boolean).join("\n");
		}
	}
	return formatJsonPreview(content, 320);
};

const getToolResultState = (content: string): AssistantToolPartState => {
	if (content.trim().startsWith("Error:")) return "error";
	const parsed = tryParseJson(content);
	if (isRecord(parsed) && parsed.success === false) return "error";
	return "complete";
};

const buildToolPart = (
	toolCall: ChatCompletionMessageToolCall,
	toolResultContent?: string,
): EmbeddedAssistantPart => {
	const parsedArguments = tryParseJson(toolCall.function.arguments);
	const metadata = isRecord(parsedArguments) ? parsedArguments : undefined;
	return {
		type: "tool",
		id: toolCall.id,
		name: toolCall.function.name,
		description: toolResultContent
			? getToolResultDescription(toolResultContent)
			: formatJsonPreview(toolCall.function.arguments, 240),
		state: toolResultContent
			? getToolResultState(toolResultContent)
			: "running",
		metadata,
	};
};

const buildEmbeddedAssistantParts = ({
	parts,
	executions,
	executeState,
}: {
	parts: MessageParts | null;
	executions: AssistantExecutionPart[];
	executeState?: AssistantExecutionPart;
}): EmbeddedAssistantPart[] => {
	const assistantParts: EmbeddedAssistantPart[] = [];
	const toolResults = new Map<string, string>();
	const referencedToolIds = new Set<string>();

	for (const part of parts ?? []) {
		if (part.role === "tool") {
			toolResults.set(part.tool_call_id, contentToText(part.content));
		}
	}

	for (const execution of executions) {
		assistantParts.push(execution);
	}
	if (executeState) {
		assistantParts.push(executeState);
	}

	for (const part of parts ?? []) {
		if (part.role === "assistant") {
			const text = contentToText(part.content).trim();
			if (text) {
				assistantParts.push({
					type: "text",
					id: `text-${assistantParts.length}`,
					text,
				});
			}
			for (const toolCall of part.tool_calls ?? []) {
				referencedToolIds.add(toolCall.id);
				assistantParts.push(
					buildToolPart(toolCall, toolResults.get(toolCall.id)),
				);
			}
		} else if (
			part.role === "tool" &&
			!referencedToolIds.has(part.tool_call_id)
		) {
			const content = contentToText(part.content);
			assistantParts.push({
				type: "tool",
				id: part.tool_call_id,
				name: part.tool_call_id,
				description: getToolResultDescription(content),
				state: getToolResultState(content),
			});
		}
	}

	return assistantParts.filter((part) => {
		if (part.type === "text") return part.text.trim().length > 0;
		if (part.type === "tool") return part.name || part.description;
		return part.state === "running" && part.node;
	});
};

const hasAssistantContentParts = (parts: EmbeddedAssistantPart[]): boolean =>
	parts.some((part) => {
		if (part.type === "text") return part.text.trim().length > 0;
		if (part.type === "tool") return true;
		return part.state === "running";
	});

const EmbeddedToolPart: React.FC<{
	part: Extract<EmbeddedAssistantPart, { type: "tool" }>;
	actions: Record<string, string>;
	t: (key: "running" | "done" | "errorLabel") => string;
}> = ({ part, actions, t }) => (
	<details className="memorall-tool-summary" open={part.state === "running"}>
		<summary className="memorall-tool-summary-main">
			<span
				className={`memorall-tool-summary-dot${
					part.state === "running" ? " memorall-tool-summary-dot--active" : ""
				}`}
			/>
			<span className="memorall-tool-summary-title">
				{translateActionName(part.name, actions)}
			</span>
			<span className="memorall-tool-summary-status">
				{part.state === "running"
					? t("running")
					: part.state === "error"
						? t("errorLabel")
						: t("done")}
			</span>
		</summary>
		{part.description && (
			<pre className="memorall-tool-summary-code">{part.description}</pre>
		)}
	</details>
);

const EmbeddedExecutionPart: React.FC<{
	part: AssistantExecutionPart;
	actions: Record<string, string>;
	t: (key: "running") => string;
}> = ({ part, actions, t }) =>
	part.state === "running" ? (
		<div className="memorall-tool-summary">
			<div className="memorall-tool-summary-main">
				<span className="memorall-tool-summary-dot memorall-tool-summary-dot--active" />
				<span className="memorall-tool-summary-title">
					{translateActionName(part.node, actions)}
				</span>
				<span className="memorall-tool-summary-status">{t("running")}</span>
			</div>
			{part.metadata && (
				<div className="memorall-tool-summary-description">
					{formatJsonPreview(part.metadata)}
				</div>
			)}
		</div>
	) : null;

/** Names whatever is currently running, falling back to a generic label. */
const resolveActivityLabel = (
	parts: EmbeddedAssistantPart[],
	actions: Record<string, string>,
	t: (key: "thinking") => string,
): string => {
	for (let index = parts.length - 1; index >= 0; index -= 1) {
		const part = parts[index];
		if (part.type === "text") continue;
		if (part.state !== "running") continue;
		return translateActionName(
			part.type === "tool" ? part.name : part.node,
			actions,
		);
	}
	return t("thinking");
};

/**
 * Persistent "the run is still going" affordance.
 *
 * The empty-message spinner below only covers the moment before anything has
 * streamed. Once text or a tool row appeared there was no signal left, so a long
 * flow looked indistinguishable from a finished one.
 */
export const EmbeddedWorkingIndicator: React.FC<{ label: string }> = ({
	label,
}) => (
	<div className="memorall-working" role="status" aria-live="polite">
		<span className="memorall-working-dots" aria-hidden="true">
			<span className="memorall-working-dot" />
			<span className="memorall-working-dot" />
			<span className="memorall-working-dot" />
		</span>
		<span className="memorall-working-label">{label}</span>
	</div>
);

const EmbeddedAssistantPartsFlow: React.FC<{
	parts: EmbeddedAssistantPart[];
	isStreaming: boolean;
	onMessageAction?: (action: MessageActionRequest) => void | Promise<void>;
}> = ({ parts, isStreaming, onMessageAction }) => {
	const t = useEmbeddedTranslation("messageRenderer");
	const { actions } = getEmbeddedTranslation("messageRenderer");

	return (
		<div className="flex flex-col gap-4">
			{parts.map((part, index) => {
				if (part.type === "text") {
					return (
						<AssistantMessageContent
							content={part.text}
							isStreaming={isStreaming && index === parts.length - 1}
							onMessageAction={onMessageAction}
							key={part.id}
						/>
					);
				}
				if (part.type === "tool") {
					return (
						<div className="memorall-tool-summary-list" key={part.id}>
							<EmbeddedToolPart part={part} actions={actions} t={t} />
						</div>
					);
				}
				return (
					<div className="memorall-tool-summary-list" key={part.id}>
						<EmbeddedExecutionPart part={part} actions={actions} t={t} />
					</div>
				);
			})}
			{isStreaming && (
				<EmbeddedWorkingIndicator
					label={resolveActivityLabel(parts, actions, t)}
				/>
			)}
		</div>
	);
};

export const EmbeddedMessageRenderer: React.FC<
	EmbeddedMessageRendererProps
> = ({ message, isLoading, allMessages, selectedTopic, onMessageAction }) => {
	const t = useEmbeddedTranslation("messageRenderer");
	const metadata = message.metadata;
	const executionParts = useMemo<AssistantExecutionPart[]>(
		() =>
			Array.isArray(metadata?.executions)
				? (metadata.executions as AssistantExecutionPart[])
				: [],
		[metadata],
	);
	const executeState =
		typeof metadata?.executeState?.node === "string"
			? {
					id: "current-execution",
					type: "execution" as const,
					node: metadata.executeState.node,
					metadata: metadata.executeState.metadata,
					state: "running" as const,
				}
			: undefined;
	const assistantParts = useMemo(
		() =>
			message.role === "assistant"
				? buildEmbeddedAssistantParts({
						parts: (message.parts ?? null) as MessageParts | null,
						executions: executionParts,
						executeState: isLoading ? executeState : undefined,
					})
				: [],
		[executionParts, executeState, isLoading, message.parts, message.role],
	);
	const hasStructuredAssistantContent =
		hasAssistantContentParts(assistantParts);

	if (
		!message.content &&
		!hasStructuredAssistantContent &&
		isLoading &&
		message.role === "assistant"
	) {
		return (
			<div className="flex flex-col gap-4">
				<EmbeddedToolSummaries message={message} />
				<div className="flex items-center gap-2">
					<Loader size={14} />
					<span className="text-muted-foreground text-sm">{t("thinking")}</span>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{!hasStructuredAssistantContent && (
				<EmbeddedToolSummaries message={message} />
			)}
			{hasStructuredAssistantContent && message.role === "assistant" ? (
				<>
					<EmbeddedAssistantPartsFlow
						parts={assistantParts}
						isStreaming={isLoading}
						onMessageAction={onMessageAction}
					/>
					{!isLoading && (
						<MessageActions
							message={message}
							allMessages={allMessages}
							selectedTopic={selectedTopic}
						/>
					)}
				</>
			) : (
				message.content && (
					<>
						{message.role === "user" ? (
							<UserMessageContent message={message} />
						) : (
							<>
								<AssistantMessageContent
									content={getTextContent(message.content)}
									isStreaming={isLoading && message.role === "assistant"}
									configuredTheme={
										(message.metadata as { openuiTheme?: string } | undefined)
											?.openuiTheme
									}
									onMessageAction={onMessageAction}
								/>
								{!isLoading && (
									<MessageActions
										message={message}
										allMessages={allMessages}
										selectedTopic={selectedTopic}
									/>
								)}
							</>
						)}
					</>
				)
			)}
		</div>
	);
};
