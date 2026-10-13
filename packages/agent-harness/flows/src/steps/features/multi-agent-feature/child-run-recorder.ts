import type { ChatCompletionChunk } from "../../../interfaces/engine/messages.js";
import type {
	ChildAgentExchange,
	ChildAgentMessageOptions,
	ChildAgentRun,
	ChildAgentStep,
} from "../../../interfaces/tools/multi-agent.js";
import { isCustomChunkPayload } from "../../../utils/langgraph-stream.js";
import {
	mergeTokenUsage,
	normalizeTokenUsage,
} from "../../../utils/token-usage.js";

/** Enough of a tool's input or output to recognise it; the rest is in the run. */
const MAX_TOOL_TEXT_LENGTH = 1_500;
/** The child's own words, clipped only when they are a report in themselves. */
const MAX_STEP_TEXT_LENGTH = 6_000;
/** An earlier message is a reminder of what was said, not the record of it. */
const MAX_EXCHANGE_MESSAGE_LENGTH = 300;
const MAX_EXCHANGE_REPLY_LENGTH = 500;

const clip = (value: string, limit: number): string =>
	value.length <= limit ? value : `${value.slice(0, limit).trimEnd()}\n…`;

const toText = (value: unknown): string | undefined => {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
	value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;

type ToolStep = Extract<ChildAgentStep, { type: "tool" }>;

/**
 * What a child agent did for one message, read off its run's stream: what it
 * wrote, each tool it called and how that went, and what its requests cost.
 *
 * The stream is the only place all of it shows up — the run's state keeps the
 * conversation but not how long a tool took or whether it failed, and never
 * the usage. Usage is also passed on to the parent run, which otherwise never
 * sees the child's requests and leaves them out of what the reply cost.
 */
export class ChildRunRecorder {
	private readonly steps: ChildAgentStep[] = [];
	private run: Omit<ChildAgentRun, "steps">;

	constructor(
		run: Pick<ChildAgentRun, "agent" | "turn" | "history">,
		private readonly options: ChildAgentMessageOptions = {},
	) {
		this.run = { ...run, status: "running", requests: 0 };
	}

	/** Report the run as it stands, so the card names the agent at once. */
	start(): void {
		this.options.onProgress?.(this.snapshot());
	}

	record(payload: unknown): void {
		if (!isCustomChunkPayload(payload)) return;
		const event = payload as Record<string, unknown>;
		switch (event.type) {
			case "llm":
				this.recordChunk(event.chunk as ChatCompletionChunk | undefined);
				return;
			case "execute-start":
				this.recordToolStart(asRecord(event.metadata));
				return;
			case "tool-result":
				this.recordToolResult(asRecord(event.metadata));
				return;
		}
	}

	finish(): ChildAgentRun {
		for (const step of this.steps) {
			// A call the run never answered — it stopped at its iteration limit.
			if (step.type === "tool" && step.status === "running") {
				step.status = "failed";
			}
		}
		this.run = { ...this.run, status: "completed" };
		return this.snapshot();
	}

	/** This message as the next one will list it among the earlier ones. */
	toExchange(message: string, reply: string): ChildAgentExchange {
		return {
			turn: this.run.turn,
			message: clip(message.trim(), MAX_EXCHANGE_MESSAGE_LENGTH),
			reply: clip(reply.trim(), MAX_EXCHANGE_REPLY_LENGTH),
			tools: this.steps.filter((step) => step.type === "tool").length,
		};
	}

	snapshot(): ChildAgentRun {
		return {
			...this.run,
			steps: this.steps
				.filter((step) => step.type !== "text" || step.content.trim())
				.map((step) =>
					step.type === "text"
						? {
								type: "text",
								content: clip(step.content.trim(), MAX_STEP_TEXT_LENGTH),
							}
						: { ...step },
				),
		};
	}

	private recordChunk(chunk: ChatCompletionChunk | undefined): void {
		if (!chunk) return;
		const usage = normalizeTokenUsage(chunk.usage);
		if (usage) {
			this.run = {
				...this.run,
				usage: this.run.usage ? mergeTokenUsage(this.run.usage, usage) : usage,
				requests: this.run.requests + 1,
			};
			// Only the usage: the parent must not read the child's words as its own.
			this.options.writer?.({
				type: "llm",
				chunk: { ...chunk, choices: [], usage },
			});
		}

		const delta = chunk.choices?.[0]?.delta;
		// Tool results arrive here too; their content comes with `tool-result`.
		if (!delta?.content || delta.role === "tool" || delta.tool_call_id) return;
		const last = this.steps.at(-1);
		if (last?.type === "text") {
			last.content += delta.content;
		} else {
			this.steps.push({ type: "text", content: delta.content });
		}
	}

	private recordToolStart(metadata: Record<string, unknown> | undefined): void {
		const id = metadata?.tool_call_id;
		const name = metadata?.tool;
		// Step nodes report `execute-start` too; only tool calls carry an id.
		if (typeof id !== "string" || typeof name !== "string") return;
		const input = toText(metadata?.input);
		this.steps.push({
			type: "tool",
			id,
			name,
			...(input ? { input: clip(input, MAX_TOOL_TEXT_LENGTH) } : {}),
			status: "running",
			...(typeof metadata?.startedAt === "string"
				? { startedAt: metadata.startedAt }
				: {}),
		});
		this.options.onProgress?.(this.snapshot());
	}

	private recordToolResult(
		metadata: Record<string, unknown> | undefined,
	): void {
		const id = metadata?.tool_call_id;
		if (typeof id !== "string") return;
		const step = this.steps.find(
			(candidate): candidate is ToolStep =>
				candidate.type === "tool" && candidate.id === id,
		);
		if (!step) return;
		const output = toText(metadata?.content ?? metadata?.structuredContent);
		if (output !== undefined) {
			step.output = clip(output, MAX_TOOL_TEXT_LENGTH);
		}
		step.status = metadata?.isError === true ? "failed" : "completed";
		if (typeof metadata?.durationMs === "number") {
			step.durationMs = metadata.durationMs;
		}
		this.options.onProgress?.(this.snapshot());
	}
}
