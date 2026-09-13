import React, { useMemo, useState } from "react";
import { useStreamingDisclosure } from "./use-streaming-disclosure";
import { useTranslation } from "react-i18next";
import {
	BookOpen,
	Brain,
	CheckCircle2,
	ChevronDown,
	FileText,
	Globe2,
	Loader2,
	Settings2,
	Sparkles,
	type LucideIcon,
} from "lucide-react";
import type {
	ComplexContentPartExecution,
	ComplexContentPartTool,
} from "@/types/chat";
import { DEFAULT_FLOW_STEPS } from "@/services/flow-builder-catalog";
import { cn } from "@/lib/utils";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/main/components/ui/collapsible";
import { ToolActionDetails } from "../MessageActions";
import { RetrievedKnowledge } from "./RetrievedKnowledge";
import { StreamingListItem } from "./StreamingListItem";
import { useNewItemIds } from "./use-new-item-ids";
import { translateCommonKey } from "../../utils/i18n-helpers";

const FLOW_STEP_BY_NAME = new Map(
	DEFAULT_FLOW_STEPS.map((step) => [step.name, step]),
);

export const getExecutionActionName = (
	part: ComplexContentPartExecution,
): string =>
	(typeof part.metadata?.tool === "string" && part.metadata.tool) || part.node;

const humanizeStepName = (name: string): string =>
	name.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());

const getCatalogStep = (part: ComplexContentPartExecution) =>
	FLOW_STEP_BY_NAME.get(getExecutionActionName(part));

export const getWorkflowLabel = (
	part: ComplexContentPartExecution,
	t: ReturnType<typeof useTranslation>["t"],
): string => {
	const actionName = getExecutionActionName(part);
	const catalogStep = getCatalogStep(part);
	const nameKey =
		typeof catalogStep?.metadata?.nameKey === "string"
			? catalogStep.metadata.nameKey
			: undefined;
	const displayName =
		translateCommonKey(nameKey, t) ||
		(typeof catalogStep?.metadata?.displayName === "string"
			? catalogStep.metadata.displayName
			: undefined);

	if (displayName) {
		return part.state === "running"
			? t("workflow.runningFeature", { name: displayName })
			: displayName;
	}

	if (actionName.includes("add-system"))
		return t(
			part.state === "running"
				? "workflow.steps.instructions.running"
				: "workflow.steps.instructions.complete",
		);
	if (actionName.includes("skill")) {
		return t(
			part.state === "running"
				? "workflow.steps.skills.running"
				: "workflow.steps.skills.complete",
		);
	}
	if (actionName.includes("retrieve") || actionName.includes("context")) {
		return t(
			part.state === "running"
				? "workflow.steps.knowledge.running"
				: "workflow.steps.knowledge.complete",
		);
	}
	if (actionName.includes("agent") || actionName.includes("completion")) {
		return t(
			part.state === "running"
				? "workflow.steps.response.running"
				: "workflow.steps.response.complete",
		);
	}
	return part.state === "running"
		? t("workflow.steps.generic.running", {
				name: humanizeStepName(actionName),
			})
		: humanizeStepName(actionName);
};

const getWorkflowDescription = (
	part: ComplexContentPartExecution,
	t: ReturnType<typeof useTranslation>["t"],
): string => {
	const actionName = getExecutionActionName(part);
	const catalogStep = getCatalogStep(part);
	const descriptionKey =
		typeof catalogStep?.metadata?.descriptionKey === "string"
			? catalogStep.metadata.descriptionKey
			: undefined;
	const description =
		translateCommonKey(descriptionKey, t) ||
		(typeof catalogStep?.metadata?.description === "string"
			? catalogStep.metadata.description
			: undefined);

	if (description) return description;
	if (actionName.includes("add-system"))
		return t("workflow.descriptions.instructions");
	if (actionName.includes("skill")) return t("workflow.descriptions.skills");
	if (actionName.includes("retrieve") || actionName.includes("context")) {
		return t("workflow.descriptions.knowledge");
	}
	if (actionName.includes("agent") || actionName.includes("completion")) {
		return t("workflow.descriptions.response");
	}
	return t("workflow.descriptions.generic");
};

