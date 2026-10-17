import type { ChatCompletionChunk } from "../../../interfaces/engine/messages.js";
import type {
	ChildAgentExchange,
	ChildAgentMessageOptions,
	ChildAgentRun,
	ChildAgentStep,
} from "../../../interfaces/tools/multi-agent.js";
import { ITERATION_LIMIT_EVENT } from "../../../limits.js";
import { isCustomChunkPayload } from "../../../utils/langgraph-stream.js";
import {
	mergeTokenUsage,
	normalizeTokenUsage,
} from "../../../utils/token-usage.js";

/** Enough of a tool's input or output to recognise it; the rest is in the run. */
const MAX_TOOL_TEXT_LENGTH = 1_500;
/**
 * A JSON result kept as JSON — web searches, page reads — so the chat can
 * still draw it as that tool's card: long strings and lists are cut instead.
 */
const MAX_TOOL_JSON_LENGTH = 6_000;
/** The child's own words, clipped only when they are a report in themselves. */
const MAX_STEP_TEXT_LENGTH = 6_000;
/** An earlier message is a reminder of what was said, not the record of it. */
const MAX_EXCHANGE_MESSAGE_LENGTH = 300;
const MAX_EXCHANGE_REPLY_LENGTH = 500;
/**
 * A run as reported, at most. The chat drops a tool's details past 64,000
 * characters, and a run that outgrew them stopped updating: its last
 * reported step showed as running for good.
 */
const MAX_RUN_LENGTH = 48_000;
/** The latest steps keep their detail when older ones are cut to fit. */
const DETAILED_STEPS = 6;
/** What an older step keeps of its input and output once cut to fit. */
const COMPACT_TOOL_TEXT_LENGTH = 160;
const COMPACT_STEP_TEXT_LENGTH = 400;
const MAX_ERROR_LENGTH = 500;

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

/** A JSON value with every string cut to `text` and every list to `items`. */
const shrinkJson = (
	value: unknown,
	limits: { text: number; items: number },
	depth = 0,
): unknown => {
	if (typeof value === "string") return clip(value, limits.text);
	if (Array.isArray(value)) {
		return value
			.slice(0, limits.items)
			.map((item) => shrinkJson(item, limits, depth + 1));
	}
	const record = asRecord(value);
	if (!record) return value;
	if (depth > 6) return "…";
	return Object.fromEntries(
		Object.entries(record).map(([key, entry]) => [
			key,
			shrinkJson(entry, limits, depth + 1),
		]),
	);
};

/**
 * A tool's input or output, short enough to report. JSON stays JSON: cut in
 * the middle it no longer parses, and every tool card that reads it fell
 * back to a wall of raw text.
 */
const clipToolText = (text: string): string => {
	if (text.length <= MAX_TOOL_TEXT_LENGTH) return text;
	const trimmed = text.trimStart();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			const parsed: unknown = JSON.parse(trimmed);
			for (const limits of [
				{ text: 400, items: 10 },
				{ text: 160, items: 5 },
			]) {
				const compact = JSON.stringify(shrinkJson(parsed, limits));
				if (compact.length <= MAX_TOOL_JSON_LENGTH) return compact;
			}
		} catch {
			// Not JSON after all: clipped as text below.
		}
	}
	return clip(text, MAX_TOOL_TEXT_LENGTH);
};

const errorText = (error: unknown): string =>
	clip(
		error instanceof Error ? error.message : String(error ?? "Unknown error"),
		MAX_ERROR_LENGTH,
	);

type ToolStep = Extract<ChildAgentStep, { type: "tool" }>;

/** A step cut down to fit: its text to a line, its result to `toolText`. */
const compactStep = (step: ChildAgentStep, toolText: number): ChildAgentStep =>
	step.type === "text"
		? { type: "text", content: clip(step.content, COMPACT_STEP_TEXT_LENGTH) }
		: {
				...step,
				...(step.input
					? { input: clip(step.input, COMPACT_TOOL_TEXT_LENGTH) }
					: {}),
				...(step.output ? { output: clip(step.output, toolText) } : {}),
			};

