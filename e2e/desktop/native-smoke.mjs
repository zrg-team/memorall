import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const shouldBuild = process.argv.includes("--build");
const shouldTestLocalModel = process.env.MEMORALL_LOCAL_MODEL_E2E === "1";
const shouldTestSandbox = process.env.MEMORALL_SANDBOX_E2E === "1";
const localModelRepo = "LiquidAI/LFM2-VL-450M-GGUF";
const localModelFile = "LFM2-VL-450M-Q4_0.gguf";
const localModelId = `${localModelRepo}/${localModelFile}`;
const platformName =
	process.platform === "win32"
		? "windows"
		: process.platform === "darwin"
			? "macos"
			: process.platform === "linux"
				? "linux"
				: process.platform;
const yarn = process.platform === "win32" ? "yarn.cmd" : "yarn";

function assertWindowsGuiSubsystem(executablePath) {
	const binary = readFileSync(executablePath);
	if (binary.length < 64 || binary.toString("ascii", 0, 2) !== "MZ") {
		throw new Error(
			`Desktop executable is not a valid PE file: ${executablePath}`,
		);
	}

	const peHeaderOffset = binary.readUInt32LE(0x3c);
	const optionalHeaderOffset = peHeaderOffset + 24;
	if (
		optionalHeaderOffset + 70 > binary.length ||
		binary.toString("ascii", peHeaderOffset, peHeaderOffset + 4) !== "PE\0\0"
	) {
		throw new Error(
			`Desktop executable has an invalid PE header: ${executablePath}`,
		);
	}

	const optionalHeaderMagic = binary.readUInt16LE(optionalHeaderOffset);
	if (optionalHeaderMagic !== 0x10b && optionalHeaderMagic !== 0x20b) {
		throw new Error(
			`Desktop executable has an unsupported PE optional header: 0x${optionalHeaderMagic.toString(16)}`,
		);
	}

	const subsystem = binary.readUInt16LE(optionalHeaderOffset + 68);
	if (subsystem !== 2) {
		throw new Error(
			`Windows desktop executable uses PE subsystem ${subsystem}; expected GUI subsystem 2 so launch does not open a terminal.`,
		);
	}
}

function run(command, args) {
	return new Promise((resolveRun, reject) => {
		const child = spawn(command, args, {
			cwd: process.cwd(),
			stdio: "inherit",
			shell: process.platform === "win32",
		});
		child.once("error", reject);
		child.once("exit", (code) =>
			code === 0
				? resolveRun()
				: reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)),
		);
	});
}

function waitForExit(child, timeoutMs) {
	if (child.exitCode !== null) return Promise.resolve(true);
	return new Promise((resolveWait) => {
		const timer = setTimeout(() => {
			child.off("exit", onExit);
			resolveWait(false);
		}, timeoutMs);
		const onExit = () => {
			clearTimeout(timer);
			resolveWait(true);
		};
		child.once("exit", onExit);
	});
}

async function stopSpawnedApp(app, webViewBrowser) {
	if (app.exitCode !== null) return;

	const page = webViewBrowser
		?.contexts()
		.flatMap((context) => context.pages())[0];
	if (page) {
		await Promise.race([
			page.evaluate(() =>
				window.__TAURI_INTERNALS__?.invoke("plugin:window|close", {
					label: "main",
				}),
			),
			new Promise((resolveWait) => setTimeout(resolveWait, 2_000)),
		]).catch(() => {});
		if (await waitForExit(app, 5_000)) return;
	}

	if (process.platform === "win32" && app.pid) {
		await new Promise((resolveWait) => {
			const killer = spawn(
				"taskkill.exe",
				["/pid", String(app.pid), "/t", "/f"],
				{
					stdio: "ignore",
					windowsHide: true,
				},
			);
			killer.once("error", resolveWait);
			killer.once("exit", resolveWait);
		});
		await waitForExit(app, 5_000);
		return;
	}

	app.kill("SIGTERM");
	if (!(await waitForExit(app, 5_000))) app.kill("SIGKILL");
}

async function reserveLoopbackPort() {
	const server = createNetServer();
	await new Promise((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolveListen);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		server.close();
		throw new Error("Could not reserve a loopback port for WebView2 smoke.");
	}
	await new Promise((resolveClose, reject) =>
		server.close((error) => (error ? reject(error) : resolveClose())),
	);
	return address.port;
}

async function startBrowserFixture() {
	const server = createHttpServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/html" });
		response.end(
			"<!doctype html><title>Tauri bridge fixture</title><main>bundled browser bridge ready</main>",
		);
	});
	await new Promise((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolveListen);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		server.close();
		throw new Error("Could not start the desktop browser fixture.");
	}
	return { server, url: `http://127.0.0.1:${address.port}/fixture` };
}

