import { describe, expect, it, vi } from "vitest";
import { GraphBase } from "../graph/graph.base.js";
import { createNodejsSandboxFeatureStep } from "../steps/features/nodejs-sandbox-feature/nodejs-sandbox-feature.v2.js";
import { SANDBOX_WEB_APP_TOOLS } from "../tools/agent-sandbox/profiles.js";
import type { IAgentSandboxService } from "../interfaces/services/agent-sandbox.js";

describe("partial sandbox replacement", () => {
	it("retains artifact rendering without initializing replaced sandbox tools", async () => {
		const getCapabilities = vi.fn();
		const step = createNodejsSandboxFeatureStep(
			{
				sandboxRuntime: { getCapabilities } as unknown as IAgentSandboxService,
			},
			{ excludedTools: SANDBOX_WEB_APP_TOOLS },
		);
		const result = await step.execute({
			messages: [],
			tools: ["load_skill", "send_message_to_agent"],
		});
		expect(result.output.tools?.map(GraphBase.chat.getToolName)).toEqual([
			"load_skill",
			"send_message_to_agent",
			"render_artifact",
		]);
		expect(JSON.stringify(result.output.messages)).toContain(
			"ARTIFACT RENDERING",
		);
		expect(JSON.stringify(result.output.messages)).not.toContain(
			"BROWSER SANDBOX",
		);
		expect(getCapabilities).not.toHaveBeenCalled();
	});

	it("retains supported snapshots in the stateful profile and omits replaced instructions", async () => {
		const step = createNodejsSandboxFeatureStep(
			{
				sandboxRuntime: {
					getCapabilities: async () => ({
						supported: ["snapshot.capture", "snapshot.restore"],
					}),
				} as unknown as IAgentSandboxService,
			},
			{ profile: "stateful", excludedTools: SANDBOX_WEB_APP_TOOLS },
		);
		const result = await step.execute({ messages: [], tools: [] });
		expect(result.output.tools?.map(GraphBase.chat.getToolName)).toEqual([
			"sandbox_snapshot",
			"render_artifact",
		]);
		expect(JSON.stringify(result.output.messages)).toContain(
			"sandbox_snapshot",
		);
		expect(JSON.stringify(result.output.messages)).not.toContain("sandbox_run");
		expect(JSON.stringify(result.output.messages)).not.toContain(
			"sandbox_preview",
		);
	});

	it("still respects capability limits for retained tools", async () => {
		const step = createNodejsSandboxFeatureStep(
			{
				sandboxRuntime: {
					getCapabilities: async () => ({ supported: [] }),
				} as unknown as IAgentSandboxService,
			},
			{ profile: "stateful", excludedTools: SANDBOX_WEB_APP_TOOLS },
		);
		const result = await step.execute({ messages: [], tools: [] });
		expect(result.output.tools?.map(GraphBase.chat.getToolName)).toEqual([
			"render_artifact",
		]);
	});
});
