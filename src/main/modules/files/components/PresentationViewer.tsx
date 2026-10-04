import { ImageOff, Loader2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
	type PresentationDeck,
	type PresentationSlide,
	readPresentation,
	type SlideBox,
	type SlideChart,
	type SlideElement,
	type SlideFill,
	type SlideLine,
	type SlideParagraph,
	type SlideText,
} from "../handlers/pptx-extraction";
import { isLinePreset, presetPath } from "./slide-geometry";

export interface PresentationViewerProps {
	/** The .pptx or .ppt file's bytes. */
	fileData: Uint8Array;
	fileName: string;
	className?: string;
}

/** EMU per CSS pixel at 96 DPI. */
const EMU_PER_PX = 9525;
const px = (emu: number) => emu / EMU_PER_PX;
const ptToPx = (points: number) => (points * 4) / 3;
/** Slides drawn before the user scrolls to them. */
const SLIDE_MARGIN = "800px";
const MAX_SLIDE_WIDTH = 1280;

const IMAGE_TYPES: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	jpe: "image/jpeg",
	gif: "image/gif",
	bmp: "image/bmp",
	webp: "image/webp",
	svg: "image/svg+xml",
	avif: "image/avif",
};

const FONT_FALLBACK =
	'"Calibri", "Carlito", "Segoe UI", "Helvetica Neue", Arial, sans-serif';

const fontFamily = (font: string | null) =>
	font ? `"${font.replace(/"/g, "")}", ${FONT_FALLBACK}` : FONT_FALLBACK;

const cssBackground = (
	fill: SlideFill | null,
	urls: Record<string, string>,
): React.CSSProperties => {
	if (!fill) return {};
	if (fill.kind === "color") return { background: fill.color };
	if (fill.kind === "image") {
		const url = urls[fill.media];
		return url
			? { backgroundImage: `url("${url}")`, backgroundSize: "100% 100%" }
			: {};
	}
	const stops = fill.stops
		.map((stop) => `${stop.color} ${stop.position}%`)
		.join(", ");
	return {
		background: fill.radial
			? `radial-gradient(circle, ${stops})`
			: `linear-gradient(${fill.angle}deg, ${stops})`,
	};
};

const frameStyle = (box: SlideBox): React.CSSProperties => ({
	position: "absolute",
	left: px(box.x),
	top: px(box.y),
	width: px(box.width),
	height: px(box.height),
	transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
});

const flipTransform = (box: SlideBox, width: number, height: number) =>
	box.flipH || box.flipV
		? `translate(${box.flipH ? width : 0} ${box.flipV ? height : 0}) scale(${box.flipH ? -1 : 1} ${box.flipV ? -1 : 1})`
		: undefined;

const dashArray = (line: SlideLine) => {
	const width = Math.max(1, px(line.width));
	switch (line.dash) {
		case "dash":
		case "lgDash":
		case "sysDash":
			return `${width * 4} ${width * 3}`;
		case "dot":
		case "sysDot":
			return `${width} ${width * 2}`;
		case "dashDot":
		case "lgDashDot":
		case "sysDashDot":
			return `${width * 4} ${width * 2} ${width} ${width * 2}`;
		default:
			return undefined;
	}
};

// ---------------------------------------------------------------- text

