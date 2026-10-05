import {
	type Channels,
	Channels as ChannelFlags,
	CompositeOperator,
	ConfigurationFiles,
	type Density,
	type FilterType,
	type GifDisposeMethod,
	type Gravity,
	type IMagickFormatInfo,
	type IMagickImage,
	type IMagickImageCollection,
	type Interlace,
	initializeImageMagick,
	Magick,
	MagickColor,
	MagickFormat,
	MagickGeometry,
	MagickImage,
	MagickImageCollection,
	MagickReadSettings,
	Percentage,
} from "@imagemagick/magick-wasm";
import { resolvePath } from "../host-commands/command-line";

/**
 * What one `magick` run works with: ImageMagick (magick-wasm) on the files
 * the host sent, by absolute path, with what the run writes kept apart. The
 * image list, the settings that carry from option to option, and reading and
 * writing as the ImageMagick command line does them.
 */

/** The fonts shipped with the tools, by the name they are registered under. */
export const MAGICK_FONTS = {
	regular: "LiberationSans",
	bold: "LiberationSans-Bold",
} as const;

/** A wrong command line: said on stderr as ImageMagick says it, exit code 1. */
export class MagickUsageError extends Error {}

const MVG_BLOCKED = /\s*<policy domain="coder" rights="none" pattern="MVG" \/>/;

/**
 * Loads ImageMagick once per worker. Its default policy blocks MVG, which
 * `-draw` renders through; nothing else is opened up (MSL, `@file` and `|cmd`
 * stay blocked), and the worker has no files besides the fonts.
 */
export const initializeMagick = async (
	wasm: Uint8Array,
	fonts: Readonly<Record<string, Uint8Array>>,
): Promise<void> => {
	const configuration = ConfigurationFiles.default;
	configuration.policy.data = configuration.policy.data.replace(
		MVG_BLOCKED,
		"",
	);
	await initializeImageMagick(wasm, configuration);
	for (const [name, data] of Object.entries(fonts)) Magick.addFont(name, data);
};

const encoder = new TextEncoder();

// --- values -----------------------------------------------------------------

const fail = (option: string, value: string): never => {
	throw new MagickUsageError(
		`invalid argument for option '${option}': ${value}`,
	);
};

export const parseNumber = (value: string, option: string): number => {
	const number = Number(value);
	return Number.isFinite(number) && value.trim() !== ""
		? number
		: fail(option, value);
};

/** "50%" or "50" as a percentage. */
export const parsePercent = (value: string, option: string): Percentage =>
	new Percentage(parseNumber(value.replace(/%$/, ""), option));

/** "10x20", "10,20" or "10": the numbers, in order. */
export const parseNumbers = (value: string, option: string): number[] =>
	value
		.replace(/%/g, "")
		.split(/[x,/]/i)
		.filter((part) => part !== "")
		.map((part) => parseNumber(part, option));

export const parseGeometry = (
	value: string,
	option: string,
): MagickGeometry => {
	try {
		return new MagickGeometry(value);
	} catch {
		return fail(option, value);
	}
};

/** Whether a geometry names an offset (+10+20), not only a size. */
export const hasOffset = (value: string): boolean => /[+-]\d/.test(value);

export const parseColor = (value: string): MagickColor => {
	try {
		return new MagickColor(value);
	} catch {
		throw new MagickUsageError(`unrecognized color '${value}'`);
	}
};

const enumKey = (value: string) =>
	value.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * A value of one of magick-wasm's enums by ImageMagick's name for it, any
 * case, dashes ignored ("src-over", "sRGB", "NorthWest"); `aliases` adds the
 * command line's other names ("SRT", "AE").
 */
