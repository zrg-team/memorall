import { describe, expect, it } from "vitest";
import { escapeStrayQuotes } from "../repair-openui";
import { tableArgs } from "../components/table-args";

describe("escapeStrayQuotes", () => {
	it("escapes quotes a model left inside a string", () => {
		expect(
			escapeStrayQuotes(
				'a = AlertBlock("Note", "Now called "Fast mode" (renamed).", "default")',
			),
		).toBe(
			'a = AlertBlock("Note", "Now called \\"Fast mode\\" (renamed).", "default")',
		);
		expect(escapeStrayQuotes('t = TextContent("say "hi" 2 times")')).toBe(
			't = TextContent("say \\"hi\\" 2 times")',
		);
	});

	it("leaves valid OpenUI Lang as it is", () => {
		const valid = [
			'root = CardBlock("Title", "Description", [section_1, section_2])',
			'section_1 = TableBlock([Col("Model"), Col("Input", "right")], [["a", "1"], ["b", "2"]])',
			'section_2 = ButtonBlock("Go", { "type": "send_message", "message": "Plan: {{start}}" })',
			'x = TextContent("escaped \\"quote\\" stays")',
			'y = TextContent($ready ? "Ready" : "Waiting")',
			'z = TextContent("a" + $name)',
			'w = TextContent("multi\nline")',
			'partial = TextContent("still stream',
		].join("\n");
		expect(escapeStrayQuotes(valid)).toBe(valid);
	});
});

describe("tableArgs", () => {
	const col = (header: string, align?: string) => ({
		type: "element",
		typeName: "Col",
		props: { header, align },
	});

	it("reads TableBlock(columns, rows)", () => {
		expect(
			tableArgs({ columns: [col("A"), col("B", "right")], rows: [["1", 2]] }),
		).toEqual({
			title: undefined,
			columns: [
				{ header: "A", align: undefined },
				{ header: "B", align: "right" },
			],
			rows: [["1", "2"]],
		});
	});

	it("reads TableBlock(title, columns, rows), which models also write", () => {
		expect(
			tableArgs({
				columns: "Prices",
				rows: [col("Model"), "Input"],
				rowsAfterTitle: [["o3", "$2.00"]],
			}),
		).toEqual({
			title: "Prices",
			columns: [{ header: "Model", align: undefined }, { header: "Input" }],
			rows: [["o3", "$2.00"]],
		});
	});

	it("draws an empty table rather than failing on what it cannot use", () => {
		expect(tableArgs({ columns: "oops", rows: "nope" })).toEqual({
			title: undefined,
			columns: [],
			rows: [],
		});
	});
});
