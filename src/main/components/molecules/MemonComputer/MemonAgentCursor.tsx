import React from "react";
import { AgentCursorUI } from "@/components/AgentCursor";
import type { MemonCursorState } from "@/services/memon/types";

/**
 * The agent's cursor, scoped to the desktop. Uses the static AgentCursorUI
 * inside its own positioned layer; the global moveTo event targets the whole
 * app window and would clamp to it, so it is not used here.
 */
export const MemonAgentCursor: React.FC<{
	cursor: MemonCursorState | null;
	visible: boolean;
	desktopRef: React.RefObject<HTMLDivElement | null>;
	/** Re-measure when the layout under the cursor changes. */
	revision: number;
}> = ({ cursor, visible, desktopRef, revision }) => {
	const [point, setPoint] = React.useState<{ x: number; y: number } | null>(
		null,
	);

	React.useLayoutEffect(() => {
		const desktop = desktopRef.current;
		if (!desktop || !cursor?.windowId) {
			setPoint(null);
			return;
		}
		const frame = desktop.querySelector(
			`[data-memon-window="${cursor.windowId}"]`,
		);
		const target =
			(cursor.ref &&
				frame?.querySelector(`[data-memon-ref="${cursor.ref}"]`)) ||
			frame;
		if (!target) {
			setPoint(null);
			return;
		}
		const box = desktop.getBoundingClientRect();
		const rect = target.getBoundingClientRect();
		setPoint({
			x: rect.left - box.left + Math.min(rect.width / 2, 28),
			y: rect.top - box.top + Math.min(rect.height / 2, 16),
		});
	}, [cursor, desktopRef, revision]);

	if (!visible || !cursor || !point) return null;
	return (
		<div
			className="pointer-events-none absolute left-0 top-0 z-[9000] transition-transform duration-500 ease-out motion-reduce:transition-none"
			style={{ transform: `translate(${point.x}px, ${point.y}px)` }}
		>
			<AgentCursorUI message={cursor.label} />
		</div>
	);
};
