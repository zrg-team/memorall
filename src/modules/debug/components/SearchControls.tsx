import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Search, Target, CheckCircle, XCircle, Hash } from "lucide-react";
import type { VectorTableConfig } from "../utils/vector-table-config";

interface SearchControlsProps {
	tables: Record<string, VectorTableConfig>;
	stats: Record<string, number>;
	selectedTable: string;
	selectedVectorColumn: string;
	query: string;
	limit: number;
	threshold: number;
	loading: boolean;
	isEmbeddingReady: boolean;
	serviceStatus: { database: boolean; overall: boolean };
	onTableChange: (table: string) => void;
	onVectorColumnChange: (column: string) => void;
	onQueryChange: (query: string) => void;
	onLimitChange: (limit: number) => void;
	onThresholdChange: (threshold: number) => void;
	onSearch: () => void;
}

export const SearchControls: React.FC<SearchControlsProps> = ({
	tables,
	stats,
	selectedTable,
	selectedVectorColumn,
	query,
	limit,
	threshold,
	loading,
	isEmbeddingReady,
	serviceStatus,
	onTableChange,
	onVectorColumnChange,
	onQueryChange,
	onLimitChange,
	onThresholdChange,
	onSearch,
}) => {
	const getServiceStatusIcon = (status: boolean) => {
		return status ? (
			<CheckCircle className="h-4 w-4 text-primary" />
		) : (
			<XCircle className="h-4 w-4 text-destructive" />
		);
	};

	return (
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
					onClick={onSearch}
					disabled={loading || !query.trim() || !isEmbeddingReady}
					variant="default"
					size="sm"
					className="h-7 text-xs"
				>
					<Search className={`h-3 w-3 ${loading ? "animate-spin" : ""} mr-1`} />
					Search
				</Button>
			</div>

			{!isEmbeddingReady && (
				<div className="mb-2 p-2 bg-destructive/10 border border-destructive/20 rounded text-xs text-destructive">
					Embedding service not ready. Please wait for initialization to
					complete.
				</div>
			)}

			<div className="space-y-2">
				<div className="flex gap-1 items-end">
					<div className="flex-1">
						<label className="block text-xs font-medium mb-1">Table</label>
						<Select value={selectedTable} onValueChange={onTableChange}>
							<SelectTrigger className="h-6 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Object.entries(tables).map(([key, config]) => (
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
							value={selectedVectorColumn}
							onValueChange={onVectorColumnChange}
						>
							<SelectTrigger className="h-6 text-xs">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{tables[selectedTable].vectorColumns.map((column) => (
									<SelectItem key={column} value={column}>
										{column}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div className="w-16">
						<label className="block text-xs font-medium mb-1">Limit</label>
						<Input
							type="number"
							min="1"
							max="100"
							value={limit}
							onChange={(e) => onLimitChange(parseInt(e.target.value) || 20)}
							className="text-xs h-6"
						/>
					</div>
					<div className="w-20">
						<label className="block text-xs font-medium mb-1">Threshold</label>
						<Input
							type="number"
							min="0"
							max="1"
							step="0.1"
							value={threshold}
							onChange={(e) =>
								onThresholdChange(parseFloat(e.target.value) || 0.3)
							}
							className="text-xs h-6"
						/>
					</div>
				</div>

				<div>
					<label className="block text-xs font-medium mb-1">Search Query</label>
					<Input
						placeholder="Enter text to search for similar content..."
						value={query}
						onChange={(e) => onQueryChange(e.target.value)}
						className="text-sm"
						onKeyDown={(e) => e.key === "Enter" && onSearch()}
					/>
				</div>
			</div>
		</div>
	);
};
