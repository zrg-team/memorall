import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/services/flows-core/**/*.test.ts"],
	},
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
			"flow-core": fileURLToPath(
				new URL("./src/services/flows-core", import.meta.url),
			),
		},
	},
	root,
});
