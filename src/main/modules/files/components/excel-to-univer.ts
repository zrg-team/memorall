import {
	BooleanNumber,
	CellValueType,
	type ICellData,
	type IWorkbookData,
	LocaleType,
} from "@univerjs/core";
import * as XLSX from "xlsx";

function toUniverCell(cell: XLSX.CellObject): ICellData | null {
	if (cell.v === undefined || cell.v === null) return null;

	if (cell.t === "n" && typeof cell.v === "number") {
		return { v: cell.v, t: CellValueType.NUMBER };
	}
	if (cell.t === "b") {
		return { v: Boolean(cell.v), t: CellValueType.BOOLEAN };
	}

	return {
		v: cell.v instanceof Date ? cell.v.toISOString() : String(cell.v),
		t: CellValueType.STRING,
	};
}

/** Convert SheetJS data into a minimal Univer workbook snapshot. */
export function convertXLSXToUniver(
	workbook: XLSX.WorkBook,
	fileName: string,
): Partial<IWorkbookData> {
	const sheets: NonNullable<Partial<IWorkbookData>["sheets"]> = {};

	workbook.SheetNames.forEach((sheetName, index) => {
		const worksheet = workbook.Sheets[sheetName];
		if (!worksheet) return;
		const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
		const cellData: Record<number, Record<number, ICellData>> = {};

		for (let row = range.s.r; row <= range.e.r; row++) {
			for (let column = range.s.c; column <= range.e.c; column++) {
				const address = XLSX.utils.encode_cell({ r: row, c: column });
				const converted = worksheet[address]
					? toUniverCell(worksheet[address])
					: null;
				if (!converted) continue;
				cellData[row] ??= {};
				cellData[row][column] = converted;
			}
		}

		const id = `sheet-${index}`;
		sheets[id] = {
			id,
			name: sheetName,
			tabColor: "",
			hidden: BooleanNumber.FALSE,
			rowCount: Math.max(range.e.r + 1, 100),
			columnCount: Math.max(range.e.c + 1, 20),
			zoomRatio: 1,
			scrollTop: 0,
			scrollLeft: 0,
			defaultColumnWidth: 73,
			defaultRowHeight: 19,
			mergeData: (worksheet["!merges"] ?? []).map((merge) => ({
				startRow: merge.s.r,
				endRow: merge.e.r,
				startColumn: merge.s.c,
				endColumn: merge.e.c,
			})),
			cellData,
			rowData: {},
			columnData: {},
			showGridlines: BooleanNumber.TRUE,
			rowHeader: { width: 46, hidden: BooleanNumber.FALSE },
			columnHeader: { height: 20, hidden: BooleanNumber.FALSE },
			rightToLeft: BooleanNumber.FALSE,
		};
	});

	return {
		id: "workbook-01",
		name: fileName,
		sheetOrder: Object.keys(sheets),
		sheets,
		locale: LocaleType.EN_US,
	};
}
