import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UnifiedFlowConfig } from "@/services/flows-legacy/interfaces/config/flow-config";
import type {
	Flow,
	FlowConfig,
	FlowConnection,
	FlowService,
	FlowState,
	FlowStep,
} from "@/services/flows-legacy/interfaces/config/flow-builder";

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ op: "and", conditions })),
	desc: vi.fn((column: unknown) => ({ direction: "desc", column })),
	eq: vi.fn((column: unknown, value: unknown) => ({ op: "eq", column, value })),
}));

vi.mock("@/services/flows-legacy/utils/logger", () => ({
	logError: vi.fn(),
	logInfo: vi.fn(),
}));

vi.mock("@/services/flow-builder-catalog", () => ({
	getFeatureCatalogSteps: vi.fn(() => [
		{ id: "feature-a", name: "feature-a", type: "feature", metadata: {} },
		{ id: "feature-b", name: "feature-b", type: "feature", metadata: {} },
	]),
	getFlowCatalog: vi.fn(() => ({
		services: [
			{
				id: "service-llm",
				name: "LLM",
				type: "llm",
				serviceKey: "llm",
				metadata: { icon: "sparkles" },
			},
			{
				id: "service-embeddings",
				name: "Embeddings",
				type: "embedding",
				serviceKey: "embeddings",
				metadata: {},
			},
		],
		steps: [
			{ id: "step-a", name: "add-system", type: "common", metadata: {} },
			{ id: "feature-a", name: "feature-a", type: "feature", metadata: {} },
		],
	})),
}));

vi.mock("@/services/flows-legacy/utils/flow-config", () => ({
	buildDefaultFlowConfig: vi.fn(
		(graphType = "foundation"): UnifiedFlowConfig => ({
			graphType,
			steps: [{ id: "system", name: "add-system", enabled: true }],
		}),
	),
	mergeWithDefaultConfig: vi.fn(
		(config: Partial<UnifiedFlowConfig>, graphType = "foundation") => ({
			graphType,
			steps: [{ id: "system", name: "add-system", enabled: true }],
			...config,
		}),
	),
}));

import { FlowBuilderService } from "../flow-builder-service";

const now = new Date("2026-01-01T00:00:00.000Z");

const schema = {
	flows: {
		id: "flows.id",
		predefinedFlow: "flows.predefinedFlow",
		updatedAt: "flows.updatedAt",
	},
	flowStates: { flowId: "flowStates.flowId" },
	flowServices: { flowId: "flowServices.flowId" },
	flowSteps: {
		id: "flowSteps.id",
		flowId: "flowSteps.flowId",
		name: "flowSteps.name",
		type: "flowSteps.type",
		metadata: "flowSteps.metadata",
	},
	flowConnections: {
		flowId: "flowConnections.flowId",
		sourceStepId: "flowConnections.sourceStepId",
		targetStepId: "flowConnections.targetStepId",
	},
	flowConfigs: {
		id: "flowConfigs.id",
		flowId: "flowConfigs.flowId",
		name: "flowConfigs.name",
		type: "flowConfigs.type",
		value: "flowConfigs.value",
	},
};

const flow = (overrides: Partial<Flow> = {}): Flow => ({
	id: "flow-1",
	name: "Flow",
	description: null,
	status: "draft",
	predefinedFlow: null,
	serviceKeys: [],
	metadata: {},
	createdAt: now,
	updatedAt: now,
	...overrides,
});

const flowState = (overrides: Partial<FlowState> = {}): FlowState => ({
	id: "state-1",
	flowId: "flow-1",
	name: "messages",
	type: "array",
	metadata: {},
	createdAt: now,
	updatedAt: now,
	...overrides,
});

const flowStep = (overrides: Partial<FlowStep> = {}): FlowStep => ({
	id: "step-1",
	flowId: "flow-1",
	name: "add-system",
	type: "common",
	isStart: false,
	isEnd: false,
	metadata: {},
	createdAt: now,
	updatedAt: now,
	...overrides,
});

const flowConnection = (
	overrides: Partial<FlowConnection> = {},
): FlowConnection => ({
	id: "conn-1",
	flowId: "flow-1",
	sourceStepId: "step-1",
	targetStepId: "step-2",
	metadata: {},
	createdAt: now,
	updatedAt: now,
	...overrides,
});

const flowService = (overrides: Partial<FlowService> = {}): FlowService => ({
	id: "service-1",
	flowId: "flow-1",
	name: "LLM",
	type: "llm",
	serviceKey: "llm",
	metadata: {},
	createdAt: now,
	updatedAt: now,
	...overrides,
});

