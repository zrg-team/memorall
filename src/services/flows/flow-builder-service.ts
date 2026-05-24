import { and, desc, eq } from "drizzle-orm";
import type { IDatabaseService } from "@/services/database/interfaces/database-service.interface";
import type {
	Flow,
	FlowState,
	FlowStep,
	FlowConnection,
	FlowService,
	FlowConfig,
} from "./interfaces/flow-builder";
import type { PredefinedFlowKey } from "@/services/database/entities/flows";
import type {
	FlowCatalog,
	FlowConnectionInput,
	FlowDefinition,
	FlowDraftInput,
	FlowLayout,
	FlowMetadataUpdateInput,
	FlowStateInput,
	FlowStepInput,
} from "./interfaces/flow-builder";
import {
	DEFAULT_FOUNDATION_PREDEFINED_CONFIG,
	FOUNDATION_CONFIG_KEYS,
	type FoundationPredefinedConfig,
} from "./graph/foundation/state";
import { logError, logInfo } from "./interfaces/logger";
import { getFeatureCatalogSteps, getFlowCatalog } from "./flow-builder-catalog";
import type { UnifiedFlowConfig } from "./interfaces/flow-config";
import {
	buildDefaultFlowConfig,
	mergeWithDefaultConfig,
} from "./build-flow-config";

type PredefinedFlowConfigMap = {
	foundation: FoundationPredefinedConfig;
};

type FlowConfigRef = { flowId: string } | { predefinedFlow: PredefinedFlowKey };
type FlowConfigRow = {
	name: string;
	value: unknown;
	type: string;
};

export type FlowConfigStorageFormat = "unified" | "legacy" | "empty";

const getFlowConfigMetaForPredefined = (flowKey: PredefinedFlowKey) => {
	switch (flowKey) {
		case "foundation":
			return {
				keys: FOUNDATION_CONFIG_KEYS,
				defaults: DEFAULT_FOUNDATION_PREDEFINED_CONFIG,
			};
	}
};

const isValidConfigValue = (type: string, value: unknown): boolean => {
	switch (type) {
		case "string":
			return typeof value === "string";
		case "boolean":
			return typeof value === "boolean";
		case "array":
			return Array.isArray(value);
		default:
			return false;
	}
};

const inferConfigType = (value: unknown): string => {
	if (Array.isArray(value)) return "array";
	if (typeof value === "boolean") return "boolean";
	if (typeof value === "string") return "string";
	if (typeof value === "number") return "number";
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return "object";
	}
	return "unknown";
};

const buildFlowServices = (
	flowId: string,
	serviceKeys: string[],
): Omit<FlowService, "id" | "createdAt" | "updatedAt">[] => {
	const catalog = getFlowCatalog();
	const byKey = new Map(
		catalog.services.map((service) => [service.serviceKey, service]),
	);
	return serviceKeys.map((serviceKey) => {
		const catalogService = byKey.get(serviceKey);
		return {
			flowId,
			name: catalogService?.name ?? serviceKey,
			type: catalogService?.type ?? "custom",
			serviceKey,
			metadata: catalogService?.metadata ?? {},
		};
	});
};

export class FlowBuilderService {
	constructor(private databaseService: IDatabaseService) {}

	private readonly FEATURE_STEP_TYPE = "feature";

	private getFeatureNamesFromCatalog(): string[] {
		return getFeatureCatalogSteps().map((step) => step.name);
	}

	async listFlows(): Promise<Flow[]> {
		return this.databaseService.use(async ({ db, schema }) =>
			db.select().from(schema.flows).orderBy(desc(schema.flows.updatedAt)),
		);
	}

	async listPredefinedFlows(flowKey: PredefinedFlowKey): Promise<Flow[]> {
		// Ensure default predefined flow exists before listing.
		await this.resolveFlow({ predefinedFlow: flowKey });
		return this.databaseService.use(async ({ db, schema }) =>
			db
				.select()
				.from(schema.flows)
				.where(eq(schema.flows.predefinedFlow, flowKey))
				.orderBy(desc(schema.flows.updatedAt)),
		);
	}

	async createPredefinedFlow(
		flowKey: PredefinedFlowKey,
		name: string,
		status: "active" | "draft" = "active",
	): Promise<Flow> {
		const normalizedName = name.trim() || flowKey;
		return this.databaseService.transaction(async ({ db, schema }) => {
			const [flow] = await db
				.insert(schema.flows)
				.values({
					name: normalizedName,
					predefinedFlow: flowKey,
					status,
					serviceKeys: [],
				})
				.returning();
			return flow;
		});
	}

