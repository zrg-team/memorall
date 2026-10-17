import React from "react";
import { AlertCircle, Check, Target } from "lucide-react";
import { Badge } from "@/main/components/ui/badge";
import { Progress } from "@/main/components/ui/progress";
import { cn } from "@/lib/utils";
import type {
	ActionRenderer,
	MessageActionItem,
} from "@/main/modules/chat/components/types";
import { defaultActionRenderer } from "./DefaultActionRenderer";
import {
	formatIsoDate,
	getBoolean,
	getString,
	getToolCallArguments,
	ToolCodeBlock,
	ToolDetail,
	ToolDetailsGrid,
	ToolItemRawIO,
	ToolSection,
	ToolStateBadge,
} from "./ToolCommon";

interface PlannerItemView {
	id: string;
	description: string;
	checked: boolean;
	notes?: string;
}

interface PlannerPlanView {
	kind: "plan";
	title: string;
	createdAt?: string;
	updatedAt?: string;
	items: PlannerItemView[];
	doneCount: number;
	totalCount: number;
	percent: number;
	isComplete: boolean;
}

interface PlannerMessageView {
	kind: "message";
	title: string;
	message: string;
	tone: "warning" | "error" | "info";
	requestedItemId?: string;
	availableIds?: string[];
}

type PlannerView = PlannerPlanView | PlannerMessageView;

interface PlannerActionSummary {
	label: string;
	detail?: string;
	tone: "default" | "success" | "warning";
	highlightedItemId?: string;
	targetItemId?: string;
}

const OUTPUT_MARKER = /\r?\noutput:\r?\n/;
const NOTE_SEPARATOR = " — ";

const ACTION_BADGE_CLASSNAME: Record<PlannerActionSummary["tone"], string> = {
	default: "border-border/60 bg-background text-foreground",
	success: "border-green-600/30 bg-green-600/10 text-green-700",
	warning: "border-amber-600/30 bg-amber-600/10 text-amber-700",
};

const MESSAGE_CARD_CLASSNAME: Record<PlannerMessageView["tone"], string> = {
	warning: "border-amber-600/20 bg-amber-600/5 text-amber-800",
	error: "border-red-600/20 bg-red-600/5 text-red-700",
	info: "border-border/60 bg-muted/10 text-foreground",
};

const MESSAGE_BADGE_CLASSNAME: Record<PlannerMessageView["tone"], string> = {
	warning: "border-amber-600/30 bg-amber-600/10 text-amber-700",
	error: "border-red-600/30 bg-red-600/10 text-red-700",
	info: "border-border/60 bg-background text-foreground",
};

const extractOutputSection = (description: string): string => {
	const parts = description.split(OUTPUT_MARKER);
	if (parts.length < 2) {
		return description.trim();
	}

	return parts.slice(1).join("\noutput:\n").trim();
};

const parsePlannerItem = (line: string): PlannerItemView | null => {
	const match = line.match(/^(\S+)\.\s+\[( |x)\]\s+(.*)$/);
	if (!match) {
		return null;
	}

	const itemText = match[3];
	const noteSeparatorIndex = itemText.lastIndexOf(NOTE_SEPARATOR);
	const description =
		noteSeparatorIndex >= 0 ? itemText.slice(0, noteSeparatorIndex) : itemText;
	const notes =
		noteSeparatorIndex >= 0
			? itemText.slice(noteSeparatorIndex + NOTE_SEPARATOR.length)
			: undefined;

	return {
		id: match[1],
		checked: match[2] === "x",
		description,
		notes: notes || undefined,
	};
};

