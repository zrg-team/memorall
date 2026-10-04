import { strFromU8, unzipSync } from "fflate";
import {
	parseXml,
	type XmlNode,
	xmlChild,
	xmlChildren,
	xmlFind,
	xmlFindAll,
	xmlPath,
} from "./xml-tree";

/**
 * PowerPoint slides as a drawable model: shapes, text, pictures, tables and
 * charts with the inherited layout, master and theme already applied. Sizes
 * and positions are in EMU (914400 per inch), font sizes in points. Also the
 * slides as Markdown, for the agent and chat. String-based so it runs where
 * DOMParser does not (workers, tests).
 */

export interface SlideBox {
	x: number;
	y: number;
	width: number;
	height: number;
	/** Clockwise, in degrees. */
	rotation: number;
	flipH: boolean;
	flipV: boolean;
}

export type SlideFill =
	| { kind: "color"; color: string }
	| {
			kind: "gradient";
			/** CSS angle in degrees. */
			angle: number;
			radial: boolean;
			stops: { position: number; color: string }[];
	  }
	| { kind: "image"; media: string };

export interface SlideLine {
	color: string;
	width: number;
	dash: string | null;
	head: boolean;
	tail: boolean;
}

export interface SlideTextRun {
	text: string;
	size: number;
	bold: boolean;
	italic: boolean;
	underline: boolean;
	strike: boolean;
	caps: boolean;
	color: string;
	font: string | null;
	/** Percent raised (superscript) or lowered (subscript, negative). */
	baseline: number;
}

export interface SlideParagraph {
	align: "left" | "center" | "right" | "justify";
	level: number;
	marginLeft: number;
	/** First-line offset from the margin; negative hangs a bullet. */
	indent: number;
	bullet: { text: string; color: string; font: string | null } | null;
	spaceBefore: number;
	spaceAfter: number;
	/** Line height as a multiple of the font size. */
	lineHeight: number;
	/** Exact line height in points, when set. */
	lineHeightPoints: number | null;
	/** Size of an empty paragraph's line and the bullet. */
	size: number;
	runs: SlideTextRun[];
}

export interface SlideText {
	paragraphs: SlideParagraph[];
	anchor: "top" | "middle" | "bottom";
	insets: { left: number; top: number; right: number; bottom: number };
	wrap: boolean;
	vertical: "none" | "down" | "up";
	/** Autofit font scale, 1 when the text is not shrunk. */
	scale: number;
}

export type SlideGeometry =
	| { kind: "preset"; name: string; adjust: Record<string, number> }
	| {
			kind: "custom";
			paths: {
				width: number;
				height: number;
				d: string;
				filled: boolean;
				stroked: boolean;
			}[];
	  };

export interface SlideTableCell {
	text: SlideText;
	fill: string | null;
	columnSpan: number;
	rowSpan: number;
	/** Covered by a neighbour's span. */
	merged: boolean;
	borders: {
		top: SlideLine | null;
		right: SlideLine | null;
		bottom: SlideLine | null;
		left: SlideLine | null;
	};
}

export interface SlideChart {
	type: "bar" | "column" | "line" | "area" | "pie" | "doughnut" | "scatter";
	stacked: boolean;
	title: string;
	categories: string[];
	series: { name: string; values: (number | null)[]; color: string }[];
	/** One color per category, for pie and doughnut charts. */
	pointColors: string[];
}

interface ElementBase {
	box: SlideBox;
	/** Set for shapes the slide inherits from its layout or master. */
	layer?: "layout" | "master";
}

export type SlideElement =
	| (ElementBase & {
			kind: "shape";
			geometry: SlideGeometry;
			fill: SlideFill | null;
			line: SlideLine | null;
			text: SlideText | null;
			/** The placeholder type, e.g. "title", when the shape is one. */
			placeholder: string | null;
	  })
	| (ElementBase & {
			kind: "picture";
			media: string;
			crop: { left: number; top: number; right: number; bottom: number } | null;
			description: string;
			line: SlideLine | null;
	  })
	| (ElementBase & {
			kind: "table";
			columns: number[];
			rows: { height: number; cells: SlideTableCell[] }[];
	  })
	| (ElementBase & { kind: "chart"; chart: SlideChart | null });

export interface PresentationSlide {
	number: number;
	hidden: boolean;
	background: SlideFill | null;
	elements: SlideElement[];
	notes: string;
}

export interface PresentationDeck {
	width: number;
	height: number;
	slides: PresentationSlide[];
	/** Picture bytes by package path, for the paths elements reference. */
	media: Record<string, Uint8Array>;
	/** Set for legacy .ppt files, read as each slide's text only. */
	textOnly?: boolean;
}

export const EMU_PER_POINT = 12700;
const DEFAULT_WIDTH = 12192000;
const DEFAULT_HEIGHT = 6858000;
const NOT_A_PRESENTATION = "This is not a PowerPoint presentation.";

// ---------------------------------------------------------------- package

interface Relationship {
	target: string;
	type: string;
	external: boolean;
}

interface Part {
	path: string;
	root: XmlNode;
	rels: Map<string, Relationship>;
}

const resolvePath = (base: string, target: string): string => {
	let decoded = target;
	try {
		decoded = decodeURIComponent(target);
	} catch {
		// Keep the target as written.
	}
	if (decoded.startsWith("/")) return decoded.slice(1);
	const segments = base.split("/").slice(0, -1);
	for (const segment of decoded.split("/")) {
		if (segment === "..") segments.pop();
		else if (segment && segment !== ".") segments.push(segment);
	}
	return segments.join("/");
};

class PackageReader {
	private readonly parts = new Map<string, Part | null>();
	readonly media: Record<string, Uint8Array> = {};

	constructor(private readonly files: Record<string, Uint8Array>) {}

	part(path: string | null | undefined): Part | null {
		if (!path) return null;
		const cached = this.parts.get(path);
		if (cached !== undefined) return cached;
		const bytes = this.files[path];
		let part: Part | null = null;
		if (bytes) {
			const slash = path.lastIndexOf("/");
			const relsPath = `${path.slice(0, slash + 1)}_rels/${path.slice(slash + 1)}.rels`;
			const rels = new Map<string, Relationship>();
			const relsBytes = this.files[relsPath];
			if (relsBytes) {
				for (const rel of xmlFindAll(
					parseXml(strFromU8(relsBytes)),
					"Relationship",
				)) {
					const external = rel.attrs.TargetMode === "External";
					rels.set(rel.attrs.Id, {
						target: external
							? rel.attrs.Target
							: resolvePath(path, rel.attrs.Target ?? ""),
						type: rel.attrs.Type ?? "",
						external,
					});
				}
			}
			part = { path, root: parseXml(strFromU8(bytes)), rels };
		}
		this.parts.set(path, part);
		return part;
	}

	/** The target of a relationship id, when it is inside the package. */
	target(part: Part, id: string | undefined): string | null {
		const rel = id ? part.rels.get(id) : undefined;
		return rel && !rel.external ? rel.target : null;
	}

	/** The first part related by a type ending in `/kind`. */
	related(part: Part, kind: string): Part | null {
		for (const rel of part.rels.values()) {
			if (!rel.external && rel.type.endsWith(`/${kind}`)) {
				return this.part(rel.target);
			}
		}
		return null;
	}

	/** Records a picture the model references; false when it is missing. */
	useMedia(path: string | null): path is string {
		if (!path) return false;
		const bytes = this.files[path];
		if (!bytes) return false;
		this.media[path] = bytes;
		return true;
	}
}

// ---------------------------------------------------------------- values

