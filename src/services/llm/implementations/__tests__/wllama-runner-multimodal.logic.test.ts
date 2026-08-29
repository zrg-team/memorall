import { describe, expect, it, vi } from "vitest";
import {
	decodeDataUrl,
	hasMediaContent,
	toWllamaMessages,
} from "../../../../../public/runner/utils/openai-content.js";

const PNG_BASE64 = "iVBORw0KGgo=";
const PNG_BYTES = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const imageMessage = (url: string) => ({
	role: "user",
	content: [
		{ type: "image_url", image_url: { url, detail: "auto" } },
		{ type: "text", text: "What is this?" },
	],
});

describe("decodeDataUrl", () => {
	it("decodes base64 payloads to the original bytes", () => {
		const { mimeType, data } = decodeDataUrl(
			`data:image/png;base64,${PNG_BASE64}`,
		);

		expect(mimeType).toBe("image/png");
		expect([...new Uint8Array(data)]).toEqual(PNG_BYTES);
	});

	it("decodes percent-encoded payloads", () => {
		const { mimeType, data } = decodeDataUrl("data:text/plain,hello%20there");

		expect(mimeType).toBe("text/plain");
		expect(new TextDecoder().decode(data)).toBe("hello there");
	});

	it("reads base64 even behind other media parameters", () => {
		const { data } = decodeDataUrl(
			`data:image/png;charset=utf-8;base64,${PNG_BASE64}`,
		);

		expect([...new Uint8Array(data)]).toEqual(PNG_BYTES);
	});

	it("rejects a malformed data URL rather than passing junk to the model", () => {
		expect(() => decodeDataUrl("data:image/png;base64")).toThrow(/Malformed/);
	});
});

describe("toWllamaMessages", () => {
	it("turns an OpenAI image part into wllama's decoded-bytes part", async () => {
		// wllama reads `part.data`; an untranslated image_url part makes it push
		// `undefined` into the media list and the image never reaches the model.
		const [message] = await toWllamaMessages([
			imageMessage(`data:image/png;base64,${PNG_BASE64}`),
		]);

		expect(message.content[0].type).toBe("image");
		expect([...new Uint8Array(message.content[0].data)]).toEqual(PNG_BYTES);
		expect(message.content[1]).toEqual({
			type: "text",
			text: "What is this?",
		});
	});

	it("leaves string content and text-only conversations untouched", async () => {
		const messages = [
			{ role: "system", content: "You are helpful." },
			{ role: "user", content: "Hi" },
			{ role: "assistant", content: "Hello" },
		];

		await expect(toWllamaMessages(messages)).resolves.toEqual(messages);
	});

	it("passes tool-call and tool-result messages through unchanged", async () => {
		const messages = [
			{
				role: "assistant",
				content: null,
				tool_calls: [
					{
						id: "call_1",
						type: "function",
						function: { name: "get_weather", arguments: '{"city":"Hanoi"}' },
					},
				],
			},
			{ role: "tool", tool_call_id: "call_1", content: '{"tempC":31}' },
		];

		await expect(toWllamaMessages(messages)).resolves.toEqual(messages);
	});

	it("fetches a remote image URL", async () => {
		const fetchImpl = vi.fn(async () => ({
			ok: true,
			headers: { get: () => "image/png" },
			arrayBuffer: async () => new Uint8Array(PNG_BYTES).buffer,
		}));

		const [message] = await toWllamaMessages(
			[imageMessage("https://example.com/cat.png")],
			{ fetchImpl: fetchImpl as unknown as typeof fetch },
		);

		expect(fetchImpl).toHaveBeenCalledWith("https://example.com/cat.png");
		expect([...new Uint8Array(message.content[0].data)]).toEqual(PNG_BYTES);
	});

	it("surfaces a failed media fetch instead of sending an empty image", async () => {
		const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 }));

		await expect(
			toWllamaMessages([imageMessage("https://example.com/missing.png")], {
				fetchImpl: fetchImpl as unknown as typeof fetch,
			}),
		).rejects.toThrow(/404/);
	});

	it("refuses images on a model with no projector rather than answering blind", async () => {
		await expect(
			toWllamaMessages([imageMessage(`data:image/png;base64,${PNG_BASE64}`)], {
				supportsModality: () => false,
			}),
		).rejects.toThrow(/does not accept image input/);
	});

	it("decodes OpenAI audio parts, which arrive as bare base64", async () => {
		const [message] = await toWllamaMessages([
			{
				role: "user",
				content: [
					{
						type: "input_audio",
						input_audio: { data: PNG_BASE64, format: "wav" },
					},
				],
			},
		]);

		expect(message.content[0].type).toBe("audio");
		expect([...new Uint8Array(message.content[0].data)]).toEqual(PNG_BYTES);
	});

	it("accepts parts already in wllama's shape", async () => {
		const data = new Uint8Array(PNG_BYTES).buffer;
		const [message] = await toWllamaMessages([
			{ role: "user", content: [{ type: "image", data }] },
		]);

		expect(message.content[0]).toEqual({ type: "image", data });
	});
});

describe("hasMediaContent", () => {
	it("spots media in either wire shape", () => {
		expect(hasMediaContent([imageMessage("data:image/png;base64,AA==")])).toBe(
			true,
		);
		expect(
			hasMediaContent([
				{
					role: "user",
					content: [{ type: "image", data: new ArrayBuffer(1) }],
				},
			]),
		).toBe(true);
	});

	it("is false for a text-only conversation", () => {
		expect(hasMediaContent([{ role: "user", content: "hi" }])).toBe(false);
		expect(
			hasMediaContent([
				{ role: "user", content: [{ type: "text", text: "hi" }] },
			]),
		).toBe(false);
	});
});
