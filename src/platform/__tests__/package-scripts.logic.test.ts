import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
	readFileSync(resolve(process.cwd(), "package.json"), "utf8"),
) as { scripts: Record<string, string> };
const scripts = packageJson.scripts;

describe("package script families", () => {
	it.each(["extension", "web", "desktop"])(
		"provides dev, build, and package commands for %s",
		(environment) => {
			expect(scripts[`dev:${environment}`]).toBeTruthy();
			expect(scripts[`build:${environment}`]).toBeTruthy();
			expect(scripts[`package:${environment}`]).toBeTruthy();
		},
	);

	it("provides explicit extension targets", () => {
		for (const target of ["chrome", "edge", "firefox", "all"]) {
			expect(scripts[`build:extension:${target}`]).toBeTruthy();
		}
		for (const target of ["chrome", "edge", "all"]) {
			expect(scripts[`package:extension:${target}`]).toBeTruthy();
		}
	});

	it("provides host-specific desktop packages", () => {
		for (const target of ["windows", "macos", "linux"]) {
			expect(scripts[`build:desktop:${target}`]).toBeTruthy();
			expect(scripts[`package:desktop:${target}`]).toBeTruthy();
		}
	});

	it("keeps GitHub Pages deployment explicit and locally dry-runnable", () => {
		expect(scripts["deploy:web"]).toContain("deploy:web:github-pages");
		expect(scripts["deploy:web:github-pages"]).toContain("package:web");
		expect(scripts["deploy:web:github-pages:dry-run"]).toContain("--dry-run");
	});

	it("keeps the conventional top-level aliases", () => {
		expect(scripts.dev).toBe("yarn dev:extension");
		expect(scripts.build).toBe("yarn build:extension");
		expect(scripts.package).toBe("yarn package:extension:all");
	});
});
