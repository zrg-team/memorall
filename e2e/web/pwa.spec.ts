import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const serviceWorkerPath = fileURLToPath(
	new URL("../../publish/web/studio/sw.js", import.meta.url),
);
const APP_READY = "Choose how you want to get started";

async function bootApplication(page: import("@playwright/test").Page) {
	// The copilot overlay covers the panel and would swallow clicks.
	await page.addInitScript(() => {
		try {
			window.localStorage.setItem("memorall-copilot-completed", "true");
		} catch {
			// Sandboxed frames have an opaque origin and no storage access.
		}
	});
	await page.goto("./");
	await expect(page.getByText(APP_READY, { exact: true })).toBeVisible({
		timeout: 90_000,
	});
	await page.evaluate(() => navigator.serviceWorker.ready);
	// The worker caches what boot loaded on a short debounce; wait for the
	// database chunk, which is imported after it takes control.
	await expect
		.poll(
			() =>
				page.evaluate(async () => {
					const key = (await caches.keys()).find((name) =>
						name.startsWith("memorall-studio-"),
					);
					if (!key) return 0;
					const entries = await (await caches.open(key)).keys();
					return entries.filter((request) =>
						request.url.includes("/assets/database-service-"),
					).length;
				}),
			{ timeout: 60_000 },
		)
		.toBeGreaterThan(0);
}

test("installs a PWA manifest with resolvable icons", async ({ request }) => {
	const response = await request.get("./manifest.webmanifest");
	expect(response.status()).toBe(200);
	const manifest = await response.json();
	expect(manifest.start_url).toBe("./#/");
	expect(manifest.display).toBe("standalone");
	const sizes = manifest.icons.map(
		(icon: { sizes: string }) => icon.sizes,
	) as string[];
	// Chromium requires both of these before it will offer installation.
	expect(sizes).toContain("192x192");
	expect(sizes).toContain("512x512");
	for (const icon of manifest.icons as { src: string }[]) {
		const iconResponse = await request.get(
			`/memorall/studio/${icon.src.replace(/^\.\//, "")}`,
		);
		expect(iconResponse.status(), `${icon.src} should be deployed`).toBe(200);
	}
});

test("serves the whole app from cache with the network switched off", async ({
	page,
	context,
}) => {
	test.setTimeout(240_000);
	await bootApplication(page);

	await context.setOffline(true);
	const pageErrors: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));

	await page.reload();
	await expect(page.getByText(APP_READY, { exact: true })).toBeVisible({
		timeout: 120_000,
	});

	// Hash routes are served by the same cached shell.
	await page.goto("./#/files");
	await expect(page.locator("#root")).toBeVisible();
	await expect.poll(() => page.locator("#root").innerText()).not.toBe("");

	// Calls to remote services are expected to fail with no network; what must
	// not happen is a chunk of the app itself failing to load.
	expect(
		pageErrors.filter((message) =>
			message.includes("dynamically imported module"),
		),
	).toEqual([]);
});

test("announces a new build in the right panel and reloads into it", async ({
	page,
}) => {
	test.setTimeout(240_000);
	const deployed = await readFile(serviceWorkerPath, "utf8");
	const buildId = deployed.match(/const BUILD_ID = "([^"]+)"/)?.[1];
	expect(buildId).toBeTruthy();
	const nextBuildId = "e2e0000000000001";

	await bootApplication(page);
	const railNotice = page.locator("[data-app-update-rail]");
	const reloadAction = page.locator("[data-app-update-action='reload']");
	await expect(railNotice).toBeHidden();
	await expect(reloadAction).toBeHidden();

	try {
		await writeFile(
			serviceWorkerPath,
			deployed.replace(`"${buildId}"`, `"${nextBuildId}"`),
			"utf8",
		);
		await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.getRegistration(
				new URL("./", window.location.href).href,
			);
			await registration?.update();
		});

		// The right panel starts collapsed, so the rail carries the notice first.
		await expect(railNotice).toHaveAttribute("data-app-update-rail", "ready", {
			timeout: 60_000,
		});
		await page.getByLabel("Expand workspace panel").click();
		await expect(reloadAction).toBeVisible({ timeout: 30_000 });
		await expect(reloadAction).toContainText("New version ready");

		await reloadAction.click();
		await expect
			.poll(
				() => page.evaluate(() => caches.keys()).catch(() => [] as string[]),
				{ timeout: 60_000 },
			)
			.toContain(`memorall-studio-${nextBuildId}`);
		await expect(page.getByText(APP_READY, { exact: true })).toBeVisible({
			timeout: 120_000,
		});
		await expect(reloadAction).toBeHidden();
		await expect(railNotice).toBeHidden();
	} finally {
		await writeFile(serviceWorkerPath, deployed, "utf8");
	}
});
