import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
	MemonMachineSnapshot,
	MemonMachineSummary,
} from "@/services/memon/types";

const machine = vi.hoisted(() => ({
	listener: null as null | ((summary: unknown) => void),
	snapshots: [] as unknown[],
	request: vi.fn(),
}));

vi.mock("@/services/memon/memon-events", () => ({
	subscribeMemonChanges: (listener: (summary: unknown) => void) => {
		machine.listener = listener;
		return () => undefined;
	},
}));
vi.mock("@/services/memon/memon-client", () => ({
	memonClient: { request: machine.request },
}));
vi.mock("@/utils/logger", () => ({ logError: vi.fn() }));

const snapshotAt = (
	revision: number,
	terminalLines: string[] = ["$ ls"],
): MemonMachineSnapshot =>
	({
		key: "agent-1",
		revision,
		terminal: { lines: terminalLines, cwd: "/home" },
		browser: { tabs: [{ id: "t1", title: "Docs" }], activeTabId: "t1" },
		windows: [],
	}) as unknown as MemonMachineSnapshot;

const summaryAt = (revision: number): MemonMachineSummary =>
	({
		key: "agent-1",
		revision,
		status: "working",
		updatedAt: revision,
	}) as unknown as MemonMachineSummary;

const loadStore = async () => {
	vi.resetModules();
	const { useMemonMachineStore } = await import("../memon-machine");
	useMemonMachineStore.getState().start();
	await vi.waitFor(() => expect(machine.listener).not.toBeNull());
	return useMemonMachineStore;
};

const flush = () => vi.advanceTimersByTimeAsync(200);

beforeEach(() => {
	vi.useFakeTimers();
	machine.listener = null;
	machine.snapshots = [];
	machine.request.mockReset();
	machine.request.mockImplementation(async (operation: string) => {
		if (operation === "machines.list") return [];
		if (operation === "snapshot.get") return machine.snapshots.shift() ?? null;
		return null;
	});
});

afterEach(() => {
	vi.useRealTimers();
	Reflect.deleteProperty(globalThis, "document");
});

const snapshotPulls = () =>
	machine.request.mock.calls.filter(
		([operation]) => operation === "snapshot.get",
	).length;

describe("memon machine store", () => {
	it("keeps summaries but pulls no snapshot while nothing shows the machine", async () => {
		const store = await loadStore();
		machine.listener?.(summaryAt(2));
		await flush();

		expect(store.getState().summaries["agent-1"]?.revision).toBe(2);
		expect(snapshotPulls()).toBe(0);
		expect(store.getState().snapshots).toEqual({});
	});

	it("pulls for a watched machine, keeping the parts that did not change", async () => {
		const store = await loadStore();
		machine.snapshots.push(snapshotAt(1));
		const release = store.getState().watch("agent-1");
		await flush();
		const first = store.getState().snapshots["agent-1"]!;
		expect(first.revision).toBe(1);

		machine.snapshots.push(snapshotAt(2, ["$ ls", "notes.md"]));
		machine.listener?.(summaryAt(2));
		await flush();

		const second = store.getState().snapshots["agent-1"]!;
		expect(second.revision).toBe(2);
		expect(second.terminal.lines).toEqual(["$ ls", "notes.md"]);
		expect(second.browser).toBe(first.browser);
		expect(second.windows).toBe(first.windows);
		release();
	});

	it("drops a snapshot older than the one shown", async () => {
		const store = await loadStore();
		machine.snapshots.push(snapshotAt(5));
		const release = store.getState().watch("agent-1");
		await flush();

		machine.snapshots.push(snapshotAt(4, ["stale"]));
		await store.getState().pull("agent-1");

		expect(store.getState().snapshots["agent-1"]?.revision).toBe(5);
		release();
	});

	it("stops pulling and frees the snapshot when the last viewer leaves", async () => {
		const store = await loadStore();
		machine.snapshots.push(snapshotAt(1));
		const releaseA = store.getState().watch("agent-1");
		const releaseB = store.getState().watch("agent-1");
		await flush();
		expect(snapshotPulls()).toBe(1);

		releaseA();
		expect(store.getState().snapshots["agent-1"]).toBeDefined();
		releaseB();
		expect(store.getState().snapshots["agent-1"]).toBeUndefined();

		machine.listener?.(summaryAt(3));
		await flush();
		expect(snapshotPulls()).toBe(1);
	});

	it("waits for a hidden page to show before pulling", async () => {
		let visibility = "visible";
		const listeners: Array<() => void> = [];
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: {
				get visibilityState() {
					return visibility;
				},
				addEventListener: (_type: string, listener: () => void) =>
					listeners.push(listener),
			},
		});
		const store = await loadStore();
		machine.snapshots.push(snapshotAt(1));
		const release = store.getState().watch("agent-1");
		await flush();

		visibility = "hidden";
		machine.snapshots.push(snapshotAt(2));
		machine.listener?.(summaryAt(2));
		await flush();
		expect(snapshotPulls()).toBe(1);

		visibility = "visible";
		for (const listener of listeners) listener();
		await flush();
		expect(snapshotPulls()).toBe(2);
		expect(store.getState().snapshots["agent-1"]?.revision).toBe(2);
		release();
	});
});
