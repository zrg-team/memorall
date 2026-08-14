import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
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

async function reserveLoopbackPort() {
	const server = createServer();
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

async function assertWindowsWebViewReady(port) {
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
					console.log(
						"Windows packaged WebView smoke passed: the initialized Memorall UI rendered without a service failure.",
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
	page.on("pageerror", (error) =>
		pageErrors.push(error.stack ?? error.message),
	);

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

	const useChatButton = page.locator("[data-agent-use-chat]");
	if (await useChatButton.isVisible().catch(() => false)) {
		await useChatButton.click();
	}
	const loadSelectedModel = page.locator("[data-load-selected-model]");
	if (await loadSelectedModel.isVisible().catch(() => false)) {
		await loadSelectedModel.click();
		await loadSelectedModel.waitFor({
			state: "hidden",
			timeout: 12 * 60_000,
		});
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
	await composer.press("Enter");
	await pollUntil(
		"a completed local-model assistant response",
		3 * 60_000,
		async () =>
			(await completedAssistantMessages.count()) > completedAssistantCount,
	);
	const responseText = (
		await completedAssistantMessages.nth(completedAssistantCount).innerText()
	).trim();
	if (!responseText || /\b(?:error|failed)\b/iu.test(responseText)) {
		throw new Error(
			`Packaged Windows local-model chat returned an invalid response:\n${responseText || "<empty>"}`,
		);
	}
	if (pageErrors.length > 0) {
		throw new Error(
			`Packaged Windows local-model chat emitted page errors:\n${pageErrors.join("\n")}`,
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
		? assertWindowsWebViewReady(webViewPort).then(async (browser) => {
				webViewBrowser = browser;
				if (shouldTestLocalModel) {
					await assertWindowsLocalModelChat(browser);
				}
			})
		: Promise.resolve();
	await Promise.all([processSurvival, webViewSmoke]);
	console.log(
		`Native desktop smoke passed: ${executable} remained open for 10 seconds.`,
	);
} finally {
	await webViewBrowser?.close().catch(() => {});
	if (app.exitCode === null) app.kill("SIGTERM");
}
