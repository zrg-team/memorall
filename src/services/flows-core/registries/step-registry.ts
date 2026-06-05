import type {
	BoundStep,
	StepFactory,
	StepFactoryContext,
} from "flow-core/interfaces/engine/step";
import type {} from "flow-core/interfaces/engine/tool";
import type { AllServices } from "flow-core/interfaces/services/services";

// Base shape that all step registry entries must follow
export interface StepSpec {
	input: unknown;
	output: unknown;
	services: unknown;
	config: unknown;
}

// ---------------------------------------------------------------------------
// Step Metadata
// ---------------------------------------------------------------------------

/**
 * Describes a single config parameter that a step accepts.
 * Used by buildDefaultFlowConfig() to populate defaults and by the UI
 * to generate config editors without hand-written forms.
 */
export interface StepConfigParam {
	/** The key used in StepInstanceConfig.config. */
	key: string;
	type: "string" | "number" | "boolean" | "array";
	/** Value written into the config slot when buildDefaultFlowConfig() runs. */
	default?: unknown;
	description?: string;
}

/** Step input/output field definition used for engine-level step discovery. */
export interface StepIOField {
	name: string;
	type: string;
	required?: boolean;
	description?: string;
}

export interface StepFeatureMetadata {
	id?: string;
	type: "feature";
	graphTypes?: string[];
	inputs?: StepIOField[];
	outputs?: StepIOField[];
	volatile?: boolean;
}

/**
 * Static metadata attached to a step registration.
 * All fields are optional — steps that need no config or have trivial
 * state mappings can omit them.
 */
export interface StepMeta {
	/**
	 * Semantic version used when multiple modules register the same step id.
	 * Higher versions win; missing versions are treated as 0.0.0.
	 */
	version?: string;
	description?: string;
	/**
	 * Config params this step accepts (beyond what comes from state).
	 * Used to populate defaults in buildDefaultFlowConfig() and to generate
	 * config UI editors.
	 */
	configParams?: StepConfigParam[];
	/**
	 * Default mapping: step-input field → graph-state field name.
	 * e.g. { messages: "messages", graphId: "graphId" }
	 *
	 * addStepNodes() uses this to auto-build mapInput for toNode().
	 * Fields absent from this map are expected to come from StepInstanceConfig.config,
	 * not from state (e.g. "content" on add-system comes from config).
	 */
	defaultStateMapping?: Record<string, string>;
	/**
	 * If true, buildDefaultFlowConfig() marks this step enabled by default
	 * when constructing a fresh flow config for its graph type.
	 */
	enabledByDefault?: boolean;
	/**
	 * When set, resolveStepOrder() automatically injects this step immediately
	 * after the named step in every graph's stepOrder (if not already present).
	 * The step does not need to be listed in any graph's stepOrder.
	 */
	injectAfter?: string;
	/** Engine-level feature discovery metadata for feature steps. */
	feature?: StepFeatureMetadata;
	/**
	 * LangGraph annotation fields this step writes to graph state.
	 * Spread into the graph annotation before StateGraph is constructed so
	 * the state shape is derived from the enabled step set, not hardcoded.
	 *
	 * Shape: plain object of Annotation<T>({value, default}) entries —
	 * same format as the fields inside FoundationAnnotation / BaseAnnotation.
	 */
	stateAnnotation?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Global type registry
// ---------------------------------------------------------------------------

// Global step type registry for smart type inference.
// Step modules extend this interface to register their step types and required services.
declare global {
	interface StepTypeRegistry {
		// Empty by default — steps extend this interface.
		// Example:
		// "extract-entities": {
		//   input: ExtractInput;
		//   output: ExtractOutput;
		//   services: Pick<AllServices, "llm">;
		//   config: undefined;
		// };
	}
}

// Internal storage type — carries both factory and optional metadata
type StoredEntry = {
	id: string;
	name: string;
	factory?: (
		services: unknown,
		config?: unknown,
		context?: StepFactoryContext,
	) => BoundStep<unknown, unknown>;
	config?: StepMeta;
};

type SemverParts = {
	major: number;
	minor: number;
	patch: number;
	prerelease: string[];
};

const FALLBACK_VERSION = "0.0.0";

const parseSemver = (version: string | undefined): SemverParts => {
	const match = (version ?? FALLBACK_VERSION)
		.trim()
		.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);

