/**
 * Excel file extraction utilities
 * Uses SheetJS (xlsx) library to parse Excel files
 */

import * as XLSX from "xlsx";

export interface ExcelMetadata {
	sheetCount: number;
	sheetNames: string[];
	title?: string;
}

/**
 * Extract metadata from Excel file
 */
export async function readExcelFile(file: File): Promise<ExcelMetadata> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();

		reader.onload = (e) => {
			try {
				const data = new Uint8Array(e.target?.result as ArrayBuffer);
				const workbook = XLSX.read(data, { type: "array" });

				const metadata: ExcelMetadata = {
					sheetCount: workbook.SheetNames.length,
					sheetNames: workbook.SheetNames,
					title: file.name.replace(/\.(xls|xlsx|xlsm)$/i, ""),
				};

				resolve(metadata);
			} catch (error) {
				reject(error);
			}
		};

		reader.onerror = () => {
			reject(new Error("Failed to read Excel file"));
		};

		reader.readAsArrayBuffer(file);
	});
}

/**
 * Parse Excel file and return workbook
 */
export async function parseExcelFile(
	fileData: Uint8Array,
): Promise<XLSX.WorkBook> {
	return XLSX.read(fileData, { type: "array" });
}

/**
 * Convert Excel sheet to markdown table
 */
export function sheetToMarkdown(
	workbook: XLSX.WorkBook,
	sheetName: string,
): string {
	const worksheet = workbook.Sheets[sheetName];
	if (!worksheet) {
		throw new Error(`Sheet "${sheetName}" not found`);
	}

	// Get the range of the worksheet
	const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");

	// Extract data as 2D array
	const data: (string | number | boolean | null)[][] = [];
	for (let R = range.s.r; R <= range.e.r; ++R) {
		const row: (string | number | boolean | null)[] = [];
		for (let C = range.s.c; C <= range.e.c; ++C) {
			const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
			const cell = worksheet[cellAddress];
			row.push(cell ? cell.v : null);
		}
		data.push(row);
	}

	// Convert to markdown table
	if (data.length === 0) {
		return "*Empty sheet*";
	}

	let markdown = "";

	// Header row (first row)
	const headers = data[0].map((cell) => String(cell ?? ""));
	markdown += "| " + headers.join(" | ") + " |\n";

	// Separator row
	markdown += "| " + headers.map(() => "---").join(" | ") + " |\n";

	// Data rows
	for (let i = 1; i < data.length; i++) {
		const row = data[i].map((cell) => String(cell ?? ""));
		markdown += "| " + row.join(" | ") + " |\n";
	}

	return markdown;
}

/**
 * Convert Excel sheet to CSV string
 */
export function sheetToCsv(workbook: XLSX.WorkBook, sheetName: string): string {
	const worksheet = workbook.Sheets[sheetName];
	if (!worksheet) {
		throw new Error(`Sheet "${sheetName}" not found`);
	}
	return XLSX.utils.sheet_to_csv(worksheet);
}

/**
 * Get all sheets as markdown
 */
export function workbookToMarkdown(workbook: XLSX.WorkBook): string {
	let markdown = "";

	for (const sheetName of workbook.SheetNames) {
		markdown += `## ${sheetName}\n\n`;
		markdown += sheetToMarkdown(workbook, sheetName);
		markdown += "\n\n";
	}

	return markdown;
}
