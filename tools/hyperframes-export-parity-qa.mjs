#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";

const WIDTH = 1080;
const HEIGHT = 1920;
const DURATION = 4;
const FPS = 30;
const TIMESTAMPS = [0, 3, DURATION / 2, DURATION - 1 / FPS];
const MAX_MEAN_DIFF = 10;
const MAX_OUTLIER_RATIO = 0.08;

const CONTENT_TYPES = new Map([
	[".html", "text/html; charset=utf-8"],
	[".js", "text/javascript; charset=utf-8"],
	[".mjs", "text/javascript; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".wasm", "application/wasm"],
]);

function resolveServedPath(baseDirectory, relativePath) {
	const resolvedBase = path.resolve(baseDirectory);
	const resolvedPath = path.resolve(resolvedBase, relativePath);
	if (
		resolvedPath !== resolvedBase &&
		!resolvedPath.startsWith(`${resolvedBase}${path.sep}`)
	) {
		return undefined;
	}
	return resolvedPath;
}

async function startQaServer(runnerPath) {
	const runnerDirectory = path.dirname(runnerPath);
	const publicDirectory = path.join(process.cwd(), "public");
	const server = createServer(async (request, response) => {
		try {
			const pathname = decodeURIComponent(
				new URL(request.url || "/", "http://127.0.0.1").pathname,
			);
			const fromRunner = pathname.startsWith("/runner/");
			const relativePath = fromRunner
				? pathname.slice("/runner/".length)
				: pathname.replace(/^\/+/, "");
			const servedPath = resolveServedPath(
				fromRunner ? runnerDirectory : publicDirectory,
				relativePath,
			);
			if (!servedPath) {
				response.writeHead(403).end("Forbidden");
				return;
			}

			const body = await readFile(servedPath);
			response.writeHead(200, {
				"Content-Type":
					CONTENT_TYPES.get(path.extname(servedPath)) ||
					"application/octet-stream",
			});
			response.end(body);
		} catch (error) {
			const status = error?.code === "ENOENT" ? 404 : 500;
			response
				.writeHead(status)
				.end(status === 404 ? "Not found" : "Server error");
		}
	});

	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address();
	if (!address || typeof address === "string") {
		throw new Error("HyperFrames QA server did not expose a TCP address.");
	}

	return {
		origin: `http://127.0.0.1:${address.port}`,
		close: () =>
			new Promise((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			}),
	};
}

function loadPlaywright() {
	const require = createRequire(import.meta.url);
	const candidates = ["playwright"];
	const userHome = process.env.USERPROFILE || process.env.HOME;
	if (userHome) {
		candidates.push(
			path.join(
				userHome,
				".codex",
				"skills",
				"run-memorall",
				".pw-cache",
				"node_modules",
				"playwright",
			),
		);
	}

	for (const candidate of candidates) {
		try {
			return require(candidate);
		} catch {
			// Try the next known local Playwright install.
		}
	}

	throw new Error(
		"Playwright is required. Install it in this repo or run through the Codex run-memorall Playwright cache.",
	);
}

function parseArgs() {
	const args = new Map();
	for (let i = 2; i < process.argv.length; i += 1) {
		const arg = process.argv[i];
		if (!arg.startsWith("--")) continue;
		const next = process.argv[i + 1];
		if (next && !next.startsWith("--")) {
			args.set(arg, next);
			i += 1;
		} else {
			args.set(arg, true);
		}
	}
	return args;
}

function makeFixtureImageUrl() {
	const svg = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="sky" x1="0" x2="1" y1="0" y2="1">
      <stop stop-color="#050506" offset="0"/>
      <stop stop-color="#12050a" offset=".42"/>
      <stop stop-color="#2d0506" offset="1"/>
    </linearGradient>
    <radialGradient id="burst" cx=".54" cy=".31" r=".28">
      <stop stop-color="#fff0b0" offset="0"/>
      <stop stop-color="#e83a18" offset=".18"/>
      <stop stop-color="#6b120d" offset=".45"/>
      <stop stop-color="#000" stop-opacity="0" offset="1"/>
    </radialGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#sky)"/>
  <rect x="0" y="1190" width="1080" height="730" fill="#050101"/>
  <circle cx="585" cy="585" r="430" fill="url(#burst)"/>
  <g stroke-linecap="round" stroke-width="7" opacity=".88">
    <path d="M560 710 C510 835 488 965 476 1115" stroke="#f8b36b"/>
    <path d="M605 710 C650 830 694 945 760 1102" stroke="#c82718"/>
    <path d="M520 690 C400 790 314 895 238 1040" stroke="#ff3e24"/>
    <path d="M640 675 C790 790 882 930 940 1080" stroke="#e45c23"/>
  </g>
  <g fill="#fff0bd">
    <circle cx="530" cy="560" r="14"/>
    <circle cx="610" cy="620" r="10"/>
    <circle cx="690" cy="520" r="8"/>
    <circle cx="485" cy="650" r="11"/>
    <circle cx="730" cy="690" r="6"/>
  </g>
  <path d="M86 1275 C310 1168 740 1176 1010 1264 L1010 1370 C690 1300 350 1310 86 1395 Z" fill="#6f0505"/>
  <path d="M120 1320 C430 1230 760 1240 1018 1342" fill="none" stroke="#f0281b" stroke-width="28"/>
  <g fill="#e11310" opacity=".76">
    <rect x="74" y="1390" width="18" height="420" rx="9" transform="rotate(-8 74 1390)"/>
    <rect x="215" y="1380" width="20" height="430" rx="10" transform="rotate(13 215 1380)"/>
    <rect x="362" y="1376" width="17" height="438" rx="9" transform="rotate(-4 362 1376)"/>
    <rect x="525" y="1370" width="19" height="450" rx="9" transform="rotate(7 525 1370)"/>
    <rect x="720" y="1386" width="21" height="430" rx="10" transform="rotate(-11 720 1386)"/>
    <rect x="900" y="1395" width="19" height="420" rx="9" transform="rotate(8 900 1395)"/>
  </g>
  <g fill="#120202" opacity=".78">
    <circle cx="120" cy="1600" r="64"/>
    <circle cx="270" cy="1620" r="78"/>
    <circle cx="465" cy="1608" r="70"/>
    <circle cx="665" cy="1618" r="82"/>
    <circle cx="850" cy="1598" r="74"/>
  </g>
</svg>`;
	return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function makeFixtureHtml() {
	const imageUrl = makeFixtureImageUrl();
	return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    html, body { margin: 0; width: 100%; height: 100%; background: #000; font-family: Inter, Arial, sans-serif; }
    .scene { position: relative; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; background: #000; color: white; }
    .cover { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; filter: saturate(1.14) contrast(1.08); }
    .veil { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.7) 0%, rgba(0,0,0,.12) 42%, rgba(0,0,0,.4) 100%); }
    .content { position: absolute; left: 96px; top: 150px; right: 96px; }
    .eyebrow { width: 780px; border: 1px solid rgba(255,255,255,.23); border-radius: 999px; padding: 12px 22px; color: rgba(255,255,255,.7); font-size: 26px; letter-spacing: .18em; background: rgba(0,0,0,.24); backdrop-filter: blur(12px); }
    h1 { margin: 84px 0 26px; font-size: 72px; line-height: .98; letter-spacing: 0; max-width: 840px; }
    p { margin: 0 0 28px; max-width: 650px; color: rgba(255,255,255,.78); font-size: 32px; line-height: 1.45; }
    .pills { display: flex; gap: 18px; flex-wrap: wrap; }
    .pill { display: inline-flex; align-items: center; gap: 12px; padding: 14px 22px; border-radius: 999px; border: 1px solid rgba(255,255,255,.16); background: rgba(16,14,28,.45); box-shadow: 0 12px 34px rgba(0,0,0,.35); backdrop-filter: blur(16px); color: rgba(255,255,255,.78); font-size: 22px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; background: #ff2e74; box-shadow: 0 0 18px #ff2e74; }
    .bottom { position: absolute; left: 96px; right: 96px; bottom: 112px; display: flex; gap: 18px; flex-wrap: wrap; }
    .badge { padding: 12px 18px; border-radius: 999px; border: 1px solid rgba(255,255,255,.18); background: rgba(25,20,45,.62); box-shadow: 0 12px 30px rgba(0,0,0,.42); backdrop-filter: blur(18px); color: rgba(255,255,255,.82); font-size: 22px; }
    .badge strong { color: #fff; font-weight: 800; }
  </style>
</head>
<body>
  <div class="scene" data-composition-id="main" data-width="${WIDTH}" data-height="${HEIGHT}" data-duration="${DURATION}">
    <img class="cover" src="${imageUrl}" alt="" />
    <div class="veil"></div>
    <main class="content">
      <div class="eyebrow">EXPORT PARITY FIXTURE</div>
      <h1>Sharp badges, covered images, native export.</h1>
      <p>Portrait composition with object-cover media, glass pills, borders, shadows, and bottom safe-area badges.</p>
      <div class="pills">
        <span class="pill"><span class="dot"></span>Full-bleed object-cover</span>
        <span class="pill"><span class="dot"></span>Rounded glass badge</span>
        <span class="pill"><span class="dot"></span>Soft shadow border</span>
      </div>
    </main>
    <footer class="bottom">
      <span class="badge"><strong>2 seasons</strong> aired</span>
      <span class="badge"><strong>5 nights</strong> live stage</span>
      <span class="badge">Bottom safe area</span>
    </footer>
  </div>
</body>
</html>`;
}

const inlineScripts = [
	`
window.__timelines = {
  main: {
    duration: () => ${DURATION},
    pause: () => {},
    totalTime: (time) => {
      document.documentElement.style.setProperty("--qa-time", String(time));
    }
  }
};
`,
];

async function waitForRunnerReady(page, key) {
	await page.waitForFunction(
		(expectedKey) =>
			window.__hyperframesMessages?.some(
				(msg) =>
					msg?.type === "memorall:hyperframes-composition-ready" &&
					msg?.key === expectedKey,
			),
		key,
		{ timeout: 15000 },
	);
}

async function renderFixture(page, key) {
	await page.evaluate(
		({ compositionKey, html, scripts }) => {
			window.postMessage(
				{
					type: "memorall:hyperframes-composition",
					key: compositionKey,
					html,
					inlineScripts: scripts,
					filenameBase: "hyperframes-export-parity-qa",
				},
				"*",
			);
		},
		{
			compositionKey: key,
			html: makeFixtureHtml(),
			scripts: inlineScripts,
		},
	);

	await page.waitForFunction(
		() =>
			Boolean(document.querySelector("[data-composition-id='main']")) &&
			Boolean(window.__timelines?.main),
		undefined,
		{ timeout: 15000 },
	);
	await page.evaluate(() =>
		document.fonts?.ready?.then?.(() => undefined).catch?.(() => undefined),
	);
}

async function seekAndScreenshot(page, timestamp) {
	await page.evaluate((time) => {
		window.__timelines.main.totalTime(time);
		return new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(resolve)),
		);
	}, timestamp);
	return page.screenshot({
		type: "png",
		clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
	});
}

