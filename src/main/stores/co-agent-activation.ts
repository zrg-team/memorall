import { create } from "zustand";

import {
	CO_AGENT_BROWSER_COMMAND_SOURCE,
	isCoAgentBrowserCommandResponse,
} from "@/services/co-agent/co-agent-protocol";
import { logError } from "@/utils/logger";

/**
 * Turning the co-agent on from the chat panel.
 *
 * Until now the only way in was the page's own context menu, which means the
 * user had to already be on the page — useless when the link they want to work
 * on is sitting in the conversation. The background owns the tab and the
 * session, so this is a thin request/response wrapper over that command; the
 * platform port is behind a dynamic import for the same reason the challenge
 * store does it — this is reachable from a rendered message, and a static import
 * would pull the platform tree into every test that renders one.
 */
interface CoAgentActivationStore {
	/** The URL currently being opened, so its button alone shows a spinner. */
	pendingUrl: string | null;
	isActivating: boolean;
	error: string | null;
	/** Omit `url` to attach to whichever tab the user is looking at. */
	activate: (url?: string) => Promise<boolean>;
	clearError: () => void;
}

const browserCommands = async () => {
	const { platform } = await import("@/platform/current");
	return platform.browserCommands;
};

export const useCoAgentActivationStore = create<CoAgentActivationStore>(
	(set) => ({
		pendingUrl: null,
		isActivating: false,
		error: null,
		clearError: () => set({ error: null }),
		activate: async (url) => {
			set({ isActivating: true, pendingUrl: url ?? null, error: null });
			try {
				const port = await browserCommands();
				const response = await port.request<unknown>({
					source: CO_AGENT_BROWSER_COMMAND_SOURCE,
					command: "activate",
					...(url ? { url } : {}),
				});

				if (!isCoAgentBrowserCommandResponse(response)) {
					throw new Error("The co-agent did not answer.");
				}
				if (!response.success) {
					throw new Error(response.error);
				}
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logError("Co-agent activation failed:", error);
				set({ error: message });
				return false;
			} finally {
				set({ isActivating: false, pendingUrl: null });
			}
		},
	}),
);
