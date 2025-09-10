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
	Database,
	BarChart3,
	CheckCircle,
	XCircle,
	Play,
	Zap,
} from "lucide-react";
// Remove individual type imports since we'll use dynamic typing
import { databaseService } from "../services/database";
import {
	desc,
	asc,
	eq,
	like,
	gt,
	lt,
	gte,
	lte,
	ne,
	isNull,
	isNotNull,
} from "drizzle-orm";
import { serviceManager } from "../services/ServiceManager";
import { logError, logInfo } from "@/utils/logger";
import { schema } from "../services/database/db";

// Automatically build entity types from schema keys
type EntityType = keyof typeof schema;
// Use a generic record type instead of hardcoded union
type DatabaseRecord = Record<string, string>;

interface QueryCondition {
	field: string;
	operator: string;
	value: string;
}

interface QueryParams {
	entityType: EntityType;
	conditions: QueryCondition[];
	limit: number;
	offset: number;
	sortBy: string;
	sortOrder: "asc" | "desc";
}

// Build entity display names from schema keys automatically
const buildEntityDisplayName = (key: string): string => {
	// Convert camelCase to Title Case with spaces
	return key
		.replace(/([A-Z])/g, " $1")
		.replace(/^./, (str) => str.toUpperCase())
		.trim();
};

// Get all available entities from schema automatically
const getAvailableEntities = (): Record<EntityType, { name: string }> => {
	const entities = {} as Record<EntityType, { name: string }>;

	Object.keys(schema).forEach((key) => {
		entities[key as EntityType] = {
			name: buildEntityDisplayName(key),
		};
	});

	return entities;
};

// Get field type mapping from column introspection
const getFieldType = (columnType: string): string => {
	if (columnType.includes("UUID")) return "uuid";
	if (columnType.includes("Text")) return "text";
	if (columnType.includes("Varchar")) return "varchar";
	if (columnType.includes("Timestamp")) return "timestamp";
	if (columnType.includes("Boolean")) return "boolean";
	if (columnType.includes("Integer")) return "integer";
	if (columnType.includes("Real")) return "real";
	if (columnType.includes("Json")) return "jsonb";
	return "text"; // fallback
};

const OPERATORS: Record<string, { name: string; types: string[] }> = {
	eq: {
		name: "Equals",
		types: ["text", "varchar", "uuid", "integer", "real", "boolean"],
	},
	ne: {
		name: "Not Equals",
		types: ["text", "varchar", "uuid", "integer", "real", "boolean"],
	},
	like: { name: "Contains", types: ["text", "varchar"] },
	gt: { name: "Greater Than", types: ["integer", "real", "timestamp"] },
	gte: {
		name: "Greater Than or Equal",
		types: ["integer", "real", "timestamp"],
	},
	lt: { name: "Less Than", types: ["integer", "real", "timestamp"] },
	lte: { name: "Less Than or Equal", types: ["integer", "real", "timestamp"] },
	isNull: {
		name: "Is Null",
		types: [
			"text",
			"varchar",
			"uuid",
			"integer",
			"real",
			"boolean",
			"jsonb",
			"timestamp",
		],
	},
	isNotNull: {
		name: "Is Not Null",
		types: [
			"text",
			"varchar",
			"uuid",
			"integer",
			"real",
			"boolean",
			"jsonb",
			"timestamp",
		],
	},
};

