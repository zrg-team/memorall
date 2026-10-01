/** A column as the table components draw it. */
export interface TableColumn {
	header: string;
	align?: "left" | "right" | "center";
}

const asColumn = (value: unknown): TableColumn | null => {
	if (typeof value === "string" || typeof value === "number") {
		return { header: String(value) };
	}
	if (!value || typeof value !== "object") return null;
	// A Col(...) element carries its arguments in props.
	const fields =
		(value as { props?: Record<string, unknown> }).props ??
		(value as Record<string, unknown>);
	const header = fields.header ?? fields.label ?? fields.title;
	if (header === undefined || header === null) return null;
	const align = fields.align;
	return {
		header: String(header),
		align:
			align === "left" || align === "right" || align === "center"
				? align
				: undefined,
	};
};

const asCell = (value: unknown): string =>
	value === null || value === undefined
		? ""
		: typeof value === "object"
			? JSON.stringify(value)
			: String(value);

const asRow = (value: unknown): string[] =>
	Array.isArray(value) ? value.map(asCell) : [asCell(value)];

/**
 * TableBlock's arguments as written, TableBlock(columns, rows), and as
 * models also write them: a title first, TableBlock("Title", columns, rows),
 * columns as plain strings, numbers in cells. What cannot be used is left
 * out instead of failing the table.
 */
export const tableArgs = (props: {
	columns?: unknown;
	rows?: unknown;
	rowsAfterTitle?: unknown;
}): { title?: string; columns: TableColumn[]; rows: string[][] } => {
	const titled = typeof props.columns === "string" && Array.isArray(props.rows);
	const columns = titled ? props.rows : props.columns;
	const rows = titled ? props.rowsAfterTitle : props.rows;
	return {
		title: titled ? (props.columns as string) : undefined,
		columns: Array.isArray(columns)
			? columns
					.map(asColumn)
					.filter((column): column is TableColumn => column !== null)
			: [],
		rows: Array.isArray(rows) ? rows.map(asRow) : [],
	};
};
