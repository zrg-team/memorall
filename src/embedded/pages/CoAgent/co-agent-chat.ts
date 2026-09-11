import type {
	ChatStreamOptions,
	EmbeddedChatStreamResult,
} from "@/embedded/chat-service";
import { embeddedChatService } from "@/embedded/chat-service";
import type { ChatMessage } from "@/embedded/types";
import type { CoAgentContextAnchor } from "@/embedded/utils/co-agent/context-anchor";

const CO_AGENT_FEATURE_STEP_NAME = "co-agent-feature";

export interface CoAgentPageContext {
	url: string;
	title: string;
	description?: string;
}

/**
 * What the user asked, with anything they attached.
 *
 * A string for a plain question; the OpenAI content-part form when an image is
 * attached, so a captured region reaches the model as a picture rather than as
 * the text of the element it was cut from.
 */
export type CoAgentPrompt = ChatMessage["content"];

export interface CoAgentChatStreamOptions
	extends Pick<
		ChatStreamOptions,
		| "model"
		| "onExecuteStart"
		| "onProgress"
		| "onAction"
		| "onToolCalls"
		| "onError"
		| "signal"
	> {
	prompt: CoAgentPrompt;
	pageContext: CoAgentPageContext;
	anchorContext?: CoAgentContextAnchor;
	/** Chosen agent flow; "chat" (or undefined) keeps the default foundation agent. */
	agentFlowId?: string;
}

export const CO_AGENT_PAGE_CONTEXT_SYSTEM_PROMPT = `
Current user-enabled browser page context:
- URL: {{url}}
- Title: {{title}}
- Description: {{description}}

Use this only as lightweight orientation. Do not treat it as the user's requested subject when a cursor/hover anchor is provided.
`.trim();

const renderAnchorContextPrompt = (
	anchor?: CoAgentContextAnchor,
): string | null => {
	if (!anchor) return null;
	return `
The user is asking about this current page target first:
- Source: ${anchor.kind}
- Selector: ${anchor.selector ?? "Not available"}
- Tag: ${anchor.tagName}
- Label: ${anchor.ariaLabel || anchor.placeholder || "Not available"}
- Text: ${anchor.text || "Not available"}
- Value: ${anchor.value || "Not available"}
- Nearby text: ${anchor.nearbyText || "Not available"}

This target comes from the user's cursor/hover focus. Treat it as the main subject of the question. Answer about this target first. If verification is needed and a selector is available, use co_agent_query or co_agent_observe with scope="selector" and this selector. If the source is selected text, use the selection context directly or co_agent_observe with scope="selection". Do not use co_agent_observe scope="page" unless the user asks about the whole page. Use full-page context only to disambiguate or add nearby supporting details. Do not answer as if the user asked about the whole page unless the prompt explicitly says so.
`.trim();
};

const renderCoAgentPageContextPrompt = (context: CoAgentPageContext): string =>
	CO_AGENT_PAGE_CONTEXT_SYSTEM_PROMPT.replace(
		"{{url}}",
		context.url || "Unknown",
	)
		.replace("{{title}}", context.title || "Unknown")
		.replace("{{description}}", context.description || "Not available");

const createUserMessage = (prompt: CoAgentPrompt): ChatMessage => ({
	id: `co-agent-user-${Date.now()}`,
	role: "user",
	content: prompt,
	timestamp: new Date(),
});

export const createCoAgentFlowPrefixConfig = () => ({
	graphType: "foundation",
	steps: [
		{
			id: "runtime__co_agent_feature__1",
			name: CO_AGENT_FEATURE_STEP_NAME,
			enabled: true,
		},
	],
});

export const coAgentChatService = {
	chatStream: (
		options: CoAgentChatStreamOptions,
	): Promise<EmbeddedChatStreamResult> =>
		embeddedChatService.chatStream({
			messages: [createUserMessage(options.prompt)],
			model: options.model,
			mode: "custom",
			agentFlowId:
				!options.agentFlowId || options.agentFlowId === "chat"
					? undefined
					: options.agentFlowId,
			flowConfigPrefix: createCoAgentFlowPrefixConfig(),
			systemMessages: [
				renderCoAgentPageContextPrompt(options.pageContext),
				renderAnchorContextPrompt(options.anchorContext),
			].filter((message): message is string => Boolean(message)),
			onExecuteStart: options.onExecuteStart,
			onProgress: options.onProgress,
			onAction: options.onAction,
			onToolCalls: options.onToolCalls,
			onError: options.onError,
			signal: options.signal,
		}),
};
