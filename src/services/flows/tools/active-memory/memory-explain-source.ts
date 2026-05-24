import { getKnowledgeDatabase } from "../../interfaces/knowledge";
import z from "zod";
import { eq } from "drizzle-orm";
import type { Tool, ToolFactory } from "../../interfaces/tool";
import { toolRegistry } from "../../tool-registry";
import {
	findMemoryFacts,
	resolveRuntimeGraphId,
	type ActiveMemoryServices,
} from "./shared";

const TOOL_NAME = "memory_explain_source" as const;

const schema = z.object({
	edgeId: z.string().min(1).describe("Memory edge id to explain"),
});

type Input = z.infer<typeof schema>;

export const createMemoryExplainSourceTool: ToolFactory<
	Input,
	ActiveMemoryServices
> = (services): Tool<Input> => ({
	name: TOOL_NAME,
	description:
		"Explain where a memory came from using its stored attributes and any source links available in the graph.",
	schema,
	execute: async (input, context) => {
		const facts = await findMemoryFacts(services, {
			graphId: resolveRuntimeGraphId(context),
			edgeId: input.edgeId,
			includeInactive: true,
			limit: 1,
		});
		const fact = facts[0];
		if (!fact) return "Memory not found.";

		const linkedSources = await getKnowledgeDatabase(services.database)
			.query(async ({ db, schema }) =>
				db
					.select({
						sourceId: schema.sources.id,
						sourceName: schema.sources.name,
						sourceType: schema.sources.type,
						relation: schema.sourceEdges.relation,
						metadata: schema.sources.metadata,
					})
					.from(schema.sourceEdges)
					.innerJoin(
						schema.sources,
						eq(schema.sourceEdges.sourceId, schema.sources.id),
					)
					.where(eq(schema.sourceEdges.edgeId, fact.edge.id))
					.limit(10),
			)
			.catch(() => []);

		const attributes =
			(fact.edge.attributes as Record<string, unknown> | null) ?? {};
		const lines = [
			`Memory ${fact.edge.id}`,
			`Fact: ${fact.edge.factText ?? ""}`,
			`Status: ${fact.edge.isCurrent === false ? "inactive" : "current"}`,
			`Origin: ${String(attributes.origin ?? "unknown")}`,
			`Kind: ${String(attributes.memoryKind ?? "unknown")}`,
			`Created by: ${String(attributes.createdBy ?? "unknown")}`,
			`Created from: ${String(attributes.createdFrom ?? "unknown")}`,
			`Created at: ${String(attributes.createdAt ?? fact.edge.createdAt)}`,
		];

		if (linkedSources.length > 0) {
			lines.push(`Source links: ${linkedSources.length}`);
		}

		return lines.join("\n");
	},
});

toolRegistry.register(TOOL_NAME, createMemoryExplainSourceTool);

declare global {
	interface ToolTypeRegistry {
		[TOOL_NAME]: {
			input: Input;
			services: ActiveMemoryServices;
		};
	}
}