const Paragraph: React.FC<{ paragraph: SlideParagraph; wrap: boolean }> = ({
	paragraph,
	wrap,
}) => {
	const hanging = paragraph.indent < 0 ? px(-paragraph.indent) : 0;
	const empty = !paragraph.runs.some((run) => run.text);
	return (
		<p
			style={{
				margin: 0,
				paddingLeft: px(paragraph.marginLeft),
				textIndent: px(paragraph.indent),
				textAlign: paragraph.align,
				marginTop: ptToPx(paragraph.spaceBefore),
				marginBottom: ptToPx(paragraph.spaceAfter),
				fontSize: ptToPx(paragraph.size),
				lineHeight: paragraph.lineHeightPoints
					? `${ptToPx(paragraph.lineHeightPoints)}px`
					: paragraph.lineHeight,
				whiteSpace: wrap ? "pre-wrap" : "pre",
				overflowWrap: wrap ? "break-word" : undefined,
			}}
		>
			{paragraph.bullet ? (
				<span
					style={{
						display: "inline-block",
						minWidth: hanging || undefined,
						paddingRight: hanging ? 0 : "0.4em",
						textIndent: 0,
						color: paragraph.bullet.color,
						fontFamily: fontFamily(paragraph.bullet.font),
					}}
				>
					{paragraph.bullet.text}
				</span>
			) : null}
			{empty ? <br /> : null}
			{paragraph.runs.map((run, index) =>
				run.text === "\n" ? (
					// biome-ignore lint/suspicious/noArrayIndexKey: runs have no ids
					<br key={index} />
				) : (
					<span
						// biome-ignore lint/suspicious/noArrayIndexKey: runs have no ids
						key={index}
						style={{
							fontSize: ptToPx(run.size),
							fontWeight: run.bold ? 700 : 400,
							fontStyle: run.italic ? "italic" : undefined,
							textDecoration:
								[run.underline && "underline", run.strike && "line-through"]
									.filter(Boolean)
									.join(" ") || undefined,
							textTransform: run.caps ? "uppercase" : undefined,
							color: run.color,
							fontFamily: fontFamily(run.font),
							verticalAlign: run.baseline
								? `${run.baseline * 0.01}em`
								: undefined,
						}}
					>
						{run.text}
					</span>
				),
			)}
		</p>
	);
};

const TextFrame: React.FC<{ text: SlideText; className?: string }> = ({
	text,
	className,
}) => (
	<div
		className={className}
		style={{
			position: "absolute",
			inset: 0,
			display: "flex",
			flexDirection: "column",
			justifyContent:
				text.anchor === "middle"
					? "center"
					: text.anchor === "bottom"
						? "flex-end"
						: "flex-start",
			padding: `${px(text.insets.top)}px ${px(text.insets.right)}px ${px(text.insets.bottom)}px ${px(text.insets.left)}px`,
			writingMode: text.vertical === "none" ? undefined : "vertical-rl",
			transform: text.vertical === "up" ? "rotate(180deg)" : undefined,
		}}
	>
		{text.paragraphs.map((paragraph, index) => (
			// biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no ids
			<Paragraph key={index} paragraph={paragraph} wrap={text.wrap} />
		))}
	</div>
);

// ---------------------------------------------------------------- elements

const ShapeView: React.FC<{
	element: Extract<SlideElement, { kind: "shape" }>;
	urls: Record<string, string>;
}> = ({ element, urls }) => {
	const id = React.useId().replace(/:/g, "");
	const { box, geometry, fill, line } = element;
	const width = px(box.width);
	const height = px(box.height);
	const isLine = geometry.kind === "preset" && isLinePreset(geometry.name);
	let paint = "none";
	let definition: React.ReactNode = null;
	if (fill && !isLine) {
		if (fill.kind === "color") paint = fill.color;
		else if (fill.kind === "gradient") {
			paint = `url(#${id}-fill)`;
			const stops = fill.stops.map((stop, index) => (
				<stop
					// biome-ignore lint/suspicious/noArrayIndexKey: stops have no ids
					key={index}
					offset={`${stop.position}%`}
					stopColor={stop.color}
				/>
			));
			definition = fill.radial ? (
				<radialGradient id={`${id}-fill`}>{stops}</radialGradient>
			) : (
				<linearGradient
					id={`${id}-fill`}
					gradientTransform={`rotate(${fill.angle - 90}, 0.5, 0.5)`}
				>
					{stops}
				</linearGradient>
			);
		} else if (urls[fill.media]) {
			paint = `url(#${id}-fill)`;
			definition = (
				<pattern
					id={`${id}-fill`}
					patternContentUnits="objectBoundingBox"
					width={1}
					height={1}
				>
					<image
						href={urls[fill.media]}
						width={1}
						height={1}
						preserveAspectRatio="none"
					/>
				</pattern>
			);
		}
	}
	const stroke = line
		? {
				stroke: line.color,
				strokeWidth: Math.max(0.75, px(line.width)),
				strokeDasharray: dashArray(line),
			}
		: { stroke: "none" };
	const markers = line && isLine && (line.head || line.tail);
	const paths =
		geometry.kind === "custom"
			? geometry.paths.map((path, index) => (
					<svg
						// biome-ignore lint/suspicious/noArrayIndexKey: paths have no ids
						key={index}
						viewBox={`0 0 ${path.width || width} ${path.height || height}`}
						width={width}
						height={height}
						preserveAspectRatio="none"
						overflow="visible"
					>
						<path
							d={path.d}
							fill={path.filled ? paint : "none"}
							{...(path.stroked ? stroke : { stroke: "none" })}
							vectorEffect="non-scaling-stroke"
						/>
					</svg>
				))
			: [
					<path
						key="shape"
						d={
							isLine
								? `M0 0 L${width} ${height}`
								: presetPath(geometry.name, width, height, geometry.adjust)
						}
						fill={isLine ? "none" : paint}
						{...stroke}
						markerStart={
							markers && line?.head ? `url(#${id}-arrow)` : undefined
						}
						markerEnd={markers && line?.tail ? `url(#${id}-arrow)` : undefined}
					/>,
				];
	return (
		<div style={frameStyle(box)}>
			{fill || line ? (
				<svg
					width={Math.max(width, 1)}
					height={Math.max(height, 1)}
					overflow="visible"
					style={{ position: "absolute", inset: 0, overflow: "visible" }}
					aria-hidden="true"
				>
					<defs>
						{definition}
						{markers ? (
							<marker
								id={`${id}-arrow`}
								viewBox="0 0 10 10"
								refX={5}
								refY={5}
								markerWidth={4}
								markerHeight={4}
								orient="auto-start-reverse"
							>
								<path d="M0 0 L10 5 L0 10 Z" fill={line?.color} />
							</marker>
						) : null}
					</defs>
					<g transform={flipTransform(box, width, height)}>{paths}</g>
				</svg>
			) : null}
			{element.text ? <TextFrame text={element.text} /> : null}
		</div>
	);
};

