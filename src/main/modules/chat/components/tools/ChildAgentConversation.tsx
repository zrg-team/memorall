import React from "react";
import { useTranslation } from "react-i18next";
import {
	AlertTriangle,
	Bot,
	CircleSlash,
	CornerDownRight,
	History,
} from "lucide-react";
import type {
	ChildAgentExchange,
	ChildAgentRun,
	ChildAgentStep,
} from "@memorall/agent-harness-flows/interfaces/tools/multi-agent";
import { ThreeDotsLoader } from "@/main/components/atoms/ThreeDotsLoader";
import {
	Message,
	MessageContent,
} from "@/main/components/ui/shadcn-io/ai/message";
import type { MessageActionItem } from "@/main/modules/chat/components/types";
import { serviceManager } from "@/services";
import type { ComplexContentPartTool } from "@/types/chat";
import { MarkdownMessage } from "../MarkdownMessage";
import { AssistantToolTimelinePart } from "../message/AssistantToolTimelinePart";
import {
	formatTokenCount,
	formatUsd,
} from "../../utils/conversation-cost-format";
import { getChildAgentRun } from "./child-agent-run";
import { getToolCallArguments, ToolItemRawIO } from "./ToolCommon";

type ToolStep = Extract<ChildAgentStep, { type: "tool" }>;

let agentNames: Promise<Map<string, string>> | undefined;

/** Saved agents by id, read once: a call from before runs were reported names only the id. */
const loadAgentNames = (): Promise<Map<string, string>> => {
	agentNames ??= serviceManager.flowBuilderService
		.listPredefinedFlows("foundation")
		.then((flows) => new Map(flows.map((flow) => [flow.id, flow.name])))
		.catch(() => {
			agentNames = undefined;
			return new Map<string, string>();
		});
	return agentNames;
};

const useAgentName = (agentId: string | undefined): string | undefined => {
	const [name, setName] = React.useState<string>();
	React.useEffect(() => {
		if (!agentId) return;
		let cancelled = false;
		void loadAgentNames().then((names) => {
			if (!cancelled) setName(names.get(agentId));
		});
		return () => {
			cancelled = true;
		};
	}, [agentId]);
	return name;
};

