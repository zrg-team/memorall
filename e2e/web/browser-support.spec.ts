import { expect, test } from "@playwright/test";

const APP_READY = "Choose how you want to get started";

/**
 * Local inference needs browser features that are not universally available:
 * WebLLM needs a WebGPU adapter, Wllama needs the origin private file system.
 * When one is missing the runtime used to fail deep inside a worker ("No
 * supported storage backend found"), so these check that the app says which
 * browser feature is missing instead.
 *
 * The capabilities are removed in the page rather than relying on the runner's
 * hardware, so the result does not depend on whether CI has a GPU.
 */
async function open(
	page: import("@playwright/test").Page,
	strip: { webgpu?: boolean; opfs?: boolean },
) {
	await page.addInitScript(() => {
		try {
			window.localStorage.setItem("memorall-copilot-completed", "true");
		} catch {
			// Sandboxed frames have an opaque origin and no storage access.
		}
	});
	await page.addInitScript((remove) => {
		if (remove.webgpu) delete (Navigator.prototype as { gpu?: unknown }).gpu;
		if (remove.opfs) {
			Object.defineProperty(navigator.storage, "getDirectory", {
				value: undefined,
				configurable: true,
			});
		}
	}, strip);
	await page.goto("./");
	await expect(page.getByText(APP_READY, { exact: true })).toBeVisible({
		timeout: 90_000,
	});
}

test("offers local models when the browser can store and run them", async ({
	page,
}) => {
	test.setTimeout(180_000);
	// Leave OPFS in place: GGUF models run on the CPU, so they are still an
	// option on a machine with no usable GPU (CI included).
	await open(page, { webgpu: true });

	await expect(page.locator("[data-local-models-unsupported]")).toHaveCount(0);
	await expect(
		page.getByRole("button", { name: "Magic Setup" }).first(),
	).toBeEnabled();
});

test("says which browser feature is missing instead of failing later", async ({
	page,
}) => {
	test.setTimeout(180_000);
	await open(page, { webgpu: true, opfs: true });

	// First run: the local option is visibly unavailable, with the reason.
	await expect(page.locator("[data-local-models-unsupported]")).toHaveCount(1);
	await expect(
		page.getByText("This browser cannot run models on-device", {
			exact: false,
		}),
	).toBeVisible();
	await expect(
		page.getByRole("button", { name: "Magic Setup" }).first(),
	).toBeDisabled();

	// Models page: the providers that cannot run are inert and say why.
	await page.evaluate(() => {
		window.location.hash = "/llm";
	});
	const browse = page.locator('[data-panel-mode="browse"]');
	await expect(browse).toBeVisible({ timeout: 60_000 });
	await browse.click();

	const wllamaTab = page.locator('[data-provider-tab="wllama"]');
	const webllmTab = page.locator('[data-provider-tab="webllm"]');
	await expect(wllamaTab).toBeVisible({ timeout: 60_000 });
	await expect(wllamaTab).toBeDisabled();
	await expect(wllamaTab).toHaveAttribute("data-provider-unsupported", "opfs");
	await expect(webllmTab).toBeDisabled();
	await expect(webllmTab).toHaveAttribute(
		"data-provider-unsupported",
		"webgpu",
	);

	// Transformers.js falls back to WASM, so it stays usable.
	await expect(page.locator('[data-provider-tab="transformer"]')).toBeEnabled();
});
