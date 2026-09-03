/*
 * Renders promo.html to an MP4, one deterministic frame at a time.
 *
 *   node docs/store/unikorn/video/render.cjs                 # full render
 *   node docs/store/unikorn/video/render.cjs --preview 2,8,13 # PNG stills at those seconds
 *   node docs/store/unikorn/video/render.cjs --no-music
 *
 * Needs Playwright's Chromium (already in the repo) and an ffmpeg with libx264
 * and aac: either on PATH or pointed at by FFMPEG=/path/to/ffmpeg.
 * `npm i ffmpeg-static` anywhere and set FFMPEG to the printed path works too.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { chromium } = require("playwright");

const HERE = __dirname;
const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
	const index = args.indexOf(name);
	return index >= 0 ? args[index + 1] : undefined;
};

const ffmpeg = () => {
	if (process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)) return process.env.FFMPEG;
	const probe = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
	if (probe.status === 0) return "ffmpeg";
	throw new Error("ffmpeg not found: install it or set FFMPEG=/path/to/ffmpeg");
};

async function openComposition() {
	const browser = await chromium.launch({ args: ["--force-device-scale-factor=1"] });
	const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
	await page.goto(`file://${path.join(HERE, "promo.html").replace(/\\/g, "/")}`);
	// Fonts come from Google Fonts; without network the system fallback is used.
	await page.evaluate(() => Promise.race([window.__ready, new Promise((r) => setTimeout(r, 8000))]));
	const duration = await page.evaluate(() => window.__duration);
	return { browser, page, duration };
}

async function preview(seconds) {
	const { browser, page } = await openComposition();
	const outDir = path.join(HERE, "preview");
	fs.mkdirSync(outDir, { recursive: true });
	for (const s of seconds) {
		await page.evaluate((ms) => window.__seek(ms), s * 1000);
		const file = path.join(outDir, `t${String(s).replace(".", "_")}.png`);
		await page.screenshot({ path: file, type: "png" });
		console.log("wrote", file);
	}
	await browser.close();
}

async function render() {
	const withMusic = !flag("--no-music");
	const music = path.join(HERE, "music.wav");
	if (withMusic && !fs.existsSync(music)) {
		console.log("generating music.wav");
		spawnSync(process.execPath, [path.join(HERE, "music.cjs")], { stdio: "inherit" });
	}
	const out = option("--out") ?? path.join(HERE, withMusic ? "memorall-promo.mp4" : "memorall-promo-silent.mp4");
	const { browser, page, duration } = await openComposition();
	const frames = Math.round(duration * FPS);

	const encoderArgs = [
		"-y", "-hide_banner", "-loglevel", "error", "-stats",
		"-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
		...(withMusic ? ["-i", music] : []),
		"-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p", "-r", String(FPS),
		...(withMusic ? ["-c:a", "aac", "-b:a", "192k", "-shortest"] : []),
		"-movflags", "+faststart",
		out,
	];
	const encoder = spawn(ffmpeg(), encoderArgs, { stdio: ["pipe", "inherit", "inherit"] });
	const done = new Promise((resolve, reject) => {
		encoder.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
	});

	const started = Date.now();
	for (let i = 0; i < frames; i++) {
		await page.evaluate((ms) => window.__seek(ms), (i / FPS) * 1000);
		const png = await page.screenshot({ type: "png" });
		if (!encoder.stdin.write(png)) await new Promise((r) => encoder.stdin.once("drain", r));
		if (i % (FPS * 5) === 0) {
			const elapsed = (Date.now() - started) / 1000;
			console.log(`frame ${i}/${frames} (${elapsed.toFixed(0)}s elapsed)`);
		}
	}
	encoder.stdin.end();
	await done;
	await browser.close();
	console.log("wrote", out);
}

(async () => {
	if (option("--preview")) {
		await preview(option("--preview").split(",").map(Number));
	} else {
		await render();
	}
})().catch((error) => {
	console.error(error);
	process.exit(1);
});
