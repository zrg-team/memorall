import { SELECTED_AGENT_STORAGE_KEY } from "@/constants/selected-agent";
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
 * It is the same stored choice the main chat reads and writes, so the co-agent
 * opens on the agent last picked in chat, and a pick made in chat while a page
 * is open reaches the dock straight away.
 *
 * Module-level rather than React context because the two surfaces do not share
 * a tree — the dock and the panel mount separately — but do share this module.
 */

/** Where the embedded surfaces kept their own choice before sharing chat's. */
const LEGACY_STORAGE_KEY = "memorallEmbeddedSelectedAgentFlow";

/**
 * The built-in entry: the stock foundation agent plus the co-agent feature.
 *
 * `"chat"` is the sentinel the chat pipeline already reads as "no saved agent",
 * so this needs no special case downstream.
 */
export const CO_AGENT_DEFAULT_FLOW_ID = "chat";

export const CO_AGENT_DEFAULT_FLOW = {
	id: CO_AGENT_DEFAULT_FLOW_ID,
	name: "CoAgent",
} as const;

type Listener = (flowId: string) => void;

let selectedFlowId = CO_AGENT_DEFAULT_FLOW_ID;
let loaded = false;
let loading: Promise<void> | null = null;
let watching = false;
const listeners = new Set<Listener>();

const notify = (): void => {
	for (const listener of listeners) listener(selectedFlowId);
};

const readFlowId = (value: unknown): string | null =>
	typeof value === "string" && value ? value : null;

const onStorageChanged = (
	changes: Record<string, chrome.storage.StorageChange>,
	areaName: string,
): void => {
	if (areaName !== "local" || !(SELECTED_AGENT_STORAGE_KEY in changes)) return;
	const next = readFlowId(changes[SELECTED_AGENT_STORAGE_KEY]?.newValue);
	if (!next) return;
	// Newer than whatever a read still in flight returns.
	loaded = true;
	if (next === selectedFlowId) return;
	selectedFlowId = next;
	notify();
};

/** Follows picks made elsewhere — the main chat — while this page is open. */
const watchStoredChoice = (): void => {
	if (watching) return;
	watching = true;
	try {
		chrome.storage.onChanged?.addListener(onStorageChanged);
	} catch (error) {
		logError("[Embedded] Failed to watch the selected agent", error);
	}
};

export const getSelectedAgentFlowId = (): string => selectedFlowId;

/** Reads the stored choice once per page, then serves it from memory. */
export const loadSelectedAgentFlowId = async (): Promise<string> => {
	if (loaded) return selectedFlowId;
	if (!loading) {
		watchStoredChoice();
		loading = (async () => {
			try {
				const stored = await chrome.storage.local.get([
					SELECTED_AGENT_STORAGE_KEY,
					LEGACY_STORAGE_KEY,
				]);
				const value =
					readFlowId(stored?.[SELECTED_AGENT_STORAGE_KEY]) ??
					readFlowId(stored?.[LEGACY_STORAGE_KEY]);
				// A pick made while this read was in flight is the newer one.
				if (value && !loaded && value !== selectedFlowId) {
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
		.set({ [SELECTED_AGENT_STORAGE_KEY]: flowId })
		.catch((error) =>
			logError("[Embedded] Failed to save the selected agent", error),
		);
};

/**
 * The choice as the given list can serve it: an agent deleted since it was
 * picked falls back to the built-in entry, which is what answers instead. An
 * empty list has not loaded yet, so the choice stands.
 */
export const resolveAvailableAgentFlowId = (
	flowId: string,
	available: ReadonlyArray<{ id: string }>,
): string =>
	available.length === 0 || available.some((flow) => flow.id === flowId)
		? flowId
		: CO_AGENT_DEFAULT_FLOW_ID;

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
	if (watching) chrome.storage.onChanged?.removeListener(onStorageChanged);
	selectedFlowId = CO_AGENT_DEFAULT_FLOW_ID;
	loaded = false;
	loading = null;
	watching = false;
	listeners.clear();
};