async function exportMp4(page, key) {
	return page.evaluate(
		(compositionKey) =>
			new Promise((resolve, reject) => {
				const timeoutId = setTimeout(
					() => reject(new Error("Timed out waiting for MP4 export")),
					120000,
				);
				const onMessage = async (event) => {
					const msg = event.data;
					if (
						msg?.type !== "memorall:hyperframes-export-status" ||
						msg?.key !== compositionKey
					) {
						return;
					}

					if (msg.status === "failed") {
						clearTimeout(timeoutId);
						window.removeEventListener("message", onMessage);
						reject(new Error(msg.error || "MP4 export failed"));
						return;
					}

					if (msg.status === "complete") {
						clearTimeout(timeoutId);
						window.removeEventListener("message", onMessage);
						const bytes = Array.from(
							new Uint8Array(await msg.blob.arrayBuffer()),
						);
						resolve({ bytes, filename: msg.filename });
					}
				};

				window.addEventListener("message", onMessage);
				window.postMessage(
					{
						type: "memorall:hyperframes-export-mp4",
						key: compositionKey,
						filenameBase: "hyperframes-export-parity-qa",
					},
					"*",
				);
			}),
		key,
	);
}

async function compareFrames(page, mp4Bytes, references) {
	return page.evaluate(
		async ({ videoBytes, referenceFrames, width, height }) => {
			function waitFor(target, eventName) {
				return new Promise((resolve, reject) => {
					const onEvent = () => {
						cleanup();
						resolve();
					};
					const onError = () => {
						cleanup();
						reject(new Error(`Video ${eventName} failed`));
					};
					const cleanup = () => {
						target.removeEventListener(eventName, onEvent);
						target.removeEventListener("error", onError);
					};
					target.addEventListener(eventName, onEvent, { once: true });
					target.addEventListener("error", onError, { once: true });
				});
			}

			async function seekVideo(video, timestamp) {
				if (
					Math.abs(video.currentTime - timestamp) < 0.001 &&
					video.readyState >= 2
				) {
					return;
				}
				const seeked = waitFor(video, "seeked");
				video.currentTime = timestamp;
				await seeked;
			}

			async function imageDataFromPng(bytes) {
				const bitmap = await createImageBitmap(
					new Blob([new Uint8Array(bytes)], { type: "image/png" }),
				);
				const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
				const ctx = canvas.getContext("2d");
				ctx.drawImage(bitmap, 0, 0);
				return {
					width: bitmap.width,
					height: bitmap.height,
					data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data,
				};
			}

			const video = document.createElement("video");
			video.muted = true;
			video.playsInline = true;
			video.preload = "auto";
			video.src = URL.createObjectURL(
				new Blob([new Uint8Array(videoBytes)], { type: "video/mp4" }),
			);
			document.body.appendChild(video);
			await waitFor(video, "loadedmetadata");

			if (video.videoWidth !== width || video.videoHeight !== height) {
				throw new Error(
					`MP4 dimensions ${video.videoWidth}x${video.videoHeight}; expected ${width}x${height}`,
				);
			}

			const videoCanvas = new OffscreenCanvas(width, height);
			const videoCtx = videoCanvas.getContext("2d", {
				willReadFrequently: true,
			});
			const results = [];

			for (const reference of referenceFrames) {
				const ref = await imageDataFromPng(reference.pngBytes);

				await seekVideo(
					video,
					Math.min(reference.timestamp, video.duration || reference.timestamp),
				);
				videoCtx.drawImage(video, 0, 0, width, height);
				const actual = videoCtx.getImageData(0, 0, width, height).data;

				let totalDiff = 0;
				let outliers = 0;
				let nonBlack = 0;
				const pixels = width * height;
				for (let i = 0; i < actual.length; i += 4) {
					const dr = Math.abs(actual[i] - ref.data[i]);
					const dg = Math.abs(actual[i + 1] - ref.data[i + 1]);
					const db = Math.abs(actual[i + 2] - ref.data[i + 2]);
					const pixelDiff = (dr + dg + db) / 3;
					totalDiff += dr + dg + db;
					if (pixelDiff > 36) outliers += 1;
					if (actual[i] + actual[i + 1] + actual[i + 2] > 24) nonBlack += 1;
				}

				results.push({
					timestamp: reference.timestamp,
					width: ref.width,
					height: ref.height,
					meanDiff: totalDiff / (pixels * 3),
					outlierRatio: outliers / pixels,
					nonBlackRatio: nonBlack / pixels,
				});
			}

			URL.revokeObjectURL(video.src);
			video.remove();
			return results;
		},
		{
			videoBytes: mp4Bytes,
			referenceFrames: references,
			width: WIDTH,
			height: HEIGHT,
		},
	);
}