const PictureView: React.FC<{
	element: Extract<SlideElement, { kind: "picture" }>;
	urls: Record<string, string>;
}> = ({ element, urls }) => {
	const url = urls[element.media];
	const { crop, box, line } = element;
	const shownWidth = crop ? 1 - crop.left - crop.right : 1;
	const shownHeight = crop ? 1 - crop.top - crop.bottom : 1;
	return (
		<div
			style={{
				...frameStyle(box),
				overflow: "hidden",
				outline: line
					? `${Math.max(0.75, px(line.width))}px solid ${line.color}`
					: undefined,
			}}
		>
			{url ? (
				<img
					src={url}
					alt={element.description}
					draggable={false}
					style={{
						position: "absolute",
						maxWidth: "none",
						left: `${crop && shownWidth > 0 ? (-crop.left / shownWidth) * 100 : 0}%`,
						top: `${crop && shownHeight > 0 ? (-crop.top / shownHeight) * 100 : 0}%`,
						width: `${shownWidth > 0 ? 100 / shownWidth : 100}%`,
						height: `${shownHeight > 0 ? 100 / shownHeight : 100}%`,
						transform:
							box.flipH || box.flipV
								? `scale(${box.flipH ? -1 : 1}, ${box.flipV ? -1 : 1})`
								: undefined,
					}}
				/>
			) : (
				<div className="flex h-full w-full items-center justify-center bg-zinc-100 text-zinc-400">
					<ImageOff style={{ width: "30%", height: "30%", maxWidth: 48 }} />
				</div>
			)}
		</div>
	);
};

const borderStyle = (line: SlideLine | null) =>
	line ? `${Math.max(0.75, px(line.width))}px solid ${line.color}` : undefined;

