import React from "react";
import { cn } from "@/lib/utils";

interface WorkspaceCollapsedSidebarItemProps {
	icon: React.ReactNode;
	label: string;
	active?: boolean;
	onClick: () => void;
	className?: string;
}

export const WorkspaceCollapsedSidebarItem: React.FC<
	WorkspaceCollapsedSidebarItemProps
> = ({ icon, label, active = false, onClick, className }) => (
	<button
		type="button"
		onClick={onClick}
		aria-label={label}
		className={cn(
			"group relative inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors",
			"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
			active
				? "border border-primary/25 bg-primary/10 text-primary"
				: "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
			className,
		)}
	>
		<span className="flex items-center justify-center">{icon}</span>
		<span
			aria-hidden="true"
			className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 max-w-[18rem] -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2.5 py-1.5 text-xs font-medium text-popover-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
		>
			{label}
		</span>
	</button>
);
