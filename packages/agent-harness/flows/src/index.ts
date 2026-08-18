/**
 * The flow engine: registries, graphs, steps and tools.
 *
 * Importing this module is what registers them — see the package README before
 * re-exporting it from anywhere that claims to be side-effect free.
 */

// Trigger self-registration (graphs, steps, tools)
import "./interfaces/services/index.js";
import "./graph/index.js";
import "./steps/index.js";
import "./tools/index.js";

let registered = false;

export function register(): void {
	if (registered) return;
	registered = true;
}

register();

// Interfaces
export * from "./interfaces/index.js";

// Registries
export * from "./registries/index.js";

// Graph (foundation + agent only)
export * from "./graph/index.js";

// Runtime
export * from "./runtime/runtime-context.js";
export * from "./runtime/flow-engine.js";

// Utils
export * from "./utils/index.js";

// Steps common
export * from "./steps/common/index.js";
