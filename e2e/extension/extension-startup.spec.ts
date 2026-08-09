import { expect, test } from "@playwright/test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext } from "playwright";

const extensionPath = resolve(process.cwd(), "dist/chromium");
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

test.beforeAll(async () => {
	if (!existsSync(extensionPath)) {
		throw new Error("Extension build is missing. Run yarn build before this test.");
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

	await new Promise((resolve) => setTimeout(resolve, 3_000));
	const serviceWorker = context
		.serviceWorkers()
		.find((worker) => worker.url().startsWith("chrome-extension://"));
	if (!serviceWorker) {
		throw new Error("Memorall extension service worker did not register.");
	}
	const serviceWorkerUrl = new URL(serviceWorker.url());
	extensionOrigin = `${serviceWorkerUrl.protocol}//${serviceWorkerUrl.host}`;
});

test.afterAll(async () => {
	await context?.close();
	if (profilePath) {
		rmSync(profilePath, { recursive: true, force: true });
	}
});

test("options application initializes without runtime errors", async () => {
	const page = await context.newPage();
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await page.goto(`${extensionOrigin}/options/index.html`);
	await expect(page.locator("#root")).toBeVisible();
	await expect
		.poll(async () => page.locator("body").innerText())
		.not.toContain("Initializing Memorall");

	expect(pageErrors).toEqual([]);
});

test("LLM configuration view switches through every supported provider", async () => {
	const page = await context.newPage();
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await page.goto(`${extensionOrigin}/options/index.html`);
	await expect(page.locator("#root")).toBeVisible();
	await expect
		.poll(async () => page.locator("body").innerText())
		.not.toContain("Initializing Memorall");

	await page.evaluate(() => {
		window.history.pushState({}, "", "/llm");
		window.dispatchEvent(new PopStateEvent("popstate"));
	});

	const providers = [
		{ tab: "Transformer (WebGPU)", content: "Transformer advantages" },
		{ tab: "Wllama (GGUF)", content: "Wllama advantages" },
		{ tab: "WebLLM (MLC)", content: "WebLLM advantages" },
		{ tab: "OpenAI", content: "OpenAI API Key" },
		{ tab: "OpenRouter", content: "OpenRouter API Key" },
		{ tab: "LM Studio", content: "Local Endpoint" },
		{ tab: "Ollama", content: "Local Endpoint" },
	];

	for (const provider of providers) {
		const skipTour = page.getByRole("button", {
			name: "Skip Tour",
			exact: true,
		});
		if (await skipTour.isVisible()) {
			await skipTour.click();
		}

		const tab = page.getByRole("button", { name: provider.tab, exact: true });
		await expect(tab).toBeVisible();
		try {
			await tab.click({ timeout: 3_000 });
		} catch {
			await expect(skipTour).toBeVisible({ timeout: 3_000 });
			await skipTour.click();
			await tab.click({ timeout: 3_000 });
		}
		await expect(page.locator("main")).toContainText(provider.content, {
			timeout: 10_000,
		});
	}

	expect(pageErrors).toEqual([]);
});
