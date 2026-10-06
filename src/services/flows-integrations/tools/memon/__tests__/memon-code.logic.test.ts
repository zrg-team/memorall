import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/memon/machine-registry", () => ({
	getMemonMachine: vi.fn(),
}));

import { CONVERSATION_RUNTIME_KEY } from "@/services/chat/runtime-keys";
import { getMemonMachine } from "@/services/memon/machine-registry";
import { createMemonCodeTool } from "../memon-code";

/** The computer as memon_code uses it. */
const fakeMachine = () => ({
	home: "/agents/Bot",
	beginRun: vi.fn(),
	waitForAgentTurn: async () => "ready",
	runAgentAction: async (
		_label: string,
		_target: unknown,
		body: () => Promise<unknown>,
	) => body(),
	readScreen: () => "screen",
	snapshot: () => ({ revision: 1, focusedWindowId: null, windows: [] }),
	findWindow: () => undefined,
	piCode: { act: vi.fn(async () => "Sent to pi code.") },
});

const runtime = (vars: Record<string, unknown>) => ({
	get: (key: string) => vars[key],
	set: vi.fn(),
	has: (key: string) => key in vars,
});

describe("memon_code", () => {
	beforeEach(() => {
		vi.mocked(getMemonMachine).mockReset();
	});

	it("tells pi which chat its work is for, so the chat's cost counts it", async () => {
		const machine = fakeMachine();
		vi.mocked(getMemonMachine).mockResolvedValue(machine as never);

		await createMemonCodeTool().execute(
			{ action: "prompt", text: "Build it" },
			{
				runtime: runtime({ [CONVERSATION_RUNTIME_KEY]: "chat-1" }),
			} as never,
		);
		expect(machine.piCode.act).toHaveBeenLastCalledWith(
			{ action: "prompt", text: "Build it" },
			expect.objectContaining({ conversationId: "chat-1" }),
		);

		// A run with no saved chat books pi to no chat.
		await createMemonCodeTool().execute({ action: "prompt", text: "More" }, {
			runtime: runtime({}),
		} as never);
		expect(machine.piCode.act).toHaveBeenLastCalledWith(
			{ action: "prompt", text: "More" },
			expect.not.objectContaining({ conversationId: expect.anything() }),
		);
	});
});