const TableView: React.FC<{
	element: Extract<SlideElement, { kind: "table" }>;
}> = ({ element }) => (
	<div style={{ ...frameStyle(element.box), height: undefined }}>
		<table
			style={{
				borderCollapse: "collapse",
				tableLayout: "fixed",
				width: px(element.columns.reduce((sum, column) => sum + column, 0)),
			}}
		>
			<colgroup>
				{element.columns.map((column, index) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: columns have no ids
					<col key={index} style={{ width: px(column) }} />
				))}
			</colgroup>
			<tbody>
				{element.rows.map((row, rowIndex) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: rows have no ids
					<tr key={rowIndex} style={{ height: px(row.height) }}>
						{row.cells.map((cell, cellIndex) =>
							cell.merged ? null : (
								<td
									// biome-ignore lint/suspicious/noArrayIndexKey: cells have no ids
									key={cellIndex}
									colSpan={cell.columnSpan}
									rowSpan={cell.rowSpan}
									style={{
										position: "relative",
										padding: 0,
										background: cell.fill ?? undefined,
										borderTop: borderStyle(cell.borders.top),
										borderRight: borderStyle(cell.borders.right),
										borderBottom: borderStyle(cell.borders.bottom),
										borderLeft: borderStyle(cell.borders.left),
										verticalAlign:
											cell.text.anchor === "middle"
												? "middle"
												: cell.text.anchor === "bottom"
													? "bottom"
													: "top",
									}}
								>
									<div
										style={{
											padding: `${px(cell.text.insets.top)}px ${px(cell.text.insets.right)}px ${px(cell.text.insets.bottom)}px ${px(cell.text.insets.left)}px`,
										}}
									>
										{cell.text.paragraphs.map((paragraph, index) => (
											<Paragraph
												// biome-ignore lint/suspicious/noArrayIndexKey: paragraphs have no ids
												key={index}
												paragraph={paragraph}
												wrap
											/>
										))}
									</div>
								</td>
							),
						)}
					</tr>
				))}
			</tbody>
		</table>
	</div>
);

const formatValue = (value: number) =>
	Math.abs(value) >= 1000
		? Intl.NumberFormat(undefined, { notation: "compact" }).format(value)
		: String(Math.round(value * 100) / 100);

