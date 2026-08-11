import type { IFlowDatabase } from "./interfaces/database";
import type { IFlowEmbeddingService } from "./interfaces/embedding";
import { serviceRegistry } from "@/services/flows-legacy/registries/service-registry";

serviceRegistry.registerSchema("database", {
	name: "Database",
	config: { required: true, category: "memory" },
	metadata: { description: "Knowledge graph and memory database service" },
});

serviceRegistry.registerSchema("embedding", {
	name: "Embedding",
	config: { required: true, category: "memory" },
	metadata: { description: "Vector embedding service" },
});

declare global {
	interface ServiceRegistry {
		/** Required when using flows-memory — database with knowledge graph support */
		database: IFlowDatabase;
		/** Required when using flows-memory — vector embedding service */
		embedding: IFlowEmbeddingService;
	}
}

export {};
