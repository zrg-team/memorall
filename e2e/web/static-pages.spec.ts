import { expect, test } from "@playwright/test";

const applicationPath = "/memorall/studio/";

test("serves the production app and every first-party asset below the Pages path", async ({
	page,
	request,
}) => {
	const failedRequests: string[] = [];
	const failedResponses: string[] = [];
	const pageErrors: string[] = [];
	const localImportErrors: string[] = [];
	page.on("requestfailed", (failed) => {
		if (
			new URL(failed.url()).origin === "http://127.0.0.1:4173" &&
			failed.failure()?.errorText !== "net::ERR_ABORTED"
		) {
			failedRequests.push(
				`${failed.method()} ${failed.url()} (${failed.failure()?.errorText})`,
			);
		}
	});
	page.on("response", (response) => {
		if (
			new URL(response.url()).origin === "http://127.0.0.1:4173" &&
			response.status() >= 400
		) {
			failedResponses.push(`${response.status()} ${response.url()}`);
		}
	});
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("console", (message) => {
		if (
			message.type() === "error" &&
			message.text().includes("Failed to fetch dynamically imported module") &&
			message.text().includes("http://127.0.0.1:4173")
		) {
			localImportErrors.push(message.text());
		}
	});

	const response = await page.goto("./");
	expect(response?.status()).toBe(200);
	await expect(page.locator("#root")).toBeVisible();
	await expect.poll(() => page.locator("#root").innerText()).not.toBe("");
	expect(new URL(page.url()).pathname).toBe(applicationPath);

	const manifest = await request.get(`${applicationPath}manifest.webmanifest`);
	expect(manifest.status()).toBe(200);
	expect((await manifest.json()).start_url).toBe("./#/");
	const embeddingRunner = await request.get(
		`${applicationPath}runner/modes/embedding-runner.js`,
	);
	expect(embeddingRunner.status()).toBe(200);
	expect(await embeddingRunner.text()).toContain(
		'"../../vendors/transformers/",',
	);
	expect(await embeddingRunner.text()).toContain("import.meta.url");
	const projectRoot = await request.get("/memorall/");
	expect(projectRoot.status()).toBe(200);
	expect(await projectRoot.text()).toContain(
		"The browser is your agent's full workspace.",
	);
	const landingStyles = await request.get("/memorall/css/index.css");
	expect(landingStyles.status()).toBe(200);
	const privacyPolicy = await request.get("/memorall/privacy_policy.html");
	expect(privacyPolicy.status()).toBe(200);
	expect(await privacyPolicy.text()).toContain("Memorall - Privacy Policy");
	const privacyAlias = await request.get("/memorall/privacy/");
	expect(privacyAlias.status()).toBe(200);
	expect(await privacyAlias.text()).toContain("../privacy_policy.html");

	const scope = await page.evaluate(async () => {
		const registration = await navigator.serviceWorker.ready;
		return registration.scope;
	});
	expect(new URL(scope).pathname).toBe(applicationPath);
	await expect(
		page.getByText("Choose how you want to get started", { exact: true }),
	).toBeVisible({ timeout: 90_000 });
	expect(failedRequests).toEqual([]);
	expect(failedResponses).toEqual([]);
	expect(pageErrors).toEqual([]);
	expect(localImportErrors).toEqual([]);
});

test("reloads a hash route from a simple static server", async ({ page }) => {
	await page.goto("./#/files");
	await expect(page.locator("#root")).toBeVisible();
	await expect.poll(() => page.locator("#root").innerText()).not.toBe("");
	await page.reload();
	await expect(page.locator("#root")).toBeVisible();
	await expect.poll(() => page.locator("#root").innerText()).not.toBe("");
	expect(new URL(page.url()).pathname).toBe(applicationPath);
	expect(new URL(page.url()).hash).toBe("#/files");
});
