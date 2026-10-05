import {
	AlphaAction,
	Channels,
	ColorSpace,
	ColorType,
	CompositeOperator,
	Density,
	DensityUnit,
	DistortMethod,
	DistortSettings,
	EvaluateOperator,
	FilterType,
	GifDisposeMethod,
	Gravity,
	type IMagickImage,
	type IMagickImageCollection,
	Interlace,
	Magick,
	MagickFormat,
	MagickImageCollection,
	MagickReadSettings,
	NoiseType,
	PixelIntensityMethod,
	PixelInterpolateMethod,
	Point,
	QuantizeSettings,
	Quantum,
	VirtualPixelMethod,
} from "@imagemagick/magick-wasm";
import {
	hasOffset,
	keepCopy,
	MagickUsageError,
	type MagickRun,
	parseChannels,
	parseColor,
	parseEnum,
	parseGeometry,
	parseNumber,
	parseNumbers,
	parsePercent,
	takeAll,
	withCollection,
} from "./magick-run";

/**
 * The command line options `magick` takes, as ImageMagick reads them: a
 * setting carries on to what comes after it, an operator changes every image
 * in the current list, and a list operator works on the list as a whole.
 * Each maps to magick-wasm; ImageMagick options it has no call for are
 * refused by name rather than ignored.
 */

type Handler = (run: MagickRun, args: string[], plus: boolean) => void;

export interface MagickOption {
	/** How many arguments follow `-name`. */
	arity: number;
	/** How many follow `+name`, when the + form exists. */
	plusArity?: number;
	run: Handler;
}

const each =
	(apply: (image: IMagickImage, args: string[], run: MagickRun) => void) =>
	(run: MagickRun, args: string[]) => {
		for (const image of run.images) apply(image, args, run);
	};

const radiusSigma = (value: string, option: string) => {
	const [radius = 0, sigma = 1] = parseNumbers(value, option);
	return { radius, sigma };
};

/** A level given as "10%" or as a quantum value ("25" of 255). */
const levelPercent = (
	value: string | undefined,
	fallback: number,
	option: string,
) => {
	if (value === undefined || value === "")
		return parsePercent(`${fallback}`, option);
	return value.endsWith("%")
		? parsePercent(value, option)
		: parsePercent(
				`${(parseNumber(value, option) / Quantum.max) * 100}`,
				option,
			);
};

/** Indexes as -delete and -clone take them: "0", "-1", "1-3", "0,2". */
const pickIndexes = (
	value: string,
	length: number,
	option: string,
): number[] => {
	const picked = new Set<number>();
	const at = (text: string) => {
		const index = parseNumber(text, option);
		return index < 0 ? length + index : index;
	};
	for (const part of value.split(",")) {
		const range = /^(-?\d+)-(-?\d+)$/.exec(part.trim());
		if (range) {
			for (
				let index = at(range[1] as string);
				index <= at(range[2] as string);
				index += 1
			) {
				picked.add(index);
			}
		} else picked.add(at(part.trim()));
	}
	return [...picked]
		.filter((index) => index >= 0 && index < length)
		.sort((a, b) => a - b);
};

/** Replaces the list with one image a collection call made. */
const reduceList = (
	run: MagickRun,
	combine: (images: IMagickImage[]) => IMagickImage,
): void => {
	const images = run.images;
	if (!images.length) throw new MagickUsageError("no images defined");
	const result = combine(images);
	for (const image of images) image.dispose();
	run.images = [result];
};

/**
 * Runs a collection call that replaces its images in place (coalesce…):
 * what it replaced is freed with it, what it made becomes the list.
 */
const transformList = (
	run: MagickRun,
	transform: (collection: IMagickImageCollection) => void,
): void => {
	const images = run.images;
	if (!images.length) throw new MagickUsageError("no images defined");
	const collection = MagickImageCollection.create();
	collection.push(...images);
	transform(collection);
	run.images = takeAll(collection);
};

const firstBackground = (run: MagickRun): void => {
	const first = run.images[0];
	if (first && run.settings.background) {
		first.backgroundColor = run.settings.background;
	}
};

const resizeWith =
	(filter?: FilterType) =>
	(image: IMagickImage, [value]: string[], run: MagickRun) => {
		const geometry = parseGeometry(value as string, "-resize");
		const chosen = filter ?? run.settings.filter;
		if (chosen !== undefined) image.resize(geometry, chosen);
		else image.resize(geometry);
	};

/** -annotate's geometry: "+10+20", "30x30+10+20" or "30+10+20" (degrees). */
const annotateGeometry = (value: string) => {
	const match =
		/^(?:(-?[\d.]+)(?:x(-?[\d.]+))?)?([+-][\d.]+)?([+-][\d.]+)?$/.exec(value);
	if (!match)
		throw new MagickUsageError(
			`invalid argument for option '-annotate': ${value}`,
		);
	return {
		angle: Number(match[1] ?? 0),
		x: Number(match[3] ?? 0),
		y: Number(match[4] ?? 0),
	};
};

const GRAY_SPACES: readonly ColorSpace[] = [
	ColorSpace.Gray,
	ColorSpace.LinearGray,
];

