/**
 * Memorall-owned compatibility runtime for stored graph, step, and tool IDs.
 * New reusable harness code belongs under packages/agent-harness.
 */

// Trigger self-registration (graphs, steps, tools)
import "@/services/flows-core/interfaces/services/index";
import "@/services/flows-core/graph";
import "@/services/flows-core/steps";
import "@/services/flows-core/tools";

let registered = false;

export function register(): void {
	if (registered) return;
	registered = true;
}

register();

// Interfaces
export * from "@/services/flows-core/interfaces/index";

// Registries
export * from "@/services/flows-core/registries/index";

// Graph (foundation + agent only)
export * from "@/services/flows-core/graph/index";

// Runtime
export * from "@/services/flows-core/runtime/runtime-context";
export * from "@/services/flows-core/runtime/flow-engine";

// Utils
export * from "@/services/flows-core/utils/index";

// Steps common
export * from "@/services/flows-core/steps/common/index";
