import path from "node:path";
import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";

interface WorkerFixtures {
	extensionContext: BrowserContext;
	extensionId: string;
	offscreenReady: boolean;
}

interface TestFixtures {
	extensionPage: Page;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
	extensionContext: [
		async ({}, use) => {
			const extensionPath = path.resolve(process.cwd(), "dist/chromium");
			const context = await chromium.launchPersistentContext("", {
				channel: process.env.PLAYWRIGHT_CHANNEL ?? "chromium",
				headless: true,
				args: [
					`--disable-extensions-except=${extensionPath}`,
					`--load-extension=${extensionPath}`,
				],
			});
			await use(context);
			await context.close();
		},
		{ scope: "worker" },
	],
	extensionId: [
		async ({ extensionContext }, use) => {
			let [worker] = extensionContext.serviceWorkers();
			worker ??= await extensionContext.waitForEvent("serviceworker");
			await use(new URL(worker.url()).host);
		},
		{ scope: "worker" },
	],
	offscreenReady: [
		async ({ extensionContext, extensionId }, use) => {
			const page = await extensionContext.newPage();
			await page.goto(`chrome-extension://${extensionId}/options/index.html`);
			await page.evaluate(
				() =>
					new Promise<void>((resolve, reject) => {
						const timer = window.setTimeout(() => {
							chrome.runtime.onMessage.removeListener(listener);
							reject(new Error("Offscreen services did not become ready"));
						}, 150_000);
						const listener = (message: unknown) => {
							if (
								typeof message !== "object" ||
								message === null ||
								(message as { type?: string }).type !== "OFFSCREEN_READY"
							) {
								return;
							}
							window.clearTimeout(timer);
							chrome.runtime.onMessage.removeListener(listener);
							resolve();
						};
						chrome.runtime.onMessage.addListener(listener);
						void chrome.runtime.sendMessage({ type: "POPUP_OPENED" });
					}),
			);
			await page.close();
			await use(true);
		},
		{ scope: "worker", timeout: 180_000 },
	],
	extensionPage: async ({ extensionContext, extensionId, offscreenReady }, use, testInfo) => {
		if (!offscreenReady) throw new Error("Offscreen services are unavailable");
		const logs: string[] = [];
		const onWorker = (worker: { on: (event: "console", listener: (message: { text: () => string }) => void) => void }) => {
			worker.on("console", (message) => logs.push(`[worker] ${message.text()}`));
		};
		for (const worker of extensionContext.serviceWorkers()) onWorker(worker);
		extensionContext.on("serviceworker", onWorker);

		const page = await extensionContext.newPage();
		page.on("console", (message) => logs.push(`[page:${message.type()}] ${message.text()}`));
		page.on("pageerror", (error) => logs.push(`[page:error] ${error.message}`));
		await page.goto(`chrome-extension://${extensionId}/options/index.html`);
		await use(page);

		await testInfo.attach("sandbox-console.log", {
			body: Buffer.from(logs.join("\n"), "utf8"),
			contentType: "text/plain",
		});
		await page.close();
	},
});

export { expect } from "@playwright/test";
