/**
 * flows-memory — knowledge graph, RAG, and structured memory.
 * Import once in the main app entry point to activate all memory capabilities.
 */

// Service registry augmentation (must be first)
import "./services";

let registered = false;

export function register(): void {
	if (registered) return;
	registered = true;
}

register();

// Interfaces
export * from "./interfaces/index";

// Graph registrations (side-effect: registers graph types with graphRegistry)
import "./graph/knowledge/graph";
import "./graph/structmem/graph";
export * from "./graph/knowledge/index";
export * from "./graph/structmem/index";

// Step registrations (side-effect)
import "./steps/features/index";
import "./steps/structmem/structmem-consolidation";
import "./steps/structmem/structmem-event-extraction";
import "./steps/structmem/structmem-load-related-events";
import "./steps/structmem/structmem-retrieve";
import "./steps/structmem/structmem-save-consolidation";
import "./steps/structmem/structmem-save-event";

// Tool registrations (side-effect)
import "./tools/active-memory/index";
import "./tools/knowledge-graph";
import "./tools/knowledge-graph-write";

// Utils
export * from "./utils/index";