const getWorkflowIcon = (part: ComplexContentPartExecution): LucideIcon => {
	const actionName = getExecutionActionName(part);
	if (actionName.includes("skill")) return BookOpen;
	if (actionName.includes("retrieve") || actionName.includes("context"))
		return Brain;
	if (actionName.includes("artifact")) return Sparkles;
	if (actionName.includes("fs") || actionName.includes("file")) return FileText;
	if (actionName.includes("web")) return Globe2;
	if (actionName.includes("agent") || actionName.includes("completion"))
		return Sparkles;
	return Settings2;
};

/**
 * Context the flow gathered before the agent acted, by the name its part is
 * recorded under.
 *
 * Parts listed here are shown in the run summary above the answer instead of
 * in the agent's tool timeline. That split is semantic, not cosmetic: these
 * are not actions the agent chose, so presenting them as tool calls misleads
 * about what the agent did — and a timeline orders its rows by when events
 * arrived, which puts context gathered *first* wherever the stream happened to
 * deliver it. Placement by kind cannot drift that way.
 *
 * One table rather than a chain of name checks per concern. With the label,
 * the description and the details each in their own `if`, a new kind had to
 * be added in four places in step — and `knowledge_retrieval`, recorded by the
 * flow as a retrieval turn, was added to none of them, so it landed at the
 * bottom of the tool timeline.
 */
interface WorkflowEvidenceKind {
	/** Fallback when `workflow.evidence.<name>` has no translation. */
	label: string;
	/** `knowledge` shows the retrieved content itself; `action` the tool's details. */
	details: "knowledge" | "action";
	/** Whether the collapsed row previews the content beside its label. */
	previewInRow: boolean;
}

const WORKFLOW_EVIDENCE = new Map<string, WorkflowEvidenceKind>([
	[
		"knowledge_graph",
		{
			label: "Knowledge graph evidence",
			details: "action",
			previewInRow: true,
		},
	],
	[
		"context_knowledge",
		{ label: "Knowledge context", details: "knowledge", previewInRow: false },
	],
	[
		"structmem_knowledge_retrieval",
		{ label: "StructMem retrieval", details: "action", previewInRow: true },
	],
	[
		// The retrieval turn the flow appends to the conversation. Its content is
		// a prompt written for the model, so it reads as text, not as a tool call.
		"knowledge_retrieval",
		{
			label: "Retrieved knowledge",
			details: "knowledge",
			previewInRow: false,
		},
	],
]);

const isWorkflowEvidencePart = (part: ComplexContentPartTool): boolean =>
	WORKFLOW_EVIDENCE.has(part.name);

const getEvidenceLabel = (part: ComplexContentPartTool): string =>
	WORKFLOW_EVIDENCE.get(part.name)?.label ?? part.name.replace(/_/g, " ");

const getEvidenceDescription = (part: ComplexContentPartTool): string =>
	WORKFLOW_EVIDENCE.get(part.name)?.previewInRow === false
		? ""
		: part.description;

/**
 * The knowledge itself, without the instructions wrapped around it for the
 * model. A retrieval block carries its facts inside `<context>` followed by
 * guidance on how to use them; a person looking at what was retrieved wants
 * the facts. Content with no such block is shown whole.
 */
const readableEvidenceText = (text: string): string => {
	const match = /<context>\s*([\s\S]*?)\s*<\/context>/i.exec(text);
	const inner = match?.[1]?.trim();
	return inner ? inner : text;
};

const EvidenceDetails: React.FC<{
	part: ComplexContentPartTool;
}> = ({ part }) => {
	if (WORKFLOW_EVIDENCE.get(part.name)?.details === "knowledge") {
		return <RetrievedKnowledge text={readableEvidenceText(part.description)} />;
	}

	const actionItem = {
		name: part.name,
		description: part.description,
		metadata: part.metadata,
	};

	return <ToolActionDetails item={actionItem} isOpen />;
};