/** A chart drawn from the values the file caches for it. */
const ChartView: React.FC<{
	chart: SlideChart;
	width: number;
	height: number;
}> = ({ chart, width, height }) => {
	const font = Math.max(9, Math.min(16, height / 22));
	const titleSpace = chart.title ? font * 2.2 : font * 0.6;
	const round = chart.type === "pie" || chart.type === "doughnut";
	const legend = round
		? chart.categories.map((name, index) => ({
				name,
				color: chart.pointColors[index],
			}))
		: chart.series.length > 1
			? chart.series.map((series) => ({
					name: series.name,
					color: series.color,
				}))
			: [];
	const legendSpace = legend.length ? font * 2 : 0;
	const plotTop = titleSpace;
	const plotHeight = Math.max(10, height - titleSpace - legendSpace);
	let body: React.ReactNode;
	if (round) {
		const values = (chart.series[0]?.values ?? []).map((value) =>
			Math.max(0, value ?? 0),
		);
		const total = values.reduce((sum, value) => sum + value, 0) || 1;
		const radius = Math.min(width, plotHeight) / 2 - font * 0.5;
		const centerX = width / 2;
		const centerY = plotTop + plotHeight / 2;
		let angle = -Math.PI / 2;
		body = values.map((value, index) => {
			const sweep = (value / total) * Math.PI * 2;
			const start = angle;
			angle += sweep;
			const large = sweep > Math.PI ? 1 : 0;
			const x1 = centerX + radius * Math.cos(start);
			const y1 = centerY + radius * Math.sin(start);
			const x2 = centerX + radius * Math.cos(angle);
			const y2 = centerY + radius * Math.sin(angle);
			return (
				<path
					// biome-ignore lint/suspicious/noArrayIndexKey: points have no ids
					key={index}
					d={
						sweep >= Math.PI * 2 - 1e-6
							? `M${centerX - radius} ${centerY} a${radius} ${radius} 0 1 0 ${radius * 2} 0 a${radius} ${radius} 0 1 0 ${-radius * 2} 0`
							: `M${centerX} ${centerY} L${x1} ${y1} A${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`
					}
					fill={chart.pointColors[index]}
					stroke="#fff"
					strokeWidth={1}
				/>
			);
		});
		if (chart.type === "doughnut") {
			body = (
				<>
					{body}
					<circle cx={centerX} cy={centerY} r={radius * 0.5} fill="#fff" />
				</>
			);
		}
	} else {
		const count = Math.max(
			chart.categories.length,
			...chart.series.map((series) => series.values.length),
		);
		const totals = Array.from({ length: count }, (_, index) =>
			chart.series.reduce(
				(sum, series) => sum + Math.max(0, series.values[index] ?? 0),
				0,
			),
		);
		const all = chart.series.flatMap((series) =>
			series.values.filter((value): value is number => value !== null),
		);
		const max = Math.max(0, ...(chart.stacked ? totals : all));
		const min = Math.min(0, ...all);
		const range = max - min || 1;
		const horizontal = chart.type === "bar";
		const axisSpace = font * 3.2;
		const left = horizontal ? Math.min(width * 0.3, font * 6) : axisSpace;
		const plotWidth = Math.max(10, width - left - font);
		const bottomSpace = font * 1.8;
		const innerHeight = plotHeight - bottomSpace;
		const valueAt = (value: number) =>
			horizontal
				? left + ((value - min) / range) * plotWidth
				: plotTop + innerHeight - ((value - min) / range) * innerHeight;
		const band = (horizontal ? innerHeight : plotWidth) / Math.max(1, count);
		const ticks = Array.from(
			{ length: 5 },
			(_, index) => min + (range * index) / 4,
		);
		const grid = ticks.map((tick) => {
			const at = valueAt(tick);
			return (
				<g key={tick}>
					<line
						x1={horizontal ? at : left}
						x2={horizontal ? at : left + plotWidth}
						y1={horizontal ? plotTop : at}
						y2={horizontal ? plotTop + innerHeight : at}
						stroke="#d9d9d9"
						strokeWidth={0.75}
					/>
					<text
						x={horizontal ? at : left - font * 0.4}
						y={
							horizontal ? plotTop + innerHeight + font * 1.2 : at + font * 0.35
						}
						fontSize={font}
						fill="#595959"
						textAnchor={horizontal ? "middle" : "end"}
					>
						{formatValue(tick)}
					</text>
				</g>
			);
		});
		const labels = chart.categories.map((category, index) => {
			const at = (horizontal ? plotTop : left) + band * (index + 0.5);
			return (
				<text
					// biome-ignore lint/suspicious/noArrayIndexKey: categories have no ids
					key={index}
					x={horizontal ? left - font * 0.4 : at}
					y={horizontal ? at + font * 0.35 : plotTop + innerHeight + font * 1.2}
					fontSize={font}
					fill="#595959"
					textAnchor={horizontal ? "end" : "middle"}
				>
					{category.length > 14 ? `${category.slice(0, 13)}…` : category}
				</text>
			);
		});
		let marks: React.ReactNode;
		if (chart.type === "bar" || chart.type === "column") {
			const groups = chart.stacked ? 1 : Math.max(1, chart.series.length);
			const thickness = (band * 0.7) / groups;
			const stackBase = Array<number>(count).fill(0);
			marks = chart.series.map((series, seriesIndex) =>
				series.values.map((value, index) => {
					if (value === null) return null;
					const from = chart.stacked ? stackBase[index] : 0;
					const to = from + value;
					if (chart.stacked) stackBase[index] = to;
					const offset =
						band * index +
						band * 0.15 +
						(chart.stacked ? 0 : thickness * seriesIndex);
					const a = valueAt(from);
					const b = valueAt(to);
					return (
						<rect
							// biome-ignore lint/suspicious/noArrayIndexKey: points have no ids
							key={`${seriesIndex}-${index}`}
							x={horizontal ? Math.min(a, b) : left + offset}
							y={horizontal ? plotTop + offset : Math.min(a, b)}
							width={horizontal ? Math.abs(b - a) : thickness}
							height={horizontal ? thickness : Math.abs(b - a)}
							fill={series.color}
						/>
					);
				}),
			);
		} else {
			const stackBase = Array<number>(count).fill(0);
			marks = chart.series.map((series, seriesIndex) => {
				const points = series.values
					.map((value, index) => {
						if (value === null) return null;
						const total = chart.stacked ? stackBase[index] + value : value;
						if (chart.stacked) stackBase[index] = total;
						return [left + band * (index + 0.5), valueAt(total)] as const;
					})
					.filter((point) => point !== null);
				const d = points
					.map(([x, y], index) => `${index ? "L" : "M"}${x} ${y}`)
					.join(" ");
				if (chart.type === "area" && points.length) {
					const base = valueAt(Math.max(min, 0));
					return (
						<path
							key={seriesIndex}
							d={`${d} L${points[points.length - 1][0]} ${base} L${points[0][0]} ${base} Z`}
							fill={series.color}
							fillOpacity={0.75}
						/>
					);
				}
				return (
					<g key={seriesIndex}>
						{chart.type === "line" ? (
							<path
								d={d}
								fill="none"
								stroke={series.color}
								strokeWidth={font / 4}
							/>
						) : null}
						{points.map(([x, y], index) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: points have no ids
							<circle
								key={index}
								cx={x}
								cy={y}
								r={font / 3}
								fill={series.color}
							/>
						))}
					</g>
				);
			});
		}
		body = (
			<>
				{grid}
				{labels}
				{marks}
			</>
		);
	}
	return (
		<svg
			width={width}
			height={height}
			style={{ fontFamily: FONT_FALLBACK }}
			aria-hidden="true"
		>
			<rect width={width} height={height} fill="#fff" />
			{chart.title ? (
				<text
					x={width / 2}
					y={font * 1.5}
					fontSize={font * 1.3}
					fill="#404040"
					textAnchor="middle"
				>
					{chart.title}
				</text>
			) : null}
			{body}
			{legend.length ? (
				<g>
					{legend.map((entry, index) => {
						const slot = width / legend.length;
						const x = slot * index + slot / 2 - font * 2;
						const y = height - font * 0.9;
						return (
							// biome-ignore lint/suspicious/noArrayIndexKey: entries have no ids
							<g key={index}>
								<rect
									x={x}
									y={y - font * 0.75}
									width={font * 0.8}
									height={font * 0.8}
									fill={entry.color}
								/>
								<text x={x + font * 1.1} y={y} fontSize={font} fill="#595959">
									{entry.name.length > 16
										? `${entry.name.slice(0, 15)}…`
										: entry.name}
								</text>
							</g>
						);
					})}
				</g>
			) : null}
		</svg>
	);
};