/** A JSON result as fields, the way a tool card reads its own result. */
const parsedOutput = (
	output: string | undefined,
): Record<string, unknown> | undefined => {
	const text = output?.trim();
	if (!text?.startsWith("{")) return undefined;
	try {
		const value: unknown = JSON.parse(text);
		return value && typeof value === "object" && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
};

/**
 * A child's tool call as the chat's own tool row reads it. Once the run is
 * over (`ended`), a call still marked running was cut off: it shows as
 * stopped, not as running for good.
 */
const toToolPart = (step: ToolStep, ended: boolean): ComplexContentPartTool => {
	const status = ended && step.status === "running" ? "stopped" : step.status;
	return {
		type: "tool",
		id: step.id,
		name: step.name,
		description: step.output ?? "",
		metadata: {
			// Its result's fields first, as for the chat's own calls: web searches
			// and page reads are drawn from them.
			...(parsedOutput(step.output) ?? {}),
			tool: step.name,
			tool_call_id: step.id,
			tool_call: {
				id: step.id,
				type: "function",
				function: { name: step.name, arguments: step.input ?? "" },
			},
			status,
			...(step.startedAt ? { startedAt: step.startedAt } : {}),
			...(step.durationMs !== undefined ? { durationMs: step.durationMs } : {}),
		},
		state:
			status === "running"
				? "running"
				: status === "failed"
					? "error"
					: "complete",
	};
};

/** Whether two texts open the same way: the reply and the run's last words. */
const startsAlike = (
	first: string | undefined,
	second: string | undefined,
): boolean => {
	if (!first || !second) return false;
	const opening = (text: string) =>
		text.replace(/\s+/g, " ").trim().slice(0, 120);
	return opening(first) === opening(second);
};

/** Text, or a run of tool calls shown together as one timeline. */
type Segment =
	| { type: "text"; key: string; content: string }
	| { type: "tools"; key: string; parts: ComplexContentPartTool[] };

const toSegments = (steps: ChildAgentStep[], ended: boolean): Segment[] => {
	const segments: Segment[] = [];
	for (const [index, step] of steps.entries()) {
		if (step.type === "text") {
			segments.push({
				type: "text",
				key: `text-${index}`,
				content: step.content,
			});
			continue;
		}
		const last = segments.at(-1);
		if (last?.type === "tools") {
			last.parts.push(toToolPart(step, ended));
		} else {
			segments.push({
				type: "tools",
				key: step.id,
				parts: [toToolPart(step, ended)],
			});
		}
	}
	return segments;
};

/** Who is answering, headed like an assistant turn in the chat. */
const ChildHeading: React.FC<{ name: string; detail?: React.ReactNode }> = ({
	name,
	detail,
}) => (
	<div className="flex min-w-0 max-w-full items-center gap-2">
		<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/20">
			<Bot className="h-3.5 w-3.5" />
		</span>
		<span className="truncate text-sm font-semibold text-foreground">
			{name}
		</span>
		{detail ? (
			<>
				<span className="h-1 w-1 shrink-0 rounded-full bg-muted-foreground/35" />
				<span className="shrink-0 text-xs text-muted-foreground">{detail}</span>
			</>
		) : null}
	</div>
);

/** The parent's message, in the user's bubble, captioned with who sent it. */
const ParentBubble: React.FC<{ text: string; caption?: string }> = ({
	text,
	caption,
}) => (
	<div className="flex flex-col items-end gap-1">
		<Message from="user">
			<MessageContent>{text}</MessageContent>
		</Message>
		{caption ? (
			<span className="flex items-center gap-1 text-[11px] text-muted-foreground">
				<CornerDownRight size={11} aria-hidden="true" />
				{caption}
			</span>
		) : null}
	</div>
);

const EarlierTurn: React.FC<{ exchange: ChildAgentExchange; name: string }> = ({
	exchange,
	name,
}) => {
	const { t } = useTranslation("chat");
	return (
		<div className="space-y-2">
			<ParentBubble text={exchange.message} />
			<div className="space-y-1.5">
				<ChildHeading
					name={name}
					detail={
						exchange.tools > 0
							? t("childAgent.toolCalls", { count: exchange.tools })
							: undefined
					}
				/>
				<p className="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground/90">
					{exchange.reply}
				</p>
			</div>
		</div>
	);
};

/**
 * The messages before this one. The child reads all of them on every request,
 * so they are part of this conversation, not separate calls — shown above it
 * the way the chat shows its own earlier turns.
 */
const EarlierTurns: React.FC<{ run: ChildAgentRun; name: string }> = ({
	run,
	name,
}) => {
	const { t } = useTranslation("chat");
	const [open, setOpen] = React.useState(false);
	const history = run.history ?? [];
	const earlier = run.turn - 1;
	const notListed = Math.max(0, earlier - history.length);

	return (
		<div className="space-y-3">
			<div className="flex items-center gap-3">
				<div className="h-px flex-1 bg-border/70" />
				<button
					type="button"
					onClick={() => setOpen((value) => !value)}
					aria-expanded={open}
					className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border/70 bg-background/90 px-3 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<History size={13} aria-hidden="true" />
					{open
						? t("childAgent.hideEarlier")
						: t("childAgent.showEarlier", { count: earlier })}
				</button>
				<div className="h-px flex-1 bg-border/70" />
			</div>
			{open ? (
				<div className="space-y-4 opacity-80">
					{notListed > 0 ? (
						<p className="text-center text-[11px] text-muted-foreground">
							{t("childAgent.notListed", { count: notListed })}
						</p>
					) : null}
					{history.map((exchange) => (
						<EarlierTurn key={exchange.turn} exchange={exchange} name={name} />
					))}
					<div className="h-px bg-border/70" />
				</div>
			) : (
				<p className="text-center text-[11px] text-muted-foreground">
					{t("childAgent.remembers", { name })}
				</p>
			)}
		</div>
	);
};

/** What the child's requests cost, under its turn like a message footer. */
const UsageFooter: React.FC<{ run: ChildAgentRun }> = ({ run }) => {
	const { t } = useTranslation("chat");
	const usage = run.usage;
	if (!usage) return null;
	const cachedPercent =
		usage.cached_tokens !== undefined && usage.prompt_tokens > 0
			? Math.round((usage.cached_tokens / usage.prompt_tokens) * 100)
			: undefined;
	const items = [
		...(usage.cost !== undefined ? [formatUsd(usage.cost)] : []),
		t("childAgent.input", { value: formatTokenCount(usage.prompt_tokens) }),
		...(cachedPercent !== undefined
			? [t("childAgent.cached", { percent: cachedPercent })]
			: []),
		t("childAgent.output", {
			value: formatTokenCount(usage.completion_tokens),
		}),
		t("childAgent.requests", { count: run.requests }),
		...(usage.estimated ? [t("childAgent.estimated")] : []),
	];

	return (
		<div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] tabular-nums text-muted-foreground">
			{items.map((label, index) => (
				<React.Fragment key={label}>
					{index > 0 ? (
						<span aria-hidden="true" className="text-muted-foreground/50">
							·
						</span>
					) : null}
					<span
						className={
							index === 0 && usage.cost !== undefined
								? "font-medium text-foreground/80"
								: undefined
						}
					>
						{label}
					</span>
				</React.Fragment>
			))}
		</div>
	);
};

