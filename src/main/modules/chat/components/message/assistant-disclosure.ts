/**
 * The trigger of each fold in an assistant turn: thought, run details, the
 * workflow summary. One look and one left edge, so a turn reads as a single
 * column under the agent's name. The negative margin cancels the padding: the
 * icon lines up with the name and the message text, and the hover fill still
 * has room around it.
 */
export const ASSISTANT_DISCLOSURE_TRIGGER_CLASS =
	"-ml-1.5 inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/20 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** The leading icon of those rows, and of a step still running. */
export const ASSISTANT_DISCLOSURE_ICON_CLASS = "h-3.5 w-3.5 shrink-0";