async function main() {
	const args = parseArgs();
	const { chromium } = loadPlaywright();
	const key = `qa-${Date.now()}`;
	const runnerPath =
		args.get("--runner") ||
		path.join(process.cwd(), "runner", "hyperframes-preview.html");
	const qaServer = await startQaServer(runnerPath);
	const runnerUrl = `${qaServer.origin}/runner/${encodeURIComponent(path.basename(runnerPath))}#composition=${encodeURIComponent(key)}`;

	let browser;
	try {
		browser = await chromium.launch({ headless: true });
		const page = await browser.newPage({
			viewport: { width: WIDTH, height: HEIGHT },
			deviceScaleFactor: 1,
		});
		page.on("console", (message) => {
			if (message.type() === "error") console.error(message.text());
		});
		await page.addInitScript(() => {
			window.__hyperframesMessages = [];
			window.addEventListener("message", (event) => {
				window.__hyperframesMessages.push(event.data);
			});
		});

		await page.goto(runnerUrl, { waitUntil: "domcontentloaded" });
		await waitForRunnerReady(page, key);
		await renderFixture(page, key);

		const references = [];
		for (const timestamp of TIMESTAMPS) {
			references.push({
				timestamp,
				pngBytes: Array.from(await seekAndScreenshot(page, timestamp)),
			});
		}

		const exportResult = await exportMp4(page, key);
		if (args.get("--out")) {
			await writeFile(args.get("--out"), Buffer.from(exportResult.bytes));
		}

		const comparisons = await compareFrames(
			page,
			exportResult.bytes,
			references,
		);
		const failures = comparisons.filter(
			(result) =>
				result.width !== WIDTH ||
				result.height !== HEIGHT ||
				result.nonBlackRatio < 0.03 ||
				result.meanDiff > MAX_MEAN_DIFF ||
				result.outlierRatio > MAX_OUTLIER_RATIO,
		);

		console.table(
			comparisons.map((result) => ({
				timestamp: result.timestamp.toFixed(3),
				meanDiff: result.meanDiff.toFixed(2),
				outlierRatio: result.outlierRatio.toFixed(4),
				nonBlackRatio: result.nonBlackRatio.toFixed(4),
			})),
		);

		if (failures.length > 0) {
			throw new Error(
				`HyperFrames export parity failed at ${failures
					.map((result) => `${result.timestamp.toFixed(3)}s`)
					.join(", ")}`,
			);
		}

		console.log(`Export parity passed: ${exportResult.filename}`);
	} finally {
		await browser?.close();
		await qaServer.close();
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
