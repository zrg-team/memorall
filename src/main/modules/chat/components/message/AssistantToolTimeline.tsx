import React, { useMemo } from "react";
import { useStreamingDisclosure } from "./use-streaming-disclosure";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ComplexContentPartTool } from "@/types/chat";
import { cn } from "@/lib/utils";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/main/components/ui/collapsible";
import { AssistantToolTimelinePart } from "./AssistantToolTimelinePart";

const formatDuration = (durationMs: number): string =>
	durationMs < 1_000
		? `${Math.max(0, Math.round(durationMs))}ms`
		: `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;

const getTimelineDuration = (parts: ComplexContentPartTool[]): number => {
	const durations = parts
		.map((part) => part.metadata?.durationMs)
		.filter((value): value is number => typeof value === "number");
	return durations.reduce((total, duration) => total + duration, 0);
};

export const AssistantToolTimeline: React.FC<{
	parts: ComplexContentPartTool[];
	isStreaming: boolean;
}> = React.memo(({ parts, isStreaming }) => {
	const { t } = useTranslation("chat");
	const [isOpen, setIsOpen] = useStreamingDisclosure(isStreaming);
	const hasError = parts.some((part) => part.state === "error");
	const durationMs = useMemo(() => getTimelineDuration(parts), [parts]);

	const summary = isStreaming
		? t("toolTimeline.running", {
				count: parts.length,
				defaultValue: `${parts.length} agent action${parts.length === 1 ? "" : "s"} · running`,
			})
		: t("toolTimeline.finished", {
				count: parts.length,
				duration: formatDuration(durationMs),
				defaultValue: `${parts.length} agent action${parts.length === 1 ? "" : "s"} · ${formatDuration(durationMs)}`,
			});
	const disclosureLabel = isOpen
		? t("workflow.hideDetails", { defaultValue: "Hide run details" })
		: t("workflow.showDetails", { defaultValue: "Show run details" });

	return (
		<Collapsible open={isOpen} onOpenChange={setIsOpen}>
			<CollapsibleTrigger asChild>
				<button
					type="button"
					title={summary}
					className="group/run-details inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				>
					<SlidersHorizontal
						className={cn(
							"h-3.5 w-3.5 shrink-0",
							isStreaming && "animate-pulse text-primary",
							hasError && !isStreaming && "text-destructive",
						)}
					/>
					<span className="truncate">
						{disclosureLabel} ({parts.length})
					</span>
					<ChevronDown
						className={cn(
							"h-3.5 w-3.5 shrink-0 transition-transform duration-200",
							isOpen && "rotate-180",
						)}
					/>
				</button>
			</CollapsibleTrigger>
			<CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
				<div className="mt-1.5 min-w-0 pl-0.5">
					{parts.map((part, index) => (
						<AssistantToolTimelinePart
							key={part.id}
							part={part}
							connectsToPrevious={index > 0}
							isLast={index === parts.length - 1}
							forceOpen={isStreaming && part.state === "running"}
						/>
					))}
				</div>
			</CollapsibleContent>
			{isStreaming ? (
				<div className="sr-only" role="status" aria-live="polite">
					{summary}
				</div>
			) : null}
		</Collapsible>
	);
});

AssistantToolTimeline.displayName = "AssistantToolTimeline";
