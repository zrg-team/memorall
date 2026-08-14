import { CellValueType } from "@univerjs/core";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { convertXLSXToUniver } from "../excel-to-univer";

describe("convertXLSXToUniver", () => {
	it("preserves sheet order and typed cached values without edit metadata", () => {
		const first = XLSX.utils.aoa_to_sheet([
			["Name", "Count", "Enabled", "Formula", "Empty"],
			["สวัสดี", 0, false, 5, null],
		]);
		first.D2 = { t: "n", v: 5, f: "B2+5" };
		first["!merges"] = [XLSX.utils.decode_range("A1:B1")];
		const second = XLSX.utils.aoa_to_sheet([["第二张"], [42]]);
		const workbook: XLSX.WorkBook = {
			SheetNames: ["Overview", "資料"],
			Sheets: { Overview: first, 資料: second },
		};

		const converted = convertXLSXToUniver(workbook, "fixture.xlsx");
		expect(converted.name).toBe("fixture.xlsx");
		expect(converted.sheetOrder).toEqual(["sheet-0", "sheet-1"]);
		expect(converted.sheets?.["sheet-0"]?.name).toBe("Overview");
		expect(converted.sheets?.["sheet-1"]?.name).toBe("資料");

		const cells = converted.sheets?.["sheet-0"]?.cellData;
		expect(cells?.[1]?.[0]).toEqual({
			v: "สวัสดี",
			t: CellValueType.STRING,
		});
		expect(cells?.[1]?.[1]).toEqual({ v: 0, t: CellValueType.NUMBER });
		expect(cells?.[1]?.[2]).toEqual({
			v: false,
			t: CellValueType.BOOLEAN,
		});
		expect(cells?.[1]?.[3]).toEqual({ v: 5, t: CellValueType.NUMBER });
		expect(cells?.[1]?.[4]).toBeUndefined();
		expect(converted.sheets?.["sheet-0"]?.mergeData).toEqual([
			{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
		]);

		const sheet = converted.sheets?.["sheet-0"];
		expect(sheet).not.toHaveProperty("protection");
		expect(sheet).not.toHaveProperty("selections");
		expect(converted).not.toHaveProperty("appVersion");
	});
});