const parsePlannerOutput = (output: string): PlannerView | null => {
	const trimmed = output.trim();
	if (!trimmed) {
		return null;
	}

	if (trimmed.startsWith("No plan exists.")) {
		return {
			kind: "message",
			title: "No active plan",
			message: trimmed,
			tone: "warning",
		};
	}

	const missingItemMatch = trimmed.match(
		/^Item with id "([^"]+)" not found\. Available ids: (.+)\.$/,
	);
	if (missingItemMatch) {
		return {
			kind: "message",
			title: "Planner item not found",
			message: trimmed,
			tone: "error",
			requestedItemId: missingItemMatch[1],
			availableIds: missingItemMatch[2]
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean),
		};
	}

	const lines = trimmed.split(/\r?\n/);
	const titleLine = lines[0]?.match(/^#\s+(.+)$/);
	if (!titleLine) {
		return null;
	}

	const timestampLine = lines.find((line) => line.startsWith("Created: "));
	const timestampMatch = timestampLine?.match(
		/^Created:\s+(.+?)\s{2,}Updated:\s+(.+)$/,
	);
	const progressLine = lines.find((line) => line.startsWith("Progress: "));
	const progressMatch = progressLine?.match(
		/^Progress:\s+(\d+)\/(\d+)\s+completed$/,
	);
	if (!progressMatch) {
		return null;
	}

	const items = lines
		.filter((line) => /^\S+\.\s+\[(?: |x)\]\s+/.test(line))
		.map(parsePlannerItem)
		.filter((item): item is PlannerItemView => item !== null);
	const doneCount = Number(progressMatch[1]);
	const totalCount = Number(progressMatch[2]);
	const percent =
		totalCount > 0
			? Math.max(0, Math.min(100, (doneCount / totalCount) * 100))
			: 0;

	return {
		kind: "plan",
		title: titleLine[1],
		createdAt: timestampMatch?.[1],
		updatedAt: timestampMatch?.[2],
		items,
		doneCount,
		totalCount,
		percent,
		isComplete: lines.some((line) => line.trim() === "✓ ALL ITEMS COMPLETE"),
	};
};

const getPlanStatus = (
	view: PlannerPlanView,
): { label: string; ok?: boolean } => {
	if (view.totalCount === 0) {
		return { label: "empty" };
	}
	if (view.isComplete) {
		return { label: "complete", ok: true };
	}
	if (view.doneCount > 0) {
		return { label: "in progress" };
	}
	return { label: "not started" };
};

const getPlannerActionSummary = (
	itemName: MessageActionItem["name"],
	args: Record<string, unknown> | null,
	view: PlannerView | null,
): PlannerActionSummary => {
	switch (itemName) {
		case "planner_create": {
			const items = Array.isArray(args?.items)
				? args.items.filter(
						(value): value is string => typeof value === "string",
					)
				: [];
			return {
				label: "Plan created",
				detail:
					items.length > 0
						? `${items.length} item${items.length === 1 ? "" : "s"} added to the queue`
						: getString(args ?? {}, "title"),
				tone: "success",
			};
		}
		case "planner_get":
			return {
				label:
					view?.kind === "plan" && view.isComplete
						? "Completion verified"
						: "Plan reviewed",
				tone: view?.kind === "plan" && view.isComplete ? "success" : "default",
			};
		case "planner_add_item": {
			const addedDescription = getString(args ?? {}, "description");
			const highlightedItemId =
				view?.kind === "plan" && view.items.length > 0
					? view.items[view.items.length - 1]?.id
					: undefined;
			return {
				label: "Item added",
				detail: addedDescription,
				tone: "default",
				highlightedItemId,
			};
		}
		case "planner_check_item": {
			// Left out, it means done: the tool defaults to it.
			const checked = getBoolean(args ?? {}, "checked") !== false;
			const notes = getString(args ?? {}, "notes");
			const targetItemId = getString(args ?? {}, "item_id");
			return {
				label: checked ? "Item completed" : "Item reopened",
				detail: notes,
				tone: checked ? "success" : "default",
				highlightedItemId: targetItemId,
				targetItemId,
			};
		}
		case "planner_remove_item": {
			const targetItemId = getString(args ?? {}, "item_id");
			return {
				label: "Item removed",
				detail: targetItemId ? `Removed item ${targetItemId}` : undefined,
				tone: "warning",
				targetItemId,
			};
		}
		default:
			return {
				label: "Plan update",
				tone: "default",
			};
	}
};

