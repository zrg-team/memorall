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

/**
 * The leading area of the main workspace header, before the mode switcher. A
 * narrow workspace portals the button that opens its side list (chats, studio
 * sessions) here, at the edge the drawer slides in from, instead of floating
 * it over the content.
 */
export const WorkspaceHeaderLeadingSlotContext =
	createContext<HTMLElement | null>(null);

export const useWorkspaceHeaderLeadingSlot = () =>
	useContext(WorkspaceHeaderLeadingSlotContext);
