import "@memorall/agent-harness-flows";
import "@/services/flows-integrations/steps/features/memon-feature";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	getFlowRuntimeVars,
	withFlowRuntimeVars,
} from "@memorall/agent-harness-flows/context/runtime-context";
import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import type { AllServices } from "@memorall/agent-harness-flows/interfaces/services/services";
import { graphRegistry } from "@memorall/agent-harness-flows/registries/graph-registry";
import { createMultiAgentFeatureStep } from "@memorall/agent-harness-flows/steps/features/multi-agent-feature/multi-agent-feature";
import { createSendMessageToAgentTool } from "@memorall/agent-harness-flows/tools/send-message-to-agent";
import type { SendMessageToAgentToolConfig } from "@memorall/agent-harness-flows/interfaces/tools/multi-agent";
import type { FlowBuilderService } from "@/services/flow-builder-service";
import { withResolvedConnections } from "@/services/mcp-connections";
import { createMemorallFlowCatalog } from "../flow-catalog";

vi.mock("@/services/mcp-connections", () => ({
	withResolvedConnections: vi.fn(async (config: UnifiedFlowConfig) => config),
}));

const childConfig: UnifiedFlowConfig = {
	graphType: "foundation",
	steps: [
		{ id: "web", name: "web-feature", enabled: true },
		{ id: "sandbox", name: "nodejs-sandbox-feature", enabled: true },
		{ id: "memon", name: "memon-feature", enabled: true },
		{
			id: "multi",
			name: "multi-agent-feature",
			enabled: true,
			config: { accessibleAgentIds: ["grandchild"] },
		},
		{
			id: "mcp",
			name: "mcp-feature",
			enabled: true,
			config: { connections: [{ connectionId: "github" }] },
		},
		{ id: "completion", name: "agent-completion", enabled: true },
	],
};

const makeCatalog = () => {
	const service = {
		listPredefinedFlows: vi.fn(async () => [
			{
				id: "child",
				name: "Researcher",
				description: "Research a focused question",
			},
			{ id: "unselected", name: "Writer", description: null },
		]),
		getUnifiedFlowConfig: vi.fn(async () => childConfig),
	};
	const catalog = createMemorallFlowCatalog(
		service as unknown as Pick<
			FlowBuilderService,
			"listPredefinedFlows" | "getUnifiedFlowConfig"
		>,
	);
	return { catalog, service };
};

describe("saved-agent catalog", () => {
	afterEach(() => vi.restoreAllMocks());

	it("lists saved foundation agents and resolves their native apps and connections", async () => {
		const { catalog, service } = makeCatalog();
		await expect(catalog.listFlows("foundation")).resolves.toHaveLength(2);
		expect(service.listPredefinedFlows).toHaveBeenCalledWith("foundation");
		await expect(catalog.listFlows("unknown")).resolves.toEqual([]);
		const config = await catalog.getFlowConfig({ flowId: "child" });
		expect(service.getUnifiedFlowConfig).toHaveBeenCalledWith({
			flowId: "child",
		});
		expect(withResolvedConnections).toHaveBeenCalledWith(config);
		expect(config.steps.find(({ id }) => id === "web")?.enabled).toBe(false);
		expect(config.steps.find(({ id }) => id === "sandbox")).toMatchObject({
			enabled: true,
			config: { excludedTools: expect.arrayContaining(["sandbox_run"]) },
		});
		expect(config.steps.find(({ id }) => id === "mcp")).toEqual(
			childConfig.steps[4],
		);
		expect(childConfig.steps[0].enabled).toBe(true);
	});

	it("exposes messaging for selected agents and runs the child in its own cancellable context", async () => {
		const { catalog } = makeCatalog();
		const services = { flowCatalog: catalog } as AllServices;
		const signal = new AbortController().signal;
		const parent = withFlowRuntimeVars(
			{ signal },
			{
				"agent.flow.id": "parent",
				"conversation.id": "chat-1",
				"run.id": "run-1",
				"thread.history.conversationId": "chat-1",
				"thread.history.separatorId": "split-1",
				"memon.home": "/agents/Parent",
				"memon.config": { piCode: false },
				__flowRunInbox: { take: vi.fn() },
			},
		);
		const childInputs: unknown[] = [];
		const stream = vi.fn(async function* (input: unknown, options: unknown) {
			childInputs.push(structuredClone(input));
			const runtime = getFlowRuntimeVars(
				options as Parameters<typeof getFlowRuntimeVars>[0],
			);
			expect(runtime?.get("agent.flow.id")).toBe("child");
			expect(runtime?.get("conversation.id")).toBe("chat-1:agent:child");
			expect(runtime?.get("thread.history.conversationId")).toBe("chat-1");
			expect(runtime?.get("thread.history.separatorId")).toBe("split-1");
			expect(runtime?.has("memon.home")).toBe(false);
			expect(runtime?.has("memon.config")).toBe(false);
			expect(runtime?.has("__flowRunInbox")).toBe(false);
			expect((options as { signal: AbortSignal }).signal).toBe(signal);
			yield ["values", { response: "Research complete" }];
		});
		const createGraph = vi
			.spyOn(graphRegistry, "createChatGraph")
			.mockReturnValue({
				getInitialState: (input: unknown) => input,
				graph: { stream },
			} as never);
		const feature = createMultiAgentFeatureStep(services, {
			accessibleAgentIds: ["child"],
		});
		const result = await feature.execute(
			{ messages: [], tools: ["load_skill"], topicId: "topic-1" },
			parent,
		);
		const binding = result.output.tools?.find(
			(tool) =>
				typeof tool !== "string" && tool.name === "send_message_to_agent",
		);
		expect(binding).toBeDefined();
		expect(result.output.tools).toContain("load_skill");
		expect(JSON.stringify(result.output.messages)).toContain("Researcher");
		expect(JSON.stringify(result.output.messages)).not.toContain("Writer");
		const tool = createSendMessageToAgentTool(
			undefined,
			(binding as { config: SendMessageToAgentToolConfig }).config,
		);
		await expect(
			tool.execute({ agentId: "child", message: "Research the release" }),
		).resolves.toBe("Research complete");
		await expect(
			tool.execute({ agentId: "child", message: "Check the sources" }),
		).resolves.toBe("Research complete");
		await expect(
			tool.execute({ agentId: "unselected", message: "Do this too" }),
		).rejects.toThrow("not in the selected child-agent list");
		expect(createGraph).toHaveBeenCalledWith(
			"foundation",
			services,
			expect.objectContaining({
				steps: expect.arrayContaining([
					expect.objectContaining({
						name: "multi-agent-feature",
						enabled: false,
					}),
					expect.objectContaining({ name: "mcp-feature", enabled: true }),
				]),
			}),
			undefined,
		);
		expect(childInputs[1]).toMatchObject({
			messages: [{ role: "user" }, { role: "assistant" }, { role: "user" }],
			topicId: "topic-1",
		});
		expect(getFlowRuntimeVars(parent)?.get("agent.flow.id")).toBe("parent");
		expect(getFlowRuntimeVars(parent)?.get("memon.home")).toBe(
			"/agents/Parent",
		);
	});
});
