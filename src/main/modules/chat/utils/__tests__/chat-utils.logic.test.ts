import { describe, expect, it, vi } from "vitest";

const { readFileAsBase64 } = vi.hoisted(() => ({
	readFileAsBase64: vi.fn(async () => "data:image/png;base64,converted"),
}));

vi.mock("@/services/filesystem/document-filesystem", () => ({
	documentFileSystemService: { readFileAsBase64 },
}));

import { buildSendMessages } from "../build-send-messages";
import { groupMessagesBySeparators } from "../message-grouping";

const msg = (overrides: Record<string, unknown>) =>
	({
		id: crypto.randomUUID(),
		conversationId: "conversation-1",
		role: "user",
		type: "message",
		content: "",
		createdAt: new Date("2024-01-01T00:00:00.000Z"),
		updatedAt: new Date("2024-01-01T00:00:00.000Z"),
		...overrides,
	}) as any;

describe("chat message grouping", () => {
	it("splits messages into completed groups and an in-progress group", () => {
		const first = msg({ id: "m1", content: "first" });
		const separator = msg({ id: "s1", type: "separator" });
		const second = msg({ id: "m2", content: "second" });

		expect(groupMessagesBySeparators([first, separator, second])).toEqual({
			groups: [
				{
					id: "group-0",
					messages: [first],
					separator,
					isLatest: false,
				},
			],
			inprogressGroup: {
				id: "group-1",
				messages: [second],
				separator: undefined,
				isLatest: true,
			},
			completedGroupsIds: ["group-0"],
		});
		expect(groupMessagesBySeparators([])).toEqual({
			groups: [],
			inprogressGroup: null,
			completedGroupsIds: [],
		});
	});
});

describe("buildSendMessages", () => {
	it("filters separators and converts message records to OpenAI chat messages", async () => {
		const messages = await buildSendMessages([
			msg({ role: "system", content: "system prompt" }),
			msg({ type: "separator" }),
			msg({
				role: "user",
				content: "ignored",
				complexContent: [
					{ type: "text", text: "hello" },
					{
						type: "image_url",
						image_url: {
							url: "/resources/images/image.png",
							mimeType: "image/png",
							detail: "low",
						},
					},
				],
			}),
			msg({
				role: "assistant",
				content: "final answer",
				metadata: {
					actions: [
						{
							id: "a1",
							name: "Search",
							description: "result text",
							metadata: { tool: "web_search" },
						},
					],
				},
			}),
			msg({
				role: "assistant",
				content: "ignored parts",
				parts: [{ role: "assistant", content: "stored part" }],
			}),
		] as any);

		expect(readFileAsBase64).toHaveBeenCalledWith(
			"/resources/images/image.png",
			"image/png",
		);
		expect(messages).toEqual([
			{ role: "system", content: "system prompt" },
			{
				role: "user",
				content: [
					{ type: "text", text: "hello" },
					{
						type: "image_url",
						image_url: {
							url: "data:image/png;base64,converted",
							detail: "low",
						},
					},
				],
			},
			{
				role: "assistant",
				content: expect.stringContaining("<tool_call><name>web_search</name>"),
			},
			{ role: "assistant", content: "stored part" },
		]);
	});

	it("uses assistant complex text for legacy timeline content", async () => {
		const messages = await buildSendMessages([
			msg({
				role: "assistant",
				content: "",
				complexContent: [
					{ type: "text", text: "visible" },
					{ type: "tool", text: "tool timeline" },
				],
			}),
		] as any);

		expect(messages).toEqual([{ role: "assistant", content: "visible" }]);
	});
});