const ElementView: React.FC<{
	element: SlideElement;
	urls: Record<string, string>;
	chartLabel: string;
}> = ({ element, urls, chartLabel }) => {
	switch (element.kind) {
		case "shape":
			return <ShapeView element={element} urls={urls} />;
		case "picture":
			return <PictureView element={element} urls={urls} />;
		case "table":
			return <TableView element={element} />;
		case "chart":
			return (
				<div style={frameStyle(element.box)}>
					{element.chart ? (
						<ChartView
							chart={element.chart}
							width={px(element.box.width)}
							height={px(element.box.height)}
						/>
					) : (
						<div className="flex h-full w-full items-center justify-center border border-dashed border-zinc-300 bg-zinc-50 text-zinc-400">
							{chartLabel}
						</div>
					)}
				</div>
			);
	}
};

// ---------------------------------------------------------------- slides

const SlideCanvas: React.FC<{
	deck: PresentationDeck;
	slide: PresentationSlide;
	width: number;
	urls: Record<string, string>;
	chartLabel: string;
}> = ({ deck, slide, width, urls, chartLabel }) => {
	const holderRef = React.useRef<HTMLDivElement>(null);
	const [visible, setVisible] = React.useState(false);
	const scale = width / px(deck.width);
	const height = Math.round(px(deck.height) * scale);

	React.useEffect(() => {
		const holder = holderRef.current;
		if (!holder) return;
		if (typeof IntersectionObserver === "undefined") {
			setVisible(true);
			return;
		}
		const observer = new IntersectionObserver(
			([entry]) => {
				if (entry?.isIntersecting) setVisible(true);
			},
			{ rootMargin: SLIDE_MARGIN },
		);
		observer.observe(holder);
		return () => observer.disconnect();
	}, []);

	return (
		<div
			ref={holderRef}
			className={cn(
				"relative overflow-hidden rounded-sm bg-white shadow-sm ring-1 ring-black/10",
				slide.hidden && "opacity-60",
			)}
			style={{ width, height }}
			data-slide={slide.number}
		>
			{visible ? (
				<div
					style={{
						position: "absolute",
						left: 0,
						top: 0,
						width: px(deck.width),
						height: px(deck.height),
						transform: `scale(${scale})`,
						transformOrigin: "0 0",
						color: "#000",
						fontFamily: FONT_FALLBACK,
						...cssBackground(slide.background, urls),
					}}
				>
					{slide.elements.map((element, index) => (
						<ElementView
							// biome-ignore lint/suspicious/noArrayIndexKey: elements keep their slide order
							key={index}
							element={element}
							urls={urls}
							chartLabel={chartLabel}
						/>
					))}
				</div>
			) : null}
		</div>
	);
};

