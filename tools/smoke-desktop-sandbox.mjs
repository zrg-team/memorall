import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

// Uses a disposable app-data directory, never the user's actual workspace.
const root = resolve("publish/.cache");
await mkdir(root, { recursive: true });
const data =
	process.env.MEMORALL_VM_SMOKE_DATA_DIR ??
	(await mkdtemp(join(root, "sandbox-smoke-")));
console.log(`Disposable VM data: ${data}`);
const child = spawn(
	process.execPath,
	[resolve("publish/.cache/tauri-resources/desktop-sidecar/index.mjs")],
	{
		windowsHide: true,
		stdio: ["pipe", "pipe", "inherit"],
		env: {
			...process.env,
			MEMORALL_VM_RUNTIME_DIR: resolve(
				"publish/.cache/tauri-resources/sandbox-runtime",
			),
			MEMORALL_DESKTOP_APP_DATA_DIR: data,
		},
	},
);
const pending = new Map();
let seq = 0;
const lines = createInterface({ input: child.stdout });
lines.on("line", (line) => {
	const response = JSON.parse(line);
	const call = pending.get(response.id);
	if (!call) return;
	pending.delete(response.id);
	clearTimeout(call.timer);
	response.ok
		? call.resolve(response.result)
		: call.reject(
				new Error(`${response.error.code}: ${response.error.message}`),
			);
});
const request = (method, params = {}, budget = 360_000) =>
	new Promise((resolve, reject) => {
		const id = String(++seq);
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`Smoke request timed out: ${method}`));
		}, budget);
		pending.set(id, { resolve, reject, timer });
		child.stdin.write(
			JSON.stringify({ protocolVersion: 3, id, method, params }) + "\n",
		);
	});
const vm = (operation, payload = null) =>
	request(
		"sandbox.request",
		{ operation, payload, timeoutMs: 660_000 },
		900_000,
	);
const progress = setInterval(() => {
	void request("sandbox.status", {}, 10000).then(
		(status) =>
			console.log(
				"Sandbox:",
				status.state,
				status.network,
				status.state === "starting" ? status.bootLog.slice(-180) : "",
			),
		() => undefined,
	);
}, 15000);
progress.unref();
let diagnosing = false;
const diagnostics = process.argv.includes("--diagnostics")
	? setInterval(async () => {
			if (diagnosing || (await request("sandbox.status")).state !== "ready")
				return;
			diagnosing = true;
			try {
				const process = await vm("runtime.executeCommand", {
					command:
						"ps -eo pid,ppid,user,stat,wchan:28,args | head -45; cat /proc/sys/kernel/random/entropy_avail",
					waitTimeoutMs: 5000,
					commandTimeoutMs: 10000,
				});
				console.log("Guest process diagnostics:", process.stdout);
			} catch (error) {
				console.log("Guest diagnostics:", String(error));
			} finally {
				diagnosing = false;
			}
		}, 30000)
	: null;
