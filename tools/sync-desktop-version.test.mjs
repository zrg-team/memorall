import assert from "node:assert/strict";
import test from "node:test";

import {
	setCargoLockVersion,
	setCargoVersion,
	setTauriConfigVersion,
} from "./sync-desktop-version.mjs";

test("rewrites the crate version", () => {
	const source = `[package]\nname = "memorall-desktop"\nversion = "0.5.1"\nedition = "2021"\n`;
	assert.match(setCargoVersion(source, "0.5.4"), /version = "0\.5\.4"/);
});

test("leaves dependency versions alone", () => {
	const source = `[package]\nname = "memorall-desktop"\nversion = "0.5.1"\n\n[build-dependencies]\ntauri-build = { version = "=2.6.3" }\n`;
	const next = setCargoVersion(source, "0.5.4");
	assert.match(next, /name = "memorall-desktop"\nversion = "0\.5\.4"/);
	assert.match(next, /tauri-build = \{ version = "=2\.6\.3" \}/);
});

test("rewrites only our own entry in the lockfile", () => {
	const source = [
		'[[package]]\nname = "memchr"\nversion = "2.7.4"\n',
		'[[package]]\nname = "memorall-desktop"\nversion = "0.5.1"\ndependencies = []\n',
	].join("\n");
	const next = setCargoLockVersion(source, "0.5.4");
	assert.match(next, /name = "memorall-desktop"\nversion = "0\.5\.4"/);
	assert.match(next, /name = "memchr"\nversion = "2\.7\.4"/);
});

test("rewrites the tauri config version, not the schema line", () => {
	const source = `{\n\t"$schema": "https://schema.tauri.app/config/2",\n\t"productName": "Memorall",\n\t"version": "0.5.1",\n\t"identifier": "app.memorall.desktop"\n}\n`;
	const next = setTauriConfigVersion(source, "0.5.4");
	assert.match(next, /"version": "0\.5\.4"/);
	assert.match(next, /schema\.tauri\.app\/config\/2/);
});

test("is a no-op when the version already matches", () => {
	const source = `[package]\nversion = "0.5.4"\n`;
	assert.equal(setCargoVersion(source, "0.5.4"), source);
});