const PlannerHeader: React.FC<{
	view: PlannerPlanView;
	summary: PlannerActionSummary;
}> = ({ view, summary }) => {
	const remainingCount = Math.max(view.totalCount - view.doneCount, 0);
	const planStatus = getPlanStatus(view);

	return (
		<div className="rounded-xl border border-border/60 bg-background overflow-hidden">
			<div className="border-b border-border/60 bg-muted/20 px-4 py-3">
				<div className="flex items-start gap-3">
					<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/5 text-primary">
						<Target className="h-4 w-4" />
					</div>
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<div className="truncate text-sm font-semibold text-foreground">
								{view.title}
							</div>
							<Badge
								variant="outline"
								className={cn(
									"text-[10px]",
									ACTION_BADGE_CLASSNAME[summary.tone],
								)}
							>
								{summary.label}
							</Badge>
							<ToolStateBadge ok={planStatus.ok} label={planStatus.label} />
						</div>
						<div className="mt-1 text-xs text-muted-foreground">
							{view.doneCount}/{view.totalCount} completed
							{view.totalCount > 0 ? ` • ${remainingCount} remaining` : ""}
						</div>
					</div>
					<div className="shrink-0 text-right">
						<div className="text-lg font-semibold text-foreground">
							{Math.round(view.percent)}%
						</div>
						<div className="text-[10px] uppercase tracking-wide text-muted-foreground/80">
							progress
						</div>
					</div>
				</div>

				{summary.detail ? (
					<div className="mt-3 rounded-lg border border-border/60 bg-background px-3 py-2 text-xs text-muted-foreground">
						{summary.detail}
					</div>
				) : null}

				<div className="mt-3 space-y-1.5">
					<div className="flex items-center justify-between text-[11px] text-muted-foreground">
						<span>Plan progress</span>
						<span>{`${view.doneCount} of ${view.totalCount || 0}`}</span>
					</div>
					<Progress value={view.percent} className="h-2" />
				</div>
			</div>
		</div>
	);
};

const PlannerItemsSection: React.FC<{
	view: PlannerPlanView;
	summary: PlannerActionSummary;
}> = ({ view, summary }) => {
	if (view.items.length === 0) {
		return (
			<ToolSection title="Items">
				<div className="rounded-md border border-dashed border-border/60 px-3 py-4 text-xs text-muted-foreground">
					This plan does not have any items yet.
				</div>
			</ToolSection>
		);
	}

	return (
		<ToolSection title="Items">
			<div className="space-y-2">
				{view.items.map((planItem) => {
					const isHighlighted = summary.highlightedItemId === planItem.id;

					return (
						<div
							key={planItem.id}
							className={cn(
								"rounded-lg border px-3 py-2.5 transition-colors",
								planItem.checked
									? "border-green-600/20 bg-green-600/5"
									: "border-border/60 bg-muted/10",
								isHighlighted && "border-primary/40 bg-primary/5",
							)}
						>
							<div className="flex items-start gap-3">
								<div
									className={cn(
										"mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold",
										planItem.checked
											? "border-green-600/30 bg-green-600/10 text-green-700"
											: "border-border/60 bg-background text-muted-foreground",
										isHighlighted && "border-primary/40 text-primary",
									)}
								>
									{planItem.checked ? (
										<Check className="h-3.5 w-3.5" />
									) : (
										planItem.id
									)}
								</div>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<div className="text-sm font-medium text-foreground">
											{planItem.description}
										</div>
										<Badge variant="outline" className="text-[10px] font-mono">
											#{planItem.id}
										</Badge>
										{isHighlighted ? (
											<Badge
												variant="outline"
												className="border-primary/30 bg-primary/5 text-[10px] text-primary"
											>
												updated
											</Badge>
										) : null}
									</div>

									{planItem.notes ? (
										<div className="mt-2 rounded-md border border-border/60 bg-background/70 px-2.5 py-2 text-xs text-muted-foreground whitespace-pre-wrap break-words">
											{planItem.notes}
										</div>
									) : null}
								</div>
							</div>
						</div>
					);
				})}
			</div>
		</ToolSection>
	);
};

