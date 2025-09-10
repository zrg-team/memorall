import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Search,
	Zap,
	CheckCircle,
	XCircle,
	ArrowLeft,
	Target,
	Hash,
	Database,
} from "lucide-react";
import { databaseService } from "@/services/database";
import { serviceManager } from "@/services/ServiceManager";
import { logError, logInfo } from "@/utils/logger";
import { schema } from "@/services/database/db";
import { embeddingService } from "@/services/embedding";

// Utility function to get vector columns from a table schema
const getVectorColumns = (table: any): string[] => {
	if (!table || typeof table !== "object") return [];

	const vectorColumns: string[] = [];

	// Iterate through table columns to find vector columns
	for (const [columnName, column] of Object.entries(table)) {
		if (column && typeof column === "object" && "columnType" in column) {
			const columnType = String(column.columnType);
			if (
				columnType.includes("PgVector") ||
				columnType.toLowerCase().includes("vector")
			) {
				vectorColumns.push(columnName);
			}
		}
	}

	return vectorColumns;
};

// Utility function to get display columns from a table schema
const getDisplayColumns = (tableName: string): string[] => {
	// Get table schema to dynamically determine columns
	const table = schema[tableName as keyof typeof schema];
	if (!table || typeof table !== "object") {
		return ["id"];
	}

	// Extract column names from the table schema
	const allColumns = Object.keys(table);

	// Filter out vector columns and system columns
	const vectorColumns = getVectorColumns(table);
	const systemColumns = ["id", "createdAt", "updatedAt"];

	// Get meaningful columns (non-vector, non-system)
	const meaningfulColumns = allColumns.filter(
		(col) => !vectorColumns.includes(col) && !systemColumns.includes(col),
	);

	// Return a combination of meaningful columns plus some system columns
	const displayColumns = [...meaningfulColumns.slice(0, 3)]; // Limit to first 3 meaningful columns

	// Add createdAt if it exists
	if (allColumns.includes("createdAt")) {
		displayColumns.push("createdAt");
	}

	return displayColumns.length > 0 ? displayColumns : ["id"];
};

// Utility function to get searchable columns from a table schema
const getSearchableColumns = (tableName: string): string[] => {
	// Get table schema to dynamically determine columns
	const table = schema[tableName as keyof typeof schema];
	if (!table || typeof table !== "object") {
		return [];
	}

	// Extract column names from the table schema
	const allColumns = Object.keys(table);

	// Filter out vector columns, system columns, and non-text columns
	const vectorColumns = getVectorColumns(table);
	const systemColumns = ["id", "createdAt", "updatedAt"];

	// Get text-based columns that are likely searchable
	const searchableColumns = allColumns.filter((col) => {
		// Skip vector and system columns
		if (vectorColumns.includes(col) || systemColumns.includes(col)) {
			return false;
		}

		// Include columns that likely contain text content
		const columnName = col.toLowerCase();
		return (
			columnName.includes("text") ||
			columnName.includes("content") ||
			columnName.includes("title") ||
			columnName.includes("name") ||
			columnName.includes("summary") ||
			columnName.includes("description")
		);
	});

	return searchableColumns;
};

// Function to dynamically build vector tables configuration
const buildVectorTablesConfig = () => {
	const vectorTables: Record<
		string,
		{
			name: string;
			vectorColumns: string[];
			displayColumns: string[];
			searchableColumns: string[];
		}
	> = {};

	// Iterate through schema to find tables with vector columns
	for (const [tableName, table] of Object.entries(schema)) {
		const vectorColumns = getVectorColumns(table);

		if (vectorColumns.length > 0) {
			// Convert camelCase to proper names
			const displayName = tableName
				.replace(/([A-Z])/g, " $1")
				.replace(/^./, (str) => str.toUpperCase())
				.trim();

			vectorTables[tableName] = {
				name: displayName,
				vectorColumns,
				displayColumns: getDisplayColumns(tableName),
				searchableColumns: getSearchableColumns(tableName),
			};
		}
	}

	return vectorTables;
};

// Get vector tables configuration dynamically
const VECTOR_TABLES = buildVectorTablesConfig();

// Log the detected vector tables for debugging
logInfo("Detected vector tables:", VECTOR_TABLES);

type VectorTableKey = string;

