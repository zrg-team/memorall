import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e/web",
	fullyParallel: false,
	workers: 1,
	timeout: 120_000,
	expect: { timeout: 60_000 },
	reporter: "list",
	use: {
		baseURL: "http://127.0.0.1:4173/memorall/studio/",
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
	webServer: {
		command: "node tools/serve-static-web.mjs --port 4173",
		url: "http://127.0.0.1:4173/memorall/studio/",
		reuseExistingServer: false,
		timeout: 30_000,
	},
});
