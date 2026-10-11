import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/memon/machine-registry", () => ({
	getMemonMachine: vi.fn(),
}));

import { getMemonMachine } from "@/services/memon/machine-registry";
import type { MemonTask } from "@/services/memon/types";
import { createMemonTasksTool } from "../memon-tasks";

const task = (
	id: number,
	state: MemonTask["state"],
	updatedAt: number,
	checklist: string[] = [],
): MemonTask => ({
	id,
	title: `Task ${id}`,
	state,
	checklist: checklist.map((text) => ({ text, done: false })),
	createdBy: "agent",
	createdAt: 0,
	updatedAt,
});

/** The computer as the Tasks tool uses it. */
const fakeMachine = (items: MemonTask[]) => {
	const byId = (id: number) => {
		const found = items.find((item) => item.id === id);
		if (!found) throw new Error(`Tasks has no task #${id}.`);
		return found;
	};
	return {
		beginRun: vi.fn(),
		waitForAgentTurn: async () => "ready",
		runAgentAction: async (
			_label: string,
			_target: unknown,
			body: () => Promise<unknown>,
		) => body(),
		readScreen: () => "screen",
		snapshot: () => ({
			revision: 1,
			focusedWindowId: null,
			windows: [],
			tasks: { items },
		}),
		findWindow: () => undefined,
		taskById: vi.fn(byId),
		checkTaskItem: vi.fn((id: number, item: number, done: boolean) => {
			const found = byId(id);
			found.checklist[item - 1].done = done;
			return { task: found, text: found.checklist[item - 1].text };
		}),
		setTaskState: vi.fn((id: number, state: MemonTask["state"]) => {
			const found = byId(id);
			found.state = state;
			return found;
		}),
	};
};

const run = async (
	machine: ReturnType<typeof fakeMachine>,
	input: Parameters<ReturnType<typeof createMemonTasksTool>["execute"]>[0],
) => {
	vi.mocked(getMemonMachine).mockResolvedValue(machine as never);
	const result = (await createMemonTasksTool().execute(input, undefined)) as {
		content: unknown;
		isError?: boolean;
	};
	return {
		text: typeof result.content === "string" ? result.content : "",
		isError: result.isError,
	};
};

describe("memon_tasks without a task number", () => {
	beforeEach(() => {
		vi.mocked(getMemonMachine).mockReset();
	});

	it("ticks an item of the task in progress changed last, the screen's now", async () => {
		const machine = fakeMachine([
			task(2, "in_progress", 100, ["Old step"]),
			task(3, "in_progress", 200, ["Read", "Write", "Check"]),
		]);
		const { text, isError } = await run(machine, { action: "check", item: 3 });
		expect(isError).toBeFalsy();
		expect(machine.checkTaskItem).toHaveBeenCalledWith(3, 3, true);
		expect(text).toContain('Ticked "Check" of task #3 (1/3).');
	});

	it("names the open tasks when start or drop leaves the number out", async () => {
		const machine = fakeMachine([
			task(3, "in_progress", 200),
			task(4, "approved", 100),
		]);
		const { text, isError } = await run(machine, { action: "start" });
		expect(isError).toBe(true);
		expect(text).toContain(
			"start needs `task`, the task's number. Open tasks: #3 Task 3 (in progress); #4 Task 4 (approved).",
		);
		expect(machine.setTaskState).not.toHaveBeenCalled();
	});

	it("shows the checklist when check leaves the item out", async () => {
		const machine = fakeMachine([
			task(3, "in_progress", 200, ["Read", "Write"]),
		]);
		const { text, isError } = await run(machine, { action: "check" });
		expect(isError).toBe(true);
		expect(text).toContain(
			"check needs `item`, the item's number in task #3:\n1. [ ] Read\n2. [ ] Write",
		);
	});
});
