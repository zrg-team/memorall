import { ArrowRight, type LucideIcon } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

export interface WorkspaceSuggestion {
	key: string;
	label: string;
	icon: LucideIcon;
	onSelect: () => void;
	/** `data-*` attributes for the chip (tests, the co-pilot). */
	attributes?: Record<`data-${string}`, string>;
}

interface WorkspaceEmptyStateProps {
	/** The large figure above the title: chat's agent, a studio's mode icon. */
	visual: React.ReactNode;
	title: string;
	description: string;
	suggestions: readonly WorkspaceSuggestion[];
	compact?: boolean;
	/** Suggestion columns on wide panels: 3 for short labels, 2 for prompts. */
	columns?: 2 | 3;
	/** Below the suggestions (chat's agent-builder callout). */
	children?: React.ReactNode;
	className?: string;
}

/**
 * What a workspace shows before its first message or generation: a figure, a
 * line on what to do, and starter prompts. Chat and every studio render it, so
 * a new session looks the same in each.
 */
export const WorkspaceEmptyState: React.FC<WorkspaceEmptyStateProps> = ({
	visual,
	title,
	description,
	suggestions,
	compact = false,
	columns = 3,
	children,
	className,
}) => {
	const visible = suggestions.slice(0, compact ? 2 : suggestions.length);
	return (
		<div
			className={cn(
				"flex flex-1 flex-col items-center justify-center",
				compact
					? "min-h-0 justify-center gap-4 py-3"
					: "min-h-[calc(100vh-18rem)] gap-6 py-10",
				className,
			)}
			data-workspace-empty
		>
			{visual}
			<div className="max-w-xl space-y-2 text-center">
				<h2
					className={cn(
						"font-semibold text-foreground",
						compact ? "text-lg" : "text-xl",
					)}
				>
					{title}
				</h2>
				<p className="text-sm leading-6 text-muted-foreground">{description}</p>
			</div>

			{visible.length > 0 ? (
				<div
					className={cn(
						"grid w-full max-w-2xl gap-2",
						compact || visible.length < 2
							? "grid-cols-1"
							: columns === 2 || visible.length < 3
								? "grid-cols-1 sm:grid-cols-2"
								: "grid-cols-1 sm:grid-cols-3",
					)}
				>
					{visible.map((suggestion) => {
						const Icon = suggestion.icon;
						return (
							<button
								key={suggestion.key}
								type="button"
								onClick={suggestion.onSelect}
								className="group flex min-h-12 items-center gap-3 rounded-xl border border-border/70 bg-card/70 px-3 py-2.5 text-left text-sm text-foreground shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								data-workspace-suggestion
								{...suggestion.attributes}
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
			) : null}
			{children}
		</div>
	);
};

/** A studio's stand-in for chat's agent figure: its mode icon, as large. */
export const WorkspaceEmptyVisual: React.FC<{
	icon: LucideIcon;
	compact?: boolean;
}> = ({ icon: Icon, compact = false }) => (
	<span
		className={cn(
			"inline-flex items-center justify-center rounded-[28px] border border-border/60 bg-card/80 text-primary shadow-[0_18px_55px_hsl(var(--foreground)/0.10)]",
			compact ? "h-[72px] w-[72px]" : "h-[88px] w-[88px]",
		)}
		aria-hidden
	>
		<Icon size={compact ? 30 : 36} strokeWidth={1.6} />
	</span>
);