export const parseEnum = <T extends Record<string, number>>(
	table: T,
	value: string,
	kind: string,
	aliases: Readonly<Record<string, keyof T>> = {},
): T[keyof T] => {
	const key = enumKey(value);
	const alias = Object.entries(aliases).find(
		([name]) => enumKey(name) === key,
	)?.[1];
	if (alias !== undefined) return table[alias] as T[keyof T];
	const found = Object.entries(table).find(
		([name, entry]) => enumKey(name) === key && entry !== 0,
	);
	if (found) return found[1] as T[keyof T];
	if (key === "undefined") return 0 as T[keyof T];
	throw new MagickUsageError(`unrecognized ${kind} type '${value}'`);
};

const CHANNEL_LETTERS: Record<string, number> = {
	r: ChannelFlags.Red,
	g: ChannelFlags.Green,
	b: ChannelFlags.Blue,
	a: ChannelFlags.Alpha,
	o: ChannelFlags.Alpha,
	c: ChannelFlags.Cyan,
	m: ChannelFlags.Magenta,
	y: ChannelFlags.Yellow,
	k: ChannelFlags.Black,
};

/** `-channel` values: a name ("alpha", "RGB", "All") or letters ("RGBA", "R,G"). */
export const parseChannels = (value: string): Channels => {
	const key = enumKey(value);
	const named = Object.entries(ChannelFlags).find(
		([name]) => enumKey(name) === key,
	);
	if (named) return named[1] as Channels;
	let flags = 0;
	for (const part of value.toLowerCase().split(/[,\s]*/)) {
		const flag = CHANNEL_LETTERS[part];
		if (flag === undefined) {
			throw new MagickUsageError(`unrecognized channel type '${value}'`);
		}
		flags |= flag;
	}
	return flags as Channels;
};

// --- formats ----------------------------------------------------------------

let formats: Map<string, IMagickFormatInfo> | null = null;

/** Extensions ImageMagick knows under another format name. */
const FORMAT_ALIASES: Record<string, string> = {
	JPE: "JPEG",
	TIF: "TIFF",
	HTM: "HTML",
	YML: "YAML",
};

/** A format by its name or a file extension ("png", "jpg", "tif"). */
export const formatInfo = (name: string): IMagickFormatInfo | undefined => {
	formats ??= new Map(
		Magick.supportedFormats.map((info) => [info.format.toUpperCase(), info]),
	);
	const key = name.toUpperCase();
	return formats.get(key) ?? formats.get(FORMAT_ALIASES[key] ?? "");
};

export const supportedFormats = (): readonly IMagickFormatInfo[] =>
	Magick.supportedFormats;

/** Names read as images ImageMagick makes ("xc:red", "label:Hi"), not files. */
const PSEUDO_IMAGES = new Set([
	"canvas",
	"caption",
	"fractal",
	"gradient",
	"granite",
	"hald",
	"label",
	"logo",
	"netscape",
	"pattern",
	"plasma",
	"radial-gradient",
	"rose",
	"wizard",
	"xc",
]);

/** A leading "png:" or "xc:" on a file name; null for a plain path. */
const splitPrefix = (spec: string): { prefix: string; rest: string } | null => {
	const match = /^([A-Za-z][A-Za-z0-9-]*):(.*)$/s.exec(spec);
	return match
		? { prefix: match[1] as string, rest: match[2] as string }
		: null;
};

// --- the run ----------------------------------------------------------------

export interface MagickSettings {
	size?: { width: number; height: number };
	density?: Density;
	background?: MagickColor;
	borderColor?: MagickColor;
	fill?: MagickColor;
	stroke?: MagickColor;
	strokeWidth?: number;
	font?: string;
	pointsize?: number;
	kerning?: number;
	interlineSpacing?: number;
	undercolor?: MagickColor;
	gravity?: Gravity;
	compose: CompositeOperator;
	fuzz?: Percentage;
	quality?: number;
	delay?: number;
	loop?: number;
	dispose?: GifDisposeMethod;
	/** `-geometry`: where -composite puts the overlay, and its size. */
	geometry?: string;
	filter?: FilterType;
	interlace?: Interlace;
	defines: Map<string, string>;
	label?: string;
	comment?: string;
	/** `-format`: what `info:` and identify print. */
	format?: string;
	adjoin: boolean;
	antialias: boolean;
	dither: boolean;
	channels?: Channels;
	depth?: number;
	verbose: boolean;
	attenuate?: number;
}