/** Object URLs for the pictures a deck uses, revoked when it closes. */
const useMediaUrls = (deck: PresentationDeck | null) => {
	const [urls, setUrls] = React.useState<Record<string, string>>({});
	React.useEffect(() => {
		if (!deck) return;
		const created: Record<string, string> = {};
		for (const [path, bytes] of Object.entries(deck.media)) {
			const type =
				IMAGE_TYPES[/\.([^./]+)$/.exec(path.toLowerCase())?.[1] ?? ""];
			if (type)
				created[path] = URL.createObjectURL(
					new Blob([bytes.slice()], { type }),
				);
		}
		setUrls(created);
		return () => {
			for (const url of Object.values(created)) URL.revokeObjectURL(url);
		};
	}, [deck]);
	return urls;
};

/**
 * A PowerPoint file's slides, drawn in the page: shapes, text, pictures,
 * tables and charts. Older .ppt files show each slide's text.
 */
export const PresentationViewer: React.FC<PresentationViewerProps> = ({
	fileData,
	fileName,
	className,
}) => {
	const { t } = useTranslation("documents");
	const scrollRef = React.useRef<HTMLDivElement>(null);
	const [deck, setDeck] = React.useState<PresentationDeck | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [width, setWidth] = React.useState(0);
	const urls = useMediaUrls(deck);

	React.useEffect(() => {
		let cancelled = false;
		setDeck(null);
		setError(null);
		readPresentation(fileData).then(
			(next) => {
				if (!cancelled) setDeck(next);
			},
			(reason: unknown) => {
				if (!cancelled) {
					setError(reason instanceof Error ? reason.message : String(reason));
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [fileData]);

	React.useEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		const measure = () =>
			setWidth(
				Math.min(MAX_SLIDE_WIDTH, Math.max(0, element.clientWidth - 32)),
			);
		measure();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	const chartLabel = t("presentationViewer.chart");
	return (
		<div
			ref={scrollRef}
			className={cn(
				"h-full min-h-0 w-full overflow-auto bg-muted/40",
				className,
			)}
			aria-label={fileName}
		>
			{error ? (
				<div className="flex h-full items-center justify-center p-4 text-center text-xs text-red-700 dark:text-red-300">
					{error}
				</div>
			) : !deck ? (
				<div className="flex h-full items-center justify-center gap-2 p-4 text-xs text-muted-foreground">
					<Loader2 size={14} className="animate-spin" />
					{t("presentationViewer.opening")}
				</div>
			) : !deck.slides.length ? (
				<div className="flex h-full items-center justify-center p-4 text-xs text-muted-foreground">
					{t("presentationViewer.empty")}
				</div>
			) : (
				<div className="flex flex-col items-center gap-4 px-4 py-4">
					{deck.textOnly ? (
						<p className="max-w-xl text-center text-[11px] text-muted-foreground">
							{t("presentationViewer.textOnly")}
						</p>
					) : null}
					{width > 0
						? deck.slides.map((slide) => (
								<figure
									key={slide.number}
									className="m-0 flex flex-col gap-1.5"
								>
									<SlideCanvas
										deck={deck}
										slide={slide}
										width={width}
										urls={urls}
										chartLabel={chartLabel}
									/>
									<figcaption
										className="flex items-baseline gap-2 text-[11px] text-muted-foreground"
										style={{ width }}
									>
										<span className="shrink-0 font-medium">
											{t("presentationViewer.slide", { number: slide.number })}
											{slide.hidden
												? ` · ${t("presentationViewer.hidden")}`
												: ""}
										</span>
										{slide.notes ? (
											<span className="min-w-0 whitespace-pre-wrap">
												{slide.notes}
											</span>
										) : null}
									</figcaption>
								</figure>
							))
						: null}
				</div>
			)}
		</div>
	);
};
