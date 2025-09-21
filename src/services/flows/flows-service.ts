import { SimpleGraph } from "./graph/simple/graph";
import { KnowledgeGraphFlow } from "./graph/knowledge/graph";
import { KnowledgeRAGFlow } from "./graph/knowledge-rag/graph";
import { logInfo } from "@/utils/logger";
import type { AllServices } from "./interfaces/tool";

// Type mapping for graph types and their required services
interface SimpleGraphServices extends AllServices {}

interface KnowledgeGraphServices extends AllServices {}

interface KnowledgeRAGServices extends AllServices {}

// Graph registry with proper type mapping
interface GraphRegistry {
	simple: {
		services: SimpleGraphServices;
		graph: SimpleGraph;
	};
	knowledge: {
		services: KnowledgeGraphServices;
		graph: KnowledgeGraphFlow;
	};
	"knowledge-rag": {
		services: KnowledgeRAGServices;
		graph: KnowledgeRAGFlow;
	};
}

export class FlowsService {
	private static instance: FlowsService;

	private constructor() {}

	static getInstance(): FlowsService {
		if (!FlowsService.instance) {
			FlowsService.instance = new FlowsService();
		}
		return FlowsService.instance;
	}

	async initialize(): Promise<void> {
		logInfo("🔄 Initializing Flows service...");
		logInfo("✅ Flows service initialized");
	}

	// Type-safe graph creation with proper service verification
	createGraph<K extends keyof GraphRegistry>(
		graphType: K,
		services: GraphRegistry[K]["services"],
	): GraphRegistry[K]["graph"] {
		switch (graphType) {
			case "simple":
				return new SimpleGraph(
					services as SimpleGraphServices,
				) as GraphRegistry[K]["graph"];
			case "knowledge":
				return new KnowledgeGraphFlow(
					services as KnowledgeGraphServices,
				) as GraphRegistry[K]["graph"];
			case "knowledge-rag":
				return new KnowledgeRAGFlow(
					services as KnowledgeRAGServices,
				) as GraphRegistry[K]["graph"];
			default:
				throw new Error(`Unknown graph type: ${graphType}`);
		}
	}
}

export const flowsService = FlowsService.getInstance();