/**
 * Colors laid over a grayscale image (a PNG of one gray) need it in color
 * first, as ImageMagick's own -draw and -composite do; else nothing shows.
 */
const allowColor = (destination: IMagickImage, source: IMagickImage): void => {
	if (
		GRAY_SPACES.includes(destination.colorSpace) &&
		!GRAY_SPACES.includes(source.colorSpace)
	) {
		destination.colorSpace = ColorSpace.sRGB;
	}
};

const MVG_GRAVITY: Record<number, string> = {
	[Gravity.Northwest]: "NorthWest",
	[Gravity.North]: "North",
	[Gravity.Northeast]: "NorthEast",
	[Gravity.West]: "West",
	[Gravity.Center]: "Center",
	[Gravity.East]: "East",
	[Gravity.Southwest]: "SouthWest",
	[Gravity.South]: "South",
	[Gravity.Southeast]: "SouthEast",
};

/**
 * -draw: the primitives (MVG, with the current fill, stroke and font) drawn
 * as a layer the size of the image, then laid over it.
 */
const draw = (image: IMagickImage, [primitives]: string[], run: MagickRun) => {
	const { settings } = run;
	const lines = [
		`viewbox 0 0 ${image.width} ${image.height}`,
		`font '/fonts/${run.font()}'`,
		settings.fill && `fill '${settings.fill.toString()}'`,
		settings.stroke && `stroke '${settings.stroke.toString()}'`,
		settings.strokeWidth !== undefined &&
			`stroke-width ${settings.strokeWidth}`,
		settings.pointsize !== undefined && `font-size ${settings.pointsize}`,
		settings.gravity !== undefined &&
			MVG_GRAVITY[settings.gravity] &&
			`gravity ${MVG_GRAVITY[settings.gravity]}`,
		settings.kerning !== undefined && `kerning ${settings.kerning}`,
		settings.interlineSpacing !== undefined &&
			`interline-spacing ${settings.interlineSpacing}`,
		settings.undercolor &&
			`text-undercolor '${settings.undercolor.toString()}'`,
		!settings.antialias && "stroke-antialias 0\ntext-antialias 0",
		primitives,
	].filter(Boolean);
	const collection = MagickImageCollection.create();
	collection.read(
		new TextEncoder().encode(`${lines.join("\n")}\n`),
		new MagickReadSettings({
			format: MagickFormat.Mvg,
			backgroundColor: parseColor("none"),
		}),
	);
	const layers = takeAll(collection);
	try {
		for (const layer of layers) {
			allowColor(image, layer);
			image.composite(layer, CompositeOperator.Over);
		}
	} finally {
		for (const layer of layers) layer.dispose();
	}
};

const DISTORT_ALIASES = { SRT: "ScaleRotateTranslate" } as const;
const NOISE_ALIASES = { Multiplicative: "MultiplicativeGaussian" } as const;
const TYPE_ALIASES = {
	GrayscaleMatte: "GrayscaleAlpha",
	PaletteMatte: "PaletteAlpha",
	TrueColorMatte: "TrueColorAlpha",
	ColorSeparationMatte: "ColorSeparationAlpha",
} as const;
const INTERLACE_ALIASES = { None: "NoInterlace" } as const;
const DISPOSE_ALIASES = {
	"0": "Undefined",
	"1": "None",
	"2": "Background",
	"3": "Previous",
} as const;

const setting =
	(
		apply: (run: MagickRun, value: string) => void,
		reset?: (run: MagickRun) => void,
	): Handler =>
	(run, [value], plus) => {
		if (plus) reset?.(run);
		else apply(run, value as string);
	};