interface SearchResult {
	id: string;
	similarity: number;
	data: Record<string, any>;
}

interface EmbeddingPageProps {}

export const EmbeddingPage: React.FC<EmbeddingPageProps> = () => {
	const [loading, setLoading] = useState(false);
	const [results, setResults] = useState<SearchResult[]>([]);
	const [selectedResult, setSelectedResult] = useState<SearchResult | null>(
		null,
	);
	const [showMobileDetail, setShowMobileDetail] = useState(false);
	const [serviceStatus, setServiceStatus] = useState(
		serviceManager.getServiceStatus(),
	);
	const [stats, setStats] = useState<Record<string, number>>({});
	const [isEmbeddingReady, setIsEmbeddingReady] = useState(false);

	// Get the first available table for initialization
	const firstTableKey = Object.keys(VECTOR_TABLES)[0] || "";
	const firstVectorColumn = firstTableKey
		? VECTOR_TABLES[firstTableKey]?.vectorColumns[0] || ""
		: "";

	// Search parameters
	const [searchParams, setSearchParams] = useState({
		table: firstTableKey as VectorTableKey,
		vectorColumn: firstVectorColumn,
		query: "",
		limit: 20,
		threshold: 0.3, // Minimum similarity threshold
	});

	// Get initialization status from service manager
	const isInitialized = serviceManager.isInitialized();

	// Load data when component mounts if already initialized
	useEffect(() => {
		if (isInitialized) {
			loadStats();
			checkEmbeddingReady();
		}
		// Update service status periodically
		const interval = setInterval(() => {
			setServiceStatus(serviceManager.getServiceStatus());
		}, 1000);
		return () => clearInterval(interval);
	}, [isInitialized]);

	// Check embedding service readiness
	const checkEmbeddingReady = async () => {
		if (isInitialized) {
			const ready = await serviceManager.isEmbeddingServiceReady();
			setIsEmbeddingReady(ready);
		}
	};

	// Update vector column when table changes
	useEffect(() => {
		const tableConfig = VECTOR_TABLES[searchParams.table];
		if (
			tableConfig &&
			!tableConfig.vectorColumns.includes(searchParams.vectorColumn)
		) {
			setSearchParams((prev) => ({
				...prev,
				vectorColumn: tableConfig.vectorColumns[0],
			}));
		}
	}, [searchParams.table]);

	// Load stats for vector-enabled tables
	const loadStats = async () => {
		try {
			await databaseService.use(async ({ db, schema }) => {
				const statsPromises = Object.keys(VECTOR_TABLES).map(
					async (tableKey) => {
						const table = schema[tableKey as keyof typeof schema];
						if (table) {
							const count = await db
								.select()
								.from(table)
								.then((r) => r.length);
							return [tableKey, count] as const;
						}
						return [tableKey, 0] as const;
					},
				);

				const counts = await Promise.all(statsPromises);
				const newStats: Record<string, number> = {};
				counts.forEach(([key, value]) => {
					newStats[key] = value;
				});
				setStats(newStats);
			});
		} catch (error) {
			logError("Failed to load embedding stats:", error);
		}
	};

	// Calculate cosine similarity between two vectors
	const cosineSimilarity = (a: number[], b: number[]): number => {
		if (a.length !== b.length) return 0;

		let dotProduct = 0;
		let normA = 0;
		let normB = 0;

		for (let i = 0; i < a.length; i++) {
			dotProduct += a[i] * b[i];
			normA += a[i] * a[i];
			normB += b[i] * b[i];
		}

		const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
		return magnitude === 0 ? 0 : dotProduct / magnitude;
	};

	// Perform vector similarity search
	const performSearch = async () => {
		if (!searchParams.query.trim()) {
			setResults([]);
			return;
		}

		if (!isEmbeddingReady) {
			logError("Embedding service is not ready");
			return;
		}

		setLoading(true);
		try {
			// Generate embedding for the search query
			const queryVector = await embeddingService.textToVector(
				searchParams.query,
			);

			await databaseService.use(async ({ db, schema }) => {
				const table = schema[searchParams.table as keyof typeof schema];
				if (!table) {
					throw new Error(`Table ${searchParams.table} not found`);
				}

				logInfo(
					`Searching in ${searchParams.table} for: "${searchParams.query}"`,
				);

				// Get all records with embeddings
				const allRecords = await db.select().from(table).limit(1000);

				const searchResults: SearchResult[] = [];

				for (const record of allRecords) {
					const embedding =
						record[searchParams.vectorColumn as keyof typeof record];

					if (embedding && Array.isArray(embedding)) {
						const similarity = cosineSimilarity(queryVector, embedding);

						if (similarity >= searchParams.threshold) {
							searchResults.push({
								id: "id" in record ? record.id : "",
								similarity,
								data: record,
							});
						}
					}
				}

				// Sort by similarity (highest first) and limit results
				searchResults.sort((a, b) => b.similarity - a.similarity);
				const limitedResults = searchResults.slice(0, searchParams.limit);

				setResults(limitedResults);
				logInfo(
					`Found ${limitedResults.length} results above threshold ${searchParams.threshold}`,
				);
			});
		} catch (error) {
			logError("Failed to perform vector search:", error);
			setResults([]);
		} finally {
			setLoading(false);
		}
	};

	const handleResultSelect = (result: SearchResult) => {
		setSelectedResult(result);
		setShowMobileDetail(true);
	};

	const handleBackToList = () => {
		setShowMobileDetail(false);
	};

	const formatValue = (key: string, value: any) => {
		if (!value) return "N/A";

		if (key.includes("At") && typeof value === "string") {
			return new Date(value).toLocaleDateString("en-US", {
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			});
		}

		if (typeof value === "string" && value.length > 100) {
			return value.substring(0, 100) + "...";
		}

		return String(value);
	};

	const getServiceStatusIcon = (status: boolean) => {
		return status ? (
			<CheckCircle className="h-4 w-4 text-primary" />
		) : (
			<XCircle className="h-4 w-4 text-destructive" />
		);
	};

	const getSimilarityColor = (similarity: number) => {
		if (similarity >= 0.8) return "text-green-600";
		if (similarity >= 0.6) return "text-yellow-600";
		return "text-muted-foreground";
	};

	const renderResultSummary = (result: SearchResult) => {
		const tableConfig = VECTOR_TABLES[searchParams.table];
		const displayColumns = tableConfig.displayColumns;
		const data = result.data;

		return (
			<>
				<div className="flex items-center justify-between mb-2">
					<h3 className="font-medium text-sm text-foreground">
						{data[displayColumns[0]] || `Item ${result.id.slice(0, 8)}`}
					</h3>
					<Badge
						variant="secondary"
						className={`text-xs ${getSimilarityColor(result.similarity)}`}
					>
						{(result.similarity * 100).toFixed(1)}%
					</Badge>
				</div>
				{displayColumns.slice(1).map((column) => {
					const value = data[column];
					if (!value) return null;
					return (
						<div key={column} className="text-xs text-muted-foreground mb-1">
							<span className="font-medium">{column}:</span>{" "}
							{formatValue(column, value)}
						</div>
					);
				})}
			</>
		);
	};

	return (
		<div className="flex flex-col sm:flex-row h-full overflow-hidden bg-background">
			{/* Left Panel - Search and Results */}
			<div
				className={`w-full sm:w-2/3 border-r sm:border-r border-b sm:border-b-0 bg-card flex flex-col ${showMobileDetail ? "hidden sm:block" : ""} ${!showMobileDetail ? "h-full" : ""}`}
			>
				{/* Search Header */}
				<div className="p-3 border-b bg-muted/20">
					<div className="flex items-center justify-between mb-2">
						<div className="flex items-center gap-2">
							<Target className="h-4 w-4" />
							<span className="font-medium text-sm">Vector Search</span>
							<div className="flex items-center gap-1 ml-2">
								{getServiceStatusIcon(serviceStatus.database)}
								{getServiceStatusIcon(serviceStatus.overall)}
								{getServiceStatusIcon(isEmbeddingReady)}
							</div>
						</div>
						<Button
							onClick={performSearch}
							disabled={
								loading || !searchParams.query.trim() || !isEmbeddingReady
							}
							variant="default"
							size="sm"
							className="h-7 text-xs"
						>
							<Search
								className={`h-3 w-3 ${loading ? "animate-spin" : ""} mr-1`}
							/>
							Search
						</Button>
					</div>

					{/* Service Status */}
					{!isEmbeddingReady && (
						<div className="mb-2 p-2 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive">
							Embedding service not ready. Please wait for initialization to
							complete.
						</div>
					)}

					{/* Search Configuration */}
					<div className="space-y-2">
						<div className="flex gap-1 items-end">
							<div className="flex-1">
								<label className="block text-xs font-medium mb-1">Table</label>
								<Select
									value={searchParams.table}
									onValueChange={(value: VectorTableKey) => {
										setSearchParams((prev) => ({
											...prev,
											table: value,
											vectorColumn: VECTOR_TABLES[value].vectorColumns[0],
										}));
									}}
								>
									<SelectTrigger className="h-6 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{Object.entries(VECTOR_TABLES).map(([key, config]) => (
											<SelectItem key={key} value={key}>
												{config.name} ({stats[key] || 0})
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div className="flex-1">
								<label className="block text-xs font-medium mb-1">
									Vector Column
								</label>
								<Select
									value={searchParams.vectorColumn}
									onValueChange={(value) =>
										setSearchParams((prev) => ({
											...prev,
											vectorColumn: value,
										}))
									}
								>
									<SelectTrigger className="h-6 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{VECTOR_TABLES[searchParams.table].vectorColumns.map(
											(column) => (
												<SelectItem key={column} value={column}>
													{column}
												</SelectItem>
											),
										)}
									</SelectContent>
								</Select>
							</div>
							<div className="w-16">
								<label className="block text-xs font-medium mb-1">Limit</label>
								<Input
									type="number"
									min="1"
									max="100"
									value={searchParams.limit}
									onChange={(e) =>
										setSearchParams((prev) => ({
											...prev,
											limit: parseInt(e.target.value) || 20,
										}))
									}
									className="text-xs h-6"
								/>
							</div>
							<div className="w-20">
								<label className="block text-xs font-medium mb-1">
									Threshold
								</label>
								<Input
									type="number"
									min="0"
									max="1"
									step="0.1"
									value={searchParams.threshold}
									onChange={(e) =>
										setSearchParams((prev) => ({
											...prev,
											threshold: parseFloat(e.target.value) || 0.3,
										}))
									}
									className="text-xs h-6"
								/>
							</div>
						</div>

						{/* Search Query */}
						<div>
							<label className="block text-xs font-medium mb-1">
								Search Query
							</label>
							<Input
								placeholder="Enter text to search for similar content..."
								value={searchParams.query}
								onChange={(e) =>
									setSearchParams((prev) => ({
										...prev,
										query: e.target.value,
									}))
								}
								className="text-sm"
								onKeyDown={(e) => e.key === "Enter" && performSearch()}
							/>
						</div>
					</div>
				</div>

				{/* Results */}
				<div className="flex-1 flex flex-col min-h-0">
					{/* Results Header */}
					<div className="p-3 border-b bg-muted/20 flex-shrink-0">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">
								Results ({results.length}) -{" "}
								{VECTOR_TABLES[searchParams.table].name}
							</span>
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<Hash className="h-3 w-3" />
								Similarity scores shown
							</div>
						</div>
					</div>

					{/* Results List */}
					<div className="flex-1 overflow-hidden">
						<ScrollArea className="h-full">
							{Object.keys(VECTOR_TABLES).length === 0 ? (
								<div className="p-3 text-center text-muted-foreground">
									No vector-enabled tables found in the database schema.
								</div>
							) : !isInitialized ? (
								<div className="p-3 text-center text-muted-foreground">
									Database not yet initialized. Please wait for app startup to
									complete.
								</div>
							) : !isEmbeddingReady ? (
								<div className="p-3 text-center text-muted-foreground">
									Embedding service not ready. Please wait for initialization to
									complete.
								</div>
							) : loading ? (
								<div className="p-3 text-center text-muted-foreground">
									<div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto mb-2"></div>
									Searching...
								</div>
							) : results.length === 0 ? (
								<div className="p-3 text-center text-muted-foreground">
									{searchParams.query.trim()
										? "No similar content found. Try adjusting the threshold or search query."
										: "Enter a search query to find similar content"}
								</div>
							) : (
								<div className="divide-y divide-border">
									{results.map((result) => (
										<div
											key={result.id}
											className={`p-3 cursor-pointer hover:bg-muted/50 ${
												selectedResult?.id === result.id
													? "bg-accent border-r-2 border-primary"
													: ""
											}`}
											onClick={() => handleResultSelect(result)}
										>
											<div className="space-y-2">
												{renderResultSummary(result)}
											</div>
										</div>
									))}
								</div>
							)}
						</ScrollArea>
					</div>
				</div>
			</div>

			{/* Right Panel - Details and Stats */}
			<div
				className={`w-full sm:w-1/3 ${!showMobileDetail ? "hidden sm:block" : ""} ${showMobileDetail ? "h-full" : ""}`}
			>
				{selectedResult ? (
					<div className="h-full flex flex-col">
						{/* Header */}
						<div className="border-b bg-card p-3">
							<div className="flex items-center justify-between">
								<h2 className="text-lg font-semibold">Result Details</h2>
								<Button
									variant="ghost"
									size="sm"
									onClick={handleBackToList}
									className="sm:hidden"
								>
									<ArrowLeft className="h-4 w-4" />
								</Button>
							</div>
							<div className="text-sm text-muted-foreground mt-1 flex items-center gap-2">
								<span>ID: {selectedResult.id.slice(0, 8)}</span>
								<Badge
									variant="secondary"
									className={getSimilarityColor(selectedResult.similarity)}
								>
									{(selectedResult.similarity * 100).toFixed(1)}% similarity
								</Badge>
							</div>
						</div>

						{/* Content */}
						<ScrollArea className="flex-1 p-3">
							<div className="space-y-4">
								{Object.entries(selectedResult.data).map(([key, value]) => (
									<div key={key}>
										<h4 className="font-medium mb-2 text-sm">{key}</h4>
										<div className="text-xs bg-muted p-2 rounded overflow-auto">
											{key === searchParams.vectorColumn ? (
												<span className="text-muted-foreground italic">
													[Vector embedding -{" "}
													{Array.isArray(value) ? value.length : "unknown"}{" "}
													dimensions]
												</span>
											) : typeof value === "object" && value !== null ? (
												JSON.stringify(value, null, 2)
											) : (
												String(value || "null")
											)}
										</div>
									</div>
								))}
							</div>
						</ScrollArea>
					</div>
				) : (
					<div className="h-full">
						{/* Vector Tables Stats */}
						{isInitialized && (
							<Card className="m-4">
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-sm">
										<Database size={16} />
										Vector-Enabled Tables
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="space-y-2 text-sm">
										{Object.entries(VECTOR_TABLES).map(([key, config]) => (
											<div key={key} className="flex justify-between">
												<span>{config.name}:</span>
												<span className="font-medium">{stats[key] || 0}</span>
											</div>
										))}
									</div>
								</CardContent>
							</Card>
						)}

						{/* Embedding Service Status */}
						{isInitialized && (
							<Card className="m-4">
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-sm">
										<Zap size={16} />
										Embedding Service
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="space-y-2 text-sm">
										<div className="flex justify-between">
											<span>Status:</span>
											<span
												className={`font-medium ${isEmbeddingReady ? "text-primary" : "text-destructive"}`}
											>
												{isEmbeddingReady ? "Ready" : "Not Ready"}
											</span>
										</div>
										<div className="flex justify-between">
											<span>Search Type:</span>
											<span className="font-medium">Cosine Similarity</span>
										</div>
									</div>
								</CardContent>
							</Card>
						)}

						{/* Search Tips */}
						{isInitialized && (
							<Card className="m-4">
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-sm">
										<Target size={16} />
										Search Tips
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="space-y-2 text-xs text-muted-foreground">
										<p>• Use natural language to search for similar content</p>
										<p>• Adjust the threshold to control result precision</p>
										<p>• Higher threshold = more similar results</p>
										<p>• Similarity scores show content relevance</p>
									</div>
								</CardContent>
							</Card>
						)}

						{/* Placeholder */}
						<div className="flex items-center justify-center h-64 text-muted-foreground">
							<div className="text-center">
								<Target className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
								<p className="text-sm font-medium">
									Search for similar content
								</p>
								<p className="text-xs">
									Enter a query to find semantically similar items
								</p>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};