async function waitForWebViewEndpoint(port) {
	const endpoint = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + 25_000;
	let lastError;
	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${endpoint}/json/version`);
			if (response.ok) return endpoint;
			lastError = new Error(`WebView2 endpoint returned ${response.status}.`);
		} catch (error) {
			lastError = error;
		}
		await new Promise((resolveWait) => setTimeout(resolveWait, 250));
	}
	throw new Error(
		`WebView2 debugging endpoint did not start on ${endpoint}: ${lastError?.message ?? "unknown error"}`,
	);
}

async function isPackagedMemorallPage(page) {
	let url;
	try {
		url = new URL(page.url());
	} catch {
		return false;
	}
	if (url.hostname !== "tauri.localhost") return false;
	return (await page.locator("#root > *").count()) > 0;
}

async function assertWindowsWebViewReady(port, browserFixtureUrl) {
	const endpoint = await waitForWebViewEndpoint(port);
	const browser = await chromium.connectOverCDP(endpoint);
	try {
		const deadline = Date.now() + 25_000;
		let lastBody = "";
		while (Date.now() < deadline) {
			const pages = browser.contexts().flatMap((context) => context.pages());
			for (const page of pages) {
				try {
					lastBody = await page.locator("body").innerText({ timeout: 1_000 });
				} catch {
					continue;
				}
				if (
					/Service Initialization Failed|Database initialization failed/i.test(
						lastBody,
					)
				) {
					throw new Error(
						`Packaged WebView rendered a service initialization failure:\n${lastBody}`,
					);
				}
				if (
					lastBody.trim().length >= 50 &&
					(await isPackagedMemorallPage(page))
				) {
					const bridgeResult = await page.evaluate(async (url) => {
						try {
							const invoke = window.__TAURI_INTERNALS__?.invoke;
							if (typeof invoke !== "function") {
								throw new Error(
									"Tauri invoke bridge is unavailable in the packaged WebView.",
								);
							}
							const sessionId = "tauri-webview-smoke";
							const opened = await invoke("desktop_browser_request", {
								request: {
									source: "memorall:web-browser-command",
									command: "open",
									sessionId,
									url,
									mode: "tab",
									timeoutMs: 5_000,
									maxHtmlChars: 20_000,
								},
							});
							if (!opened?.success) return opened;
							await invoke("desktop_browser_request", {
								request: {
									source: "memorall:web-browser-command",
									command: "close",
									sessionId,
									tabId: opened.surface.tabId,
								},
							});
							return opened;
						} catch (error) {
							return {
								success: false,
								bridgeError:
									typeof error === "object" && error !== null
										? { ...error, message: error.message }
										: String(error),
							};
						}
					}, browserFixtureUrl);
					if (
						!bridgeResult?.success ||
						bridgeResult.snapshot?.title !== "Tauri bridge fixture"
					) {
						throw new Error(
							`Packaged Tauri browser bridge failed: ${JSON.stringify(bridgeResult)}`,
						);
					}
					console.log(
						"Windows packaged WebView smoke passed: the initialized UI invoked the bundled Chromium bridge.",
					);
					return browser;
				}
			}
			await new Promise((resolveWait) => setTimeout(resolveWait, 250));
		}
		throw new Error(
			`Packaged WebView did not render a ready Memorall UI. Last body text:\n${lastBody || "<empty>"}`,
		);
	} catch (error) {
		await browser.close().catch(() => {});
		throw error;
	}
}

async function pollUntil(description, timeout, predicate) {
	const deadline = Date.now() + timeout;
	let lastValue;
	while (Date.now() < deadline) {
		lastValue = await predicate();
		if (lastValue) return lastValue;
		await new Promise((resolveWait) => setTimeout(resolveWait, 250));
	}
	throw new Error(
		`Timed out waiting for ${description}. Last value: ${String(lastValue)}`,
	);
}

async function assertWindowsSandbox(browser) {
	const page = browser
		.contexts()
		.flatMap((context) => context.pages())
		.find(
			(candidate) => new URL(candidate.url()).hostname === "tauri.localhost",
		);
	if (!page) throw new Error("Native sandbox smoke needs the main WebView");
	const agentStoreFile = readdirSync(
		resolve("publish/desktop/frontend/assets"),
	).find(
		(name) =>
			/^index-.*\.js$/.test(name) &&
			readFileSync(
				resolve("publish/desktop/frontend/assets", name),
				"utf8",
			).includes("toggleFeature:") &&
			readFileSync(
				resolve("publish/desktop/frontend/assets", name),
				"utf8",
			).includes("draftFeatures:"),
	);
	if (!agentStoreFile)
		throw new Error("The production agent settings module is missing");
	await page.evaluate(async (file) => {
		const exports = await import(`./assets/${file}`);
		const store = Object.values(exports).find(
			(value) =>
				typeof value === "function" &&
				typeof value.getState === "function" &&
				typeof value.getState()?.toggleFeature === "function",
		);
		if (!store)
			throw new Error("The production agent settings store is missing");
		const { draftFeatures, isDirty } = store.getState();
		try {
			store.setState({
				draftFeatures: { ...draftFeatures, "nodejs-sandbox-feature": false },
			});
			store.getState().toggleFeature("nodejs-sandbox-feature");
		} finally {
			store.setState({ draftFeatures, isDirty });
		}
	}, agentStoreFile);
	await pollUntil(
		"an enabled agent automatically starting its sandbox",
		10000,
		async () => {
			const status = await page.evaluate(() =>
				window.__TAURI_INTERNALS__.invoke("desktop_sandbox_status"),
			);
			return ["starting", "ready"].includes(status.state) ? status : null;
		},
	);
	console.log(
		"Enabling Sandbox in agent settings started the VM without a running memonOS PC.",
	);
	console.log(
		"Booting the packaged VM through Tauri; a first boot can take a few minutes...",
	);
	const preview = await page.evaluate(async () => {
		const invoke = window.__TAURI_INTERNALS__.invoke;
		const vm = (operation, payload = null) =>
			invoke("desktop_sandbox_request", {
				operation,
				payload,
				timeoutMs: 180000,
			});
		await vm("health");
		let command = await vm("runtime.executeCommand", {
			command: "ls -la . && py -c 'print(\"TAURI_VM_OK\")'",
			cwd: "/agents/terminal-smoke",
			env: null,
			waitTimeoutMs: 5000,
		});
		while (!command.completed)
			command = await vm("runtime.listenCommand", {
				commandId: command.commandId,
				offset: 0,
				waitTimeoutMs: 5000,
			});
		if (command.exitCode !== 0 || !command.stdout.includes("TAURI_VM_OK"))
			throw new Error(JSON.stringify(command));
		if (command.stdout.includes("[object Object]"))
			throw new Error("Native terminal returned an object instead of output");
		const source = [
			"from http.server import BaseHTTPRequestHandler,HTTPServer",
			"class Handler(BaseHTTPRequestHandler):",
			" def do_GET(self):",
			"  self.send_response(200)",
			"  self.send_header('Content-Type','text/html')",
			"  self.end_headers()",
			"  self.wfile.write(b'<!doctype html><html><head></head><body><h1>Native sandbox bridge</h1></body></html>')",
			"HTTPServer(('127.0.0.1',8912),Handler).serve_forever()",
		].join("\n");
		const server = await vm("runtime.executeCommand", {
			command: `py -c "import base64;exec(base64.b64decode('${btoa(source)}'))"`,
			waitTimeoutMs: 1000,
			commandTimeoutMs: 0,
		});
		const target = await vm("server.renderUrl", { port: 8912 });
		return { ...target, commandId: server.commandId };
	});
	try {
		await page.evaluate((url) => {
			const iframe = document.createElement("iframe");
			iframe.id = "native-sandbox-smoke";
			iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
			iframe.src = url;
			document.body.appendChild(iframe);
		}, preview.url);
		await page
			.frameLocator("#native-sandbox-smoke")
			.getByRole("heading", { name: "Native sandbox bridge" })
			.waitFor({ timeout: 20000 });
		const frame = page
			.frames()
			.find((candidate) =>
				candidate.url().startsWith(new URL(preview.url).origin),
			);
		if (!frame) throw new Error("Native preview frame is missing");
		const access = await frame.evaluate(async () => {
			const invoke = window.__TAURI_INTERNALS__?.invoke;
			if (typeof invoke !== "function")
				return { callable: false, allowed: false };
			try {
				await invoke("app_data_path");
				return { callable: true, allowed: true };
			} catch {
				return { callable: true, allowed: false };
			}
		});
		if (access.allowed)
			throw new Error(
				"Untrusted preview was allowed to invoke a native app command",
			);
		console.log(
			"Packaged sandbox commands and preview passed; guest iframe cannot invoke native app commands.",
		);
	} finally {
		await page.evaluate(async (id) => {
			document.querySelector("#native-sandbox-smoke")?.remove();
			await window.__TAURI_INTERNALS__.invoke("desktop_sandbox_request", {
				operation: "runtime.stopCommand",
				payload: { commandId: id },
				timeoutMs: 10000,
			});
			await window.__TAURI_INTERNALS__.invoke("desktop_sandbox_stop");
		}, preview.commandId);
	}
}

async function assertWindowsMemonTerminal(browser) {
	const page = browser
		.contexts()
		.flatMap((context) => context.pages())
		.find(
			(candidate) => new URL(candidate.url()).hostname === "tauri.localhost",
		);
	if (!page) throw new Error("The main WebView is missing");
	const mappedRoots = await page.evaluate(() =>
		window.__TAURI_INTERNALS__.invoke("fs_map_list_roots"),
	);
	if (mappedRoots.length)
		throw new Error(
			"Sandbox acceptance requires an isolated folder mapping registry",
		);
	const file = readdirSync(resolve("publish/desktop/frontend/assets")).find(
		(name) => /^memon-client-.*\.js$/.test(name),
	);
	if (!file) throw new Error("The production memon client module is missing");
	const containerFile = readdirSync(
		resolve("publish/desktop/frontend/assets"),
	).find((name) => /^sandbox-container-service-main-.*\.js$/.test(name));
	if (!containerFile)
		throw new Error("The production sandbox service module is missing");
	if (process.env.MEMORALL_SANDBOX_TRACE === "1") {
		page.on("console", (message) => {
			if (message.text().startsWith("SANDBOX_TRACE "))
				console.log(message.text());
		});
		const serviceFile = readdirSync(
			resolve("publish/desktop/frontend/assets"),
		).find((name) => /^sandbox-container-service-main-.*\.js$/.test(name));
		await page.evaluate(async (file) => {
			const module = await import(`./assets/${file}`);
			const service = Object.values(module)
				.find(
					(value) =>
						typeof value?.getInstance === "function" &&
						typeof value?.prototype?.listenCommand === "function",
				)
				.getInstance();
			for (const [target, names] of [
				[service, ["request", "prepareWorkspace"]],
				[
					service.workspaceSync,
					[
						"fill",
						"pull",
						"pushHostChanges",
						"ready",
						"readyInteractive",
						"flush",
						"drain",
					],
				],
				[service.workspaceSync.files, ["list", "apply", "catchUp"]],
			]) {
				for (const name of names) {
					const original = target[name].bind(target);
					target[name] = async (...args) => {
						const start = Date.now();
						const argument = typeof args[0] === "string" ? args[0] : undefined;
						console.log(
							"SANDBOX_TRACE " + JSON.stringify({ name, argument, start }),
						);
						try {
							const result = await original(...args);
							console.log(
								"SANDBOX_TRACE " +
									JSON.stringify({
										name,
										argument,
										start,
										duration: Date.now() - start,
										ops: result?.ops?.length,
										paths: result?.ops?.slice(0, 3),
										buffer: result?.buffer?.byteLength,
										status: result?.status,
										exitCode: result?.exitCode,
									}),
							);
							return result;
						} catch (error) {
							console.log(
								"SANDBOX_TRACE " +
									JSON.stringify({
										name,
										argument,
										start,
										error: String(error),
									}),
							);
							throw error;
						}
					};
				}
			}
			const sync = service.workspaceSync;
			const enqueue = sync.enqueue.bind(sync);
			sync.enqueue = (task, options) => {
				const queued = Date.now();
				const label = task.toString().slice(0, 120);
				return enqueue(async () => {
					console.log(
						"SANDBOX_TRACE " +
							JSON.stringify({
								name: "queue",
								label,
								wait: Date.now() - queued,
							}),
					);
					return task();
				}, options);
			};
		}, serviceFile);
	}
	const chatStoreFile = readdirSync(
		resolve("publish/desktop/frontend/assets"),
	).find(
		(name) =>
			/^index-.*\.js$/.test(name) &&
			readFileSync(
				resolve("publish/desktop/frontend/assets", name),
				"utf8",
			).includes("setSelectedAgentFlowId:"),
	);
	if (!chatStoreFile)
		throw new Error("The production chat store module is missing");
	// Select this isolated PC without changing the user's persisted agent setting.
	const selectAgent = (agentId) =>
		page.evaluate(
			async ({ file, agentId }) => {
				const exports = await import(`./assets/${file}`);
				const store = Object.values(exports).find(
					(value) =>
						typeof value === "function" &&
						typeof value.getState === "function" &&
						typeof value.getState()?.setSelectedAgentFlowId === "function",
				);
				if (!store) throw new Error("The production chat store is missing");
				const previous = store.getState().selectedAgentFlowId;
				store.setState({ selectedAgentFlowId: agentId });
				return previous;
			},
			{ file: chatStoreFile, agentId },
		);
	const key = `native-sandbox-smoke-${Date.now().toString(36)}`;
	const stressRoot = `/agents/${key}-sync-load`;
	const changeStressFiles = (remove = false) =>
		page.evaluate(
			async ({ file, root, remove }) => {
				const module = await import(`./assets/${file}`);
				const service = Object.values(module)
					.find(
						(value) =>
							typeof value?.getInstance === "function" &&
							typeof value?.prototype?.listenCommand === "function",
					)
					.getInstance();
				const buffer = remove
					? undefined
					: new TextEncoder().encode("x".repeat(768 * 1024)).buffer;
				const ops = remove
					? [{ op: "delete", path: root, dir: true }]
					: Array.from({ length: 28 }, (_, index) => ({
							op: "write",
							path: `${root}/payload-${index}.txt`,
							offset: 0,
							length: buffer.byteLength,
						}));
				const failures = await service.workspaceSync.files.apply(
					ops,
					buffer,
					"native-sandbox-smoke",
				);
				if (failures.length)
					throw new Error(
						`Cannot prepare isolated sync stress fixture: ${JSON.stringify(failures)}`,
					);
			},
			{ file: containerFile, root: stressRoot, remove },
		);
	const request = (operation, payload, timeout = 360000) =>
		page.evaluate(
			async ({ file, operation, payload, timeout }) => {
				const exports = await import(`./assets/${file}`);
				const client = Object.values(exports).find(
					(value) => value && typeof value.request === "function",
				);
				if (!client) throw new Error("The production memon client is missing");
				return Promise.race([
					client.request(operation, payload),
					new Promise((_, reject) =>
						setTimeout(
							() =>
								reject(
									new Error(
										`Production memon operation timed out: ${operation}`,
									),
								),
							timeout,
						),
					),
				]);
			},
			{ file, operation, payload, timeout },
		);
	let snapshot;
	const previousAgentId = await selectAgent(key);
	try {
		console.log("Starting production memonOS with the VM stopped...");
		const start = Date.now();
		snapshot = await request("machine.start", { key, agentId: key }, 30000);
		const fileDisplayMs = Date.now() - start;
		if (fileDisplayMs > 10000)
			throw new Error(
				`Desktop files took too long while warming the VM: ${fileDisplayMs} ms`,
			);
		if (!snapshot.desktop.some((entry) => entry.name === "Bot.md"))
			throw new Error("Desktop files were not included in the first snapshot");
		if (snapshot.builtInApps?.includes("sandbox"))
			throw new Error("Sandbox should be settings, not a desktop app");
		const state = await page.evaluate(() =>
			window.__TAURI_INTERNALS__.invoke("desktop_sandbox_status"),
		);
		if (!["starting", "ready"].includes(state.state))
			throw new Error(`PC power-on did not start the VM: ${state.state}`);
		console.log(
			`Production memonOS first files: ${fileDisplayMs} ms while VM is ${state.state}.`,
		);
		await request("window.open", { key, app: "terminal" });
		await page.keyboard.press("Escape");
		await page.evaluate(() => {
			localStorage.setItem("memorall-copilot-completed", "true");
			window.location.hash = "/runtime";
		});
		await page
			.getByRole("tab", { name: "Computer", exact: true })
			.click({ timeout: 20000 });
		await selectAgent(key);
		const footer = page
			.getByTestId("memon-taskbar")
			.getByTestId("memon-settings-tray");
		await footer.waitFor({ timeout: 20000 });
		const barBounds = await page.getByTestId("memon-taskbar").boundingBox();
		const trayBounds = await footer.boundingBox();
		if (
			!barBounds ||
			!trayBounds ||
			barBounds.height > 56 ||
			trayBounds.y < barBounds.y ||
			trayBounds.y + trayBounds.height > barBounds.y + barBounds.height
		)
			throw new Error(
				"Computer settings must fit within the single apps taskbar",
			);
		const openSettings = async () => {
			if (!(await page.getByTestId("memon-config-panel").isVisible()))
				await footer
					.getByRole("button", { name: "Open computer settings" })
					.click();
		};
		await openSettings();
		const sandbox = page.getByTestId("desktop-sandbox-status");
		await sandbox
			.getByRole("button", { name: "Stop sandbox" })
			.click({ timeout: 20000 });
		await sandbox
			.getByRole("status", { name: "Sandbox: Stopped" })
			.waitFor({ timeout: 30000 });
		const terminalInput = page.locator(".xterm-helper-textarea");
		if (!(await terminalInput.isDisabled()))
			throw new Error("Stopped sandbox still accepts terminal input");
		await sandbox.getByRole("button", { name: "Start sandbox" }).click();
		await sandbox
			.getByRole("status", { name: "Sandbox: Starting…" })
			.waitFor({ timeout: 10000 });
		if (!(await terminalInput.isDisabled()))
			throw new Error("Starting sandbox still accepts terminal input");
		await page.screenshot({
			path: resolve("publish/.cache/native-sandbox-smoke/starting.png"),
		});
		await sandbox
			.getByRole("status", { name: "Sandbox: Ready" })
			.waitFor({ timeout: 360000 });
		await page.waitForFunction(
			() => !document.querySelector(".xterm-helper-textarea")?.disabled,
		);
		await request("window.open", { key, app: "terminal" });
		await page.keyboard.press("Escape");
		const checkLs = async (label) => {
			const previousLines = snapshot.terminal.lines.length;
			const commandStart = performance.now();
			snapshot = await request("terminal.exec", { key, command: "ls" }, 10000);
			const deadline = commandStart + 3000;
			while (snapshot.terminal.runningCommand && performance.now() < deadline) {
				await new Promise((resolve) => setTimeout(resolve, 100));
				snapshot = await request("snapshot.get", { key });
			}
			if (
				snapshot.terminal.runningCommand ||
				snapshot.terminal.lastExitCode !== 0
			)
				throw new Error(
					`ls did not finish: ${JSON.stringify(snapshot.terminal)}`,
				);
			const elapsed = Math.round(performance.now() - commandStart);
			console.log(`Production ls ${label}: ${elapsed} ms`);
			if (elapsed > 3000)
				throw new Error(`ls ${label} took too long after Ready: ${elapsed} ms`);
			const latestOutput = snapshot.terminal.lines
				.slice(previousLines)
				.filter((line) => line.kind === "stdout")
				.map((line) => line.text)
				.join("\n");
			if (
				!latestOutput.includes("Bot.md") ||
				!latestOutput.includes("Memory.md")
			)
				throw new Error(`ls ${label} lost its output: ${latestOutput}`);
		};
		for (let attempt = 0; attempt < 8; attempt++)
			await checkLs(String(attempt + 1));
		await changeStressFiles();
		await new Promise((resolve) => setTimeout(resolve, 100));
		for (let attempt = 0; attempt < 5; attempt++)
			await checkLs(`during background sync ${attempt + 1}`);
		await changeStressFiles(true);
		const cleanupDeadline = performance.now() + 15000;
		while (true) {
			const exists = await page.evaluate(
				(path) =>
					window.__TAURI_INTERNALS__.invoke("desktop_sandbox_request", {
						operation: "fs.exists",
						payload: { path },
						timeoutMs: 10000,
					}),
				stressRoot,
			);
			if (!exists.exists) break;
			if (performance.now() > cleanupDeadline)
				throw new Error("The isolated sync fixture did not finish cleaning up");
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		const output = snapshot.terminal.lines
			.filter((line) => line.kind === "stdout")
			.map((line) => line.text)
			.join("\n");
		if (!output.includes("Bot.md") || !output.includes("Memory.md"))
			throw new Error(`ls did not list the desktop files: ${output}`);
		await footer
			.getByRole("status", { name: "Sandbox: Ready" })
			.waitFor({ timeout: 20000 });
		await openSettings();
		await page.screenshot({
			path: resolve("publish/.cache/native-sandbox-smoke/terminal.png"),
		});
		await page.keyboard.press("Escape");
		await request("terminal.exec", { key, command: "sleep 60" });
		await openSettings();
		await sandbox.getByRole("button", { name: "Stop sandbox" }).click();
		await sandbox
			.getByRole("status", { name: "Sandbox: Stopped" })
			.waitFor({ timeout: 30000 });
		await new Promise((resolve) => setTimeout(resolve, 2500));
		const stopped = await page.evaluate(() =>
			window.__TAURI_INTERNALS__.invoke("desktop_sandbox_status"),
		);
		if (stopped.state !== "stopped")
			throw new Error(
				`Terminal polling restarted the stopped VM: ${stopped.state}`,
			);
		if (!(await terminalInput.isDisabled()))
			throw new Error(
				"Terminal was not disabled after stopping a running sandbox",
			);
		await page.screenshot({
			path: resolve("publish/.cache/native-sandbox-smoke/stopped.png"),
		});
		await sandbox.getByRole("button", { name: "Start sandbox" }).click();
		await sandbox
			.getByRole("status", { name: "Sandbox: Ready" })
			.waitFor({ timeout: 360000 });
		await page.waitForFunction(
			() => !document.querySelector(".xterm-helper-textarea")?.disabled,
		);
		const beforeRestart = (await request("snapshot.get", { key })).terminal
			.lines.length;
		await page.keyboard.press("Escape");
		const restartedCommandStart = performance.now();
		snapshot = await request("terminal.exec", { key, command: "ls" }, 10000);
		const restartDeadline = restartedCommandStart + 3000;
		while (
			snapshot.terminal.runningCommand &&
			performance.now() < restartDeadline
		) {
			await new Promise((resolve) => setTimeout(resolve, 100));
			snapshot = await request("snapshot.get", { key });
		}
		const restartedOutput = snapshot.terminal.lines
			.slice(beforeRestart)
			.filter((line) => line.kind === "stdout")
			.map((line) => line.text)
			.join("\n");
		const restartedElapsed = Math.round(
			performance.now() - restartedCommandStart,
		);
		console.log(`Production ls after restart: ${restartedElapsed} ms`);
		if (
			snapshot.terminal.runningCommand ||
			snapshot.terminal.lastExitCode !== 0 ||
			restartedElapsed > 3000 ||
			!restartedOutput.includes("Bot.md") ||
			!restartedOutput.includes("Memory.md")
		)
			throw new Error(
				`Terminal after restart (${restartedElapsed} ms): ${JSON.stringify(snapshot.terminal)}; output: ${restartedOutput}`,
			);
		console.log(
			`Production memonOS startup, settings popover, Stop/Restart, and readiness gating passed; ls completed eight times and after restart (${restartedElapsed} ms).`,
		);
		await openSettings();
		await sandbox.getByRole("button", { name: "Stop sandbox" }).click();
		await sandbox
			.getByRole("status", { name: "Sandbox: Stopped" })
			.waitFor({ timeout: 30000 });
	} catch (error) {
		await page
			.screenshot({
				path: resolve("publish/.cache/native-sandbox-smoke/failure.png"),
			})
			.catch(() => {});
		console.error(
			"Sandbox command states:",
			await page
				.evaluate(() =>
					window.__TAURI_INTERNALS__.invoke("desktop_sandbox_request", {
						operation: "runtime.listCommands",
						payload: null,
						timeoutMs: 10000,
					}),
				)
				.catch((error) => String(error)),
		);
		console.error(
			"Terminal snapshot:",
			await request("snapshot.get", { key })
				.then((value) => ({
					...value.terminal,
					lines: value.terminal.lines.slice(-8),
				}))
				.catch((error) => String(error)),
		);
		console.error(
			"Packaged PC selection:",
			await page
				.evaluate(async (file) => {
					const exports = await import(`./assets/${file}`);
					return Object.values(exports)
						.filter(
							(value) =>
								typeof value === "function" &&
								typeof value.getState === "function",
						)
						.map((store) => {
							const state = store.getState();
							if ("selectedAgentFlowId" in state)
								return { selectedAgentFlowId: state.selectedAgentFlowId };
							if ("summaries" in state && "watch" in state)
								return {
									summaries: Object.keys(state.summaries),
									snapshots: Object.keys(state.snapshots),
									error: state.error,
								};
							return null;
						})
						.filter(Boolean);
				}, chatStoreFile)
				.catch(() => "unavailable"),
			"Packaged memonOS UI at failure:",
			await page
				.locator("body")
				.innerText()
				.catch(() => "unavailable"),
		);
		throw error;
	} finally {
		await changeStressFiles(true).catch(() => {});
		if (snapshot?.home === `/agents/${key}`)
			await request(
				"files.delete",
				{ key, paths: [snapshot.home] },
				5000,
			).catch(() => {});
		await request("machine.stop", { key }, 5000).catch(() => {});
		await selectAgent(previousAgentId).catch(() => {});
	}
}

async function assertWindowsLocalModelChat(browser) {
	const page = await pollUntil(
		"the packaged Memorall page",
		15_000,
		async () => {
			for (const candidate of browser
				.contexts()
				.flatMap((context) => context.pages())) {
				const body = await candidate
					.locator("body")
					.innerText({ timeout: 1_000 })
					.catch(() => "");
				if (
					body.trim().length >= 50 &&
					(await isPackagedMemorallPage(candidate))
				)
					return candidate;
			}
			return null;
		},
	);
	const pageErrors = [];
	const consoleErrors = [];
	page.on("pageerror", (error) =>
		pageErrors.push(error.stack ?? error.message),
	);
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});

	await page.evaluate(() => {
		localStorage.setItem("memorall-copilot-completed", "true");
		window.location.hash = "/llm";
	});
	await page.locator("[data-llm-page]").waitFor({
		state: "attached",
		timeout: 60_000,
	});

	const currentModel = page.locator(
		`[data-llm-page][data-current-model-provider="wllama"][data-current-model-id="${localModelId}"]`,
	);
	const isAlreadySelected = await currentModel
		.waitFor({ state: "attached", timeout: 5_000 })
		.then(() => true)
		.catch(() => false);
	if (!isAlreadySelected) {
		// The models page opens on the "Recommended" chooser until a model exists.
		await page.locator('[data-panel-mode="browse"]').click();
		await page.locator('[data-provider-tab="wllama"]').click();
		const quickModelCard = page.locator(
			`[data-model-provider="wllama"][data-model-id="${localModelRepo}"]`,
		);
		const quickModelAvailable = await quickModelCard
			.waitFor({ state: "visible", timeout: 5_000 })
			.then(() => true)
			.catch(() => false);
		if (quickModelAvailable) {
			const modelAction = quickModelCard.locator("[data-model-action]");
			const modelActionState =
				await modelAction.getAttribute("data-model-action");
			if (modelActionState === "download" || modelActionState === "load") {
				await modelAction.click();
			}
			await quickModelCard.locator('[data-model-action="ready"]').waitFor({
				state: "attached",
				timeout: 12 * 60_000,
			});
		} else {
			await page.locator("[data-model-sidebar-toggle]").click();
			const downloadedModel = page.locator(
				`[data-downloaded-model-provider="wllama"][data-downloaded-model-id="${localModelId}"]`,
			);
			await downloadedModel.waitFor({ state: "visible", timeout: 60_000 });
			await downloadedModel
				.locator('[data-downloaded-model-action="load"]')
				.click();
		}
	}
	await currentModel.waitFor({ state: "attached", timeout: 12 * 60_000 });

	const loadSelectedModel = page.locator("[data-load-selected-model]");
	if (await loadSelectedModel.isVisible().catch(() => false)) {
		await loadSelectedModel.click();
		await loadSelectedModel.waitFor({
			state: "hidden",
			timeout: 12 * 60_000,
		});
	}

	const chatPage = page.locator("[data-chat-selected-agent-flow]");
	await chatPage.waitFor({ state: "attached", timeout: 60_000 });
	if (
		(await chatPage.getAttribute("data-chat-selected-agent-flow")) !== "chat"
	) {
		const useChatButton = page.locator("[data-agent-use-chat]");
		await useChatButton.waitFor({ state: "visible", timeout: 60_000 });
		await useChatButton.click();
		await pollUntil(
			"Chat mode to become active",
			30_000,
			async () =>
				(await chatPage.getAttribute("data-chat-selected-agent-flow")) ===
				"chat",
		);
	}

	const previousConversationId = await chatPage.getAttribute(
		"data-chat-conversation-id",
	);
	const newChatButton = page.locator("[data-new-chat]");
	let openedCompactSidePanel = false;
	if ((await newChatButton.count()) === 0) {
		await page.locator("[data-chat-side-panel-toggle]").click();
		await newChatButton.waitFor({ state: "visible", timeout: 30_000 });
		openedCompactSidePanel = true;
	}
	await newChatButton.click();
	await pollUntil("a new empty Chat conversation", 60_000, async () => {
		const conversationId = await chatPage.getAttribute(
			"data-chat-conversation-id",
		);
		const historyBoundary = await chatPage.getAttribute(
			"data-chat-history-boundary",
		);
		return Boolean(
			conversationId &&
				conversationId !== previousConversationId &&
				historyBoundary === "",
		);
	});
	if (openedCompactSidePanel) {
		await page.locator("[data-chat-side-panel-close]").click();
	}

	const composer = page.locator('[contenteditable="true"][role="textbox"]');
	await composer.waitFor({ state: "visible", timeout: 60_000 });
	const completedAssistantMessages = page.locator(
		'[data-message-role="assistant"][data-message-state="complete"] [data-message-content]',
	);
	const completedAssistantCount = await completedAssistantMessages.count();
	await composer.fill(
		"Reply with one short sentence confirming local inference works. Token: LOCAL_MODEL_E2E.",
	);
	const submitButton = page.locator("[data-chat-submit]");
	await submitButton.waitFor({ state: "visible", timeout: 30_000 });
	await pollUntil(
		"the local-chat submit button to become enabled",
		30_000,
		async () => !(await submitButton.isDisabled()),
	);
	await submitButton.click();
	try {
		await pollUntil(
			"a completed local-model assistant response",
			3 * 60_000,
			async () =>
				(await completedAssistantMessages.count()) > completedAssistantCount,
		);
	} catch (error) {
		const diagnostics = {
			currentModel: {
				id: await currentModel.getAttribute("data-current-model-id"),
				provider: await currentModel.getAttribute(
					"data-current-model-provider",
				),
			},
			selectedAgentFlow: await chatPage.getAttribute(
				"data-chat-selected-agent-flow",
			),
			conversation: {
				id: await chatPage.getAttribute("data-chat-conversation-id"),
				historyBoundary: await chatPage.getAttribute(
					"data-chat-history-boundary",
				),
			},
			messages: await page
				.locator("[data-message-role]")
				.evaluateAll((elements) =>
					elements.map((element) => ({
						role: element.getAttribute("data-message-role"),
						state: element.getAttribute("data-message-state"),
						text: element.textContent?.trim().slice(0, 500),
					})),
				),
			pageErrors,
			consoleErrors,
		};
		console.error(
			`Desktop local-model chat diagnostics: ${JSON.stringify(diagnostics, null, 2)}`,
		);
		throw error;
	}
	const responseText = (
		await completedAssistantMessages.nth(completedAssistantCount).innerText()
	).trim();
	if (!responseText || /\b(?:error|failed)\b/iu.test(responseText)) {
		throw new Error(
			`Packaged Windows local-model chat returned an invalid response:\n${responseText || "<empty>"}`,
		);
	}
	if (pageErrors.length > 0 || consoleErrors.length > 0) {
		throw new Error(
			`Packaged Windows local-model chat emitted browser errors:\n${[
				...pageErrors,
				...consoleErrors,
			].join("\n")}`,
		);
	}
	console.log(
		`Windows packaged local Wllama chat passed (${responseText.length} chars): ${responseText.slice(0, 240)}`,
	);
}

if (shouldBuild) {
	await run(yarn, [`build:desktop:${platformName}`]);
}

const candidates =
	process.platform === "win32"
		? ["publish/desktop/windows/memorall-desktop.exe"]
		: process.platform === "darwin"
			? [
					"publish/desktop/macos/bundle/macos/Memorall.app/Contents/MacOS/Memorall",
					"publish/desktop/macos/memorall-desktop",
				]
			: ["publish/desktop/linux/memorall-desktop"];
const executable = candidates
	.map((candidate) => resolve(candidate))
	.find(existsSync);
if (!executable) {
	throw new Error(
		`No native Memorall executable found. Run yarn build:desktop:${platformName} first.`,
	);
}

if (process.platform === "win32") {
	assertWindowsGuiSubsystem(executable);
	console.log(
		"Windows GUI subsystem check passed: launch will not allocate a terminal.",
	);
}

const webViewPort =
	process.platform === "win32" ? await reserveLoopbackPort() : undefined;
const browserFixture =
	process.platform === "win32" ? await startBrowserFixture() : undefined;
const webViewArguments = webViewPort
	? [
			process.env.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS,
			`--remote-debugging-port=${webViewPort}`,
		]
			.filter(Boolean)
			.join(" ")
	: undefined;
if (shouldTestSandbox)
	mkdirSync(resolve("publish/.cache/native-sandbox-smoke"), {
		recursive: true,
	});
const app = spawn(executable, [], {
	stdio: "ignore",
	env: webViewArguments
		? {
				...process.env,
				WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: webViewArguments,
				...(shouldTestSandbox
					? {
							WEBVIEW2_USER_DATA_FOLDER: resolve(
								"publish/.cache/native-sandbox-smoke/webview",
							),
							MEMORALL_VM_DATA_DIR:
								process.env.MEMORALL_VM_DATA_DIR ??
								resolve("publish/.cache/native-sandbox-smoke/vm"),
							MEMORALL_FS_MAP_REGISTRY: resolve(
								"publish/.cache/native-sandbox-smoke/mapped-roots.json",
							),
						}
					: {}),
			}
		: process.env,
});
let webViewBrowser;
try {
	const processSurvival = new Promise((resolveWait, reject) => {
		const timer = setTimeout(resolveWait, 10_000);
		app.once("error", (error) => {
			clearTimeout(timer);
			reject(error);
		});
		app.once("exit", (code, signal) => {
			clearTimeout(timer);
			reject(
				new Error(
					`Desktop app exited during smoke window (${signal ?? `exit code ${code}`}).`,
				),
			);
		});
	});
	const webViewSmoke = webViewPort
		? assertWindowsWebViewReady(webViewPort, browserFixture.url).then(
				async (browser) => {
					webViewBrowser = browser;
					if (shouldTestSandbox) {
						await assertWindowsMemonTerminal(browser);
						await assertWindowsSandbox(browser);
					}
					if (shouldTestLocalModel) {
						await assertWindowsLocalModelChat(browser);
					}
				},
			)
		: Promise.resolve();
	await Promise.all([processSurvival, webViewSmoke]);
	console.log(
		`Native desktop smoke passed: ${executable} remained open for 10 seconds.`,
	);
} finally {
	await stopSpawnedApp(app, webViewBrowser);
	await webViewBrowser?.close().catch(() => {});
	browserFixture?.server.close();
}