const flowConfig = (overrides: Partial<FlowConfig> = {}): FlowConfig => ({
	id: "config-1",
	flowId: "flow-1",
	name: "systemPrompt",
	value: "Prompt",
	type: "string",
	createdAt: now,
	updatedAt: now,
	...overrides,
});

const createHarness = () => {
	const selectQueue: unknown[][] = [];
	const insertBatches: Array<{ table: unknown; value: unknown }> = [];
	const updates: Array<{ table: unknown; value: unknown }> = [];
	const deletes: unknown[] = [];
	const updateReturnQueue: unknown[][] = [];

	const nextSelect = () => selectQueue.shift() ?? [];

	const query = (resolveValue: () => unknown[] = nextSelect) => {
		const q: Record<string, unknown> = {
			from: vi.fn(() => q),
			where: vi.fn(() => q),
			orderBy: vi.fn(() => q),
			limit: vi.fn(() => Promise.resolve(resolveValue())),
			returning: vi.fn(() => Promise.resolve(resolveValue())),
			then: (
				resolve: (value: unknown[]) => unknown,
				reject: (reason: unknown) => unknown,
			) => Promise.resolve(resolveValue()).then(resolve, reject),
			catch: (reject: (reason: unknown) => unknown) =>
				Promise.resolve(resolveValue()).catch(reject),
		};
		return q;
	};

	const createInsertedRows = (table: unknown, value: unknown) => {
		const values = Array.isArray(value) ? value : [value];
		if (table === schema.flows) {
			return values.map((item, index) =>
				flow({
					id:
						(item as { predefinedFlow?: string }).predefinedFlow ===
						"foundation"
							? "foundation-flow"
							: `flow-${insertBatches.length}-${index}`,
					name: (item as { name?: string }).name ?? "Flow",
					description: (item as { description?: string }).description ?? null,
					status: (item as { status?: string }).status ?? "draft",
					predefinedFlow:
						(item as { predefinedFlow?: string }).predefinedFlow ?? null,
					serviceKeys: (item as { serviceKeys?: string[] }).serviceKeys ?? [],
					metadata:
						(item as { metadata?: Record<string, unknown> }).metadata ?? {},
				}),
			);
		}
		if (table === schema.flowServices) {
			return values.map((item, index) =>
				flowService({ id: `service-${index}`, ...(item as object) }),
			);
		}
		if (table === schema.flowStates) {
			return values.map((item, index) =>
				flowState({ id: `state-${index}`, ...(item as object) }),
			);
		}
		if (table === schema.flowSteps) {
			return values.map((item, index) =>
				flowStep({
					...(item as object),
					id: (item as { id?: string }).id ?? `created-step-${index}`,
				}),
			);
		}
		if (table === schema.flowConnections) {
			return values.map((item, index) =>
				flowConnection({ id: `conn-${index}`, ...(item as object) }),
			);
		}
		if (table === schema.flowConfigs) {
			return values.map((item, index) =>
				flowConfig({ id: `config-${index}`, ...(item as object) }),
			);
		}
		return values;
	};

	const db = {
		select: vi.fn(() => query()),
		insert: vi.fn((table: unknown) => ({
			values: vi.fn((value: unknown) => {
				insertBatches.push({ table, value });
				const inserted = createInsertedRows(table, value);
				return query(() => inserted);
			}),
		})),
		update: vi.fn((table: unknown) => {
			const q = query(() => []);
			q.set = vi.fn((value: unknown) => {
				updates.push({ table, value });
				return q;
			});
			q.returning = vi.fn(() =>
				Promise.resolve(updateReturnQueue.shift() ?? [flow({ id: "flow-1" })]),
			);
			return q;
		}),
		delete: vi.fn((table: unknown) => {
			deletes.push(table);
			return query(() => []);
		}),
	};

	const databaseService = {
		use: vi.fn(
			async (
				callback: (ctx: {
					db: typeof db;
					schema: typeof schema;
				}) => Promise<unknown> | unknown,
			) => callback({ db, schema }),
		),
		transaction: vi.fn(
			async (
				callback: (ctx: {
					db: typeof db;
					schema: typeof schema;
				}) => Promise<unknown> | unknown,
			) => callback({ db, schema }),
		),
	};

	return {
		databaseService,
		db,
		deletes,
		insertBatches,
		selectQueue,
		service: new FlowBuilderService(databaseService as never),
		updates,
		updateReturnQueue,
	};
};

