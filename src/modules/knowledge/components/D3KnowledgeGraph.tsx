import React, { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowRight, X, Trash2 } from "lucide-react";
import { serviceManager } from "@/services";
import type { Node, Edge } from "@/services/database/db";
import { logError, logInfo } from "@/utils/logger";
import { inArray, eq, and } from "drizzle-orm";

// Hook to detect theme
const useTheme = () => {
	const [isDark, setIsDark] = React.useState(false);

	useEffect(() => {
		const checkTheme = () => {
			setIsDark(document.documentElement.classList.contains("dark"));
		};

		checkTheme();
		const observer = new MutationObserver(checkTheme);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});

		return () => observer.disconnect();
	}, []);

	return isDark;
};

interface D3Node extends d3.SimulationNodeDatum {
	id: string;
	name: string;
	nodeType: string;
	summary?: string;
	group: number;
	radius: number;
}

interface D3Edge {
	source: string | D3Node;
	target: string | D3Node;
	id: string;
	edgeType: string;
	factText?: string;
	weight: number;
}

interface GraphData {
	nodes: D3Node[];
	edges: D3Edge[];
}

interface ConnectedEdge {
	edge: D3Edge;
	connectedNode: D3Node;
	direction: "incoming" | "outgoing";
}

interface D3KnowledgeGraphProps {
	selectedPageId?: string;
	selectedNodeId?: string;
	graphData?: {
		nodes: Node[];
		edges: Edge[];
	};
	width?: number;
	height?: number;
	onNodeDeleted?: () => void;
}

// Theme-aware color functions
const getNodeColors = (isDark: boolean): Record<string, string> => ({
	person: isDark ? "#60a5fa" : "#3b82f6", // blue
	organization: isDark ? "#34d399" : "#10b981", // emerald
	location: isDark ? "#fbbf24" : "#f59e0b", // amber
	event: isDark ? "#f87171" : "#ef4444", // red
	concept: isDark ? "#a78bfa" : "#8b5cf6", // violet
	default: isDark ? "#9ca3af" : "#6b7280", // gray
});

const getThemeColors = (isDark: boolean) => ({
	background: isDark ? "#0f172a" : "#ffffff",
	border: isDark ? "#374151" : "#e5e7eb",
	text: isDark ? "#f1f5f9" : "#374151",
	textMuted: isDark ? "#94a3b8" : "#6b7280",
	stroke: isDark ? "#475569" : "#ffffff",
	linkStroke: isDark ? "#6b7280" : "#9ca3af",
	arrowFill: isDark ? "#6b7280" : "#9ca3af",
	cardBg: isDark ? "#1e293b" : "#ffffff",
	badgeBg: isDark ? "#374151" : "#f3f4f6",
	infoPanel: isDark ? "#0f172a" : "#ffffff",
});

const NODE_RADIUS: Record<string, number> = {
	person: 8,
	organization: 10,
	location: 7,
	event: 6,
	concept: 9,
	default: 6,
};

