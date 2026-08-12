import React, { useEffect, useMemo, useState } from "react";

const DEFAULT_LIMIT = 100;

export const useProgressiveItems = <T,>(
	items: T[],
	limit = DEFAULT_LIMIT,
): {
	items: T[];
	hiddenCount: number;
	renderAll: () => void;
} => {
	const [showAll, setShowAll] = useState(false);
	useEffect(() => {
		if (items.length <= limit) setShowAll(false);
	}, [items.length, limit]);
	const visibleItems = useMemo(
		() => (showAll || items.length <= limit ? items : items.slice(0, limit)),
		[items, limit, showAll],
	);
	return {
		items: visibleItems,
		hiddenCount: items.length - visibleItems.length,
		renderAll: () => setShowAll(true),
	};
};

export const ProgressiveCollectionControl: React.FC<{
	hiddenCount: number;
	onRenderAll: () => void;
}> = ({ hiddenCount, onRenderAll }) =>
	hiddenCount > 0 ? (
		<button
			type="button"
			className="w-full border-t border-border/60 px-3 py-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/30 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
			onClick={onRenderAll}
		>
			Render all {hiddenCount} remaining items
		</button>
	) : null;