	if (!match) {
		return { major: 0, minor: 0, patch: 0, prerelease: [] };
	}

	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4]?.split(".") ?? [],
	};
};

const comparePrereleaseIdentifier = (left: string, right: string): number => {
	const leftNumber = /^\d+$/.test(left) ? Number(left) : undefined;
	const rightNumber = /^\d+$/.test(right) ? Number(right) : undefined;

	if (leftNumber !== undefined && rightNumber !== undefined) {
		return Math.sign(leftNumber - rightNumber);
	}
	if (leftNumber !== undefined) return -1;
	if (rightNumber !== undefined) return 1;
	return left.localeCompare(right);
};

const compareSemver = (
	leftVersion: string | undefined,
	rightVersion: string | undefined,
): number => {
	const left = parseSemver(leftVersion);
	const right = parseSemver(rightVersion);

	for (const key of ["major", "minor", "patch"] as const) {
		const diff = left[key] - right[key];
		if (diff !== 0) return Math.sign(diff);
	}

	if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
	if (left.prerelease.length === 0) return 1;
	if (right.prerelease.length === 0) return -1;

	const maxLength = Math.max(left.prerelease.length, right.prerelease.length);
	for (let index = 0; index < maxLength; index += 1) {
		const leftPart = left.prerelease[index];
		const rightPart = right.prerelease[index];
		if (leftPart === undefined) return -1;
		if (rightPart === undefined) return 1;
		const diff = comparePrereleaseIdentifier(leftPart, rightPart);
		if (diff !== 0) return Math.sign(diff);
	}

	return 0;
};

export interface StepRegistration<T extends keyof StepTypeRegistry & string> {
	id: T;
	name: string;
	factory?: StepTypeRegistry[T] extends StepSpec
		? StepFactory<
				StepTypeRegistry[T]["input"],
				StepTypeRegistry[T]["output"],
				StepTypeRegistry[T]["services"],
				StepTypeRegistry[T]["config"]
			>
		: never;
	config?: StepMeta;
}

export type RegisteredStep = StoredEntry;

