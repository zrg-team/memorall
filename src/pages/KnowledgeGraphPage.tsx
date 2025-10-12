import React, { useState, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Network } from "lucide-react";
import { D3KnowledgeGraph } from "@/modules/knowledge/components/D3KnowledgeGraph";
import type { Node, Edge } from "@/services/database/db";
import { serviceManager } from "@/services";
import { logError } from "@/utils/logger";

interface KnowledgeGraphPageProps {}

export const KnowledgeGraphPage: React.FC<KnowledgeGraphPageProps> = () => {
	const [nodes, setNodes] = useState<Node[]>([]);
	const [edges, setEdges] = useState<Edge[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

	useEffect(() => {
		loadGraphData();
	}, []);

	const loadGraphData = async () => {
		try {
			setLoading(true);
			await serviceManager.databaseService.use(async ({ db, schema }) => {
				const allNodes = await db.select().from(schema.nodes);
				const allEdges = await db.select().from(schema.edges);

				setNodes(allNodes);
				setEdges(allEdges);
			});
		} catch (error) {
			logError("Failed to load knowledge graph data:", error);
		} finally {
			setLoading(false);
		}
	};

	const filteredNodes = nodes.filter((node) =>
		node.name.toLowerCase().includes(searchQuery.toLowerCase()),
	);

	return (
		<div className="flex flex-col sm:flex-row h-full overflow-hidden bg-background">
			{/* Sidebar with node list - hidden on small screens */}
			<div className="hidden sm:block sm:w-64 border-r border-border bg-card">
				<div className="p-3 border-b border-border">
					<div className="relative">
						<Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
						<Input
							placeholder="Search nodes..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="pl-10"
						/>
					</div>
					<div className="text-xs text-muted-foreground mt-2">
						{filteredNodes.length} / {nodes.length} nodes
					</div>
				</div>

				<ScrollArea className="h-full">
					{loading ? (
						<div className="p-3 text-center text-muted-foreground text-sm">
							Loading...
						</div>
					) : filteredNodes.length === 0 ? (
						<div className="p-3 text-center text-muted-foreground text-sm">
							{searchQuery ? "No matches" : "No nodes"}
						</div>
					) : (
						<div className="divide-y divide-border">
							{filteredNodes.map((node) => (
								<div
									key={node.id}
									className={`p-2 cursor-pointer hover:bg-muted/50 ${
										selectedNodeId === node.id
											? "bg-accent border-r-2 border-primary"
											: ""
									}`}
									onClick={() => setSelectedNodeId(node.id)}
								>
									<div className="flex items-center justify-between gap-2">
										<span className="font-medium text-sm line-clamp-1 text-foreground flex-1">
											{node.name}
										</span>
										<Badge variant="secondary" className="text-xs shrink-0">
											{node.nodeType}
										</Badge>
									</div>
								</div>
							))}
						</div>
					)}
				</ScrollArea>
			</div>

			{/* Main graph area */}
			<div className="flex-1">
				{loading ? (
					<div className="h-full flex items-center justify-center text-muted-foreground">
						<div className="text-center">
							<Network className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50 animate-pulse" />
							<p className="text-lg font-medium">Loading knowledge graph...</p>
						</div>
					</div>
				) : nodes.length === 0 ? (
					<div className="h-full flex items-center justify-center text-muted-foreground">
						<div className="text-center">
							<Network className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
							<p className="text-lg font-medium">
								No knowledge graph available
							</p>
							<p className="text-sm">
								Convert some content to generate knowledge graph nodes
							</p>
						</div>
					</div>
				) : (
					<D3KnowledgeGraph
						graphData={{ nodes, edges }}
						selectedNodeId={selectedNodeId || undefined}
						width={800}
						height={600}
					/>
				)}
			</div>
		</div>
	);
};