	async getFlowDefinition(flowId: string): Promise<FlowDefinition | null> {
		return this.databaseService.use(async ({ db, schema }) => {
			const [flow] = await db
				.select()
				.from(schema.flows)
				.where(eq(schema.flows.id, flowId))
				.limit(1);

			if (!flow) return null;

			const [states, services, steps, connections, flowConfigs] =
				await Promise.all([
					db
						.select()
						.from(schema.flowStates)
						.where(eq(schema.flowStates.flowId, flowId)),
					db
						.select()
						.from(schema.flowServices)
						.where(eq(schema.flowServices.flowId, flowId)),
					db
						.select()
						.from(schema.flowSteps)
						.where(eq(schema.flowSteps.flowId, flowId)),
					db
						.select()
						.from(schema.flowConnections)
						.where(eq(schema.flowConnections.flowId, flowId)),
					db
						.select()
						.from(schema.flowConfigs)
						.where(eq(schema.flowConfigs.flowId, flowId)),
				]);

			const layout =
				(flow.metadata as { layout?: FlowLayout } | undefined)?.layout ??
				undefined;

			return {
				flow,
				services,
				states,
				steps,
				connections,
				flowConfigs,
				layout,
			};
		});
	}

	async createFlow(
		input: FlowDraftInput,
		states: FlowStateInput[],
		steps: FlowStepInput[],
		connections: FlowConnectionInput[],
		layout?: FlowLayout,
	): Promise<FlowDefinition> {
		try {
			logInfo("[FLOW_BUILDER] Creating flow:", input.name);
			return await this.databaseService.transaction(async ({ db, schema }) => {
				const [flow] = await db
					.insert(schema.flows)
					.values({
						name: input.name,
						description: input.description ?? "",
						status: input.status ?? "draft",
						serviceKeys: input.serviceKeys ?? [],
						metadata: {
							...(input.metadata ?? {}),
							...(layout ? { layout } : {}),
						},
					})
					.returning();

				const serviceKeys = input.serviceKeys ?? [];
				const createdServices: FlowService[] = serviceKeys.length
					? await db
							.insert(schema.flowServices)
							.values(buildFlowServices(flow.id, serviceKeys))
							.returning()
					: [];

				const createdStates: FlowState[] = states.length
					? await db
							.insert(schema.flowStates)
							.values(
								states.map((state) => ({
									flowId: flow.id,
									name: state.name,
									type: state.type,
									metadata: state.metadata ?? {},
								})),
							)
							.returning()
					: [];

				const createdSteps: FlowStep[] = steps.length
					? await db
							.insert(schema.flowSteps)
							.values(
								steps.map((step) => ({
									id: step.id,
									flowId: flow.id,
									name: step.name,
									type: step.type,
									isStart: step.isStart ?? false,
									isEnd: step.isEnd ?? false,
									metadata: {
										...(step.metadata ?? {}),
										catalogStepId: step.catalogStepId,
										position: step.position,
									},
								})),
							)
							.returning()
					: [];

				// Build step ID mapping for connections
				const stepIdMap = new Map<string, string>();
				steps.forEach((input, index) => {
					const created = createdSteps[index];
					if (created) {
						const key = input.id ?? input.catalogStepId;
						stepIdMap.set(key, created.id);
					}
				});

				const createdConnections: FlowConnection[] = connections.length
					? await db
							.insert(schema.flowConnections)
							.values(
								connections.map((connection) => ({
									flowId: flow.id,
									sourceStepId:
										stepIdMap.get(connection.sourceStepId) ??
										connection.sourceStepId,
									targetStepId:
										stepIdMap.get(connection.targetStepId) ??
										connection.targetStepId,
									metadata: connection.metadata ?? {},
								})),
							)
							.returning()
					: [];

				return {
					flow,
					services: createdServices,
					states: createdStates,
					steps: createdSteps,
					connections: createdConnections,
					flowConfigs: [] as FlowConfig[],
					layout,
				};
			});
		} catch (error) {
			logError("[FLOW_BUILDER] Failed to create flow:", error);
			throw error;
		}
	}

