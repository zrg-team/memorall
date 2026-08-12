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
import { assignAssistantPartKeys } from "./stable-part-keys";

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

interface AssistantContentFlowProps {
	parts: AssistantContentPart[];
	isStreaming: boolean;
	suppressArtifactPreviews?: boolean;
	onMessageAction?: (action: MessageActionRequest) => void | Promise<void>;
}

export const AssistantContentFlow: React.FC<AssistantContentFlowProps> =
	React.memo(
		({
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
			const toolTimelineParts = parts.filter(
				(part): part is ComplexContentPartTool =>
					part.type === "tool" && !isWorkflowEvidencePart(part),
			);

			return (
				<div className="space-y-3">
					<AssistantWorkflowSummary
						parts={completedWorkflowParts}
						evidenceParts={workflowEvidenceParts}
					/>
					{toolTimelineParts.length > 0 ? (
						<AssistantToolTimeline
							parts={toolTimelineParts}
							isStreaming={isStreaming}
						/>
					) : null}
					{assignAssistantPartKeys(parts).map(({ part, index, key }) => {
						if (part.type === "text") {
							if (!part.text.trim()) return null;
							return (
								<MessageContentWithArtifacts
									key={key}
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
								<AssistantWorkflowPart
									key={`workflow-${part.id}`}
									part={part}
								/>
							);
						}
						if (isWorkflowEvidencePart(part)) return null;
						return null;
					})}
				</div>
			);
		},
	);

AssistantContentFlow.displayName = "AssistantContentFlow";
