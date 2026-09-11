import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, unknown>();
const get = vi.fn(async (key: string) => {
	const value = store.get(key);
	return value === undefined ? {} : { [key]: value };
});
const set = vi.fn(async (values: Record<string, unknown>) => {
	for (const [key, value] of Object.entries(values)) store.set(key, value);
});

vi.stubGlobal("chrome", { storage: { local: { get, set } } });
vi.mock("@/utils/logger", () => ({
	logError: vi.fn(),
	logInfo: vi.fn(),
	logWarn: vi.fn(),
	logDebug: vi.fn(),
}));

import {
	CO_AGENT_DEFAULT_FLOW_ID,
	getSelectedAgentFlowId,
	loadSelectedAgentFlowId,
	resetSelectedAgentFlowIdForTests,
	setSelectedAgentFlowId,
	subscribeToSelectedAgentFlowId,
} from "../selected-agent-flow";

describe("the embedded agent selection", () => {
	beforeEach(() => {
		store.clear();
		vi.clearAllMocks();
		resetSelectedAgentFlowIdForTests();
	});

	it("starts on the built-in co-agent rather than an arbitrary saved agent", () => {
		// It used to default to whichever agent was edited most recently, which is
		// why a deliberate pick looked ignored.
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
		const pending = loadSelectedAgentFlowId();
		setSelectedAgentFlowId("agent-picked-now");

		await pending;

		expect(getSelectedAgentFlowId()).toBe("agent-picked-now");
	});

	it("reads storage once, however many surfaces ask", async () => {
		await Promise.all([
			loadSelectedAgentFlowId(),
			loadSelectedAgentFlowId(),
			loadSelectedAgentFlowId(),
		]);

		expect(get).toHaveBeenCalledTimes(1);
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
