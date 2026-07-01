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
import { AssistantToolTimelinePart } from "./AssistantToolTimelinePart";
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

const isVisibleTimelinePart = (
	part: AssistantContentPart,
	index: number,
	latestWorkflowIndex: number,
): boolean => {
	if (part.type === "tool") return !isWorkflowEvidencePart(part);
	if (part.type === "execution") {
		return part.state !== "complete" && index === latestWorkflowIndex;
	}
	return false;
};

export const AssistantContentFlow: React.FC<{
	parts: AssistantContentPart[];
	isStreaming: boolean;
	suppressArtifactPreviews?: boolean;
	onMessageAction?: (action: MessageActionRequest) => void | Promise<void>;
}> = ({
	parts,
	isStreaming,
	suppressArtifactPreviews = false,
	onMessageAction,
}) => {
	// Some flows re-emit the same assistant text (and its artifact tags) across
	// multiple content parts (e.g. one per agent iteration). Share a dedupe set
	// across all text parts so a single artifact only renders once.
	const seenArtifactKeys = useMemo(() => new Set<string>(), [parts]);

	const latestWorkflowIndex = parts.findLastIndex(
		(part) => part.type === "execution",
	);
	const completedWorkflowParts = parts.filter(
		(part): part is ComplexContentPartExecution =>
			part.type === "execution" && part.state === "complete",
	);
	const workflowEvidenceParts = parts.filter(
		(part): part is ComplexContentPartTool =>
			part.type === "tool" && isWorkflowEvidencePart(part),
	);

	return (
		<div className="space-y-3">
			<AssistantWorkflowSummary
				parts={completedWorkflowParts}
				evidenceParts={workflowEvidenceParts}
			/>
			{(() => {
				// Key text parts by ordinal-among-text-parts, not global array index.
				// While streaming, execution/tool parts are appended/reordered around the
				// text, so a global-index key shifted every token and remounted the text's
				// whole subtree (incl. the OpenUI tree + component library). The n-th text
				// part is always `text-n`, so it stays mounted and reconciles.
				let textPartCount = 0;
				return parts.map((part, index) => {
					if (part.type === "text") {
						if (!part.text.trim()) return null;
						const textKey = `text-${textPartCount++}`;
						return (
							<MessageContentWithArtifacts
								key={textKey}
								content={part.text}
							isStreaming={isStreaming}
							suppressArtifactPreviews={suppressArtifactPreviews}
							onMessageAction={onMessageAction}
							seenArtifactKeys={seenArtifactKeys}
						/>
					);
				}

				if (part.type === "execution") {
					if (part.state === "complete") return null;
					if (index !== latestWorkflowIndex) return null;
					return (
						<AssistantWorkflowPart key={`workflow-${part.id}`} part={part} />
					);
				}
				if (isWorkflowEvidencePart(part)) return null;

				return (
					<AssistantToolTimelinePart
						key={`${part.type}-${part.id}-${index}`}
						part={part}
						connectsToPrevious={parts
							.slice(0, index)
							.some((previous, previousIndex) =>
								isVisibleTimelinePart(
									previous,
									previousIndex,
									latestWorkflowIndex,
								),
							)}
						isLast={
							!parts
								.slice(index + 1)
								.some((next, nextOffset) =>
									isVisibleTimelinePart(
										next,
										index + nextOffset + 1,
										latestWorkflowIndex,
									),
								)
						}
					/>
				);
				});
			})()}
		</div>
	);
};
