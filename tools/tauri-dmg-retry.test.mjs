import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";

import {
	MACOS_DMG_ATTEMPTS,
	bundleRetryArguments,
	retryMacosDmgBundling,
	staleVolumeNames,
} from "./tauri-dmg-retry.mjs";

const BUNDLE_DIRECTORY = join("target", "release", "bundle");
const APPLICATION_BUNDLE = join(BUNDLE_DIRECTORY, "macos", "Memorall.app");
const DMG_DIRECTORY = join(BUNDLE_DIRECTORY, "dmg");

/**
 * Models the bundle directory the way the real failure leaves it: the .app is
 * present and the dmg directory is empty. `produceDmgOnAttempt` decides which
 * retry finally writes the installer.
 */
function harness({
	platform = "darwin",
	productName = "Memorall",
	applicationBundleExists = true,
	initialDmgFiles = [],
	produceDmgOnAttempt = 1,
	retryExitCode = 0,
	volumes = [],
	tauriArguments = [],
	attempts = MACOS_DMG_ATTEMPTS,
} = {}) {
	const calls = { runTauri: [], removed: [], detached: [], logs: [] };
	let dmgFiles = [...initialDmgFiles];
	let attemptsRun = 0;

	const result = retryMacosDmgBundling({
		failureCode: 1,
		platform,
		productName,
		bundleDirectory: BUNDLE_DIRECTORY,
		tauriArguments,
		attempts,
		runTauri: async (args) => {
			attemptsRun += 1;
			calls.runTauri.push(args);
			if (attemptsRun >= produceDmgOnAttempt) {
				dmgFiles = ["Memorall_0.5.8_x64.dmg"];
			}
			return retryExitCode;
		},
		exists: (path) => path === APPLICATION_BUNDLE && applicationBundleExists,
		listDirectory: (directory) => (directory === DMG_DIRECTORY ? dmgFiles : []),
		removeDirectory: (directory) => {
			calls.removed.push(directory);
			dmgFiles = [];
		},
		listVolumes: () => volumes,
		detachVolume: (volume) => calls.detached.push(volume),
		log: (message) => calls.logs.push(message),
	});

	return { result, calls };
}

test("recovers when a retry produces the DMG", async () => {
	const { result, calls } = harness();
	assert.equal(await result, 0);
	assert.equal(calls.runTauri.length, 1);
	assert.deepEqual(calls.runTauri[0], ["--bundles", "dmg"]);
	assert.deepEqual(calls.removed, [DMG_DIRECTORY]);
});

test("keeps retrying until a DMG appears", async () => {
	const { result, calls } = harness({ produceDmgOnAttempt: 2 });
	assert.equal(await result, 0);
	assert.equal(calls.runTauri.length, 2);
});

test("gives up with the original exit code after the attempt budget", async () => {
	const { result, calls } = harness({ produceDmgOnAttempt: 99 });
	assert.equal(await result, 1);
	assert.equal(calls.runTauri.length, MACOS_DMG_ATTEMPTS - 1);
});

test("reports the original exit code when the retry itself fails", async () => {
	const { result } = harness({ retryExitCode: 2, produceDmgOnAttempt: 99 });
	assert.equal(await result, 1);
});

test("treats a zero exit that produced no DMG as a failed attempt", async () => {
	const { result, calls } = harness({
		retryExitCode: 0,
		produceDmgOnAttempt: 99,
	});
	assert.equal(await result, 1);
	assert.equal(calls.runTauri.length, MACOS_DMG_ATTEMPTS - 1);
});

test("does not mask a real build failure that never produced the app", async () => {
	const { result, calls } = harness({ applicationBundleExists: false });
	assert.equal(await result, 1);
	assert.deepEqual(calls.runTauri, []);
});

test("does not retry when a DMG already exists, so other failures surface", async () => {
	const { result, calls } = harness({
		initialDmgFiles: ["Memorall_0.5.8_x64.dmg"],
	});
	assert.equal(await result, 1);
	assert.deepEqual(calls.runTauri, []);
});

test("matches the DMG case-insensitively", async () => {
	const { result, calls } = harness({ initialDmgFiles: ["Memorall.DMG"] });
	assert.equal(await result, 1);
	assert.deepEqual(calls.runTauri, []);
});

test("never runs off macOS", async () => {
	for (const platform of ["win32", "linux"]) {
		const { result, calls } = harness({ platform });
		assert.equal(await result, 1);
		assert.deepEqual(calls.runTauri, []);
	}
});

test("does nothing without a product name to locate the app bundle", async () => {
	const { result, calls } = harness({ productName: "" });
	assert.equal(await result, 1);
	assert.deepEqual(calls.runTauri, []);
});

test("detaches leftover mounts before each attempt", async () => {
	const { result, calls } = harness({
		volumes: ["Memorall", "Memorall 1", "Macintosh HD", "MemorallOther"],
		produceDmgOnAttempt: 2,
	});
	assert.equal(await result, 0);
	assert.deepEqual(calls.detached, [
		join("/Volumes", "Memorall"),
		join("/Volumes", "Memorall 1"),
		join("/Volumes", "Memorall"),
		join("/Volumes", "Memorall 1"),
	]);
});

test("logs one line per attempt so a flake is visible in the job log", async () => {
	const { result, calls } = harness({ produceDmgOnAttempt: 99 });
	assert.equal(await result, 1);
	assert.equal(calls.logs.length, MACOS_DMG_ATTEMPTS - 1);
	assert.match(calls.logs[0], /attempt 2 of 3/);
});

test("keeps unrelated arguments and forces the DMG bundle", () => {
	assert.deepEqual(bundleRetryArguments(["--no-sign", "--verbose"]), [
		"--no-sign",
		"--verbose",
		"--bundles",
		"dmg",
	]);
});

test("strips every form of a caller-supplied --bundles", () => {
	assert.deepEqual(bundleRetryArguments(["--bundles", "app"]), [
		"--bundles",
		"dmg",
	]);
	assert.deepEqual(bundleRetryArguments(["-b", "app", "dmg", "--no-sign"]), [
		"--no-sign",
		"--bundles",
		"dmg",
	]);
	assert.deepEqual(bundleRetryArguments(["--bundles=app", "--no-sign"]), [
		"--no-sign",
		"--bundles",
		"dmg",
	]);
	assert.deepEqual(bundleRetryArguments(["--bundles", "app,dmg"]), [
		"--bundles",
		"dmg",
	]);
});

test("stops skipping bundle values at the next flag", () => {
	assert.deepEqual(
		bundleRetryArguments(["-b", "app", "--target", "x86_64-apple-darwin"]),
		["--target", "x86_64-apple-darwin", "--bundles", "dmg"],
	);
});

test("claims only this product's volumes", () => {
	assert.deepEqual(
		staleVolumeNames(
			["Memorall", "Memorall 1", "MemorallOther", "Macintosh HD"],
			"Memorall",
		),
		["Memorall", "Memorall 1"],
	);
	assert.deepEqual(staleVolumeNames(["Memorall"], ""), []);
});
