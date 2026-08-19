import assert from "node:assert/strict";
import test from "node:test";
import { findUnconditionalDetachedSpawns } from "./check-desktop-detached-spawn.mjs";

test("rejects an unconditional detached spawn option", () => {
	const source = [
		'const cleanup = spawn("powershell.exe", args, {',
		"\tstdio: \"ignore\",",
		"\twindowsHide: true,",
		"\tdetached: true,",
		"});",
	].join("\n");
	const found = findUnconditionalDetachedSpawns(source);
	assert.equal(found.length, 1);
	assert.equal(found[0].line, 4);
});

test("accepts detaching everywhere except Windows", () => {
	const source = [
		"const detached = process.platform !== \"win32\";",
		'const browser = spawn(browserPath, args, { windowsHide: true, detached });',
		'const server = spawn(serverPath, args, {',
		"\tdetached: process.platform !== \"win32\",",
		"});",
	].join("\n");
	assert.deepEqual(findUnconditionalDetachedSpawns(source), []);
});

test("reports every offending option, not just the first", () => {
	const source = "detached: true;\n\n\ndetached: true;";
	assert.deepEqual(
		findUnconditionalDetachedSpawns(source).map(({ line }) => line),
		[1, 4],
	);
});

test("ignores a similarly named identifier", () => {
	assert.deepEqual(
		findUnconditionalDetachedSpawns("isDetached: true; detachedMode: true;"),
		[],
	);
});
