import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import { runMagickCli } from "../magick-cli";
import { MAGICK_OPTIONS } from "../magick-options";
import { initializeMagick, MAGICK_FONTS } from "../magick-run";

const require = createRequire(import.meta.url);

beforeAll(async () => {
	await initializeMagick(
		readFileSync(require.resolve("@imagemagick/magick-wasm/magick.wasm")),
		{
			[MAGICK_FONTS.regular]: readFileSync(
				require.resolve("pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"),
			),
		},
	);
}, 60_000);

/**
 * One command line per option, on two small images made by name (so what
 * pseudo images carry is covered too): every option must run, and write.
 */
const CASES: Record<string, string[]> = {
	adjoin: ["+adjoin"],
	antialias: ["+antialias"],
	attenuate: ["-attenuate", "0.5", "+noise", "Gaussian"],
	background: ["-background", "none", "-flatten"],
	bordercolor: ["-bordercolor", "red", "-border", "2"],
	channel: ["-channel", "RGB", "-evaluate", "multiply", "0.5", "+channel"],
	comment: ["-comment", "made %wx%h"],
	compose: ["-compose", "multiply", "-composite"],
	debug: ["-debug", "None"],
	define: ["-define", "png:compression-level=9"],
	delay: ["-delay", "20x100"],
	density: ["-density", "150"],
	depth: ["-depth", "8"],
	dispose: ["-dispose", "Background"],
	dither: ["+dither", "-colors", "4"],
	fill: ["-fill", "blue", "-opaque", "red"],
	filter: ["-filter", "Lanczos", "-resize", "50%"],
	font: ["-font", MAGICK_FONTS.regular, "-annotate", "+2+12", "x"],
	format: ["-format", "%w"],
	fuzz: ["-fuzz", "10%", "-transparent", "red"],
	geometry: ["-geometry", "+2+2", "-composite"],
	gravity: ["-gravity", "center", "-crop", "10x10+0+0"],
	interlace: ["-interlace", "none"],
	"interline-spacing": ["-interline-spacing", "2"],
	interpolate: ["-interpolate", "bilinear"],
	kerning: ["-kerning", "1"],
	label: ["-label", "%f"],
	limit: ["-limit", "memory", "64MiB"],
	loop: ["-loop", "0"],
	monitor: ["-monitor"],
	ping: ["-ping"],
	pointsize: ["-pointsize", "12", "-annotate", "+1+12", "x"],
	precision: ["-precision", "4"],
	quality: ["-quality", "80"],
	quiet: ["-quiet"],
	"regard-warnings": ["-regard-warnings"],
	"respect-parentheses": ["-respect-parentheses"],
	"sampling-factor": ["-sampling-factor", "4:2:0"],
	seed: ["-seed", "7"],
	size: ["-size", "8x8"],
	stroke: ["-stroke", "black", "-strokewidth", "1", "-draw", "line 0,0 10,10"],
	strokewidth: ["-strokewidth", "2"],
	identify: ["-identify"],
	print: ["-print", "%wx%h\n"],
	treedepth: ["-treedepth", "4"],
	write: ["-write", "copy.png"],
	undercolor: ["-undercolor", "yellow", "-annotate", "+1+12", "x"],
	units: ["-units", "PixelsPerCentimeter"],
	verbose: ["-verbose"],
	"virtual-pixel": ["-virtual-pixel", "transparent"],
	"adaptive-blur": ["-adaptive-blur", "0x1"],
	"adaptive-resize": ["-adaptive-resize", "16x16"],
	"adaptive-sharpen": ["-adaptive-sharpen", "0x1"],
	alpha: ["-alpha", "remove"],
	annotate: ["-annotate", "15x15+2+12", "tilted"],
	"auto-gamma": ["-auto-gamma"],
	"auto-level": ["-auto-level"],
	"auto-orient": ["-auto-orient"],
	"black-threshold": ["-black-threshold", "20%"],
	blur: ["-blur", "0x2"],
	border: ["-border", "3x1"],
	"brightness-contrast": ["-brightness-contrast", "10x20"],
	charcoal: ["-charcoal", "1"],
	chop: ["-chop", "2x2"],
	clahe: ["-clahe", "8x8+128+3"],
	colors: ["-colors", "8"],
	colorspace: ["-colorspace", "Gray"],
	contrast: ["-contrast", "+contrast"],
	"contrast-stretch": ["-contrast-stretch", "2%"],
	crop: ["-crop", "10x10", "+repage"],
	deskew: ["-deskew", "40%"],
	distort: ["-distort", "SRT", "30"],
	draw: ["-fill", "blue", "-draw", "circle 10,10 14,10"],
	evaluate: ["-evaluate", "add", "10%"],
	extent: ["-background", "white", "-gravity", "center", "-extent", "40x40"],
	flip: ["-flip"],
	flop: ["-flop"],
	gamma: ["-gamma", "1.2"],
	"gaussian-blur": ["-gaussian-blur", "0x1"],
	grayscale: ["-grayscale", "Rec709Luma"],
	level: ["-level", "10%,90%,1.1", "+level", "5%,95%"],
	"linear-stretch": ["-linear-stretch", "1x1"],
	"liquid-rescale": ["-liquid-rescale", "15x15"],
	modulate: ["-modulate", "110,90,100"],
	monochrome: ["-monochrome"],
	"motion-blur": ["-motion-blur", "0x2+45"],
	negate: ["-negate", "+negate"],
	noise: ["+noise", "Impulse"],
	normalize: ["-normalize"],
	opaque: ["-fill", "green", "+opaque", "red"],
	paint: ["-paint", "1"],
	profile: ["+profile", "*"],
	repage: ["-repage", "30x30+1+1", "+repage"],
	resize: ["-resize", "16x16>"],
	roll: ["-roll", "+3+2"],
	rotate: ["-background", "none", "-rotate", "45"],
	sample: ["-sample", "50%"],
	scale: ["-scale", "200%"],
	"sepia-tone": ["-sepia-tone", "80%"],
	set: ["-set", "comment", "hi", "+set", "comment"],
	sharpen: ["-sharpen", "0x1"],
	shave: ["-shave", "2x2"],
	"sigmoidal-contrast": [
		"-sigmoidal-contrast",
		"3x50%",
		"+sigmoidal-contrast",
		"3x50%",
	],
	solarize: ["-solarize", "50%"],
	splice: ["-background", "blue", "-splice", "2x2"],
	strip: ["-strip"],
	threshold: ["-threshold", "50%"],
	thumbnail: ["-thumbnail", "8x8"],
	transparent: ["-transparent", "red", "+transparent", "blue"],
	transpose: ["-transpose"],
	transverse: ["-transverse"],
	trim: ["-trim", "+repage"],
	type: ["-type", "TrueColorMatte"],
	vignette: ["-vignette", "0x2"],
	wave: ["-wave", "2x10"],
	"white-threshold": ["-white-threshold", "80%"],
	append: ["+append"],
	clone: ["(", "-clone", "0", "-flip", ")", "-append"],
	coalesce: ["-coalesce"],
	combine: ["-separate", "-combine"],
	composite: ["-gravity", "center", "-composite"],
	deconstruct: ["-deconstruct"],
	delete: ["-delete", "0"],
	duplicate: ["-duplicate", "2,0"],
	"evaluate-sequence": ["-evaluate-sequence", "mean"],
	flatten: ["-flatten"],
	fx: ["-fx", "u*0.5"],
	insert: ["-insert", "0"],
	layers: ["-layers", "optimize"],
	morph: ["-morph", "2"],
	mosaic: ["-mosaic"],
	reverse: ["-reverse"],
	separate: ["-separate"],
	smush: ["+smush", "2"],
	swap: ["+swap"],
};

describe("every magick option", () => {
	it("has a case here", () => {
		expect(
			Object.keys(MAGICK_OPTIONS).filter((name) => !(name in CASES)),
		).toEqual([]);
	});

	it.each(Object.entries(CASES))("-%s runs and writes", (_, options) => {
		const result = runMagickCli({
			argv: [
				"magick",
				"-size",
				"20x20",
				"xc:red",
				"-size",
				"20x20",
				"gradient:white-blue",
				...options,
				"out.png",
			],
			cwd: "/work",
			files: new Map(),
		});
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		expect(
			[...result.written.keys()].some((path) => path.startsWith("/work/out")),
		).toBe(true);
	});
});
