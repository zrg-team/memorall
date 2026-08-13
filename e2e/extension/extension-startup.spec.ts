import { expect, test } from "@playwright/test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, type BrowserContext } from "playwright";

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

	const serviceWorker =
		context
			.serviceWorkers()
			.find((worker) => worker.url().startsWith("chrome-extension://")) ??
		(await context.waitForEvent("serviceworker", { timeout: 30_000 }));
	if (!serviceWorker) {
		throw new Error("Memorall extension service worker did not register.");
	}
	const serviceWorkerUrl = new URL(serviceWorker.url());
	extensionOrigin = `${serviceWorkerUrl.protocol}//${serviceWorkerUrl.host}`;
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
	await expect(
		page.getByText("Choose how you want to get started", { exact: true }),
	).toBeVisible();

	expect(pageErrors).toEqual([]);
});

test("LLM configuration view switches through every supported provider", async () => {
	const page = await context.newPage();
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	await page.addInitScript(() => {
		localStorage.setItem("memorall-copilot-completed", "true");
	});

	await page.goto(`${extensionOrigin}/options/index.html`);
	await expect(page.locator("#root")).toBeVisible();
	await expect(
		page.getByText("Choose how you want to get started", { exact: true }),
	).toBeVisible();

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
		const tab = page.getByRole("button", { name: provider.tab, exact: true });
		await expect(tab).toBeVisible();
		await tab.click();
		await expect(page.locator("main")).toContainText(provider.content, {
			timeout: 10_000,
		});
	}

	expect(pageErrors).toEqual([]);
});
