import { describe, expect, it } from "vitest";
import {
  annotateFreeFormObjects,
  dereferenceJsonSchema,
  type McpJsonSchema,
  normalizeToolInputSchema,
  simplifyJsonSchemaForLLM,
} from "../schema.js";

describe("dereferenceJsonSchema", () => {
  it("inlines $defs so a model never sees a $ref", () => {
    const result = dereferenceJsonSchema({
      type: "object",
      properties: { user: { $ref: "#/$defs/User" } },
      $defs: {
        User: { type: "object", properties: { id: { type: "string" } } },
      },
    });

    expect(result.properties).toEqual({
      user: { type: "object", properties: { id: { type: "string" } } },
    });
  });

  it("survives a self-referential definition instead of recursing forever", () => {
    const result = dereferenceJsonSchema({
      type: "object",
      properties: { node: { $ref: "#/$defs/Node" } },
      $defs: {
        Node: {
          type: "object",
          properties: { child: { $ref: "#/$defs/Node" } },
        },
      },
    });

    expect(result).toBeTruthy();
  });

  it("resolves a pointer that walks through a definition, not just its last segment", () => {
    const result = dereferenceJsonSchema({
      type: "object",
      properties: { payload: { $ref: "#/$defs/Outer/properties/inner" } },
      $defs: {
        Outer: {
          type: "object",
          properties: {
            inner: { type: "object", properties: { id: { type: "string" } } },
          },
        },
      },
    });

    expect(result.properties).toEqual({
      payload: { type: "object", properties: { id: { type: "string" } } },
    });
  });

  it("keeps definitions alive when a reference could not be inlined", () => {
    // Dropping `$defs` while a pointer into them survives leaves the model a
    // reference to nothing, which it can only fill in as `{}`.
    const result = dereferenceJsonSchema({
      type: "object",
      properties: { payload: { $ref: "#/components/schemas/Payload" } },
      $defs: { Other: { type: "object" } },
    });

    expect(result.properties).toEqual({
      payload: { $ref: "#/components/schemas/Payload" },
    });
    expect(result.$defs).toEqual({ Other: { type: "object" } });
  });
});

