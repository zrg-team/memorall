import React, { useMemo } from "react";
import type {
	ComplexContentPartExecution,
	ComplexContentPartTool,
} from "@/types/chat";
import {
	AssistantWorkflowPart,
	AssistantWorkflowSummary,
	isWorkflowEvidencePart,
} from "./AssistantWorkflow";
import { AssistantToolTimeline } from "./AssistantToolTimeline";
import type { MessageActionRequest } from "../artifacts/ArtifactActionsMenu";
import { MessageContentWithArtifacts } from "./MessageContentWithArtifacts";

export type AssistantContentPart =
	| { type: "text"; text: string }
	| ComplexContentPartTool
	| ComplexContentPartExecution;

export const isAssistantContentPart = (
	part: unknown,
): part is AssistantContentPart =>
	!!part &&
	typeof part === "object" &&
	"type" in part &&
	(part.type === "text" || part.type === "tool" || part.type === "execution");

export const mergeAdjacentAssistantTextParts = (
	parts: AssistantContentPart[],
): AssistantContentPart[] => {
	const merged: AssistantContentPart[] = [];

	for (const part of parts) {
		const previous = merged[merged.length - 1];
		if (part.type === "text" && previous?.type === "text") {
			previous.text = `${previous.text}\n\n${part.text}`;
			continue;
		}

		merged.push(part.type === "text" ? { ...part } : part);
	}

	return merged;
};

export type AssistantFlowSegment =
	| { kind: "text"; key: string; text: string }
	| { kind: "tools"; key: string; parts: ComplexContentPartTool[] }
	| { kind: "execution"; key: string; part: ComplexContentPartExecution };

/**
 * The order a turn is read in: the text the model wrote, then the tools it ran
 * next, then whatever it wrote after their results.
 *
 * Only text the model actually wrote ends a group. Most agent iterations call
 * tools without a word in between, and each of those used to start its own
 * group, so a single search-and-read pass turned into a stack of one-row
 * timelines. Evidence tools and finished workflow steps are left out — they
 * are summarised above the flow.
 */
export const groupAssistantParts = (
	parts: AssistantContentPart[],
): AssistantFlowSegment[] => {
	const segments: AssistantFlowSegment[] = [];
	const latestWorkflowIndex = parts.findLastIndex(
		(part) => part.type === "execution",
	);
	let group: ComplexContentPartTool[] | null = null;
	let textCount = 0;

	parts.forEach((part, index) => {
		if (part.type === "text") {
			if (!part.text.trim()) return;
			group = null;
			segments.push({
				kind: "text",
				key: `text-${textCount}`,
				text: part.text,
			});
			textCount += 1;
			return;
		}
		if (part.type === "execution") {
			if (part.state === "complete" || index !== latestWorkflowIndex) return;
			segments.push({ kind: "execution", key: `workflow-${part.id}`, part });
			return;
		}
		if (isWorkflowEvidencePart(part)) return;
		if (!group) {
			group = [];
			// Keyed by the first tool so a group that grows keeps its disclosure.
			segments.push({ kind: "tools", key: `tools-${part.id}`, parts: group });
		}
		group.push(part);
	});

	return segments;
};

interface AssistantContentFlowProps {
	parts: AssistantContentPart[];
	isStreaming: boolean;
	/** Identifies interactive state in this message; see openui-form-state. */
	messageId?: string;
	suppressArtifactPreviews?: boolean;
	onMessageAction?: (action: MessageActionRequest) => void | Promise<void>;
}

export const AssistantContentFlow: React.FC<AssistantContentFlowProps> =
	React.memo(
		({
			parts,
			isStreaming,
			messageId,
			suppressArtifactPreviews = false,
			onMessageAction,
		}) => {
			// Some flows re-emit the same assistant text (and its artifact tags) across
			// multiple content parts (e.g. one per agent iteration). Share a dedupe set
			// across all text parts so a single artifact only renders once.
			const seenArtifactKeys = useMemo(() => new Set<string>(), [parts]);
			const mergedParts = useMemo(
				() => mergeAdjacentAssistantTextParts(parts),
				[parts],
			);

			const completedWorkflowParts = mergedParts.filter(
				(part): part is ComplexContentPartExecution =>
					part.type === "execution" && part.state === "complete",
			);
			const workflowEvidenceParts = mergedParts.filter(
				(part): part is ComplexContentPartTool =>
					part.type === "tool" && isWorkflowEvidencePart(part),
			);
			const segments = useMemo(
				() => groupAssistantParts(mergedParts),
				[mergedParts],
			);
			const lastToolSegmentIndex = segments.findLastIndex(
				(segment) => segment.kind === "tools",
			);

			return (
				<div className="space-y-3">
					<AssistantWorkflowSummary
						parts={completedWorkflowParts}
						evidenceParts={workflowEvidenceParts}
						isStreaming={isStreaming}
					/>
					{segments.map((segment, index) => {
						if (segment.kind === "text") {
							return (
								<MessageContentWithArtifacts
									key={segment.key}
									content={segment.text}
									isStreaming={isStreaming}
									blockScope={
										messageId ? `${messageId}:${segment.key}` : undefined
									}
									suppressArtifactPreviews={suppressArtifactPreviews}
									onMessageAction={onMessageAction}
									seenArtifactKeys={seenArtifactKeys}
								/>
							);
						}
						if (segment.kind === "execution") {
							return (
								<AssistantWorkflowPart key={segment.key} part={segment.part} />
							);
						}
						const isLastToolGroup = index === lastToolSegmentIndex;
						return (
							<AssistantToolTimeline
								key={segment.key}
								parts={segment.parts}
								// Only the group the agent is working in stays open; the
								// earlier ones fold away once the turn moves past them.
								isStreaming={isStreaming && isLastToolGroup}
								showUnattributedPrompts={isLastToolGroup}
							/>
						);
					})}
				</div>
			);
		},
	);

AssistantContentFlow.displayName = "AssistantContentFlow";
