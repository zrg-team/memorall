#!/usr/bin/env node
/**
 * Regenerates every icon asset in the repo from a single source image.
 *
 *   node tools/generate-icons.mjs <source.png>
 *   node tools/generate-icons.mjs <source.png> --skip-desktop
 *
 * The source should be a transparent PNG at 1024px or larger on its longest
 * edge. Every output below is derived from that one file, so the artwork stays
 * identical across the browser extension, the web build, and the desktop app.
 *
 * Desktop icons (.ico/.icns/Square*) are produced by the Tauri CLI, which is
 * already a devDependency. Everything else goes through sharp.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Square outputs are padded with transparency so the artwork is never
 * distorted. Non-square outputs keep the source aspect ratio and match the
 * dimensions the repo already shipped, so no layout shifts.
 */
const OUTPUTS = [
	// Browser extension toolbar + notification icons. manifest.base.json maps
	// one file per size instead of scaling a single 48px asset down to 16px.
	{ path: "docs/images/extension_16.png", width: 16, height: 16 },
	{ path: "docs/images/extension_32.png", width: 32, height: 32 },
	{ path: "docs/images/extension_48.png", width: 48, height: 48 },
	{ path: "docs/images/extension_128.png", width: 128, height: 128 },
	// README header and square social/preview thumbnail.
	{ path: "docs/images/origin.png", width: 320, fit: "aspect" },
	{ path: "docs/images/origin-square.png", width: 128, height: 128 },
	// Shared runtime logo: extension UI, web build, desktop splash.
	{ path: "public/logo.png", width: 512, fit: "aspect" },
	// Square artwork for the Chrome Web Store / Edge Add-ons listings. Kept out
	// of docs/images so the extension package does not ship them.
	{ path: "docs/store/store_128.png", width: 128, height: 128 },
	{ path: "docs/store/store_256.png", width: 256, height: 256 },
	{ path: "docs/store/store_512.png", width: 512, height: 512 },
];

const DESKTOP_ICON_DIR = "apps/desktop/src-tauri/icons";
const DESKTOP_SOURCE_SIZE = 1024;
// `tauri icon` always emits mobile icon sets. This app ships desktop only, so
// drop them instead of committing assets nothing loads.
const DESKTOP_UNUSED_DIRS = ["android", "ios"];

const loadSharp = async () => {
	try {
		return (await import("sharp")).default;
	} catch {
		throw new Error(
			"sharp is required to generate icons. Run `yarn install`, or install it " +
				"on demand with `npm exec --yes sharp-cli@5 -- --version` first.",
		);
	}
};

const toSquare = (sharp, buffer, size) =>
	sharp(buffer)
		.resize(size, size, {
			fit: "contain",
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png({ compressionLevel: 9 })
		.toBuffer();

const toAspect = (sharp, buffer, width) =>
	sharp(buffer)
		.resize(width, null, { fit: "inside", withoutEnlargement: false })
		.png({ compressionLevel: 9 })
		.toBuffer();

const generateDesktopIcons = (sharp, buffer) => {
	const stagingDir = resolve(ROOT, "node_modules/.cache/memorall-icons");
	const stagedSource = resolve(stagingDir, "icon-source.png");
	mkdirSync(stagingDir, { recursive: true });

	return toSquare(sharp, buffer, DESKTOP_SOURCE_SIZE)
		.then((square) => {
			writeFileSync(stagedSource, square);
			// `tauri icon` writes icon.ico, icon.icns, icon.png, the Square*Logo
			// set, and the 32/64/128/128@2x PNGs in one pass. Call the CLI entry
			// with node directly: spawning the .cmd shim fails with EINVAL on
			// Windows since Node 20.
			execFileSync(
				process.execPath,
				[
					resolve(ROOT, "node_modules/@tauri-apps/cli/tauri.js"),
					"icon",
					stagedSource,
					"--output",
					DESKTOP_ICON_DIR,
				],
				{ cwd: ROOT, stdio: "inherit" },
			);
			for (const unused of DESKTOP_UNUSED_DIRS) {
				rmSync(resolve(ROOT, DESKTOP_ICON_DIR, unused), {
					recursive: true,
					force: true,
				});
			}
			console.log(`  ${DESKTOP_ICON_DIR}/* (via tauri icon)`);
		})
		.finally(() => {
			rmSync(stagingDir, { recursive: true, force: true });
		});
};

const main = async () => {
	const args = process.argv.slice(2);
	const skipDesktop = args.includes("--skip-desktop");
	const sourceArg = args.find((arg) => !arg.startsWith("--"));

	if (!sourceArg) {
		console.error(
			"Usage: node tools/generate-icons.mjs <source.png> [--skip-desktop]",
		);
		process.exit(1);
	}

	const sharp = await loadSharp();
	const sourcePath = resolve(process.cwd(), sourceArg);
	const source = sharp(sourcePath);
	const { width = 0, height = 0 } = await source.metadata();

	if (Math.max(width, height) < DESKTOP_SOURCE_SIZE) {
		console.warn(
			`WARNING: source is ${width}x${height}. Desktop icons need ${DESKTOP_SOURCE_SIZE}px ` +
				"on the longest edge; smaller sources will be upscaled and look soft.",
		);
	}

	const buffer = await source.png().toBuffer();
	console.log(`Source: ${sourcePath} (${width}x${height})`);

	for (const output of OUTPUTS) {
		const target = resolve(ROOT, output.path);
		mkdirSync(dirname(target), { recursive: true });
		const rendered =
			output.fit === "aspect"
				? await toAspect(sharp, buffer, output.width)
				: await toSquare(sharp, buffer, output.width);
		writeFileSync(target, rendered);
		const meta = await sharp(rendered).metadata();
		console.log(`  ${output.path} (${meta.width}x${meta.height})`);
	}

	if (skipDesktop) {
		console.log(`  ${DESKTOP_ICON_DIR}/* skipped (--skip-desktop)`);
	} else {
		await generateDesktopIcons(sharp, buffer);
	}

	console.log("Done.");
};

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
