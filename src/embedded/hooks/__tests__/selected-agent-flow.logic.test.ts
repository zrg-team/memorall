import { beforeEach, describe, expect, it, vi } from "vitest";

type StorageChangedListener = (
	changes: Record<string, { newValue?: unknown; oldValue?: unknown }>,
	areaName: string,
) => void;

const store = new Map<string, unknown>();
const get = vi.fn(async (keys: string | string[]) => {
	const result: Record<string, unknown> = {};
	for (const key of Array.isArray(keys) ? keys : [keys]) {
		const value = store.get(key);
		if (value !== undefined) result[key] = value;
	}
	return result;
});
const set = vi.fn(async (values: Record<string, unknown>) => {
	for (const [key, value] of Object.entries(values)) store.set(key, value);
});
const changedListeners = new Set<StorageChangedListener>();
const onChanged = {
	addListener: vi.fn((listener: StorageChangedListener) => {
		changedListeners.add(listener);
	}),
	removeListener: vi.fn((listener: StorageChangedListener) => {
		changedListeners.delete(listener);
	}),
};

/** What chrome does when another surface, such as the main chat, writes. */
const writeElsewhere = (
	key: string,
	value: unknown,
	areaName: "local" | "session" = "local",
) => {
	if (areaName === "local") store.set(key, value);
	for (const listener of changedListeners) {
		listener({ [key]: { newValue: value } }, areaName);
	}
};

vi.stubGlobal("chrome", { storage: { local: { get, set }, onChanged } });
vi.mock("@/utils/logger", () => ({
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
	logDebug: vi.fn(),
}));

import { SELECTED_AGENT_STORAGE_KEY } from "@/constants/selected-agent";
import {
	CO_AGENT_DEFAULT_FLOW_ID,
	getSelectedAgentFlowId,
	loadSelectedAgentFlowId,
	resetSelectedAgentFlowIdForTests,
	resolveAvailableAgentFlowId,
	setSelectedAgentFlowId,
	subscribeToSelectedAgentFlowId,
} from "../selected-agent-flow";

const LEGACY_STORAGE_KEY = "memorallEmbeddedSelectedAgentFlow";

