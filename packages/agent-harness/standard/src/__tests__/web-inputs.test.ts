import { describe, expect, it } from "vitest";
import { toolSchemaToJsonSchema } from "@memorall/agent-harness-core";
import { createWebTools } from "../web/tools.js";

const tool = (name: string) =>
	createWebTools().find((value) => value.name === name)!;

describe("provider-neutral web tools accept optional placeholders", () => {
	it.each([
		{
			name: "web_open",
			input: {
				url: " https://example.test/ ",
				presentation: "",
				persist: null,
			},
		},
		{
			name: "web_read",
			input: {
				sessionId: "s1",
				url: "",
				presentation: null,
				selector: "",
				contentMode: "",
				maxChars: "",
			},
		},
		{
			name: "web_search",
			input: {
				sessionId: "s1",
				pattern: "term",
				regex: "",
				caseSensitive: null,
				maxResults: "",
			},
		},
		{
			name: "web_dom",
			input: {
				sessionId: "s1",
				operation: "query",
				selector: "",
				action: "",
				value: null,
				index: "",
				maxResults: "",
			},
		},
		{
			name: "web_wait",
			input: {
				sessionId: "s1",
				kind: "",
				selector: " ",
				state: null,
				timeoutMs: "",
			},
		},
	])("$name parses a usable call", ({ name, input }) => {
		expect(() => tool(name).schema.parse(input)).not.toThrow();
		expect(toolSchemaToJsonSchema(tool(name).schema)).toMatchObject({
			type: "object",
			properties: expect.any(Object),
		});
	});

	it("ignores unused URLs for a session and clamps result limits", () => {
		expect(
			tool("web_read").schema.parse({
				sessionId: "s1",
				url: "not-used",
				maxChars: "2000000",
			}),
		).toMatchObject({ sessionId: "s1", maxChars: 1_000_000 });
		expect(
			tool("web_search").schema.parse({
				sessionId: "s1",
				pattern: "term",
				maxResults: "-3",
				regex: "false",
			}),
		).toMatchObject({ maxResults: 1, regex: false });
	});

	it("keeps text input unchanged and keeps necessary selector checks", () => {
		expect(
			tool("web_dom").schema.parse({
				sessionId: "s1",
				operation: "action",
				action: "input",
				selector: "#name",
				value: "",
			}),
		).toHaveProperty("value", "");
		expect(() =>
			tool("web_dom").schema.parse({
				sessionId: "s1",
				operation: "action",
				action: "click",
			}),
		).toThrow("selector");
		expect(() =>
			tool("web_wait").schema.parse({
				sessionId: "s1",
				kind: "selector",
				selector: "",
			}),
		).toThrow("selector");
		expect(() => tool("web_open").schema.parse({ url: "not-a-url" })).toThrow();
	});
});
