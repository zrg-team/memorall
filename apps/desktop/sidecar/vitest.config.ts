import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const sidecarRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
	root: sidecarRoot,
	test: {
		environment: "node",
		include: ["src/**/*.test.ts"],
	},
});