	async updateFlow(
		flowId: string,
		updates: Partial<FlowDraftInput>,
		states: FlowStateInput[],
		steps: FlowStepInput[],
		connections: FlowConnectionInput[],
		layout?: FlowLayout,
	): Promise<FlowDefinition> {
		try {
			logInfo("[FLOW_BUILDER] Updating flow:", flowId);
			return await this.databaseService.transaction(async ({ db, schema }) => {
				const [updatedFlow] = await db
					.update(schema.flows)
					.set({
						...updates,
						serviceKeys: updates.serviceKeys ?? [],
						metadata: {
							...(updates.metadata ?? {}),
							...(layout ? { layout } : {}),
						},
						updatedAt: new Date(),
					})
					.where(eq(schema.flows.id, flowId))
					.returning();

				if (!updatedFlow) {
					throw new Error(`Flow with ID ${flowId} not found`);
				}

				// Clear existing data for this flow
				await Promise.all([
					db
						.delete(schema.flowStates)
						.where(eq(schema.flowStates.flowId, flowId)),
					db
						.delete(schema.flowServices)
						.where(eq(schema.flowServices.flowId, flowId)),
					db
						.delete(schema.flowConnections)
						.where(eq(schema.flowConnections.flowId, flowId)),
					db
						.delete(schema.flowSteps)
						.where(eq(schema.flowSteps.flowId, flowId)),
				]);

				const serviceKeys = updates.serviceKeys ?? [];
				const createdServices: FlowService[] = serviceKeys.length
					? await db
							.insert(schema.flowServices)
							.values(buildFlowServices(flowId, serviceKeys))
							.returning()
					: [];

				const createdStates: FlowState[] = states.length
					? await db
							.insert(schema.flowStates)
							.values(
								states.map((state) => ({
									flowId,
									name: state.name,
									type: state.type,
									metadata: state.metadata ?? {},
								})),
							)
							.returning()
					: [];

				const createdSteps: FlowStep[] = steps.length
					? await db
							.insert(schema.flowSteps)
							.values(
								steps.map((step) => ({
									id: step.id,
									flowId,
									name: step.name,
									type: step.type,
									isStart: step.isStart ?? false,
									isEnd: step.isEnd ?? false,
									metadata: {
										...(step.metadata ?? {}),
										catalogStepId: step.catalogStepId,
										position: step.position,
									},
								})),
							)
							.returning()
					: [];

				// Build step ID mapping for connections
				const stepIdMap = new Map<string, string>();
				steps.forEach((input, index) => {
					const created = createdSteps[index];
					if (created) {
						const key = input.id ?? input.catalogStepId;
						stepIdMap.set(key, created.id);
					}
				});

				const createdConnections: FlowConnection[] = connections.length
					? await db
							.insert(schema.flowConnections)
							.values(
								connections.map((connection) => ({
									flowId,
									sourceStepId:
										stepIdMap.get(connection.sourceStepId) ??
										connection.sourceStepId,
									targetStepId:
										stepIdMap.get(connection.targetStepId) ??
										connection.targetStepId,
									metadata: connection.metadata ?? {},
								})),
							)
							.returning()
					: [];

				const resolvedLayout =
					(updatedFlow.metadata as { layout?: FlowLayout } | undefined)
						?.layout ?? layout;

				return {
					flow: updatedFlow,
					services: createdServices,
					states: createdStates,
					steps: createdSteps,
					connections: createdConnections,
					flowConfigs: [] as FlowConfig[],
					layout: resolvedLayout,
				};
			});
		} catch (error) {
			logError("[FLOW_BUILDER] Failed to update flow:", error);
			throw error;
		}
	}

	async deleteFlow(flowId: string): Promise<void> {
		await this.databaseService.use(async ({ db, schema }) => {
			await db.delete(schema.flows).where(eq(schema.flows.id, flowId));
		});
	}

	async updateFlowMetadata(
		flowId: string,
		updates: FlowMetadataUpdateInput,
	): Promise<Flow> {
		const normalizedName = updates.name.trim();
		if (!normalizedName) {
			throw new Error("Flow name is required");
		}

		return this.databaseService.transaction(async ({ db, schema }) => {
			const [updatedFlow] = await db
				.update(schema.flows)
				.set({
					name: normalizedName,
					description: updates.description?.trim() || null,
					status: updates.status,
					...(updates.metadata ? { metadata: updates.metadata } : {}),
					updatedAt: new Date(),
				})
				.where(eq(schema.flows.id, flowId))
				.returning();

			if (!updatedFlow) {
				throw new Error(`Flow with ID ${flowId} not found`);
			}

			return updatedFlow;
		});
	}

