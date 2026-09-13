import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveSearchPath, which } from "./runtime-path";

describe("resolveSearchPath", () => {
	it("puts the login shell PATH first on macOS and Linux, then the usual install dirs", async () => {
		const path = await resolveSearchPath({
			platform: "darwin",
			env: { PATH: "/usr/bin:/bin" },
			home: "/Users/me",
			readLoginShellPath: async () =>
				"/Users/me/.nvm/versions/node/v22/bin:/usr/bin",
		});
		const parts = path.split(":");
		expect(parts[0]).toBe("/Users/me/.nvm/versions/node/v22/bin");
		expect(parts).toContain("/opt/homebrew/bin");
		expect(parts).toContain("/Users/me/.local/bin");
		expect(parts.filter((part) => part === "/usr/bin")).toHaveLength(1);
	});

	it("still works when the login shell cannot be read", async () => {
		const path = await resolveSearchPath({
			platform: "linux",
			env: { PATH: "/usr/bin" },
			home: "/home/me",
			readLoginShellPath: async () => null,
		});
		expect(path.split(":")).toEqual(
			expect.arrayContaining(["/usr/bin", "/home/me/.cargo/bin"]),
		);
	});

	it("uses the process Path on Windows plus the npm and uv install dirs", async () => {
		const path = await resolveSearchPath({
			platform: "win32",
			env: {
				Path: "C:\\Windows",
				APPDATA: "C:\\Users\\me\\AppData\\Roaming",
			},
			home: "C:\\Users\\me",
			readLoginShellPath: async () => "ignored",
		});
		expect(path.split(";")).toEqual([
			"C:\\Windows",
			"C:\\Users\\me\\AppData\\Roaming\\npm",
			"C:\\Users\\me\\.local\\bin",
			"C:\\Users\\me\\.cargo\\bin",
		]);
	});
});

describe("which", () => {
	it("finds a command on a POSIX search path", () => {
		const files = new Set(["/opt/homebrew/bin/uvx"]);
		expect(
			which("uvx", "/usr/bin:/opt/homebrew/bin", {
				platform: "darwin",
				exists: (path) => files.has(path),
			}),
		).toBe("/opt/homebrew/bin/uvx");
	});

	it("resolves Windows shims through PATHEXT and skips the extensionless script", () => {
		const files = new Set(["C:\\nodejs\\npx", "C:\\nodejs\\npx.cmd"]);
		expect(
			which("npx", "C:\\Windows;C:\\nodejs", {
				platform: "win32",
				pathExt: ".EXE;.CMD",
				exists: (path) => files.has(path),
			}),
		).toBe("C:\\nodejs\\npx.cmd");
	});

	it("checks an explicit path directly and returns null when nothing matches", () => {
		expect(
			which("/usr/local/bin/server", "", {
				platform: "linux",
				exists: (path) => path === "/usr/local/bin/server",
			}),
		).toBe("/usr/local/bin/server");
		expect(
			which("missing", "/usr/bin", { platform: "linux", exists: () => false }),
		).toBeNull();
	});

	it.skipIf(process.platform === "win32")(
		"skips a file without the execute bit on macOS and Linux",
		() => {
			const directory = mkdtempSync(join(tmpdir(), "memorall-which-"));
			try {
				const launcher = join(directory, "uvx");
				writeFileSync(launcher, "#!/bin/sh\n");
				chmodSync(launcher, 0o644);
				expect(which("uvx", directory)).toBeNull();
				chmodSync(launcher, 0o755);
				expect(which("uvx", directory)).toBe(launcher);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		},
	);
});
