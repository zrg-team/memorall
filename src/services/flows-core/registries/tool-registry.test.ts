import { describe, expect, it } from "vitest";
import { z } from "zod";
import { jsonToolSchema } from "flow-core/interfaces/engine/tool";
import {
	convertToolsToOpenAI,
	type RegisteredTool,
	ToolRegistryManager,
} from "flow-core/registries/tool-registry";
import type { BaseTool } from "flow-core/interfaces/engine/tool";

declare global {
	interface ToolTypeRegistry {
		validated_tool: {
			input: { value: string };
			services: void;
			config: void;
		};
	}
}

const baseTool = (schema: BaseTool["schema"]): BaseTool => ({
	name: "schema_tool",
	description: "Schema conversion test tool",
	schema,
	execute: async () => "ok",
});

describe("tool schema conversion", () => {
	it("converts common Zod schemas into OpenAI tool parameters", () => {
		const [tool] = convertToolsToOpenAI([
			baseTool(
				z.object({
					query: z.string(),
					count: z.number().optional(),
					mode: z.enum(["fast", "slow"]),
					tags: z.array(z.string()),
					metadata: z.record(z.string(), z.number()),
					id: z.union([z.string(), z.number()]),
				}),
			),
		]);

		expect(tool.function.parameters).toEqual({
			type: "object",
			properties: {
				query: { type: "string" },
				count: { type: "number" },
				mode: { type: "string", enum: ["fast", "slow"] },
				tags: { type: "array", items: { type: "string" } },
				metadata: {
					type: "object",
					additionalProperties: { type: "number" },
				},
				id: {
					anyOf: [{ type: "string" }, { type: "number" }],
				},
			},
			required: ["query", "mode", "tags", "metadata", "id"],
		});
	});

	it("passes explicit JSON schemas through unchanged", () => {
		const jsonSchema = {
			type: "object",
			properties: {
				raw: { type: "string" },
			},
			required: ["raw"],
			additionalProperties: false,
		};

		const [tool] = convertToolsToOpenAI([baseTool(jsonToolSchema(jsonSchema))]);

		expect(tool.function.parameters).toEqual(jsonSchema);
	});
});

describe("tool registry execution", () => {
	it("validates tool input before execution", async () => {
		const registry = new ToolRegistryManager();
		let received: unknown;

		registry.setEntry({
			id: "validated_tool",
			name: "validated_tool",
			factory: () => ({
				name: "validated_tool",
				description: "Validates input",
				schema: z.object({ value: z.string() }),
				execute: async (input) => {
					received = input;
					return "done";
				},
			}),
			config: {},
			metadata: {},
		} satisfies RegisteredTool);

		await expect(
			registry.executeToolByName(
				"validated_tool",
				{ value: 123 } as unknown as { value: string },
				undefined,
			),
		).rejects.toThrow();

		await expect(
			registry.executeToolByName("validated_tool", { value: "ok" }, undefined),
		).resolves.toBe("done");
		expect(received).toEqual({ value: "ok" });
	});
});
