import {
	AlphaAction,
	Channels,
	ColorSpace,
	ColorType,
	CompareSettings,
	CompositeOperator,
	DistortMethod,
	ErrorMetric,
	EvaluateOperator,
	FilterType,
	GifDisposeMethod,
	Gravity,
	type IMagickImage,
	Interlace,
	Magick,
	MagickGeometry,
	MontageSettings,
	NoiseType,
	PixelIntensityMethod,
	PixelInterpolateMethod,
	Quantum,
	VirtualPixelMethod,
} from "@imagemagick/magick-wasm";
import { MAGICK_OPTIONS } from "./magick-options";
import {
	MAGICK_FONTS,
	MagickRun,
	MagickUsageError,
	parseColor,
	parseEnum,
	parseGeometry,
	supportedFormats,
	keepCopy,
	withCollection,
} from "./magick-run";

/**
 * The `magick` command: ImageMagick's command line on magick-wasm, which has
 * no command line of its own. `magick in.png [options] out.jpg` converts;
 * `magick identify`, `mogrify`, `composite`, `montage` and `compare` are the
 * other tools, also run by their own names (`convert` is `magick`).
 */

export interface MagickCliRequest {
	/** The command line, the tool's name first ("magick", "convert", "identify"…). */
	argv: string[];
	cwd: string;
	/** The files the command may read, by absolute path. */
	files: ReadonlyMap<string, Uint8Array>;
	stdin?: Uint8Array;
}

export interface MagickCliResult {
	exitCode: number;
	stdout: Uint8Array;
	stderr: string;
	/** Files the run wrote, by absolute path. */
	written: Map<string, Uint8Array>;
}

/** ImageMagick's tools besides converting, as `magick <tool>` or by name. */
export const MAGICK_TOOLS = [
	"identify",
	"mogrify",
	"composite",
	"montage",
	"compare",
] as const;

const USAGE = `Usage: magick [options ...] file [ [options ...] file ...] [options ...] file
       magick identify [-format "%wx%h\\n"] [-verbose] file ...
       magick mogrify [options ...] [-format type] [-path dir] file ...
       magick composite [-gravity type] [-geometry +x+y] [-compose op] overlay base output
       magick montage [-tile CxR] [-geometry WxH+x+y] [-label "%f"] file ... output
       magick compare [-metric AE|RMSE|PSNR|SSIM] [-fuzz 5%] a b [difference]
convert, identify, mogrify, composite, montage and compare also run by name.
ImageMagick runs here as magick-wasm: magick -list option names the options, magick -list format the formats.
`;

/** Options ImageMagick has and magick-wasm does not, with what to use instead. */
const NOT_HERE: Record<string, string> = {
	unsharp: "use -sharpen RxS",
	posterize: "use -colors N",
	equalize: "use -normalize or -clahe",
	median: "use -blur",
	despeckle: "use -blur 0x1",
	frame: "use -border with -bordercolor",
	shadow: "blur a copy (+clone -blur 0x8) and -composite it under the image",
	colorize: "use -modulate or -sepia-tone",
	tint: "use -modulate or -sepia-tone",
};

const optionOf = (token: string): { name: string; plus: boolean } | null => {
	const match = /^([-+])([a-zA-Z][\w-]*)$/.exec(token);
	return match
		? { name: (match[2] as string).toLowerCase(), plus: match[1] === "+" }
		: null;
};

const optionSpec = (token: string, option: { name: string; plus: boolean }) => {
	const spec = MAGICK_OPTIONS[option.name];
	if (!spec || (option.plus && spec.plusArity === undefined)) {
		const instead = NOT_HERE[option.name];
		throw new MagickUsageError(
			instead
				? `option '${token}' is not available here; ${instead}`
				: `unrecognized option '${token}' (magick -list option names the ones there are)`,
		);
	}
	return option.plus ? (spec.plusArity ?? spec.arity) : spec.arity;
};