/** How a child's turn ended, as the manager saw it. */
export interface ChildRunEnd {
	/** The error that ended it, if one did. */
	error?: unknown;
	/** It was stopped from outside (the parent run was stopped). */
	aborted?: boolean;
	/** It gave a reply. */
	replied?: boolean;
}

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
	/** The run made its last allowed request; it ends without replying. */
	private reachedStepLimit = false;

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
			case ITERATION_LIMIT_EVENT:
				this.reachedStepLimit = true;
				return;
		}
	}

	/**
	 * Ends the run, however it ended, and reports it: the last progress is the
	 * final word even when the tool's result arrives without the run.
	 */
	finish(end: ChildRunEnd = {}): ChildAgentRun {
		const failed = end.error !== undefined && !end.aborted;
		const stopped =
			end.aborted === true || (this.reachedStepLimit && !end.replied);
		const status: ChildAgentRun["status"] = failed
			? "failed"
			: stopped
				? "stopped"
				: "completed";
		for (const step of this.steps) {
			if (step.type !== "tool" || step.status !== "running") continue;
			// A call the run never answered: cut off when it ended.
			step.status = status === "completed" ? "failed" : "stopped";
		}
		this.run = {
			...this.run,
			status,
			endedAt: new Date().toISOString(),
			...(failed
				? { endReason: "error" as const, error: errorText(end.error) }
				: end.aborted
					? { endReason: "aborted" as const }
					: stopped
						? { endReason: "step_limit" as const }
						: {}),
		};
		const run = this.snapshot();
		this.options.onProgress?.(run);
		return run;
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

	/**
	 * The run as it stands, within MAX_RUN_LENGTH: past it the oldest steps
	 * are cut down to a line, then left out (counted in `omittedSteps`), while
	 * the latest ones keep their detail.
	 */
	snapshot(): ChildAgentRun {
		const steps = this.steps
			.filter((step) => step.type !== "text" || step.content.trim())
			.map(
				(step): ChildAgentStep =>
					step.type === "text"
						? {
								type: "text",
								content: clip(step.content.trim(), MAX_STEP_TEXT_LENGTH),
							}
						: { ...step },
			);
		const base = JSON.stringify({ ...this.run, steps: [] }).length;
		const sizeOf = (step: ChildAgentStep) => JSON.stringify(step).length + 1;
		let total = base + steps.reduce((sum, step) => sum + sizeOf(step), 0);
		if (total <= MAX_RUN_LENGTH) return { ...this.run, steps };

		// Oldest first: each older step is cut to a line until the run fits.
		const detailedFrom = Math.max(0, steps.length - DETAILED_STEPS);
		const fitted = steps.map((step, index) => {
			if (index >= detailedFrom || total <= MAX_RUN_LENGTH) return step;
			const compact = compactStep(step, COMPACT_TOOL_TEXT_LENGTH);
			total += sizeOf(compact) - sizeOf(step);
			return compact;
		});

		// Then the oldest are left out, never the latest few.
		let omitted = 0;
		for (const step of fitted) {
			if (
				total <= MAX_RUN_LENGTH ||
				fitted.length - omitted <= DETAILED_STEPS
			) {
				break;
			}
			total -= sizeOf(step);
			omitted += 1;
		}
		const kept = fitted.slice(omitted);
		return {
			...this.run,
			// Still too long: the latest steps are cut down too, rather than lost.
			steps:
				total > MAX_RUN_LENGTH
					? kept.map((step) => compactStep(step, MAX_TOOL_TEXT_LENGTH))
					: kept,
			...(omitted > 0 ? { omittedSteps: omitted } : {}),
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
			...(input ? { input: clipToolText(input) } : {}),
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
			step.output = clipToolText(output);
		}
		step.status = metadata?.isError === true ? "failed" : "completed";
		if (typeof metadata?.durationMs === "number") {
			step.durationMs = metadata.durationMs;
		}
		this.options.onProgress?.(this.snapshot());
	}
}
