import type { MemonTerminalState } from "../types";

/** Whether the running command belongs to the tab in front. */
export const terminalRunsInFront = (terminal: MemonTerminalState): boolean =>
	terminal.runningCommand !== null &&
	terminal.runningTabId === terminal.activeTabId;
