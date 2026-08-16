import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { type BrowserContext, chromium, type Worker } from "playwright";

const extensionPath = resolve(
	process.cwd(),
	process.env.MEMORALL_EXTENSION_PATH ?? "publish/extension/chromium",
);
const artifactMode = process.env.MEMORALL_EXTENSION_MODE ?? "build";
const chromiumExecutableCandidates = [
	process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
	process.env.LOCALAPPDATA
		? join(
				process.env.LOCALAPPDATA,
				"ms-playwright",
				"chromium-1223",
				"chrome-win64",
				"chrome.exe",
			)
		: undefined,
].filter((candidate): candidate is string => Boolean(candidate));
const chromiumExecutablePath = chromiumExecutableCandidates.find(existsSync);
let context: BrowserContext;
let profilePath: string;
let extensionOrigin: string;
let extensionServiceWorker: Worker;
let fixtureServer: Server;
let fixtureUrl: string;

type LocalRuntimeStatus = {
	success?: boolean;
	statuses?: Record<string, { registered?: boolean; ready?: boolean }>;
};

const LOCAL_MODEL_SMOKE_TARGETS = {
	transformer: {
		cardId: "onnx-community/granite-4.0-350m-ONNX-web",
		selectedId: "onnx-community/granite-4.0-350m-ONNX-web",
	},
	webllm: {
		cardId: "Qwen3.5-0.8B-q4f16_1-MLC",
		selectedId: "Qwen3.5-0.8B-q4f16_1-MLC",
	},
	wllama: {
		cardId: "prism-ml/Bonsai-1.7B-gguf",
		selectedId: "prism-ml/Bonsai-1.7B-gguf/Bonsai-1.7B-Q1_0.gguf",
	},
} as const;

type LocalModelSmokeRuntime = keyof typeof LOCAL_MODEL_SMOKE_TARGETS;

function getLocalModelSmokeTarget() {
	const runtime =
		(process.env.MEMORALL_LOCAL_MODEL_E2E_RUNTIME as
			| LocalModelSmokeRuntime
			| undefined) ?? "wllama";
	const target = LOCAL_MODEL_SMOKE_TARGETS[runtime];
	if (!target) {
		throw new Error(
			`Unsupported MEMORALL_LOCAL_MODEL_E2E_RUNTIME: ${String(runtime)}`,
		);
	}
	return { runtime, ...target };
}

async function getLocalRuntimeStatus(
	page: import("@playwright/test").Page,
): Promise<LocalRuntimeStatus> {
	return page.evaluate(async () =>
		chrome.runtime.sendMessage({ type: "GET_SERVICE_STATUS" }),
	);
}

test.beforeAll(async () => {
	if (!existsSync(extensionPath)) {
		throw new Error(
			"Extension build is missing. Run yarn build:extension before this test.",
		);
	}

	profilePath = mkdtempSync(join(tmpdir(), "memorall-extension-e2e-"));
	context = await chromium.launchPersistentContext(profilePath, {
		headless: false,
		args: [
			`--disable-extensions-except=${extensionPath}`,
			`--load-extension=${extensionPath}`,
			"--no-sandbox",
		],
		...(chromiumExecutablePath
			? { executablePath: chromiumExecutablePath }
			: {}),
	});

	extensionServiceWorker =
		context
			.serviceWorkers()
			.find((worker) => worker.url().startsWith("chrome-extension://")) ??
		(await context.waitForEvent("serviceworker", { timeout: 30_000 }));
	if (!extensionServiceWorker) {
		throw new Error("Memorall extension service worker did not register.");
	}
	const serviceWorkerUrl = new URL(extensionServiceWorker.url());
	extensionOrigin = `${serviceWorkerUrl.protocol}//${serviceWorkerUrl.host}`;

	fixtureServer = createServer((_request, response) => {
		response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		response.end(
			"<!doctype html><title>Memorall content fixture</title><main><h1>Captured knowledge</h1><p>Deterministic extension content-script fixture.</p></main>",
		);
	});
	await new Promise<void>((resolveListen, rejectListen) => {
		fixtureServer.once("error", rejectListen);
		fixtureServer.listen(0, "127.0.0.1", () => resolveListen());
	});
	const address = fixtureServer.address();
	if (!address || typeof address === "string") {
		throw new Error("Extension fixture server did not expose a TCP address.");
	}
	fixtureUrl = `http://127.0.0.1:${address.port}/fixture`;
});

