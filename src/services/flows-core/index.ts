/**
 * flows-core — the extractable engine.
 * Import once in the app entry point to activate graph types and steps.
 */

// Trigger self-registration (graphs, steps, tools)
import "flow-core/interfaces/services/index";
import "flow-core/graph";
import "flow-core/steps";
import "flow-core/tools";

let registered = false;

export function register(): void {
	if (registered) return;
	registered = true;
}

register();

// Interfaces
export * from "flow-core/interfaces/index";

// Registries
export * from "flow-core/registries/index";

// Graph (foundation + agent only)
export * from "flow-core/graph/index";

// Runtime
export * from "flow-core/runtime/runtime-context";
export * from "flow-core/runtime/flow-engine";

// Utils
export * from "flow-core/utils/index";

// Steps common
export * from "flow-core/steps/common/index";
