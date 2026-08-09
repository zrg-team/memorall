import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e/extension",
	fullyParallel: false,
	workers: 1,
	timeout: 120_000,
	expect: { timeout: 90_000 },
	reporter: "list",
	use: {
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
	},
});
