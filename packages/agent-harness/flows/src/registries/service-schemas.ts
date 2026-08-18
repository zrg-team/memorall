/**
 * Service schemas, declared where the registry lives.
 *
 * These used to sit beside each service interface, which made
 * `interfaces/services/*` import the registry and put a cycle between the two
 * layers — a contract cannot depend on the thing that collects contracts.
 * The interfaces are pure types again; the registrations live here.
 *
 * Importing this module is what registers them.
 */

import { serviceRegistry } from "./service-registry.js";

serviceRegistry.registerSchema("sandboxRuntime", {
	name: "Agent Sandbox Runtime",
	config: { required: false, category: "core" },
	metadata: {
		description: "Provider-neutral sandbox sessions and agent runtime tools",
	},
});

serviceRegistry.registerSchema("fs", {
	name: "Filesystem",
	config: { required: false, category: "core" },
	metadata: { description: "Flow filesystem service" },
});

serviceRegistry.registerSchema("flowCatalog", {
	name: "Flow Catalog Service",
	config: { required: false, category: "core" },
	metadata: { description: "Saved flow lookup service" },
});

serviceRegistry.registerSchema("llm", {
	name: "LLM",
	config: { required: true, category: "core" },
	metadata: { description: "Large language model service" },
});

serviceRegistry.registerSchema("logger", {
	name: "Logger",
	config: { required: true, category: "core" },
	metadata: { description: "Flow logging service" },
});

serviceRegistry.registerSchema("sandboxContainer", {
	name: "Sandbox Container",
	config: { required: false, category: "core" },
	metadata: { description: "Sandbox command and server execution service" },
});

serviceRegistry.registerSchema("skillService", {
	name: "Skill Service",
	config: { required: false, category: "core" },
	metadata: { description: "Skill discovery and loading service" },
});

serviceRegistry.registerSchema("webBrowser", {
	name: "Web Browser",
	config: { required: false, category: "core" },
	metadata: { description: "Browser automation and DOM access service" },
});
