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
	getComposioActionIcon,
	ToolActionDetails,
	translateActionName,
} from "../MessageActions";
import { AppIcon } from "@/main/modules/connections/components/AppIcon";

export const AssistantToolTimelinePart: React.FC<{
	part: ComplexContentPartTool;
	isLast: boolean;
	connectsToPrevious?: boolean;
	forceOpen?: boolean;
}> = ({ part, isLast, connectsToPrevious = false, forceOpen = false }) => {
	const { t } = useTranslation("chat");
	const [isOpen, setIsOpen] = useState(false);
	const actionName = part.name;
	const title = translateActionName(t, actionName, part.metadata);
	const Icon = getActionIcon(actionName);
	const appMark = getComposioActionIcon(actionName, part.metadata);
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
		<div className="grid w-full min-w-0 max-w-full grid-cols-[0.75rem_minmax(0,1fr)] gap-2">
			<div className="relative flex h-full justify-center">
				{connectsToPrevious ? (
					<div className="absolute left-1/2 top-0 h-4 w-px -translate-x-1/2 bg-border/60" />
				) : null}
				{!isLast ? (
					<div className="absolute bottom-[-0.25rem] left-1/2 top-4 w-px -translate-x-1/2 bg-border/60" />
				) : null}
				<span
					className={cn(
						"absolute top-[0.9375rem] z-10 h-1.5 w-1.5 rounded-full ring-2 ring-background transition-colors duration-200",
						isError
							? "bg-destructive"
							: isRunning
								? "bg-primary"
								: "bg-emerald-500",
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
								"group/tool flex min-h-8 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
								effectiveOpen && "bg-muted/10",
							)}
						>
							<span
								className={cn(
									"flex h-6 w-6 shrink-0 items-center justify-center text-muted-foreground transition-colors group-hover/tool:text-foreground",
									isError
										? "text-destructive"
										: isRunning
											? "text-primary"
											: "text-muted-foreground",
								)}
							>
								{appMark ? (
									<AppIcon
										name={appMark.label}
										composioSlug={appMark.logoSlug}
										size={18}
									/>
								) : (
									<Icon className="h-3.5 w-3.5" />
								)}
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
									"h-3.5 w-3.5 shrink-0 text-muted-foreground transition-[transform,color] duration-200 ease-out",
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
						<div className="min-w-0 overflow-hidden pb-3 pl-1 pr-1 pt-1">
							<ToolActionDetails item={actionItem} isOpen={effectiveOpen} />
						</div>
					</CollapsibleContent>
				</Collapsible>
			</div>
		</div>
	);
};