describe("simplifyJsonSchemaForLLM", () => {
  it("merges an anyOf union into one object shape", () => {
    const result = simplifyJsonSchemaForLLM({
      anyOf: [
        {
          type: "object",
          properties: { calendarId: { type: "string" } },
          required: ["calendarId"],
        },
        {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      ],
    });

    // Both branches' properties are offered; only what every branch demands
    // stays required, so the model is not told to satisfy contradictory rules.
    expect(
      Object.keys(result.properties as Record<string, unknown>).sort(),
    ).toEqual(["calendarId", "query"]);
    expect(result.required ?? []).toEqual([]);
    expect(result.anyOf).toBeUndefined();
  });

  it("folds if/then/else branches into plain properties", () => {
    const result = simplifyJsonSchemaForLLM({
      type: "object",
      properties: { mode: { type: "string" } },
      if: { properties: { mode: { const: "range" } } },
      then: {
        properties: { start: { type: "string" }, end: { type: "string" } },
      },
    });

    const properties = result.properties as Record<string, unknown>;
    expect(Object.keys(properties).sort()).toEqual(["end", "mode", "start"]);
    expect(result.if).toBeUndefined();
    expect(result.then).toBeUndefined();
  });

  it("drops keywords a model cannot act on", () => {
    const result = simplifyJsonSchemaForLLM({
      type: "object",
      properties: {},
      $schema: "https://json-schema.org/draft/2020-12/schema",
      unevaluatedProperties: false,
      not: { type: "string" },
    });

    expect(result.$schema).toBeUndefined();
    expect(result.unevaluatedProperties).toBeUndefined();
    expect(result.not).toBeUndefined();
  });

  it("keeps the usable branch of a nullable union instead of erasing its type", () => {
    // `Optional[str]` is how every Python MCP server writes an optional
    // argument; dropping the union left the property with no type at all.
    const result = simplifyJsonSchemaForLLM({
      anyOf: [{ type: "string" }, { type: "null" }],
      title: "Owner",
      description: "Repository owner",
    });

    expect(result).toEqual({
      type: "string",
      title: "Owner",
      description: "Repository owner",
    });
  });

  it("keeps a genuine multi-type union rather than dropping it", () => {
    const result = simplifyJsonSchemaForLLM({
      anyOf: [{ type: "string" }, { type: "number" }, { type: "null" }],
    });

    expect(result.anyOf).toEqual([{ type: "string" }, { type: "number" }]);
  });

  it("flattens a property of a typed object, not only the root", () => {
    // Recursion into `properties` was gated on the schema declaring no `type`,
    // which every real tool schema does declare — so nothing below the root was
    // ever flattened.
    const result = simplifyJsonSchemaForLLM({
      type: "object",
      properties: {
        filter: {
          allOf: [
            { type: "object", properties: { a: { type: "string" } } },
            { required: ["a"] },
          ],
        },
        owner: { anyOf: [{ type: "string" }, { type: "null" }] },
      },
    });

    expect(result.properties).toEqual({
      filter: {
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
      },
      owner: { type: "string" },
    });
  });
});

describe("normalizeToolInputSchema", () => {
  it("resolves references before flattening, so refs inside a union survive", () => {
    const result = normalizeToolInputSchema({
      anyOf: [{ $ref: "#/$defs/ById" }, { $ref: "#/$defs/ByQuery" }],
      $defs: {
        ById: { type: "object", properties: { id: { type: "string" } } },
        ByQuery: { type: "object", properties: { q: { type: "string" } } },
      },
    });

    expect(
      Object.keys(result.properties as Record<string, unknown>).sort(),
    ).toEqual(["id", "q"]);
  });

  it("inlines a reference nested inside a property so no $ref reaches the model", () => {
    const result = normalizeToolInputSchema({
      type: "object",
      properties: {
        tools: { type: "array", items: { $ref: "#/$defs/ToolExecuteRequest" } },
      },
      $defs: {
        ToolExecuteRequest: {
          type: "object",
          properties: {
            tool_slug: { type: "string" },
            arguments: { type: "object", additionalProperties: true },
          },
          required: ["tool_slug", "arguments"],
        },
      },
    });

    const properties = result.properties as Record<string, McpJsonSchema>;
    expect(properties.tools.items).toMatchObject({
      type: "object",
      properties: {
        tool_slug: { type: "string" },
        arguments: {
          type: "object",
          additionalProperties: true,
          description: expect.stringContaining("tool_slug"),
        },
      },
      required: ["tool_slug", "arguments"],
    });
    expect(JSON.stringify(result)).not.toContain("$ref");
  });
});

describe("annotateFreeFormObjects", () => {
  /*
   * `{"type":"object","additionalProperties":true}` with no properties is what
   * a tool router publishes for the parameters of whatever it is routing to.
   * `{}` satisfies it completely, so a model that writes nothing has complied
   * with the schema — and the call is refused for fields the schema never
   * named. The requirement has to be stated where a model will read it.
   */
  it("tells the model what an opaque parameter object is for, and names its target", () => {
    const result = annotateFreeFormObjects({
      type: "object",
      properties: {
        tool_slug: { type: "string" },
        arguments: {
          type: "object",
          additionalProperties: true,
          description: "The arguments to pass to the tool",
        },
      },
      required: ["tool_slug", "arguments"],
    });

    const args = (result.properties as Record<string, McpJsonSchema>).arguments;
    expect(args.description).toContain("The arguments to pass to the tool");
    expect(args.description).toContain("tool_slug");
    expect(args.description).toContain("An empty object is only correct");
    // Nothing about what the schema accepts changes: a tool that really takes
    // no parameters can still be called with `{}`.
    expect(args.minProperties).toBeUndefined();
    expect(args.additionalProperties).toBe(true);
  });

  it("reaches an opaque object nested inside array items", () => {
    const result = normalizeToolInputSchema({
      type: "object",
      properties: {
        tools: { type: "array", items: { $ref: "#/$defs/Call" } },
      },
      $defs: {
        Call: {
          type: "object",
          properties: {
            tool_slug: { type: "string" },
            arguments: { type: "object", additionalProperties: true },
          },
          required: ["tool_slug", "arguments"],
        },
      },
    });

    const items = (result.properties as Record<string, McpJsonSchema>).tools
      .items as McpJsonSchema;
    const args = (items.properties as Record<string, McpJsonSchema>).arguments;
    expect(args.description).toContain("tool_slug");
  });

  it("leaves a described object and a closed object alone", () => {
    const result = annotateFreeFormObjects({
      type: "object",
      properties: {
        known: { type: "object", properties: { a: { type: "string" } } },
        closed: { type: "object", additionalProperties: false, properties: {} },
        owner: { type: "string", description: "Repository owner" },
      },
    });

    const properties = result.properties as Record<string, McpJsonSchema>;
    expect(properties.known.description).toBeUndefined();
    expect(properties.closed.description).toBeUndefined();
    expect(properties.owner.description).toBe("Repository owner");
  });

  it("does not stack the same hint when a schema is normalized twice", () => {
    const once = normalizeToolInputSchema({
      type: "object",
      properties: {
        tool_slug: { type: "string" },
        arguments: { type: "object", additionalProperties: true },
      },
    });
    const twice = normalizeToolInputSchema(once);

    const first = (once.properties as Record<string, McpJsonSchema>).arguments;
    const second = (twice.properties as Record<string, McpJsonSchema>).arguments;
    expect(second.description).toBe(first.description);
  });
});
