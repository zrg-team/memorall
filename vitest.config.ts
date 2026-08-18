import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));
const alias = {
	"@": fileURLToPath(new URL("./src", import.meta.url)),
	"flow-memory": fileURLToPath(
		new URL("./src/services/flows-memory", import.meta.url),
	),
	"flow-features": fileURLToPath(
		new URL("./src/services/flows-features", import.meta.url),
	),
	"flow-integrations": fileURLToPath(
		new URL("./src/services/flows-integrations", import.meta.url),
	),
};

export default defineConfig({
	test: {
		coverage: {
			provider: "v8",
			reporter: ["text-summary", "html"],
			all: true,
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/**/*.test.*",
				"src/**/__tests__/**",
				"src/test/**",
				"src/**/__snapshots__/**",
				"src/**/*.d.ts",
			],
		} as any,
		projects: [
			{
				extends: true,
				test: {
					name: "node",
					environment: "node",
					hookTimeout: 30_000,
					setupFiles: ["src/test/setup-node.ts"],
					include: [
						"src/utils/**/*.test.ts",
						"src/services/__tests__/**/*.test.ts",
						"src/services/flows-features/**/*.test.ts",
						"src/services/flows-integrations/**/*.test.ts",
						"src/services/flows-memory/**/*.test.ts",
						"src/services/agent-sandbox/**/*.test.ts",
						"src/services/agent-harness/**/*.test.ts",
						"src/services/background-jobs/**/*.test.ts",
						"src/**/*.logic.test.ts",
					],
				},
			},
			{
				extends: true,
				test: {
					name: "jsdom",
					environment: "jsdom",
					include: [
						"src/main/**/*.test.tsx",
						"src/components/**/*.test.tsx",
						"src/services/**/*.dom.test.ts",
					],
					exclude: [
						"src/main/__tests__/component-smoke.test.tsx",
						"src/main/__tests__/requested-modules-import.test.tsx",
					],
					setupFiles: ["src/test/setup.ts"],
					globals: true,
				},
			},
			{
				extends: true,
				test: {
					name: "jsdom-import-smoke",
					environment: "jsdom",
					include: [
						"src/main/__tests__/component-smoke.test.tsx",
						"src/main/__tests__/requested-modules-import.test.tsx",
					],
					setupFiles: ["src/test/setup.ts"],
					globals: true,
					fileParallelism: false,
					maxWorkers: 1,
					testTimeout: 120_000,
				},
			},
		],
	},
	resolve: {
		alias,
	},
	root,
});
