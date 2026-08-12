"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import {
	ArrowRight,
	Brain,
	Database,
	FileText,
	Lightbulb,
	Search,
	Sparkles,
	Wrench,
} from "lucide-react";
import {
	AgentIcon,
	type AgentGreetingContext,
	type AgentScreenContent,
} from "@/components/AgentIcon";
import { cn } from "@/lib/utils";

interface ChatEmptyStateProps {
	screenContent?: AgentScreenContent;
	greetingContext: AgentGreetingContext;
	showAgentBuilderCallout: boolean;
	onOpenAgentWizard: () => void;
	onSelectPrompt: (prompt: string) => void;
	compact?: boolean;
}

export const ChatEmptyState: React.FC<ChatEmptyStateProps> = ({
	screenContent,
	greetingContext,
	showAgentBuilderCallout,
	onOpenAgentWizard,
	onSelectPrompt,
	compact = false,
}) => {
	const { t } = useTranslation(["chat"]);
	const calloutHighlights = [
		{
			label: t("agentBuilderCallout.memory", "Memory"),
			icon: Database,
			className: "text-primary",
		},
		{
			label: t("agentBuilderCallout.tools", "Tools"),
			icon: Wrench,
			className: "text-primary",
		},
		{
			label: t("agentBuilderCallout.behavior", "Behavior"),
			icon: Brain,
			className: "text-primary",
		},
	];
	const agentBuilderPrompt = t("agentBuilderCallout.agentPrompt");
	const promptSuggestions = [
		{
			label: t("emptyState.prompts.savedKnowledge"),
			prompt: t("emptyState.promptText.savedKnowledge"),
			icon: Search,
		},
		{
			label: t("emptyState.prompts.summarizeDocument"),
			prompt: t("emptyState.promptText.summarizeDocument"),
			icon: FileText,
		},
		{
			label: t("emptyState.prompts.brainstorm"),
			prompt: t("emptyState.promptText.brainstorm"),
			icon: Lightbulb,
		},
	];

	return (
		<div
			className={cn(
				"flex flex-1 flex-col items-center justify-center",
				compact
					? "min-h-0 justify-center gap-4 py-3"
					: "min-h-[calc(100vh-18rem)] gap-6 py-10",
			)}
		>
			<AgentIcon
				size={compact ? 88 : 108}
				aria-label="Agent"
				ambientScreenContent={screenContent}
				autoGreeting={!showAgentBuilderCallout}
				speechBubble={
					showAgentBuilderCallout
						? {
								message: agentBuilderPrompt,
								tone: "thinking",
								placement: "top",
								variant: "manga",
							}
						: undefined
				}
				greetingContext={greetingContext}
			/>
			<div className="max-w-xl space-y-2 text-center">
				<h2
					className={cn(
						"font-semibold text-foreground",
						compact ? "text-lg" : "text-xl",
					)}
				>
					{t("emptyState.title")}
				</h2>
				<p className="text-sm leading-6 text-muted-foreground">
					{t("emptyState.description")}
				</p>
			</div>

			<div
				className={cn(
					"grid w-full max-w-2xl gap-2",
					compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-3",
				)}
			>
				{promptSuggestions
					.slice(0, compact ? 2 : promptSuggestions.length)
					.map((suggestion) => {
						const Icon = suggestion.icon;
						return (
							<button
								key={suggestion.label}
								type="button"
								onClick={() => onSelectPrompt(suggestion.prompt)}
								className="group flex min-h-12 items-center gap-3 rounded-xl border border-border/70 bg-card/70 px-3 py-2.5 text-left text-sm text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							>
								<span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
									<Icon size={15} />
								</span>
								<span className="min-w-0 flex-1 font-medium leading-5">
									{suggestion.label}
								</span>
								<ArrowRight
									size={14}
									className="shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
								/>
							</button>
						);
					})}
			</div>
			{showAgentBuilderCallout ? (
				<button
					type="button"
					onClick={onOpenAgentWizard}
					className={cn(
						"group relative w-full overflow-hidden border border-primary/20 bg-card text-left shadow-lg shadow-black/5 transition duration-200 hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-xl hover:shadow-black/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
						compact ? "max-w-md rounded-xl" : "max-w-2xl rounded-xl",
					)}
				>
					<span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,hsl(var(--primary)/0.5),transparent)]" />
					<span
						className={cn(
							"relative flex",
							compact
								? "gap-3 rounded-[calc(0.75rem-1px)] px-3.5 py-3"
								: "gap-3 rounded-[calc(0.75rem-1px)] px-4 py-3",
						)}
					>
						<span
							className={cn(
								"mt-0.5 flex shrink-0 items-center justify-center border border-primary/15 bg-primary/10 text-primary transition duration-200 group-hover:scale-105 group-hover:bg-primary/15",
								compact ? "h-9 w-9 rounded-lg" : "h-12 w-12 rounded-xl",
							)}
						>
							<Sparkles size={compact ? 17 : 22} />
						</span>
						<span
							className={cn(
								"min-w-0 flex-1",
								compact ? "space-y-2" : "space-y-3",
							)}
						>
							<span
								className={cn(
									"block font-semibold text-foreground",
									compact ? "text-sm leading-5" : "text-base leading-6",
								)}
							>
								{t("agentBuilderCallout.title")}
							</span>
							<span
								className={cn(
									"block max-w-md text-muted-foreground",
									compact
										? "overflow-hidden text-xs leading-5 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:1]"
										: "text-sm leading-6",
								)}
							>
								{t("agentBuilderCallout.description")}
							</span>
							<span
								className={cn("flex flex-wrap", compact ? "gap-1.5" : "gap-2")}
							>
								{calloutHighlights.map((item) => {
									const Icon = item.icon;
									return (
										<span
											key={item.label}
											className={cn(
												"inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/70 font-medium text-muted-foreground",
												compact
													? "px-2 py-0.5 text-[11px]"
													: "px-2.5 py-1 text-xs",
											)}
										>
											<Icon
												size={compact ? 12 : 13}
												className={item.className}
											/>
											{item.label}
										</span>
									);
								})}
							</span>
						</span>
						<span
							className={cn(
								"flex shrink-0 items-center justify-center rounded-full border border-primary/15 bg-primary/10 text-primary transition duration-200 group-hover:translate-x-1 group-hover:bg-primary/15",
								compact ? "h-8 w-8" : "h-9 w-9",
							)}
						>
							<ArrowRight size={compact ? 15 : 17} />
						</span>
					</span>
				</button>
			) : null}
		</div>
	);
};
