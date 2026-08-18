import { describe, expect, it } from "vitest";
import {
  dereferenceJsonSchema,
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
});
