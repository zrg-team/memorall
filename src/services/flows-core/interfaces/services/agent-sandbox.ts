import type { IAgentSandboxService } from "@memorall/agent-harness-sandbox";
import { serviceRegistry } from "@/services/flows-core/registries/service-registry";

export * from "@memorall/agent-harness-sandbox";

// Legacy registry compatibility. New harness instances bind SANDBOX_SERVICE
// explicitly and do not execute this module-level registration.
serviceRegistry.registerSchema("sandboxRuntime", {
	name: "Agent Sandbox Runtime",
	config: { required: false, category: "core" },
	metadata: {
		description: "Provider-neutral sandbox sessions and agent runtime tools",
	},
});

declare global {
	interface ServiceRegistry {
		sandboxRuntime?: IAgentSandboxService;
	}
}
