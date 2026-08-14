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
	const sandboxRuntime = await request.get(
		`${applicationPath}sandbox/runtime/shared.js`,
	);
	expect(sandboxRuntime.status()).toBe(200);
	const sandboxRuntimeSource = await sandboxRuntime.text();
	expect(sandboxRuntimeSource).toContain("new URL(self.location.href)");
	expect(sandboxRuntimeSource).toContain(
		'const sandboxRootMarker = "/sandbox/";',
	);
	expect(sandboxRuntimeSource).not.toContain(
		"normalizedPath}`,import.meta.url",
	);
	expect(sandboxRuntimeSource).not.toContain("new URL(`/sandbox/");
	const almostnodeRuntime = await request.get(
		`${applicationPath}sandbox/vendors/almostnode.bundle.js`,
	);
	expect(almostnodeRuntime.status()).toBe(200);
	const almostnodeSource = await almostnodeRuntime.text();
	for (const localRuntime of [
		"./react.mjs",
		"./react-dom.mjs",
		"./react-jsx-runtime.mjs",
		"./react-refresh-runtime.mjs",
		"./rollup-browser.mjs",
		"./esbuild.wasm",
		"./remote-modules-disabled.mjs#",
	]) {
		expect(almostnodeSource).toContain(localRuntime);
	}
	expect(almostnodeSource).not.toContain('"/sandbox/vendors/');
	expect(almostnodeSource).not.toContain('"/vendors/artifacts/');
	expect(almostnodeSource).not.toContain("https://esm.sh/");
	expect(almostnodeSource).not.toContain("https://unpkg.com/");
	expect(almostnodeSource).not.toContain("process.env.NODE_DEBUG");
	const sandboxBundle = await request.get(
		`${applicationPath}sandbox/vendors/react.mjs`,
	);
	expect(sandboxBundle.status()).toBe(200);
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

test("loads every shared route without runtime failures", async ({ page }) => {
	test.setTimeout(240_000);
	const pageErrors: string[] = [];
	const failedLocalResponses: string[] = [];
	page.on("pageerror", (error) => pageErrors.push(error.message));
	page.on("response", (response) => {
		if (
			new URL(response.url()).origin === "http://127.0.0.1:4173" &&
			response.status() >= 400
		) {
			failedLocalResponses.push(`${response.status()} ${response.url()}`);
		}
	});

	await page.goto("./");
	await expect(
		page.getByText("Choose how you want to get started", { exact: true }),
	).toBeVisible({ timeout: 90_000 });

	const routes = [
		"/auth",
		"/files",
		"/llm",
		"/runtime",
		"/embeddings",
		"/database",
		"/memory",
		"/agents",
		"/activities",
		"/flow-builder",
		"/logs",
	];
	for (const route of routes) {
		const previousContent = await page.locator("#root").innerText();
		await page.evaluate((nextRoute) => {
			window.location.hash = nextRoute;
		}, route);
		await expect.poll(() => new URL(page.url()).hash).toBe(`#${route}`);
		await expect
			.poll(() => page.locator("#root").innerText(), { timeout: 30_000 })
			.not.toBe(previousContent);
		await expect(page.locator("#root")).toBeVisible();
		await expect(page.locator("#root")).not.toContainText(
			"This page could not be loaded.",
		);
		await expect(page.locator("#root")).not.toContainText(
			"The application was updated and this page needs to reload.",
		);
	}

	await page.evaluate(() => {
		window.location.hash = "/knowledge-graph";
	});
	await expect.poll(() => new URL(page.url()).hash).toBe("#/memory");

	expect(failedLocalResponses).toEqual([]);
	expect(pageErrors).toEqual([]);
});

test("selects a local CPU model and completes a real Web chat request", async ({
	page,
}) => {
	test.skip(
		process.env.MEMORALL_LOCAL_MODEL_E2E !== "1",
		"Set MEMORALL_LOCAL_MODEL_E2E=1 to download and execute the real local model.",
	);
	test.setTimeout(15 * 60_000);

	const pageErrors: string[] = [];
	page.on("pageerror", (error) =>
		pageErrors.push(error.stack ?? error.message),
	);
	await page.addInitScript(() => {
		localStorage.setItem("memorall-copilot-completed", "true");
	});
	await page.goto("./#/llm");
	await expect(page.locator("[data-llm-page]")).toBeAttached({
		timeout: 90_000,
	});

	await page
		.getByRole("button", { name: "Wllama (GGUF)", exact: true })
		.click();
	const modelCard = page.locator(
		'[data-model-provider="wllama"][data-model-id="LiquidAI/LFM2-VL-450M-GGUF"]',
	);
	await expect(modelCard).toBeVisible();
	await modelCard.getByRole("button", { name: "Download Model" }).click();
	await expect(
		page.locator(
			'[data-llm-page][data-current-model-provider="wllama"][data-current-model-id="LiquidAI/LFM2-VL-450M-GGUF/LFM2-VL-450M-Q4_0.gguf"]',
		),
	).toBeAttached({ timeout: 12 * 60_000 });

	const useChatButton = page.getByRole("button", {
		name: "Use Chat",
		exact: true,
	});
	if (await useChatButton.isVisible()) await useChatButton.click();

	const composer = page.locator('[contenteditable="true"][role="textbox"]');
	await expect(composer).toBeVisible({ timeout: 60_000 });
	const completedAssistantMessages = page.locator(
		'[data-message-role="assistant"][data-message-state="complete"] [data-message-content]',
	);
	const completedAssistantCount = await completedAssistantMessages.count();
	await composer.fill(
		"Reply with one short sentence confirming local inference works. Token: LOCAL_MODEL_E2E.",
	);
	await composer.press("Enter");

	await expect(page.locator('[data-message-role="user"]').last()).toContainText(
		"LOCAL_MODEL_E2E",
		{ timeout: 60_000 },
	);
	await expect
		.poll(() => completedAssistantMessages.count(), {
			timeout: 3 * 60_000,
		})
		.toBeGreaterThan(completedAssistantCount);
	const responseText = (
		await completedAssistantMessages.nth(completedAssistantCount).innerText()
	).trim();
	expect(responseText.length).toBeGreaterThan(0);
	expect(responseText).not.toMatch(/\b(?:error|failed)\b/iu);
	expect(pageErrors).toEqual([]);
	console.log(
		`Web local Wllama chat response (${responseText.length} chars): ${responseText.slice(0, 240)}`,
	);
});
