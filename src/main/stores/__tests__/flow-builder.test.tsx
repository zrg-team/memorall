import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import type { FlowBuilderState, FlowNodeData } from "../flow-builder";

const now = new Date("2026-01-01T00:00:00.000Z");

const flowBuilderService = {
	listFlows: vi.fn(),
	getCatalog: vi.fn(),
	getFlowDefinition: vi.fn(),
	createFlow: vi.fn(),
	updateFlow: vi.fn(),
	deleteFlow: vi.fn(),
	deleteFlowConnection: vi.fn(),
};

vi.mock("@/services", () => ({
	serviceManager: { flowBuilderService },
}));

vi.mock("@/main/modules/flow-builder/flow-builder-validation", () => ({
	validateFlowGraph: vi.fn(() => []),
}));

const { useFlowBuilderStore } = await import("../flow-builder");
const { validateFlowGraph } = await import(
	"@/main/modules/flow-builder/flow-builder-validation"
);

const catalog = {
	services: [],
	steps: [
		{
			id: "step-a",
			name: "Step A",
			type: "common",
			description: "A test step",
			metadata: {},
		},
		{
			id: "step-b",
			name: "Step B",
			type: "feature",
			description: "Another test step",
			metadata: {},
		},
	],
};

const baseFlow = {
	id: "flow-1",
	name: "Flow One",
	description: "Initial description",
	status: "draft",
	predefinedFlow: null,
	serviceKeys: ["llm"],
	metadata: {},
	createdAt: now,
	updatedAt: now,
};

function resetStore() {
	vi.clearAllMocks();
	flowBuilderService.getCatalog.mockReturnValue(catalog);
	flowBuilderService.listFlows.mockResolvedValue([baseFlow]);
	flowBuilderService.deleteFlow.mockResolvedValue(undefined);
	flowBuilderService.deleteFlowConnection.mockResolvedValue(undefined);
	(validateFlowGraph as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
		[],
	);
	useFlowBuilderStore.setState({
		flows: [],
		catalog: { services: [], steps: [] },
		selectedFlowId: null,
		flowName: "",
		flowDescription: "",
		flowStatus: "draft",
		serviceKeys: [],
		flowStates: [],
		nodes: [],
		edges: [],
		isLoading: false,
		isSaving: false,
		isDirty: false,
		error: null,
	} as Partial<FlowBuilderState>);
}

function getStore() {
	return useFlowBuilderStore.getState();
}

function makeNode(
	id: string,
	overrides: Partial<Omit<Node<FlowNodeData>, "data">> & {
		data?: Partial<FlowNodeData>;
	} = {},
): Node<FlowNodeData> {
	const { data: dataOverrides, ...nodeOverrides } = overrides;
	return {
		id,
		type: "flowStep",
		position: { x: 10, y: 20 },
		...nodeOverrides,
		data: {
			catalogStepId: "step-a",
			label: "Step A",
			stepType: "common",
			isStart: false,
			isEnd: false,
			...dataOverrides,
		},
	};
}

