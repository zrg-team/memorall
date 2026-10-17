import { logError } from "@/utils/logger";

/**
 * Puts Files paths on the clipboard, one per line: absolute, as the chat,
 * the agent and the Terminal all take them.
 */
export const copyPathsToClipboard = (paths: readonly string[]): void => {
	if (!paths.length) return;
	void navigator.clipboard
		.writeText(paths.join("\n"))
		.catch((error) => logError("[FILES] Failed to copy the path:", error));
};
