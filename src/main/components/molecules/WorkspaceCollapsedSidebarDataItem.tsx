import React from "react";
import { cn } from "@/lib/utils";

interface WorkspaceCollapsedSidebarDataItemProps {
	label: string;
	onClick: () => void;
	active?: boolean;
	badge?: React.ReactNode;
	description?: string;
	indicatorClassName?: string;
}

export const WorkspaceCollapsedSidebarDataItem: React.FC<
	WorkspaceCollapsedSidebarDataItemProps
> = ({
	label,
	onClick,
	active = false,
	badge,
	description,
	indicatorClassName,
}) => (
	<button
		type="button"
		onClick={onClick}
		aria-current={active ? "page" : undefined}
		aria-label={description ? `${label}, ${description}` : label}
		title={description ? `${label} · ${description}` : label}
		className={cn(
			"relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md border text-center transition-colors",
			"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
			active
				? "border-primary/50 bg-primary/10 text-primary"
				: "border-transparent text-foreground hover:border-border hover:bg-muted/60",
		)}
	>
		<span className="text-xs font-semibold leading-none">
			{label.trim().charAt(0).toUpperCase() || "?"}
		</span>
		{badge !== undefined && badge !== null ? (
			<span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-background bg-muted px-1 text-[9px] font-semibold leading-none text-muted-foreground shadow-sm">
				{badge}
			</span>
		) : null}
		{indicatorClassName ? (
			<span
				aria-hidden="true"
				className={cn(
					"absolute right-1 top-1 h-1.5 w-1.5 rounded-full",
					indicatorClassName,
				)}
			/>
		) : null}
	</button>
);
