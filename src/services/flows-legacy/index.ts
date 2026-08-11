/**
 * Memorall-owned compatibility runtime for stored graph, step, and tool IDs.
 * New reusable harness code belongs under packages/agent-harness.
 */

// Trigger self-registration (graphs, steps, tools)
import "@/services/flows-legacy/interfaces/services/index";
import "@/services/flows-legacy/graph";
import "@/services/flows-legacy/steps";
import "@/services/flows-legacy/tools";

let registered = false;

export function register(): void {
	if (registered) return;
	registered = true;
}

register();

// Interfaces
export * from "@/services/flows-legacy/interfaces/index";

// Registries
export * from "@/services/flows-legacy/registries/index";

// Graph (foundation + agent only)
export * from "@/services/flows-legacy/graph/index";

// Runtime
export * from "@/services/flows-legacy/runtime/runtime-context";
export * from "@/services/flows-legacy/runtime/flow-engine";

// Utils
export * from "@/services/flows-legacy/utils/index";

// Steps common
export * from "@/services/flows-legacy/steps/common/index";
