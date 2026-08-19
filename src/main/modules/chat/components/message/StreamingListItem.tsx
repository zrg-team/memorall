import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const ENTRY_ANIMATION_MS = 240;

const prefersReducedMotion = (): boolean =>
	typeof window !== "undefined" &&
	typeof window.matchMedia === "function" &&
	window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * A row in a list that grows while the user is watching it.
 *
 * Appending straight into the list snaps every later row (and the answer text
 * under it) down by a row height at once. Wrapping the row in a grid track that
 * animates 0fr -> 1fr lets it push the page open smoothly without anyone having
 * to know how tall it is.
 *
 * `isNew` is only read when the row mounts: once an entry animation starts it
 * always runs to completion, even though the list stops reporting the row as
 * new on the very next render.
 */
export const StreamingListItem: React.FC<{
	isNew: boolean;
	className?: string;
	children: React.ReactNode;
}> = ({ isNew, className, children }) => {
	const [isEntering, setIsEntering] = useState(
		() => isNew && !prefersReducedMotion(),
	);

	// The row is clipped only while it grows; leaving `overflow-hidden` on for
	// good would crop anything the row draws outside its box later.
	useEffect(() => {
		if (!isEntering) return;
		const timer = window.setTimeout(
			() => setIsEntering(false),
			ENTRY_ANIMATION_MS * 2,
		);
		return () => window.clearTimeout(timer);
	}, [isEntering]);

	return (
		<div
			className={cn(
				"grid grid-rows-[1fr]",
				isEntering && "animate-list-item-in",
				className,
			)}
			onAnimationEnd={(event) => {
				// Collapsibles inside the row animate too; only ours ends the entry.
				if (event.target === event.currentTarget) setIsEntering(false);
			}}
		>
			<div className={cn("min-h-0", isEntering && "overflow-hidden")}>
				{children}
			</div>
		</div>
	);
};