const GLOB = /[*?]/;

const globToRegExp = (pattern: string): RegExp =>
	new RegExp(
		`^${pattern
			.split("")
			.map((char) =>
				char === "*"
					? "[^/]*"
					: char === "?"
						? "[^/]"
						: char.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
			)
			.join("")}$`,
	);

export class MagickRun {
	readonly files: Map<string, Uint8Array>;
	readonly written = new Map<string, Uint8Array>();
	readonly settings: MagickSettings = {
		compose: CompositeOperator.Over,
		defines: new Map(),
		adjoin: true,
		antialias: true,
		dither: true,
		verbose: false,
	};
	private stack: IMagickImage[][] = [[]];
	/** Where each image came from, for %f, %d, %e and %t. */
	private readonly sources = new WeakMap<IMagickImage, string>();
	private readonly stdoutParts: Uint8Array[] = [];
	private readonly stderrParts: string[] = [];
	private readonly userFonts = new Map<string, string>();
	private warnedFont = false;

	constructor(
		readonly cwd: string,
		files: ReadonlyMap<string, Uint8Array>,
		readonly stdin?: Uint8Array,
	) {
		this.files = new Map(files);
	}

	/** The image list options work on: the innermost parenthesis. */
	get images(): IMagickImage[] {
		return this.stack[this.stack.length - 1] as IMagickImage[];
	}

	set images(images: IMagickImage[]) {
		this.stack[this.stack.length - 1] = images;
	}

	/** The list around the current parenthesis (the current list outside any). */
	get outerImages(): IMagickImage[] {
		return (this.stack[this.stack.length - 2] ?? this.images) as IMagickImage[];
	}

	openParenthesis(): void {
		this.stack.push([]);
	}

	closeParenthesis(): void {
		if (this.stack.length < 2) {
			throw new MagickUsageError("unbalanced parenthesis");
		}
		const inner = this.stack.pop() as IMagickImage[];
		this.images.push(...inner);
	}

	get balanced(): boolean {
		return this.stack.length === 1;
	}

	dispose(): void {
		for (const images of this.stack) {
			for (const image of images) image.dispose();
		}
		this.stack = [[]];
	}

	print(text: string | Uint8Array): void {
		this.stdoutParts.push(
			typeof text === "string" ? encoder.encode(text) : text,
		);
	}

	warn(text: string): void {
		this.stderrParts.push(`${text}\n`);
	}

	get stdout(): Uint8Array {
		const size = this.stdoutParts.reduce((sum, part) => sum + part.length, 0);
		const out = new Uint8Array(size);
		let offset = 0;
		for (const part of this.stdoutParts) {
			out.set(part, offset);
			offset += part.length;
		}
		return out;
	}

	get stderr(): string {
		return this.stderrParts.join("");
	}

	resolve(path: string): string {
		return resolvePath(this.cwd, path);
	}

	sourceOf(image: IMagickImage): string {
		return this.sources.get(image) ?? "";
	}

	/** Files matching a name with * or ?, sorted, as ImageMagick expands them. */
	expand(spec: string): string[] {
		if (!GLOB.test(spec)) return [spec];
		const absolute = this.resolve(spec);
		const pattern = globToRegExp(absolute);
		const found = [...this.files.keys()].filter((path) => pattern.test(path));
		if (!found.length) return [spec];
		// Kept relative when given relative, as the shell would print them.
		const base = spec.startsWith("/") ? "" : `${this.cwd.replace(/\/$/, "")}/`;
		return found
			.sort()
			.map((path) =>
				base && path.startsWith(base) ? path.slice(base.length) : path,
			);
	}

