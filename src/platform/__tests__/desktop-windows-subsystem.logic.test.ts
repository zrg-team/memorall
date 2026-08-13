import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Windows desktop entrypoint", () => {
	it("uses the GUI subsystem for release builds without hiding debug consoles", () => {
		const entrypoint = readFileSync(
			resolve(process.cwd(), "apps/desktop/src-tauri/src/main.rs"),
			"utf8",
		);

		expect(entrypoint).toContain(
			'#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]',
		);
		expect(entrypoint).not.toContain('#![windows_subsystem = "windows"]');
	});
});