export const DatabasePage: React.FC = () => {
	const [loading, setLoading] = useState(false);
	const [items, setItems] = useState<DatabaseRecord[]>([]);
	const [stats, setStats] = useState<Partial<Record<EntityType, number>>>({});
	const [selectedItem, setSelectedItem] = useState<DatabaseRecord | null>(null);
	const [showMobileDetail, setShowMobileDetail] = useState(false);
	const [serviceStatus, setServiceStatus] = useState(
		serviceManager.getServiceStatus(),
	);
	const [availableFields, setAvailableFields] = useState<
		Record<string, string>
	>({});

	// Query builder state - use first available entity as default
	const [queryParams, setQueryParams] = useState<QueryParams>({
		entityType: Object.keys(schema)[0] as EntityType,
		conditions: [],
		limit: 20,
		offset: 0,
		sortBy: "createdAt",
		sortOrder: "desc",
	});

	// Get dynamic entity config
	const availableEntities = getAvailableEntities();

	// Get initialization status from service manager
	const isInitialized = serviceManager.isInitialized();

	// Load data when component mounts if already initialized
	useEffect(() => {
		if (isInitialized) {
			loadStats();
			loadAvailableFields();
		}
		// Update service status periodically
		const interval = setInterval(() => {
			setServiceStatus(serviceManager.getServiceStatus());
		}, 1000);
		return () => clearInterval(interval);
	}, [isInitialized]);

	// Load data based on query params
	useEffect(() => {
		if (isInitialized) {
			loadData();
		}
	}, [queryParams, isInitialized]);

	// Update available fields when entity type changes
	useEffect(() => {
		if (isInitialized) {
			loadAvailableFields();
		}
	}, [queryParams.entityType, isInitialized]);

	// Load stats for all entities dynamically
	const loadStats = async () => {
		try {
			await databaseService.use(async ({ db, schema }) => {
				// Build dynamic promise array for all entities
				const entityKeys = Object.keys(schema) as EntityType[];
				const countPromises = entityKeys.map((entityKey) =>
					db
						.select()
						.from(schema[entityKey])
						.then((r) => r.length),
				);

				const counts = await Promise.all(countPromises);

				// Build stats object dynamically
				const newStats: Partial<Record<EntityType, number>> = {};
				entityKeys.forEach((entityKey, index) => {
					newStats[entityKey] = counts[index];
				});

				setStats(newStats);
			});
		} catch (error) {
			logError("Failed to load stats:", error);
		}
	};

	// Load available fields for current entity type
	const loadAvailableFields = async () => {
		try {
			await databaseService.use(async ({ schema }) => {
				const table = schema[queryParams.entityType];
				if (table) {
					// Get field info from the table schema
					const fields: Record<string, string> = {};

					// Extract field names and types from the table
					Object.keys(table).forEach((key) => {
						if (key !== "_" && key !== "Symbol.iterator") {
							const column = table[key as keyof typeof table];
							if (
								column &&
								typeof column === "object" &&
								"columnType" in column
							) {
								fields[key] = getFieldType(String(column.columnType));
							}
						}
					});

					setAvailableFields(fields);
				}
			});
		} catch (error) {
			logError("Failed to load available fields:", error);
			// Fallback to basic fields
			setAvailableFields({
				id: "uuid",
				createdAt: "timestamp",
				updatedAt: "timestamp",
			});
		}
	};

	// Build drizzle query conditions with proper typing
	const buildWhereConditions = (
		conditions: QueryCondition[],
		table: unknown,
	) => {
		if (conditions.length === 0) return undefined;

		const whereConditions = conditions
			.map((condition) => {
				const field = (table as Record<string, unknown>)[condition.field];
				if (!field) return null;

				switch (condition.operator) {
					case "eq":
						return eq(field as never, condition.value);
					case "ne":
						return ne(field as never, condition.value);
					case "like":
						return like(field as never, `%${condition.value}%`);
					case "gt":
						return gt(field as never, condition.value);
					case "gte":
						return gte(field as never, condition.value);
					case "lt":
						return lt(field as never, condition.value);
					case "lte":
						return lte(field as never, condition.value);
					case "isNull":
						return isNull(field as never);
					case "isNotNull":
						return isNotNull(field as never);
					default:
						return null;
				}
			})
			.filter(Boolean);

		return whereConditions.length > 0 ? whereConditions[0] : undefined; // For simplicity, use first condition
	};

	// Load data based on current query params
	const loadData = async () => {
		if (!isInitialized) return;

		setLoading(true);
		try {
			await databaseService.use(async ({ db, schema }) => {
				const table = schema[queryParams.entityType];
				const whereClause = buildWhereConditions(queryParams.conditions, table);
				const sortField = (table as unknown as Record<string, unknown>)[
					queryParams.sortBy
				];

				// Use unknown to bypass complex Drizzle type system
				let query = db.select().from(table) as unknown;

				if (whereClause) {
					query = (query as { where: (clause: unknown) => unknown }).where(
						whereClause,
					);
				}

				if (sortField) {
					const orderClause =
						queryParams.sortOrder === "desc"
							? desc(sortField as never)
							: asc(sortField as never);
					query = (query as { orderBy: (clause: unknown) => unknown }).orderBy(
						orderClause,
					);
				}

				const results = await (
					query as {
						limit: (n: number) => {
							offset: (n: number) => Promise<unknown[]>;
						};
					}
				)
					.limit(queryParams.limit)
					.offset(queryParams.offset);

				setItems(results as DatabaseRecord[]);
			});
		} catch (error) {
			logError("Failed to load data:", error);
			setItems([]);
		} finally {
			setLoading(false);
		}
	};

	// Create sample conversation
	const createSampleConversation = async () => {
		setLoading(true);
		try {
			await databaseService.use(async ({ db, schema }) => {
				// Create conversation
				const [conversation] = await db
					.insert(schema.conversations)
					.values({
						title: `Chat ${Date.now()}`,
						metadata: {
							type: "demo",
							model: "gpt-3.5-turbo",
						},
					})
					.returning();

				// Add sample messages
				await db.insert(schema.messages).values([
					{
						conversationId: conversation.id,
						role: "user",
						content: "Hello! This is a test message.",
						metadata: {},
					},
					{
						conversationId: conversation.id,
						role: "assistant",
						content:
							"Hello! I'm happy to help you test the database functionality.",
						metadata: {},
					},
				]);

				logInfo("✅ Conversation created:", conversation);
			});
			await loadData();
			await loadStats();
		} catch (error) {
			logError("❌ Failed to create conversation:", error);
		} finally {
			setLoading(false);
		}
	};

	const handleItemSelect = (item: DatabaseRecord) => {
		setSelectedItem(item);
		setShowMobileDetail(true);
	};

	const handleBackToList = () => {
		setShowMobileDetail(false);
	};

	const formatDate = (date: string | Date | undefined | null) => {
		if (!date) return "N/A";
		const dateObj = typeof date === "string" ? new Date(date) : date;
		return dateObj.toLocaleDateString("en-US", {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	const getServiceStatusIcon = (status: boolean) => {
		return status ? (
			<CheckCircle className="h-4 w-4 text-primary" />
		) : (
			<XCircle className="h-4 w-4 text-destructive" />
		);
	};

	const addCondition = () => {
		const fields = Object.keys(availableFields);
		setQueryParams((prev) => ({
			...prev,
			conditions: [
				...prev.conditions,
				{
					field: fields[0] || "id",
					operator: "eq",
					value: "",
				},
			],
		}));
	};

	const removeCondition = (index: number) => {
		setQueryParams((prev) => ({
			...prev,
			conditions: prev.conditions.filter((_, i) => i !== index),
		}));
	};

	const updateCondition = (index: number, updates: Partial<QueryCondition>) => {
		setQueryParams((prev) => ({
			...prev,
			conditions: prev.conditions.map((condition, i) =>
				i === index ? { ...condition, ...updates } : condition,
			),
		}));
	};

	const resetQuery = () => {
		setQueryParams((prev) => ({
			...prev,
			conditions: [],
			offset: 0,
		}));
	};

	const executeQuery = () => {
		setQueryParams((prev) => ({ ...prev, offset: 0 }));
	};

	const nextPage = () => {
		setQueryParams((prev) => ({
			...prev,
			offset: prev.offset + prev.limit,
		}));
	};

	const prevPage = () => {
		setQueryParams((prev) => ({
			...prev,
			offset: Math.max(0, prev.offset - prev.limit),
		}));
	};

	const getAvailableOperators = (fieldType: string) => {
		return Object.entries(OPERATORS).filter(([_, op]) =>
			op.types.includes(fieldType),
		);
	};

	const renderItemSummary = (item: DatabaseRecord) => {
		// Use safe property access since we don't know the exact type
		const id = item.id || "";
		const createdAt = item.createdAt || item.created_at;

		switch (queryParams.entityType) {
			case "conversations":
				return (
					<>
						<h3 className="font-medium text-sm text-foreground">
							{item.title || `Conversation ${id.toString().slice(0, 8)}`}
						</h3>
						<div className="text-xs text-muted-foreground">
							{formatDate(createdAt)}
						</div>
					</>
				);
			case "messages":
				return (
					<>
						<div className="flex justify-between items-start mb-1">
							<Badge variant="secondary" className="text-xs">
								{item.role || "message"}
							</Badge>
							<span className="text-xs text-muted-foreground">
								{item.conversationId?.toString().slice(0, 8) || ""}
							</span>
						</div>
						<p className="text-xs text-muted-foreground line-clamp-2">
							{item.content?.toString().substring(0, 100) || ""}...
						</p>
						<div className="text-xs text-muted-foreground">
							{formatDate(createdAt)}
						</div>
					</>
				);
			case "sources":
				return (
					<>
						<h3 className="font-medium text-sm text-foreground">
							{item.name || id.toString().slice(0, 8)}
						</h3>
						<div className="text-xs text-muted-foreground">
							{item.targetType}: {item.targetId}
						</div>
						<div className="text-xs text-muted-foreground">
							{formatDate(createdAt)}
						</div>
					</>
				);
			case "nodes":
				return (
					<>
						<h3 className="font-medium text-sm text-foreground">
							{item.name || id.toString().slice(0, 8)}
						</h3>
						<div className="text-xs text-muted-foreground">
							Type: {item.nodeType || "unknown"}
						</div>
						<div className="text-xs text-muted-foreground">
							{formatDate(createdAt)}
						</div>
					</>
				);
			case "edges":
				return (
					<>
						<h3 className="font-medium text-sm text-foreground">
							{item.edgeType || "Edge"}
						</h3>
						<p className="text-xs text-muted-foreground line-clamp-2">
							{item.factText?.toString().substring(0, 100) || ""}
						</p>
						<div className="text-xs text-muted-foreground">
							{formatDate(createdAt)}
						</div>
					</>
				);
			case "rememberedContent":
				return (
					<>
						<h3 className="font-medium text-sm text-foreground">
							{item.title || id.toString().slice(0, 8)}
						</h3>
						<p className="text-xs text-muted-foreground line-clamp-2">
							{item.textContent?.toString().substring(0, 100) || ""}
						</p>
						<div className="text-xs text-muted-foreground">
							{formatDate(createdAt)}
						</div>
					</>
				);
			default:
				return (
					<>
						<h3 className="font-medium text-sm text-foreground">
							{id.toString().slice(0, 8) || "Item"}
						</h3>
						<div className="text-xs text-muted-foreground">
							{formatDate(createdAt)}
						</div>
					</>
				);
		}
	};

	return (
		<div className="flex flex-col sm:flex-row h-full overflow-hidden bg-background">
			{/* Left Panel - Items List */}
			<div
				className={`w-full sm:w-2/3 border-r sm:border-r border-b sm:border-b-0 bg-card flex flex-col ${showMobileDetail ? "hidden sm:block" : ""} ${!showMobileDetail ? "h-full" : ""}`}
			>
				{/* Database Status Header - Compact */}
				<div className="p-3 border-b bg-muted/20">
					<div className="flex items-center justify-between mb-2">
						<div className="flex items-center gap-2">
							<Database className="h-4 w-4" />
							<span className="font-medium text-sm">Query Builder</span>
							<div className="flex items-center gap-1 ml-2">
								{getServiceStatusIcon(serviceStatus.database)}
								{getServiceStatusIcon(serviceStatus.overall)}
							</div>
						</div>
						<div className="flex gap-1">
							<Button
								onClick={resetQuery}
								disabled={loading}
								variant="outline"
								size="sm"
								className="h-7 text-xs"
							>
								Reset
							</Button>
							<Button
								onClick={executeQuery}
								disabled={loading}
								variant="default"
								size="sm"
								className="h-7 text-xs"
							>
								<Play
									className={`h-3 w-3 ${loading ? "animate-spin" : ""} mr-1`}
								/>
								Query
							</Button>
						</div>
					</div>

					{/* Compact Controls - Single Line */}
					<div className="space-y-2">
						<div className="flex gap-1 items-end">
							<div className="flex-1">
								<label className="block text-xs font-medium mb-1">Entity</label>
								<Select
									value={queryParams.entityType}
									onValueChange={(value: EntityType) => {
										setQueryParams((prev) => ({
											...prev,
											entityType: value,
											conditions: [],
											sortBy: "createdAt",
											offset: 0,
										}));
									}}
								>
									<SelectTrigger className="h-6 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{Object.entries(availableEntities).map(([key, config]) => {
											return (
												<SelectItem key={key} value={key}>
													{config.name} ({stats[key as EntityType] || 0})
												</SelectItem>
											);
										})}
									</SelectContent>
								</Select>
							</div>
							<div className="flex-1">
								<label className="block text-xs font-medium mb-1">Sort</label>
								<Select
									value={queryParams.sortBy}
									onValueChange={(value) =>
										setQueryParams((prev) => ({ ...prev, sortBy: value }))
									}
								>
									<SelectTrigger className="h-6 text-xs">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{Object.keys(availableFields).map((field) => (
											<SelectItem key={field} value={field}>
												{field}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
							<div>
								<button
									className="h-6 w-6 border border-border rounded text-xs hover:bg-muted/50 flex items-center justify-center"
									onClick={() =>
										setQueryParams((prev) => ({
											...prev,
											sortOrder: prev.sortOrder === "desc" ? "asc" : "desc",
										}))
									}
									title={`Sort ${queryParams.sortOrder === "desc" ? "Ascending" : "Descending"}`}
								>
									{queryParams.sortOrder === "desc" ? "↓" : "↑"}
								</button>
							</div>
							<div className="w-16">
								<label className="block text-xs font-medium mb-1">Limit</label>
								<Input
									type="number"
									min="1"
									max="100"
									value={queryParams.limit}
									onChange={(e) =>
										setQueryParams((prev) => ({
											...prev,
											limit: parseInt(e.target.value) || 20,
										}))
									}
									className="text-xs h-6"
								/>
							</div>
							<div className="w-16">
								<label className="block text-xs font-medium mb-1">Offset</label>
								<Input
									type="number"
									min="0"
									value={queryParams.offset}
									onChange={(e) =>
										setQueryParams((prev) => ({
											...prev,
											offset: parseInt(e.target.value) || 0,
										}))
									}
									className="text-xs h-6"
								/>
							</div>
							<div>
								<button
									onClick={addCondition}
									className="h-6 w-6 border border-border rounded text-xs hover:bg-muted/50 flex items-center justify-center"
									title="Add Condition"
								>
									+
								</button>
							</div>
						</div>

						{/* Query Conditions */}
						<div>
							{queryParams.conditions.length > 0 && (
								<div className="mb-1">
									<label className="block text-xs font-medium">
										Conditions
									</label>
								</div>
							)}
							{queryParams.conditions.map((condition, index) => {
								const fieldType = availableFields[condition.field];
								const availableOperators = getAvailableOperators(fieldType);

								return (
									<div key={index} className="grid grid-cols-12 gap-1 mb-1">
										{/* Field Selection */}
										<div className="col-span-4">
											<Select
												value={condition.field}
												onValueChange={(value) =>
													updateCondition(index, { field: value })
												}
											>
												<SelectTrigger className="text-xs h-7">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{Object.entries(availableFields).map(
														([field, type]) => (
															<SelectItem key={field} value={field}>
																<div className="flex justify-between w-full">
																	<span>{field}</span>
																	<span className="text-muted-foreground ml-2">
																		({type})
																	</span>
																</div>
															</SelectItem>
														),
													)}
												</SelectContent>
											</Select>
										</div>

										{/* Operator Selection */}
										<div className="col-span-3">
											<Select
												value={condition.operator}
												onValueChange={(value) =>
													updateCondition(index, { operator: value })
												}
											>
												<SelectTrigger className="text-xs h-7">
													<SelectValue />
												</SelectTrigger>
												<SelectContent>
													{availableOperators.map(([op, config]) => (
														<SelectItem key={op} value={op}>
															{config.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>

										{/* Value Input */}
										<div className="col-span-4">
											{!["isNull", "isNotNull"].includes(
												condition.operator,
											) && (
												<Input
													placeholder="Value"
													value={condition.value}
													onChange={(e) =>
														updateCondition(index, { value: e.target.value })
													}
													className="text-xs h-7"
												/>
											)}
										</div>

										{/* Remove Button */}
										<div className="col-span-1">
											<Button
												onClick={() => removeCondition(index)}
												variant="outline"
												size="sm"
												className="h-7 w-7 p-0 text-xs"
											>
												×
											</Button>
										</div>
									</div>
								);
							})}
						</div>
					</div>
				</div>

				{/* Results */}
				<div className="flex-1 flex flex-col min-h-0">
					{/* Results Header */}
					<div className="p-3 border-b bg-muted/20 flex-shrink-0">
						<div className="flex items-center justify-between">
							<span className="text-sm font-medium">
								Results ({items.length}) - {queryParams.entityType}
							</span>
							<div className="flex gap-1">
								<Button
									onClick={prevPage}
									disabled={queryParams.offset === 0 || loading}
									variant="outline"
									size="sm"
								>
									Previous
								</Button>
								<Button
									onClick={nextPage}
									disabled={items.length < queryParams.limit || loading}
									variant="outline"
									size="sm"
								>
									Next
								</Button>
							</div>
						</div>
					</div>

					{/* Items List */}
					<div className="flex-1 overflow-hidden">
						<ScrollArea className="h-full">
							{!isInitialized ? (
								<div className="p-3 text-center text-muted-foreground">
									Database not yet initialized. Please wait for app startup to
									complete.
								</div>
							) : loading ? (
								<div className="p-3 text-center text-muted-foreground">
									Loading...
								</div>
							) : items.length === 0 ? (
								<div className="p-3 text-center text-muted-foreground">
									No items found matching your query
								</div>
							) : (
								<div className="divide-y">
									{items.map((item) => {
										const itemId = item.id?.toString() || "";
										const selectedItemId = selectedItem?.id?.toString() || "";
										return (
											<div
												key={itemId}
												className={`p-3 cursor-pointer hover:bg-muted/50 ${
													selectedItem && selectedItemId === itemId
														? "bg-accent border-r-2 border-primary"
														: ""
												}`}
												onClick={() => handleItemSelect(item)}
											>
												<div className="space-y-2">
													{renderItemSummary(item)}
												</div>
											</div>
										);
									})}
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
				{selectedItem ? (
					<div className="h-full flex flex-col">
						{/* Header */}
						<div className="border-b bg-card p-3">
							<div className="flex items-center justify-between">
								<h2 className="text-lg font-semibold">
									{queryParams.entityType} Details
								</h2>
								<Button
									variant="ghost"
									size="sm"
									onClick={handleBackToList}
									className="sm:hidden"
								>
									Back
								</Button>
							</div>
							<div className="text-sm text-muted-foreground mt-1">
								ID: {selectedItem?.id?.toString().slice(0, 8) || "N/A"}
							</div>
						</div>

						{/* Content */}
						<ScrollArea className="flex-1 p-3">
							<div className="space-y-4">
								{Object.entries(selectedItem).map(([key, value]) => (
									<div key={key}>
										<h4 className="font-medium mb-2 text-sm">{key}</h4>
										<div className="text-xs bg-muted p-2 rounded overflow-auto">
											{typeof value === "object" && value !== null
												? JSON.stringify(value, null, 2)
												: String(value || "null")}
										</div>
									</div>
								))}
							</div>
						</ScrollArea>
					</div>
				) : (
					<div className="h-full">
						{/* Database Stats */}
						{isInitialized && (
							<Card className="m-4">
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-sm">
										<BarChart3 size={16} />
										Entity Statistics
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="space-y-2 text-sm">
										{Object.entries(availableEntities).map(([key, config]) => (
											<div key={key} className="flex justify-between">
												<span>{config.name}:</span>
												<span className="font-medium">
													{stats[key as EntityType] || 0}
												</span>
											</div>
										))}
									</div>
								</CardContent>
							</Card>
						)}

						{/* Quick Actions */}
						{isInitialized && (
							<Card className="m-4">
								<CardHeader>
									<CardTitle className="flex items-center gap-2 text-sm">
										<Zap size={16} />
										Quick Actions
									</CardTitle>
								</CardHeader>
								<CardContent>
									<div className="space-y-2">
										<Button
											onClick={createSampleConversation}
											disabled={loading}
											variant="outline"
											size="sm"
											className="w-full"
										>
											Create Sample Conversation
										</Button>
										<Button
											onClick={loadStats}
											disabled={loading}
											variant="outline"
											size="sm"
											className="w-full"
										>
											Refresh Stats
										</Button>
									</div>
								</CardContent>
							</Card>
						)}

						{/* Placeholder */}
						<div className="flex items-center justify-center h-64 text-muted-foreground">
							<div className="text-center">
								<Database className="h-12 w-12 mx-auto mb-4 text-muted-foreground/50" />
								<p className="text-sm font-medium">
									Select an item to view details
								</p>
								<p className="text-xs">
									Run a query and choose an item from the results
								</p>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
};
