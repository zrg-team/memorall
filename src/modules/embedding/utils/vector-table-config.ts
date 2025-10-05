import { schema } from "@/services/database/db";
import { logInfo } from "@/utils/logger";

// Utility function to get vector columns from a table schema
export const getVectorColumns = (table: any): string[] => {
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
export const getDisplayColumns = (tableName: string): string[] => {
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
export const getSearchableColumns = (tableName: string): string[] => {
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

export interface VectorTableConfig {
	name: string;
	vectorColumns: string[];
	displayColumns: string[];
	searchableColumns: string[];
}

// Function to dynamically build vector tables configuration
export const buildVectorTablesConfig = (): Record<
	string,
	VectorTableConfig
> => {
	const vectorTables: Record<string, VectorTableConfig> = {};

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

	// Log the detected vector tables for debugging
	logInfo("Detected vector tables:", vectorTables);

	return vectorTables;
};