describe("the embedded agent selection", () => {
	beforeEach(() => {
		resetSelectedAgentFlowIdForTests();
		store.clear();
		changedListeners.clear();
		vi.clearAllMocks();
	});

	it("starts on the built-in co-agent rather than an arbitrary saved agent", () => {
		// It used to default to whichever agent was edited most recently, which is
		// why a deliberate pick looked ignored.
		expect(getSelectedAgentFlowId()).toBe(CO_AGENT_DEFAULT_FLOW_ID);
	});

	it("opens on the agent last picked in chat", async () => {
		store.set(SELECTED_AGENT_STORAGE_KEY, "agent-from-chat");

		expect(await loadSelectedAgentFlowId()).toBe("agent-from-chat");
	});

	it("prefers the chat's pick over the one the co-agent kept on its own", async () => {
		store.set(LEGACY_STORAGE_KEY, "agent-old-co-agent-pick");
		store.set(SELECTED_AGENT_STORAGE_KEY, "agent-from-chat");

		expect(await loadSelectedAgentFlowId()).toBe("agent-from-chat");
	});

	it("keeps the co-agent's own earlier pick until chat has one", async () => {
		store.set(LEGACY_STORAGE_KEY, "agent-old-co-agent-pick");

		expect(await loadSelectedAgentFlowId()).toBe("agent-old-co-agent-pick");
	});

	it("saves a pick where the chat reads it", () => {
		setSelectedAgentFlowId("agent-vi");

		expect(set).toHaveBeenCalledWith({
			[SELECTED_AGENT_STORAGE_KEY]: "agent-vi",
		});
	});

	it("follows a pick made in chat while the page is open", async () => {
		await loadSelectedAgentFlowId();
		const dock = vi.fn();
		subscribeToSelectedAgentFlowId(dock);

		writeElsewhere(SELECTED_AGENT_STORAGE_KEY, "agent-picked-in-chat");

		expect(dock).toHaveBeenCalledWith("agent-picked-in-chat");
		expect(getSelectedAgentFlowId()).toBe("agent-picked-in-chat");
	});

	it("ignores unrelated storage changes", async () => {
		await loadSelectedAgentFlowId();
		const dock = vi.fn();
		subscribeToSelectedAgentFlowId(dock);

		writeElsewhere("some.other.key", "agent-x");
		writeElsewhere(SELECTED_AGENT_STORAGE_KEY, "agent-y", "session");
		writeElsewhere(SELECTED_AGENT_STORAGE_KEY, undefined);

		expect(dock).not.toHaveBeenCalled();
		expect(getSelectedAgentFlowId()).toBe(CO_AGENT_DEFAULT_FLOW_ID);
	});

	it("is shared: every surface sees the same choice", () => {
		const dock = vi.fn();
		const panel = vi.fn();
		subscribeToSelectedAgentFlowId(dock);
		subscribeToSelectedAgentFlowId(panel);

		setSelectedAgentFlowId("agent-vi");

		expect(dock).toHaveBeenCalledWith("agent-vi");
		expect(panel).toHaveBeenCalledWith("agent-vi");
		expect(getSelectedAgentFlowId()).toBe("agent-vi");
	});

	it("remembers the choice across a page load", async () => {
		setSelectedAgentFlowId("agent-vi");
		expect(set).toHaveBeenCalled();

		// A content script remounts on every navigation.
		resetSelectedAgentFlowIdForTests();
		expect(getSelectedAgentFlowId()).toBe(CO_AGENT_DEFAULT_FLOW_ID);

		expect(await loadSelectedAgentFlowId()).toBe("agent-vi");
	});

	it("does not let a slow read overwrite a choice made while it was in flight", async () => {
		store.set(SELECTED_AGENT_STORAGE_KEY, "agent-stored-before");
		const pending = loadSelectedAgentFlowId();
		setSelectedAgentFlowId("agent-picked-now");

		await pending;

		expect(getSelectedAgentFlowId()).toBe("agent-picked-now");
	});

	it("does not let a slow read overwrite a pick made in chat meanwhile", async () => {
		store.set(SELECTED_AGENT_STORAGE_KEY, "agent-stored-before");
		const pending = loadSelectedAgentFlowId();
		writeElsewhere(SELECTED_AGENT_STORAGE_KEY, "agent-picked-in-chat");

		await pending;

		expect(getSelectedAgentFlowId()).toBe("agent-picked-in-chat");
	});

	it("reads storage once, however many surfaces ask", async () => {
		await Promise.all([
			loadSelectedAgentFlowId(),
			loadSelectedAgentFlowId(),
			loadSelectedAgentFlowId(),
		]);

		expect(get).toHaveBeenCalledTimes(1);
		expect(onChanged.addListener).toHaveBeenCalledTimes(1);
	});

	it("keeps working when storage is unavailable", async () => {
		get.mockRejectedValueOnce(new Error("no storage"));

		await expect(loadSelectedAgentFlowId()).resolves.toBe(
			CO_AGENT_DEFAULT_FLOW_ID,
		);
	});

	it("ignores a no-op reselection", () => {
		const listener = vi.fn();
		subscribeToSelectedAgentFlowId(listener);

		setSelectedAgentFlowId(CO_AGENT_DEFAULT_FLOW_ID);

		expect(listener).not.toHaveBeenCalled();
	});

	it("stops notifying a surface that unmounted", () => {
		const listener = vi.fn();
		const unsubscribe = subscribeToSelectedAgentFlowId(listener);
		unsubscribe();

		setSelectedAgentFlowId("agent-vi");

		expect(listener).not.toHaveBeenCalled();
	});
});

describe("resolving the choice against the agent list", () => {
	const flows = [{ id: CO_AGENT_DEFAULT_FLOW_ID }, { id: "agent-vi" }];

	it("keeps an agent that is on the list", () => {
		expect(resolveAvailableAgentFlowId("agent-vi", flows)).toBe("agent-vi");
	});

	it("falls back to the built-in co-agent for an agent deleted since", () => {
		expect(resolveAvailableAgentFlowId("agent-deleted", flows)).toBe(
			CO_AGENT_DEFAULT_FLOW_ID,
		);
	});

	it("keeps the choice while the list has not loaded", () => {
		expect(resolveAvailableAgentFlowId("agent-vi", [])).toBe("agent-vi");
	});
});
