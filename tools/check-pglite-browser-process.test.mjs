import assert from "node:assert/strict";
import test from "node:test";
import { findUnsafeBrowserProcessAccesses } from "./check-pglite-browser-process.mjs";

test("rejects guarded branches that still read the bare process global", () => {
	const source = [
		"globalThis.process?.env&&(saved=process.exitCode)",
		"globalThis.process?.env&&(process.exitCode=saved)",
	].join(";");
	assert.equal(findUnsafeBrowserProcessAccesses(source).length, 2);
});

test("accepts branches that consistently dereference globalThis.process", () => {
	const source = [
		"globalThis.process&&(saved=globalThis.process.exitCode)",
		"globalThis.process&&(globalThis.process.exitCode=saved)",
	].join(";");
	assert.deepEqual(findUnsafeBrowserProcessAccesses(source), []);
});

test("rejects process exit-code reads after a bundler removes the guard", () => {
	assert.equal(
		findUnsafeBrowserProcessAccesses("saved=globalThis.process.exitCode")
			.length,
		1,
	);
});
