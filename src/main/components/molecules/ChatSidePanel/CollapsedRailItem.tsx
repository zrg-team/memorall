import React from "react";
import { cn } from "@/lib/utils";

interface CollapsedRailItemProps {
	icon: React.ReactNode;
	label: string;
	count?: number | string;
	active?: boolean;
	onClick: () => void;
	newChat?: boolean;
}

export const CollapsedRailItem: React.FC<CollapsedRailItemProps> = ({
	icon,
	label,
	count,
	active = false,
	onClick,
	newChat = false,
}) => (
	<button
		type="button"
		data-new-chat={newChat || undefined}
		onClick={onClick}
		title={label}
		aria-label={label}
		className={cn(
			"relative inline-flex h-10 w-10 items-center justify-center rounded-md transition-colors",
			"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
			active
				? "bg-muted/70 text-foreground"
				: "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
		)}
	>
		{active ? (
			<span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-primary" />
		) : null}
		{icon}
		{count !== undefined && count !== 0 ? (
			<span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full border border-card bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground">
				{count}
			</span>
		) : null}
	</button>
);