describe("useFlowBuilderStore", () => {
	beforeEach(() => {
		resetStore();
	});

	it("initializes catalog and creates a new flow with terminal nodes", async () => {
		await getStore().initialize();

		expect(getStore().flows).toEqual([baseFlow]);
		expect(getStore().catalog).toEqual(catalog);
		expect(getStore().isLoading).toBe(false);

		flowBuilderService.createFlow.mockResolvedValue({
			flow: {
				id: "flow-new",
				name: "New Flow",
				description: "",
				status: "draft",
				serviceKeys: [],
			},
			services: [],
		});

		await getStore().createFlow("New Flow");

		expect(flowBuilderService.createFlow).toHaveBeenCalledWith(
			expect.objectContaining({ name: "New Flow", status: "draft" }),
			[],
			[],
			[],
			{ nodes: [] },
		);
		expect(getStore().selectedFlowId).toBe("flow-new");
		expect(getStore().nodes.map((node) => node.id)).toEqual([
			"__start__",
			"__end__",
		]);
		expect(getStore().isSaving).toBe(false);
	});

	it("loads a saved flow definition and derives nodes, edges, services, and user states", async () => {
		useFlowBuilderStore.setState({ catalog });
		flowBuilderService.getFlowDefinition.mockResolvedValue({
			flow: baseFlow,
			states: [
				{ name: "messages", type: "array", metadata: {} },
				{ name: "custom", type: "string", metadata: { from: "test" } },
				{ name: "custom", type: "string", metadata: { duplicate: true } },
			],
			steps: [
				{
					id: "11111111-1111-4111-8111-111111111111",
					name: "Step A",
					type: "common",
					isStart: true,
					isEnd: true,
					metadata: {
						catalogStepId: "step-a",
						position: { x: 100, y: 200 },
					},
				},
			],
			connections: [],
			layout: { nodes: [] },
			services: [{ serviceKey: "database" }],
		});

		await getStore().selectFlow("flow-1");

		expect(getStore().selectedFlowId).toBe("flow-1");
		expect(getStore().serviceKeys).toEqual(["database"]);
		expect(getStore().flowStates.map((state) => state.name)).toEqual([
			"messages",
			"response",
			"custom",
		]);
		expect(getStore().nodes.map((node) => node.id)).toEqual([
			"__start__",
			"11111111-1111-4111-8111-111111111111",
			"__end__",
		]);
		expect(getStore().edges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "__start__-11111111-1111-4111-8111-111111111111",
					data: { virtual: true },
				}),
				expect.objectContaining({
					id: "11111111-1111-4111-8111-111111111111-__end__",
					data: { virtual: true },
				}),
			]),
		);
	});

	it("edits metadata, state fields, nodes, and edges without removing terminal nodes", () => {
		useFlowBuilderStore.setState({
			catalog,
			nodes: [
				makeNode("__start__", {
					type: "flowStart",
					data: { label: "Start", isStart: true, isEnd: false },
				}),
				makeNode("__end__", {
					type: "flowEnd",
					data: { label: "End", isStart: false, isEnd: true },
				}),
			],
			edges: [],
		});

		getStore().setFlowMeta({
			name: "Renamed",
			description: "Updated",
			status: "active",
			serviceKeys: ["llm"],
		});
		getStore().addStateField({ name: "custom", type: "string" });
		getStore().addStateField({ name: "messages", type: "array" });
		getStore().updateStateField("custom", { type: "object" });
		getStore().removeStateField("response");
		getStore().addNodeForStep("step-a", { x: 300, y: 400 });
		getStore().addNodeForStep("step-a", { x: 500, y: 600 });

		const stepNodes = getStore().nodes.filter(
			(node) => node.type === "flowStep",
		);
		expect(stepNodes.map((node) => node.data.label)).toEqual([
			"Step A",
			"Step A 2",
		]);
		expect(getStore().flowName).toBe("Renamed");
		expect(getStore().flowStates).toEqual([
			expect.objectContaining({ name: "custom", type: "object" }),
		]);

		const firstStepId = stepNodes[0].id;
		getStore().onConnect({
			source: "__start__",
			target: firstStepId,
			sourceHandle: null,
			targetHandle: null,
		});
		getStore().onConnect({
			source: firstStepId,
			target: "__end__",
			sourceHandle: null,
			targetHandle: null,
		});
		getStore().onConnect({
			source: "__end__",
			target: firstStepId,
			sourceHandle: null,
			targetHandle: null,
		});
		getStore().onNodesChange([{ type: "remove", id: "__start__" }]);

		expect(getStore().nodes.some((node) => node.id === "__start__")).toBe(true);
		expect(
			getStore().nodes.find((node) => node.id === firstStepId)?.data,
		).toEqual(expect.objectContaining({ isStart: true, isEnd: true }));
		expect(getStore().edges).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ id: `__start__-${firstStepId}` }),
				expect.objectContaining({ id: `${firstStepId}-__end__` }),
			]),
		);
	});

	it("saves valid graph payloads and surfaces validation errors", async () => {
		const nodeA = makeNode("temp-a", {
			data: { label: "Step A", isStart: true, isEnd: false },
		});
		const nodeB = makeNode("22222222-2222-4222-8222-222222222222", {
			data: {
				catalogStepId: "step-b",
				label: "Step B",
				stepType: "feature",
				isStart: false,
				isEnd: true,
			},
		});
		const edge: Edge = {
			id: "temp-a-22222222-2222-4222-8222-222222222222",
			source: "temp-a",
			target: "22222222-2222-4222-8222-222222222222",
			data: { condition: "ok" },
		};

		useFlowBuilderStore.setState({
			selectedFlowId: "flow-1",
			flowName: "Saved",
			flowDescription: "Description",
			flowStatus: "active",
			serviceKeys: ["llm"],
			flowStates: [
				{ name: "messages", type: "array" },
				{ name: "custom", type: "string" },
			],
			catalog,
			nodes: [nodeA, nodeB],
			edges: [edge],
		});
		flowBuilderService.updateFlow.mockResolvedValue({
			flow: { ...baseFlow, name: "Saved" },
			steps: [
				{
					id: "33333333-3333-4333-8333-333333333333",
					name: "Step A",
					type: "common",
					isStart: true,
					isEnd: false,
					metadata: {
						catalogStepId: "step-a",
						position: { x: 10, y: 20 },
					},
				},
			],
			connections: [],
		});

		await getStore().saveFlow();

		expect(flowBuilderService.updateFlow).toHaveBeenCalledWith(
			"flow-1",
			expect.objectContaining({
				name: "Saved",
				status: "active",
				serviceKeys: ["llm"],
			}),
			[expect.objectContaining({ name: "custom" })],
			expect.arrayContaining([
				expect.objectContaining({ catalogStepId: "step-a" }),
				expect.objectContaining({ catalogStepId: "step-b" }),
			]),
			expect.arrayContaining([
				expect.objectContaining({ metadata: { condition: "ok" } }),
			]),
			expect.objectContaining({ nodes: expect.any(Array) }),
		);
		expect(getStore().isSaving).toBe(false);

		(validateFlowGraph as unknown as ReturnType<typeof vi.fn>).mockReturnValue([
			{ severity: "error", message: "Invalid graph" },
		]);
		await getStore().saveFlow();
		expect(getStore().error).toBe("Invalid graph");
	});

	it("deletes flows and removes persisted connections when edges are removed", async () => {
		const edge: Edge = {
			id: "11111111-1111-4111-8111-111111111111-22222222-2222-4222-8222-222222222222",
			source: "11111111-1111-4111-8111-111111111111",
			target: "22222222-2222-4222-8222-222222222222",
			data: {},
		};

		useFlowBuilderStore.setState({
			flows: [baseFlow, { ...baseFlow, id: "flow-2", name: "Flow Two" }],
			selectedFlowId: "flow-1",
			flowName: "Flow One",
			nodes: [
				makeNode("11111111-1111-4111-8111-111111111111"),
				makeNode("22222222-2222-4222-8222-222222222222"),
			],
			edges: [edge],
		});

		getStore().onEdgesChange([{ type: "remove", id: edge.id }]);
		await Promise.resolve();

		expect(flowBuilderService.deleteFlowConnection).toHaveBeenCalledWith(
			"flow-1",
			edge.source,
			edge.target,
		);

		await getStore().deleteFlow("flow-1");

		expect(flowBuilderService.deleteFlow).toHaveBeenCalledWith("flow-1");
		expect(getStore().selectedFlowId).toBe("flow-2");
		expect(getStore().flowName).toBe("");
	});
});
