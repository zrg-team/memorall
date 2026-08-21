import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { spawn } from "node:child_process";

const checkerPath = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"check-desktop-artifacts.mjs",
);

function writeExecutable(path, content) {
	return writeFile(path, content, "utf8").then(() => chmod(path, 0o755));
}

test("accepts macOS artifacts when standalone executable is present", async () => {
	const root = await mkdtemp(join(tmpdir(), "memorall-desktop-artifacts-"));
	try {
		const platformRoot = join(root, "publish", "desktop", "macos");
		await mkdir(join(platformRoot, "bundle", "dmg"), { recursive: true });
		await writeFile(
			join(platformRoot, "bundle", "dmg", "Memorall_0.0.0_x64.dmg"),
			"",
		);
		await writeExecutable(
			join(platformRoot, "memorall-desktop"),
			"#!/bin/sh\nexit 0\n",
		);
		for (const directory of ["desktop-sidecar", "browser-runtime", "licenses"]) {
			await mkdir(join(platformRoot, directory), { recursive: true });
		}
		const stagedResourcesRoot = join(root, "publish", ".cache", "tauri-resources");
		for (const directory of ["desktop-sidecar", "browser-runtime", "licenses"]) {
			await mkdir(join(stagedResourcesRoot, directory), { recursive: true });
		}
		await writeFile(
			join(stagedResourcesRoot, "desktop-sidecar", "index.mjs"),
			"export default null;\n",
		);
		await writeFile(
			join(stagedResourcesRoot, "licenses", "THIRD_PARTY_NOTICES.txt"),
			"fixtures\n",
		);
		await mkdir(
			join(
				stagedResourcesRoot,
				"browser-runtime",
				"browseros",
				"chrome-mac-x64",
				"Google Chrome for Testing.app",
				"Contents",
				"MacOS",
			),
			{ recursive: true },
		);
		await writeExecutable(
			join(
				stagedResourcesRoot,
				"browser-runtime",
				"browseros",
				"chrome-mac-x64",
				"Google Chrome for Testing.app",
				"Contents",
				"MacOS",
				"Google Chrome for Testing",
			),
			"#!/bin/sh\nexit 0\n",
		);
		await writeExecutable(
			join(
				stagedResourcesRoot,
				"browser-runtime",
				"browseros",
				"browseros-server",
			),
			"#!/bin/sh\nexit 0\n",
		);

		const stagedNode = join(
			root,
			"publish",
			".cache",
			"tauri-sidecars",
			"memorall-node-x86_64-apple-darwin",
		);
		await mkdir(dirname(stagedNode), { recursive: true });
		await writeExecutable(stagedNode, `#!/bin/sh\necho "${process.version}"\n`);

		const child = spawn("node", [checkerPath, "macos"], {
			cwd: root,
			env: process.env,
			stdio: "pipe",
		});
		const chunks = [];
		for await (const chunk of child.stderr) chunks.push(chunk);
		for await (const chunk of child.stdout) chunks.push(chunk);
		const output = Buffer.concat(chunks).toString("utf8");
		const code = await new Promise((resolveExit, reject) => {
			child.once("error", reject);
			child.once("exit", (exitCode) => resolveExit(exitCode ?? 1));
		});
		assert.equal(code, 0, output);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