const PlannerDetailsSection: React.FC<{
	view: PlannerPlanView;
	summary: PlannerActionSummary;
}> = ({ view, summary }) => {
	const remainingCount = Math.max(view.totalCount - view.doneCount, 0);

	return (
		<ToolSection title="Plan Details">
			<ToolDetailsGrid>
				<ToolDetail label="Completed" value={String(view.doneCount)} mono />
				<ToolDetail label="Remaining" value={String(remainingCount)} mono />
				<ToolDetail label="Total items" value={String(view.totalCount)} mono />
				<ToolDetail label="Last action" value={summary.label} />
				{summary.targetItemId ? (
					<ToolDetail label="Target item" value={summary.targetItemId} mono />
				) : null}
				{view.createdAt ? (
					<ToolDetail label="Created" value={formatIsoDate(view.createdAt)} />
				) : null}
				{view.updatedAt ? (
					<ToolDetail label="Updated" value={formatIsoDate(view.updatedAt)} />
				) : null}
			</ToolDetailsGrid>
		</ToolSection>
	);
};

const PlannerMessageCard: React.FC<{
	view: PlannerMessageView;
	summary: PlannerActionSummary;
}> = ({ view, summary }) => (
	<ToolSection title={view.title}>
		<div
			className={cn(
				"rounded-lg border px-3 py-3",
				MESSAGE_CARD_CLASSNAME[view.tone],
			)}
		>
			<div className="flex items-start gap-3">
				<AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
				<div className="min-w-0 flex-1">
					<div className="flex flex-wrap items-center gap-2">
						<Badge
							variant="outline"
							className={cn("text-[10px]", MESSAGE_BADGE_CLASSNAME[view.tone])}
						>
							{summary.label}
						</Badge>
						{summary.targetItemId ? (
							<Badge variant="outline" className="text-[10px] font-mono">
								item {summary.targetItemId}
							</Badge>
						) : null}
					</div>
					<div className="mt-2 text-sm leading-relaxed">{view.message}</div>
				</div>
			</div>
		</div>
		{view.requestedItemId || view.availableIds?.length ? (
			<div className="mt-3">
				<ToolDetailsGrid>
					{view.requestedItemId ? (
						<ToolDetail
							label="Requested item"
							value={view.requestedItemId}
							mono
						/>
					) : null}
					{view.availableIds?.length ? (
						<ToolDetail
							label="Available ids"
							value={view.availableIds.join(", ")}
							mono
						/>
					) : null}
				</ToolDetailsGrid>
			</div>
		) : null}
	</ToolSection>
);

const PlannerFallback: React.FC<{
	output: string;
}> = ({ output }) => (
	<ToolSection title="Planner Output">
		<ToolCodeBlock>{output}</ToolCodeBlock>
	</ToolSection>
);

export const plannerToolRenderer: ActionRenderer = (item, isOpen) => {
	if (!isOpen) return null;

	const args = getToolCallArguments(item);
	const output = extractOutputSection(item.description);
	if (!output) {
		return defaultActionRenderer(item, isOpen);
	}

	const view = parsePlannerOutput(output);
	const summary = getPlannerActionSummary(item.name, args, view);

	return (
		<div className="space-y-3">
			{view?.kind === "plan" ? (
				<>
					<PlannerHeader view={view} summary={summary} />
					<PlannerItemsSection view={view} summary={summary} />
					<PlannerDetailsSection view={view} summary={summary} />
				</>
			) : view?.kind === "message" ? (
				<PlannerMessageCard view={view} summary={summary} />
			) : (
				<PlannerFallback output={output} />
			)}
			<ToolItemRawIO item={item} input={args ?? undefined} output={output} />
		</div>
	);
};
