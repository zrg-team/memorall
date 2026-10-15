import type {
	ChatCompletionMessageParam,
	ChatCompletionMessageToolCall,
	ChatCompletionTool,
} from "@/types/openai";
import type { HostedAppAi } from "./ai";
import { HOSTED_APPS, type HostedAppId } from "./catalog";
import {
	describeHostedFile,
	type HostedCommandCall,
	type HostedEngineLoader,
	type HostedFileAccess,
	type HostedRunResult,
	runHostedAppCommands,
} from "./commands";
import type { HostedEngineServices } from "./engine-types";

/**
 * Memorall's assistant beside a hosted app that has none of its own (PDF):
 * a conversation with the user's chat model whose tools are the app's
 * commands, the same ones the agent runs on the file. Each round's calls run
 * together and the file is saved once; the app then shows the file anew.
 */

/** Rounds of tool calls one request may take before it stops. */
export const MAX_ASSISTANT_ROUNDS = 12;

export type HostedAssistantEvent =
	/** Words of the answer, as they come. */
	| { type: "text"; text: string }
	/** The commands the model asked for, about to run. */
	| { type: "run"; calls: HostedCommandCall[] }
	/** What they did. */
	| { type: "ran"; result: HostedRunResult }
	/** A round of calls whose arguments could not be read. */
	| { type: "refused"; reason: string };

export interface HostedAssistantRequest {
	path: string;
	/** The conversation so far, without the instructions; grows with this turn. */
	transcript: ChatCompletionMessageParam[];
	/** The user's new message. */
	message: string;
	ai: HostedAppAi;
	files: HostedFileAccess;
	loadEngine: HostedEngineLoader;
	services?: HostedEngineServices;
	signal?: AbortSignal;
	onEvent?: (event: HostedAssistantEvent) => void;
}

export const assistantInstructions = (
	app: HostedAppId,
	path: string,
	guide: string,
	description: string,
): string =>
	[
		`You are the assistant in Memorall's ${HOSTED_APPS[app].name} app. The user has ${path} open beside you.`,
		"Read and change the file only with your tools: they are the app's commands. Each round of calls is saved to the file at once and the app shows the result.",
		"Read before you change, check your work, and say briefly what you did. Answer in the user's language.",
		guide,
		"",
		"The file now:",
		description,
	].join("\n");

const toolsOf = (
	commands: Awaited<ReturnType<HostedEngineLoader>>["commands"],
): ChatCompletionTool[] =>
	commands.map((command) => ({
		type: "function",
		function: {
			name: command.name,
			description: command.description,
			parameters: command.parameters,
		},
	}));

const argumentsOf = (
	call: ChatCompletionMessageToolCall,
): Record<string, unknown> | null => {
	const text = call.function.arguments?.trim();
	if (!text) return {};
	try {
		const value = JSON.parse(text);
		return value && typeof value === "object" && !Array.isArray(value)
			? value
			: null;
	} catch {
		return null;
	}
};

/** One answer to the user's message: runs until the model stops calling commands. */
export const runHostedAssistant = async ({
	path,
	transcript,
	message,
	ai,
	files,
	loadEngine,
	services,
	signal,
	onEvent,
}: HostedAssistantRequest): Promise<void> => {
	const { app, description } = await describeHostedFile({
		path,
		files,
		loadEngine,
		services,
	});
	const engine = await loadEngine(app);
	const tools = toolsOf(engine.commands);
	const system: ChatCompletionMessageParam = {
		role: "system",
		content: assistantInstructions(app, path, engine.guide, description),
	};
	transcript.push({ role: "user", content: message });
	for (let round = 0; round < MAX_ASSISTANT_ROUNDS; round++) {
		const reply = await ai.chat(
			{ messages: [system, ...transcript], tools, stream: true },
			{
				signal,
				onPart: (part) => {
					if (part.type === "text")
						onEvent?.({ type: "text", text: part.text });
				},
			},
		);
		const calls = reply.message.tool_calls ?? [];
		transcript.push({
			role: "assistant",
			// An empty assistant message is refused by some models.
			content: reply.message.content || (calls.length ? null : "Done."),
			...(calls.length ? { tool_calls: calls } : {}),
		});
		if (!calls.length) return;
		const parsed = calls.map(argumentsOf);
		if (parsed.some((args) => args === null)) {
			const reason = "Arguments were not valid JSON; nothing was run.";
			onEvent?.({ type: "refused", reason });
			for (const call of calls)
				transcript.push({
					role: "tool",
					tool_call_id: call.id,
					content: reason,
				});
			continue;
		}
		const batch = calls.map((call, index) => ({
			name: call.function.name,
			args: parsed[index] ?? {},
		}));
		onEvent?.({ type: "run", calls: batch });
		let result: HostedRunResult;
		try {
			result = await runHostedAppCommands({
				path,
				calls: batch,
				files,
				loadEngine,
				services,
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			onEvent?.({ type: "refused", reason });
			for (const call of calls)
				transcript.push({
					role: "tool",
					tool_call_id: call.id,
					content: reason,
				});
			continue;
		}
		onEvent?.({ type: "ran", result });
		calls.forEach((call, index) => {
			const outcome = result.outcomes[index];
			const answer = !outcome
				? "Not run."
				: outcome.skipped
					? "Skipped: an earlier command failed."
					: `${outcome.ok ? "" : "FAILED "}${outcome.content}`;
			const last = index === calls.length - 1;
			transcript.push({
				role: "tool",
				tool_call_id: call.id,
				content: last
					? `${answer}\n\n${result.saved ? "Saved." : "Nothing changed."} The file now:\n${result.description}`
					: answer,
			});
		});
	}
	onEvent?.({
		type: "text",
		text: "\n\nI stopped here: that took many steps. Ask me to carry on.",
	});
};
