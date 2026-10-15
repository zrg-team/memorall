import { describe, expect, it } from "vitest";
import type { ChatCompletionMessageParam } from "@/types/openai";
import type { HostedAppAi, HostedChatReply } from "../ai";
import { type HostedAssistantEvent, runHostedAssistant } from "../assistant";
import type { HostedFileAccess } from "../commands";
import { fakeEngine } from "./fake-engine";

const PATH = "/notes/Report.pdf";

const disk = (text: string) => {
	const files = new Map<string, Uint8Array>([
		[PATH, new TextEncoder().encode(text)],
	]);
	const access: HostedFileAccess = {
		read: async (path) => files.get(path) ?? null,
		write: async (path, bytes) => {
			files.set(path, bytes);
		},
	};
	return { access, text: () => new TextDecoder().decode(files.get(PATH)) };
};

const call = (id: string, name: string, args: string) => ({
	id,
	type: "function" as const,
	function: { name, arguments: args },
});

/** A model that answers with the next scripted reply, keeping each request. */
const scripted = (replies: HostedChatReply["message"][]) => {
	const requests: Record<string, unknown>[] = [];
	const ai: HostedAppAi = {
		async chat(params, { onPart } = {}) {
			requests.push(structuredClone(params));
			const message = replies.shift() ?? { role: "assistant", content: "" };
			if (message.content) onPart?.({ type: "text", text: message.content });
			return { message, finish_reason: "stop", usage: null };
		},
	};
	return { ai, requests };
};

describe("Memorall's assistant beside an app", () => {
	it("works on the open file with the app's commands until it answers", async () => {
		const file = disk("one");
		const { ai, requests } = scripted([
			{
				role: "assistant",
				content: "",
				tool_calls: [
					call("c1", "add", '{"text":"two"}'),
					call("c2", "add", '{"text":"zero","where":"top"}'),
				],
			},
			{ role: "assistant", content: "Added two lines." },
		]);
		const events: HostedAssistantEvent[] = [];
		const transcript: ChatCompletionMessageParam[] = [];

		await runHostedAssistant({
			path: PATH,
			transcript,
			message: "Add two and zero",
			ai,
			files: file.access,
			loadEngine: async (id) => fakeEngine(id),
			onEvent: (event) => events.push(event),
		});

		expect(file.text()).toBe("zero\none\ntwo");
		// The app's commands are the tools, and the file is in the instructions.
		const first = requests[0] as {
			messages: ChatCompletionMessageParam[];
			tools: { function: { name: string } }[];
		};
		expect(first.tools.map((tool) => tool.function.name)).toEqual([
			"read",
			"add",
			"fail",
		]);
		expect(first.messages[0]).toMatchObject({
			role: "system",
			content: expect.stringContaining("1 lines: one"),
		});
		expect(events.map((event) => event.type)).toEqual(["run", "ran", "text"]);
		expect(transcript.map((message) => message.role)).toEqual([
			"user",
			"assistant",
			"tool",
			"tool",
			"assistant",
		]);
		// Each call is answered; the last answer shows the file as it is now.
		expect(transcript[2]).toEqual({
			role: "tool",
			tool_call_id: "c1",
			content: "added two",
		});
		expect(transcript[3]).toMatchObject({
			tool_call_id: "c2",
			content: expect.stringContaining(
				"Saved. The file now:\n3 lines: zero | one | two",
			),
		});
	});

	it("runs nothing for calls it cannot read, and says so", async () => {
		const file = disk("one");
		const { ai } = scripted([
			{
				role: "assistant",
				content: "",
				tool_calls: [call("c1", "add", "{broken")],
			},
			{ role: "assistant", content: "Sorry." },
		]);
		const events: HostedAssistantEvent[] = [];
		const transcript: ChatCompletionMessageParam[] = [];

		await runHostedAssistant({
			path: PATH,
			transcript,
			message: "Add",
			ai,
			files: file.access,
			loadEngine: async (id) => fakeEngine(id),
			onEvent: (event) => events.push(event),
		});

		expect(file.text()).toBe("one");
		expect(events[0]).toMatchObject({ type: "refused" });
		expect(transcript[2]).toMatchObject({ role: "tool", tool_call_id: "c1" });
	});

	it("keeps what ran before a failed command, and skips the rest", async () => {
		const file = disk("one");
		const { ai } = scripted([
			{
				role: "assistant",
				content: "",
				tool_calls: [
					call("c1", "add", '{"text":"two"}'),
					call("c2", "fail", "{}"),
					call("c3", "add", '{"text":"three"}'),
				],
			},
			{ role: "assistant", content: "That failed." },
		]);
		const events: HostedAssistantEvent[] = [];
		const transcript: ChatCompletionMessageParam[] = [];

		await runHostedAssistant({
			path: PATH,
			transcript,
			message: "Try",
			ai,
			files: file.access,
			loadEngine: async (id) => fakeEngine(id),
			onEvent: (event) => events.push(event),
		});

		expect(file.text()).toBe("one\ntwo");
		expect(events.find((event) => event.type === "ran")).toMatchObject({
			result: { saved: true },
		});
		expect(transcript.slice(2, 5).map((message) => message.content)).toEqual([
			"added two",
			"FAILED Error: refused.",
			expect.stringMatching(/^Skipped: an earlier command failed\./),
		]);
	});
});
