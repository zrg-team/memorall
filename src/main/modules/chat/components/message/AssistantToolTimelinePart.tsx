import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
	AlertTriangle,
	CheckCircle2,
	ChevronDown,
	Loader2,
} from "lucide-react";
import type { ComplexContentPartTool } from "@/types/chat";
import { cn } from "@/lib/utils";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@/main/components/ui/collapsible";
import {
	getActionIcon,
	ToolActionDetails,
	translateActionName,
} from "../MessageActions";

export const AssistantToolTimelinePart: React.FC<{
	part: ComplexContentPartTool;
	isLast: boolean;
	connectsToPrevious?: boolean;
	forceOpen?: boolean;
	revealKey?: number;
}> = ({
	part,
	isLast,
	connectsToPrevious = false,
	forceOpen = false,
	revealKey = 0,
}) => {
	const { t } = useTranslation("chat");
	const [isOpen, setIsOpen] = useState(false);
	const actionName = part.name;
	const title = translateActionName(t, actionName);
	const Icon = getActionIcon(actionName);
	const isRunning = part.state === "running";
	const isError = part.state === "error";
	const [nowMs, setNowMs] = useState(() => Date.now());
	const startedAt =
		typeof part.metadata?.startedAt === "string"
			? new Date(part.metadata.startedAt).getTime()
			: undefined;
	const durationMs = isRunning
		? startedAt
			? Math.max(0, nowMs - startedAt)
			: undefined
		: typeof part.metadata?.durationMs === "number"
			? part.metadata.durationMs
			: undefined;
	const effectiveOpen = forceOpen || isOpen;

	useEffect(() => {
		if (forceOpen || revealKey > 0) setIsOpen(true);
	}, [forceOpen, revealKey]);

	useEffect(() => {
		if (!isRunning || !startedAt) return;
		setNowMs(Date.now());
		const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
		return () => window.clearInterval(timer);
	}, [isRunning, startedAt]);
	const statusLabel = isRunning
		? t("toolStatus.running")
		: isError
			? t("toolStatus.error")
			: t("toolStatus.done");
	const actionItem = {
		name: part.name,
		description: part.description,
		metadata: part.metadata,
	};

	return (
		<div className="grid w-full min-w-0 max-w-full grid-cols-[0.875rem_minmax(0,1fr)] gap-2 sm:grid-cols-[1rem_minmax(0,1fr)] sm:gap-2.5 animate-in fade-in-0 slide-in-from-top-1 duration-200 ease-out">
			<div className="relative flex h-full justify-center">
				{connectsToPrevious ? (
					<div className="absolute left-1/2 top-0 h-[1.25rem] w-px -translate-x-1/2 bg-border/70 transition-colors duration-200" />
				) : null}
				{!isLast ? (
					<div className="absolute left-1/2 top-[1.375rem] h-[calc(100%+0.75rem)] w-px -translate-x-1/2 bg-border/70 transition-colors duration-200" />
				) : null}
				<span
					className={cn(
						"absolute top-[1.125rem] z-10 h-2 w-2 rounded-full border bg-background transition-all duration-200 ease-out",
						isError
							? "border-destructive bg-destructive"
							: isRunning
								? "border-primary bg-primary"
								: "border-emerald-500 bg-emerald-500",
					)}
				/>
			</div>
			<div className="min-w-0">
				<Collapsible
					open={effectiveOpen}
					onOpenChange={(open) => {
						if (!forceOpen) setIsOpen(open);
					}}
				>
					<CollapsibleTrigger asChild>
						<button
							type="button"
							className={cn(
								"group/tool flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-[background-color,box-shadow,transform] duration-200 ease-out hover:bg-muted/20 active:scale-[0.995]",
								effectiveOpen && "bg-muted/35 shadow-sm",
							)}
						>
							<span
								className={cn(
									"flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-background/70 transition-[background-color,border-color,color,transform] duration-200 ease-out group-hover/tool:scale-105",
									isError
										? "border-destructive/25 text-destructive"
										: isRunning
											? "border-primary/25 text-primary"
											: "border-border/60 text-muted-foreground",
								)}
							>
								<Icon className="h-4 w-4" />
							</span>
							<span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground transition-colors duration-200">
								{title}
							</span>
							<span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground transition-colors duration-200 max-[420px]:sr-only">
								{isRunning ? (
									<Loader2 className="h-3.5 w-3.5 animate-spin" />
								) : isError ? (
									<AlertTriangle className="h-3.5 w-3.5 text-destructive" />
								) : (
									<CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
								)}
								{statusLabel}
								{durationMs !== undefined
									? ` · ${durationMs < 1_000 ? `${Math.round(durationMs)}ms` : `${(durationMs / 1_000).toFixed(1)}s`}`
									: ""}
							</span>
							<ChevronDown
								className={cn(
									"h-4 w-4 shrink-0 text-muted-foreground transition-[transform,color] duration-200 ease-out",
									effectiveOpen && "rotate-180 text-foreground",
								)}
							/>
						</button>
					</CollapsibleTrigger>
					<CollapsibleContent
						className={cn(
							// Animate height (not just opacity) so the surrounding layout
							// expands/collapses smoothly instead of snapping to full height.
							"overflow-hidden text-sm outline-none data-[state=open]:animate-collapsible-down data-[state=closed]:animate-collapsible-up",
						)}
					>
						<div className="mt-2 min-w-0 overflow-hidden rounded-lg border border-border/60 bg-background/80 p-2 shadow-sm sm:p-3">
							<ToolActionDetails item={actionItem} isOpen={effectiveOpen} />
						</div>
					</CollapsibleContent>
				</Collapsible>
			</div>
		</div>
	);
};