export const AssistantWorkflowPart: React.FC<{
	part: ComplexContentPartExecution;
}> = ({ part }) => {
	const { t } = useTranslation("chat");
	const isRunning = part.state === "running";

	return (
		<div className="flex animate-in fade-in-0 slide-in-from-top-1 items-center gap-2 pl-1 text-xs text-muted-foreground duration-200 ease-out">
			<span
				className={cn(
					"flex h-5 w-5 items-center justify-center rounded-full border",
					isRunning
						? "border-primary/30 text-primary"
						: "border-border/60 text-muted-foreground/70",
				)}
			>
				{isRunning ? (
					<Loader2 className="h-3.5 w-3.5 animate-spin" />
				) : (
					<Settings2 className="h-3.5 w-3.5" />
				)}
			</span>
			<span>{getWorkflowLabel(part, t)}</span>
		</div>
	);
};

export const AssistantWorkflowSummary: React.FC<{
	parts: ComplexContentPartExecution[];
	evidenceParts?: ComplexContentPartTool[];
	isStreaming: boolean;
}> = ({ parts, evidenceParts = [], isStreaming }) => {
	const { t } = useTranslation("chat");
	const [isOpen, setIsOpen] = useStreamingDisclosure(isStreaming);
	const evidence = useMemo(
		() => evidenceParts.filter(isWorkflowEvidencePart),
		[evidenceParts],
	);
	const [openEvidenceId, setOpenEvidenceId] = useState<string | null>(null);
	const newRowIds = useNewItemIds([
		...parts.map((part) => part.id),
		...evidence.map((part) => part.id),
	]);
	if (parts.length === 0 && evidence.length === 0) return null;
	const totalCount = parts.length + evidence.length;

	return (
		<Collapsible open={isOpen} onOpenChange={setIsOpen} className="mb-1">
			<CollapsibleTrigger asChild>
				<button
					type="button"
					className="inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
				>
					<Settings2 className="h-3.5 w-3.5" />
					<span>
						{isOpen ? t("workflow.hideDetails") : t("workflow.showDetails")}
					</span>
					<span className="text-muted-foreground/70">({totalCount})</span>
					<ChevronDown
						className={cn(
							"h-3.5 w-3.5 transition-transform",
							isOpen && "rotate-180",
						)}
					/>
				</button>
			</CollapsibleTrigger>
			<CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
				<div className="min-w-0 pl-1 sm:pl-3">
					{parts.map((part, index) => (
						<StreamingListItem
							key={`${part.id}-${index}`}
							isNew={newRowIds.has(part.id)}
						>
							<div className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 pt-2 text-xs">
								{React.createElement(getWorkflowIcon(part), {
									className: "mt-0.5 h-3.5 w-3.5 text-muted-foreground",
								})}
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
										<span className="font-medium text-foreground/85">
											{getWorkflowLabel(part, t)}
										</span>
									</div>
									<div className="mt-0.5 text-muted-foreground">
										{getWorkflowDescription(part, t)}
									</div>
								</div>
							</div>
						</StreamingListItem>
					))}
					{evidence.map((part) => {
						const isEvidenceOpen = openEvidenceId === part.id;
						const evidenceDescription = getEvidenceDescription(part);
						return (
							<StreamingListItem key={part.id} isNew={newRowIds.has(part.id)}>
								<div className="pt-2 text-xs">
									<button
										type="button"
										className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground"
										onClick={() =>
											setOpenEvidenceId(isEvidenceOpen ? null : part.id)
										}
									>
										<Brain className="h-3.5 w-3.5 shrink-0" />
										<span className="min-w-0 flex-1 truncate font-medium">
											{t(`workflow.evidence.${part.name}`, {
												defaultValue: getEvidenceLabel(part),
											})}
										</span>
										{evidenceDescription ? (
											<span className="min-w-0 shrink truncate text-muted-foreground/70">
												{evidenceDescription}
											</span>
										) : null}
										<ChevronDown
											className={cn(
												"h-3.5 w-3.5 shrink-0 transition-transform",
												isEvidenceOpen && "rotate-180",
											)}
										/>
									</button>
									{isEvidenceOpen ? (
										<div className="mt-2 min-w-0 pl-2 sm:pl-5">
											<EvidenceDetails part={part} />
										</div>
									) : null}
								</div>
							</StreamingListItem>
						);
					})}
				</div>
			</CollapsibleContent>
		</Collapsible>
	);
};

export { isWorkflowEvidencePart };