export type StepRegistryPredicate = (entry: RegisteredStep) => boolean;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export class StepRegistryManager {
	private static instance: StepRegistryManager;
	private entries = new Map<string, StoredEntry>();
	private versionedEntries = new Map<string, Map<string, StoredEntry>>();
	private finalized = false;

	constructor() {}

	private assertMutable(action: string): void {
		if (this.finalized) {
			throw new Error(`[StepRegistry] Cannot ${action} after finalization`);
		}
	}

	finalize(): this {
		this.finalized = true;
		return this;
	}

	isFinalized(): boolean {
		return this.finalized;
	}

	static getInstance(): StepRegistryManager {
		if (!StepRegistryManager.instance) {
			StepRegistryManager.instance = new StepRegistryManager();
		}
		return StepRegistryManager.instance;
	}

	/**
	 * Register a step factory with optional metadata.
	 */
	register<T extends keyof StepTypeRegistry & string>(
		stepName: T,
		meta: StepMeta,
	): void;
	register<T extends keyof StepTypeRegistry & string>(
		stepName: T,
		factory: StepTypeRegistry[T] extends StepSpec
			? StepFactory<
					StepTypeRegistry[T]["input"],
					StepTypeRegistry[T]["output"],
					StepTypeRegistry[T]["services"],
					StepTypeRegistry[T]["config"]
				>
			: never,
		meta?: StepMeta,
	): void;
	register<T extends keyof StepTypeRegistry & string>(
		stepName: T,
		factoryOrMeta?:
			| (StepTypeRegistry[T] extends StepSpec
					? StepFactory<
							StepTypeRegistry[T]["input"],
							StepTypeRegistry[T]["output"],
							StepTypeRegistry[T]["services"],
							StepTypeRegistry[T]["config"]
						>
					: never)
			| StepMeta,
		meta?: StepMeta,
	): void {
		this.assertMutable("register step");
		const isFactory = typeof factoryOrMeta === "function";
		const registration = {
			id: stepName,
			name: stepName,
			factory: isFactory
				? (factoryOrMeta as StepRegistration<T>["factory"])
				: undefined,
			config: isFactory ? meta : (factoryOrMeta as StepMeta | undefined),
		};
		const normalizedFactory = registration.factory
			? (
					services: unknown,
					config?: unknown,
					context?: StepFactoryContext,
				): BoundStep<unknown, unknown> =>
					(
						registration.factory as (
							s: unknown,
							c?: unknown,
							context?: StepFactoryContext,
						) => BoundStep<unknown, unknown>
					)(services, config, context)
			: undefined;
		const id = registration.id as string;
		const nextVersion = registration.config?.version ?? FALLBACK_VERSION;
		const versions = this.versionedEntries.get(id) ?? new Map();
		const existingVersionEntry = versions.get(nextVersion);
		const nextEntry: StoredEntry = {
			...existingVersionEntry,
			id,
			name: registration.name ?? existingVersionEntry?.name ?? id,
			factory: normalizedFactory ?? existingVersionEntry?.factory,
			config: registration.config ?? existingVersionEntry?.config,
		};
		versions.set(nextVersion, nextEntry);
		this.versionedEntries.set(id, versions);

		const existing = this.entries.get(id);
		const existingVersion = existing?.config?.version ?? FALLBACK_VERSION;
		if (!existing || compareSemver(nextVersion, existingVersion) >= 0) {
			this.entries.set(id, nextEntry);
		}
	}

	setEntry(entry: RegisteredStep): void {
		this.assertMutable("set entry");
		const version = entry.config?.version ?? FALLBACK_VERSION;
		const versions = this.versionedEntries.get(entry.id) ?? new Map();
		const nextEntry = {
			...entry,
			config: entry.config ? { ...entry.config } : undefined,
		};
		versions.set(version, nextEntry);
		this.versionedEntries.set(entry.id, versions);

		const existing = this.entries.get(entry.id);
		const existingVersion = existing?.config?.version ?? FALLBACK_VERSION;
		if (!existing || compareSemver(version, existingVersion) >= 0) {
			this.entries.set(entry.id, nextEntry);
		}
	}

	/**
	 * Get a bound step instance with services (type-safe version).
	 */
	getStep<T extends keyof StepTypeRegistry & string>(
		stepName: T,
		...args: StepTypeRegistry[T] extends StepSpec
			? StepTypeRegistry[T]["services"] extends undefined
				? []
				: [
						services: StepTypeRegistry[T]["services"],
						config?: StepTypeRegistry[T]["config"],
					]
			: [services?: unknown, config?: unknown]
	): StepTypeRegistry[T] extends StepSpec
		? BoundStep<StepTypeRegistry[T]["input"], StepTypeRegistry[T]["output"]>
		: BoundStep<unknown, unknown> {
		const entry = this.entries.get(stepName as string);
		if (!entry) {
			throw new Error(`No step registered for name: ${String(stepName)}`);
		}
		if (!entry.factory) {
			throw new Error(`Step has no executable factory: ${String(stepName)}`);
		}
		const [services, config] = args as [unknown, unknown];
		return entry.factory(
			services,
			config,
		) as StepTypeRegistry[T] extends StepSpec
			? BoundStep<StepTypeRegistry[T]["input"], StepTypeRegistry[T]["output"]>
			: BoundStep<unknown, unknown>;
	}

	/**
	 * Get a specific registered version of a bound step instance.
	 */
	getStepVersion<T extends keyof StepTypeRegistry & string>(
		stepName: T,
		version: string,
		...args: StepTypeRegistry[T] extends StepSpec
			? StepTypeRegistry[T]["services"] extends undefined
				? []
				: [
						services: StepTypeRegistry[T]["services"],
						config?: StepTypeRegistry[T]["config"],
					]
			: [services?: unknown, config?: unknown]
	): StepTypeRegistry[T] extends StepSpec
		? BoundStep<StepTypeRegistry[T]["input"], StepTypeRegistry[T]["output"]>
		: BoundStep<unknown, unknown> {
		const entry = this.getVersion(stepName as string, version);
		if (!entry) {
			throw new Error(
				`No step registered for name: ${String(stepName)} at version: ${version}`,
			);
		}
		if (!entry.factory) {
			throw new Error(
				`Step has no executable factory: ${String(stepName)} at version: ${version}`,
			);
		}
		const [services, config] = args as [unknown, unknown];
		return entry.factory(
			services,
			config,
		) as StepTypeRegistry[T] extends StepSpec
			? BoundStep<StepTypeRegistry[T]["input"], StepTypeRegistry[T]["output"]>
			: BoundStep<unknown, unknown>;
	}

	/**
	 * Get a step by name (loose typing for dynamic/runtime access).
	 */
	getStepByName<TInput = unknown, TOutput = unknown>(
		stepName: string,
		services?: unknown,
		config?: unknown,
		context?: StepFactoryContext,
	): BoundStep<TInput, TOutput> {
		const entry = this.entries.get(stepName);
		if (!entry) {
			throw new Error(`No step registered for name: ${stepName}`);
		}
		if (!entry.factory) {
			throw new Error(`Step has no executable factory: ${stepName}`);
		}
		return entry.factory(services, config, context) as BoundStep<
			TInput,
			TOutput
		>;
	}

	/**
	 * Get a specific registered version of a step by name.
	 */
	getStepByNameVersion<TInput = unknown, TOutput = unknown>(
		stepName: string,
		version: string,
		services?: unknown,
		config?: unknown,
		context?: StepFactoryContext,
	): BoundStep<TInput, TOutput> {
		const entry = this.getVersion(stepName, version);
		if (!entry) {
			throw new Error(
				`No step registered for name: ${stepName} at version: ${version}`,
			);
		}
		if (!entry.factory) {
			throw new Error(
				`Step has no executable factory: ${stepName} at version: ${version}`,
			);
		}
		return entry.factory(services, config, context) as BoundStep<
			TInput,
			TOutput
		>;
	}

	/**
	 * Retrieve the metadata registered alongside a step, if any.
	 */
	getMeta(stepName: string, version?: string): StepMeta | undefined {
		return version
			? this.getVersion(stepName, version)?.config
			: this.entries.get(stepName)?.config;
	}

	/** Get all registered step names. */
	getRegisteredStepNames(): string[] {
		return Array.from(this.entries.keys());
	}

	/** Check if a step is registered. */
	hasStep(stepName: string): boolean {
		return this.entries.has(stepName);
	}

	hasExecutableStep(stepName: string): boolean {
		return Boolean(this.entries.get(stepName)?.factory);
	}

	get(id: string): RegisteredStep | undefined {
		return this.entries.get(id);
	}

	getVersion(id: string, version: string): RegisteredStep | undefined {
		return this.versionedEntries.get(id)?.get(version);
	}

	getVersions(id: string): RegisteredStep[] {
		return Array.from(this.versionedEntries.get(id)?.values() ?? []).sort(
			(left, right) =>
				compareSemver(
					right.config?.version ?? FALLBACK_VERSION,
					left.config?.version ?? FALLBACK_VERSION,
				),
		);
	}

	hasVersion(id: string, version: string): boolean {
		return Boolean(this.getVersion(id, version));
	}

	getAll(): RegisteredStep[] {
		return Array.from(this.entries.values());
	}

	getAllVersions(): RegisteredStep[] {
		return Array.from(this.versionedEntries.values()).flatMap((versions) =>
			Array.from(versions.values()),
		);
	}

	has(id: string): boolean {
		return this.hasStep(id);
	}

	clear(): void {
		this.assertMutable("clear registry");
		this.entries.clear();
		this.versionedEntries.clear();
	}

	fork(predicate?: StepRegistryPredicate): StepRegistryManager {
		const next = new StepRegistryManager();
		for (const entry of this.getAllVersions()) {
			if (!predicate || predicate(entry)) {
				next.setEntry(entry);
			}
		}
		return next;
	}

	/** Returns all steps that declare injectAfter, keyed by the anchor step name. */
	getInjectableSteps(): Map<string, string[]> {
		const map = new Map<string, string[]>();
		for (const [name, entry] of this.entries) {
			const anchor = entry.config?.injectAfter;
			if (anchor) {
				const list = map.get(anchor) ?? [];
				list.push(name);
				map.set(anchor, list);
			}
		}
		return map;
	}
}

export const stepRegistry = StepRegistryManager.getInstance();