const num = (value: string | undefined, fallback = 0): number => {
	if (value === undefined) return fallback;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

const flag = (value: string | undefined): boolean =>
	value === "1" || value === "true" || value === "on";

/** The first value an attribute has along a chain of nodes. */
const pick = (
	nodes: (XmlNode | undefined)[],
	name: string,
): string | undefined => {
	for (const node of nodes) {
		const value = node?.attrs[name];
		if (value !== undefined) return value;
	}
	return undefined;
};

const pickChild = (
	nodes: (XmlNode | undefined)[],
	name: string,
): XmlNode | undefined => {
	for (const node of nodes) {
		const found = xmlChild(node, name);
		if (found) return found;
	}
	return undefined;
};

// ---------------------------------------------------------------- colors

interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

interface Theme {
	colors: Record<string, Rgba>;
	majorFont: string | null;
	minorFont: string | null;
	fillStyles: XmlNode[];
	backgroundStyles: XmlNode[];
	lineStyles: XmlNode[];
}

interface ColorScope {
	theme: Theme;
	colorMap: Record<string, string>;
}

const BLACK: Rgba = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };
const COLOR_ELEMENTS = new Set([
	"srgbClr",
	"schemeClr",
	"sysClr",
	"prstClr",
	"scrgbClr",
	"hslClr",
]);
const PRESET_COLORS: Record<string, string> = {
	black: "000000",
	white: "FFFFFF",
	red: "FF0000",
	green: "008000",
	blue: "0000FF",
	yellow: "FFFF00",
	gray: "808080",
	grey: "808080",
	orange: "FFA500",
	purple: "800080",
	navy: "000080",
	silver: "C0C0C0",
	ltGray: "D3D3D3",
	dkGray: "A9A9A9",
};

const hexColor = (hex: string | undefined): Rgba | null => {
	if (!hex || !/^[0-9a-f]{6}$/i.test(hex)) return null;
	const value = Number.parseInt(hex, 16);
	return { r: value >> 16, g: (value >> 8) & 255, b: value & 255, a: 1 };
};

const toHsl = ({ r, g, b }: Rgba): [number, number, number] => {
	const [red, green, blue] = [r / 255, g / 255, b / 255];
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const lightness = (max + min) / 2;
	if (max === min) return [0, 0, lightness];
	const delta = max - min;
	const saturation =
		lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
	const hue =
		max === red
			? (green - blue) / delta + (green < blue ? 6 : 0)
			: max === green
				? (blue - red) / delta + 2
				: (red - green) / delta + 4;
	return [hue / 6, saturation, lightness];
};

const fromHsl = (hue: number, saturation: number, lightness: number) => {
	if (saturation === 0) {
		const gray = Math.round(lightness * 255);
		return { r: gray, g: gray, b: gray };
	}
	const q =
		lightness < 0.5
			? lightness * (1 + saturation)
			: lightness + saturation - lightness * saturation;
	const p = 2 * lightness - q;
	const channel = (offset: number) => {
		let t = hue + offset;
		if (t < 0) t += 1;
		if (t > 1) t -= 1;
		const value =
			t < 1 / 6
				? p + (q - p) * 6 * t
				: t < 1 / 2
					? q
					: t < 2 / 3
						? p + (q - p) * (2 / 3 - t) * 6
						: p;
		return Math.round(value * 255);
	};
	return { r: channel(1 / 3), g: channel(0), b: channel(-1 / 3) };
};

const clampChannel = (value: number) =>
	Math.max(0, Math.min(255, Math.round(value)));

/** A color element (srgbClr, schemeClr, …) with its modifiers applied. */
const readColor = (
	node: XmlNode,
	scope: ColorScope,
	placeholder?: Rgba,
): Rgba | null => {
	let color: Rgba | null = null;
	switch (node.name) {
		case "srgbClr":
			color = hexColor(node.attrs.val);
			break;
		case "sysClr":
			color =
				hexColor(node.attrs.lastClr) ??
				(node.attrs.val === "window" ? WHITE : BLACK);
			break;
		case "prstClr":
			color = hexColor(PRESET_COLORS[node.attrs.val ?? ""]) ?? BLACK;
			break;
		case "schemeClr": {
			const name = node.attrs.val ?? "";
			color =
				name === "phClr"
					? (placeholder ?? null)
					: (scope.theme.colors[scope.colorMap[name] ?? name] ?? null);
			break;
		}
		case "scrgbClr":
			color = {
				r: clampChannel((num(node.attrs.r) / 100000) * 255),
				g: clampChannel((num(node.attrs.g) / 100000) * 255),
				b: clampChannel((num(node.attrs.b) / 100000) * 255),
				a: 1,
			};
			break;
		case "hslClr":
			color = {
				...fromHsl(
					num(node.attrs.hue) / 21600000,
					num(node.attrs.sat) / 100000,
					num(node.attrs.lum) / 100000,
				),
				a: 1,
			};
			break;
	}
	if (!color) return null;
	let { r, g, b, a } = color;
	for (const modifier of node.children) {
		const value = num(modifier.attrs.val) / 100000;
		switch (modifier.name) {
			case "tint":
				r += (255 - r) * (1 - value);
				g += (255 - g) * (1 - value);
				b += (255 - b) * (1 - value);
				break;
			case "shade":
				r *= value;
				g *= value;
				b *= value;
				break;
			case "alpha":
				a = value;
				break;
			case "lumMod":
			case "lumOff":
			case "satMod": {
				const [hue, saturation, lightness] = toHsl({ r, g, b, a });
				const next = fromHsl(
					hue,
					modifier.name === "satMod"
						? Math.min(1, saturation * value)
						: saturation,
					Math.max(
						0,
						Math.min(
							1,
							modifier.name === "lumMod"
								? lightness * value
								: modifier.name === "lumOff"
									? lightness + value
									: lightness,
						),
					),
				);
				({ r, g, b } = next);
				break;
			}
		}
	}
	return { r: clampChannel(r), g: clampChannel(g), b: clampChannel(b), a };
};

/** The color held by a node such as solidFill, fontRef or buClr. */
const colorIn = (
	holder: XmlNode | undefined,
	scope: ColorScope,
	placeholder?: Rgba,
): Rgba | null => {
	const node = holder?.children.find((child) => COLOR_ELEMENTS.has(child.name));
	return node ? readColor(node, scope, placeholder) : null;
};