/**
 * Runs options and file names left to right, as ImageMagick does: a name
 * reads images onto the list, an option changes the list or the settings.
 */
const processTokens = (run: MagickRun, tokens: readonly string[]): void => {
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index] as string;
		if (token === "(") {
			run.openParenthesis();
			continue;
		}
		if (token === ")") {
			run.closeParenthesis();
			continue;
		}
		const option = optionOf(token);
		if (!option) {
			for (const name of run.expand(token)) run.images.push(...run.read(name));
			continue;
		}
		const arity = optionSpec(token, option);
		const args = tokens.slice(index + 1, index + 1 + arity);
		if (args.length < arity) {
			throw new MagickUsageError(`option requires an argument '${token}'`);
		}
		MAGICK_OPTIONS[option.name]?.run(run, [...args], option.plus);
		index += arity;
	}
	if (!run.balanced) throw new MagickUsageError("unbalanced parenthesis");
};

/** Splits options (with their arguments) from file names, for the tools whose files come in any order. */
const splitTokens = (
	tokens: readonly string[],
	own: Readonly<Record<string, number>> = {},
) => {
	const options: string[] = [];
	const names: string[] = [];
	const local = new Map<string, string[]>();
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index] as string;
		const option = optionOf(token);
		if (!option) {
			names.push(token);
			continue;
		}
		const ownArity = own[option.name];
		const arity = ownArity ?? optionSpec(token, option);
		const args = tokens.slice(index + 1, index + 1 + arity);
		if (args.length < arity) {
			throw new MagickUsageError(`option requires an argument '${token}'`);
		}
		if (ownArity !== undefined) local.set(option.name, [...args]);
		else options.push(token, ...args);
		index += arity;
	}
	return { options, names, local };
};

const lastOutput = (tokens: readonly string[]): string => {
	const output = tokens[tokens.length - 1];
	if (!output || optionOf(output) || output === "(" || output === ")") {
		throw new MagickUsageError("missing an image filename");
	}
	return output;
};

// --- the tools --------------------------------------------------------------

const convert = (run: MagickRun, args: readonly string[]): number => {
	const output = lastOutput(args);
	processTokens(run, args.slice(0, -1));
	run.write(output, run.images);
	return 0;
};

const printIdentity = (run: MagickRun, images: readonly IMagickImage[]) => {
	images.forEach((image, index) => {
		if (run.settings.format !== undefined) {
			run.print(run.formatText(image, run.settings.format));
		} else if (run.settings.verbose) {
			run.print(run.describe(image, index, images.length));
		} else {
			run.print(`${run.identifyLine(image, index, images.length)}\n`);
		}
	});
};

const identify = (run: MagickRun, args: readonly string[]): number => {
	const { options, names } = splitTokens(args);
	if (!names.length) throw new MagickUsageError("missing an image filename");
	processTokens(run, options);
	let failed = false;
	for (const name of names.flatMap((spec) => run.expand(spec))) {
		try {
			const images = run.read(name);
			printIdentity(run, images);
			for (const image of images) image.dispose();
		} catch (error) {
			run.warn(`identify: ${messageOf(error)}`);
			failed = true;
		}
	}
	return failed ? 1 : 0;
};

/** mogrify: every option on every file, written over it (or to -path, as -format). */
const mogrify = (run: MagickRun, args: readonly string[]): number => {
	const { options, names, local } = splitTokens(args, { path: 1, format: 1 });
	const files = names.flatMap((spec) => run.expand(spec));
	if (!files.length) throw new MagickUsageError("no images defined");
	const directory = local.get("path")?.[0];
	const format = local.get("format")?.[0];
	for (const file of files) {
		run.images = run.read(file);
		processTokens(run, options);
		let target = file.replace(/\[[^\]]*\]$/, "");
		if (format) {
			const slash = target.lastIndexOf("/");
			const dot = target.lastIndexOf(".");
			target = `${dot > slash ? target.slice(0, dot) : target}.${format.toLowerCase()}`;
		}
		if (directory) {
			target = `${directory.replace(/\/$/, "")}/${target.slice(target.lastIndexOf("/") + 1)}`;
		}
		run.write(target, run.images);
		for (const image of run.images) image.dispose();
		run.images = [];
	}
	return 0;
};

