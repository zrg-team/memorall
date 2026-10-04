/**
 * SVG paths for DrawingML preset shapes, sized to a box. Shapes without a
 * path here draw as their bounding rectangle, which keeps their text and
 * fill in place.
 */

/** Presets drawn as an open line from one corner to the other. */
export const isLinePreset = (name: string): boolean =>
	name === "line" ||
	name === "lineInv" ||
	name.startsWith("straightConnector") ||
	name.startsWith("bentConnector") ||
	name.startsWith("curvedConnector");

const ALIASES: Record<string, string> = {
	flowChartProcess: "rect",
	flowChartAlternateProcess: "roundRect",
	flowChartDecision: "diamond",
	flowChartConnector: "ellipse",
	flowChartTerminator: "pill",
	flowChartInputOutput: "parallelogram",
	flowChartPreparation: "hexagon",
	flowChartManualOperation: "trapezoidDown",
	flowChartOffpageConnector: "homePlateDown",
	round1Rect: "roundRect",
	round2SameRect: "roundRect",
	round2DiagRect: "roundRect",
	snipRoundRect: "roundRect",
	wedgeRoundRectCallout: "roundRect",
	wedgeEllipseCallout: "ellipse",
	donut: "ellipse",
	pie: "ellipse",
	chord: "ellipse",
	blockArc: "ellipse",
	cloud: "ellipse",
	smileyFace: "ellipse",
	star4: "star4",
	star6: "star6",
	star8: "star8",
	pentagon: "homePlate",
};

const polygon = (points: [number, number][]): string =>
	`${points.map(([x, y], index) => `${index ? "L" : "M"}${round(x)} ${round(y)}`).join(" ")} Z`;

const round = (value: number) => Math.round(value * 100) / 100;

const star = (width: number, height: number, points: number, inner: number) =>
	polygon(
		Array.from({ length: points * 2 }, (_, index) => {
			const angle = (Math.PI * index) / points - Math.PI / 2;
			const radius = index % 2 ? inner : 1;
			return [
				width / 2 + (width / 2) * radius * Math.cos(angle),
				height / 2 + (height / 2) * radius * Math.sin(angle),
			] as [number, number];
		}),
	);

const roundedRect = (width: number, height: number, radius: number) => {
	const r = Math.max(0, Math.min(radius, width / 2, height / 2));
	if (!r)
		return polygon([
			[0, 0],
			[width, 0],
			[width, height],
			[0, height],
		]);
	return [
		`M${round(r)} 0 H${round(width - r)}`,
		`A${round(r)} ${round(r)} 0 0 1 ${round(width)} ${round(r)}`,
		`V${round(height - r)}`,
		`A${round(r)} ${round(r)} 0 0 1 ${round(width - r)} ${round(height)}`,
		`H${round(r)}`,
		`A${round(r)} ${round(r)} 0 0 1 0 ${round(height - r)}`,
		`V${round(r)}`,
		`A${round(r)} ${round(r)} 0 0 1 ${round(r)} 0 Z`,
	].join(" ");
};

