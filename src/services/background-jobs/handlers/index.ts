// Import handlers to trigger self-registration
import "./process-remember-save";
import "./process-basic";
import "./process-embedding-operations";
import "./process-knowledge-graph";
import "./process-llm-operations";
import "./process-media-operations";
import "./process-topic-operations";
import "./process-flow-operations";
import "./process-chat";
import "./process-embedded-chat-history";
import "./process-cron-operations";
import "./process-cron-trigger";
import "./process-activity-tracking";
import "./process-sandbox-operations";
import "./process-web-browser-operations";

export { backgroundProcessFactory, ProcessFactory } from "./process-factory";
export { handlerRegistry } from "./handler-registry";
export type { HandlerRegistration } from "./handler-registry";
