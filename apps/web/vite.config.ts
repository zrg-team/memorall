import { fileURLToPath } from "node:url";
import { copyFile, cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { defineConfig } from "vite";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const landingDirectory = fileURLToPath(
	new URL("../../runner", import.meta.url),
);
const deploymentDirectory = fileURLToPath(
	new URL("../../publish/web", import.meta.url),
);
const outputDirectory = fileURLToPath(
	new URL("../../publish/web/studio", import.meta.url),
);

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	base: "/memorall/studio/",
	// Reuse the extension's packaged local model, runner, sandbox, and viewer assets.
	publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
	plugins: [
		{
			name: "memorall-web-shell-assets",
			async buildStart() {
				await rm(deploymentDirectory, { recursive: true, force: true });
			},
			async closeBundle() {
				await mkdir(deploymentDirectory, { recursive: true });
				await mkdir(outputDirectory, { recursive: true });
				for (const entry of await readdir(landingDirectory)) {
					await cp(
						`${landingDirectory}/${entry}`,
						`${deploymentDirectory}/${entry}`,
						{ recursive: true },
					);
				}
				await mkdir(`${deploymentDirectory}/privacy`, { recursive: true });
				await Promise.all([
					copyFile(
						fileURLToPath(new URL("./public/sw.js", import.meta.url)),
						`${outputDirectory}/sw.js`,
					),
					copyFile(
						fileURLToPath(
							new URL("./public/manifest.webmanifest", import.meta.url),
						),
						`${outputDirectory}/manifest.webmanifest`,
					),
					writeFile(`${deploymentDirectory}/.nojekyll`, "", "utf8"),
					writeFile(
						`${deploymentDirectory}/privacy/index.html`,
						'<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=../privacy_policy.html"><title>Memorall Privacy Policy</title><a href="../privacy_policy.html">Open Memorall Privacy Policy</a>\n',
						"utf8",
					),
				]);
			},
		},
	],
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
					new URL("../../src/platform/web/index.ts", import.meta.url),
				),
			},
			{
				find: "@",
				replacement: fileURLToPath(new URL("../../src", import.meta.url)),
			},
		],
	},
	server: {
		fs: { allow: [repositoryRoot] },
	},
	optimizeDeps: {
		exclude: ["@electric-sql/pglite"],
	},
	worker: { format: "es" },
	build: {
		outDir: outputDirectory,
		emptyOutDir: true,
	},
});