	// --- reading ---------------------------------------------------------------

	readSettings(format?: string): MagickReadSettings {
		const { settings } = this;
		const read = new MagickReadSettings({
			...(settings.size
				? { width: settings.size.width, height: settings.size.height }
				: {}),
			...(settings.density ? { density: settings.density } : {}),
			...(settings.background ? { backgroundColor: settings.background } : {}),
			...(settings.fill ? { fillColor: settings.fill } : {}),
			...(settings.stroke ? { strokeColor: settings.stroke } : {}),
			...(settings.strokeWidth !== undefined
				? { strokeWidth: settings.strokeWidth }
				: {}),
			...(settings.pointsize !== undefined
				? { fontPointsize: settings.pointsize }
				: {}),
			...(settings.gravity !== undefined
				? { textGravity: settings.gravity }
				: {}),
			...(format ? { format: format as MagickFormat } : {}),
		});
		read.font = this.font();
		for (const [key, value] of settings.defines) read.setDefine(key, value);
		return read;
	}

	/**
	 * Reads one name off the command line into images: a file (with an
	 * optional "png:" format and a "[0]", "[1-3]" or "[100x100]" suffix), "-"
	 * for stdin, or one ImageMagick makes ("xc:red", "label:Hi", "rose:").
	 */
	read(spec: string): IMagickImage[] {
		const prefixed = splitPrefix(spec);
		if (prefixed && PSEUDO_IMAGES.has(prefixed.prefix.toLowerCase())) {
			return this.decode(spec, spec, this.readSettings());
		}
		let name = spec;
		let format: string | undefined;
		if (prefixed && formatInfo(prefixed.prefix)) {
			format = formatInfo(prefixed.prefix)?.format;
			name = prefixed.rest;
		}
		if (name === "-") {
			if (!this.stdin?.length) {
				throw new MagickUsageError("no image data on stdin for '-'");
			}
			try {
				return this.decode(this.stdin, "-", this.readSettings(format));
			} catch {
				// A shell command's output reaches magick as text, so an image
				// piped in arrives broken.
				throw new MagickUsageError(
					"could not read an image from stdin (pipes into magick carry text here); give magick the file name instead",
				);
			}
		}

		let path = this.resolve(name);
		let subimage: string | undefined;
		const suffix = /^(.*)\[([^\]]+)\]$/.exec(name);
		if (!this.files.has(path) && suffix) {
			path = this.resolve(suffix[1] as string);
			subimage = suffix[2];
		}
		const data = this.files.get(path);
		if (!data) {
			throw new MagickUsageError(
				`unable to open image '${name}': No such file or directory`,
			);
		}
		const images = this.decode(data, path, this.readSettings(format));
		return subimage ? this.selectSubimage(images, subimage) : images;
	}

	private decode(
		source: Uint8Array | string,
		name: string,
		settings: MagickReadSettings,
	): IMagickImage[] {
		let images: IMagickImage[];
		if (typeof source === "string") {
			// One image, made by name. (A collection read by name would keep
			// the name, "xc:red", as where every later write goes.)
			images = [MagickImage.create(source, settings)];
		} else {
			const collection = MagickImageCollection.create();
			try {
				collection.read(source, settings);
			} catch (error) {
				collection.dispose();
				if (new TextDecoder().decode(source.subarray(0, 5)) === "%PDF-") {
					throw new MagickUsageError(
						`cannot read PDF '${name}' here (there is no Ghostscript); render its pages with py and pymupdf (page.get_pixmap(dpi=150).save("page1.png")) and use those`,
					);
				}
				throw error;
			}
			images = takeAll(collection);
		}
		for (const image of images) {
			this.sources.set(image, name);
			this.applyReadSettings(image);
		}
		return images;
	}

	/** Settings ImageMagick gives each image as it is read. */
	private applyReadSettings(image: IMagickImage): void {
		const { settings } = this;
		if (settings.delay !== undefined) image.animationDelay = settings.delay;
		if (settings.loop !== undefined) image.animationIterations = settings.loop;
		if (settings.dispose !== undefined) {
			image.gifDisposeMethod = settings.dispose;
		}
		if (settings.label !== undefined) {
			image.label = this.formatText(image, settings.label);
		}
		if (settings.comment !== undefined) {
			image.comment = this.formatText(image, settings.comment);
		}
	}

	private selectSubimage(
		images: IMagickImage[],
		subimage: string,
	): IMagickImage[] {
		if (/^[\d,\s-]+$/.test(subimage)) {
			const wanted = new Set<number>();
			for (const part of subimage.split(",")) {
				const [from, to] = part.split("-").map((value) => Number(value));
				for (let index = from ?? 0; index <= (to ?? from ?? 0); index += 1) {
					wanted.add(index);
				}
			}
			const kept = images.filter((_, index) => wanted.has(index));
			for (const image of images) if (!kept.includes(image)) image.dispose();
			return kept;
		}
		const geometry = parseGeometry(subimage, "[]");
		for (const image of images) {
			if (hasOffset(subimage)) image.crop(geometry);
			else image.resize(geometry);
		}
		return images;
	}

	// --- text ------------------------------------------------------------------

	/** The font to draw with: -font's file or name, else the shipped one. */
	font(): string {
		const wanted = this.settings.font;
		if (!wanted) return MAGICK_FONTS.regular;
		if (Object.values(MAGICK_FONTS).includes(wanted as never)) return wanted;
		const known = this.userFonts.get(wanted);
		if (known) return known;
		const data = this.files.get(this.resolve(wanted));
		if (data) {
			const name = `file-${this.resolve(wanted).replace(/[^\w.-]/g, "_")}`;
			Magick.addFont(name, data);
			this.userFonts.set(wanted, name);
			return name;
		}
		const fallback = /bold|black|heavy/i.test(wanted)
			? MAGICK_FONTS.bold
			: MAGICK_FONTS.regular;
		if (!this.warnedFont) {
			this.warnedFont = true;
			this.warn(
				`magick: font '${wanted}' is not installed; using ${fallback} (give -font a .ttf or .otf file to use another)`,
			);
		}
		return fallback;
	}

	/** The text settings (font, size, colors) on an image, for -annotate. */
	applyTextSettings(image: IMagickImage): void {
		const { settings } = this;
		const target = image.settings;
		target.font = this.font();
		target.textAntiAlias = settings.antialias;
		if (settings.pointsize !== undefined) {
			target.fontPointsize = settings.pointsize;
		}
		if (settings.fill) target.fillColor = settings.fill;
		if (settings.stroke) target.strokeColor = settings.stroke;
		if (settings.strokeWidth !== undefined) {
			target.strokeWidth = settings.strokeWidth;
		}
		if (settings.kerning !== undefined) target.textKerning = settings.kerning;
		if (settings.interlineSpacing !== undefined) {
			target.textInterlineSpacing = settings.interlineSpacing;
		}
		if (settings.undercolor) target.textUnderColor = settings.undercolor;
	}

	/**
	 * A -format or -label pattern for one image: ImageMagick's own escapes,
	 * with the file name ones (%f, %d, %e, %t, %i, %M) filled in here, since
	 * the image was read from memory.
	 */
	formatText(image: IMagickImage, pattern: string): string {
		const source = this.sourceOf(image);
		const slash = source.lastIndexOf("/");
		const file = source.slice(slash + 1);
		const dot = file.lastIndexOf(".");
		const names: Record<string, string> = {
			f: file,
			d: slash > 0 ? source.slice(0, slash) : slash === 0 ? "/" : "",
			e: dot > 0 ? file.slice(dot + 1) : "",
			t: dot > 0 ? file.slice(0, dot) : file,
			i: source,
			M: source,
		};
		const escaped = pattern.replace(/%(%|[fdetiM])/g, (match, key: string) =>
			key === "%" ? match : (names[key] ?? "").replace(/%/g, "%%"),
		);
		return image.formatExpression(escaped) ?? "";
	}

	/** ImageMagick's one line per image, as identify prints it. */
	identifyLine(image: IMagickImage, index: number, count: number): string {
		const name = this.sourceOf(image) || image.format;
		const frame = count > 1 ? `[${index}]` : "";
		return `${name}${frame} ${image.formatExpression("%m %wx%h %Wx%H%X%Y %z-bit %[colorspace] %b") ?? ""}`;
	}

	/** identify -verbose, abridged to what agents use. */
	describe(image: IMagickImage, index: number, count: number): string {
		const expression = (text: string) => image.formatExpression(text) ?? "";
		const info = formatInfo(image.format);
		const lines = [
			`Image: ${this.sourceOf(image) || "-"}${count > 1 ? `[${index}]` : ""}`,
			`  Format: ${image.format}${info ? ` (${info.description})` : ""}`,
			`  Mime type: ${info?.mimeType ?? ""}`,
			`  Geometry: ${expression("%wx%h%X%Y")}`,
			`  Page geometry: ${expression("%g")}`,
			`  Resolution: ${expression("%xx%y")}`,
			`  Units: ${expression("%U")}`,
			`  Colorspace: ${expression("%[colorspace]")}`,
			`  Type: ${expression("%[type]")}`,
			`  Depth: ${expression("%z")}-bit`,
			`  Alpha: ${image.hasAlpha ? "yes" : "no"}`,
			`  Colors: ${expression("%k")}`,
			`  Quality: ${expression("%Q")}`,
			`  Compression: ${expression("%C")}`,
			`  Orientation: ${expression("%[orientation]")}`,
			...(count > 1
				? [
						`  Delay: ${image.animationDelay}x${image.animationTicksPerSecond}`,
						`  Iterations: ${image.animationIterations}`,
						`  Dispose: ${expression("%[dispose]")}`,
					]
				: []),
			`  Filesize: ${expression("%b")}`,
		];
		const properties = image.attributeNames
			.map((name) => `    ${name}: ${image.getAttribute(name) ?? ""}`)
			.filter((line) => line.length < 400);
		if (properties.length) lines.push("  Properties:", ...properties);
		if (image.profileNames.length) {
			lines.push(`  Profiles: ${image.profileNames.join(", ")}`);
		}
		return `${lines.join("\n")}\n`;
	}

	// --- writing ---------------------------------------------------------------

	/** Output settings on an image before it is encoded. */
	private applyWriteSettings(image: IMagickImage): void {
		const { settings } = this;
		if (settings.quality !== undefined) image.quality = settings.quality;
		if (settings.depth !== undefined) image.depth = settings.depth;
		if (settings.interlace !== undefined) {
			image.settings.interlace = settings.interlace;
		}
		for (const [key, value] of settings.defines) {
			image.settings.setDefine(key, value);
		}
	}

	/**
	 * Writes images where the command line names: a file (a "%d" or "%03d"
	 * in it numbers one file per image; a format that holds one image gets
	 * name-0.png, name-1.png…), "-" for stdout, "info:" for identify's
	 * lines, "null:" for nowhere. A "png:" prefix picks the format.
	 */
	write(target: string, images: readonly IMagickImage[]): void {
		if (!images.length) throw new MagickUsageError("no images defined");
		const prefixed = splitPrefix(target);
		const prefix = prefixed?.prefix.toLowerCase();
		if (prefix === "null") return;
		if (prefix === "info") {
			const text = images
				.map((image, index) =>
					this.settings.format !== undefined
						? this.formatText(image, this.settings.format)
						: `${this.identifyLine(image, index, images.length)}\n`,
				)
				.join("");
			if (prefixed?.rest && prefixed.rest !== "-") {
				this.store(this.resolve(prefixed.rest), encoder.encode(text));
			} else this.print(text);
			return;
		}

		let name = target;
		let info: IMagickFormatInfo | undefined;
		if (prefixed && formatInfo(prefixed.prefix)) {
			info = formatInfo(prefixed.prefix);
			name = prefixed.rest;
		}
		if (!info && name !== "-") {
			const dot = name.lastIndexOf(".");
			if (dot > name.lastIndexOf("/")) info = formatInfo(name.slice(dot + 1));
		}
		info ??= formatInfo((images[0] as IMagickImage).format);
		if (!info?.supportsWriting) {
			throw new MagickUsageError(
				`no encode delegate for this image format '${info?.format ?? name}'`,
			);
		}

		for (const image of images) this.applyWriteSettings(image);
		const numbered = /%0?\d*d/.test(name);
		const together =
			images.length === 1 ||
			(info.supportsMultipleFrames && this.settings.adjoin && !numbered);
		if (together) {
			const data = this.encode(images, info.format);
			if (name === "-") this.print(data);
			else this.store(this.resolve(numbered ? frameName(name, 0) : name), data);
			return;
		}
		if (name === "-") {
			throw new MagickUsageError(
				`${info.format} holds one image; write the ${images.length} images to files (out-%d.${info.format.toLowerCase()})`,
			);
		}
		images.forEach((image, index) => {
			const path = numbered ? frameName(name, index) : indexedName(name, index);
			this.store(this.resolve(path), this.encode([image], info.format));
		});
	}

	private encode(images: readonly IMagickImage[], format: string): Uint8Array {
		const copy = (data: Uint8Array) => new Uint8Array(data);
		if (images.length === 1) {
			return (images[0] as IMagickImage).write(format as MagickFormat, copy);
		}
		return withCollection(images, (collection) =>
			collection.write(format as MagickFormat, copy),
		);
	}

	private store(path: string, data: Uint8Array): void {
		this.written.set(path, data);
		this.files.set(path, data);
	}
}

