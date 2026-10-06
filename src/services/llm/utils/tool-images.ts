import type {
	ChatCompletionContentPartImage,
	ChatCompletionMessageParam,
} from "@/types/openai";

const isImagePart = (part: unknown): part is ChatCompletionContentPartImage =>
	typeof part === "object" &&
	part !== null &&
	(part as { type?: unknown }).type === "image_url";

const textOf = (part: unknown): string =>
	typeof part === "object" &&
	part !== null &&
	typeof (part as { text?: unknown }).text === "string"
		? (part as { text: string }).text
		: "";

/**
 * Pictures tools returned (memon_act describe, web_read_images,
 * pdf_to_image), moved out of their tool messages into one user message
 * right after the tool results. Chat APIs take images from the user; many
 * refuse them in a tool message. Each tool message keeps its text, so the
 * model knows which picture answers which call.
 */
export const liftToolImages = (
	messages: readonly ChatCompletionMessageParam[],
): ChatCompletionMessageParam[] => {
	const lifted: ChatCompletionMessageParam[] = [];
	let pictures: ChatCompletionContentPartImage[] = [];
	const flush = () => {
		if (!pictures.length) return;
		lifted.push({
			role: "user",
			content: [
				{ type: "text", text: "The pictures from the tool results above:" },
				...pictures,
			],
		});
		pictures = [];
	};
	for (const message of messages) {
		if (message.role !== "tool") {
			flush();
			lifted.push(message);
			continue;
		}
		const parts: unknown[] = Array.isArray(message.content)
			? message.content
			: [];
		const images = parts.filter(isImagePart);
		if (!images.length) {
			lifted.push(message);
			continue;
		}
		const text = parts.map(textOf).filter(Boolean).join("\n");
		lifted.push({
			...message,
			content: `${text || "(a picture)"}\n[the picture is in the next message]`,
		});
		pictures.push(...images);
	}
	flush();
	return lifted;
};
