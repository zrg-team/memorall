import { isNonModelMessageType } from "@/services/chat/coagent-session";
import type { ChatMessage, ChatCompletionContentPart } from "@/types/openai";
import type { ComplexContent, MessageParts } from "@/types/chat";
import type { Message } from "@/services/database";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";

const DESCRIPTION_SMALL_LIMIT = 500;
const DESCRIPTION_LIMIT = 1000;

type StoredAction = {
	id: string;
	name: string;
	description?: string;
	metadata?: Record<string, unknown>;
};

function renderAction(a: StoredAction): string {
	const description = a.description ?? "";
	const toolCall = a.metadata?.tool;

	if (toolCall) {
		return `<tool_call><name>${toolCall}</name>\n<content>${description.slice(0, DESCRIPTION_SMALL_LIMIT)}</content></tool_call>`;
	}

	return `<action><name>${a.name}</name>\n<content>${description.slice(0, DESCRIPTION_LIMIT)}<content></action>`;
}

function buildAssistantContent(msg: Message): string {
	const complexContent = Array.isArray(msg.complexContent)
		? (msg.complexContent as Array<{ type?: unknown; text?: unknown }>)
		: null;
	const complexText =
		complexContent
			?.map((part) =>
				part.type === "text" && typeof part.text === "string" ? part.text : "",
			)
			.filter(Boolean)
			.join("\n\n") ?? "";
	const hasLegacyTimelineParts =
		complexContent?.some(
			(part) => part.type === "tool" || part.type === "execution",
		) ?? false;
	if (hasLegacyTimelineParts || (!msg.content && complexText)) {
		return complexText;
	}

	const metadata = msg.metadata as Record<string, unknown> | null;
	const actions = metadata?.actions as StoredAction[] | undefined;

	if (!actions || actions.length === 0) return msg.content;

	const actionsPrefix = actions.map(renderAction).join("\n");
	const content = `${actionsPrefix}\n\n${msg.content}`;

	return content;
}

/**
 * Build the OpenAI content value for a user message.
 * If the message has complexContent, it is already stored as OpenAI-compatible
 * content parts. Otherwise return the plain string.
 */
async function buildUserContent(
	msg: Message,
): Promise<string | ChatCompletionContentPart[]> {
	const complexContent = msg.complexContent as
		| ComplexContent
		| null
		| undefined;

	if (!complexContent || complexContent.length === 0) {
		return msg.content;
	}

	const parts: ChatCompletionContentPart[] = await Promise.all(
		complexContent.map(async (part): Promise<ChatCompletionContentPart> => {
			if (part.type === "text") {
				return { type: "text", text: part.text };
			}
			if (part.type === "image_url") {
				const { url, detail = "auto", mimeType } = part.image_url;
				if (url.startsWith("data:") || !mimeType) {
					return {
						type: "image_url",
						image_url: { url, detail },
					};
				}
				const dataUrl = await documentFileSystemService.readFileAsBase64(
					url,
					mimeType,
				);
				return {
					type: "image_url",
					image_url: { url: dataUrl, detail },
				};
			}
			return { type: "text", text: "" };
		}),
	);

	return parts;
}

export async function buildSendMessages(
	relevantMessages: Message[],
): Promise<ChatMessage[]> {
	const filtered = relevantMessages.filter(
		(msg) => !isNonModelMessageType(msg.type),
	);
	const built: ChatMessage[] = [];

	for (const msg of filtered) {
		const role = msg.role as "system" | "user" | "assistant";
		if (role === "system") {
			built.push({ role, content: msg.content });
			continue;
		}
		if (role === "user") {
			const content = await buildUserContent(msg);
			built.push({ role, content });
			continue;
		}

		const parts = msg.parts as MessageParts | null | undefined;
		if (Array.isArray(parts) && parts.length > 0) {
			built.push(...parts);
			continue;
		}

		built.push({ role: "assistant", content: buildAssistantContent(msg) });
	}

	return built;
}
