/**
 * The registry set, named without importing it.
 *
 * A step receives the registries it may consult, so `step.ts` has to name their
 * type — but the registries are built on top of steps, so importing the
 * concrete set from here would close a loop between the two layers.
 *
 * The shape is declared globally and filled in by `registries/registry-set.ts`,
 * the same way `ToolTypeRegistry` is filled in by each tool. Consumers get the
 * full, concrete types; the dependency only ever points one way.
 */

declare global {
	// Augmented by registries/registry-set.ts.
	interface FlowRegistrySetContract {}
}

export type FlowRegistries = FlowRegistrySetContract;

export {};
