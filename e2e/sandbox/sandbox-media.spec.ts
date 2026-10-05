import { test, expect } from "./fixtures";
import { runSandboxOperation } from "./sandbox-job";

test.describe.configure({ mode: "serial" });

interface CommandResult {
	status: string;
	exitCode?: number;
	stdout: string;
	stderr: string;
}

const run = (
	page: Parameters<typeof runSandboxOperation>[0],
	command: string,
) =>
	runSandboxOperation<CommandResult>(page, "runtime.executeCommand", {
		command,
		cwd: "/projects/sandbox-e2e-media",
		waitTimeoutMs: 60_000,
	});

test("ffmpeg, ffprobe and magick come installed", async ({ extensionPage }) => {
	await runSandboxOperation(extensionPage, "fs.mkdir", {
		path: "/projects/sandbox-e2e-media",
		recursive: true,
	});

	const card = await run(
		extensionPage,
		"magick -size 160x90 gradient:red-blue -fill white -pointsize 20 -gravity center -annotate +0+0 Hello card.png && identify card.png",
	);
	expect(card).toMatchObject({ status: "completed", exitCode: 0 });
	expect(card.stdout).toContain("card.png PNG 160x90");

	const clip = await run(
		extensionPage,
		"ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc=duration=1:size=160x120:rate=10 -pix_fmt yuv420p clip.mp4 && ffprobe -v error -show_entries stream=codec_name,width -of csv=p=0 clip.mp4",
	);
	expect(clip).toMatchObject({ status: "completed", exitCode: 0 });
	expect(clip.stdout.trim()).toBe("h264,160");

	// What one tool writes, the next reads; a shell tool reads it too.
	const gif = await run(
		extensionPage,
		"ffmpeg -hide_banner -loglevel error -i clip.mp4 -vf fps=5,scale=80:-1 clip.gif && convert clip.gif[0] card.png +append strip.png && identify -format '%wx%h' strip.png && ls",
	);
	expect(gif).toMatchObject({ status: "completed", exitCode: 0 });
	expect(gif.stdout).toContain("240x90");
	expect(gif.stdout).toContain("strip.png");

	const missing = await run(extensionPage, "magick nope.png out.png");
	expect(missing.exitCode).toBe(1);
	expect(missing.stderr).toContain("unable to open image 'nope.png'");
});

test("pipes carry images and video byte for byte", async ({ extensionPage }) => {
	const piped = await run(
		extensionPage,
		"cat card.png | magick - -resize 50% half.jpg && identify -format '%m %wx%h' half.jpg",
	);
	expect(piped).toMatchObject({ exitCode: 0, stdout: "JPEG 80x45" });

	const chained = await run(
		extensionPage,
		"ffmpeg -hide_banner -loglevel error -i clip.mp4 -frames:v 1 -f image2pipe -c:v png - | magick - -format %wx%h info:",
	);
	expect(chained).toMatchObject({ exitCode: 0, stdout: "160x120" });

	const encoded = await run(
		extensionPage,
		"magick - -format %m info: < card.png && magick card.png png:- | base64 -w0 | head -c 11",
	);
	expect(encoded).toMatchObject({ exitCode: 0, stdout: "PNGiVBORw0KGgo" });
});