export const MAGICK_OPTIONS: Record<string, MagickOption> = {
	// --- settings: carried to what comes after ---------------------------------
	adjoin: {
		arity: 0,
		plusArity: 0,
		run: (run, _, plus) => {
			run.settings.adjoin = !plus;
		},
	},
	antialias: {
		arity: 0,
		plusArity: 0,
		run: (run, _, plus) => {
			run.settings.antialias = !plus;
		},
	},
	attenuate: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.attenuate = parseNumber(value, "-attenuate");
		}),
	},
	background: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.background = parseColor(value);
		}),
	},
	bordercolor: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.borderColor = parseColor(value);
		}),
	},
	channel: {
		arity: 1,
		plusArity: 0,
		run: setting(
			(run, value) => {
				run.settings.channels = parseChannels(value);
			},
			(run) => {
				run.settings.channels = undefined;
			},
		),
	},
	comment: {
		arity: 1,
		run: (run, [value]) => {
			run.settings.comment = value;
			for (const image of run.images)
				image.comment = run.formatText(image, value as string);
		},
	},
	compose: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.compose = parseEnum(CompositeOperator, value, "compose");
		}),
	},
	debug: { arity: 1, run: () => undefined },
	define: {
		arity: 1,
		plusArity: 1,
		run: (run, [value], plus) => {
			const [key, ...rest] = (value as string).split("=");
			if (plus) run.settings.defines.delete(key as string);
			else run.settings.defines.set(key as string, rest.join("=") || "true");
		},
	},
	delay: {
		arity: 1,
		run: (run, [value]) => {
			const [delay = 0, ticks] = parseNumbers(value as string, "-delay");
			run.settings.delay = delay;
			for (const image of run.images) {
				image.animationDelay = delay;
				if (ticks) image.animationTicksPerSecond = ticks;
			}
		},
	},
	density: {
		arity: 1,
		run: (run, [value]) => {
			const [x = 72, y = x] = parseNumbers(value as string, "-density");
			const density = new Density(x, y, DensityUnit.PixelsPerInch);
			run.settings.density = density;
			for (const image of run.images) image.density = density;
		},
	},
	depth: {
		arity: 1,
		run: (run, [value]) => {
			const depth = parseNumber(value as string, "-depth");
			run.settings.depth = depth;
			for (const image of run.images) image.depth = depth;
		},
	},
	dispose: {
		arity: 1,
		run: (run, [value]) => {
			const method = parseEnum(
				GifDisposeMethod,
				value as string,
				"dispose",
				DISPOSE_ALIASES,
			);
			run.settings.dispose = method;
			for (const image of run.images) image.gifDisposeMethod = method;
		},
	},
	dither: {
		arity: 1,
		plusArity: 0,
		run: (run, _, plus) => {
			run.settings.dither = !plus;
		},
	},
	fill: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.fill = parseColor(value);
		}),
	},
	filter: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.filter = parseEnum(FilterType, value, "filter");
		}),
	},
	font: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.font = value;
		}),
	},
	format: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.format = value;
		}),
	},
	fuzz: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.fuzz = value.endsWith("%")
				? parsePercent(value, "-fuzz")
				: parsePercent(
						`${(parseNumber(value, "-fuzz") / Quantum.max) * 100}`,
						"-fuzz",
					);
		}),
	},
	geometry: {
		arity: 1,
		plusArity: 0,
		run: setting(
			(run, value) => {
				run.settings.geometry = value;
			},
			(run) => {
				run.settings.geometry = undefined;
			},
		),
	},
	gravity: {
		arity: 1,
		plusArity: 0,
		run: setting(
			(run, value) => {
				run.settings.gravity = parseEnum(Gravity, value, "gravity");
			},
			(run) => {
				run.settings.gravity = undefined;
			},
		),
	},
	interlace: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.interlace = parseEnum(
				Interlace,
				value,
				"interlace",
				INTERLACE_ALIASES,
			);
		}),
	},
	"interline-spacing": {
		arity: 1,
		run: setting((run, value) => {
			run.settings.interlineSpacing = parseNumber(value, "-interline-spacing");
		}),
	},
	interpolate: {
		arity: 1,
		run: (run, [value]) => {
			const method = parseEnum(
				PixelInterpolateMethod,
				value as string,
				"interpolate",
			);
			for (const image of run.images) image.interpolate = method;
		},
	},
	kerning: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.kerning = parseNumber(value, "-kerning");
		}),
	},
	label: {
		arity: 1,
		run: (run, [value]) => {
			run.settings.label = value;
			for (const image of run.images)
				image.label = run.formatText(image, value as string);
		},
	},
	limit: { arity: 2, run: () => undefined },
	loop: {
		arity: 1,
		run: (run, [value]) => {
			const loop = parseNumber(value as string, "-loop");
			run.settings.loop = loop;
			for (const image of run.images) image.animationIterations = loop;
		},
	},
	monitor: { arity: 0, run: () => undefined },
	ping: { arity: 0, run: () => undefined },
	pointsize: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.pointsize = parseNumber(value, "-pointsize");
		}),
	},
	precision: { arity: 1, run: () => undefined },
	quality: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.quality = parseNumber(value, "-quality");
		}),
	},
	quiet: { arity: 0, run: () => undefined },
	"regard-warnings": { arity: 0, run: () => undefined },
	"respect-parentheses": { arity: 0, run: () => undefined },
	"sampling-factor": {
		arity: 1,
		run: setting((run, value) => {
			run.settings.defines.set("jpeg:sampling-factor", value);
		}),
	},
	seed: {
		arity: 1,
		run: setting((_, value) => {
			Magick.setRandomSeed(parseNumber(value, "-seed"));
		}),
	},
	size: {
		arity: 1,
		run: setting((run, value) => {
			const [width = 0, height = width] = parseNumbers(value, "-size");
			run.settings.size = { width, height };
		}),
	},
	stroke: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.stroke = parseColor(value);
		}),
	},
	strokewidth: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.strokeWidth = parseNumber(value, "-strokewidth");
		}),
	},
	identify: {
		arity: 0,
		run: (run) => {
			run.images.forEach((image, index, images) => {
				run.print(`${run.identifyLine(image, index, images.length)}\n`);
			});
		},
	},
	print: {
		arity: 1,
		run: (run, [text]) => {
			const first = run.images[0];
			run.print(
				first ? run.formatText(first, text as string) : (text as string),
			);
		},
	},
	treedepth: { arity: 1, run: () => undefined },
	write: {
		arity: 1,
		run: (run, [target]) => run.write(target as string, run.images),
	},
	undercolor: {
		arity: 1,
		run: setting((run, value) => {
			run.settings.undercolor = parseColor(value);
		}),
	},
	units: {
		arity: 1,
		run: (run, [value]) => {
			const units = /centimet/i.test(value as string)
				? DensityUnit.PixelsPerCentimeter
				: DensityUnit.PixelsPerInch;
			for (const image of run.images) {
				image.density = new Density(image.density.x, image.density.y, units);
			}
		},
	},
	verbose: {
		arity: 0,
		plusArity: 0,
		run: (run, _, plus) => {
			run.settings.verbose = !plus;
		},
	},
	"virtual-pixel": {
		arity: 1,
		run: (run, [value]) => {
			const method = parseEnum(
				VirtualPixelMethod,
				value as string,
				"virtual-pixel",
			);
			for (const image of run.images) image.virtualPixelMethod = method;
		},
	},

	// --- operators: every image in the list -----------------------------------
	"adaptive-blur": {
		arity: 1,
		run: each((image, [value]) => {
			const { radius, sigma } = radiusSigma(value as string, "-adaptive-blur");
			image.adaptiveBlur(radius, sigma);
		}),
	},
	"adaptive-resize": {
		arity: 1,
		run: each((image, [value]) =>
			image.adaptiveResize(parseGeometry(value as string, "-adaptive-resize")),
		),
	},
	"adaptive-sharpen": {
		arity: 1,
		run: each((image, [value]) => {
			const { radius, sigma } = radiusSigma(
				value as string,
				"-adaptive-sharpen",
			);
			image.adaptiveSharpen(radius, sigma);
		}),
	},
	alpha: {
		arity: 1,
		run: each((image, [value], run) => {
			const action = parseEnum(AlphaAction, value as string, "alpha");
			if (run.settings.background)
				image.backgroundColor = run.settings.background;
			image.alpha(action);
		}),
	},
	annotate: {
		arity: 2,
		run: each((image, [geometry, text], run) => {
			const { angle, x, y } = annotateGeometry(geometry as string);
			run.applyTextSettings(image);
			image.annotate(
				text as string,
				parseGeometry(`+${x}+${y}`.replace("+-", "-"), "-annotate"),
				run.settings.gravity ?? Gravity.Northwest,
				angle,
			);
		}),
	},
	"auto-gamma": { arity: 0, run: each((image) => image.autoGamma()) },
	"auto-level": { arity: 0, run: each((image) => image.autoLevel()) },
	"auto-orient": { arity: 0, run: each((image) => image.autoOrient()) },
	"black-threshold": {
		arity: 1,
		run: each((image, [value], run) =>
			image.blackThreshold(
				parsePercent(value as string, "-black-threshold"),
				run.settings.channels ?? Channels.Composite,
			),
		),
	},
	blur: {
		arity: 1,
		run: each((image, [value], run) => {
			const { radius, sigma } = radiusSigma(value as string, "-blur");
			image.blur(radius, sigma, run.settings.channels ?? Channels.Composite);
		}),
	},
	border: {
		arity: 1,
		run: each((image, [value], run) => {
			const [width = 0, height = width] = parseNumbers(
				value as string,
				"-border",
			);
			if (run.settings.borderColor)
				image.borderColor = run.settings.borderColor;
			image.border(width, height);
		}),
	},
	"brightness-contrast": {
		arity: 1,
		run: each((image, [value]) => {
			const [brightness = 0, contrast = 0] = parseNumbers(
				value as string,
				"-brightness-contrast",
			);
			image.brightnessContrast(
				parsePercent(`${brightness}`, "-brightness-contrast"),
				parsePercent(`${contrast}`, "-brightness-contrast"),
			);
		}),
	},
	charcoal: {
		arity: 1,
		run: each((image, [value]) =>
			image.charcoal(0, parseNumber(value as string, "-charcoal")),
		),
	},
	chop: {
		arity: 1,
		run: each((image, [value]) =>
			image.chop(parseGeometry(value as string, "-chop")),
		),
	},
	clahe: {
		arity: 1,
		run: each((image, [value]) => {
			const [width = 8, height = width, bins = 128, clip = 3] = (
				value as string
			)
				.split(/[x+%]/)
				.filter(Boolean)
				.map((part) => parseNumber(part, "-clahe"));
			image.clahe(width, height, bins, clip);
		}),
	},
	colors: {
		arity: 1,
		run: each((image, [value], run) => {
			const settings = new QuantizeSettings();
			settings.colors = parseNumber(value as string, "-colors");
			if (!run.settings.dither) settings.ditherMethod = 0 as never;
			image.quantize(settings);
		}),
	},
	colorspace: {
		arity: 1,
		run: each((image, [value]) => {
			image.colorSpace = parseEnum(ColorSpace, value as string, "colorspace");
		}),
	},
	contrast: {
		arity: 0,
		plusArity: 0,
		run: (run, _, plus) => {
			for (const image of run.images) {
				if (plus) image.inverseContrast();
				else image.contrast();
			}
		},
	},
	"contrast-stretch": {
		arity: 1,
		run: each((image, [value]) => {
			const [black = 0, white] = parseNumbers(
				value as string,
				"-contrast-stretch",
			);
			if (white === undefined)
				image.contrastStretch(parsePercent(`${black}`, "-contrast-stretch"));
			else
				image.contrastStretch(
					parsePercent(`${black}`, "-contrast-stretch"),
					parsePercent(`${white}`, "-contrast-stretch"),
				);
		}),
	},
	crop: {
		arity: 1,
		run: (run, [value]) => {
			const geometry = parseGeometry(value as string, "-crop");
			const gravity = run.settings.gravity;
			run.images = run.images.flatMap((image) => {
				if (hasOffset(value as string) || gravity !== undefined) {
					if (gravity !== undefined) image.crop(geometry, gravity);
					else image.crop(geometry);
					return [image];
				}
				// A size alone cuts the image into tiles of that size.
				const tiles = image.cropToTiles(geometry, takeAll);
				image.dispose();
				return tiles;
			});
		},
	},
	deskew: {
		arity: 1,
		run: each((image, [value]) => {
			image.deskew(parsePercent(value as string, "-deskew"));
		}),
	},
	distort: {
		arity: 2,
		plusArity: 2,
		run: (run, [method, values], plus) => {
			const settings = new DistortSettings(
				parseEnum(DistortMethod, method as string, "distort", DISTORT_ALIASES),
			);
			settings.bestFit = plus;
			const numbers = (values as string)
				.split(/[\s,]+/)
				.filter(Boolean)
				.map((part) => parseNumber(part, "-distort"));
			for (const image of run.images) {
				if (run.settings.background)
					image.backgroundColor = run.settings.background;
				image.distort(settings, numbers);
			}
		},
	},
	draw: { arity: 1, run: each(draw) },
	evaluate: {
		arity: 2,
		run: each((image, [operator, value], run) => {
			const op = parseEnum(EvaluateOperator, operator as string, "evaluate");
			const channels = run.settings.channels ?? Channels.All;
			if ((value as string).endsWith("%"))
				image.evaluate(
					channels,
					op,
					parsePercent(value as string, "-evaluate"),
				);
			else
				image.evaluate(channels, op, parseNumber(value as string, "-evaluate"));
		}),
	},
	extent: {
		arity: 1,
		run: each((image, [value], run) => {
			const geometry = parseGeometry(value as string, "-extent");
			const gravity = run.settings.gravity ?? Gravity.Northwest;
			if (run.settings.background)
				image.extent(geometry, gravity, run.settings.background);
			else image.extent(geometry, gravity);
		}),
	},
	flip: { arity: 0, run: each((image) => image.flip()) },
	flop: { arity: 0, run: each((image) => image.flop()) },
	gamma: {
		arity: 1,
		run: each((image, [value], run) =>
			image.gammaCorrect(
				parseNumber(value as string, "-gamma"),
				run.settings.channels ?? Channels.Composite,
			),
		),
	},
	"gaussian-blur": {
		arity: 1,
		run: each((image, [value], run) => {
			const { radius, sigma } = radiusSigma(value as string, "-gaussian-blur");
			image.gaussianBlur(
				radius,
				sigma,
				run.settings.channels ?? Channels.Composite,
			);
		}),
	},
	grayscale: {
		arity: 1,
		run: each((image, [value]) =>
			image.grayscale(
				parseEnum(PixelIntensityMethod, value as string, "intensity"),
			),
		),
	},
	level: {
		arity: 1,
		plusArity: 1,
		run: (run, [value], plus) => {
			const [black, white, gamma] = (value as string).split(/[,x]/);
			const low = levelPercent(black, 0, "-level");
			const high = levelPercent(white, 100, "-level");
			const g = gamma ? parseNumber(gamma, "-level") : 1;
			const channels = run.settings.channels ?? Channels.Composite;
			for (const image of run.images) {
				if (plus) image.inverseLevel(low, high, g, channels);
				else image.level(low, high, g, channels);
			}
		},
	},
	"linear-stretch": {
		arity: 1,
		run: each((image, [value]) => {
			const [black = 0, white = 0] = parseNumbers(
				value as string,
				"-linear-stretch",
			);
			image.linearStretch(
				parsePercent(`${black}`, "-linear-stretch"),
				parsePercent(`${white}`, "-linear-stretch"),
			);
		}),
	},
	"liquid-rescale": {
		arity: 1,
		run: each((image, [value]) =>
			image.liquidRescale(parseGeometry(value as string, "-liquid-rescale")),
		),
	},
	modulate: {
		arity: 1,
		run: each((image, [value]) => {
			const [brightness = 100, saturation = 100, hue = 100] = parseNumbers(
				value as string,
				"-modulate",
			);
			image.modulate(
				parsePercent(`${brightness}`, "-modulate"),
				parsePercent(`${saturation}`, "-modulate"),
				parsePercent(`${hue}`, "-modulate"),
			);
		}),
	},
	monochrome: {
		arity: 0,
		run: each((image) => {
			image.colorType = ColorType.Bilevel;
		}),
	},
	"motion-blur": {
		arity: 1,
		run: each((image, [value]) => {
			const [radius = 0, sigma = 1, angle = 0] = (value as string)
				.split(/[x+]/)
				.filter(Boolean)
				.map((part) => parseNumber(part, "-motion-blur"));
			image.motionBlur(radius, sigma, angle);
		}),
	},
	negate: {
		arity: 0,
		plusArity: 0,
		run: (run, _, plus) => {
			for (const image of run.images) {
				if (plus) image.negateGrayScale();
				else image.negate();
			}
		},
	},
	noise: {
		arity: 1,
		plusArity: 1,
		run: (run, [value], plus) => {
			if (!plus) {
				throw new MagickUsageError(
					"-noise radius (a median filter) is not available here; +noise Type adds noise",
				);
			}
			const type = parseEnum(
				NoiseType,
				value as string,
				"noise",
				NOISE_ALIASES,
			);
			for (const image of run.images) {
				if (run.settings.attenuate !== undefined)
					image.addNoise(type, run.settings.attenuate);
				else image.addNoise(type);
			}
		},
	},
	normalize: { arity: 0, run: each((image) => image.normalize()) },
	opaque: {
		arity: 1,
		plusArity: 1,
		run: (run, [value], plus) => {
			const target = parseColor(value as string);
			const fill = run.settings.fill ?? parseColor("black");
			for (const image of run.images) {
				if (run.settings.fuzz) image.colorFuzz = run.settings.fuzz;
				if (plus) image.inverseOpaque(target, fill);
				else image.opaque(target, fill);
			}
		},
	},
	paint: {
		arity: 1,
		run: each((image, [value]) =>
			image.oilPaint(parseNumber(value as string, "-paint")),
		),
	},
	profile: {
		arity: 1,
		plusArity: 1,
		run: (run, [name], plus) => {
			if (!plus) {
				throw new MagickUsageError(
					"applying an ICC profile is not available here; +profile name removes one, -strip removes them all",
				);
			}
			for (const image of run.images) {
				const names = name === "*" ? [...image.profileNames] : [name as string];
				for (const profile of names) image.removeProfile(profile);
			}
		},
	},
	repage: {
		arity: 1,
		plusArity: 0,
		run: (run, [value], plus) => {
			for (const image of run.images) {
				if (plus) image.resetPage();
				else image.page = parseGeometry(value as string, "-repage");
			}
		},
	},
	resize: { arity: 1, run: each(resizeWith()) },
	roll: {
		arity: 1,
		run: each((image, [value]) => {
			const geometry = parseGeometry(value as string, "-roll");
			image.roll(geometry.x, geometry.y);
		}),
	},
	rotate: {
		arity: 1,
		run: each((image, [value], run) => {
			const match = /^(-?[\d.]+)([<>])?$/.exec(value as string);
			if (!match)
				throw new MagickUsageError(
					`invalid argument for option '-rotate': ${value}`,
				);
			if (match[2] === ">" && image.width <= image.height) return;
			if (match[2] === "<" && image.width >= image.height) return;
			if (run.settings.background)
				image.backgroundColor = run.settings.background;
			image.rotate(Number(match[1]));
		}),
	},
	sample: { arity: 1, run: each(resizeWith(FilterType.Point)) },
	scale: { arity: 1, run: each(resizeWith(FilterType.Box)) },
	"sepia-tone": {
		arity: 1,
		run: each((image, [value]) =>
			image.sepiaTone(parsePercent(value as string, "-sepia-tone")),
		),
	},
	set: {
		arity: 2,
		plusArity: 1,
		run: (run, [key, value], plus) => {
			for (const image of run.images) {
				const name = (key as string).toLowerCase();
				if (plus) image.removeAttribute(key as string);
				else if (name === "comment")
					image.comment = run.formatText(image, value as string);
				else if (name === "label")
					image.label = run.formatText(image, value as string);
				else
					image.setAttribute(
						key as string,
						run.formatText(image, value as string),
					);
			}
		},
	},
	sharpen: {
		arity: 1,
		run: each((image, [value], run) => {
			const { radius, sigma } = radiusSigma(value as string, "-sharpen");
			image.sharpen(radius, sigma, run.settings.channels ?? Channels.Composite);
		}),
	},
	shave: {
		arity: 1,
		run: each((image, [value]) => {
			const [width = 0, height = width] = parseNumbers(
				value as string,
				"-shave",
			);
			image.shave(width, height);
		}),
	},
	"sigmoidal-contrast": {
		arity: 1,
		plusArity: 1,
		run: (run, [value], plus) => {
			const [contrast = 3, midpoint = 50] = parseNumbers(
				value as string,
				"-sigmoidal-contrast",
			);
			for (const image of run.images) {
				const middle = parsePercent(`${midpoint}`, "-sigmoidal-contrast");
				if (plus) image.inverseSigmoidalContrast(contrast, middle);
				else image.sigmoidalContrast(contrast, middle);
			}
		},
	},
	solarize: { arity: 1, run: each((image) => image.solarize()) },
	splice: {
		arity: 1,
		run: each((image, [value], run) => {
			if (run.settings.background)
				image.backgroundColor = run.settings.background;
			const geometry = parseGeometry(value as string, "-splice");
			if (run.settings.gravity !== undefined)
				image.splice(geometry, run.settings.gravity);
			else image.splice(geometry);
		}),
	},
	strip: { arity: 0, run: each((image) => image.strip()) },
	threshold: {
		arity: 1,
		run: each((image, [value], run) =>
			image.threshold(
				parsePercent(value as string, "-threshold"),
				run.settings.channels ?? Channels.Composite,
			),
		),
	},
	thumbnail: {
		arity: 1,
		run: each((image, [value]) =>
			image.thumbnail(parseGeometry(value as string, "-thumbnail")),
		),
	},
	transparent: {
		arity: 1,
		plusArity: 1,
		run: (run, [value], plus) => {
			const color = parseColor(value as string);
			for (const image of run.images) {
				if (run.settings.fuzz) image.colorFuzz = run.settings.fuzz;
				if (plus) image.inverseTransparent(color);
				else image.transparent(color);
			}
		},
	},
	transpose: {
		arity: 0,
		run: each((image) => {
			image.rotate(90);
			image.flop();
		}),
	},
	transverse: {
		arity: 0,
		run: each((image) => {
			image.rotate(90);
			image.flip();
		}),
	},
	trim: {
		arity: 0,
		run: each((image, _, run) => {
			if (run.settings.fuzz) image.colorFuzz = run.settings.fuzz;
			image.trim();
		}),
	},
	type: {
		arity: 1,
		run: each((image, [value]) => {
			image.colorType = parseEnum(
				ColorType,
				value as string,
				"type",
				TYPE_ALIASES,
			);
		}),
	},
	vignette: {
		arity: 1,
		run: each((image, [value], run) => {
			const [radius = 0, sigma = 1, x = 0, y = 0] = (value as string)
				.split(/[x+]/)
				.filter(Boolean)
				.map((part) => parseNumber(part, "-vignette"));
			if (run.settings.background)
				image.backgroundColor = run.settings.background;
			image.vignette(radius, sigma, x, y);
		}),
	},
	wave: {
		arity: 1,
		run: each((image, [value]) => {
			const [amplitude = 25, length = 150] = parseNumbers(
				value as string,
				"-wave",
			);
			image.wave(image.interpolate, amplitude, length);
		}),
	},
	"white-threshold": {
		arity: 1,
		run: each((image, [value], run) =>
			image.whiteThreshold(
				parsePercent(value as string, "-white-threshold"),
				run.settings.channels ?? Channels.Composite,
			),
		),
	},

	// --- list operators: the list as a whole ----------------------------------
	append: {
		arity: 0,
		plusArity: 0,
		run: (run, _, plus) => {
			firstBackground(run);
			reduceList(run, (images) =>
				withCollection(images, (collection) =>
					plus
						? collection.appendHorizontally(keepCopy)
						: collection.appendVertically(keepCopy),
				),
			);
		},
	},
	clone: {
		arity: 1,
		plusArity: 0,
		run: (run, [value], plus) => {
			// Inside parentheses, clones come from the list outside them.
			const images = run.outerImages;
			const picked = plus
				? images.slice(-1)
				: pickIndexes(value as string, images.length, "-clone").map(
						(index) => images[index] as IMagickImage,
					);
			run.images = [...run.images, ...picked.map(keepCopy)];
		},
	},
	coalesce: {
		arity: 0,
		run: (run) => transformList(run, (list) => list.coalesce()),
	},
	combine: {
		arity: 0,
		plusArity: 1,
		run: (run, [value], plus) =>
			reduceList(run, (images) =>
				withCollection(images, (collection) =>
					plus
						? collection.combine(
								parseEnum(ColorSpace, value as string, "colorspace"),
								keepCopy,
							)
						: collection.combine(keepCopy),
				),
			),
	},
	composite: {
		arity: 0,
		run: (run) => {
			const [destination, source, ...rest] = run.images;
			if (!destination || !source) {
				throw new MagickUsageError(
					"-composite needs two images: the base, then what goes over it",
				);
			}
			const { settings } = run;
			const geometry = settings.geometry
				? parseGeometry(settings.geometry, "-geometry")
				: null;
			// "100x100+10+20" sizes the overlay too; "+10+20" only places it.
			if (geometry && /^(\d|x\d)/.test(settings.geometry ?? ""))
				source.resize(geometry);
			const point = new Point(geometry?.x ?? 0, geometry?.y ?? 0);
			const args = settings.defines.get("compose:args");
			allowColor(destination, source);
			if (args !== undefined) {
				destination.compositeGravity(
					source,
					settings.gravity ?? Gravity.Northwest,
					settings.compose,
					point,
					args,
				);
			} else {
				destination.compositeGravity(
					source,
					settings.gravity ?? Gravity.Northwest,
					settings.compose,
					point,
				);
			}
			source.dispose();
			run.images = [destination, ...rest];
		},
	},
	deconstruct: {
		arity: 0,
		run: (run) => transformList(run, (list) => list.deconstruct()),
	},
	delete: {
		arity: 1,
		plusArity: 0,
		run: (run, [value], plus) => {
			const images = run.images;
			const doomed = new Set(
				plus
					? [images.length - 1]
					: pickIndexes(value as string, images.length, "-delete"),
			);
			run.images = images.filter((image, index) => {
				if (doomed.has(index)) image.dispose();
				return !doomed.has(index);
			});
		},
	},
	duplicate: {
		arity: 1,
		plusArity: 0,
		run: (run, [value], plus) => {
			const images = run.images;
			const [countText = "1", which] = plus
				? ["1"]
				: (value as string).split(",");
			const count = parseNumber(countText, "-duplicate");
			const picked = which
				? pickIndexes(which, images.length, "-duplicate").map(
						(index) => images[index] as IMagickImage,
					)
				: images.slice(-1);
			const copies: IMagickImage[] = [];
			for (let round = 0; round < count; round += 1)
				copies.push(...picked.map(keepCopy));
			run.images = [...images, ...copies];
		},
	},
	"evaluate-sequence": {
		arity: 1,
		run: (run, [value]) =>
			reduceList(run, (images) =>
				withCollection(images, (collection) =>
					collection.evaluate(
						parseEnum(EvaluateOperator, value as string, "evaluate"),
						keepCopy,
					),
				),
			),
	},
	flatten: {
		arity: 0,
		run: (run) => {
			firstBackground(run);
			reduceList(run, (images) =>
				withCollection(images, (collection) => collection.flatten(keepCopy)),
			);
		},
	},
	fx: {
		arity: 1,
		run: (run, [value]) =>
			reduceList(run, (images) =>
				withCollection(images, (collection) =>
					run.settings.channels !== undefined
						? collection.fx(value as string, run.settings.channels, keepCopy)
						: collection.fx(value as string, keepCopy),
				),
			),
	},
	insert: {
		arity: 1,
		plusArity: 0,
		run: (run, [value], plus) => {
			const images = [...run.images];
			const last = images.pop();
			if (!last) return;
			const at = plus ? 0 : parseNumber(value as string, "-insert");
			images.splice(at < 0 ? images.length + at + 1 : at, 0, last);
			run.images = images;
		},
	},
	layers: {
		arity: 1,
		run: (run, [value]) => {
			const method = (value as string).toLowerCase().replace(/[^a-z]/g, "");
			if (method === "coalesce") transformList(run, (list) => list.coalesce());
			else if (method === "optimize" || method === "optimizeframe")
				transformList(run, (list) => list.optimize());
			else if (method === "optimizeplus")
				transformList(run, (list) => list.optimizePlus());
			else if (method === "optimizetransparency")
				transformList(run, (list) => list.optimizeTransparency());
			else if (method === "trimbounds")
				transformList(run, (list) => list.trimBounds());
			else if (method === "flatten")
				MAGICK_OPTIONS.flatten?.run(run, [], false);
			else if (method === "mosaic") MAGICK_OPTIONS.mosaic?.run(run, [], false);
			else if (method === "merge") {
				firstBackground(run);
				reduceList(run, (images) =>
					withCollection(images, (collection) => collection.merge(keepCopy)),
				);
			} else {
				throw new MagickUsageError(
					`-layers ${value} is not available here; use coalesce, optimize, optimize-plus, optimize-transparency, trim-bounds, merge, flatten or mosaic`,
				);
			}
		},
	},
	morph: {
		arity: 1,
		run: (run, [value]) =>
			transformList(run, (list) =>
				list.morph(parseNumber(value as string, "-morph")),
			),
	},
	mosaic: {
		arity: 0,
		run: (run) => {
			firstBackground(run);
			reduceList(run, (images) =>
				withCollection(images, (collection) => collection.mosaic(keepCopy)),
			);
		},
	},
	reverse: {
		arity: 0,
		run: (run) => {
			run.images = [...run.images].reverse();
		},
	},
	separate: {
		arity: 0,
		run: (run) => {
			run.images = run.images.flatMap((image) => {
				const parts =
					run.settings.channels !== undefined
						? image.separate(run.settings.channels, takeAll)
						: image.separate(takeAll);
				image.dispose();
				return parts;
			});
		},
	},
	smush: {
		arity: 1,
		plusArity: 1,
		run: (run, [value], plus) => {
			const offset = parseNumber(value as string, "-smush");
			firstBackground(run);
			reduceList(run, (images) =>
				withCollection(images, (collection) =>
					plus
						? collection.smushHorizontal(offset, keepCopy)
						: collection.smushVertical(offset, keepCopy),
				),
			);
		},
	},
	swap: {
		arity: 1,
		plusArity: 0,
		run: (run, [value], plus) => {
			const images = [...run.images];
			const [first, second] = plus
				? [images.length - 2, images.length - 1]
				: (value as string).split(",").map((part) => {
						const index = parseNumber(part, "-swap");
						return index < 0 ? images.length + index : index;
					});
			if (
				first === undefined ||
				second === undefined ||
				!images[first] ||
				!images[second]
			) {
				throw new MagickUsageError("-swap needs two images in the list");
			}
			[images[first], images[second]] = [
				images[second] as IMagickImage,
				images[first] as IMagickImage,
			];
			run.images = images;
		},
	},
};
