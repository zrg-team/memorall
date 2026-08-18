import type { IDocumentProcessor } from "./interfaces/document-processor";
import { serviceRegistry } from "@memorall/agent-harness-flows/registries/service-registry";

serviceRegistry.registerSchema("documentProcessor", {
	name: "Document Processor",
	config: { required: false, category: "integrations" },
	metadata: { description: "Document parsing and conversion service" },
});

declare global {
	interface ServiceRegistry {
		documentProcessor?: IDocumentProcessor;
	}
}

export {};
