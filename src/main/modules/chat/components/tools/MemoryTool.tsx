import { BookMarked, Brain, Link2, Trash2 } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/main/components/ui/badge";
import type {
	ActionRenderer,
	MessageActionItem,
} from "@/main/modules/chat/components/types";
import { defaultActionRenderer } from "./DefaultActionRenderer";
import {
	type ParsedMemoryFact,
	parseMemoryToolOutput,
} from "./memory-tool-output";
import {
	getToolCallArguments,
	ToolDetail,
	ToolDetailsGrid,
	ToolItemRawIO,
	ToolSection,
} from "./ToolCommon";

const DESCRIPTION_OUTPUT_MARKER = "\noutput:\n";

const getActionOutput = (item: MessageActionItem): string => {
	const description = item.description?.trim() || "";
	const markerIndex = description.indexOf(DESCRIPTION_OUTPUT_MARKER);
	if (markerIndex === -1) return description;
	return description
		.slice(markerIndex + DESCRIPTION_OUTPUT_MARKER.length)
		.trim();
};

/**
 * `source` says whether a memory is writable: the agent may only update or
 * remove what it saved itself, and everything else came out of the user's own
 * saved pages, files, and chats.
 */
const SOURCE_LABELS: Record<string, string> = {
	active_memory: "Saved by the agent",
	knowledge_graph: "From your knowledge",
};

const relationParts = (
	relation: string,
): { subject: string; predicate: string; object: string } | null => {
	const match = relation.match(/^(.*?)\s*-\[(.*?)\]->\s*(.*)$/);
	if (!match) return null;
	return { subject: match[1], predicate: match[2], object: match[3] };
};

const MemoryRelation: React.FC<{ relation: string }> = ({ relation }) => {
	const parts = relationParts(relation);
	if (!parts) {
		return <span className="break-words">{relation}</span>;
	}

	return (
		<span className="inline-flex flex-wrap items-center gap-1 text-xs">
			<span className="rounded bg-muted/60 px-1.5 py-0.5 text-foreground">
				{parts.subject}
			</span>
			<Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
			<span className="font-mono text-[11px] text-muted-foreground">
				{parts.predicate}
			</span>
			<Link2 className="h-3 w-3 shrink-0 text-muted-foreground" />
			<span className="rounded bg-muted/60 px-1.5 py-0.5 text-foreground">
				{parts.object}
			</span>
		</span>
	);
};

const MemoryFactCard: React.FC<{ fact: ParsedMemoryFact; index: number }> = ({
	fact,
	index,
}) => {
	const isInactive = fact.status === "inactive";
	const sourceLabel = fact.source
		? (SOURCE_LABELS[fact.source] ?? fact.source)
		: undefined;

	return (
		<div
			className={cn(
				"min-w-0 rounded-lg border border-border/60 bg-muted/15 p-3",
				isInactive && "opacity-70",
			)}
		>
			<div className="flex items-start gap-2">
				<span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded bg-muted/60 text-[10px] font-semibold text-muted-foreground">
					{index + 1}
				</span>
				<div className="min-w-0 flex-1 space-y-2">
					{fact.fact ? (
						<p className="whitespace-pre-wrap break-words text-sm leading-5 text-foreground">
							{fact.fact}
						</p>
					) : null}

					{fact.relation ? (
						<div className="min-w-0">
							<MemoryRelation relation={fact.relation} />
						</div>
					) : null}

					<div className="flex flex-wrap items-center gap-1.5">
						{fact.kind ? (
							<Badge variant="secondary" className="text-[10px]">
								{fact.kind.replace(/_/g, " ")}
							</Badge>
						) : null}
						{sourceLabel ? (
							<Badge variant="outline" className="text-[10px]">
								{sourceLabel}
							</Badge>
						) : null}
						{isInactive ? (
							<Badge variant="outline" className="text-[10px]">
								<Trash2 className="mr-1 h-3 w-3" />
								forgotten
							</Badge>
						) : null}
						{fact.extras.map((extra) => (
							<Badge
								key={extra.label}
								variant="outline"
								className="text-[10px] font-normal"
							>
								{extra.label}: {extra.value}
							</Badge>
						))}
					</div>

					{/* The id is what memory_update and memory_remove take, so it has to
					    stay reachable — just not at the top of the card. */}
					{fact.id ? (
						<p className="break-all font-mono text-[10px] text-muted-foreground/70">
							{fact.id}
						</p>
					) : null}
				</div>
			</div>
		</div>
	);
};

export const memoryToolRenderer: ActionRenderer = (item, isOpen) => {
	if (!isOpen) return null;

	const output = getActionOutput(item);
	const parsed = parseMemoryToolOutput(output);
	if (!parsed) return defaultActionRenderer(item, isOpen);

	const args = getToolCallArguments(item);
	const query = typeof args?.query === "string" ? args.query : undefined;
	const scope = typeof args?.scope === "string" ? args.scope : undefined;
	const reason = typeof args?.reason === "string" ? args.reason : undefined;

	return (
		<div className="space-y-3">
			{query || scope || reason ? (
				<ToolDetailsGrid>
					{query ? <ToolDetail label="Query" value={query} /> : null}
					{scope ? <ToolDetail label="Scope" value={scope} /> : null}
					{reason ? <ToolDetail label="Reason" value={reason} /> : null}
				</ToolDetailsGrid>
			) : null}

			<ToolSection
				title={
					parsed.lead ??
					(parsed.facts.length > 0
						? `${parsed.facts.length} ${parsed.facts.length === 1 ? "memory" : "memories"}`
						: "Memory")
				}
			>
				{parsed.facts.length > 0 ? (
					<div className="grid min-w-0 gap-2">
						{parsed.facts.map((fact, index) => (
							<MemoryFactCard
								key={fact.id ?? `${fact.fact ?? "memory"}-${index}`}
								fact={fact}
								index={index}
							/>
						))}
					</div>
				) : (
					<div className="flex items-start gap-2 text-sm text-muted-foreground">
						<Brain className="mt-0.5 h-4 w-4 shrink-0" />
						<p className="min-w-0 break-words">{parsed.message}</p>
					</div>
				)}
			</ToolSection>

			<ToolItemRawIO item={item} />
		</div>
	);
};

/** Icon for the timeline row, so memory reads as memory and not as a wrench. */
export const memoryToolIcon = BookMarked;
