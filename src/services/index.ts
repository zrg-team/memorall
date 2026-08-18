import "@memorall/agent-harness-flows";
import "@/services/flows-memory";
import "@/services/flows-integrations";
import "@/services/flows-features";
import { ServiceManager } from "./service-manager";
import { registerLegacyFlowLogger } from "./flow-service-adapters";

registerLegacyFlowLogger();

// Export singleton instance
export const serviceManager = ServiceManager.getInstance();

export * from "./sandbox-container";
export * from "./agent-sandbox";
export * from "./web-browser";
export * from "./cron-jobs";
