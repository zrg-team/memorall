import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createNetServer } from "node:net";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";

const shouldBuild = process.argv.includes("--build");
const shouldTestLocalModel = process.env.MEMORALL_LOCAL_MODEL_E2E === "1";
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
const app = spawn(executable, [], {
	stdio: "ignore",
	env: webViewArguments
		? {
				...process.env,
				WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: webViewArguments,
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