/** composite: `composite [options] overlay base [output]`, as magick base overlay -composite. */
const composite = (run: MagickRun, args: readonly string[]): number => {
	const { options, names, local } = splitTokens(args, {
		dissolve: 1,
		blend: 1,
		watermark: 1,
	});
	if (names.length < 3) {
		throw new MagickUsageError(
			"usage: composite [options] overlay base output",
		);
	}
	if (names.length > 3) {
		throw new MagickUsageError(
			"a mask image is not available here; composite takes overlay base output",
		);
	}
	processTokens(run, options);
	const [overlay, base, output] = names as [string, string, string];
	for (const [name, compose] of [
		["dissolve", CompositeOperator.Dissolve],
		["blend", CompositeOperator.Blend],
		["watermark", CompositeOperator.Modulate],
	] as const) {
		const value = local.get(name)?.[0];
		if (value === undefined) continue;
		run.settings.compose = compose;
		run.settings.defines.set("compose:args", value.replace(/%/g, ""));
	}
	const first = (spec: string) => {
		const [image, ...rest] = run.read(spec);
		for (const extra of rest) extra.dispose();
		if (!image) throw new MagickUsageError(`no image in '${spec}'`);
		return image;
	};
	run.images = [first(base), first(overlay)];
	MAGICK_OPTIONS.composite?.run(run, [], false);
	run.write(output, run.images);
	return 0;
};

/** montage: the images on a grid of tiles, labelled if asked. */
const montage = (run: MagickRun, args: readonly string[]): number => {
	const output = lastOutput(args);
	const { options, names, local } = splitTokens(args.slice(0, -1), {
		tile: 1,
		title: 1,
		shadow: 0,
		mode: 1,
		borderwidth: 1,
	});
	processTokens(run, options);
	const images = names.flatMap((spec) =>
		run.expand(spec).flatMap((name) => run.read(name)),
	);
	if (!images.length) throw new MagickUsageError("no images defined");
	const { settings } = run;
	const montageSettings = new MontageSettings();
	const concatenate = local.get("mode")?.[0]?.toLowerCase() === "concatenate";
	let geometry = settings.geometry ?? (concatenate ? "+0+0" : "120x120>+4+4");
	// Spacing alone ("+2+2") keeps the images' size, as ImageMagick does.
	if (/^[+-]/.test(geometry)) {
		const width = Math.max(...images.map((image) => image.width));
		const height = Math.max(...images.map((image) => image.height));
		geometry = `${width}x${height}${geometry}`;
	}
	montageSettings.geometry = parseGeometry(geometry, "-geometry");
	const tile = local.get("tile")?.[0];
	if (tile) {
		const [columns = "0", rows = "0"] = tile.split("x");
		montageSettings.tileGeometry = new MagickGeometry(
			Number(columns || 0),
			Number(rows || 0),
		);
	}
	montageSettings.backgroundColor = settings.background ?? parseColor("white");
	if (settings.borderColor) montageSettings.borderColor = settings.borderColor;
	const border = local.get("borderwidth")?.[0];
	if (border) montageSettings.borderWidth = Number(border);
	if (settings.fill) montageSettings.fillColor = settings.fill;
	if (settings.stroke) montageSettings.strokeColor = settings.stroke;
	montageSettings.font = run.font();
	if (settings.pointsize !== undefined) {
		montageSettings.fontPointsize = settings.pointsize;
	}
	if (settings.gravity !== undefined)
		montageSettings.gravity = settings.gravity;
	const title = local.get("title")?.[0];
	if (title) montageSettings.title = title;
	if (local.has("shadow")) montageSettings.shadow = true;
	const result = withCollection(images, (collection) =>
		collection.montage(montageSettings, keepCopy),
	);
	for (const image of images) image.dispose();
	run.images = [result];
	run.write(output, run.images);
	return 0;
};

