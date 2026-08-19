import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const bootScriptPath = fileURLToPath(new URL("./boot.js", import.meta.url));

/**
 * Ship `boot.js` verbatim next to `index.html`.
 *
 * It is referenced as a classic `<script src>` rather than a module entry on
 * purpose: Vite folds every module entry of a page into a single chunk, and the
 * whole point of the boot script is to run *before* the app bundle is fetched.
 * Serving it by hand keeps that guarantee in dev and in the packaged build.
 */
function desktopBootScript(): Plugin {
	const readBootScript = () => readFileSync(bootScriptPath, "utf8");

	return {
		name: "memorall:desktop-boot-script",
		configureServer(server) {
			server.watcher.add(bootScriptPath);
			server.middlewares.use((request, response, next) => {
				if (request.url?.split("?")[0] !== "/boot.js") {
					next();
					return;
				}
				response.setHeader("Content-Type", "text/javascript; charset=utf-8");
				response.setHeader("Cache-Control", "no-cache");
				response.end(readBootScript());
			});
		},
		generateBundle() {
			this.emitFile({
				type: "asset",
				fileName: "boot.js",
				source: readBootScript(),
			});
		},
	};
}

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	base: "./",
	plugins: [desktopBootScript()],
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
		outDir: fileURLToPath(
			new URL("../../publish/desktop/frontend", import.meta.url),
		),
		emptyOutDir: true,
	},
});