	async deleteFlowConnection(
		flowId: string,
		sourceStepId: string,
		targetStepId: string,
	): Promise<void> {
		await this.databaseService.use(async ({ db, schema }) => {
			await db
				.delete(schema.flowConnections)
				.where(
					and(
						eq(schema.flowConnections.flowId, flowId),
						eq(schema.flowConnections.sourceStepId, sourceStepId),
						eq(schema.flowConnections.targetStepId, targetStepId),
					),
				);
		});
	}

	/**
	 * Returns the in-memory catalog of available step types and services.
	 * This is NOT stored in the database.
	 */
	getCatalog(): FlowCatalog {
		return getFlowCatalog();
	}

	private async getFlowConfigRows(flowId: string): Promise<FlowConfigRow[]> {
		return this.databaseService.use(async ({ db, schema }) =>
			db
				.select({
					name: schema.flowConfigs.name,
					value: schema.flowConfigs.value,
					type: schema.flowConfigs.type,
				})
				.from(schema.flowConfigs)
				.where(eq(schema.flowConfigs.flowId, flowId)),
		);
	}

	private parsePredefinedConfigRows<K extends PredefinedFlowKey>(
		rows: FlowConfigRow[],
		predefinedFlow: K,
	): PredefinedFlowConfigMap[K] {
		const { keys, defaults } = getFlowConfigMetaForPredefined(predefinedFlow);
		const rowMap = new Map(rows.map((row) => [row.name, row]));
		const config: Record<string, unknown> = {};

		for (const key of keys) {
			const row = rowMap.get(key.name);
			if (
				row &&
				row.type === key.type &&
				isValidConfigValue(key.type, row.value)
			) {
				config[key.name] = row.value;
			} else {
				config[key.name] = defaults[key.name as keyof typeof defaults];
			}
		}

		return config as PredefinedFlowConfigMap[K];
	}

	private async getStoredFeatureFlags(flowId: string): Promise<{
		flags: Record<string, boolean>;
		hasStoredRows: boolean;
	}> {
		const featureNames = this.getFeatureNamesFromCatalog();
		const featureNameSet = new Set(featureNames);
		const flags = Object.fromEntries(
			featureNames.map((name) => [name, false]),
		) as Record<string, boolean>;

		const rows = await this.databaseService.use(async ({ db, schema }) =>
			db
				.select({
					name: schema.flowSteps.name,
					metadata: schema.flowSteps.metadata,
				})
				.from(schema.flowSteps)
				.where(
					and(
						eq(schema.flowSteps.flowId, flowId),
						eq(schema.flowSteps.type, this.FEATURE_STEP_TYPE),
					),
				),
		);

		for (const row of rows) {
			if (!featureNameSet.has(row.name)) {
				continue;
			}
			flags[row.name] = Boolean(
				(row.metadata as { enabled?: unknown } | null | undefined)?.enabled,
			);
		}

		return {
			flags,
			hasStoredRows: rows.length > 0,
		};
	}

	private async resolveFlow(ref: FlowConfigRef): Promise<Flow> {
		return this.databaseService.use(async ({ db, schema }) => {
			if ("flowId" in ref) {
				const [byId] = await db
					.select()
					.from(schema.flows)
					.where(eq(schema.flows.id, ref.flowId))
					.limit(1);
				if (!byId) {
					throw new Error(`Flow with ID ${ref.flowId} not found`);
				}
				return byId;
			}

			const [existing] = await db
				.select()
				.from(schema.flows)
				.where(eq(schema.flows.predefinedFlow, ref.predefinedFlow))
				.limit(1);

			if (existing) {
				return existing;
			}

			const [inserted] = await db
				.insert(schema.flows)
				.values({
					name: ref.predefinedFlow,
					predefinedFlow: ref.predefinedFlow,
					status: "active",
					serviceKeys: [],
				})
				.returning();

			return inserted;
		});
	}

	async getFlowConfig<K extends PredefinedFlowKey>(ref: {
		predefinedFlow: K;
	}): Promise<PredefinedFlowConfigMap[K]>;
	async getFlowConfig(ref: {
		flowId: string;
	}): Promise<Record<string, unknown>>;
	async getFlowConfig(ref: FlowConfigRef): Promise<Record<string, unknown>> {
		const flow = await this.resolveFlow(ref);
		const predefinedFlow = flow.predefinedFlow as PredefinedFlowKey | null;

		try {
			const rows = await this.getFlowConfigRows(flow.id);

			if (predefinedFlow) {
				return this.parsePredefinedConfigRows(rows, predefinedFlow);
			}

			return Object.fromEntries(rows.map((row) => [row.name, row.value]));
		} catch (error) {
			logError("[FLOW_BUILDER] Failed to load flow config:", error);
			if (predefinedFlow) {
				const { defaults } = getFlowConfigMetaForPredefined(predefinedFlow);
				return { ...defaults };
			}
			return {};
		}
	}

