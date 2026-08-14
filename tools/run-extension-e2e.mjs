import { spawn } from "node:child_process";
import {
	cpSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { resolve } from "node:path";

const mode = process.argv[2];
if (mode !== "dev" && mode !== "build") {
	throw new Error("Usage: node tools/run-extension-e2e.mjs <dev|build>");
}

const root = process.cwd();
const yarn = process.platform === "win32" ? "yarn.cmd" : "yarn";
const readyPath = resolve(root, "dist/extension-js/chromium/ready.json");
const logDirectory = resolve(root, "publish/test-logs/extension");
const developmentPublishPath = resolve(root, "publish/extension/dev/chromium");
let producer;
let producerStartedAt = 0;

function run(args, options = {}) {
	return new Promise((resolveRun, reject) => {
		const child = spawn(yarn, args, {
			cwd: root,
			env: { ...process.env, FORCE_COLOR: "0", ...options.env },
			stdio: options.stdio ?? "inherit",
			shell: process.platform === "win32",
		});
		child.once("error", reject);
		child.once("exit", (code, signal) => {
			if (code === 0) {
				resolveRun();
				return;
			}
			reject(
				new Error(
					`yarn ${args.join(" ")} failed with ${signal ?? `exit code ${code}`}`,
				),
			);
		});
	});
}

async function waitForReady(timeoutMs = 300_000) {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (producer.exitCode !== null) {
			throw new Error(
				`Extension dev producer exited before becoming ready (${producer.exitCode}).`,
			);
		}
		if (existsSync(readyPath)) {
			try {
				const ready = JSON.parse(readFileSync(readyPath, "utf8"));
				const readyTimestamp = Date.parse(ready.ts ?? ready.compiledAt ?? "");
				if (
					ready.status === "ready" &&
					Number.isFinite(readyTimestamp) &&
					readyTimestamp >= producerStartedAt &&
					existsSync(ready.distPath)
				) {
					return ready.distPath;
				}
				if (ready.status === "error") {
					throw new Error(`Extension.js reported: ${ready.errors?.join("\n")}`);
				}
			} catch (error) {
				if (error instanceof SyntaxError) {
					// Extension.js can be replacing the contract while we read it.
				} else {
					throw error;
				}
			}
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 500));
	}
	throw new Error(`Timed out waiting for ${readyPath}`);
}

async function stopProducer() {
	if (!producer || producer.exitCode !== null) return;
	if (process.platform === "win32") {
		await new Promise((resolveStop) => {
			const killer = spawn(
				"taskkill",
				["/PID", String(producer.pid), "/T", "/F"],
				{
					stdio: "ignore",
				},
			);
			killer.once("exit", resolveStop);
			killer.once("error", resolveStop);
		});
	} else {
		producer.kill("SIGTERM");
	}
}

try {
	mkdirSync(logDirectory, { recursive: true });
	let extensionPath = resolve(root, "publish/extension/chromium");

	if (mode === "dev") {
		await run(["prepare:dev:extension"]);
		rmSync(readyPath, { force: true });
		const log = createWriteStream(
			resolve(logDirectory, `extension-${mode}-producer.log`),
		);
		producer = spawn(
			yarn,
			["dev:extension:runtime:no-reload", "--no-browser", "--logs", "error"],
			{
				cwd: root,
				env: { ...process.env, FORCE_COLOR: "0" },
				stdio: ["ignore", "pipe", "pipe"],
				shell: process.platform === "win32",
				detached: process.platform !== "win32",
			},
		);
		producerStartedAt = Date.now();
		producer.stdout.pipe(log, { end: false });
		producer.stderr.pipe(log, { end: false });
		const internalDevelopmentPath = await waitForReady();
		rmSync(developmentPublishPath, { recursive: true, force: true });
		mkdirSync(resolve(developmentPublishPath, ".."), { recursive: true });
		cpSync(internalDevelopmentPath, developmentPublishPath, {
			recursive: true,
		});
		extensionPath = developmentPublishPath;
	} else {
		await run(["build:extension"]);
	}

	await run(["node", "tools/check-extension-no-reload.mjs", extensionPath]);

	await run(["playwright", "test", "-c", "playwright.extension.config.ts"], {
		env: {
			MEMORALL_EXTENSION_PATH: extensionPath,
			MEMORALL_EXTENSION_MODE: mode,
		},
	});
} finally {
	await stopProducer();
}
