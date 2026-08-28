import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
	copyFile,
	cp,
	mkdir,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { defineConfig } from "vite";

const basePath = "/memorall/studio/";
const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const landingDirectory = fileURLToPath(
	new URL("../../runner", import.meta.url),
);
const iconDirectory = fileURLToPath(
	new URL("../../runner/images", import.meta.url),
);
// The PWA icon set the manifest and index.html point at, shared with the
// landing page so a single source image drives every surface.
const iconFiles = [
	"favicon.ico",
	"favicon-16x16.png",
	"favicon-32x32.png",
	"apple-touch-icon.png",
	"android-chrome-192x192.png",
	"android-chrome-512x512.png",
];

const deploymentDirectory = fileURLToPath(
	new URL("../../publish/web", import.meta.url),
);
const outputDirectory = fileURLToPath(
	new URL("../../publish/web/studio", import.meta.url),
);

/**
 * Builds the deployed service worker from apps/web/public/sw.js by filling in
 * the precache list and a build id derived from it. The id changes whenever the
 * bundle does, which is what makes the browser treat a deploy as a new worker
 * and lets the app offer "reload to update".
 */
/**
 * The runner iframes are boot-critical — the app imports them while starting up
 * — but they load lazily, so whether they had reached the cache before the
 * network went away was a race. Precache them so being offline is not luck.
 *
 * `libs/` is left out on purpose: it is 33MB of model runtimes that are only
 * needed once a local model is actually used, and it caches on demand.
 */
async function collectRunnerAssets(): Promise<string[]> {
	const root = `${outputDirectory}/runner`;
	const collected: string[] = [];
	const walk = async (relative: string): Promise<void> => {
		const directory = relative ? `${root}/${relative}` : root;
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			const next = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				if (next === "libs") continue;
				await walk(next);
				continue;
			}
			collected.push(`runner/${next}`);
		}
	};
	await walk("");
	return collected.sort();
}

async function writeServiceWorker(): Promise<void> {
	const shell = await readFile(`${outputDirectory}/index.html`, "utf8");
	const referenced = new Set<string>();
	const assetReference = new RegExp(`(?:src|href)="${basePath}([^"]+)"`, "g");
	for (const match of shell.matchAll(assetReference)) {
		referenced.add(match[1]);
	}
	const precache = [
		"index.html",
		"manifest.webmanifest",
		...iconFiles.map((file) => `icons/${file}`),
		...[...referenced].sort(),
		...(await collectRunnerAssets()),
	];
	const template = await readFile(
		fileURLToPath(new URL("./public/sw.js", import.meta.url)),
		"utf8",
	);
	// Names under assets/ already carry a content hash, but index.html and the
	// manifest do not, so their bytes go into the id as well. Without that, a
	// deploy that only edits the shell would not look like a new version.
	//
	// The worker's own source counts too: the id names its cache, so a change to
	// how the worker caches has to start from a clean one. Otherwise an entry
	// stored under the old rules survives the very update meant to correct it.
	const fingerprint = createHash("sha256")
		.update(precache.join("\n"))
		.update(template);
	for (const path of precache) {
		if (path.startsWith("assets/")) continue;
		fingerprint.update(await readFile(`${outputDirectory}/${path}`));
	}
	const buildId = fingerprint.digest("hex").slice(0, 16);
	const source = template
		.replace("__MEMORALL_BUILD_ID__", buildId)
		.replace("__MEMORALL_PRECACHE__", JSON.stringify(precache, null, "\t"));
	if (source.includes("__MEMORALL_")) {
		throw new Error("Service worker template placeholders were not replaced");
	}
	await writeFile(`${outputDirectory}/sw.js`, source, "utf8");
}

export default defineConfig({
	root: fileURLToPath(new URL(".", import.meta.url)),
	base: basePath,
	// Reuse the extension's packaged local model, runner, sandbox, and viewer assets.
	publicDir: fileURLToPath(new URL("../../public", import.meta.url)),
	plugins: [
		{
			name: "memorall-web-shell-assets",
			async buildStart() {
				await rm(deploymentDirectory, { recursive: true, force: true });
			},
			// The shell's icons and web manifest live outside `publicDir`, which is
			// shared with the extension build, so the dev server serves them here to
			// match what the deployed layout looks like.
			configureServer(server) {
				server.middlewares.use((request, response, next) => {
					const path = (request.url ?? "").split("?")[0];
					const iconPrefix = `${basePath}icons/`;
					if (!path.startsWith(iconPrefix)) return next();
					const file = path.slice(iconPrefix.length);
					if (!iconFiles.includes(file)) return next();
					readFile(`${iconDirectory}/${file}`).then(
						(body) => {
							response.setHeader(
								"Content-Type",
								file.endsWith(".ico") ? "image/x-icon" : "image/png",
							);
							response.end(body);
						},
						() => next(),
					);
				});
			},
			async closeBundle() {
				await mkdir(deploymentDirectory, { recursive: true });
				await mkdir(outputDirectory, { recursive: true });
				await mkdir(`${outputDirectory}/icons`, { recursive: true });
				for (const entry of await readdir(landingDirectory)) {
					await cp(
						`${landingDirectory}/${entry}`,
						`${deploymentDirectory}/${entry}`,
						{ recursive: true },
					);
				}
				await mkdir(`${deploymentDirectory}/privacy`, { recursive: true });
				await Promise.all([
					...iconFiles.map((file) =>
						copyFile(
							`${iconDirectory}/${file}`,
							`${outputDirectory}/icons/${file}`,
						),
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
				// Last, so the precache list it derives can see every emitted file.
				await writeServiceWorker();
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
