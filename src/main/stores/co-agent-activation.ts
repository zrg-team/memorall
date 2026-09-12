import { useEffect } from "react";
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
	/** null until the platform has been asked; see `useCoAgentAvailable`. */
	available: boolean | null;
	resolveAvailability: () => void;
	/**
	 * Whether the next turn should hand the model the co-agent's tools.
	 *
	 * Attaching to a window is not the same as arming the agent: the tools are
	 * added to the flow only while this is on, so an ordinary question in the
	 * same conversation does not come with page-driving powers attached.
	 */
	isActive: boolean;
	setActive: (active: boolean) => void;
}

const browserCommands = async () => {
	const { platform } = await import("@/platform/current");
	return platform.browserCommands;
};

const capabilities = async () => {
	const { platform } = await import("@/platform/current");
	return platform.capabilities;
};

let resolvingAvailability = false;

export const useCoAgentActivationStore = create<CoAgentActivationStore>(
	(set) => ({
		pendingUrl: null,
		isActivating: false,
		error: null,
		available: null,
		isActive: false,
		setActive: (isActive) => set({ isActive }),
		clearError: () => set({ error: null }),
		resolveAvailability: () => {
			if (resolvingAvailability) return;
			resolvingAvailability = true;
			void capabilities()
				.then((registry) => {
					set({ available: registry.get("co-agent").available });
				})
				.catch((error) => {
					logError("Could not read co-agent availability:", error);
					set({ available: false });
				});
		},
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
				set({ isActive: true });
				return true;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logError("Co-agent activation failed:", error);
				set({ error: message, isActive: false });
				return false;
			} finally {
				set({ isActivating: false, pendingUrl: null });
			}
		},
	}),
);

/**
 * A co-agent activation failure, worded for a person.
 *
 * The desktop sidecar prefixes its errors with a machine code
 * (`BROWSER_LAUNCH_FAILED: The bundled browser could not start`). The code is
 * for logs and for the port's own branching; shown to a person it is noise in
 * front of the one sentence they need.
 */
export const formatCoAgentError = (error: string | null): string | null => {
	if (!error) return null;
	const readable = error.replace(/^[A-Z][A-Z0-9_]+:\s*/, "").trim();
	return readable || error;
};

/** The current activation failure, ready to show. Null when there is none. */
export const useCoAgentActivationError = (): string | null =>
	useCoAgentActivationStore((state) => formatCoAgentError(state.error));

/**
 * Whether the co-agent is usable on this platform.
 *
 * Resolved through the store's existing dynamic import rather than a static
 * `@/platform/current` one: these controls render inside chat messages, and a
 * static import would drag the whole platform tree into every test that renders
 * a message. Undecided reads as unavailable, so a control never appears and then
 * fails when clicked.
 */
export const useCoAgentAvailable = (): boolean => {
	const available = useCoAgentActivationStore((state) => state.available);
	const resolveAvailability = useCoAgentActivationStore(
		(state) => state.resolveAvailability,
	);
	useEffect(() => {
		if (available === null) resolveAvailability();
	}, [available, resolveAvailability]);
	return available === true;
};

/** Whether the co-agent's tools should be added to the next turn. */
export const useCoAgentActive = (): boolean =>
	useCoAgentActivationStore((state) => state.isActive);
