import { describe, expect, it } from "vitest";
import { deepEqual } from "../deep-equal";

describe("deepEqual", () => {
	it("compares primitives", () => {
		expect(deepEqual(1, 1)).toBe(true);
		expect(deepEqual("a", "a")).toBe(true);
		expect(deepEqual(true, false)).toBe(false);
		expect(deepEqual(1, "1")).toBe(false);
		expect(deepEqual(null, null)).toBe(true);
		expect(deepEqual(null, undefined)).toBe(false);
	});

	it("compares string arrays order-sensitively (like the dirty check needs)", () => {
		expect(deepEqual(["a", "b"], ["a", "b"])).toBe(true);
		expect(deepEqual(["a", "b"], ["b", "a"])).toBe(false);
		expect(deepEqual(["a"], ["a", "b"])).toBe(false);
		expect(deepEqual([], [])).toBe(true);
	});

	it("compares nested objects regardless of key order", () => {
		expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
		expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
		expect(deepEqual({ a: { c: 1 } }, { a: { c: 1 } })).toBe(true);
		expect(deepEqual({ a: { c: 1 } }, { a: { c: 2 } })).toBe(false);
	});

	it("handles arrays of objects (e.g. MCP server configs)", () => {
		const a = [{ type: "http", name: "x", url: "u" }];
		const b = [{ type: "http", name: "x", url: "u" }];
		expect(deepEqual(a, b)).toBe(true);
		expect(deepEqual(a, [{ type: "http", name: "y", url: "u" }])).toBe(false);
		expect(deepEqual(a, [])).toBe(false);
	});

	it("does not treat objects and arrays as equal", () => {
		expect(deepEqual({ 0: "a", length: 1 }, ["a"])).toBe(false);
		expect(deepEqual([], {})).toBe(false);
	});

	it("agrees with JSON.stringify equality for typical config data", () => {
		const saved = {
			systemPrompt: "hello",
			tools: ["current_time", "search"],
			enableCitations: true,
		};
		const sameDraft = {
			systemPrompt: "hello",
			tools: ["current_time", "search"],
			enableCitations: true,
		};
		const editedDraft = { ...saved, systemPrompt: "hello world" };
		expect(deepEqual(saved, sameDraft)).toBe(true);
		expect(deepEqual(saved, editedDraft)).toBe(false);
	});
});