test(`loads the unpacked ${artifactMode} Manifest V3 artifact`, async () => {
	const manifest = JSON.parse(
		readFileSync(join(extensionPath, "manifest.json"), "utf8"),
	) as { manifest_version?: number; name?: string };

	expect(manifest.manifest_version).toBe(3);
	expect(manifest.name).toMatch(/memorall/i);
	expect(extensionOrigin).toMatch(/^chrome-extension:\/\/[a-z]+$/);
});

test.afterAll(async () => {
	await context?.close();
	if (fixtureServer) {
		await new Promise<void>((resolveClose, rejectClose) => {
			fixtureServer.close((error) =>
				error ? rejectClose(error) : resolveClose(),
			);
		});
	}
	if (profilePath) {
		rmSync(profilePath, { recursive: true, force: true });
	}
});

test("content script injects and captures a deterministic page", async () => {
	const page = await context.newPage();
	await page.goto(fixtureUrl);
	await expect(
		page.getByRole("heading", { name: "Captured knowledge" }),
	).toBeVisible();

	await expect
		.poll(
			async () =>
				extensionServiceWorker.evaluate(async (url) => {
					const tabs = await chrome.tabs.query({});
					const tab = tabs.find((candidate) => candidate.url === url);
					if (!tab?.id) return null;
					return new Promise<unknown>((resolveMessage) => {
						chrome.tabs.sendMessage(
							tab.id as number,
							{ type: "web-tool:tab-capture" },
							(response) => {
								if (chrome.runtime.lastError) {
									resolveMessage(null);
									return;
								}
								resolveMessage(Boolean(response));
							},
						);
					});
				}, fixtureUrl),
			{ timeout: 30_000 },
		)
		.toBe(true);
	const response = await extensionServiceWorker.evaluate(async (url) => {
		const tabs = await chrome.tabs.query({});
		const tab = tabs.find((candidate) => candidate.url === url);
		if (!tab?.id) throw new Error("Fixture tab was not found.");
		return chrome.tabs.sendMessage(tab.id, { type: "web-tool:tab-capture" });
	}, fixtureUrl);
	expect(response).toMatchObject({
		success: true,
		url: fixtureUrl,
		title: "Memorall content fixture",
	});
	expect(response.text).toContain(
		"Deterministic extension content-script fixture",
	);
	await page.close();
});

test("background platform APIs, offscreen runtime, and extension storage work", async () => {
	const marker = `memorall-e2e-${Date.now()}`;
	const platformState = await extensionServiceWorker.evaluate(async (value) => {
		await chrome.storage.local.set({ memorallE2eMarker: value });
		const stored = await chrome.storage.local.get("memorallE2eMarker");
		const offscreenContexts = await chrome.runtime.getContexts({
			contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
		});
		await new Promise<void>((resolveUpdate, rejectUpdate) => {
			chrome.contextMenus.update("save-page", { title: "💾 Save page" }, () => {
				const message = chrome.runtime.lastError?.message;
				if (message) rejectUpdate(new Error(message));
				else resolveUpdate();
			});
		});
		const notificationId = await chrome.notifications.create(
			`memorall-e2e-${Date.now()}`,
			{
				type: "basic",
				iconUrl: chrome.runtime.getURL("docs/images/extension_48.png"),
				title: "Memorall E2E",
				message: "Dependency-upgrade platform smoke",
			},
		);
		const notificationCleared =
			await chrome.notifications.clear(notificationId);
		return {
			stored: stored.memorallE2eMarker,
			offscreenUrls: offscreenContexts.map((entry) => entry.documentUrl),
			notificationCleared,
		};
	}, marker);

	expect(platformState.stored).toBe(marker);
	expect(platformState.offscreenUrls).toContain(
		`${extensionOrigin}/offscreen.html`,
	);
	expect(platformState.notificationCleared).toBe(true);

	const page = await context.newPage();
	await page.goto(`${extensionOrigin}/options/index.html`);
	expect(
		await page.evaluate(
			async () =>
				(await chrome.storage.local.get("memorallE2eMarker")).memorallE2eMarker,
		),
	).toBe(marker);
	await page.reload();
	expect(
		await page.evaluate(
			async () =>
				(await chrome.storage.local.get("memorallE2eMarker")).memorallE2eMarker,
		),
	).toBe(marker);
	await page.close();
});

