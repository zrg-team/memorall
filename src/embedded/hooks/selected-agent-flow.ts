import { logError } from "@/utils/logger";

/**
 * The agent the embedded surfaces run, shared between them and remembered.
 *
 * The co-agent dock and the chat panel each used to hold their own `useState`
 * for this, so picking an agent in one did nothing to the other — and the
 * co-agent lives in a content script, which remounts on every page load, so a
 * choice never survived a navigation. Both then fell back to "whichever agent
 * was edited most recently", which is why a deliberate pick appeared to be
 * ignored: a different agent really was answering.
 *
 * Module-level rather than React context because the two surfaces do not share
 * a tree — the dock and the panel mount separately — but do share this module.
 */

const STORAGE_KEY = "memorallEmbeddedSelectedAgentFlow";

/**
 * The built-in entry: the stock foundation agent plus the co-agent feature.
 *
 * `"chat"` is the sentinel the chat pipeline already reads as "no saved agent",
 * so this needs no special case downstream.
 */
export const CO_AGENT_DEFAULT_FLOW_ID = "chat";

type Listener = (flowId: string) => void;

let selectedFlowId = CO_AGENT_DEFAULT_FLOW_ID;
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<Listener>();

const notify = (): void => {
	for (const listener of listeners) listener(selectedFlowId);
};

export const getSelectedAgentFlowId = (): string => selectedFlowId;

/** Reads the stored choice once per page, then serves it from memory. */
export const loadSelectedAgentFlowId = async (): Promise<string> => {
	if (loaded) return selectedFlowId;
	if (!loading) {
		loading = (async () => {
			try {
				const stored = await chrome.storage.local.get(STORAGE_KEY);
				const value = stored?.[STORAGE_KEY];
				if (typeof value === "string" && value) {
					selectedFlowId = value;
					notify();
				}
			} catch (error) {
				logError("[Embedded] Failed to read the selected agent", error);
			} finally {
				loaded = true;
			}
		})();
	}
	await loading;
	return selectedFlowId;
};

export const setSelectedAgentFlowId = (flowId: string): void => {
	if (!flowId || flowId === selectedFlowId) return;
	selectedFlowId = flowId;
	// Marked loaded so an in-flight read cannot overwrite a deliberate choice.
	loaded = true;
	notify();
	void chrome.storage.local
		.set({ [STORAGE_KEY]: flowId })
		.catch((error) =>
			logError("[Embedded] Failed to save the selected agent", error),
		);
};

export const subscribeToSelectedAgentFlowId = (
	listener: Listener,
): (() => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};

/** Test seam: the module holds process-wide state. */
export const resetSelectedAgentFlowIdForTests = (): void => {
	selectedFlowId = CO_AGENT_DEFAULT_FLOW_ID;
	loaded = false;
	loading = null;
	listeners.clear();
};
