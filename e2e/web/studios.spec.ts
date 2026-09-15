import { expect, type Page, test } from "@playwright/test";

/**
 * The main panel follows the kind of model in use: chat, or a studio for
 * speech, transcription, images, image tools and music. These run without
 * downloading any model - they check the workspaces and the models page
 * narrow to the right providers - so they stay fast enough for every CI run.
 */
async function openApp(page: Page, hash = "") {
	const pageErrors: string[] = [];
	page.on("pageerror", (error) =>
		pageErrors.push(error.stack ?? error.message),
	);
	await page.addInitScript(() => {
		try {
			window.localStorage.setItem("memorall-copilot-completed", "true");
		} catch {
			// Opaque-origin frames have no storage.
		}
	});
	await page.goto(`./${hash}`);
	await expect(page.locator("[data-workspace-mode-switcher]")).toBeVisible({
		timeout: 90_000,
	});
	return pageErrors;
}

test("switches the main panel between chat and the media studios", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const pageErrors = await openApp(page);

	await expect(page.locator('[data-main-workspace="chat"]')).toBeAttached();

	await page.locator('[data-workspace-mode="text-to-speech"]').click();
	const speech = page.locator('[data-studio-mode="text-to-speech"]');
	await expect(speech).toBeVisible();
	// No speech model chosen yet: the studio offers Hub search to add one.
	const empty = page.locator('[data-studio-empty="text-to-speech"]');
	await expect(empty).toBeVisible({ timeout: 60_000 });
	await expect(empty.locator("[data-hub-model-search]")).toBeVisible();

	for (const mode of [
		"speech-to-text",
		"image-generation",
		"image-tools",
		"text-to-audio",
	]) {
		await page.locator(`[data-workspace-mode="${mode}"]`).click();
		await expect(page.locator(`[data-studio-mode="${mode}"]`)).toBeVisible();
	}

	// The workspace survives a reload.
	await page.reload();
	await expect(page.locator('[data-studio-mode="text-to-audio"]')).toBeVisible({
		timeout: 90_000,
	});

	await page.locator('[data-workspace-mode="chat"]').click();
	await expect(page.locator('[data-main-workspace="chat"]')).toBeAttached();
	await expect(page.locator("[data-studio-mode]")).toHaveCount(0);

	expect(pageErrors).toEqual([]);
});

test("narrows the models page to providers that serve the chosen kind", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const pageErrors = await openApp(page, "#/llm?category=text-to-speech");

	await expect(page.locator("[data-llm-page]")).toHaveAttribute(
		"data-current-model-category",
		"text-to-speech",
		{ timeout: 90_000 },
	);
	await expect(
		page.locator('[data-model-category-chip="text-to-speech"]'),
	).toHaveAttribute("aria-checked", "true");

	const providerTabs = page.locator("[data-provider-tab]");
	await expect
		.poll(async () =>
			providerTabs.evaluateAll((tabs) =>
				tabs.map((tab) => tab.getAttribute("data-provider-tab")),
			),
		)
		.toEqual(["transformer-media", "openai"]);

	await page.locator('[data-provider-tab="transformer-media"]').click();
	await expect(
		page.locator(
			'[data-media-models-tab="transformer-media"] [data-hub-model-search]',
		),
	).toBeVisible();

	await page.locator('[data-model-category-chip="image-tools"]').click();
	await expect
		.poll(async () =>
			providerTabs.evaluateAll((tabs) =>
				tabs.map((tab) => tab.getAttribute("data-provider-tab")),
			),
		)
		.toEqual(["transformer-media"]);

	await page.locator('[data-model-category-chip="chat"]').click();
	await expect
		.poll(async () =>
			providerTabs.evaluateAll((tabs) =>
				tabs.map((tab) => tab.getAttribute("data-provider-tab")),
			),
		)
		.toEqual([
			"transformer",
			"wllama",
			"webllm",
			"openai",
			"openrouter",
			"lmstudio",
			"ollama",
		]);

	expect(pageErrors).toEqual([]);
});
