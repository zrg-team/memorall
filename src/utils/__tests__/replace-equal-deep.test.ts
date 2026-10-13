import { describe, expect, it } from "vitest";
import { replaceEqualDeep } from "../replace-equal-deep";

describe("replaceEqualDeep", () => {
	it("returns the previous value when nothing changed", () => {
		const previous = { a: 1, list: [{ id: 1 }, { id: 2 }], nested: { b: "x" } };
		const next = structuredClone(previous);
		expect(replaceEqualDeep(previous, next)).toBe(previous);
	});

	it("keeps unchanged branches and replaces changed ones", () => {
		const previous = {
			terminal: { lines: ["a", "b"] },
			browser: { tabs: [{ id: 1, title: "x" }] },
			revision: 1,
		};
		const next = {
			terminal: { lines: ["a", "b", "c"] },
			browser: { tabs: [{ id: 1, title: "x" }] },
			revision: 2,
		};

		const merged = replaceEqualDeep(previous, next);

		expect(merged).toEqual(next);
		expect(merged).not.toBe(previous);
		expect(merged.browser).toBe(previous.browser);
		expect(merged.terminal).not.toBe(previous.terminal);
		expect(merged.terminal.lines).toEqual(["a", "b", "c"]);
	});

	it("keeps unchanged array items when the array grows or shrinks", () => {
		const previous = [{ id: 1 }, { id: 2 }, { id: 3 }];
		const grown = replaceEqualDeep(previous, [
			{ id: 1 },
			{ id: 2 },
			{ id: 3 },
			{ id: 4 },
		]);
		expect(grown[0]).toBe(previous[0]);
		expect(grown[2]).toBe(previous[2]);

		const shrunk = replaceEqualDeep(previous, [{ id: 1 }, { id: 2 }]);
		expect(shrunk).not.toBe(previous);
		expect(shrunk[1]).toBe(previous[1]);
	});

	it("notices added, removed and undefined keys", () => {
		const previous: Record<string, unknown> = { a: 1, b: undefined };
		expect(replaceEqualDeep(previous, { a: 1 })).not.toBe(previous);
		expect(replaceEqualDeep(previous, { a: 1, c: undefined })).not.toBe(
			previous,
		);
		expect(replaceEqualDeep(previous, { a: 1, b: undefined })).toBe(previous);
	});

	it("takes non-plain values from next", () => {
		const date = new Date(0);
		const merged = replaceEqualDeep({ when: new Date(0) }, { when: date });
		expect(merged.when).toBe(date);
		expect(replaceEqualDeep(Number.NaN, Number.NaN)).toBeNaN();
		expect(replaceEqualDeep(undefined, { a: 1 })).toEqual({ a: 1 });
	});
});
