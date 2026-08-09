import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./e2e/sandbox",
	fullyParallel: false,
	workers: 1,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	reporter: [["list"], ["html", { outputFolder: "playwright-report/sandbox", open: "never" }]],
	outputDir: "test-results/sandbox",
	use: {
		trace: "retain-on-failure",
		screenshot: "only-on-failure",
		video: "retain-on-failure",
	},
	projects: [
		{
			name: "deterministic",
			grepInvert: /@network/,
		},
		{
			name: "network",
			grep: /@network/,
		},
	],
});
