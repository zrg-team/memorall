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
	// Landing page and web-app PWA icons. apps/web/vite.config.ts copies this
	// directory into publish/web and points the studio manifest at the same
	// files, so both surfaces follow the extension artwork from here.
	{ path: "runner/images/favicon-16x16.png", width: 16, height: 16 },
	{ path: "runner/images/favicon-32x32.png", width: 32, height: 32 },
	{ path: "runner/images/apple-touch-icon.png", width: 180, height: 180 },
	{ path: "runner/images/android-chrome-192x192.png", width: 192, height: 192 },
	{ path: "runner/images/android-chrome-512x512.png", width: 512, height: 512 },
	{ path: "runner/images/origin.png", width: 320, fit: "aspect" },
];

// sharp cannot write .ico, so the legacy favicon is packed here. Modern
// browsers read the PNG <link> tags above it; this is the bookmark-bar and
// old-browser fallback.
const FAVICON_ICO = { path: "runner/images/favicon.ico", sizes: [16, 32, 48] };

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

/**
 * Packs square PNGs into a classic ICO. Each frame is a 32bpp bottom-up BMP:
 * a BITMAPINFOHEADER whose height is doubled to cover the XOR pixels plus the
 * AND mask, the BGRA rows, then the 1bpp mask with rows padded to 4 bytes.
 * Alpha carries the real transparency, but the mask still has to be there or
 * older parsers reject the frame.
 */
const encodeIco = async (sharp, buffer, sizes) => {
	const frames = [];
	for (const size of sizes) {
		const { data } = await sharp(buffer)
			.resize(size, size, {
				fit: "contain",
				background: { r: 0, g: 0, b: 0, alpha: 0 },
			})
			.raw()
			.toBuffer({ resolveWithObject: true });

		const header = Buffer.alloc(40);
		header.writeUInt32LE(40, 0);
		header.writeInt32LE(size, 4);
		header.writeInt32LE(size * 2, 8);
		header.writeUInt16LE(1, 12);
		header.writeUInt16LE(32, 14);

		const xor = Buffer.alloc(size * size * 4);
		const maskStride = Math.ceil(size / 32) * 4;
		const mask = Buffer.alloc(maskStride * size);
		for (let y = 0; y < size; y++) {
			// BMP rows run bottom-up, so the last source row is written first.
			const sourceRow = (size - 1 - y) * size;
			for (let x = 0; x < size; x++) {
				const from = (sourceRow + x) * 4;
				const to = (y * size + x) * 4;
				xor[to] = data[from + 2];
				xor[to + 1] = data[from + 1];
				xor[to + 2] = data[from];
				xor[to + 3] = data[from + 3];
				if (data[from + 3] === 0) {
					mask[y * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
				}
			}
		}

		header.writeUInt32LE(xor.length + mask.length, 20);
		frames.push({ size, body: Buffer.concat([header, xor, mask]) });
	}

	const directory = Buffer.alloc(6 + frames.length * 16);
	directory.writeUInt16LE(0, 0);
	directory.writeUInt16LE(1, 2);
	directory.writeUInt16LE(frames.length, 4);
	let offset = directory.length;
	frames.forEach((frame, index) => {
		const entry = 6 + index * 16;
		// 256px is stored as 0 in a single byte; every size here is smaller.
		directory[entry] = frame.size === 256 ? 0 : frame.size;
		directory[entry + 1] = frame.size === 256 ? 0 : frame.size;
		directory.writeUInt16LE(1, entry + 4);
		directory.writeUInt16LE(32, entry + 6);
		directory.writeUInt32LE(frame.body.length, entry + 8);
		directory.writeUInt32LE(offset, entry + 12);
		offset += frame.body.length;
	});

	return Buffer.concat([directory, ...frames.map((frame) => frame.body)]);
};

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

	const icoTarget = resolve(ROOT, FAVICON_ICO.path);
	mkdirSync(dirname(icoTarget), { recursive: true });
	const ico = await encodeIco(sharp, buffer, FAVICON_ICO.sizes);
	writeFileSync(icoTarget, ico);
	console.log(`  ${FAVICON_ICO.path} (${FAVICON_ICO.sizes.join(", ")})`);

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