const METRIC_ALIASES = {
	AE: "Absolute",
	MAE: "MeanAbsolute",
	MEPP: "MeanErrorPerPixel",
	MSE: "MeanSquared",
	NCC: "NormalizedCrossCorrelation",
	PAE: "PeakAbsolute",
	PSNR: "PeakSignalToNoiseRatio",
	PHASH: "PerceptualHash",
	RMSE: "RootMeanSquared",
	SSIM: "StructuralSimilarity",
	DSSIM: "StructuralDissimilarity",
} as const;

/**
 * compare: how different two images are, on stderr as ImageMagick prints
 * it, with the differences drawn into a third file if one is named. Exits 0
 * when they are the same, 1 when not.
 */
const compare = (run: MagickRun, args: readonly string[]): number => {
	const { options, names, local } = splitTokens(args, {
		metric: 1,
		"highlight-color": 1,
		"lowlight-color": 1,
	});
	processTokens(run, options);
	const [left, right, difference] = names;
	if (!left || !right) {
		throw new MagickUsageError(
			"usage: compare [-metric type] image other [difference]",
		);
	}
	const metric = parseEnum(
		ErrorMetric,
		local.get("metric")?.[0] ?? "AE",
		"metric",
		METRIC_ALIASES,
	);
	const [a] = run.read(left);
	const [b] = run.read(right);
	if (!a || !b) throw new MagickUsageError("no images defined");
	run.images = [a, b];
	if (run.settings.fuzz) a.colorFuzz = run.settings.fuzz;
	let distortion: number;
	if (difference) {
		const settings = new CompareSettings(metric);
		const highlight = local.get("highlight-color")?.[0];
		const lowlight = local.get("lowlight-color")?.[0];
		if (highlight) settings.highlightColor = parseColor(highlight);
		if (lowlight) settings.lowlightColor = parseColor(lowlight);
		distortion = a.compare(b, settings, (result) => {
			run.write(difference, [result.difference]);
			return Number(result.distortion);
		});
	} else {
		distortion = a.compare(b, metric);
	}
	// magick-wasm gives the normalized value; ImageMagick prints the
	// absolute one first where there is one (pixels for AE, levels for RMSE).
	const round = (value: number) => String(Number(value.toPrecision(6)));
	const absolute =
		metric === ErrorMetric.Absolute
			? distortion * a.width * a.height
			: QUANTUM_METRICS.includes(metric)
				? distortion * Quantum.max
				: undefined;
	run.warn(
		absolute === undefined
			? round(distortion)
			: `${round(absolute)} (${round(distortion)})`,
	);
	const similar = SIMILARITY_METRICS.includes(metric)
		? distortion >= 1
		: distortion === 0 || !Number.isFinite(distortion);
	return similar ? 0 : 1;
};

/** Metrics ImageMagick also prints in quantum levels. */
const QUANTUM_METRICS: readonly ErrorMetric[] = [
	ErrorMetric.MeanAbsolute,
	ErrorMetric.MeanSquared,
	ErrorMetric.PeakAbsolute,
	ErrorMetric.RootMeanSquared,
];

/** Metrics where 1 means the same, not 0. */
const SIMILARITY_METRICS: readonly ErrorMetric[] = [
	ErrorMetric.NormalizedCrossCorrelation,
	ErrorMetric.StructuralSimilarity,
];

// --- information ------------------------------------------------------------

