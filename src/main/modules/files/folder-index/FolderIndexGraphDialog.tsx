import * as d3 from "d3";
import { Folder, Loader2, Maximize, Search, Share2 } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { Input } from "@/main/components/ui/input";
import { folderIndexClient } from "@/services/folder-index/folder-index-client";
import type { FolderIndexGraph } from "@/services/folder-index/types";
import { type CardLink, FolderIndexCardView } from "./FolderIndexCardView";
import { useFolderIndex } from "./FolderIndexContext";
import { IndexTypeBadge } from "./IndexTypeBadge";

type GraphNode = FolderIndexGraph["nodes"][number] & d3.SimulationNodeDatum;
type GraphEdge = d3.SimulationLinkDatum<GraphNode> & {
	kind: "contains" | "link";
};

/** Colours for concept types, in order of first appearance. */
const TYPE_COLORS = d3.schemeTableau10;
const endpoint = (end: string | number | GraphNode): string =>
	typeof end === "object" ? end.id : String(end);

/**
 * A folder's OKF index as a graph: folders hold cards (thin lines), cards
 * link to cards (accent arrows). Selecting a card opens it in the side panel
 * and highlights what it connects to; the panel's links move the selection.
 */
export const FolderIndexGraphDialog: React.FC = () => {
	const { t } = useTranslation("documents");
	const index = useFolderIndex();
	const path = index?.graphPath ?? null;
	const [graph, setGraph] = React.useState<FolderIndexGraph | null>(null);
	const [error, setError] = React.useState<string | null>(null);
	const [hovered, setHovered] = React.useState<GraphNode | null>(null);
	const [selected, setSelected] = React.useState<string | null>(null);
	const [query, setQuery] = React.useState("");
	// Bumped when a new drawing exists, so the highlight is applied to it.
	const [highlight, setHighlight] = React.useState(0);
	const openCard = index?.openCard;
	const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
	const view = React.useRef<{
		svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
		zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
		nodes: GraphNode[];
		node: d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>;
		link: d3.Selection<SVGLineElement, GraphEdge, SVGGElement, unknown>;
		width: number;
		height: number;
	} | null>(null);

	React.useEffect(() => {
		setGraph(null);
		setError(null);
		setSelected(null);
		setQuery("");
		if (!path) return;
		let cancelled = false;
		void folderIndexClient
			.request("folder.graph", { path })
			.then((result) => {
				if (!cancelled) setGraph(result);
			})
			.catch((err: unknown) => {
				if (!cancelled)
					setError(err instanceof Error ? err.message : String(err));
			});
		return () => {
			cancelled = true;
		};
	}, [path]);

	const typeColor = React.useMemo(() => {
		const types = [
			...new Set(
				(graph?.nodes ?? []).flatMap((node) => (node.type ? [node.type] : [])),
			),
		];
		return new Map(
			types.map((type, i) => [type, TYPE_COLORS[i % TYPE_COLORS.length]]),
		);
	}, [graph]);

	const labels = React.useMemo(
		() => new Map((graph?.nodes ?? []).map((node) => [node.id, node.label])),
		[graph],
	);

	/** Moves the view so a node sits in the middle. */
	const centerOn = React.useCallback((id: string) => {
		const current = view.current;
		const target = current?.nodes.find((node) => node.id === id);
		if (!current || target?.x === undefined || target.y === undefined) return;
		const scale = Math.max(
			d3.zoomTransform(current.svg.node() as Element).k,
			1.2,
		);
		current.svg
			.transition()
			.duration(450)
			.call(
				current.zoom.transform,
				d3.zoomIdentity
					.translate(current.width / 2, current.height / 2)
					.scale(scale)
					.translate(-target.x, -target.y),
			);
	}, []);

	/** Frames every node. */
	const frameAll = React.useCallback(() => {
		const current = view.current;
		if (!current?.nodes.length) return;
		const xs = current.nodes.map((node) => node.x ?? 0);
		const ys = current.nodes.map((node) => node.y ?? 0);
		const [minX, maxX] = [Math.min(...xs), Math.max(...xs)];
		const [minY, maxY] = [Math.min(...ys), Math.max(...ys)];
		const scale = Math.min(
			2,
			0.85 /
				Math.max(
					(maxX - minX + 80) / current.width,
					(maxY - minY + 80) / current.height,
				),
		);
		current.svg
			.transition()
			.duration(450)
			.call(
				current.zoom.transform,
				d3.zoomIdentity
					.translate(current.width / 2, current.height / 2)
					.scale(scale)
					.translate(-(minX + maxX) / 2, -(minY + maxY) / 2),
			);
	}, []);

	React.useEffect(() => {
		if (!graph || !container) return;
		const width = container.clientWidth || 800;
		const height = container.clientHeight || 520;
		const nodes: GraphNode[] = graph.nodes.map((node) => ({ ...node }));
		const edges: GraphEdge[] = graph.edges.map((edge) => ({ ...edge }));
		const svg = d3
			.select(container)
			.append("svg")
			.attr("width", "100%")
			.attr("height", "100%")
			.attr("viewBox", `0 0 ${width} ${height}`)
			.attr("preserveAspectRatio", "xMidYMid meet")
			.attr("class", "absolute inset-0 block");
		svg
			.append("defs")
			.append("marker")
			.attr("id", "okf-arrow")
			.attr("viewBox", "0 -4 8 8")
			.attr("refX", 16)
			.attr("markerWidth", 6)
			.attr("markerHeight", 6)
			.attr("orient", "auto")
			.append("path")
			.attr("d", "M0,-4L8,0L0,4")
			.attr("fill", "#0ea5e9");
		const layer = svg.append("g");
		const zoom = d3
			.zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.15, 5])
			.on("zoom", (event) => layer.attr("transform", event.transform));
		svg.call(zoom).on("dblclick.zoom", null);
		svg.on("click", (event) => {
			if (event.target === svg.node()) setSelected(null);
		});

		const link = layer
			.append("g")
			.selectAll<SVGLineElement, GraphEdge>("line")
			.data(edges)
			.join("line")
			.attr("stroke", (edge) =>
				edge.kind === "link" ? "#0ea5e9" : "currentColor",
			)
			.attr("stroke-width", (edge) => (edge.kind === "link" ? 1.6 : 1))
			.attr("marker-end", (edge) =>
				edge.kind === "link" ? "url(#okf-arrow)" : null,
			);

		const node = layer
			.append("g")
			.selectAll<SVGGElement, GraphNode>("g")
			.data(nodes)
			.join("g")
			.attr("cursor", "pointer")
			.on("mouseenter", (_event, d) => setHovered(d))
			.on("mouseleave", () => setHovered(null))
			.on("click", (event, d) => {
				event.stopPropagation();
				if (d.kind !== "card") return;
				// Narrow windows have no room for the panel: open the card instead.
				if (window.matchMedia("(min-width: 768px)").matches) setSelected(d.id);
				else openCard?.(d.id);
			});
		node
			.append("circle")
			.attr("r", (d) => (d.kind === "folder" ? 9 : 6))
			.attr("fill", (d) =>
				d.kind === "folder"
					? "#3b82f6"
					: (typeColor.get(d.type ?? "") ?? "#94a3b8"),
			)
			.attr("stroke", "#0ea5e9")
			.attr("stroke-width", 0);
		node
			.append("text")
			.text((d) => (d.label.length > 28 ? `${d.label.slice(0, 27)}…` : d.label))
			.attr("x", 12)
			.attr("y", 4)
			.attr("font-size", (d) => (d.kind === "folder" ? 12 : 10.5))
			.attr("fill", "currentColor")
			.style("pointer-events", "none");

		const simulation = d3
			.forceSimulation(nodes)
			.force(
				"link",
				d3
					.forceLink<GraphNode, GraphEdge>(edges)
					.id((d) => d.id)
					.distance((edge) => (edge.kind === "link" ? 120 : 70))
					.strength((edge) => (edge.kind === "link" ? 0.15 : 0.7)),
			)
			.force("charge", d3.forceManyBody().strength(-280))
			.force("center", d3.forceCenter(width / 2, height / 2))
			.force("collide", d3.forceCollide(22));

		node.call(
			d3
				.drag<SVGGElement, GraphNode>()
				.on("start", (event, d) => {
					if (!event.active) simulation.alphaTarget(0.3).restart();
					d.fx = d.x;
					d.fy = d.y;
				})
				.on("drag", (event, d) => {
					d.fx = event.x;
					d.fy = event.y;
				})
				.on("end", (event, d) => {
					if (!event.active) simulation.alphaTarget(0);
					d.fx = null;
					d.fy = null;
				}),
		);

		simulation.on("tick", () => {
			link
				.attr("x1", (edge) => (edge.source as GraphNode).x ?? 0)
				.attr("y1", (edge) => (edge.source as GraphNode).y ?? 0)
				.attr("x2", (edge) => (edge.target as GraphNode).x ?? 0)
				.attr("y2", (edge) => (edge.target as GraphNode).y ?? 0);
			node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
		});
		// A large index settles partly off screen; frame it once.
		let framed = false;
		simulation.on("end", () => {
			if (framed) return;
			framed = true;
			frameAll();
		});

		view.current = { svg, zoom, nodes, node, link, width, height };
		setHighlight((value) => value + 1);
		return () => {
			simulation.stop();
			svg.remove();
			view.current = null;
		};
	}, [graph, container, typeColor, frameAll, openCard]);

	// The selection and its neighbours stand out; the rest fades.
	React.useEffect(() => {
		const current = view.current;
		if (!current || highlight < 0) return;
		const near = new Set<string>();
		if (selected) {
			near.add(selected);
			current.link.each((edge) => {
				const source = endpoint(edge.source);
				const target = endpoint(edge.target);
				if (source === selected) near.add(target);
				if (target === selected) near.add(source);
			});
		}
		current.node.attr("opacity", (d) =>
			!selected || near.has(d.id) ? 1 : 0.18,
		);
		current.node
			.select("circle")
			.attr("stroke-width", (d) => (d.id === selected ? 3 : 0));
		current.node
			.select("text")
			.attr("opacity", (d) =>
				d.id === selected ? 1 : d.kind === "folder" ? 0.95 : 0.75,
			)
			.attr("font-weight", (d) =>
				d.id === selected ? 700 : d.kind === "folder" ? 600 : 400,
			);
		current.link.attr("stroke-opacity", (edge) => {
			const touches =
				selected !== null &&
				(endpoint(edge.source) === selected ||
					endpoint(edge.target) === selected);
			if (selected && !touches) return 0.06;
			return edge.kind === "link" ? 0.9 : touches ? 0.5 : 0.18;
		});
	}, [selected, highlight]);

	const incoming = React.useMemo<CardLink[]>(
		() =>
			selected && graph
				? graph.edges
						.filter((edge) => edge.kind === "link" && edge.target === selected)
						.map((edge) => ({
							path: edge.source,
							label: labels.get(edge.source) ?? edge.source,
						}))
				: [],
		[selected, graph, labels],
	);

	const matches = React.useMemo(() => {
		const needle = query.trim().toLocaleLowerCase();
		if (!needle || !graph) return [];
		return graph.nodes
			.filter(
				(node) =>
					node.kind === "card" &&
					(node.label.toLocaleLowerCase().includes(needle) ||
						node.id.toLocaleLowerCase().includes(needle)),
			)
			.slice(0, 8);
	}, [query, graph]);

	const choose = (id: string) => {
		setSelected(id);
		setQuery("");
		centerOn(id);
	};

	if (!index) return null;
	const cards = graph?.nodes.filter((node) => node.kind === "card").length ?? 0;
	const links = graph?.edges.filter((edge) => edge.kind === "link").length ?? 0;

	return (
		<Dialog
			open={Boolean(path)}
			onOpenChange={(open) => !open && index.openGraph(null)}
		>
			<DialogContent className="flex h-[min(90vh,780px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
				<DialogHeader className="border-b px-5 py-3 pr-12">
					<DialogTitle className="flex items-center gap-2 text-base">
						<Share2 className="h-4 w-4 text-sky-600 dark:text-sky-400" />
						{t("folderIndex.graph.title")}
						<IndexTypeBadge label="OKF" />
					</DialogTitle>
					<DialogDescription className="truncate font-mono text-[11px]">
						{path}
						{graph &&
							` · ${t("folderIndex.graph.summary", { cards, links })}${graph.truncated ? ` · ${t("folderIndex.graph.truncated")}` : ""}`}
					</DialogDescription>
				</DialogHeader>

				<div className="flex min-h-0 flex-1">
					<div className="flex min-w-0 flex-1 flex-col">
						<div className="flex items-center gap-2 border-b px-3 py-2">
							<div className="relative w-64 max-w-full">
								<Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
								<Input
									value={query}
									onChange={(event) => setQuery(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter" && matches[0])
											choose(matches[0].id);
										if (event.key === "Escape") setQuery("");
									}}
									placeholder={t("folderIndex.graph.search")}
									aria-label={t("folderIndex.graph.search")}
									className="h-8 pl-7 text-xs"
								/>
								{matches.length > 0 && (
									<div className="absolute left-0 right-0 top-9 z-20 max-h-64 overflow-auto rounded-md border bg-popover py-1 shadow-md">
										{matches.map((node) => (
											<button
												key={node.id}
												type="button"
												onClick={() => choose(node.id)}
												className="flex w-full min-w-0 flex-col px-3 py-1 text-left text-xs hover:bg-muted"
											>
												<span className="truncate font-medium">
													{node.label}
												</span>
												<span className="truncate font-mono text-[10px] text-muted-foreground">
													{node.id}
												</span>
											</button>
										))}
									</div>
								)}
							</div>
							<span className="flex-1" />
							<Button
								variant="ghost"
								size="sm"
								className="h-8 gap-1.5 px-2.5 text-xs"
								onClick={frameAll}
							>
								<Maximize className="h-3.5 w-3.5" />
								{t("folderIndex.graph.fit")}
							</Button>
						</div>

						<div
							ref={setContainer}
							className="relative min-h-0 flex-1 overflow-hidden bg-muted/20 text-foreground"
						>
							{!graph && !error && (
								<div className="absolute inset-0 flex items-center justify-center">
									<Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
								</div>
							)}
							{error && (
								<p className="absolute inset-0 flex items-center justify-center text-xs text-red-600 dark:text-red-400">
									{error}
								</p>
							)}
							{hovered && hovered.id !== selected && (
								<div className="pointer-events-none absolute left-3 top-3 z-10 max-w-xs rounded-md border bg-background/95 px-3 py-2 text-xs shadow-sm">
									<p className="flex items-center gap-1.5 font-medium">
										{hovered.kind === "folder" && (
											<Folder className="h-3.5 w-3.5 text-blue-500" />
										)}
										{hovered.label}
									</p>
									{hovered.type && (
										<p className="mt-0.5 text-[11px] text-muted-foreground">
											{hovered.type}
										</p>
									)}
									{hovered.description && (
										<p className="mt-1 line-clamp-3 text-[11px] text-muted-foreground">
											{hovered.description}
										</p>
									)}
								</div>
							)}
						</div>

						{typeColor.size > 0 && (
							<div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 text-[11px] text-muted-foreground">
								<span className="inline-flex items-center gap-1">
									<span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
									{t("folderIndex.graph.folder")}
								</span>
								{[...typeColor.entries()].map(([type, color]) => (
									<span key={type} className="inline-flex items-center gap-1">
										<span
											className="h-2 w-2 rounded-full"
											style={{ background: color }}
										/>
										{type}
									</span>
								))}
								<span className="inline-flex items-center gap-1">
									<span className="h-0.5 w-4 bg-sky-500" />
									{t("folderIndex.graph.link")}
								</span>
								<span className="ml-auto">{t("folderIndex.graph.hint")}</span>
							</div>
						)}
					</div>

					<aside className="hidden w-[360px] shrink-0 flex-col border-l md:flex">
						{selected ? (
							<FolderIndexCardView
								path={selected}
								incoming={incoming}
								labelOf={(target) => labels.get(target)}
								onSelectPath={(target) => {
									if (labels.has(target)) choose(target);
									else index.openCard(target);
								}}
								onClose={() => setSelected(null)}
								className="h-full"
							/>
						) : (
							<div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center text-xs text-muted-foreground">
								<Share2 className="h-6 w-6 opacity-40" />
								{t("folderIndex.graph.select")}
							</div>
						)}
					</aside>
				</div>
			</DialogContent>
		</Dialog>
	);
};
