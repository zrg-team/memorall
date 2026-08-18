import { beforeEach, describe, expect, it } from "vitest";
import {
	clearOpenUIState,
	openUIStateKey,
	openUIStateSize,
	readOpenUIState,
	writeOpenUIState,
} from "../openui-form-state";

describe("openUIStateKey", () => {
	it("does not read the whole document", () => {
		// The renderer budgets for content up to 256KB; hashing that per mount
		// would cost more than the render it protects. Only the ends participate,
		// so the key length stays bounded however large the block is.
		const huge = "x".repeat(300_000);
		expect(openUIStateKey("seg-0", huge).length).toBeLessThan(1_200);
	});

	it("separates blocks at different positions", () => {
		const content = "root = CardBlock()";
		expect(openUIStateKey("seg-0", content)).not.toBe(
			openUIStateKey("seg-1", content),
		);
	});

	it("separates blocks whose content differs", () => {
		expect(openUIStateKey("seg-0", "root = A()")).not.toBe(
			openUIStateKey("seg-0", "root = B()"),
		);
	});

	it("gives the same block the same key across remounts", () => {
		const content = "root = CardBlock(null, null, [x])";
		expect(openUIStateKey("seg-0", content)).toBe(
			openUIStateKey("seg-0", content),
		);
	});
});

describe("openUI form state store", () => {
	beforeEach(() => clearOpenUIState());

	it("returns values written for a key and nothing for an unseen one", () => {
		writeOpenUIState("a", { form: { agree: true } });
		expect(readOpenUIState("a")).toEqual({ form: { agree: true } });
		expect(readOpenUIState("b")).toBeUndefined();
	});

	it("survives the scroll-away, scroll-back cycle the renderer performs", () => {
		const key = openUIStateKey("seg-0", "root = CardBlock()");

		// mounted: user ticks a box and types
		writeOpenUIState(key, { survey: { agree: true, note: "hello" } });
		// DeferredMount unmounts the tree; the store is outside it
		// remounted: hydration reads the same key
		expect(readOpenUIState(key)).toEqual({
			survey: { agree: true, note: "hello" },
		});
	});

	it("keeps only the most recent blocks so a long conversation cannot grow forever", () => {
		for (let i = 0; i < 400; i += 1) writeOpenUIState(`k${i}`, { i });

		expect(openUIStateSize()).toBeLessThanOrEqual(240);
		expect(readOpenUIState("k0")).toBeUndefined();
		expect(readOpenUIState("k399")).toEqual({ i: 399 });
	});

	it("evicts least recently used, not merely oldest written", () => {
		for (let i = 0; i < 240; i += 1) writeOpenUIState(`k${i}`, { i });

		// touching the oldest entry should save it from the next eviction
		writeOpenUIState("k0", { i: 0, touched: true });
		writeOpenUIState("overflow", { i: -1 });

		expect(readOpenUIState("k0")).toEqual({ i: 0, touched: true });
		expect(readOpenUIState("k1")).toBeUndefined();
	});
});
