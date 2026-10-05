import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { runMagickCli } from "../magick-cli";
import { initializeMagick, MAGICK_FONTS } from "../magick-run";

const require = createRequire(import.meta.url);
const decoder = new TextDecoder();

beforeAll(async () => {
	const fonts = require.resolve(
		"pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf",
	);
	await initializeMagick(
		readFileSync(require.resolve("@imagemagick/magick-wasm/magick.wasm")),
		{
			[MAGICK_FONTS.regular]: readFileSync(fonts),
			[MAGICK_FONTS.bold]: readFileSync(fonts.replace("Regular", "Bold")),
		},
	);
}, 60_000);

/** A computer of files; each run sees what the ones before it wrote. */
const computer = (cwd = "/work") => {
	const files = new Map<string, Uint8Array>();
	const run = (...argv: string[]) => {
		const result = runMagickCli({ argv, cwd, files });
		for (const [path, data] of result.written) files.set(path, data);
		return {
			...result,
			text: decoder.decode(result.stdout),
		};
	};
	return { files, run };
};

/** Width, height and frame count, as identify -format reads them. */
const size = (run: ReturnType<typeof computer>["run"], file: string) =>
	run("identify", "-format", "%wx%h;", file).text;

describe("magick", () => {
	it("makes, resizes and converts images", () => {
		const { files, run } = computer();
		expect(
			run("magick", "-size", "200x100", "xc:red", "red.png").exitCode,
		).toBe(0);
		expect(files.has("/work/red.png")).toBe(true);
		expect(size(run, "red.png")).toBe("200x100;");

		expect(
			run("magick", "red.png", "-resize", "50%", "-quality", "80", "small.jpg")
				.exitCode,
		).toBe(0);
		expect(run("identify", "small.jpg").text).toMatch(
			/^\/work\/small\.jpg JPEG 100x50 /,
		);

		run(
			"convert",
			"red.png",
			"-resize",
			"64x64^",
			"-gravity",
			"center",
			"-extent",
			"64x64",
			"thumb.webp",
		);
		expect(size(run, "thumb.webp")).toBe("64x64;");
	});

	it("reads the files a glob names and builds animations", () => {
		const { run } = computer();
		for (const color of ["red", "green", "blue"]) {
			run("magick", "-size", "20x20", `xc:${color}`, `frame-${color}.png`);
		}
		expect(
			run("magick", "-delay", "20", "-loop", "0", "frame-*.png", "anim.gif")
				.exitCode,
		).toBe(0);
		expect(size(run, "anim.gif")).toBe("20x20;20x20;20x20;");
		expect(run("identify", "-format", "%T ", "anim.gif").text).toBe(
			"20 20 20 ",
		);

		// A format that holds one image: one file per frame.
		run("magick", "anim.gif", "split/%02d.png");
		expect(size(run, "split/00.png")).toBe("20x20;");
		expect(size(run, "split/02.png")).toBe("20x20;");
		run("magick", "anim.gif", "each.png");
		expect(size(run, "each-1.png")).toBe("20x20;");
		expect(size(run, "anim.gif[1]")).toBe("20x20;");
	});

	it("crops to tiles when no offset is given, and to one area when it is", () => {
		const { run } = computer();
		run("magick", "-size", "100x50", "xc:white", "page.png");
		run("magick", "page.png", "-crop", "50x50", "+repage", "tile-%d.png");
		expect(size(run, "tile-0.png")).toBe("50x50;");
		expect(size(run, "tile-1.png")).toBe("50x50;");
		run("magick", "page.png", "-crop", "30x20+5+5", "+repage", "area.png");
		expect(size(run, "area.png")).toBe("30x20;");
	});

	it("handles parentheses, clones and appends", () => {
		const { run } = computer();
		run(
			"magick",
			"-size",
			"10x10",
			"xc:red",
			"(",
			"+clone",
			"-resize",
			"20x10!",
			")",
			"+append",
			"strip.png",
		);
		expect(size(run, "strip.png")).toBe("30x10;");
		run(
			"magick",
			"-size",
			"10x10",
			"xc:red",
			"xc:blue",
			"-append",
			"column.png",
		);
		expect(size(run, "column.png")).toBe("10x20;");
	});

	it("draws text and shapes with the shipped font", () => {
		const { run } = computer();
		run("magick", "-size", "120x40", "xc:white", "blank.png");
		const colors = (file: string) =>
			Number(run("identify", "-format", "%k", file).text);
		expect(colors("blank.png")).toBe(1);

		expect(
			run(
				"magick",
				"blank.png",
				"-fill",
				"blue",
				"-pointsize",
				"20",
				"-gravity",
				"center",
				"-annotate",
				"+0+0",
				"Hi",
				"text.png",
			).exitCode,
		).toBe(0);
		expect(colors("text.png")).toBeGreaterThan(2);

		expect(
			run(
				"magick",
				"blank.png",
				"-fill",
				"red",
				"-draw",
				"circle 20,20 30,20",
				"-draw",
				"text 60,30 'ok'",
				"drawn.png",
			).exitCode,
		).toBe(0);
		expect(colors("drawn.png")).toBeGreaterThan(2);

		const label = run("magick", "-pointsize", "24", "label:Hello", "label.png");
		expect(label.exitCode).toBe(0);
		expect(size(run, "label.png")).toMatch(/^\d+x\d+;$/);

		const fallback = run("magick", "-font", "Arial", "label:Hi", "arial.png");
		expect(fallback.exitCode).toBe(0);
		expect(fallback.stderr).toContain("font 'Arial' is not installed");
	});

	it("mogrifies files in place or into another format", () => {
		const { files, run } = computer();
		run("magick", "-size", "40x40", "xc:red", "a.png");
		run("magick", "-size", "40x40", "xc:blue", "b.png");
		expect(run("mogrify", "-resize", "50%", "*.png").exitCode).toBe(0);
		expect(size(run, "a.png")).toBe("20x20;");
		expect(size(run, "b.png")).toBe("20x20;");
		run("mogrify", "-format", "jpg", "-path", "out", "a.png");
		expect(files.has("/work/out/a.jpg")).toBe(true);
	});

	it("composites, montages and compares", () => {
		const { run } = computer();
		run("magick", "-size", "100x100", "xc:white", "base.png");
		run("magick", "-size", "10x10", "xc:black", "logo.png");
		expect(
			run(
				"composite",
				"-gravity",
				"southeast",
				"-geometry",
				"+5+5",
				"logo.png",
				"base.png",
				"marked.png",
			).exitCode,
		).toBe(0);
		expect(
			run("identify", "-format", "%[pixel:p{90,90}]", "marked.png").text,
		).toMatch(/black|gray\(0\)|srgb\(0,0,0\)/i);

		expect(
			run(
				"montage",
				"base.png",
				"logo.png",
				"-tile",
				"2x",
				"-geometry",
				"+0+0",
				"sheet.png",
			).exitCode,
		).toBe(0);
		expect(size(run, "sheet.png")).toMatch(/^200x100;$/);

		const same = run(
			"compare",
			"-metric",
			"AE",
			"base.png",
			"base.png",
			"diff.png",
		);
		expect(same.exitCode).toBe(0);
		expect(same.stderr.trim()).toBe("0 (0)");
		expect(size(run, "diff.png")).toBe("100x100;");
		const different = run("compare", "-metric", "AE", "base.png", "marked.png");
		expect(different.exitCode).toBe(1);
		expect(different.stderr.trim()).toBe("100 (0.01)");
	});

	it("writes to stdout and prints info", () => {
		const { run } = computer();
		run("magick", "-size", "8x8", "xc:red", "red.png");
		const out = run("magick", "red.png", "png:-");
		expect(decoder.decode(out.stdout.subarray(1, 4))).toBe("PNG");
		expect(run("magick", "red.png", "-format", "%m %wx%h", "info:").text).toBe(
			"PNG 8x8",
		);
		// Leading whitespace stays, as ImageMagick keeps it.
		expect(run("identify", "-format", " %m\\n", "red.png").text).toBe(" PNG\n");
		expect(run("identify", "-format", "\\n%w", "red.png").text).toBe("\n8");
		expect(run("magick", "-list", "format").text).toMatch(/PNG {2}rw/);
		expect(run("magick", "-version").text).toContain("ImageMagick 7");
		expect(run("identify", "-verbose", "red.png").text).toContain(
			"Geometry: 8x8+0+0",
		);
	});

	it("says what went wrong, and what to use instead", () => {
		const { files, run } = computer();
		const missing = run("magick", "nope.png", "out.png");
		expect(missing.exitCode).toBe(1);
		expect(missing.stderr).toContain("unable to open image 'nope.png'");

		run("magick", "-size", "8x8", "xc:red", "red.png");
		const unsharp = run("magick", "red.png", "-unsharp", "0x1", "out.png");
		expect(unsharp.exitCode).toBe(1);
		expect(unsharp.stderr).toContain("use -sharpen");
		expect(run("magick", "red.png", "-bogus", "out.png").stderr).toContain(
			"unrecognized option '-bogus'",
		);

		files.set("/work/doc.pdf", new TextEncoder().encode("%PDF-1.4\n"));
		const pdf = run("magick", "doc.pdf", "page.png");
		expect(pdf.exitCode).toBe(1);
		expect(pdf.stderr).toContain("pymupdf");

		expect(run("compare", "red.png").exitCode).toBe(2);

		const piped = runMagickCli({
			argv: ["magick", "-", "out.png"],
			cwd: "/work",
			files,
			stdin: new TextEncoder().encode("�PNG mangled by a text pipe"),
		});
		expect(piped.exitCode).toBe(1);
		expect(piped.stderr).toContain(
			"could not read an image from stdin; pipe it from a file with cat",
		);
	});
});