/** "frame_%03d.png" for one index. */
const frameName = (name: string, index: number): string =>
	name.replace(/%(0?)(\d*)d/, (_, zero: string, width: string) =>
		String(index).padStart(Number(width || 0), zero ? "0" : " "),
	);

/** out.png → out-0.png, as ImageMagick splits a list a format cannot hold. */
const indexedName = (name: string, index: number): string => {
	const slash = name.lastIndexOf("/");
	const dot = name.lastIndexOf(".");
	return dot > slash
		? `${name.slice(0, dot)}-${index}${name.slice(dot)}`
		: `${name}-${index}`;
};

/** Takes a collection's images out of it, so they outlive it. */
export const takeAll = (collection: IMagickImageCollection): IMagickImage[] => {
	const images: IMagickImage[] = [];
	while (collection.length) images.unshift(collection.pop() as IMagickImage);
	collection.dispose();
	return images;
};

/**
 * Runs `use` on a collection of these images and hands them back untouched:
 * they stay the caller's. What `use` returns must not be one of the
 * collection's own images unless it was taken out.
 */
export const withCollection = <T>(
	images: readonly IMagickImage[],
	use: (collection: IMagickImageCollection) => T,
): T => {
	const collection = MagickImageCollection.create();
	collection.push(...images);
	try {
		return use(collection);
	} finally {
		while (collection.length) collection.pop();
		collection.dispose();
	}
};

/**
 * A copy of an image that outlives the call it came from: magick-wasm hands
 * out clones and results only inside a callback, so it goes through MIFF,
 * ImageMagick's own lossless format.
 */
export const keepCopy = (image: IMagickImage): IMagickImage => {
	const format = image.format;
	return image.write(MagickFormat.Miff, (data) => {
		const copy = MagickImage.create(new Uint8Array(data));
		copy.format = format;
		return copy;
	});
};
