import { createContext, useContext } from "react";

/**
 * The trailing area of the main workspace header. A workspace portals its own
 * controls (a studio's model picker, say) into it, so the panel keeps a single
 * header row instead of stacking one per page.
 */
export const WorkspaceHeaderSlotContext = createContext<HTMLElement | null>(
	null,
);

export const useWorkspaceHeaderSlot = () =>
	useContext(WorkspaceHeaderSlotContext);
