import { afterEach, describe, expect, it, vi } from "vitest";
import type { MemonPorts, MemonScheduleInput } from "../memon-machine";

vi.mock("../ports", () => ({
	createMemonPorts: (): MemonPorts => ({
		browser: {
			availability: () => ({ available: true }),
			open: vi.fn(),
			navigate: vi.fn(),
			outline: vi.fn(),
			act: vi.fn(),
			history: vi.fn(),
			focus: vi.fn(),
			close: vi.fn(async () => undefined),
			reserve: vi.fn(() => vi.fn()),
		},
		files: {
			availability: () => ({ available: true }),
			list: vi.fn(async () => []),
			read: vi.fn(async () => ""),
			write: vi.fn(async () => undefined),
			isDirectory: vi.fn(async () => true),
			exists: vi.fn(async () => false),
			move: vi.fn(async () => undefined),
			copy: vi.fn(async () => undefined),
			subscribe: vi.fn(() => () => undefined),
			zip: vi.fn(),
			preview: vi.fn(async () => ({ text: "" })),
		},
		terminal: {
			availability: async () => ({ available: true }),
			run: vi.fn(),
			read: vi.fn(),
			input: vi.fn(),
			stop: vi.fn(),
		},
		scheduler: {
			list: vi.fn(async () => ({ items: [] })),
			save: vi.fn(async (_agentId: string, input: MemonScheduleInput) => ({
				...input,
				id: "job-1",
			})),
			remove: vi.fn(async () => undefined),
		},
		studio: {
			tools: vi.fn(async () => []),
			run: vi.fn(),
		},
		skills: {
			list: vi.fn(async () => ({ items: [] })),
			read: vi.fn(),
			setEnabled: vi.fn(),
			save: vi.fn(),
			remove: vi.fn(),
		},
		connections: {
			list: vi.fn(async () => ({ unlocked: true, items: [] })),
			setGranted: vi.fn(),
			refresh: vi.fn(),
		},
	}),
}));

import { DEFAULT_MEMON_FEATURE_CONFIG } from "../feature-config";
import {
	disposeMemonMachine,
	findMemonMachine,
	listMemonMachines,
} from "../machine-registry";
import { runMemonOperation } from "../operations";

describe("runMemonOperation machine lifecycle", () => {
	afterEach(async () => {
		for (const machine of listMemonMachines()) {
			await disposeMemonMachine(machine.key);
		}
	});

	it("starts a computer with the agent's apps for the user to drive", async () => {
		const snapshot = await runMemonOperation({
			operation: "machine.start",
			payload: {
				key: "conversation-1",
				config: {
					...DEFAULT_MEMON_FEATURE_CONFIG,
					apps: {
						browser: false,
						files: true,
						terminal: true,
						notes: true,
						visualize: false,
					},
				},
			},
		});

		expect(snapshot).toMatchObject({ key: "conversation-1", status: "idle" });
		expect(findMemonMachine("conversation-1")?.snapshot().apps).toContainEqual(
			expect.objectContaining({ id: "browser", enabled: false }),
		);
	});

	it("tells the agent about uploads and runs the user's studio tool", async () => {
		await runMemonOperation({
			operation: "machine.start",
			payload: { key: "agent-1" },
		});
		const machine = findMemonMachine("agent-1");
		if (!machine) throw new Error("no machine");
		const runStudio = vi
			.spyOn(machine, "runStudio")
			.mockResolvedValue({} as never);

		await runMemonOperation({
			operation: "files.uploaded",
			payload: { key: "agent-1", paths: ["/notes/talk.mp3"] },
		});
		await runMemonOperation({
			operation: "studio.run",
			payload: {
				key: "agent-1",
				request: { tool: "transcribe", path: "/notes/talk.mp3" },
			},
		});

		expect(runStudio).toHaveBeenCalledWith({
			tool: "transcribe",
			path: "/notes/talk.mp3",
		});
		const screen = machine.readScreen();
		expect(screen).toContain("- uploaded talk.mp3 (/notes/talk.mp3)");
		expect(screen).toContain("- ran transcribe in Studio");
		// Answering what the agent started does not take the computer over.
		expect(machine.currentDriver).toBe("agent");
	});

	it("shuts a computer down", async () => {
		await runMemonOperation({
			operation: "machine.start",
			payload: { key: "conversation-1" },
		});

		await runMemonOperation({
			operation: "machine.stop",
			payload: { key: "conversation-1" },
		});

		expect(findMemonMachine("conversation-1")).toBeUndefined();
	});

	it("tells the agent when the user ticks a step in Notes", async () => {
		await runMemonOperation({
			operation: "machine.start",
			payload: { key: "conversation-1" },
		});
		findMemonMachine("conversation-1")?.setNotes(["Search", "Summarize"]);

		await runMemonOperation({
			operation: "notes.toggle",
			payload: { key: "conversation-1", step: 1 },
		});

		const machine = findMemonMachine("conversation-1");
		expect(machine?.snapshot().notes.items[0].status).toBe("done");
		expect(machine?.readScreen()).toContain(
			'- ticked step 1 "Search" in Notes',
		);
	});

	it("runs the user's use of an app control and tells the agent what it led to", async () => {
		await runMemonOperation({
			operation: "machine.start",
			payload: { key: "conversation-1" },
		});
		const machine = findMemonMachine("conversation-1");
		machine?.openWindow("notes");

		await runMemonOperation({
			operation: "app.action",
			payload: {
				key: "conversation-1",
				app: "notes",
				id: "new",
				value: "Check prices",
			},
		});
		// Typing alone is not news to the agent.
		expect(machine?.readScreen()).not.toContain("user changes");
		await runMemonOperation({
			operation: "app.action",
			payload: { key: "conversation-1", app: "notes", id: "add" },
		});

		expect(machine?.snapshot().notes.items.map((item) => item.text)).toEqual([
			"Check prices",
		]);
		expect(machine?.snapshot().drafts["notes:new"]).toBeUndefined();
		expect(machine?.readScreen()).toContain(
			'- added step "Check prices" to Notes',
		);
	});

	it("starts a computer for an agent and logs schedule edits for it", async () => {
		await runMemonOperation({
			operation: "machine.start",
			payload: { key: "conversation-1", agentId: "agent-1" },
		});

		await runMemonOperation({
			operation: "scheduler.save",
			payload: {
				key: "conversation-1",
				schedule: {
					name: "Weekly report",
					prompt: "Write the weekly report",
					scheduleExpression: "0 17 * * 5",
					status: "active",
				},
			},
		});

		const machine = findMemonMachine("conversation-1");
		expect(machine?.snapshot().scheduler.agentId).toBe("agent-1");
		expect(machine?.readScreen()).toContain(
			'- created schedule "Weekly report" (0 17 * * 5, active) in the Scheduler',
		);
	});

	it("refuses to shut down while the agent is acting", async () => {
		await runMemonOperation({
			operation: "machine.start",
			payload: { key: "conversation-1" },
		});
		const machine = findMemonMachine("conversation-1");
		let finish: () => void = () => undefined;
		const acting = machine?.runAgentAction(
			"reading",
			{},
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);

		await expect(
			runMemonOperation({
				operation: "machine.stop",
				payload: { key: "conversation-1" },
			}),
		).rejects.toThrow(/Pause or take over first/);
		expect(findMemonMachine("conversation-1")).toBe(machine);

		finish();
		await acting;
	});
});
