import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
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
import {
	Search,
	Download,
	Trash2,
	Clock,
	AlertCircle,
	Info,
	AlertTriangle,
	Bug,
	RefreshCw,
	List,
	Grid,
} from "lucide-react";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { logger, type LogEntry, type LogLevel } from "@/utils/logger";
import type { LogFilter } from "@/utils/indexeddb-storage";

interface LogsPageProps {}

export const LogsPage: React.FC<LogsPageProps> = () => {
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [loading, setLoading] = useState(true);
	const [searchQuery, setSearchQuery] = useState("");
	const [viewMode, setViewMode] = useState<"cards" | "text">("cards");
	const [filters, setFilters] = useState({
		level: undefined as LogLevel | undefined,
		source: undefined as string | undefined,
		timeRange: undefined as { start: Date; end: Date } | undefined,
	});
	const [stats, setStats] = useState({
		total: 0,
		byLevel: { debug: 0, info: 0, warn: 0, error: 0 } as Record<
			LogLevel,
			number
		>,
		oldestLog: undefined as string | undefined,
		newestLog: undefined as string | undefined,
	});

	const loadLogs = async () => {
		try {
			setLoading(true);
			const filter: LogFilter = {
				level: filters.level,
				source: filters.source,
				startTime: filters.timeRange?.start.getTime(),
				endTime: filters.timeRange?.end.getTime(),
			};

			const logsResult = await logger.getLogs(filter);
			const logCount = await logger.getLogCount();

			// Calculate stats from logs
			const byLevel = { debug: 0, info: 0, warn: 0, error: 0 };
			logsResult.forEach((log) => {
				byLevel[log.level]++;
			});

			setLogs(logsResult);
			setStats({
				total: logCount,
				byLevel,
				oldestLog:
					logsResult.length > 0
						? new Date(
								Math.min(...logsResult.map((l) => l.timestamp)),
							).toISOString()
						: undefined,
				newestLog:
					logsResult.length > 0
						? new Date(
								Math.max(...logsResult.map((l) => l.timestamp)),
							).toISOString()
						: undefined,
			});
		} catch (error) {
			console.error("Failed to load logs:", error);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		const initializeAndLoadLogs = async () => {
			loadLogs();
		};
		initializeAndLoadLogs();
	}, []);

	useEffect(() => {
		const debounceTimer = setTimeout(() => {
			loadLogs();
		}, 300);

		return () => clearTimeout(debounceTimer);
	}, [searchQuery, filters]);

	const handleExportLogs = async () => {
		try {
			const filter: LogFilter = {
				level: filters.level,
				source: filters.source,
				startTime: filters.timeRange?.start.getTime(),
				endTime: filters.timeRange?.end.getTime(),
			};
			const exportData = await logger.exportLogs(filter);
			const blob = new Blob([exportData], { type: "application/json" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `Memorall-logs-${new Date().toISOString().split("T")[0]}.json`;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch (error) {
			console.error("Failed to export logs:", error);
		}
	};

	const handleClearLogs = async () => {
		if (
			confirm(
				"Are you sure you want to clear all logs? This action cannot be undone.",
			)
		) {
			try {
				await logger.clearLogs();
				await loadLogs();
			} catch (error) {
				console.error("Failed to clear logs:", error);
			}
		}
	};

	const getLevelIcon = (level: LogLevel) => {
		switch (level) {
			case "debug":
				return <Bug className="w-4 h-4 text-muted-foreground" />;
			case "info":
				return <Info className="w-4 h-4 text-blue-500" />;
			case "warn":
				return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
			case "error":
				return <AlertCircle className="w-4 h-4 text-destructive" />;
		}
	};

	const getLevelColor = (level: LogLevel) => {
		switch (level) {
			case "debug":
				return "bg-muted/50 text-muted-foreground";
			case "info":
				return "bg-blue-100 text-blue-600";
			case "warn":
				return "bg-yellow-100 text-yellow-600";
			case "error":
				return "bg-destructive/10 text-destructive";
		}
	};

	const getSourceColor = (source?: string) => {
		if (!source) return "bg-gray-100 text-gray-600";

		if (source.includes("background")) return "bg-purple-100 text-purple-600";
		if (source.includes("content")) return "bg-green-100 text-green-600";
		if (source.includes("popup")) return "bg-orange-100 text-orange-600";
		if (source.includes("options")) return "bg-indigo-100 text-indigo-600";
		if (source.includes("offscreen")) return "bg-pink-100 text-pink-600";

		return "bg-gray-100 text-gray-600";
	};

	const formatTimestamp = (timestamp: number) => {
		const date = new Date(timestamp);
		return date.toLocaleString();
	};

	const formatData = (data: unknown) => {
		if (!data) return null;
		try {
			return JSON.stringify(data, null, 2);
		} catch {
			return String(data);
		}
	};

	const formatLogAsText = (log: LogEntry) => {
		const timestamp = new Date(log.timestamp).toLocaleString();
		const level = log.level.toUpperCase().padEnd(5);
		const source = (log.source || "unknown").toUpperCase().padEnd(10);
		let line = `[${timestamp}][${level}][${source}] ${log.message}`;

		if (log.context) {
			line += ` | Context: ${log.context}`;
		}

		if (log.data) {
			try {
				const dataStr =
					typeof log.data === "string" ? log.data : JSON.stringify(log.data);
				line += ` | Data: ${dataStr.replace(/\n/g, " ")}`;
			} catch {
				line += ` | Data: ${String(log.data)}`;
			}
		}

		return line;
	};

	return (
		<div className="flex h-full bg-background">
			{/* Main Content */}
			<div className="flex-1 flex flex-col max-w-full">
				{/* Header */}
				<div className="bg-card shadow-sm border-b p-3">
					<div className="flex items-center justify-between mb-3">
						<h1 className="text-lg font-bold text-foreground">Debug Logs</h1>
						<TooltipProvider>
							<div className="flex items-center space-x-1">
								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant={viewMode === "cards" ? "default" : "outline"}
											size="sm"
											onClick={() => setViewMode("cards")}
										>
											<Grid className="w-4 h-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										<p>Card view</p>
									</TooltipContent>
								</Tooltip>

								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant={viewMode === "text" ? "default" : "outline"}
											size="sm"
											onClick={() => setViewMode("text")}
										>
											<List className="w-4 h-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										<p>Text view</p>
									</TooltipContent>
								</Tooltip>

								<div className="w-px h-6 bg-border mx-1"></div>

								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="outline"
											size="sm"
											onClick={loadLogs}
											disabled={loading}
										>
											<RefreshCw
												className={`w-4 h-4 ${loading ? "animate-spin" : ""}`}
											/>
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										<p>Refresh logs</p>
									</TooltipContent>
								</Tooltip>

								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="outline"
											size="sm"
											onClick={handleExportLogs}
										>
											<Download className="w-4 h-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										<p>Export logs</p>
									</TooltipContent>
								</Tooltip>

								<Tooltip>
									<TooltipTrigger asChild>
										<Button
											variant="destructive"
											size="sm"
											onClick={handleClearLogs}
										>
											<Trash2 className="w-4 h-4" />
										</Button>
									</TooltipTrigger>
									<TooltipContent>
										<p>Clear all logs</p>
									</TooltipContent>
								</Tooltip>
							</div>
						</TooltipProvider>
					</div>

					{/* Stats */}
					<div className="flex items-center justify-between text-xs text-muted-foreground mb-2 px-1">
						<span>
							Total: <strong>{stats.total}</strong>
						</span>
						<span className="text-red-600">
							Errors: <strong>{stats.byLevel.error}</strong>
						</span>
						<span className="text-yellow-600">
							Warnings: <strong>{stats.byLevel.warn}</strong>
						</span>
						<span className="text-blue-600">
							Info: <strong>{stats.byLevel.info}</strong>
						</span>
					</div>

					{/* Search and Filters */}
					<div className="space-y-1">
						<div className="relative">
							<Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
							<Input
								type="text"
								placeholder="Search logs..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								className="pl-10 h-8"
							/>
						</div>

						<div className="flex space-x-1">
							<Select
								value={filters.level || ""}
								onValueChange={(value) =>
									setFilters((prev) => ({
										...prev,
										level:
											value === "__ALL__" ? undefined : (value as LogLevel),
									}))
								}
							>
								<SelectTrigger className="flex-1 h-8">
									<SelectValue placeholder="All Levels" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="__ALL__">All Levels</SelectItem>
									<SelectItem value="debug">Debug</SelectItem>
									<SelectItem value="info">Info</SelectItem>
									<SelectItem value="warn">Warning</SelectItem>
									<SelectItem value="error">Error</SelectItem>
								</SelectContent>
							</Select>

							<Select
								value={filters.source || ""}
								onValueChange={(value) =>
									setFilters((prev) => ({
										...prev,
										source: value === "__ALL__" ? undefined : value,
									}))
								}
							>
								<SelectTrigger className="flex-1 h-8">
									<SelectValue placeholder="All Sources" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="__ALL__">All Sources</SelectItem>
									<SelectItem value="background">Background</SelectItem>
									<SelectItem value="content">Content</SelectItem>
									<SelectItem value="popup">Popup</SelectItem>
									<SelectItem value="options">Options</SelectItem>
									<SelectItem value="offscreen">Offscreen</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				</div>

				{/* Logs List */}
				<ScrollArea
					className="flex-1 p-4 scrollbar-thin"
					viewPortClassName="scrollbar-thin !overflow-auto"
				>
					{loading ? (
						<div className="text-center py-8">
							<div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
							<p className="text-muted-foreground">Loading logs...</p>
						</div>
					) : logs.length === 0 ? (
						<div className="text-center py-8">
							<p className="text-muted-foreground">No logs found</p>
						</div>
					) : viewMode === "text" ? (
						<div className="bg-black text-green-400 p-4 rounded-lg font-mono text-sm overflow-auto">
							<div className="whitespace-pre select-text">
								{logs.map((log) => formatLogAsText(log)).join("\n")}
							</div>
						</div>
					) : (
						<div className="space-y-2">
							{logs.map((log) => (
								<Card
									key={log.id}
									className="hover:shadow-md transition-shadow"
								>
									<CardContent className="p-4">
										<div className="flex items-start space-x-3">
											<div className="flex-shrink-0 mt-1">
												{getLevelIcon(log.level)}
											</div>
											<div className="flex-1 min-w-0">
												<div className="flex items-center space-x-2 mb-1">
													<Badge
														variant="secondary"
														className={getLevelColor(log.level)}
													>
														{log.level.toUpperCase()}
													</Badge>
													<Badge
														variant="outline"
														className={getSourceColor(log.source)}
													>
														{log.source}
													</Badge>
													<div className="flex items-center text-xs text-muted-foreground">
														<Clock className="w-3 h-3 mr-1" />
														{formatTimestamp(log.timestamp)}
													</div>
												</div>

												<p className="text-sm font-medium text-foreground mb-1">
													{log.message}
												</p>

												{log.context && (
													<div className="text-xs text-muted-foreground mb-1">
														<span className="font-medium">Context:</span>{" "}
														<span className="break-all">{log.context}</span>
													</div>
												)}

												{log.data ? (
													<details className="mt-2">
														<summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
															Show data (
															{typeof log.data === "object"
																? "object"
																: typeof log.data}
															)
														</summary>
														<pre className="mt-1 p-2 bg-background rounded text-xs text-muted-foreground overflow-x-auto overflow-y-auto max-h-40 whitespace-pre">
															{formatData(log.data)}
														</pre>
													</details>
												) : undefined}
											</div>
										</div>
									</CardContent>
								</Card>
							))}
						</div>
					)}
				</ScrollArea>
			</div>
		</div>
	);
};
