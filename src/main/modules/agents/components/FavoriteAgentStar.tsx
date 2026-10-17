import { Star } from "lucide-react";
import type React from "react";
import { cn } from "@/lib/utils";

/**
 * Stars an agent, so it is listed first wherever agents are chosen. Faint
 * until hovered or starred; it never selects the row it sits in.
 */
export const FavoriteAgentStar: React.FC<{
	starred: boolean;
	onToggle: () => void;
	/** "Add Content Writer to favorites" / "Remove … from favorites". */
	label: string;
	size?: number;
	className?: string;
}> = ({ starred, onToggle, label, size = 14, className }) => (
	<button
		type="button"
		aria-label={label}
		aria-pressed={starred}
		title={label}
		// Only the click stops: a menu item that never saw the pointer go down
		// selects itself when it comes up.
		onClick={(event) => {
			event.preventDefault();
			event.stopPropagation();
			onToggle();
		}}
		onKeyDown={(event) => {
			// Enter or Space stars, as for any button; the row stays as it is.
			if (event.key === "Enter" || event.key === " ") event.stopPropagation();
		}}
		className={cn(
			"inline-flex shrink-0 items-center justify-center rounded-md p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
			starred
				? "text-amber-400 hover:text-amber-500"
				: "text-muted-foreground/40 hover:text-foreground group-hover:text-muted-foreground",
			className,
		)}
	>
		<Star size={size} className={cn(starred && "fill-current")} />
	</button>
);