/** The SVG path of a preset shape in a `width` × `height` box. */
export const presetPath = (
	preset: string,
	width: number,
	height: number,
	adjust: Record<string, number> = {},
): string => {
	const name = ALIASES[preset] ?? preset;
	const short = Math.min(width, height);
	const ratio = (key: string, fallback: number) =>
		(adjust[key] ?? fallback) / 100000;
	const w = width;
	const h = height;
	switch (name) {
		case "roundRect":
			return roundedRect(w, h, short * ratio("adj", 16667));
		case "pill":
			return roundedRect(w, h, short / 2);
		case "ellipse":
			return [
				`M0 ${round(h / 2)}`,
				`A${round(w / 2)} ${round(h / 2)} 0 1 1 ${round(w)} ${round(h / 2)}`,
				`A${round(w / 2)} ${round(h / 2)} 0 1 1 0 ${round(h / 2)} Z`,
			].join(" ");
		case "triangle":
			return polygon([
				[w * ratio("adj", 50000), 0],
				[w, h],
				[0, h],
			]);
		case "rtTriangle":
			return polygon([
				[0, 0],
				[0, h],
				[w, h],
			]);
		case "diamond":
			return polygon([
				[w / 2, 0],
				[w, h / 2],
				[w / 2, h],
				[0, h / 2],
			]);
		case "parallelogram": {
			const x = short * ratio("adj", 25000);
			return polygon([
				[x, 0],
				[w, 0],
				[w - x, h],
				[0, h],
			]);
		}
		case "trapezoid": {
			const x = short * ratio("adj", 25000);
			return polygon([
				[x, 0],
				[w - x, 0],
				[w, h],
				[0, h],
			]);
		}
		case "trapezoidDown": {
			const x = w * 0.2;
			return polygon([
				[0, 0],
				[w, 0],
				[w - x, h],
				[x, h],
			]);
		}
		case "hexagon": {
			const x = short * ratio("adj", 25000);
			return polygon([
				[x, 0],
				[w - x, 0],
				[w, h / 2],
				[w - x, h],
				[x, h],
				[0, h / 2],
			]);
		}
		case "octagon": {
			const c = short * ratio("adj", 29289);
			return polygon([
				[c, 0],
				[w - c, 0],
				[w, c],
				[w, h - c],
				[w - c, h],
				[c, h],
				[0, h - c],
				[0, c],
			]);
		}
		case "homePlate": {
			const x = w - short * ratio("adj", 50000);
			return polygon([
				[0, 0],
				[x, 0],
				[w, h / 2],
				[x, h],
				[0, h],
			]);
		}
		case "homePlateDown": {
			const y = h * 0.8;
			return polygon([
				[0, 0],
				[w, 0],
				[w, y],
				[w / 2, h],
				[0, y],
			]);
		}
		case "chevron": {
			const x = short * ratio("adj", 50000);
			return polygon([
				[0, 0],
				[w - x, 0],
				[w, h / 2],
				[w - x, h],
				[0, h],
				[x, h / 2],
			]);
		}
		case "plus": {
			const c = short * ratio("adj", 25000);
			return polygon([
				[c, 0],
				[w - c, 0],
				[w - c, c],
				[w, c],
				[w, h - c],
				[w - c, h - c],
				[w - c, h],
				[c, h],
				[c, h - c],
				[0, h - c],
				[0, c],
				[c, c],
			]);
		}
		case "rightArrow":
		case "leftArrow": {
			const shaft = h * ratio("adj1", 50000);
			const head = Math.min(w, short * ratio("adj2", 50000));
			const top = (h - shaft) / 2;
			const right: [number, number][] = [
				[0, top],
				[w - head, top],
				[w - head, 0],
				[w, h / 2],
				[w - head, h],
				[w - head, h - top],
				[0, h - top],
			];
			return polygon(
				name === "rightArrow" ? right : right.map(([x, y]) => [w - x, y]),
			);
		}
		case "upArrow":
		case "downArrow": {
			const shaft = w * ratio("adj1", 50000);
			const head = Math.min(h, short * ratio("adj2", 50000));
			const left = (w - shaft) / 2;
			const down: [number, number][] = [
				[left, 0],
				[w - left, 0],
				[w - left, h - head],
				[w, h - head],
				[w / 2, h],
				[0, h - head],
				[left, h - head],
			];
			return polygon(
				name === "downArrow" ? down : down.map(([x, y]) => [x, h - y]),
			);
		}
		case "leftRightArrow": {
			const shaft = h * ratio("adj1", 50000);
			const head = Math.min(w / 2, short * ratio("adj2", 50000));
			const top = (h - shaft) / 2;
			return polygon([
				[0, h / 2],
				[head, 0],
				[head, top],
				[w - head, top],
				[w - head, 0],
				[w, h / 2],
				[w - head, h],
				[w - head, h - top],
				[head, h - top],
				[head, h],
			]);
		}
		case "star4":
			return star(w, h, 4, 0.38);
		case "star5":
			return star(w, h, 5, 0.38);
		case "star6":
			return star(w, h, 6, 0.5);
		case "star8":
			return star(w, h, 8, 0.6);
		case "heart":
			return [
				`M${round(w / 2)} ${round(h * 0.25)}`,
				`C${round(w / 2)} 0 0 0 0 ${round(h * 0.3)}`,
				`C0 ${round(h * 0.6)} ${round(w / 2)} ${round(h * 0.8)} ${round(w / 2)} ${round(h)}`,
				`C${round(w / 2)} ${round(h * 0.8)} ${round(w)} ${round(h * 0.6)} ${round(w)} ${round(h * 0.3)}`,
				`C${round(w)} 0 ${round(w / 2)} 0 ${round(w / 2)} ${round(h * 0.25)} Z`,
			].join(" ");
		default:
			return polygon([
				[0, 0],
				[w, 0],
				[w, h],
				[0, h],
			]);
	}
};