try {
	await request("health");
	console.log("Booting the bundled Ubuntu VM with hardware acceleration...");
	assert.equal((await vm("health")).ready, true);
	const { vfsId } = await vm("sync.state");
	const binary = Buffer.from([0, 255, 128, 10, 13]);
	await vm("sync.apply", {
		vfsId,
		ops: [
			{ op: "mkdir", path: "/agents/smoke" },
			{
				op: "write",
				path: "/agents/smoke/input.bin",
				offset: 0,
				length: binary.length,
			},
		],
		buffer: { $bytes: binary.toString("base64") },
	});
	let command = await vm("runtime.executeCommand", {
		command:
			'py -c \'from pathlib import Path; p=Path("input.bin"); assert p.read_bytes()==bytes([0,255,128,10,13]); Path("output.bin").write_bytes(p.read_bytes()[::-1]); Path("guest-local.bin").open("wb").truncate(17*1024*1024); print("BINARY_OK")\'',
		cwd: "/agents/smoke",
		// Older desktop renderers serialized an omitted env option as null.
		// The guest must also handle that form when upgrading an existing VM.
		env: null,
		waitTimeoutMs: 5000,
	});
	while (!command.completed)
		command = await vm("runtime.listenCommand", {
			commandId: command.commandId,
			offset: 0,
			waitTimeoutMs: 5000,
		});
	assert.equal(command.exitCode, 0, command.stdout);
	assert.match(command.stdout, /BINARY_OK/);
	const changes = await vm("sync.collect", {});
	assert.ok(
		!changes.ops.some((op) => op.path.endsWith("/guest-local.bin")),
		"Oversized guest output must not block other files from synchronizing",
	);
	const written = changes.ops.find(
		(op) => op.path === "/agents/smoke/output.bin",
	);
	assert.ok(written);
	assert.deepEqual(
		Buffer.from(changes.buffer.$bytes, "base64").subarray(
			written.offset,
			written.offset + written.length,
		),
		Buffer.from(binary).reverse(),
	);
	await vm("sync.ack", { batchId: changes.batchId, failures: [] });
	assert.equal((await vm("sync.collect", {})).batchId, null);
	await assert.rejects(
		vm("fs.writeFile", { path: "/../escape", content: "denied" }),
		/leaves workspace/,
	);
	await assert.rejects(
		vm("server.renderUrl", { port: 3128 }),
		/Invalid preview port/,
	);
	const interactive = await vm("runtime.executeCommand", {
		command: 'read answer; printf "ANSWER=%s\\n" "$answer"',
		cwd: "/agents/smoke",
	});
	await vm("runtime.sendCommandInput", {
		commandId: interactive.commandId,
		input: "hello",
		appendNewline: true,
	});
	let answer = await vm("runtime.listenCommand", {
		commandId: interactive.commandId,
		offset: 0,
		waitTimeoutMs: 5000,
	});
	let answerOutput = answer.stdout;
	while (!answer.completed) {
		answer = await vm("runtime.listenCommand", {
			commandId: interactive.commandId,
			offset: answer.nextOffset,
			waitTimeoutMs: 5000,
		});
		answerOutput += answer.stdout;
	}
	assert.match(answerOutput, /ANSWER=hello/);
	const sleeper = await vm("runtime.executeCommand", { command: "sleep 300" });
	await vm("runtime.stopCommand", { commandId: sleeper.commandId });
	assert.equal(
		(await vm("runtime.listenCommand", { commandId: sleeper.commandId }))
			.status,
		"stopped",
	);
	const server = await vm("runtime.executeCommand", {
		command: "py -m http.server 8765 --bind 127.0.0.1",
		cwd: "/agents/smoke",
		waitTimeoutMs: 1000,
		commandTimeoutMs: 0,
	});
	const { url } = await vm("server.renderUrl", { port: 8765 });
	const first = await fetch(url, { redirect: "manual" });
	assert.equal(first.status, 200);
	await first.text();
	const cookie = first.headers.get("set-cookie").split(";")[0];
	const denied = await fetch(new URL("/", url));
	assert.equal(denied.status, 403);
	const page = await fetch(new URL("/", url), { headers: { cookie } });
	const html = await page.text();
	assert.equal(page.status, 200, html);
	assert.match(html, /__memorall_preview_bridge/);
	await vm("runtime.stopCommand", { commandId: server.commandId });
	if (process.argv.includes("--online")) {
		const blocked = await vm("network.fetch", {
			url: "http://169.254.169.254/latest/meta-data/",
		});
		assert.equal(blocked.status, 403);
		const probe = await vm("runtime.executeCommand", {
			command:
				"curl -v --max-time 15 -o /dev/null https://nodejs.org/dist/v22.23.1/SHASUMS256.txt",
			waitTimeoutMs: 1000,
			commandTimeoutMs: 20000,
		});
		let probed = probe;
		while (!probed.completed)
			probed = await vm("runtime.listenCommand", {
				commandId: probe.commandId,
				offset: 0,
				waitTimeoutMs: 10000,
			});
		console.log(
			"Guest HTTPS probe:",
			probed.exitCode,
			probed.stdout.slice(-3500),
		);
		console.log("Installing Node/npm and Git inside the disposable guest...");
		let installed = await vm("runtime.executeCommand", {
			command: "node --version && npm --version && git --version",
			cwd: "/agents/smoke",
			waitTimeoutMs: 1000,
			commandTimeoutMs: 600000,
		});
		let output = installed.stdout;
		if (output) console.log(output.trim());
		while (!installed.completed) {
			installed = await vm("runtime.listenCommand", {
				commandId: installed.commandId,
				offset: installed.nextOffset,
				waitTimeoutMs: 10000,
			});
			output += installed.stdout;
			if (installed.stdout) console.log(installed.stdout.trim());
		}
		assert.equal(installed.exitCode, 0, output);
		assert.match(output, /v22\./);
		assert.match(output, /git version/);
		let fetched = await vm("runtime.executeCommand", {
			command:
				'node -e \'fetch("https://nodejs.org/dist/v22.23.1/SHASUMS256.txt").then(r=>{if(!r.ok)throw Error(r.status);console.log("FETCH_OK")})\'',
			waitTimeoutMs: 1000,
			commandTimeoutMs: 60000,
		});
		let fetchOutput = fetched.stdout;
		while (!fetched.completed) {
			fetched = await vm("runtime.listenCommand", {
				commandId: fetched.commandId,
				offset: fetched.nextOffset,
				waitTimeoutMs: 10000,
			});
			fetchOutput += fetched.stdout;
		}
		assert.equal(fetched.exitCode, 0, fetchOutput);
		assert.match(fetchOutput, /FETCH_OK/);
	}
	if (process.argv.includes("--browser")) {
		console.log(
			"Checking native Vite, cross-origin memonOS controls, and WebSocket HMR...",
		);
		await vm("fs.writeFile", {
			path: "/agents/vite-smoke/src.jsx",
			content:
				"import React from 'react'; import {createRoot} from 'react-dom/client'; function App(){const [n,setN]=React.useState(0);return <><h1>Native VM preview</h1><button onClick={()=>setN(n+1)}>Count {n}</button></>}; createRoot(document.getElementById('root')).render(<App/>);",
		});
		const preview = await vm("server.start", {
			port: 5173,
			kind: "vite",
			template: "vite-react",
			rootDir: "/agents/vite-smoke",
		});
		const parent = createServer((_req, res) => {
			res.setHeader("Content-Type", "text/html");
			res.end(
				'<!doctype html><html><body><h1>Memorall preview test</h1><iframe style="width:900px;height:600px"></iframe></body></html>',
			);
		});
		parent.listen(0, "127.0.0.1");
		await once(parent, "listening");
		const { chromium } = await import("@playwright/test");
		const browserLock = JSON.parse(
			await readFile("apps/desktop/browser-runtime.lock.json", "utf8"),
		);
		const executable =
			browserLock.browser.targets[`${process.platform}-${process.arch}`]
				.executable;
		const browser = await chromium.launch({
			executablePath: resolve(
				"publish/.cache/tauri-resources/browser-runtime/browseros",
				executable,
			),
			headless: true,
			args: ["--test-third-party-cookie-phaseout"],
		});
		try {
			const page = await browser.newPage();
			await page.goto(`http://localhost:${parent.address().port}`);
			await page.locator("iframe").evaluate((frame, url) => {
				frame.src = url;
			}, preview.renderUrl);
			const frame = page.frameLocator("iframe");
			await frame
				.getByRole("heading", { name: "Native VM preview" })
				.waitFor({ timeout: 30000 });
			const call = (operation, payload) =>
				page.evaluate(
					({ operation, payload, target }) =>
						new Promise((resolve, reject) => {
							const iframe = document.querySelector("iframe");
							const id = crypto.randomUUID();
							const origin = new URL(target).origin;
							const timeout = setTimeout(
								() => reject(new Error("Preview bridge timed out")),
								15000,
							);
							const receive = (event) => {
								if (
									event.source !== iframe.contentWindow ||
									event.origin !== origin ||
									event.data?.id !== id
								)
									return;
								clearTimeout(timeout);
								removeEventListener("message", receive);
								event.data.error
									? reject(new Error(event.data.error))
									: resolve(event.data.result);
							};
							addEventListener("message", receive);
							iframe.contentWindow.postMessage(
								{ type: "memorall-preview-request", id, operation, payload },
								origin,
							);
						}),
					{ operation, payload, target: preview.renderUrl },
				);
			const outline = await call("outline", {});
			const button = outline.blocks.find(
				(block) => block.kind === "button" && block.text === "Count 0",
			);
			assert.ok(button);
			assert.equal(
				(
					await call("act", {
						request: {
							action: "click",
							ref: button.ref,
							docToken: outline.docToken,
						},
					})
				).result.ok,
				true,
			);
			await frame
				.getByRole("button", { name: "Count 1", exact: true })
				.waitFor();
			const screenshot = await call("capture", { maxSide: 600 });
			assert.ok(screenshot);
			// HMR must arrive over the upgraded virtio-backed connection.
			await vm("fs.writeFile", {
				path: "/agents/vite-smoke/src.jsx",
				content:
					"import React from 'react'; import {createRoot} from 'react-dom/client'; createRoot(document.getElementById('root')).render(<h1>HMR reached the VM preview</h1>);",
			});
			await frame
				.getByRole("heading", { name: "HMR reached the VM preview" })
				.waitFor({ timeout: 30000 });
			await page.screenshot({ path: join(data, "preview.png") });
			console.log(
				"Vite imports, preview actions, capture, and WebSocket HMR passed.",
			);
		} finally {
			await browser.close();
			parent.closeAllConnections();
			parent.close();
			await vm("server.stop", { port: 5173 });
		}
	}
	if (process.argv.includes("--restart")) {
		await vm("fs.writeFile", { path: "/restart-marker", content: "persists" });
		await request("sandbox.stop", {}, 30000);
		assert.equal((await request("sandbox.status")).state, "stopped");
		await vm("health");
		assert.equal(
			(await vm("fs.readFile", { path: "/restart-marker" })).content,
			"persists",
		);
		if (process.argv.includes("--online")) {
			const version = await vm("runtime.executeCommand", {
				command: "node --version",
				waitTimeoutMs: 5000,
			});
			assert.match(version.stdout, /v22\./);
			assert.doesNotMatch(version.stdout, /Installing/);
		}
		console.log("VM restart preserved files and installed tools.");
	}
	console.log(`Desktop VM smoke passed. Disposable test data: ${data}`);
} catch (error) {
	const status = await request("sandbox.status", {}, 10000).catch(() => null);
	console.error(
		status ? { ...status, bootLog: status.bootLog.slice(-1500) } : null,
	);
	throw error;
} finally {
	clearInterval(progress);
	if (diagnostics) clearInterval(diagnostics);
	await request("sandbox.stop", {}, 30000).catch(() => undefined);
	await request("shutdown", {}, 30000).catch(() => undefined);
	child.kill();
	lines.close();
	for (const call of pending.values()) clearTimeout(call.timer);
}