	async saveFlowConfig<K extends PredefinedFlowKey>(
		ref: { predefinedFlow: K },
		config: PredefinedFlowConfigMap[K],
	): Promise<void>;
	async saveFlowConfig(
		ref: { flowId: string },
		config: Record<string, unknown>,
	): Promise<void>;
	async saveFlowConfig(
		ref: FlowConfigRef,
		config: Record<string, unknown>,
	): Promise<void> {
		const flow = await this.resolveFlow(ref);
		const predefinedFlow = flow.predefinedFlow as PredefinedFlowKey | null;

		await this.databaseService.transaction(async ({ db, schema }) => {
			if (predefinedFlow) {
				const { keys } = getFlowConfigMetaForPredefined(predefinedFlow);
				for (const key of keys) {
					const value = config[key.name as keyof typeof config];
					const existing = await db
						.select({ id: schema.flowConfigs.id })
						.from(schema.flowConfigs)
						.where(
							and(
								eq(schema.flowConfigs.flowId, flow.id),
								eq(schema.flowConfigs.name, key.name),
							),
						)
						.limit(1);

					if (existing.length > 0) {
						await db
							.update(schema.flowConfigs)
							.set({
								type: key.type,
								value,
								updatedAt: new Date(),
							})
							.where(eq(schema.flowConfigs.id, existing[0].id));
						continue;
					}

					await db.insert(schema.flowConfigs).values({
						flowId: flow.id,
						name: key.name,
						type: key.type,
						value,
						metadata: {},
					});
				}

				await db
					.update(schema.flows)
					.set({ updatedAt: new Date() })
					.where(eq(schema.flows.id, flow.id));
				return;
			}

			for (const [name, value] of Object.entries(config)) {
				const type = inferConfigType(value);
				const existing = await db
					.select({ id: schema.flowConfigs.id })
					.from(schema.flowConfigs)
					.where(
						and(
							eq(schema.flowConfigs.flowId, flow.id),
							eq(schema.flowConfigs.name, name),
						),
					)
					.limit(1);

				if (existing.length > 0) {
					await db
						.update(schema.flowConfigs)
						.set({
							type,
							value,
							updatedAt: new Date(),
						})
						.where(eq(schema.flowConfigs.id, existing[0].id));
					continue;
				}
				await db.insert(schema.flowConfigs).values({
					flowId: flow.id,
					name,
					type,
					value,
					metadata: {},
				});
			}

			await db
				.update(schema.flows)
				.set({ updatedAt: new Date() })
				.where(eq(schema.flows.id, flow.id));
		});
	}

	async resetFlowConfig(ref: FlowConfigRef): Promise<void> {
		const flow = await this.resolveFlow(ref);
		const predefinedFlow = flow.predefinedFlow as PredefinedFlowKey | null;

		if (predefinedFlow) {
			const { defaults } = getFlowConfigMetaForPredefined(predefinedFlow);
			await this.saveFlowConfig(
				{ predefinedFlow },
				defaults as PredefinedFlowConfigMap[typeof predefinedFlow],
			);
			return;
		}

		await this.databaseService.use(async ({ db, schema }) => {
			await db
				.delete(schema.flowConfigs)
				.where(eq(schema.flowConfigs.flowId, flow.id));
		});
	}

	async getFlowConfigStorageFormat(
		ref: FlowConfigRef,
	): Promise<FlowConfigStorageFormat> {
		const flow = await this.resolveFlow(ref);
		const rows = await this.getFlowConfigRows(flow.id);
		const rowMap = new Map(rows.map((row) => [row.name, row]));

		if (rowMap.has("unified_config")) {
			return "unified";
		}

		const hasLegacyRows = rows.some((row) => row.name !== "unified_config");
		const { hasStoredRows } = await this.getStoredFeatureFlags(flow.id);

		return hasLegacyRows || hasStoredRows ? "legacy" : "empty";
	}

