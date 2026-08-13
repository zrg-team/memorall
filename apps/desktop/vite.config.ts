import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	base: "./",
	// Reuse the same packaged local assets as extension and web builds.
	publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
	resolve: {
		alias: [
			{
				find: /^@\/services\/database\/bridges\/current-proxy-transport$/,
				replacement: fileURLToPath(
					new URL(
						"../../src/services/database/bridges/unavailable-proxy-transport.ts",
						import.meta.url,
					),
				),
			},
			{
				find: /^@\/services\/filesystem\/change-bus\/current$/,
				replacement: fileURLToPath(
					new URL(
						"../../src/services/filesystem/change-bus/broadcast-channel.ts",
						import.meta.url,
					),
				),
			},
			{
				find: /^@\/services\/database\/bridges\/current-rpc-server$/,
				replacement: fileURLToPath(
					new URL(
						"../../src/services/database/bridges/noop-rpc-server.ts",
						import.meta.url,
					),
				),
			},
			{
				find: /^@\/services\/background-jobs\/bridges\/current-runtime$/,
				replacement: fileURLToPath(
					new URL(
						"../../src/services/background-jobs/bridges/local-runtime.ts",
						import.meta.url,
					),
				),
			},
			{
				find: /^@\/services\/shared-storage\/change-bus\/current$/,
				replacement: fileURLToPath(
					new URL(
						"../../src/services/shared-storage/change-bus/broadcast-channel.ts",
						import.meta.url,
					),
				),
			},
			{
				find: /^@\/platform\/current$/,
				replacement: fileURLToPath(
					new URL("../../src/platform/desktop/index.ts", import.meta.url),
				),
			},
			{
				find: "@",
				replacement: fileURLToPath(new URL("../../src", import.meta.url)),
			},
		],
	},
	server: {
		port: 1420,
		strictPort: true,
		fs: { allow: [repositoryRoot] },
	},
	optimizeDeps: { exclude: ["@electric-sql/pglite"] },
	worker: { format: "es" },
	build: {
		outDir: fileURLToPath(new URL("../../dist/desktop", import.meta.url)),
		emptyOutDir: true,
	},
});
