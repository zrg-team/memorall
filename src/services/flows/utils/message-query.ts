import type { ChatCompletionMessageParam } from "../interfaces/messages";

const contentToText = (
	content: ChatCompletionMessageParam["content"],
): string => {
	if (typeof content === "string") {
		return content;
	}
	if (Array.isArray(content)) {
		return content
			.filter((part) => part.type === "text")
			.map((part) => (part as { type: "text"; text: string }).text)
			.join("\n");
	}
	return "";
};

/**
 * Derive retrieval text from messages without storing duplicated query in state.
 * Priority:
 * 1) Latest user message text
 * 2) Latest non-empty message text
 * 3) Empty string
 */
export const extractRetrievalTextFromMessages = (
	messages: ChatCompletionMessageParam[],
): string => {
	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const message = messages[i];
		if (message.role !== "user") continue;
		const text = contentToText(message.content).trim();
		if (text) return text;
	}

	for (let i = messages.length - 1; i >= 0; i -= 1) {
		const text = contentToText(messages[i].content).trim();
		if (text) return text;
	}

	return "";
};
