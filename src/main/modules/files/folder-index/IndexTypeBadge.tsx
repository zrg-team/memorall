import type React from "react";
import { cn } from "@/lib/utils";

/** An index type's short name, as the tree, list and settings show it. */
export const IndexTypeBadge: React.FC<{
	label: string;
	muted?: boolean;
	className?: string;
	title?: string;
}> = ({ label, muted = false, className, title }) => (
	<span
		title={title}
		className={cn(
			"inline-flex shrink-0 items-center rounded-sm border px-1 py-px text-[10px] font-medium uppercase tracking-wide",
			muted
				? "text-muted-foreground"
				: "border-sky-500/40 bg-sky-500/10 text-sky-600 dark:text-sky-400",
			className,
		)}
	>
		{label}
	</span>
);
