// Import handlers to trigger self-registration
import "./process-remember-save";
import "./process-basic";
import "./process-embedding-operations";
import "./process-knowledge-graph";
import "./process-llm-operations";
import "./process-restore-local-services";
import "./process-topic-operations";

export { backgroundProcessFactory, ProcessFactory } from "./process-factory";
export { handlerRegistry } from "./handler-registry";
export type { HandlerRegistration } from "./handler-registry";
