import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { OCRBlock } from "./ocr-document";
import { OCRPreview } from "./OCRPreview";

function blockColor(label: string): string {
	const type = label.replace(/\+$/, "");
	if (type === "title") return "text-amber-600 dark:text-amber-400";
	if (type === "table" || type === "chart")
		return "text-teal-600 dark:text-teal-400";
	if (type.includes("image")) return "text-violet-600 dark:text-violet-400";
	if (type === "list") return "text-cyan-600 dark:text-cyan-400";
	if (type === "header" || type === "footer" || type === "page_number")
		return "text-muted-foreground";
	return "text-blue-600 dark:text-blue-400";
}

interface LinkedBlocksProps {
	blocks: OCRBlock[];
	active: number | null;
	onSelect: (index: number) => void;
	onHighlight: (index: number | null) => void;
}

export function OCRBlockLegend({ blocks }: { blocks: OCRBlock[] }) {
	const { t } = useTranslation("studio");
	const counts = new Map<string, number>();
	for (const block of blocks)
		counts.set(block.label, (counts.get(block.label) ?? 0) + 1);
	return (
		<div
			className="flex flex-wrap gap-2 text-xs"
			aria-label={t("ocr.blockTypes")}
		>
			{[...counts].map(([label, count]) => (
				<span
					key={label}
					className="inline-flex items-center gap-1.5 rounded-full border bg-background px-2 py-1"
				>
					<span
						className={cn(
							"h-1.5 w-1.5 rounded-full bg-current",
							blockColor(label),
						)}
						aria-hidden="true"
					/>
					<span>{label.replaceAll("_", " ")}</span>
					<span className="text-muted-foreground">{count}</span>
				</span>
			))}
		</div>
	);
}

export function OCRDocumentOverlay({
	blocks,
	active,
	onSelect,
	onHighlight,
}: LinkedBlocksProps) {
	const { t } = useTranslation("studio");
	return (
		<svg
			className="pointer-events-none absolute inset-0 h-full w-full"
			viewBox="0 0 1000 1000"
			preserveAspectRatio="none"
			aria-label={t("ocr.layout")}
			role="group"
		>
			{blocks.map((block, index) => (
				<rect
					key={index}
					data-ocr-box={index}
					data-active={active === index}
					className={cn(
						"pointer-events-auto cursor-pointer focus:outline-none focus:stroke-[5]",
						blockColor(block.label),
					)}
					x={block.x}
					y={block.y}
					width={block.width}
					height={block.height}
					fill="currentColor"
					fillOpacity={active === index ? 0.24 : 0.08}
					stroke="currentColor"
					strokeWidth={active === index ? 4 : 1.5}
					role="button"
					tabIndex={0}
					aria-pressed={active === index}
					aria-label={t("ocr.region", { label: block.label, index: index + 1 })}
					onClick={() => onSelect(index)}
					onMouseEnter={() => onHighlight(index)}
					onMouseLeave={() => onHighlight(null)}
					onFocus={() => onHighlight(index)}
					onBlur={() => onHighlight(null)}
					onKeyDown={(event) => {
						if (event.key === "Enter" || event.key === " ") {
							event.preventDefault();
							onSelect(index);
						}
					}}
				>
					<title>{block.label}</title>
				</rect>
			))}
		</svg>
	);
}

export function OCRBlocks({
	blocks,
	active,
	onSelect,
	onHighlight,
}: LinkedBlocksProps) {
	const { t } = useTranslation("studio");
	return (
		<div className="space-y-3" role="list" aria-label={t("ocr.blocks")}>
			{blocks.map((block, index) => (
				<div key={index} role="listitem">
					<div
						role="button"
						tabIndex={0}
						data-ocr-block={index}
						data-active={active === index}
						aria-pressed={active === index}
						aria-label={t("ocr.block", {
							label: block.label,
							index: index + 1,
						})}
						className={cn(
							"cursor-pointer rounded-lg border border-l-2 border-l-current bg-muted/20 p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
							blockColor(block.label),
							active === index && "bg-accent ring-2 ring-ring",
						)}
						onClick={() => onSelect(index)}
						onMouseEnter={() => onHighlight(index)}
						onMouseLeave={() => onHighlight(null)}
						onFocus={() => onHighlight(index)}
						onBlur={() => onHighlight(null)}
						onKeyDown={(event) => {
							if (event.key === "Enter" || event.key === " ") {
								event.preventDefault();
								onSelect(index);
							}
						}}
					>
						<div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
							<span
								className={cn("font-medium uppercase", blockColor(block.label))}
							>
								{block.label.replaceAll("_", " ")}
							</span>
							<span className="font-mono text-muted-foreground">
								{[
									block.x,
									block.y,
									block.x + block.width,
									block.y + block.height,
								].join(", ")}
							</span>
						</div>
						<div className="prose prose-sm max-w-none overflow-x-auto break-words text-foreground dark:prose-invert">
							<OCRPreview markdown={block.content} />
						</div>
					</div>
				</div>
			))}
		</div>
	);
}