/**
 * One message to a child agent, as a conversation: the earlier messages it
 * still reads, the parent's message, and the child's turn — what it wrote,
 * the tools it ran, its reply — with what that cost.
 */
export const ChildAgentConversation: React.FC<{ item: MessageActionItem }> = ({
	item,
}) => {
	const { t } = useTranslation("chat");
	const args = getToolCallArguments(item);
	const run = getChildAgentRun(item.metadata);
	const agentId =
		run?.agent.id ??
		(typeof args?.agentId === "string" ? args.agentId : undefined);
	const lookedUpName = useAgentName(run ? undefined : agentId);
	const name = run?.agent.name ?? lookedUpName ?? t("childAgent.unknownAgent");
	const parentMessage =
		typeof args?.message === "string" ? args.message : undefined;
	const callStatus = item.metadata?.status;
	// The call is the authority: once it ended, nothing under it still runs,
	// whatever the last report of the run said.
	const callEnded = typeof callStatus === "string" && callStatus !== "running";
	const failed = callStatus === "failed" || run?.status === "failed";
	const running =
		!callEnded &&
		!failed &&
		(callStatus === "running" || run?.status === "running");
	const output = item.description?.trim();
	const steps = run?.steps;
	const segments = React.useMemo(
		() => toSegments(steps ?? [], !running),
		[steps, running],
	);
	const toolRunning =
		running &&
		(steps ?? []).some(
			(step) => step.type === "tool" && step.status === "running",
		);
	// A call from before runs were reported has only its reply to show.
	const replyOnly = !run && !failed && output;
	// The reply, when the run's own last words are not it (cut to fit, or
	// never streamed as text).
	const lastText = steps
		?.filter((step) => step.type === "text")
		.at(-1)
		?.content.trim();
	const showReply =
		!running &&
		!failed &&
		run?.status === "completed" &&
		Boolean(output) &&
		!startsAlike(lastText, output);
	const endNote = running
		? null
		: run?.status === "stopped"
			? run.endReason === "step_limit"
				? t("childAgent.stepLimit", { name })
				: t("childAgent.stopped", { name })
			: run?.status === "running" && callEnded
				? t("childAgent.unreported", { name })
				: null;

	return (
		<div className="space-y-3">
			<div className="space-y-4 rounded-xl border border-border/60 bg-background/60 p-3 sm:p-4">
				{run && run.turn > 1 ? <EarlierTurns run={run} name={name} /> : null}

				{parentMessage ? (
					<ParentBubble
						text={parentMessage}
						caption={t("childAgent.sentByParent")}
					/>
				) : null}

				<div className="flex min-w-0 flex-col items-start gap-2">
					<ChildHeading
						name={name}
						detail={
							run
								? run.turn > 1
									? t("childAgent.turn", { count: run.turn })
									: t("childAgent.newConversation")
								: undefined
						}
					/>
					{run?.omittedSteps ? (
						<p className="text-xs text-muted-foreground">
							{t("childAgent.omittedSteps", { count: run.omittedSteps })}
						</p>
					) : null}
					{segments.map((segment) =>
						segment.type === "text" ? (
							<MarkdownMessage key={segment.key} className="w-full text-sm">
								{segment.content}
							</MarkdownMessage>
						) : (
							<div key={segment.key} className="w-full">
								{segment.parts.map((part, index) => (
									<AssistantToolTimelinePart
										key={part.id}
										part={part}
										isLast={index === segment.parts.length - 1}
										connectsToPrevious={index > 0}
									/>
								))}
							</div>
						),
					)}
					{replyOnly || showReply ? (
						<MarkdownMessage className="w-full text-sm">
							{output}
						</MarkdownMessage>
					) : null}
					{endNote ? (
						<div className="flex w-full items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
							<CircleSlash className="mt-0.5 h-4 w-4 shrink-0" />
							<p className="min-w-0 break-words">{endNote}</p>
						</div>
					) : null}
					{running && !toolRunning ? (
						<div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
							<ThreeDotsLoader className="text-muted-foreground" size="sm" />
							{t("childAgent.working")}
						</div>
					) : null}
					{!running && !failed && !endNote && run && run.steps.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t("childAgent.noReply")}
						</p>
					) : null}
					{failed ? (
						<div className="flex w-full items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
							<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
							<div className="min-w-0 whitespace-pre-wrap break-words">
								{callStatus === "failed" ? output : (run?.error ?? output)}
							</div>
						</div>
					) : null}
					{run ? <UsageFooter run={run} /> : null}
				</div>
			</div>

			<ToolItemRawIO item={item} input={args ?? undefined} output={output} />
		</div>
	);
};

export default ChildAgentConversation;