describe("FlowBuilderService", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("creates a flow definition with catalog services, states, steps, connections, and layout", async () => {
		const harness = createHarness();

		const result = await harness.service.createFlow(
			{
				name: " New Flow ",
				description: "A test flow",
				status: "draft",
				serviceKeys: ["llm", "missing-service"],
				metadata: { owner: "test" },
			},
			[{ name: "messages", type: "array" }],
			[
				{
					id: "input-system",
					catalogStepId: "step-add-system",
					name: "add-system",
					type: "common",
					isStart: true,
					position: { x: 10, y: 20 },
				},
				{
					catalogStepId: "step-chat",
					name: "chat-completion",
					type: "common",
					isEnd: true,
					position: { x: 200, y: 20 },
				},
			],
			[
				{
					sourceStepId: "input-system",
					targetStepId: "step-chat",
					metadata: { label: "next" },
				},
			],
			{ nodes: [{ stepId: "input-system", position: { x: 10, y: 20 } }] },
		);

		expect(result.flow.name).toBe(" New Flow ");
		expect(result.services.map((service) => service.name)).toEqual([
			"LLM",
			"missing-service",
		]);
		expect(result.steps).toHaveLength(2);
		expect(result.connections[0]).toMatchObject({
			sourceStepId: "input-system",
			targetStepId: "created-step-1",
		});
		expect(result.layout?.nodes[0].position).toEqual({ x: 10, y: 20 });
		expect(harness.insertBatches).toHaveLength(5);
	});

	it("loads a flow definition and returns null when the flow is absent", async () => {
		const harness = createHarness();
		const existing = flow({
			id: "flow-1",
			metadata: {
				layout: { nodes: [{ stepId: "step-1", position: { x: 1, y: 2 } }] },
			},
		});
		harness.selectQueue.push(
			[existing],
			[flowState()],
			[flowService()],
			[flowStep()],
			[flowConnection()],
			[flowConfig()],
		);

		await expect(
			harness.service.getFlowDefinition("flow-1"),
		).resolves.toMatchObject({
			flow: existing,
			states: [expect.objectContaining({ id: "state-1" })],
			services: [expect.objectContaining({ id: "service-1" })],
			steps: [expect.objectContaining({ id: "step-1" })],
			connections: [expect.objectContaining({ id: "conn-1" })],
			flowConfigs: [expect.objectContaining({ id: "config-1" })],
			layout: { nodes: [{ stepId: "step-1", position: { x: 1, y: 2 } }] },
		});

		harness.selectQueue.push([]);
		await expect(
			harness.service.getFlowDefinition("missing"),
		).resolves.toBeNull();
	});

	it("updates metadata, replaces flow internals, and rejects missing updates", async () => {
		const harness = createHarness();
		harness.updateReturnQueue.push([
			flow({
				id: "flow-1",
				name: "Updated",
				metadata: { layout: { nodes: [] } },
				serviceKeys: ["embeddings"],
			}),
		]);

		const updated = await harness.service.updateFlow(
			"flow-1",
			{ name: "Updated", status: "active", serviceKeys: ["embeddings"] },
			[{ name: "state", type: "object" }],
			[
				{
					catalogStepId: "feature-a",
					name: "feature-a",
					type: "feature",
					position: { x: 0, y: 0 },
				},
			],
			[],
			{ nodes: [] },
		);

		expect(updated.flow.name).toBe("Updated");
		expect(harness.deletes).toHaveLength(4);
		expect(updated.services[0]).toMatchObject({
			name: "Embeddings",
			serviceKey: "embeddings",
		});

		harness.updateReturnQueue.push([]);
		await expect(
			harness.service.updateFlow("missing", { name: "Missing" }, [], [], []),
		).rejects.toThrow("Flow with ID missing not found");

		harness.updateReturnQueue.push([flow({ id: "flow-1", name: "Meta" })]);
		await expect(
			harness.service.updateFlowMetadata("flow-1", {
				name: " Meta ",
				description: " description ",
				status: "active",
			}),
		).resolves.toMatchObject({ name: "Meta" });
		await expect(
			harness.service.updateFlowMetadata("flow-1", {
				name: "   ",
				status: "active",
			}),
		).rejects.toThrow("Flow name is required");
	});

	it("parses legacy predefined config rows and falls back for invalid values", async () => {
		const harness = createHarness();
		harness.selectQueue.push(
			[flow({ id: "foundation-flow", predefinedFlow: "foundation" })],
			[
				flowConfig({ name: "systemPrompt", type: "string", value: "Custom" }),
				flowConfig({ name: "contextPrompt", type: "string", value: "Context" }),
				flowConfig({ name: "tools", type: "array", value: ["search"] }),
				flowConfig({
					name: "enableContextRetrieval",
					type: "boolean",
					value: false,
				}),
				flowConfig({ name: "enableCitations", type: "boolean", value: false }),
				flowConfig({ name: "retrievalMode", type: "string", value: "quick" }),
				flowConfig({ name: "graphType", type: "string", value: "foundation" }),
			],
		);

		await expect(
			harness.service.getFlowConfig({ predefinedFlow: "foundation" }),
		).resolves.toMatchObject({
			systemPrompt: "Custom",
			contextPrompt: "Context",
			tools: ["search"],
			enableContextRetrieval: false,
			enableCitations: false,
			retrievalMode: "quick",
		});

		harness.selectQueue.push(
			[flow({ id: "foundation-flow", predefinedFlow: "foundation" })],
			[flowConfig({ name: "tools", type: "array", value: "invalid" })],
		);
		await expect(
			harness.service.getFlowConfig({ predefinedFlow: "foundation" }),
		).resolves.toMatchObject({
			tools: ["current_time"],
			retrievalMode: "smart",
		});
	});

	it("saves, resets, and classifies legacy and unified flow config storage", async () => {
		const harness = createHarness();
		harness.selectQueue.push(
			[flow({ id: "flow-1" })],
			[],
			[{ id: "existing-config" }],
		);
		await harness.service.saveFlowConfig(
			{ flowId: "flow-1" },
			{ temperature: 0.2, enabled: true, tags: ["a"], nested: { ok: true } },
		);
		expect(
			harness.insertBatches.some((batch) => batch.table === schema.flowConfigs),
		).toBe(true);
		expect(
			harness.updates.some((batch) => batch.table === schema.flowConfigs),
		).toBe(true);

		harness.selectQueue.push([flow({ id: "flow-1" })]);
		await harness.service.resetFlowConfig({ flowId: "flow-1" });
		expect(harness.deletes).toContain(schema.flowConfigs);

		harness.selectQueue.push(
			[flow({ id: "flow-1" })],
			[flowConfig({ name: "unified_config", type: "object", value: {} })],
		);
		await expect(
			harness.service.getFlowConfigStorageFormat({ flowId: "flow-1" }),
		).resolves.toBe("unified");

		harness.selectQueue.push([flow({ id: "flow-1" })], [], []);
		await expect(
			harness.service.getFlowConfigStorageFormat({ flowId: "flow-1" }),
		).resolves.toBe("empty");
	});

	it("loads, saves, and falls back for unified flow configs", async () => {
		const harness = createHarness();
		const stored: UnifiedFlowConfig = {
			graphType: "agent",
			steps: [{ id: "agent", name: "agent-node", enabled: true }],
		};
		harness.selectQueue.push(
			[flow({ id: "flow-1" })],
			[flowConfig({ name: "unified_config", type: "object", value: stored })],
		);

		await expect(
			harness.service.getStoredUnifiedFlowConfig({ flowId: "flow-1" }),
		).resolves.toMatchObject({
			graphType: "agent",
			steps: [{ id: "agent", name: "agent-node", enabled: true }],
		});

		harness.selectQueue.push([flow({ id: "flow-1" })], []);
		await expect(
			harness.service.getUnifiedFlowConfig({ flowId: "flow-1" }),
		).resolves.toMatchObject({
			graphType: "foundation",
			steps: [{ id: "system", name: "add-system", enabled: true }],
		});

		harness.selectQueue.push([flow({ id: "flow-1" })], [{ id: "existing" }]);
		await harness.service.saveUnifiedFlowConfig(
			{ flowId: "flow-1" },
			{ graphType: "foundation", steps: [] },
		);
		expect(
			harness.updates.some((batch) => batch.table === schema.flowConfigs),
		).toBe(true);

		harness.selectQueue.push([flow({ id: "flow-1" })], []);
		await harness.service.saveUnifiedFlowConfig(
			{ flowId: "flow-1" },
			{ graphType: "foundation", steps: [] },
		);
		expect(
			harness.insertBatches.some((batch) => batch.table === schema.flowConfigs),
		).toBe(true);
	});

	it("reads and writes feature flags through feature step metadata", async () => {
		const harness = createHarness();
		harness.selectQueue.push(
			[flow({ id: "flow-1" })],
			[
				{ name: "feature-a", metadata: { enabled: true } },
				{ name: "unrelated", metadata: { enabled: true } },
			],
		);

		await expect(
			harness.service.getFlowFeatureFlags({ flowId: "flow-1" }),
		).resolves.toEqual({
			"feature-a": true,
			"feature-b": false,
		});

		harness.selectQueue.push(
			[flow({ id: "flow-1" })],
			[{ id: "step-feature-a", metadata: { existing: true } }],
			[],
		);
		await harness.service.saveFlowFeatureFlags(
			{ flowId: "flow-1" },
			{ "feature-a": false, "feature-b": true },
		);

		expect(
			harness.updates.some((batch) => batch.table === schema.flowSteps),
		).toBe(true);
		expect(
			harness.insertBatches.some((batch) => batch.table === schema.flowSteps),
		).toBe(true);
	});
});