	async getStoredUnifiedFlowConfig(
		ref: FlowConfigRef,
	): Promise<UnifiedFlowConfig | null> {
		try {
			const graphType = "foundation";
			const flow = await this.resolveFlow(ref);
			const rowMap = new Map(
				(await this.getFlowConfigRows(flow.id)).map((row) => [row.name, row]),
			);
			const unifiedRow = rowMap.get("unified_config");
			if (
				unifiedRow &&
				typeof unifiedRow.value === "object" &&
				unifiedRow.value !== null
			) {
				const stored = unifiedRow.value as Partial<UnifiedFlowConfig>;
				return mergeWithDefaultConfig(
					stored,
					(stored.graphType as string | undefined) ?? graphType,
				);
			}

			return null;
		} catch (error) {
			logError(
				"[FLOW_BUILDER] Failed to load stored unified flow config:",
				error,
			);
			return null;
		}
	}

	async saveUnifiedFlowConfig(
		ref: FlowConfigRef,
		config: UnifiedFlowConfig,
	): Promise<void> {
		const flow = await this.resolveFlow(ref);

		await this.databaseService.transaction(async ({ db, schema }) => {
			const existing = await db
				.select({ id: schema.flowConfigs.id })
				.from(schema.flowConfigs)
				.where(
					and(
						eq(schema.flowConfigs.flowId, flow.id),
						eq(schema.flowConfigs.name, "unified_config"),
					),
				)
				.limit(1);

			if (existing.length > 0) {
				await db
					.update(schema.flowConfigs)
					.set({
						type: "object",
						value: config,
						updatedAt: new Date(),
					})
					.where(eq(schema.flowConfigs.id, existing[0].id));
			} else {
				await db.insert(schema.flowConfigs).values({
					flowId: flow.id,
					name: "unified_config",
					type: "object",
					value: config,
					metadata: {},
				});
			}

			await db
				.update(schema.flows)
				.set({ updatedAt: new Date() })
				.where(eq(schema.flows.id, flow.id));
		});
	}

	/**
	 * Load the flow configuration as a UnifiedFlowConfig.
	 *
	 * Runtime only reads the unified config blob. When it is absent,
	 * execution falls back to the canonical default flow definition.
	 */
	async getUnifiedFlowConfig(ref: FlowConfigRef): Promise<UnifiedFlowConfig> {
		const graphType = "foundation";

		try {
			const stored = await this.getStoredUnifiedFlowConfig(ref);
			if (stored) {
				return stored;
			}

			return buildDefaultFlowConfig(graphType);
		} catch (error) {
			logError("[FLOW_BUILDER] Failed to load unified flow config:", error);
			return buildDefaultFlowConfig(graphType);
		}
	}

	async getFlowFeatureFlags(
		ref: FlowConfigRef,
	): Promise<Record<string, boolean>> {
		const flow = await this.resolveFlow(ref);
		return (await this.getStoredFeatureFlags(flow.id)).flags;
	}

	async saveFlowFeatureFlags(
		ref: FlowConfigRef,
		flags: Record<string, boolean>,
	): Promise<void> {
		const flow = await this.resolveFlow(ref);
		const featureNames = this.getFeatureNamesFromCatalog();

		await this.databaseService.transaction(async ({ db, schema }) => {
			for (const featureName of featureNames) {
				const existing = await db
					.select({
						id: schema.flowSteps.id,
						metadata: schema.flowSteps.metadata,
					})
					.from(schema.flowSteps)
					.where(
						and(
							eq(schema.flowSteps.flowId, flow.id),
							eq(schema.flowSteps.name, featureName),
							eq(schema.flowSteps.type, this.FEATURE_STEP_TYPE),
						),
					)
					.limit(1);

				const metadata = {
					...(existing[0]?.metadata ?? {}),
					enabled: Boolean(flags[featureName]),
					locked: true,
					source: "agent-settings",
				};

				if (existing.length > 0) {
					await db
						.update(schema.flowSteps)
						.set({
							metadata,
							updatedAt: new Date(),
						})
						.where(eq(schema.flowSteps.id, existing[0].id));
					continue;
				}

				await db.insert(schema.flowSteps).values({
					flowId: flow.id,
					name: featureName,
					type: this.FEATURE_STEP_TYPE,
					isStart: false,
					isEnd: false,
					metadata,
				});
			}

			await db
				.update(schema.flows)
				.set({ updatedAt: new Date() })
				.where(eq(schema.flows.id, flow.id));
		});
	}
}
