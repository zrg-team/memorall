import { and, desc, eq } from "drizzle-orm";
import type { IDatabaseService } from "@/services/database/interfaces/database-service.interface";
import type {
	Flow,
	FlowState,
	FlowStep,
	FlowConnection,
	FlowService,
	FlowConfig,
} from "@memorall/agent-harness-flows/interfaces/config/flow-builder";
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
} from "@memorall/agent-harness-flows/interfaces/config/flow-builder";
import {
	DEFAULT_FOUNDATION_PREDEFINED_CONFIG,
	FOUNDATION_CONFIG_KEYS,
	type FoundationPredefinedConfig,
} from "@memorall/agent-harness-flows/graph/foundation/state";
import {
	logError,
	logInfo,
	logWarn,
} from "@memorall/agent-harness-flows/logging/logger";
import {
	getFeatureCatalogSteps,
	getFlowCatalog,
} from "@/services/flow-builder-catalog";
import {
	applyLegacyDraftToUnified,
	selectFeatureStepNames,
} from "@/services/flow-config-legacy";
import type { UnifiedFlowConfig } from "@memorall/agent-harness-flows/interfaces/config/flow-config";
import {
	buildDefaultFlowConfig,
	mergeWithDefaultConfig,
} from "@memorall/agent-harness-flows/utils/flow-config";

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
		case "number":
			// Declared by FOUNDATION_CONFIG_KEYS (maxIterations) and written by
			// inferConfigType, so a missing case here silently replaced every
			// stored value with the default on read.
			return typeof value === "number" && Number.isFinite(value);
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

	/**
	 * Which on-disk shape an agent's configuration uses.
	 *
	 * Shared by the format query and the read path so the two can never
	 * disagree about what "legacy" means — they did not used to share it, and
	 * the read path simply had no legacy case at all.
	 */
	private async classifyStorage(
		flowId: string,
		rows: FlowConfigRow[],
	): Promise<{
		format: FlowConfigStorageFormat;
		flags: Record<string, boolean>;
		hasStoredFeatureRows: boolean;
	}> {
		const hasUnifiedRow = rows.some((row) => row.name === "unified_config");
		const { flags, hasStoredRows } = await this.getStoredFeatureFlags(flowId);

		if (hasUnifiedRow) {
			return { format: "unified", flags, hasStoredFeatureRows: hasStoredRows };
		}

		const hasLegacyRows = rows.some((row) => row.name !== "unified_config");
		return {
			format: hasLegacyRows || hasStoredRows ? "legacy" : "empty",
			flags,
			hasStoredFeatureRows: hasStoredRows,
		};
	}

	async getFlowConfigStorageFormat(
		ref: FlowConfigRef,
	): Promise<FlowConfigStorageFormat> {
		const flow = await this.resolveFlow(ref);
		const rows = await this.getFlowConfigRows(flow.id);
		const { format } = await this.classifyStorage(flow.id, rows);
		return format;
	}

	/**
	 * The agent's stored configuration, whichever shape it is in.
	 *
	 * A legacy agent is converted on the way out rather than reported as having
	 * nothing stored: returning null here meant the run fell back to the stock
	 * config, so a legacy agent answered with none of its own instructions,
	 * features or tools while still looking correct in settings.
	 *
	 * Returns null only for `empty` — an agent that genuinely has no stored
	 * customisation, for which the defaults are the right answer.
	 */
	async getStoredUnifiedFlowConfig(
		ref: FlowConfigRef,
	): Promise<UnifiedFlowConfig | null> {
		const graphType = "foundation";
		const flow = await this.resolveFlow(ref);
		const rows = await this.getFlowConfigRows(flow.id);
		const unifiedRow = rows.find((row) => row.name === "unified_config");

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

		const { format, flags, hasStoredFeatureRows } = await this.classifyStorage(
			flow.id,
			rows,
		);
		if (format !== "legacy") {
			return null;
		}

		return this.convertLegacyRowsToUnified(
			flow.id,
			rows,
			flags,
			hasStoredFeatureRows,
		);
	}

	/**
	 * Fold legacy per-key rows into a unified config, and remember the result.
	 *
	 * The write-back is deliberately detached: `flow_configs` is unique on
	 * (flow_id, name) and the save is select-then-insert, so two contexts
	 * reading the same legacy agent at once can both insert and one will lose.
	 * Awaiting that here would turn a lost race into a null return — the very
	 * fallback this method exists to prevent — so the caller gets its config
	 * either way and a failed write only costs one more conversion later.
	 */
	private async convertLegacyRowsToUnified(
		flowId: string,
		rows: FlowConfigRow[],
		flags: Record<string, boolean>,
		hasStoredFeatureRows: boolean,
	): Promise<UnifiedFlowConfig> {
		const legacyConfig = this.parsePredefinedConfigRows(rows, "foundation");
		const graphType =
			legacyConfig.graphType === "agent" ? "agent" : "foundation";

		// With no feature rows the flags are all false, which would switch off
		// retrieval and citations for an agent whose legacy rows say otherwise.
		const effectiveFlags = hasStoredFeatureRows
			? flags
			: {
					...flags,
					"knowledge-retrieval": Boolean(legacyConfig.enableContextRetrieval),
					citations: Boolean(legacyConfig.enableCitations),
				};

		// Legacy storage never held accessible-agent ids, MCP connections or
		// skills, so the empty lists lose nothing.
		const converted = applyLegacyDraftToUnified(
			buildDefaultFlowConfig(graphType),
			legacyConfig,
			effectiveFlags,
			[],
			[],
			[],
			selectFeatureStepNames(getFlowCatalog().steps, graphType),
		);
		const merged = mergeWithDefaultConfig(converted, converted.graphType);

		void this.saveUnifiedFlowConfig({ flowId }, merged).catch((error) => {
			logWarn(
				"[FLOW_BUILDER] Could not persist converted legacy config:",
				error,
			);
		});

		return merged;
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
	/**
	 * The flow config for a reference, falling back to the stock one.
	 *
	 * The fallback is silent by design for a predefined flow that has never been
	 * customised — there is nothing stored yet and the defaults are correct. It is
	 * the wrong answer for an agent the caller asked for by id: that means the
	 * agent's instructions, features and tools are all quietly replaced by the
	 * stock ones, and the run looks like it worked. Callers that need to know use
	 * `resolveUnifiedFlowConfig`.
	 */
	async getUnifiedFlowConfig(ref: FlowConfigRef): Promise<UnifiedFlowConfig> {
		return (await this.resolveUnifiedFlowConfig(ref)).config;
	}

	/**
	 * The flow config plus whether it is actually the one that was asked for.
	 *
	 * `usedFallback` is what lets a caller say "ran without your agent" instead of
	 * answering as somebody else without mentioning it.
	 */
	async resolveUnifiedFlowConfig(ref: FlowConfigRef): Promise<{
		config: UnifiedFlowConfig;
		usedFallback: boolean;
		reason?: string;
	}> {
		const graphType = "foundation";

		try {
			const stored = await this.getStoredUnifiedFlowConfig(ref);
			if (stored) {
				return { config: stored, usedFallback: false };
			}

			// Nothing stored is not the same as something going wrong. An agent
			// created but never customised has no rows at all, and the stock
			// config is exactly what it is meant to run — reporting that as a
			// fallback made every new agent look broken to callers that refuse to
			// run without the agent they asked for.
			const format = await this.getFlowConfigStorageFormat(ref);
			if (format === "empty") {
				return {
					config: buildDefaultFlowConfig(graphType),
					usedFallback: false,
				};
			}

			const reason =
				"flowId" in ref
					? `No saved configuration for flow ${ref.flowId}.`
					: undefined;
			if (reason) {
				logWarn(`[FLOW_BUILDER] ${reason} Falling back to the stock config.`);
			}
			return {
				config: buildDefaultFlowConfig(graphType),
				usedFallback: Boolean(reason),
				reason,
			};
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			logError("[FLOW_BUILDER] Failed to load unified flow config:", error);
			return {
				config: buildDefaultFlowConfig(graphType),
				usedFallback: true,
				reason,
			};
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