test("options application initializes without runtime errors", async () => {
	const page = await context.newPage();
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) =>
		pageErrors.push(error.stack ?? error.message),
	);
	page.on("console", (message) => {
		if (message.type() !== "error") return;
		const location = message.location();
		consoleErrors.push(
			`${message.text()} (${location.url}:${location.lineNumber}:${location.columnNumber})`,
		);
	});

	await page.goto(`${extensionOrigin}/options/index.html`);
	await expect(page.locator("#root")).toBeVisible();
	await expect
		.poll(
			async () => {
				if (pageErrors.length > 0) return `page: ${pageErrors.join(" | ")}`;
				if (consoleErrors.length > 0)
					return `console: ${consoleErrors.join(" | ")}`;
				return (await page.locator("#root").innerText()).trim()
					? "ready"
					: "waiting";
			},
			{ timeout: 30_000 },
		)
		.toBe("ready");
	await expect(
		page.getByText("Choose how you want to get started", { exact: true }),
	).toBeVisible();

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("LLM configuration view switches through every supported provider", async () => {
	const page = await context.newPage();
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) =>
		pageErrors.push(error.stack ?? error.message),
	);
	page.on("console", (message) => {
		if (message.type() !== "error") return;
		const location = message.location();
		consoleErrors.push(
			`${message.text()} (${location.url}:${location.lineNumber}:${location.columnNumber})`,
		);
	});
	await page.addInitScript(() => {
		localStorage.setItem("memorall-copilot-completed", "true");
	});

	await page.goto(`${extensionOrigin}/options/index.html`);
	await expect(page.locator("#root")).toBeVisible();
	await expect
		.poll(
			async () => {
				if (pageErrors.length > 0) return `page: ${pageErrors.join(" | ")}`;
				if (consoleErrors.length > 0)
					return `console: ${consoleErrors.join(" | ")}`;
				return (await page.locator("#root").innerText()).trim()
					? "ready"
					: "waiting";
			},
			{ timeout: 30_000 },
		)
		.toBe("ready");
	await expect(
		page.getByText("Choose how you want to get started", { exact: true }),
	).toBeVisible();

	await page.evaluate(() => {
		window.history.pushState({}, "", "/llm");
		window.dispatchEvent(new PopStateEvent("popstate"));
	});

	const providers = [
		{ id: "transformer", content: "Transformer advantages" },
		{ id: "wllama", content: "Wllama advantages" },
		{ id: "webllm", content: "WebLLM advantages" },
		{ id: "openai", content: "OpenAI API Key" },
		{ id: "openrouter", content: "OpenRouter API Key" },
		{ id: "lmstudio", content: "Local Endpoint" },
		{ id: "ollama", content: "Local Endpoint" },
	];

	for (const provider of providers) {
		const tab = page.locator(`[data-provider-tab="${provider.id}"]`);
		await expect(tab).toBeVisible();
		await tab.click();
		await expect(page.locator("main")).toContainText(provider.content, {
			timeout: 10_000,
		});
	}

	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);
});

