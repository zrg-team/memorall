import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import { describe, expect, it, vi } from "vitest";
import {
	applySettingsToRunningComputer,
	type MemonRequester,
} from "../agent-settings-sync";
import { MEMON_STEP_NAME } from "../constants";

const flow = (memon: boolean): UnifiedFlowConfig =>
	({
		graphType: "foundation",
		steps: [
			{
				id: "memon",
				name: MEMON_STEP_NAME,
				enabled: memon,
				config: { piCode: false },
			},
			{ id: "fs", name: "fs-feature", enabled: true, config: {} },
		],
	}) as UnifiedFlowConfig;

const client = (running: string[]) => {
	const request = vi.fn(async (operation: string) =>
		operation === "machines.list"
			? running.map((key) => ({ key }))
			: { key: running[0] },
	);
	return { request, requester: { request } as unknown as MemonRequester };
};

describe("applySettingsToRunningComputer", () => {
	it("gives the agent's running computer the saved settings at once", async () => {
		const { request, requester } = client(["agent-1"]);
		expect(
			await applySettingsToRunningComputer("agent-1", flow(true), requester),
		).toBe(true);
		expect(request).toHaveBeenLastCalledWith("machine.start", {
			key: "agent-1",
			agentId: "agent-1",
			config: expect.objectContaining({
				piCode: false,
				apps: expect.objectContaining({ files: true, browser: false }),
			}),
		});
	});

	it("starts nothing when the agent has no computer running, or no MemonOS Bot", async () => {
		const idle = client(["agent-2"]);
		expect(
			await applySettingsToRunningComputer(
				"agent-1",
				flow(true),
				idle.requester,
			),
		).toBe(false);
		expect(idle.request).toHaveBeenCalledTimes(1);

		const off = client(["agent-1"]);
		expect(
			await applySettingsToRunningComputer(
				"agent-1",
				flow(false),
				off.requester,
			),
		).toBe(false);
		expect(off.request).not.toHaveBeenCalled();
	});
});