export const D3KnowledgeGraph: React.FC<D3KnowledgeGraphProps> = ({
	selectedPageId,
	selectedNodeId,
	graphData: externalGraphData,
	width = 800,
	height = 600,
	onNodeDeleted,
}) => {
	const svgRef = useRef<SVGSVGElement>(null);
	const [loading, setLoading] = useState(true);
	const [graphData, setGraphData] = useState<GraphData>({
		nodes: [],
		edges: [],
	});
	const [error, setError] = useState<string | null>(null);
	const [selectedNode, setSelectedNode] = useState<D3Node | null>(null);
	const [connectedEdges, setConnectedEdges] = useState<ConnectedEdge[]>([]);
	const [deleting, setDeleting] = useState(false);
	const isDark = useTheme();

	useEffect(() => {
		loadGraphData();
	}, [selectedPageId, externalGraphData]);

	// Handle external selectedNodeId changes
	useEffect(() => {
		if (selectedNodeId && graphData.nodes.length > 0) {
			const node = graphData.nodes.find((n) => n.id === selectedNodeId);
			if (node) {
				setSelectedNode(node);
			}
		} else if (!selectedNodeId) {
			setSelectedNode(null);
			setConnectedEdges([]);
		}
	}, [selectedNodeId, graphData.nodes]);

	// Update connected edges when selectedNode changes
	useEffect(() => {
		if (selectedNode && graphData.edges.length > 0) {
			const connections: ConnectedEdge[] = [];
			graphData.edges.forEach((edge) => {
				const sourceNode = graphData.nodes.find(
					(n) =>
						n.id ===
						(typeof edge.source === "string" ? edge.source : edge.source.id),
				);
				const targetNode = graphData.nodes.find(
					(n) =>
						n.id ===
						(typeof edge.target === "string" ? edge.target : edge.target.id),
				);

				if (sourceNode?.id === selectedNode.id && targetNode) {
					connections.push({
						edge,
						connectedNode: targetNode,
						direction: "outgoing",
					});
				} else if (targetNode?.id === selectedNode.id && sourceNode) {
					connections.push({
						edge,
						connectedNode: sourceNode,
						direction: "incoming",
					});
				}
			});
			setConnectedEdges(connections);
		} else {
			setConnectedEdges([]);
		}
	}, [selectedNode, graphData.edges, graphData.nodes]);

	useEffect(() => {
		if (graphData.nodes.length > 0) {
			renderGraph();
		}
	}, [graphData, width, height, isDark]);

	// Update node styling when selection changes
	useEffect(() => {
		if (svgRef.current) {
			const themeColors = getThemeColors(isDark);
			const svg = d3.select(svgRef.current);
			svg
				.selectAll("circle")
				.attr("stroke", (d: any) =>
					selectedNode?.id === d.id
						? isDark
							? "#60a5fa"
							: "#2563eb"
						: themeColors.stroke,
				)
				.attr("stroke-width", (d: any) => (selectedNode?.id === d.id ? 3 : 2));
		}
	}, [selectedNode, isDark]);

	useEffect(() => {
		// Ensure SVG is sized properly
		const svg = d3.select(svgRef.current);
		svg.attr("width", width).attr("height", height);
	}, [width, height]);

	const loadGraphData = async () => {
		setLoading(true);
		setError(null);

		try {
			// If external graph data is provided, use it instead of loading from DB
			if (externalGraphData) {
				const d3Nodes: D3Node[] = externalGraphData.nodes.map(
					(node, index) => ({
						id: node.id,
						name: node.name,
						nodeType: node.nodeType,
						summary: node.summary || undefined,
						group: hash(node.nodeType) % 6,
						radius: NODE_RADIUS[node.nodeType] || NODE_RADIUS.default,
						// Add initial positions in a circle pattern
						x:
							400 +
							Math.cos((index * 2 * Math.PI) / externalGraphData.nodes.length) *
								150,
						y:
							300 +
							Math.sin((index * 2 * Math.PI) / externalGraphData.nodes.length) *
								150,
					}),
				);

				const d3Edges: D3Edge[] = externalGraphData.edges
					.filter(
						(edge) =>
							d3Nodes.some((n) => n.id === edge.sourceId) &&
							d3Nodes.some((n) => n.id === edge.destinationId),
					)
					.map((edge) => ({
						source: edge.sourceId,
						target: edge.destinationId,
						id: edge.id,
						edgeType: edge.edgeType,
						factText: edge.factText || undefined,
						weight: 1,
					}));

				setGraphData({ nodes: d3Nodes, edges: d3Edges });
				setLoading(false);
				return;
			}

			await serviceManager.databaseService.use(async ({ db, schema }) => {
				let nodes: Node[] = [];
				let edges: Edge[] = [];

				if (selectedPageId) {
					// Load graph data for specific page
					const sources = await db
						.select()
						.from(schema.sources)
						.where(
							and(
								eq(schema.sources.targetType, "remembered_pages"),
								eq(schema.sources.targetId, selectedPageId),
							),
						);

					if (sources.length > 0) {
						const sourceIds = sources.map((s) => s.id);

						// Get nodes related to these sources
						const sourceNodes = await db
							.select({
								nodeId: schema.sourceNodes.nodeId,
							})
							.from(schema.sourceNodes)
							.where(inArray(schema.sourceNodes.sourceId, sourceIds));

						const nodeIds = sourceNodes.map((sn) => sn.nodeId);

						if (nodeIds.length > 0) {
							nodes = await db
								.select()
								.from(schema.nodes)
								.where(inArray(schema.nodes.id, nodeIds));

							// Get edges between these nodes
							edges = await db
								.select()
								.from(schema.edges)
								.where(
									and(
										inArray(schema.edges.sourceId, nodeIds),
										inArray(schema.edges.destinationId, nodeIds),
									),
								);
						}
					}
				} else {
					// Load full graph (limit for performance)
					nodes = await db.select().from(schema.nodes).limit(100);

					if (nodes.length > 0) {
						const nodeIds = nodes.map((n) => n.id);
						edges = await db
							.select()
							.from(schema.edges)
							.where(
								and(
									inArray(schema.edges.sourceId, nodeIds),
									inArray(schema.edges.destinationId, nodeIds),
								),
							)
							.limit(200);
					}
				}

				// Transform to D3 format
				const d3Nodes: D3Node[] = nodes.map((node, index) => ({
					id: node.id,
					name: node.name,
					nodeType: node.nodeType,
					summary: node.summary || undefined,
					group: hash(node.nodeType) % 6,
					radius: NODE_RADIUS[node.nodeType] || NODE_RADIUS.default,
					// Add initial positions in a circle pattern
					x: 400 + Math.cos((index * 2 * Math.PI) / nodes.length) * 150,
					y: 300 + Math.sin((index * 2 * Math.PI) / nodes.length) * 150,
				}));

				const d3Edges: D3Edge[] = edges
					.filter(
						(edge) =>
							d3Nodes.some((n) => n.id === edge.sourceId) &&
							d3Nodes.some((n) => n.id === edge.destinationId),
					)
					.map((edge) => ({
						source: edge.sourceId,
						target: edge.destinationId,
						id: edge.id,
						edgeType: edge.edgeType,
						factText: edge.factText || undefined,
						weight: 1,
					}));

				setGraphData({ nodes: d3Nodes, edges: d3Edges });
			});
		} catch (err) {
			logError("Failed to load graph data:", err);
			setError(err instanceof Error ? err.message : "Unknown error");
		} finally {
			setLoading(false);
		}
	};

	const renderGraph = () => {
		if (!svgRef.current) return;

		const nodeColors = getNodeColors(isDark);
		const themeColors = getThemeColors(isDark);

		const svg = d3.select(svgRef.current);
		svg.selectAll("*").remove();

		if (graphData.nodes.length === 0) {
			return;
		}

		const g = svg.append("g");

		// Add zoom behavior
		const zoom = d3
			.zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.1, 4])
			.on("zoom", (event) => {
				g.attr("transform", event.transform);
			});

		svg.call(zoom);

		// Create simulation
		const simulation = d3
			.forceSimulation<D3Node>(graphData.nodes)
			.force("charge", d3.forceManyBody().strength(-200))
			.force("center", d3.forceCenter(width / 2, height / 2))
			.force(
				"collision",
				d3.forceCollide().radius((d) => 2),
			);

		// Only add link force if we have edges
		if (graphData.edges.length > 0) {
			simulation.force(
				"link",
				d3
					.forceLink<D3Node, D3Edge>(graphData.edges)
					.id((d) => d.id)
					.distance(90)
					.strength(0.5),
			);
		}

		// Create arrow markers
		const defs = svg.append("defs");
		defs
			.append("marker")
			.attr("id", "arrowhead")
			.attr("viewBox", "0 -5 10 10")
			.attr("refX", 15)
			.attr("refY", 0)
			.attr("markerWidth", 6)
			.attr("markerHeight", 6)
			.attr("orient", "auto")
			.append("path")
			.attr("d", "M0,-5L10,0L0,5")
			.attr("fill", themeColors.arrowFill);

		// Create links
		const links = g
			.append("g")
			.selectAll("line")
			.data(graphData.edges)
			.enter()
			.append("line")
			.attr("stroke", themeColors.linkStroke)
			.attr("stroke-opacity", 0.8)
			.attr("stroke-width", 2)
			.attr("marker-end", "url(#arrowhead)");

		// Create link labels
		const linkLabels = g
			.append("g")
			.selectAll("text")
			.data(graphData.edges)
			.enter()
			.append("text")
			.attr("text-anchor", "middle")
			.attr("font-size", "6px")
			.attr("font-family", "Arial, sans-serif")
			.attr("fill", themeColors.textMuted)
			.attr("pointer-events", "none")
			.text((d) => d.edgeType);

		// Create nodes
		const nodes = g
			.append("g")
			.selectAll("circle")
			.data(graphData.nodes)
			.enter()
			.append("circle")
			.attr("r", (d) => d.radius)
			.attr("fill", (d) => nodeColors[d.nodeType] || nodeColors.default)
			.attr("stroke", themeColors.stroke)
			.attr("stroke-width", 2)
			.style("cursor", "pointer")
			.on("click", (event, d) => {
				if (selectedNode?.id === d.id) {
					// If clicking the same node, unselect it
					setSelectedNode(null);
					setConnectedEdges([]);
				} else {
					// If clicking a different node, select it
					setSelectedNode(d);
					setConnectedEdges(getConnectedEdges(d));
				}
			})
			.call(
				d3
					.drag<SVGCircleElement, D3Node>()
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

		// Create node labels
		const nodeLabels = g
			.append("g")
			.selectAll("text")
			.data(graphData.nodes)
			.enter()
			.append("text")
			.attr("text-anchor", "middle")
			.attr("dy", ".35em")
			.attr("font-size", "6px")
			.attr("font-family", "Arial, sans-serif")
			.attr("fill", themeColors.text)
			.attr("pointer-events", "none")
			.text((d) =>
				d.name.length > 12 ? d.name.substring(0, 12) + "..." : d.name,
			);

		// Update positions on tick
		simulation.on("tick", () => {
			links
				.attr("x1", (d) => (d.source as D3Node).x!)
				.attr("y1", (d) => (d.source as D3Node).y!)
				.attr("x2", (d) => (d.target as D3Node).x!)
				.attr("y2", (d) => (d.target as D3Node).y!);

			linkLabels
				.attr(
					"x",
					(d) => ((d.source as D3Node).x! + (d.target as D3Node).x!) / 2,
				)
				.attr(
					"y",
					(d) => ((d.source as D3Node).y! + (d.target as D3Node).y!) / 2,
				);

			nodes.attr("cx", (d) => d.x!).attr("cy", (d) => d.y!);

			nodeLabels.attr("x", (d) => d.x!).attr("y", (d) => d.y! + d.radius + 12);
		});

		// Initial zoom to fit (delay to allow elements to render)
		setTimeout(() => {
			const bounds = g.node()?.getBBox();
			if (bounds && bounds.width > 0 && bounds.height > 0) {
				const fullWidth = bounds.width;
				const fullHeight = bounds.height;
				const scale = Math.min(width / fullWidth, height / fullHeight) * 0.8;
				const translate = [
					width / 2 - scale * (bounds.x + fullWidth / 2),
					height / 2 - scale * (bounds.y + fullHeight / 2),
				];

				svg.call(
					zoom.transform,
					d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale),
				);
			}
		}, 100);
	};

	const getConnectedEdges = (node: D3Node): ConnectedEdge[] => {
		const connections: ConnectedEdge[] = [];

		graphData.edges.forEach((edge) => {
			const sourceNode = graphData.nodes.find(
				(n) =>
					n.id ===
					(typeof edge.source === "string" ? edge.source : edge.source.id),
			);
			const targetNode = graphData.nodes.find(
				(n) =>
					n.id ===
					(typeof edge.target === "string" ? edge.target : edge.target.id),
			);

			if (sourceNode?.id === node.id && targetNode) {
				// Outgoing edge
				connections.push({
					edge,
					connectedNode: targetNode,
					direction: "outgoing",
				});
			} else if (targetNode?.id === node.id && sourceNode) {
				// Incoming edge
				connections.push({
					edge,
					connectedNode: sourceNode,
					direction: "incoming",
				});
			}
		});

		return connections;
	};

	const handleDeleteNode = async () => {
		if (!selectedNode) return;

		const confirmDelete = confirm(
			`Are you sure you want to delete the node "${selectedNode.name}"?\n\nThis will also delete:\n- All edges connected to this node\n- All source relationships for this node\n\nThis action cannot be undone.`,
		);

		if (!confirmDelete) return;

		try {
			setDeleting(true);
			logInfo(`Deleting node: ${selectedNode.name} (${selectedNode.id})`);

			await serviceManager.databaseService.use(async ({ db, schema }) => {
				// Delete all edges where this node is source or destination
				await db
					.delete(schema.edges)
					.where(eq(schema.edges.sourceId, selectedNode.id));

				await db
					.delete(schema.edges)
					.where(eq(schema.edges.destinationId, selectedNode.id));

				// Delete all source_nodes relationships
				await db
					.delete(schema.sourceNodes)
					.where(eq(schema.sourceNodes.nodeId, selectedNode.id));

				// Delete the node itself
				await db
					.delete(schema.nodes)
					.where(eq(schema.nodes.id, selectedNode.id));
			});

			logInfo(`Successfully deleted node: ${selectedNode.name}`);

			// Update local state immediately to remove node from visualization
			const nodeIdToDelete = selectedNode.id;
			setGraphData((prevData) => ({
				nodes: prevData.nodes.filter((n) => n.id !== nodeIdToDelete),
				edges: prevData.edges.filter((e) => {
					const sourceId =
						typeof e.source === "string" ? e.source : e.source.id;
					const targetId =
						typeof e.target === "string" ? e.target : e.target.id;
					return sourceId !== nodeIdToDelete && targetId !== nodeIdToDelete;
				}),
			}));

			// Clear selection
			setSelectedNode(null);
			setConnectedEdges([]);

			// Notify parent if callback provided (for external data updates)
			if (onNodeDeleted) {
				onNodeDeleted();
			}
		} catch (error) {
			logError("Failed to delete node:", error);
			alert(
				`Failed to delete node: ${error instanceof Error ? error.message : "Unknown error"}`,
			);
		} finally {
			setDeleting(false);
		}
	};

	const hash = (str: string): number => {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			const char = str.charCodeAt(i);
			hash = (hash << 5) - hash + char;
			hash = hash & hash;
		}
		return Math.abs(hash);
	};

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 className="h-8 w-8 animate-spin text-gray-400" />
				<span className="ml-2 text-gray-600">Loading knowledge graph...</span>
			</div>
		);
	}

	if (error) {
		return (
			<div className="flex items-center justify-center h-full text-red-600">
				<p>Error loading graph: {error}</p>
			</div>
		);
	}

	if (graphData.nodes.length === 0) {
		return (
			<div className="flex items-center justify-center h-full text-gray-500">
				<p>No nodes found for knowledge graph</p>
			</div>
		);
	}

	const themeColors = getThemeColors(isDark);
	const nodeColors = getNodeColors(isDark);

	return (
		<div className="relative w-full h-full">
			<svg
				ref={svgRef}
				width="100%"
				height="100%"
				viewBox={`0 0 ${width} ${height}`}
				className={`border rounded ${
					isDark ? "border-gray-600 bg-slate-900" : "border-gray-200 bg-white"
				}`}
			/>

			{selectedNode && (
				<Card
					className={`absolute top-2 left-2 right-2 w-auto max-w-96 max-h-96 shadow-lg overflow-hidden ${
						isDark ? "bg-slate-800 border-gray-600" : "bg-white border-gray-200"
					}`}
				>
					<div
						className={`p-4 border-b ${
							isDark ? "border-gray-600" : "border-gray-200"
						}`}
					>
						<div className="flex items-center justify-between">
							<div className="flex items-center gap-2">
								<div
									className="w-4 h-4 rounded-full"
									style={{
										backgroundColor:
											nodeColors[selectedNode.nodeType] || nodeColors.default,
									}}
								/>
								<h3
									className={`font-semibold text-sm ${
										isDark ? "text-gray-100" : "text-gray-900"
									}`}
								>
									{selectedNode.name}
								</h3>
							</div>
							<div className="flex items-center gap-1">
								<Button
									variant="ghost"
									size="sm"
									onClick={handleDeleteNode}
									disabled={deleting}
									className="h-7 px-2 text-destructive hover:text-destructive hover:bg-destructive/10"
									title="Delete node"
								>
									{deleting ? (
										<Loader2 className="h-4 w-4 animate-spin" />
									) : (
										<Trash2 className="h-4 w-4" />
									)}
								</Button>
								<button
									onClick={() => {
										setSelectedNode(null);
										setConnectedEdges([]);
									}}
									className={`${
										isDark
											? "text-gray-400 hover:text-gray-200"
											: "text-gray-400 hover:text-gray-600"
									}`}
									title="Close"
								>
									<X className="h-4 w-4" />
								</button>
							</div>
						</div>
						<div className="mt-2 space-y-1">
							<Badge variant="outline" className="text-xs">
								{selectedNode.nodeType}
							</Badge>
							{selectedNode.summary && (
								<p
									className={`text-xs mt-1 ${
										isDark ? "text-gray-300" : "text-gray-600"
									}`}
								>
									{selectedNode.summary}
								</p>
							)}
						</div>
					</div>

					<div className="p-4 max-h-64 overflow-y-auto">
						<h4
							className={`font-medium text-sm mb-3 ${
								isDark ? "text-gray-200" : "text-gray-800"
							}`}
						>
							Connected Edges ({connectedEdges.length})
						</h4>

						{connectedEdges.length === 0 ? (
							<p
								className={`text-xs italic ${
									isDark ? "text-gray-400" : "text-gray-500"
								}`}
							>
								No connected edges found
							</p>
						) : (
							<div className="space-y-3">
								{connectedEdges.map((connection, index) => (
									<div
										key={`${connection.edge.id}-${index}`}
										className={`rounded-lg p-3 ${
											isDark ? "bg-gray-700" : "bg-gray-50"
										}`}
									>
										<div className="flex items-center gap-2 mb-2">
											<div className="flex items-center gap-1 text-xs">
												{connection.direction === "outgoing" ? (
													<>
														<span
															className={`font-medium ${
																isDark ? "text-blue-400" : "text-blue-600"
															}`}
														>
															{selectedNode.name}
														</span>
														<ArrowRight
															className={`h-3 w-3 ${
																isDark ? "text-gray-500" : "text-gray-400"
															}`}
														/>
														<span
															className={`font-medium ${
																isDark ? "text-green-400" : "text-green-600"
															}`}
														>
															{connection.connectedNode.name}
														</span>
													</>
												) : (
													<>
														<span
															className={`font-medium ${
																isDark ? "text-green-400" : "text-green-600"
															}`}
														>
															{connection.connectedNode.name}
														</span>
														<ArrowRight
															className={`h-3 w-3 ${
																isDark ? "text-gray-500" : "text-gray-400"
															}`}
														/>
														<span
															className={`font-medium ${
																isDark ? "text-blue-400" : "text-blue-600"
															}`}
														>
															{selectedNode.name}
														</span>
													</>
												)}
											</div>
										</div>

										<div className="space-y-1">
											<div className="flex items-center gap-2">
												<Badge variant="secondary" className="text-xs">
													{connection.edge.edgeType}
												</Badge>
												<span
													className={`text-xs ${
														isDark ? "text-gray-400" : "text-gray-500"
													}`}
												>
													{connection.direction === "outgoing"
														? "Outgoing"
														: "Incoming"}
												</span>
											</div>

											{connection.edge.factText && (
												<div className="mt-2">
													<p
														className={`text-xs font-medium mb-1 ${
															isDark ? "text-gray-300" : "text-gray-700"
														}`}
													>
														Fact:
													</p>
													<p
														className={`text-xs p-2 rounded border ${
															isDark
																? "text-gray-300 bg-gray-800 border-gray-600"
																: "text-gray-600 bg-white border-gray-200"
														}`}
													>
														{connection.edge.factText}
													</p>
												</div>
											)}
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				</Card>
			)}

			<div
				className={`absolute bottom-4 right-4 p-2 rounded shadow text-xs ${
					isDark
						? "bg-gray-800 text-gray-300 border border-gray-600"
						: "bg-white text-gray-600 border border-gray-200"
				}`}
			>
				<div>Nodes: {graphData.nodes.length}</div>
				<div>Edges: {graphData.edges.length}</div>
			</div>
		</div>
	);
};
