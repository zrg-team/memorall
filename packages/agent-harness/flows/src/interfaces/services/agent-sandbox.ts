import type { IAgentSandboxService } from "@memorall/agent-harness-sandbox";

export * from "@memorall/agent-harness-sandbox";

// Legacy registry compatibility. New harness instances bind SANDBOX_SERVICE
// explicitly and do not execute this module-level registration.

declare global {
	interface ServiceRegistry {
		sandboxRuntime?: IAgentSandboxService;
	}
}
