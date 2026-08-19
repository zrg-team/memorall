import assert from "node:assert/strict";
import test from "node:test";
import { findDuplicateGroups } from "./check-duplicate-modules.mjs";

const body = (marker) => `${marker}\n${"// padding line\n".repeat(40)}`;

test("reports byte-identical modules together", () => {
	const shared = body("export const protocol = 1;");
	const groups = findDuplicateGroups([
		{ path: "b/protocol.ts", contents: shared },
		{ path: "a/protocol.ts", contents: shared },
		{ path: "c/other.ts", contents: body("export const other = 2;") },
	]);

	assert.equal(groups.length, 1);
	// Sorted so the message reads the same on every machine.
	assert.deepEqual(groups[0], ["a/protocol.ts", "b/protocol.ts"]);
});

test("groups three or more copies as one finding", () => {
	const shared = body("export const shared = 1;");
	const groups = findDuplicateGroups([
		{ path: "a.ts", contents: shared },
		{ path: "b.ts", contents: shared },
		{ path: "c.ts", contents: shared },
	]);

	assert.equal(groups.length, 1);
	assert.equal(groups[0].length, 3);
});

test("ignores files that differ by even one byte", () => {
	assert.deepEqual(
		findDuplicateGroups([
			{ path: "a.ts", contents: body("export const a = 1;") },
			{ path: "b.ts", contents: `${body("export const a = 1;")} ` },
		]),
		[],
	);
});

test("exempts small files so barrels and stubs do not trip it", () => {
	const stub = 'export * from "./impl";\n';
	assert.deepEqual(
		findDuplicateGroups([
			{ path: "a/index.ts", contents: stub },
			{ path: "b/index.ts", contents: stub },
		]),
		[],
	);
});

test("finds nothing in a clean tree", () => {
	assert.deepEqual(
		findDuplicateGroups([
			{ path: "a.ts", contents: body("export const a = 1;") },
			{ path: "b.ts", contents: body("export const b = 2;") },
		]),
		[],
	);
});
