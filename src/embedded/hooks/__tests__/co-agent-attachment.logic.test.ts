import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	chatStream: vi.fn(async (_options: Record<string, unknown>) => ({
		content: "",
		actions: [],
	})),
}));

vi.mock("@/embedded/chat-service", () => ({
	embeddedChatService: { chatStream: mocks.chatStream },
}));

import { buildEmbeddedContextMessageContent } from "@/embedded/context-items";
import { coAgentChatService } from "@/embedded/pages/CoAgent/co-agent-chat";

const PNG = "data:image/png;base64,AAAA";

const composedWithImage = () =>
	buildEmbeddedContextMessageContent({
		userMessage: "what is this?",
		contexts: [
			{
				id: "c1",
				kind: "selected_image",
				label: "Image: <div> 9,5 ty",
				content: PNG,
			},
		],
		pageTitle: "map",
		pageUrl: "https://x.test/",
	});

const sentMessages = () => {
	const call = mocks.chatStream.mock.calls.at(-1);
	if (!call) throw new Error("The co-agent never called the chat service.");
	return (call[0] as { messages: Array<{ content: unknown }> }).messages;
};

describe("attaching a captured region to a co-agent prompt", () => {
	it("sends the picture as an image, not as the element's text", async () => {
		// The dock used to keep only the text parts, so a screenshot arrived as
		// the screen-reader labels of the div it was cut from and the model
		// answered about those instead of looking at the image.
		await coAgentChatService.chatStream({
			prompt: composedWithImage(),
			model: "m",
			pageContext: { url: "https://x.test/", title: "map" },
		});

		const content = sentMessages()[0].content as Array<{
			type: string;
			image_url?: { url: string };
		}>;
		expect(Array.isArray(content)).toBe(true);
		expect(content.some((part) => part.type === "image_url")).toBe(true);
		expect(
			content.find((part) => part.type === "image_url")?.image_url?.url,
		).toBe(PNG);
	});

	it("still carries the question alongside the picture", async () => {
		await coAgentChatService.chatStream({
			prompt: composedWithImage(),
			model: "m",
			pageContext: { url: "https://x.test/", title: "map" },
		});

		const content = sentMessages()[0].content as Array<{
			type: string;
			text?: string;
		}>;
		expect(content[0].type).toBe("text");
		expect(content[0].text).toContain("what is this?");
	});

	it("leaves a plain question as a plain string", async () => {
		await coAgentChatService.chatStream({
			prompt: "just asking",
			model: "m",
			pageContext: { url: "https://x.test/", title: "map" },
		});

		expect(sentMessages()[0].content).toBe("just asking");
	});
});

describe("buildEmbeddedContextMessageContent", () => {
	it("emits an image part for a captured region", () => {
		const content = composedWithImage();

		expect(Array.isArray(content)).toBe(true);
		expect(
			(content as Array<{ type: string }>).filter(
				(part) => part.type === "image_url",
			),
		).toHaveLength(1);
	});
});
