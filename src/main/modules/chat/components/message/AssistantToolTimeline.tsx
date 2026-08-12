import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronDown, Loader2, XCircle } from "lucide-react";
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
	const [isOpen, setIsOpen] = useState(isStreaming);
	const [revealKey, setRevealKey] = useState(isStreaming ? 1 : 0);
	const wasStreamingRef = useRef(isStreaming);
	const hasError = parts.some((part) => part.state === "error");
	const durationMs = useMemo(() => getTimelineDuration(parts), [parts]);

	useEffect(() => {
		if (isStreaming) {
			setIsOpen(true);
			if (!wasStreamingRef.current) setRevealKey((value) => value + 1);
		} else if (wasStreamingRef.current) {
			setIsOpen(false);
		}
		wasStreamingRef.current = isStreaming;
	}, [isStreaming]);

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

	return (
		<Collapsible
			open={isOpen}
			onOpenChange={(open) => {
				setIsOpen(open);
				if (open) setRevealKey((value) => value + 1);
			}}
		>
			<div className="overflow-hidden rounded-lg border border-border/60 bg-muted/10">
				<CollapsibleTrigger asChild>
					<button
						type="button"
						className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
					>
						{isStreaming ? (
							<Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
						) : hasError ? (
							<XCircle className="h-4 w-4 shrink-0 text-destructive" />
						) : (
							<CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
						)}
						<span className="min-w-0 flex-1 truncate text-sm font-medium">
							{summary}
						</span>
						<ChevronDown
							className={cn(
								"h-4 w-4 shrink-0 text-muted-foreground transition-transform",
								isOpen && "rotate-180",
							)}
						/>
					</button>
				</CollapsibleTrigger>
				<CollapsibleContent className="overflow-hidden data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up">
					<div className="space-y-1 border-t border-border/50 px-2 py-2 sm:px-3">
						{parts.map((part, index) => (
							<AssistantToolTimelinePart
								key={part.id}
								part={part}
								connectsToPrevious={index > 0}
								isLast={index === parts.length - 1}
								forceOpen={isStreaming}
								revealKey={revealKey}
							/>
						))}
					</div>
				</CollapsibleContent>
			</div>
			{isStreaming ? (
				<div className="sr-only" role="status" aria-live="polite">
					{summary}
				</div>
			) : null}
		</Collapsible>
	);
});

AssistantToolTimeline.displayName = "AssistantToolTimeline";