test("selects a local model and completes a real chat request", async () => {
	test.skip(
		process.env.MEMORALL_LOCAL_MODEL_E2E !== "1",
		"Set MEMORALL_LOCAL_MODEL_E2E=1 to download and execute the real local model.",
	);
	test.setTimeout(15 * 60_000);
	const smokeTarget = getLocalModelSmokeTarget();

	const page = await context.newPage();
	const pageErrors: string[] = [];
	const consoleErrors: string[] = [];
	page.on("pageerror", (error) =>
		pageErrors.push(error.stack ?? error.message),
	);
	page.on("console", (message) => {
		if (message.type() !== "error") return;
		const location = message.location();
		consoleErrors.push(
			`${message.text()} (${location.url}:${location.lineNumber}:${location.columnNumber})`,
		);
	});
	await page.addInitScript(() => {
		localStorage.setItem("memorall-copilot-completed", "true");
	});

	await page.goto(`${extensionOrigin}/options/index.html`);
	await expect(page.locator("#root")).toBeVisible();
	await page.evaluate(() => {
		window.history.pushState({}, "", "/llm");
		window.dispatchEvent(new PopStateEvent("popstate"));
	});

	await page.locator(`[data-provider-tab="${smokeTarget.runtime}"]`).click();
	const quickModelCard = page.locator(
		`[data-model-provider="${smokeTarget.runtime}"][data-model-id="${smokeTarget.cardId}"]`,
	);
	const quickModelAvailable = await quickModelCard
		.waitFor({ state: "visible", timeout: 5_000 })
		.then(() => true)
		.catch(() => false);
	if (quickModelAvailable) {
		await quickModelCard.locator('[data-model-action="download"]').click();
	} else {
		await page.locator("[data-model-sidebar-toggle]").click();
		await page
			.locator(
				`[data-downloaded-model-provider="${smokeTarget.runtime}"][data-downloaded-model-id="${smokeTarget.selectedId}"] [data-downloaded-model-action="load"]`,
			)
			.click();
	}

	const currentModelCard = page.locator(
		`[data-llm-page][data-current-model-provider="${smokeTarget.runtime}"][data-current-model-id="${smokeTarget.selectedId}"]`,
	);
	await expect(currentModelCard).toBeAttached({ timeout: 12 * 60_000 });
	await expect
		.poll(
			async () =>
				(await getLocalRuntimeStatus(page)).statuses?.[smokeTarget.runtime],
			{
				timeout: 60_000,
				message: `${smokeTarget.runtime} must be registered and ready in the extension offscreen runtime`,
			},
		)
		.toEqual({ registered: true, ready: true });

	const useChatButton = page.locator("[data-agent-use-chat]");
	if (await useChatButton.isVisible()) {
		await useChatButton.click();
	}
	const newChatButton = page.locator("[data-new-chat]:visible").first();
	if (await newChatButton.isVisible()) {
		await newChatButton.click();
	}

	const prompt =
		"Reply with one short sentence confirming local inference works. Token: LOCAL_MODEL_E2E.";
	const composer = page.locator('[contenteditable="true"][role="textbox"]');
	// setCurrentModel is intentionally persisted before the large runner download
	// finishes. Wait for the chat-side load guard to clear so this test proves the
	// selected model is active in memory, not merely selected in storage.
	await expect(page.locator("[data-load-selected-model]")).toBeHidden({
		timeout: 12 * 60_000,
	});
	await expect(composer).toBeVisible({ timeout: 12 * 60_000 });
	const assistantMessages = page.locator(
		'[data-message-role="assistant"] [data-message-content]',
	);
	const assistantCount = await assistantMessages.count();
	await composer.fill(prompt);
	const submitButton = page.locator("[data-chat-submit]");
	await expect(submitButton).toBeEnabled();
	await submitButton.click();

	try {
		await expect
			.poll(() => assistantMessages.count(), {
				timeout: 3 * 60_000,
			})
			.toBeGreaterThan(assistantCount);
	} catch (error) {
		const diagnostics = {
			serviceStatus: await getLocalRuntimeStatus(page),
			currentModel: await currentModelCard.evaluate((element) => ({
				id: element.getAttribute("data-current-model-id"),
				provider: element.getAttribute("data-current-model-provider"),
			})),
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
			`Extension local-model chat diagnostics: ${JSON.stringify(diagnostics, null, 2)}`,
		);
		throw error;
	}
	const assistantMessage = assistantMessages.nth(assistantCount);
	await expect(assistantMessage).toBeVisible({ timeout: 3 * 60_000 });
	await expect
		.poll(async () => (await assistantMessage.innerText()).trim().length, {
			timeout: 3 * 60_000,
		})
		.toBeGreaterThan(0);
	const responseText = (await assistantMessage.innerText()).trim();
	expect(responseText).not.toMatch(/\b(?:error|failed)\b/iu);
	console.log(
		`Local ${smokeTarget.runtime} chat response (${responseText.length} chars): ${responseText.slice(0, 240)}`,
	);
	expect(pageErrors).toEqual([]);
	expect(consoleErrors).toEqual([]);

	await page.close();
});