const LISTS: Record<string, () => string[]> = {
	alpha: () => Object.keys(AlphaAction),
	channel: () => Object.keys(Channels),
	colorspace: () => Object.keys(ColorSpace),
	compose: () => Object.keys(CompositeOperator),
	dispose: () => Object.keys(GifDisposeMethod),
	distort: () => Object.keys(DistortMethod),
	evaluate: () => Object.keys(EvaluateOperator),
	filter: () => Object.keys(FilterType),
	font: () => Object.values(MAGICK_FONTS),
	format: () =>
		supportedFormats().map(
			(info) =>
				`${info.format.padStart(10)}  ${info.supportsReading ? "r" : "-"}${info.supportsWriting ? "w" : "-"}${info.supportsMultipleFrames ? "+" : "-"}  ${info.description}`,
		),
	gravity: () => Object.keys(Gravity),
	intensity: () => Object.keys(PixelIntensityMethod),
	interlace: () => Object.keys(Interlace),
	interpolate: () => Object.keys(PixelInterpolateMethod),
	layers: () => [
		"coalesce",
		"flatten",
		"merge",
		"mosaic",
		"optimize",
		"optimize-plus",
		"optimize-transparency",
		"trim-bounds",
	],
	metric: () => Object.keys(METRIC_ALIASES),
	noise: () => Object.keys(NoiseType),
	option: () =>
		Object.entries(MAGICK_OPTIONS).map(
			([name, spec]) =>
				`${spec.plusArity !== undefined ? "+" : " "}-${name}${spec.arity ? ` (${spec.arity} argument${spec.arity > 1 ? "s" : ""})` : ""}`,
		),
	type: () => Object.keys(ColorType),
	"virtual-pixel": () => Object.keys(VirtualPixelMethod),
};

const list = (run: MagickRun, name: string | undefined): number => {
	const key = (name ?? "list").toLowerCase();
	if (key === "list") {
		run.print(`${Object.keys(LISTS).sort().join("\n")}\n`);
		return 0;
	}
	const lines = LISTS[key];
	if (!lines) throw new MagickUsageError(`unrecognized list type '${name}'`);
	if (key === "format") {
		run.print(
			"    Format  Mode  Description (r read, w write, + several images)\n",
		);
	}
	run.print(`${lines().join("\n")}\n`);
	return 0;
};

const version = (run: MagickRun): number => {
	run.print(
		[
			`Version: ${Magick.imageMagickVersion}`,
			`Features: ${Magick.features}`,
			`Delegates (built-in): ${Magick.delegates}`,
			"Runs as magick-wasm (WebAssembly): no Ghostscript (PDF input) and no external programs.",
			"",
		].join("\n"),
	);
	return 0;
};

const messageOf = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

export const runMagickCli = (request: MagickCliRequest): MagickCliResult => {
	const [command = "magick", ...rest] = request.argv;
	let tool = command === "magick" || command === "convert" ? "magick" : command;
	let args = rest;
	if (tool === "magick" && MAGICK_TOOLS.includes(rest[0] as never)) {
		tool = rest[0] as string;
		args = rest.slice(1);
	} else if (tool === "magick" && rest[0] === "convert") {
		args = rest.slice(1);
	}
	const run = new MagickRun(request.cwd, request.files, request.stdin);
	let exitCode = 0;
	try {
		const first = args[0];
		if (
			!args.length ||
			first === "-help" ||
			first === "--help" ||
			first === "-h"
		) {
			run.print(USAGE);
			exitCode = args.length ? 0 : 1;
		} else if (first === "-version" || first === "--version") {
			exitCode = version(run);
		} else if (first === "-list") {
			exitCode = list(run, args[1]);
		} else if (tool === "identify") exitCode = identify(run, args);
		else if (tool === "mogrify") exitCode = mogrify(run, args);
		else if (tool === "composite") exitCode = composite(run, args);
		else if (tool === "montage") exitCode = montage(run, args);
		else if (tool === "compare") exitCode = compare(run, args);
		else exitCode = convert(run, args);
	} catch (error) {
		run.warn(`${tool}: ${messageOf(error)}`);
		exitCode = tool === "compare" ? 2 : 1;
	} finally {
		run.dispose();
	}
	return {
		exitCode,
		stdout: run.stdout,
		stderr: run.stderr,
		written: run.written,
	};
};
