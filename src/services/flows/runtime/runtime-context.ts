import type { LangGraphRunnableConfig } from "@langchain/langgraph";

export const FLOW_RUNTIME_VARS_CONFIG_KEY = "__memorallFlowRuntimeVars";

export type FlowRuntimeInitialValues = Record<string, unknown>;

export interface FlowRuntimeVars {
	get<T = unknown>(key: string): T | undefined;
	set<T = unknown>(key: string, value: T): void;
	delete(key: string): void;
	has(key: string): boolean;
	merge(values: FlowRuntimeInitialValues): void;
	snapshot(): FlowRuntimeInitialValues;
}

type ConfigurableRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is ConfigurableRecord =>
	typeof value === "object" && value !== null;

class DefaultFlowRuntimeVars implements FlowRuntimeVars {
	private readonly values = new Map<string, unknown>();

	constructor(initial?: FlowRuntimeInitialValues) {
		this.merge(initial ?? {});
	}

	get<T = unknown>(key: string): T | undefined {
		return this.values.get(key) as T | undefined;
	}

	set<T = unknown>(key: string, value: T): void {
		this.values.set(key, value);
	}

	delete(key: string): void {
		this.values.delete(key);
	}

	has(key: string): boolean {
		return this.values.has(key);
	}

	merge(values: FlowRuntimeInitialValues): void {
		for (const [key, value] of Object.entries(values)) {
			if (value !== undefined) {
				this.values.set(key, value);
			}
		}
	}

	snapshot(): FlowRuntimeInitialValues {
		return Object.fromEntries(this.values.entries());
	}
}

const isFlowRuntimeVars = (value: unknown): value is FlowRuntimeVars => {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<FlowRuntimeVars>;
	return (
		typeof candidate.get === "function" &&
		typeof candidate.set === "function" &&
		typeof candidate.merge === "function" &&
		typeof candidate.snapshot === "function"
	);
};

export const createFlowRuntimeVars = (
	initial?: FlowRuntimeInitialValues,
): FlowRuntimeVars => new DefaultFlowRuntimeVars(initial);

export const getFlowRuntimeVars = (
	runConfig?: LangGraphRunnableConfig,
): FlowRuntimeVars | undefined => {
	const configurable = runConfig?.configurable;
	if (!isRecord(configurable)) return undefined;

	const vars = configurable[FLOW_RUNTIME_VARS_CONFIG_KEY];
	return isFlowRuntimeVars(vars) ? vars : undefined;
};

export const withFlowRuntimeVars = <TOptions extends Record<string, unknown>>(
	options: TOptions,
	valuesOrVars?: FlowRuntimeInitialValues | FlowRuntimeVars,
): TOptions => {
	const existingConfigurable = isRecord(options.configurable)
		? options.configurable
		: {};
	const existingVars = existingConfigurable[FLOW_RUNTIME_VARS_CONFIG_KEY];
	const vars = isFlowRuntimeVars(existingVars)
		? existingVars
		: isFlowRuntimeVars(valuesOrVars)
			? valuesOrVars
			: createFlowRuntimeVars();

	if (valuesOrVars && !isFlowRuntimeVars(valuesOrVars)) {
		vars.merge(valuesOrVars);
	}

	return {
		...options,
		configurable: {
			...existingConfigurable,
			[FLOW_RUNTIME_VARS_CONFIG_KEY]: vars,
		},
	} as TOptions;
};

export const getRuntimeString = (
	vars: FlowRuntimeVars | undefined,
	key: string,
): string | undefined => {
	const value = vars?.get(key);
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

export const getRuntimeGraphId = (
	vars: FlowRuntimeVars | undefined,
): string | undefined =>
	getRuntimeString(vars, "memory.graph.id") ??
	getRuntimeString(vars, "graph.id") ??
	getRuntimeString(vars, "graphId") ??
	getRuntimeString(vars, "topic.id") ??
	getRuntimeString(vars, "topicId");