const css = ({ r, g, b, a }: Rgba): string =>
	a < 1
		? `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`
		: `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;

const readTheme = (part: Part | null): Theme => {
	const colors: Record<string, Rgba> = {};
	const scheme = part ? xmlFind(part.root, "clrScheme") : undefined;
	const bare: ColorScope = {
		theme: {
			colors: {},
			majorFont: null,
			minorFont: null,
			fillStyles: [],
			backgroundStyles: [],
			lineStyles: [],
		},
		colorMap: {},
	};
	for (const entry of scheme?.children ?? []) {
		const color = colorIn(entry, bare);
		if (color) colors[entry.name] = color;
	}
	const fonts = part ? xmlFind(part.root, "fontScheme") : undefined;
	const formats = part ? xmlFind(part.root, "fmtScheme") : undefined;
	return {
		colors,
		majorFont: xmlPath(fonts, "majorFont", "latin")?.attrs.typeface || null,
		minorFont: xmlPath(fonts, "minorFont", "latin")?.attrs.typeface || null,
		fillStyles: xmlChild(formats, "fillStyleLst")?.children ?? [],
		backgroundStyles: xmlChild(formats, "bgFillStyleLst")?.children ?? [],
		lineStyles: xmlChild(formats, "lnStyleLst")?.children ?? [],
	};
};

// ---------------------------------------------------------------- slides

interface Scope extends ColorScope {
	reader: PackageReader;
	/** The part shapes come from, for its relationships. */
	part: Part;
	layout: Part | null;
	master: Part | null;
	defaultTextStyle: XmlNode | undefined;
	slideNumber: number;
	/** Set while reading a layout's or master's own shapes. */
	layer?: "layout" | "master";
}

type Transform = (box: SlideBox) => SlideBox;

interface PlaceholderKey {
	type: string;
	index: string | undefined;
}

const MASTER_TYPE: Record<string, string> = {
	ctrTitle: "title",
	subTitle: "body",
	obj: "body",
};

const placeholderOf = (shape: XmlNode): PlaceholderKey | null => {
	const properties = shape.children.find((child) =>
		child.name.startsWith("nv"),
	);
	const ph = xmlPath(properties, "nvPr", "ph");
	return ph ? { type: ph.attrs.type ?? "obj", index: ph.attrs.idx } : null;
};

const placeholderShapes = (part: Part | null): XmlNode[] => {
	const tree = part ? xmlPath(part.root.children[0], "cSld", "spTree") : null;
	return (tree?.children ?? []).filter((shape) => placeholderOf(shape));
};

/** The layout and master shapes a placeholder inherits from, nearest first. */
const inheritedPlaceholders = (
	scope: Scope,
	key: PlaceholderKey,
): XmlNode[] => {
	const found: XmlNode[] = [];
	const layoutShapes = placeholderShapes(scope.layout);
	const layoutMatch =
		(key.index !== undefined &&
			layoutShapes.find(
				(shape) => placeholderOf(shape)?.index === key.index,
			)) ||
		layoutShapes.find((shape) => placeholderOf(shape)?.type === key.type) ||
		layoutShapes.find(
			(shape) =>
				(MASTER_TYPE[placeholderOf(shape)?.type ?? ""] ??
					placeholderOf(shape)?.type) === (MASTER_TYPE[key.type] ?? key.type),
		);
	if (layoutMatch) found.push(layoutMatch);
	const masterType =
		MASTER_TYPE[
			(layoutMatch && placeholderOf(layoutMatch)?.type) || key.type
		] ??
		((layoutMatch && placeholderOf(layoutMatch)?.type) || key.type);
	const masterMatch = placeholderShapes(scope.master).find(
		(shape) => placeholderOf(shape)?.type === masterType,
	);
	if (masterMatch) found.push(masterMatch);
	return found;
};

const boxOf = (xfrm: XmlNode | undefined): SlideBox | null => {
	const offset = xmlChild(xfrm, "off");
	const extent = xmlChild(xfrm, "ext");
	if (!xfrm || !offset || !extent) return null;
	return {
		x: num(offset.attrs.x),
		y: num(offset.attrs.y),
		width: num(extent.attrs.cx),
		height: num(extent.attrs.cy),
		rotation: num(xfrm.attrs.rot) / 60000,
		flipH: flag(xfrm.attrs.flipH),
		flipV: flag(xfrm.attrs.flipV),
	};
};

/** A fill: undefined when the properties do not say, null for no fill. */
const fillOf = (
	properties: XmlNode | undefined,
	scope: Scope,
	placeholder?: Rgba,
	groupFill?: SlideFill | null,
): SlideFill | null | undefined => {
	for (const child of properties?.children ?? []) {
		switch (child.name) {
			case "noFill":
				return null;
			case "solidFill": {
				const color = colorIn(child, scope, placeholder);
				return color ? { kind: "color", color: css(color) } : null;
			}
			case "gradFill": {
				const stops = xmlChildren(xmlChild(child, "gsLst"), "gs")
					.map((stop) => {
						const color = colorIn(stop, scope, placeholder);
						return color
							? { position: num(stop.attrs.pos) / 1000, color: css(color) }
							: null;
					})
					.filter((stop) => stop !== null)
					.sort((a, b) => a.position - b.position);
				if (!stops.length) return undefined;
				const linear = xmlChild(child, "lin");
				return {
					kind: "gradient",
					// DrawingML measures clockwise from the right; CSS from the top.
					angle: (linear ? num(linear.attrs.ang) / 60000 : 90) + 90,
					radial: !linear && Boolean(xmlChild(child, "path")),
					stops,
				};
			}
			case "blipFill": {
				const media = scope.reader.target(
					scope.part,
					xmlChild(child, "blip")?.attrs["r:embed"],
				);
				return scope.reader.useMedia(media) ? { kind: "image", media } : null;
			}
			case "pattFill": {
				const color = colorIn(xmlChild(child, "fgClr"), scope, placeholder);
				return color ? { kind: "color", color: css(color) } : null;
			}
			case "grpFill":
				return groupFill ?? null;
		}
	}
	return undefined;
};

/** The theme fill a style reference (fillRef, bgRef) points at. */
const referencedFill = (
	ref: XmlNode | undefined,
	scope: Scope,
): SlideFill | null => {
	const index = num(ref?.attrs.idx);
	if (!ref || index <= 0) return null;
	const placeholder = colorIn(ref, scope) ?? undefined;
	const style =
		index >= 1001
			? scope.theme.backgroundStyles[index - 1001]
			: scope.theme.fillStyles[index - 1];
	const fill = style
		? fillOf(
				{ name: "", attrs: {}, children: [style], text: "" },
				scope,
				placeholder,
			)
		: undefined;
	if (fill !== undefined) return fill;
	return placeholder ? { kind: "color", color: css(placeholder) } : null;
};

const lineOf = (
	lines: (XmlNode | undefined)[],
	style: XmlNode | undefined,
	scope: Scope,
): SlideLine | null => {
	const ref = xmlChild(style, "lnRef");
	const refIndex = num(ref?.attrs.idx);
	const placeholder = ref ? (colorIn(ref, scope) ?? undefined) : undefined;
	const themed =
		refIndex > 0 ? scope.theme.lineStyles[refIndex - 1] : undefined;
	const chain = [...lines, themed];
	let color: Rgba | null = null;
	for (const line of chain) {
		if (!line) continue;
		if (xmlChild(line, "noFill")) return null;
		const solid = xmlChild(line, "solidFill");
		if (solid) {
			color = colorIn(solid, scope, placeholder);
			break;
		}
		const gradient = xmlChild(line, "gradFill");
		if (gradient) {
			color = colorIn(xmlFind(gradient, "gs"), scope, placeholder);
			break;
		}
	}
	if (!color) return null;
	const end = (name: string) => {
		const type = pickChild(chain, name)?.attrs.type;
		return Boolean(type && type !== "none");
	};
	return {
		color: css(color),
		width: num(pick(chain, "w"), 9525),
		dash: pickChild(chain, "prstDash")?.attrs.val ?? null,
		head: end("headEnd"),
		tail: end("tailEnd"),
	};
};

const geometryOf = (properties: (XmlNode | undefined)[]): SlideGeometry => {
	for (const node of properties) {
		const preset = xmlChild(node, "prstGeom");
		if (preset) {
			const adjust: Record<string, number> = {};
			for (const guide of xmlChildren(xmlChild(preset, "avLst"), "gd")) {
				const value = /^val\s+(-?\d+)/.exec(guide.attrs.fmla ?? "");
				if (value && guide.attrs.name)
					adjust[guide.attrs.name] = Number(value[1]);
			}
			return { kind: "preset", name: preset.attrs.prst ?? "rect", adjust };
		}
		const custom = xmlChild(node, "custGeom");
		if (custom) {
			const paths = xmlChildren(xmlChild(custom, "pathLst"), "path")
				.map((path) => {
					const d = customPath(path);
					return d === null
						? null
						: {
								width: num(path.attrs.w),
								height: num(path.attrs.h),
								d,
								filled: path.attrs.fill !== "none",
								stroked:
									path.attrs.stroke !== "0" && path.attrs.stroke !== "false",
							};
				})
				.filter((path) => path !== null);
			if (paths.length) return { kind: "custom", paths };
		}
	}
	return { kind: "preset", name: "rect", adjust: {} };
};

/** An SVG path from a DrawingML path, or null when it uses guide formulas. */
const customPath = (path: XmlNode): string | null => {
	const point = (node: XmlNode | undefined): [number, number] | null => {
		const x = Number(node?.attrs.x);
		const y = Number(node?.attrs.y);
		return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
	};
	let d = "";
	let current: [number, number] = [0, 0];
	for (const command of path.children) {
		const points = xmlChildren(command, "pt").map(point);
		if (points.some((value) => value === null)) return null;
		const pts = points as [number, number][];
		switch (command.name) {
			case "moveTo":
			case "lnTo":
				if (!pts[0]) return null;
				d += `${command.name === "moveTo" ? "M" : "L"}${pts[0][0]} ${pts[0][1]} `;
				current = pts[0];
				break;
			case "cubicBezTo":
				if (pts.length < 3) return null;
				d += `C${pts.map(([x, y]) => `${x} ${y}`).join(" ")} `;
				current = pts[2];
				break;
			case "quadBezTo":
				if (pts.length < 2) return null;
				d += `Q${pts.map(([x, y]) => `${x} ${y}`).join(" ")} `;
				current = pts[1];
				break;
			case "arcTo": {
				const radiusX = Number(command.attrs.wR);
				const radiusY = Number(command.attrs.hR);
				const start = (Number(command.attrs.stAng) / 60000) * (Math.PI / 180);
				const sweep = (Number(command.attrs.swAng) / 60000) * (Math.PI / 180);
				if (![radiusX, radiusY, start, sweep].every(Number.isFinite))
					return null;
				const centerX = current[0] - radiusX * Math.cos(start);
				const centerY = current[1] - radiusY * Math.sin(start);
				const end: [number, number] = [
					centerX + radiusX * Math.cos(start + sweep),
					centerY + radiusY * Math.sin(start + sweep),
				];
				d += `A${radiusX} ${radiusY} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 1 : 0} ${end[0]} ${end[1]} `;
				current = end;
				break;
			}
			case "close":
				d += "Z ";
				break;
		}
	}
	return d.trim() || null;
};

// ---------------------------------------------------------------- text

/** Symbol-font bullet characters and what they draw. */
const SYMBOL_BULLETS: Record<string, string> = {
	"§": "▪",
	Ø: "➢",
	ü: "✓",
	q: "❑",
	v: "❖",
	n: "■",
	l: "●",
	à: "➔",
	Ü: "➢",
	o: "□",
	w: "◆",
	Ÿ: "•",
};

const ROMAN: [number, string][] = [
	[1000, "M"],
	[900, "CM"],
	[500, "D"],
	[400, "CD"],
	[100, "C"],
	[90, "XC"],
	[50, "L"],
	[40, "XL"],
	[10, "X"],
	[9, "IX"],
	[5, "V"],
	[4, "IV"],
	[1, "I"],
];

const autoNumber = (scheme: string, value: number): string => {
	const match = /^(arabic|alphaLc|alphaUc|romanLc|romanUc)(.*)$/.exec(scheme);
	const style = match?.[1] ?? "arabic";
	const suffix = match?.[2] ?? "Period";
	let text = String(value);
	if (style.startsWith("alpha")) {
		text = "";
		for (let rest = value; rest > 0; rest = Math.floor((rest - 1) / 26)) {
			text = String.fromCharCode(97 + ((rest - 1) % 26)) + text;
		}
	} else if (style.startsWith("roman")) {
		text = "";
		let rest = value;
		for (const [amount, letters] of ROMAN) {
			while (rest >= amount) {
				text += letters;
				rest -= amount;
			}
		}
		text = text.toLowerCase();
	}
	if (style.endsWith("Uc")) text = text.toUpperCase();
	if (suffix.startsWith("ParenBoth")) return `(${text})`;
	if (suffix.startsWith("ParenR")) return `${text})`;
	if (suffix.startsWith("Plain")) return text;
	if (suffix.startsWith("Minus")) return `${text} -`;
	return `${text}.`;
};

interface TextDefaults {
	/** List styles inherited from layout, master and presentation. */
	inherited: (XmlNode | undefined)[];
	/** Body properties, nearest first. */
	bodies: (XmlNode | undefined)[];
	/** Text color and font a shape style or table style gives. */
	color?: Rgba | null;
	font?: string | null;
	bold?: boolean;
	/** Size when nothing sets one. */
	size: number;
}

const typefaceOf = (
	node: XmlNode | undefined,
	theme: Theme,
): string | null | undefined => {
	const typeface = node?.attrs.typeface;
	if (!typeface) return undefined;
	if (typeface.startsWith("+mj")) return theme.majorFont;
	if (typeface.startsWith("+mn")) return theme.minorFont;
	return typeface;
};

const spacingOf = (
	nodes: XmlNode[],
	name: string,
	size: number,
): number | null => {
	const spacing = pickChild(nodes, name);
	const points = xmlChild(spacing, "spcPts");
	if (points) return num(points.attrs.val) / 100;
	const percent = xmlChild(spacing, "spcPct");
	if (percent) return (num(percent.attrs.val) / 100000) * size;
	return null;
};

const readText = (
	body: XmlNode | undefined,
	defaults: TextDefaults,
	scope: Scope,
): SlideText | null => {
	if (!body) return null;
	const bodies = [xmlChild(body, "bodyPr"), ...defaults.bodies];
	const autofit = pickChild(bodies, "normAutofit");
	const scale = autofit ? num(autofit.attrs.fontScale, 100000) / 100000 : 1;
	const spacingReduction = autofit
		? num(autofit.attrs.lnSpcReduction) / 100000
		: 0;
	const ownStyle = xmlChild(body, "lstStyle");
	const counters: number[] = [];
	const paragraphs: SlideParagraph[] = [];
	for (const paragraph of xmlChildren(body, "p")) {
		const own = xmlChild(paragraph, "pPr");
		const level = Math.min(8, Math.max(0, num(own?.attrs.lvl)));
		const levelName = `lvl${level + 1}pPr`;
		const ownLevels = [xmlChild(ownStyle, levelName)];
		const inheritedLevels = defaults.inherited.map((style) =>
			xmlChild(style, levelName),
		);
		const properties = [own, ...ownLevels, ...inheritedLevels].filter(
			(node): node is XmlNode => node !== undefined,
		);
		const ownDefaults = [own, ...ownLevels].map((node) =>
			xmlChild(node, "defRPr"),
		);
		const inheritedDefaults = inheritedLevels.map((node) =>
			xmlChild(node, "defRPr"),
		);

		const runStyle = (runProperties: XmlNode | undefined) => {
			const near = [runProperties, ...ownDefaults];
			const far = inheritedDefaults;
			const all = [...near, ...far];
			const size = num(pick(all, "sz"), defaults.size * 100) / 100;
			const fillNode = (nodes: (XmlNode | undefined)[]) =>
				nodes.find(
					(node) => xmlChild(node, "solidFill") || xmlChild(node, "gradFill"),
				);
			const colorFrom = (node: XmlNode | undefined) =>
				colorIn(xmlChild(node, "solidFill"), scope) ??
				colorIn(xmlFind(xmlChild(node, "gradFill"), "gs"), scope);
			const nearFill = fillNode(near);
			const color =
				(nearFill ? colorFrom(nearFill) : null) ??
				defaults.color ??
				colorFrom(fillNode(far)) ??
				scope.theme.colors[scope.colorMap.tx1 ?? "dk1"] ??
				BLACK;
			const font =
				typefaceOf(pickChild(near, "latin"), scope.theme) ??
				defaults.font ??
				typefaceOf(pickChild(far, "latin"), scope.theme) ??
				scope.theme.minorFont;
			const bold = pick(near, "b") ?? (defaults.bold ? "1" : pick(far, "b"));
			const underline = pick(all, "u");
			const strike = pick(all, "strike");
			return {
				size: size * scale,
				bold: flag(bold),
				italic: flag(pick(all, "i")),
				underline: Boolean(underline && underline !== "none"),
				strike: Boolean(strike && strike !== "noStrike"),
				caps: pick(all, "cap") === "all",
				color: css(color),
				font,
				baseline: num(pick(all, "baseline")) / 1000,
			};
		};

		const runs: SlideTextRun[] = [];
		for (const child of paragraph.children) {
			if (child.name === "r" || child.name === "fld") {
				const style = runStyle(xmlChild(child, "rPr"));
				const text =
					child.name === "fld" && child.attrs.type === "slidenum"
						? String(scope.slideNumber)
						: (xmlChild(child, "t")?.text ?? "");
				runs.push({ text, ...style });
			} else if (child.name === "br") {
				runs.push({ text: "\n", ...runStyle(xmlChild(child, "rPr")) });
			}
		}
		const endStyle = runStyle(xmlChild(paragraph, "endParaRPr"));
		const size = runs.find((run) => run.text.trim())?.size ?? endStyle.size;
		const hasText = runs.some((run) => run.text.trim());

		// The first list style that decides the bullet decides it.
		let bullet: SlideParagraph["bullet"] = null;
		const bulletSource = properties.find((node) =>
			node.children.some((child) =>
				["buNone", "buChar", "buAutoNum", "buBlip"].includes(child.name),
			),
		);
		const bulletColor = colorIn(pickChild(properties, "buClr"), scope) ?? null;
		const bulletFont = pickChild(properties, "buFont")?.attrs.typeface ?? null;
		const textColor = runs[0]?.color ?? endStyle.color;
		const autoNumbered = xmlChild(bulletSource, "buAutoNum");
		if (autoNumbered && hasText) {
			counters.length = level + 1;
			const next =
				counters[level] === undefined
					? num(autoNumbered.attrs.startAt, 1)
					: counters[level] + 1;
			counters[level] = next;
			bullet = {
				text: autoNumber(autoNumbered.attrs.type ?? "arabicPeriod", next),
				color: bulletColor ? css(bulletColor) : textColor,
				font: null,
			};
		} else {
			counters.length = level;
			const char = xmlChild(bulletSource, "buChar")?.attrs.char;
			if (hasText && (char || xmlChild(bulletSource, "buBlip"))) {
				const symbolFont =
					bulletFont !== null && /wingdings|symbol|webdings/i.test(bulletFont);
				bullet = {
					text: symbolFont
						? (SYMBOL_BULLETS[char ?? ""] ?? "•")
						: (char ?? "•"),
					color: bulletColor ? css(bulletColor) : textColor,
					font: symbolFont ? null : bulletFont,
				};
			}
		}

		const lineSpacing = pickChild(properties, "lnSpc");
		const linePercent = xmlChild(lineSpacing, "spcPct");
		const linePoints = xmlChild(lineSpacing, "spcPts");
		const algn = pick(properties, "algn");
		paragraphs.push({
			align:
				algn === "ctr"
					? "center"
					: algn === "r"
						? "right"
						: algn === "just" || algn === "dist"
							? "justify"
							: "left",
			level,
			marginLeft: num(pick(properties, "marL")),
			indent: num(pick(properties, "indent")),
			bullet,
			spaceBefore: spacingOf(properties, "spcBef", size) ?? 0,
			spaceAfter: spacingOf(properties, "spcAft", size) ?? 0,
			lineHeight:
				1.2 *
				(linePercent ? num(linePercent.attrs.val) / 100000 : 1) *
				(1 - spacingReduction),
			lineHeightPoints: linePoints ? num(linePoints.attrs.val) / 100 : null,
			size,
			runs,
		});
	}
	const anchor = pick(bodies, "anchor");
	const vertical = pick(bodies, "vert");
	return {
		paragraphs,
		anchor: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
		insets: {
			left: num(pick(bodies, "lIns"), 91440),
			top: num(pick(bodies, "tIns"), 45720),
			right: num(pick(bodies, "rIns"), 91440),
			bottom: num(pick(bodies, "bIns"), 45720),
		},
		wrap: pick(bodies, "wrap") !== "none",
		vertical:
			vertical === "vert" ||
			vertical === "eaVert" ||
			vertical === "wordArtVertRtl"
				? "down"
				: vertical === "vert270"
					? "up"
					: "none",
		scale,
	};
};

const hasVisibleText = (text: SlideText | null): text is SlideText =>
	Boolean(
		text?.paragraphs.some((paragraph) =>
			paragraph.runs.some((run) => run.text.trim()),
		),
	);

/** The master text style a placeholder type draws with. */
const masterTextStyle = (
	scope: Scope,
	type: string | null,
): XmlNode | undefined => {
	const styles = scope.master
		? xmlChild(scope.master.root.children[0], "txStyles")
		: undefined;
	if (type === "title" || type === "ctrTitle")
		return xmlChild(styles, "titleStyle");
	if (type === null || ["dt", "ftr", "sldNum", "hdr"].includes(type)) {
		return xmlChild(styles, "otherStyle");
	}
	return xmlChild(styles, "bodyStyle");
};

// ---------------------------------------------------------------- shapes

const readShape = (
	shape: XmlNode,
	scope: Scope,
	transform: Transform,
	out: SlideElement[],
	groupFill: SlideFill | null | undefined,
) => {
	const key = placeholderOf(shape);
	// A layout's or master's placeholders are prompts for the slide to fill.
	if (key && scope.layer) return;
	const properties = shape.children.find((child) =>
		child.name.startsWith("nv"),
	);
	if (flag(xmlChild(properties, "cNvPr")?.attrs.hidden)) return;
	const inherited = key ? inheritedPlaceholders(scope, key) : [];
	const shapeProperties = [shape, ...inherited].map((node) =>
		xmlChild(node, "spPr"),
	);
	const base = shapeProperties
		.map((node) => boxOf(xmlChild(node, "xfrm")))
		.find(Boolean);
	if (!base) return;
	const box = transform(base);
	const style = xmlChild(shape, "style");
	let fill: SlideFill | null | undefined;
	for (const node of shapeProperties) {
		fill = fillOf(node, scope, undefined, groupFill);
		if (fill !== undefined) break;
	}
	if (fill === undefined)
		fill = referencedFill(xmlChild(style, "fillRef"), scope);
	const line = lineOf(
		shapeProperties.map((node) => xmlChild(node, "ln")),
		style,
		scope,
	);
	const fontRef = xmlChild(style, "fontRef");
	const placeholder = key?.type ?? null;
	const text = readText(
		xmlChild(shape, "txBody"),
		{
			inherited: [
				...inherited.map((node) => xmlPath(node, "txBody", "lstStyle")),
				masterTextStyle(scope, placeholder),
				scope.defaultTextStyle,
			],
			bodies: inherited.map((node) => xmlPath(node, "txBody", "bodyPr")),
			color: colorIn(fontRef, scope),
			font:
				fontRef?.attrs.idx === "major"
					? scope.theme.majorFont
					: fontRef?.attrs.idx === "minor"
						? scope.theme.minorFont
						: null,
			size: 18,
		},
		scope,
	);
	const textBox = boxOf(xmlChild(shape, "txXfrm"));
	const element = {
		kind: "shape" as const,
		box,
		geometry: geometryOf(shapeProperties),
		fill,
		line,
		placeholder,
		...(scope.layer ? { layer: scope.layer } : {}),
	};
	if (textBox && hasVisibleText(text)) {
		// Diagram drawings place their text apart from the shape.
		out.push({ ...element, text: null });
		out.push({
			kind: "shape",
			box: transform(textBox),
			geometry: { kind: "preset", name: "rect", adjust: {} },
			fill: null,
			line: null,
			placeholder,
			text,
			...(scope.layer ? { layer: scope.layer } : {}),
		});
		return;
	}
	if (!fill && !line && !hasVisibleText(text)) return;
	out.push({ ...element, text: hasVisibleText(text) ? text : null });
};

const readPicture = (
	picture: XmlNode,
	scope: Scope,
	transform: Transform,
	out: SlideElement[],
	frame?: SlideBox,
) => {
	const key = placeholderOf(picture);
	if (key && scope.layer) return;
	const properties = picture.children.find((child) =>
		child.name.startsWith("nv"),
	);
	const details = xmlChild(properties, "cNvPr");
	if (flag(details?.attrs.hidden)) return;
	const inherited = key ? inheritedPlaceholders(scope, key) : [];
	const shapeProperties = [picture, ...inherited].map((node) =>
		xmlChild(node, "spPr"),
	);
	const base =
		frame ??
		shapeProperties.map((node) => boxOf(xmlChild(node, "xfrm"))).find(Boolean);
	const blip = xmlFind(xmlChild(picture, "blipFill") ?? picture, "blip");
	const media = scope.reader.target(scope.part, blip?.attrs["r:embed"]);
	if (!base || !scope.reader.useMedia(media)) return;
	const crop = xmlPath(picture, "blipFill", "srcRect");
	out.push({
		kind: "picture",
		box: frame ?? transform(base),
		media,
		crop: crop
			? {
					left: num(crop.attrs.l) / 100000,
					top: num(crop.attrs.t) / 100000,
					right: num(crop.attrs.r) / 100000,
					bottom: num(crop.attrs.b) / 100000,
				}
			: null,
		description: details?.attrs.descr ?? "",
		line: lineOf(
			shapeProperties.map((node) => xmlChild(node, "ln")),
			xmlChild(picture, "style"),
			scope,
		),
		...(scope.layer ? { layer: scope.layer } : {}),
	});
};

/** Fills and text styles of the built-in "Medium Style 2" table look. */
const builtInTableStyle = (scope: Scope) => {
	const accent = scope.theme.colors.accent1 ?? hexColor("4472C4") ?? BLACK;
	const tint = (amount: number): Rgba => ({
		r: clampChannel(accent.r + (255 - accent.r) * (1 - amount)),
		g: clampChannel(accent.g + (255 - accent.g) * (1 - amount)),
		b: clampChannel(accent.b + (255 - accent.b) * (1 - amount)),
		a: 1,
	});
	const light = scope.theme.colors[scope.colorMap.bg1 ?? "lt1"] ?? WHITE;
	return {
		whole: { fill: css(tint(0.2)) },
		band: { fill: css(tint(0.4)) },
		header: { fill: css(accent), color: light, bold: true },
		border: {
			color: css(light),
			width: 12700,
			dash: null,
			head: false,
			tail: false,
		},
	};
};

interface TableRegion {
	fill?: string | null;
	color?: Rgba | null;
	bold?: boolean;
}

const tableStyleRegions = (
	style: XmlNode | undefined,
	scope: Scope,
): Record<string, TableRegion> => {
	const regions: Record<string, TableRegion> = {};
	for (const region of style?.children ?? []) {
		const cellStyle = xmlChild(region, "tcStyle");
		const textStyle = xmlChild(region, "tcTxStyle");
		const fillNode = xmlChild(cellStyle, "fill");
		let fill: string | null | undefined;
		if (fillNode) {
			const value = fillOf(fillNode, scope);
			fill =
				value?.kind === "color"
					? value.color
					: value === null
						? null
						: undefined;
		} else if (xmlChild(cellStyle, "fillRef")) {
			const value = referencedFill(xmlChild(cellStyle, "fillRef"), scope);
			fill = value?.kind === "color" ? value.color : null;
		}
		regions[region.name] = {
			fill,
			color: textStyle
				? (colorIn(textStyle, scope) ??
					colorIn(xmlChild(textStyle, "fontRef"), scope))
				: undefined,
			bold: textStyle ? flag(textStyle.attrs.b) : undefined,
		};
	}
	return regions;
};

const readTable = (
	table: XmlNode,
	box: SlideBox,
	scope: Scope,
	out: SlideElement[],
) => {
	const tableProperties = xmlChild(table, "tblPr");
	const styleId = xmlChild(tableProperties, "tableStyleId")?.text.trim();
	const stylesPart = scope.reader.related(
		scope.reader.part("ppt/presentation.xml") as Part,
		"tableStyles",
	);
	const styleList = stylesPart?.root.children[0];
	const wanted = styleId || styleList?.attrs.def;
	const declared = xmlChildren(styleList, "tblStyle").find(
		(style) => style.attrs.styleId === wanted,
	);
	const builtIn = builtInTableStyle(scope);
	const regions: Record<string, TableRegion> = declared
		? tableStyleRegions(declared, scope)
		: wanted
			? {
					wholeTbl: builtIn.whole,
					band1H: builtIn.band,
					firstRow: builtIn.header,
					lastRow: builtIn.header,
					firstCol: builtIn.header,
					lastCol: builtIn.header,
				}
			: {};
	const options = {
		firstRow: flag(tableProperties?.attrs.firstRow),
		lastRow: flag(tableProperties?.attrs.lastRow),
		firstCol: flag(tableProperties?.attrs.firstCol),
		lastCol: flag(tableProperties?.attrs.lastCol),
		bandRow: flag(tableProperties?.attrs.bandRow),
		bandCol: flag(tableProperties?.attrs.bandCol),
	};
	const columns = xmlChildren(xmlChild(table, "tblGrid"), "gridCol").map(
		(column) => num(column.attrs.w),
	);
	const rowNodes = xmlChildren(table, "tr");
	const rows = rowNodes.map((row, rowIndex) => {
		const cells = xmlChildren(row, "tc");
		return {
			height: num(row.attrs.h),
			cells: cells.map((cell, columnIndex): SlideTableCell => {
				const names: string[] = [];
				if (options.firstRow && rowIndex === 0) names.push("firstRow");
				if (options.lastRow && rowIndex === rowNodes.length - 1)
					names.push("lastRow");
				if (options.firstCol && columnIndex === 0) names.push("firstCol");
				if (options.lastCol && columnIndex === cells.length - 1)
					names.push("lastCol");
				const bodyRow = rowIndex - (options.firstRow ? 1 : 0);
				if (options.bandRow && bodyRow >= 0) {
					names.push(bodyRow % 2 === 0 ? "band1H" : "band2H");
				}
				if (options.bandCol) {
					const bodyColumn = columnIndex - (options.firstCol ? 1 : 0);
					if (bodyColumn >= 0)
						names.push(bodyColumn % 2 === 0 ? "band1V" : "band2V");
				}
				names.push("wholeTbl");
				const applied = names.map((name) => regions[name]).filter(Boolean);
				const cellProperties = xmlChild(cell, "tcPr");
				const ownFill = fillOf(cellProperties, scope);
				const regionFill = applied.find(
					(region) => region.fill !== undefined,
				)?.fill;
				const color = applied.find((region) => region.color)?.color;
				const bold = applied.find((region) => region.bold !== undefined)?.bold;
				const border = (name: string): SlideLine | null => {
					const line = xmlChild(cellProperties, name);
					if (line) return lineOf([line], undefined, scope);
					return declared || !wanted ? null : builtIn.border;
				};
				const text = readText(
					xmlChild(cell, "txBody"),
					{
						inherited: [masterTextStyle(scope, null), scope.defaultTextStyle],
						bodies: [],
						color: color ?? null,
						bold,
						size: 18,
					},
					scope,
				) ?? {
					paragraphs: [],
					anchor: "top",
					insets: { left: 91440, top: 45720, right: 91440, bottom: 45720 },
					wrap: true,
					vertical: "none",
					scale: 1,
				};
				const anchor = cellProperties?.attrs.anchor;
				text.anchor =
					anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top";
				text.insets = {
					left: num(cellProperties?.attrs.marL, 91440),
					top: num(cellProperties?.attrs.marT, 45720),
					right: num(cellProperties?.attrs.marR, 91440),
					bottom: num(cellProperties?.attrs.marB, 45720),
				};
				return {
					text,
					fill:
						ownFill !== undefined
							? ownFill?.kind === "color"
								? ownFill.color
								: null
							: (regionFill ?? null),
					columnSpan: Math.max(1, num(cell.attrs.gridSpan, 1)),
					rowSpan: Math.max(1, num(cell.attrs.rowSpan, 1)),
					merged: flag(cell.attrs.hMerge) || flag(cell.attrs.vMerge),
					borders: {
						top: border("lnT"),
						right: border("lnR"),
						bottom: border("lnB"),
						left: border("lnL"),
					},
				};
			}),
		};
	});
	out.push({
		kind: "table",
		box,
		columns,
		rows,
		...(scope.layer ? { layer: scope.layer } : {}),
	});
};

const CHART_TYPES: Record<string, SlideChart["type"]> = {
	barChart: "column",
	bar3DChart: "column",
	lineChart: "line",
	line3DChart: "line",
	stockChart: "line",
	radarChart: "line",
	areaChart: "area",
	area3DChart: "area",
	pieChart: "pie",
	pie3DChart: "pie",
	ofPieChart: "pie",
	doughnutChart: "doughnut",
	scatterChart: "scatter",
	bubbleChart: "scatter",
};

const cachedValues = (node: XmlNode | undefined): string[] => {
	const cache =
		xmlFind(node, "strCache") ??
		xmlFind(node, "numCache") ??
		xmlFind(node, "strLit") ??
		xmlFind(node, "numLit") ??
		xmlFind(node, "lvl");
	const values: string[] = [];
	const count = num(xmlChild(cache, "ptCount")?.attrs.val, 0);
	for (const point of xmlChildren(cache, "pt")) {
		values[num(point.attrs.idx)] = xmlChild(point, "v")?.text ?? "";
	}
	for (let index = 0; index < Math.max(count, values.length); index += 1) {
		values[index] ??= "";
	}
	return values;
};

const richText = (node: XmlNode | undefined): string =>
	xmlFindAll(node, "t")
		.map((text) => text.text)
		.join("")
		.trim();

const readChart = (part: Part | null, scope: Scope): SlideChart | null => {
	const chart = part ? xmlChild(part.root.children[0], "chart") : undefined;
	const plot = xmlChild(chart, "plotArea");
	const plotted = plot?.children.find((child) => CHART_TYPES[child.name]);
	if (!chart || !plotted) return null;
	const chartScope = { ...scope, part: part as Part };
	let type = CHART_TYPES[plotted.name];
	if (type === "column" && xmlChild(plotted, "barDir")?.attrs.val === "bar")
		type = "bar";
	const grouping = xmlChild(plotted, "grouping")?.attrs.val ?? "";
	const accents = [1, 2, 3, 4, 5, 6].map(
		(index) => scope.theme.colors[`accent${index}`] ?? BLACK,
	);
	const seriesNodes = xmlChildren(plotted, "ser");
	const series = seriesNodes.map((node, index) => {
		const color =
			colorIn(xmlPath(node, "spPr", "solidFill"), chartScope) ??
			colorIn(xmlPath(node, "spPr", "ln", "solidFill"), chartScope) ??
			accents[index % accents.length];
		return {
			name: xmlFind(xmlChild(node, "tx"), "v")?.text ?? `Series ${index + 1}`,
			values: cachedValues(xmlChild(node, "val") ?? xmlChild(node, "yVal")).map(
				(value) => {
					const parsed = Number(value);
					return value === "" || !Number.isFinite(parsed) ? null : parsed;
				},
			),
			color: css(color),
		};
	});
	const first = seriesNodes[0];
	const categories = cachedValues(
		xmlChild(first, "cat") ?? xmlChild(first, "xVal"),
	);
	const pointColors = categories.map((_, index) => {
		const point = xmlChildren(first, "dPt").find(
			(node) => num(xmlChild(node, "idx")?.attrs.val) === index,
		);
		const color = colorIn(xmlPath(point, "spPr", "solidFill"), chartScope);
		return css(color ?? accents[index % accents.length]);
	});
	const titleNode = xmlChild(chart, "title");
	const deleted = flag(xmlChild(chart, "autoTitleDeleted")?.attrs.val);
	return {
		type,
		stacked: grouping === "stacked" || grouping === "percentStacked",
		title: titleNode
			? richText(titleNode) || (series.length === 1 ? series[0].name : "")
			: deleted || series.length !== 1
				? ""
				: series[0].name,
		categories,
		series,
		pointColors,
	};
};

const readFrame = (
	frame: XmlNode,
	scope: Scope,
	transform: Transform,
	out: SlideElement[],
) => {
	const key = placeholderOf(frame);
	if (key && scope.layer) return;
	const inherited = key ? inheritedPlaceholders(scope, key) : [];
	const base = [frame, ...inherited]
		.map((node) =>
			boxOf(xmlChild(node, "xfrm") ?? xmlPath(node, "spPr", "xfrm")),
		)
		.find(Boolean);
	if (!base) return;
	const box = transform(base);
	const data = xmlPath(frame, "graphic", "graphicData");
	const table = xmlChild(data, "tbl");
	if (table) {
		readTable(table, box, scope, out);
		return;
	}
	const chartRef = xmlChild(data, "chart");
	if (chartRef) {
		out.push({
			kind: "chart",
			box,
			chart: readChart(
				scope.reader.part(
					scope.reader.target(scope.part, chartRef.attrs["r:id"]),
				),
				scope,
			),
			...(scope.layer ? { layer: scope.layer } : {}),
		});
		return;
	}
	const diagram = xmlChild(data, "relIds");
	if (diagram) {
		const drawing = diagramDrawing(scope, diagram);
		const tree = drawing ? xmlFind(drawing.root, "spTree") : undefined;
		if (drawing && tree) {
			const offset: Transform = (child) =>
				transform({ ...child, x: base.x + child.x, y: base.y + child.y });
			readTree(tree, { ...scope, part: drawing }, offset, out, undefined);
			return;
		}
	}
	// Embedded objects and equations carry a picture of themselves.
	const picture = xmlFind(data, "pic");
	if (picture) readPicture(picture, scope, transform, out, box);
};

/** The drawing PowerPoint saves for a SmartArt diagram. */
const diagramDrawing = (scope: Scope, relIds: XmlNode): Part | null => {
	const data = scope.reader.part(
		scope.reader.target(scope.part, relIds.attrs["r:dm"]),
	);
	const drawingId = data
		? xmlFind(data.root, "dataModelExt")?.attrs.relId
		: undefined;
	return scope.reader.part(scope.reader.target(scope.part, drawingId));
};

const readTree = (
	tree: XmlNode,
	scope: Scope,
	transform: Transform,
	out: SlideElement[],
	groupFill: SlideFill | null | undefined,
) => {
	for (const child of tree.children) {
		switch (child.name) {
			case "sp":
			case "cxnSp":
				readShape(child, scope, transform, out, groupFill);
				break;
			case "pic":
				readPicture(child, scope, transform, out);
				break;
			case "graphicFrame":
				readFrame(child, scope, transform, out);
				break;
			case "grpSp": {
				const properties = xmlChild(child, "grpSpPr");
				const xfrm = xmlChild(properties, "xfrm");
				const outer = boxOf(xfrm);
				const childOffset = xmlChild(xfrm, "chOff");
				const childExtent = xmlChild(xfrm, "chExt");
				const inner: Transform =
					outer && childOffset && childExtent
						? (box) => {
								const scaleX = num(childExtent.attrs.cx)
									? outer.width / num(childExtent.attrs.cx)
									: 1;
								const scaleY = num(childExtent.attrs.cy)
									? outer.height / num(childExtent.attrs.cy)
									: 1;
								return transform({
									...box,
									x: outer.x + (box.x - num(childOffset.attrs.x)) * scaleX,
									y: outer.y + (box.y - num(childOffset.attrs.y)) * scaleY,
									width: box.width * scaleX,
									height: box.height * scaleY,
									rotation: box.rotation + outer.rotation,
								});
							}
						: transform;
				const fill = fillOf(properties, scope, undefined, groupFill);
				readTree(
					child,
					scope,
					inner,
					out,
					fill === undefined ? groupFill : fill,
				);
				break;
			}
			case "AlternateContent": {
				const branch = xmlChild(child, "Fallback") ?? xmlChild(child, "Choice");
				if (branch) readTree(branch, scope, transform, out, groupFill);
				break;
			}
		}
	}
};

const backgroundOf = (
	part: Part | null,
	scope: Scope,
): SlideFill | null | undefined => {
	const background = part
		? xmlPath(part.root.children[0], "cSld", "bg")
		: undefined;
	if (!background || !part) return undefined;
	const partScope = { ...scope, part };
	const properties = xmlChild(background, "bgPr");
	if (properties) return fillOf(properties, partScope) ?? null;
	const ref = xmlChild(background, "bgRef");
	return ref ? referencedFill(ref, partScope) : undefined;
};

const colorMapOf = (part: Part | null): Record<string, string> | null => {
	const root = part?.root.children[0];
	const map =
		xmlChild(root, "clrMap") ??
		xmlPath(root, "clrMapOvr", "overrideClrMapping");
	return map ? { ...map.attrs } : null;
};

const notesOf = (reader: PackageReader, slide: Part): string => {
	const notes = reader.related(slide, "notesSlide");
	const tree = notes ? xmlFind(notes.root, "spTree") : undefined;
	const body = tree?.children.find(
		(shape) => placeholderOf(shape)?.type === "body",
	);
	return xmlChildren(xmlChild(body, "txBody"), "p")
		.map((paragraph) =>
			xmlFindAll(paragraph, "t")
				.map((text) => text.text)
				.join(""),
		)
		.join("\n")
		.trim();
};

/** A .pptx (or .pptm, .ppsx, .potx) file's slides; throws when it is not one. */
export function parsePptx(bytes: Uint8Array): PresentationDeck {
	let files: Record<string, Uint8Array>;
	try {
		files = unzipSync(bytes);
	} catch {
		throw new Error(NOT_A_PRESENTATION);
	}
	const reader = new PackageReader(files);
	const presentation = reader.part("ppt/presentation.xml");
	if (!presentation) throw new Error(NOT_A_PRESENTATION);
	const root = presentation.root.children[0];
	const size = xmlChild(root, "sldSz");
	const defaultTextStyle = xmlChild(root, "defaultTextStyle");
	const slideIds = xmlChildren(xmlChild(root, "sldIdLst"), "sldId");
	const slides = slideIds
		.map((slideId) =>
			reader.part(reader.target(presentation, slideId.attrs["r:id"])),
		)
		.filter((part): part is Part => part !== null)
		.map((slide, index): PresentationSlide => {
			const layout = reader.related(slide, "slideLayout");
			const master = layout ? reader.related(layout, "slideMaster") : null;
			const theme = readTheme(master ? reader.related(master, "theme") : null);
			const colorMap = {
				...(colorMapOf(master) ?? {
					bg1: "lt1",
					tx1: "dk1",
					bg2: "lt2",
					tx2: "dk2",
				}),
				...(colorMapOf(layout) ?? {}),
				...(colorMapOf(slide) ?? {}),
			};
			const scope: Scope = {
				reader,
				part: slide,
				layout,
				master,
				theme,
				colorMap,
				defaultTextStyle,
				slideNumber: index + 1,
			};
			const elements: SlideElement[] = [];
			const slideRoot = slide.root.children[0];
			const layoutRoot = layout?.root.children[0];
			const identity: Transform = (box) => box;
			const showMaster =
				slideRoot?.attrs.showMasterSp !== "0" &&
				layoutRoot?.attrs.showMasterSp !== "0";
			const masterTree = master
				? xmlPath(master.root.children[0], "cSld", "spTree")
				: undefined;
			if (showMaster && master && masterTree) {
				readTree(
					masterTree,
					{ ...scope, part: master, layer: "master" },
					identity,
					elements,
					undefined,
				);
			}
			const layoutTree = layoutRoot
				? xmlPath(layoutRoot, "cSld", "spTree")
				: undefined;
			if (slideRoot?.attrs.showMasterSp !== "0" && layout && layoutTree) {
				readTree(
					layoutTree,
					{ ...scope, part: layout, layer: "layout" },
					identity,
					elements,
					undefined,
				);
			}
			const tree = xmlPath(slideRoot, "cSld", "spTree");
			if (tree) readTree(tree, scope, identity, elements, undefined);
			const background =
				[slide, layout, master]
					.map((part) => backgroundOf(part, scope))
					.find((fill) => fill !== undefined) ?? null;
			return {
				number: index + 1,
				hidden: slideRoot?.attrs.show === "0",
				background,
				elements,
				notes: notesOf(reader, slide),
			};
		});
	return {
		width: num(size?.attrs.cx, DEFAULT_WIDTH),
		height: num(size?.attrs.cy, DEFAULT_HEIGHT),
		slides,
		media: reader.media,
	};
}

const startsWith = (bytes: Uint8Array, signature: number[]) =>
	signature.every((byte, index) => bytes[index] === byte);

/**
 * Slides of a PowerPoint file: .pptx and its kin in full, legacy .ppt as
 * the text of each slide. Throws when the bytes are neither.
 */
export async function readPresentation(
	bytes: Uint8Array,
): Promise<PresentationDeck> {
	if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return parsePptx(bytes);
	if (startsWith(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
		const { parseLegacyPpt } = await import("./ppt-extraction");
		return parseLegacyPpt(bytes);
	}
	throw new Error(NOT_A_PRESENTATION);
}

// ---------------------------------------------------------------- markdown

const escapeCell = (text: string) =>
	text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

const markdownTable = (rows: string[][]): string => {
	const width = Math.max(...rows.map((row) => row.length));
	const line = (row: string[]) =>
		`| ${Array.from({ length: width }, (_, index) => escapeCell(row[index] ?? "")).join(" | ")} |`;
	const [header, ...body] = rows;
	return [
		line(header),
		`| ${Array(width).fill("---").join(" | ")} |`,
		...body.map(line),
	].join("\n");
};

const paragraphText = (paragraph: SlideParagraph) =>
	paragraph.runs
		.map((run) => run.text)
		.join("")
		.replace(/\s+$/, "");

const textMarkdown = (text: SlideText): string =>
	text.paragraphs
		.map((paragraph) => {
			const line = paragraphText(paragraph);
			if (!line.trim()) return "";
			return paragraph.bullet
				? `${"  ".repeat(paragraph.level)}- ${line.trim()}`
				: line;
		})
		.filter(Boolean)
		.join("\n");

const isTitle = (element: SlideElement) =>
	element.kind === "shape" &&
	(element.placeholder === "title" || element.placeholder === "ctrTitle") &&
	hasVisibleText(element.text);

/** Each slide's own text, tables, charts and notes as Markdown. */
export function presentationToMarkdown(deck: PresentationDeck): string {
	return deck.slides
		.map((slide) => {
			const own = slide.elements.filter((element) => !element.layer);
			const title = own.find(isTitle);
			const titleText =
				title?.kind === "shape" && title.text
					? title.text.paragraphs.map(paragraphText).join(" ").trim()
					: "";
			const blocks = [
				`## Slide ${slide.number}${titleText ? `: ${titleText}` : ""}${slide.hidden ? " (hidden)" : ""}`,
			];
			for (const element of own) {
				if (element === title) continue;
				if (element.kind === "shape" && element.text) {
					const text = textMarkdown(element.text);
					if (text) blocks.push(text);
				} else if (element.kind === "table") {
					const rows = element.rows.map((row) =>
						row.cells.map((cell) =>
							cell.text.paragraphs.map(paragraphText).join(" ").trim(),
						),
					);
					if (rows.some((row) => row.some(Boolean)))
						blocks.push(markdownTable(rows));
				} else if (element.kind === "chart" && element.chart) {
					const { chart } = element;
					blocks.push(
						[
							`Chart (${chart.type})${chart.title ? `: ${chart.title}` : ""}`,
							markdownTable([
								["", ...chart.series.map((series) => series.name)],
								...chart.categories.map((category, index) => [
									category,
									...chart.series.map((series) =>
										String(series.values[index] ?? ""),
									),
								]),
							]),
						].join("\n"),
					);
				} else if (element.kind === "picture" && element.description.trim()) {
					blocks.push(`[Image: ${element.description.trim()}]`);
				}
			}
			if (slide.notes) blocks.push(`Notes: ${slide.notes}`);
			return blocks.join("\n\n");
		})
		.join("\n\n");
}
