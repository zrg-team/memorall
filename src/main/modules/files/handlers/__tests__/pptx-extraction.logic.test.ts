import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
	parsePptx,
	presentationToMarkdown,
	readPresentation,
	type SlideElement,
} from "../pptx-extraction";

const NS =
	'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

const rels = (...entries: [string, string, string][]) =>
	`<?xml version="1.0"?><Relationships>${entries
		.map(
			([id, type, target]) =>
				`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`,
		)
		.join("")}</Relationships>`;

const xfrm = (x: number, y: number, cx: number, cy: number) =>
	`<a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>`;

const placeholder = (
	id: number,
	ph: string,
	properties: string,
	paragraphs: string,
) =>
	`<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="ph${id}"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:spPr>${properties}</p:spPr><p:txBody><a:bodyPr/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;

const run = (text: string) =>
	`<a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r>`;

const files: Record<string, string> = {
	"[Content_Types].xml": "<Types/>",
	"ppt/presentation.xml": `<p:presentation ${NS}><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`,
	"ppt/_rels/presentation.xml.rels": rels(
		["rId1", "slideMaster", "slideMasters/slideMaster1.xml"],
		["rId2", "slide", "slides/slide1.xml"],
		["rId3", "slide", "slides/slide2.xml"],
	),
	"ppt/theme/theme1.xml": `<a:theme ${NS}><a:themeElements><a:clrScheme name="t"><a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="222222"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme><a:fontScheme name="f"><a:majorFont><a:latin typeface="Georgia"/></a:majorFont><a:minorFont><a:latin typeface="Verdana"/></a:minorFont></a:fontScheme></a:themeElements></a:theme>`,
	"ppt/slideMasters/slideMaster1.xml": `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:schemeClr val="bg2"/></a:solidFill></p:bgPr></p:bg><p:spTree>${placeholder(
		2,
		'<p:ph type="title"/>',
		xfrm(100, 200, 8000000, 1000000),
		`<a:p>${run("Master title")}</a:p>`,
	)}${placeholder(
		3,
		'<p:ph type="body" idx="1"/>',
		xfrm(100, 1500000, 8000000, 4000000),
		`<a:p>${run("Master body")}</a:p>`,
	)}<p:sp><p:nvSpPr><p:cNvPr id="4" name="Band"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(0, 6500000, 9144000, 358000)}<a:prstGeom prst="rect"/><a:solidFill><a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr></a:solidFill></p:spPr></p:sp></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1"/><p:txStyles><p:titleStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/></a:defRPr></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr marL="342900" indent="-342900"><a:buChar char="•"/><a:defRPr sz="2800"/></a:lvl1pPr><a:lvl2pPr marL="742950" indent="-285750"><a:buChar char="–"/><a:defRPr sz="2400"/></a:lvl2pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`,
	"ppt/slideMasters/_rels/slideMaster1.xml.rels": rels([
		"rId1",
		"theme",
		"../theme/theme1.xml",
	]),
	"ppt/slideLayouts/slideLayout1.xml": `<p:sldLayout ${NS}><p:cSld><p:spTree>${placeholder(
		2,
		'<p:ph type="title"/>',
		"",
		`<a:p>${run("Layout title")}</a:p>`,
	)}${placeholder(
		3,
		'<p:ph idx="1"/>',
		xfrm(500000, 1600000, 7000000, 3000000),
		`<a:p>${run("Layout body")}</a:p>`,
	)}</p:spTree></p:cSld></p:sldLayout>`,
	"ppt/slideLayouts/_rels/slideLayout1.xml.rels": rels([
		"rId1",
		"slideMaster",
		"../slideMasters/slideMaster1.xml",
	]),
	"ppt/slides/slide1.xml": `<p:sld ${NS}><p:cSld><p:spTree>${placeholder(
		2,
		'<p:ph type="title"/>',
		"",
		`<a:p>${run("Q3 &amp; plans")}</a:p>`,
	)}${placeholder(
		3,
		'<p:ph idx="1"/>',
		"",
		`<a:p>${run("Revenue up")}</a:p><a:p><a:pPr lvl="1"/>${run("EU led")}</a:p><a:p><a:endParaRPr/></a:p>`,
	)}<p:pic><p:nvPicPr><p:cNvPr id="5" name="Picture" descr="Team photo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:srcRect l="10000" r="10000"/></p:blipFill><p:spPr>${xfrm(10, 20, 30, 40)}</p:spPr></p:pic><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="6" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="0" y="5000000"/><a:ext cx="4000000" cy="800000"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1"/><a:tblGrid><a:gridCol w="2000000"/><a:gridCol w="2000000"/></a:tblGrid><a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:p>${run("Region")}</a:p></a:txBody><a:tcPr><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:tcPr></a:tc><a:tc><a:txBody><a:bodyPr/><a:p>${run("Sales | net")}</a:p></a:txBody><a:tcPr/></a:tc></a:tr><a:tr h="400000"><a:tc><a:txBody><a:bodyPr/><a:p>${run("EU")}</a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:p>${run("1.2M")}</a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`,
	"ppt/slides/_rels/slide1.xml.rels": rels(
		["rId1", "slideLayout", "../slideLayouts/slideLayout1.xml"],
		["rId2", "image", "../media/image1.png"],
		["rId3", "notesSlide", "../notesSlides/notesSlide1.xml"],
	),
	"ppt/notesSlides/notesSlide1.xml": `<p:notes ${NS}><p:cSld><p:spTree>${placeholder(
		2,
		'<p:ph type="body" idx="1"/>',
		"",
		`<a:p>${run("Speak slowly")}</a:p>`,
	)}</p:spTree></p:cSld></p:notes>`,
	"ppt/slides/slide2.xml": `<p:sld ${NS} show="0" showMasterSp="0"><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="00FF00"><a:alpha val="50000"/></a:srgbClr></a:solidFill></p:bgPr></p:bg><p:spTree><p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="Group"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="1000000" y="1000000"/><a:ext cx="2000000" cy="2000000"/><a:chOff x="0" y="0"/><a:chExt cx="1000000" cy="1000000"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="3" name="Steps"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(500000, 500000, 100000, 100000)}<a:prstGeom prst="ellipse"/><a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr>${run("Plan")}</a:p><a:p><a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr>${run("Ship")}</a:p><a:p><a:fld id="{1}" type="slidenum"><a:t>‹#›</a:t></a:fld></a:p></p:txBody></p:sp></p:grpSp></p:spTree></p:cSld></p:sld>`,
	"ppt/slides/_rels/slide2.xml.rels": rels([
		"rId1",
		"slideLayout",
		"../slideLayouts/slideLayout1.xml",
	]),
};

const pptx = (): Uint8Array =>
	zipSync({
		...Object.fromEntries(
			Object.entries(files).map(([path, xml]) => [path, strToU8(xml)]),
		),
		"ppt/media/image1.png": new Uint8Array([137, 80, 78, 71]),
	});

const shapes = (elements: SlideElement[]) =>
	elements.filter(
		(element): element is Extract<SlideElement, { kind: "shape" }> =>
			element.kind === "shape",
	);

describe("parsePptx", () => {
	it("applies the layout, master and theme a slide inherits", () => {
		const deck = parsePptx(pptx());
		expect(deck).toMatchObject({ width: 9144000, height: 6858000 });
		expect(deck.slides).toHaveLength(2);
		const [first] = deck.slides;
		expect(first.background).toEqual({ kind: "color", color: "#eeeeee" });
		expect(first.notes).toBe("Speak slowly");

		const [band, title, body] = shapes(first.elements);
		// Master decoration under the slide's own shapes; placeholders are not drawn.
		expect(band).toMatchObject({
			layer: "master",
			fill: { kind: "color", color: "#203864" },
			text: null,
		});
		// The title has no position of its own or on the layout: the master's.
		expect(title.box).toMatchObject({ x: 100, y: 200, width: 8000000 });
		expect(title.text?.paragraphs[0]).toMatchObject({
			align: "center",
			bullet: null,
			runs: [
				{
					text: "Q3 & plans",
					size: 44,
					color: "#111111",
					font: "Georgia",
				},
			],
		});
		// The body takes the layout's position and the master's bullets.
		expect(body.box).toMatchObject({ x: 500000, y: 1600000 });
		expect(
			body.text?.paragraphs.map((paragraph) => [
				paragraph.level,
				paragraph.bullet?.text ?? null,
				paragraph.runs.map((part) => `${part.text}@${part.size}`).join(""),
			]),
		).toEqual([
			[0, "•", "Revenue up@28"],
			[1, "–", "EU led@24"],
			[0, null, ""],
		]);

		const picture = first.elements.find(
			(element) => element.kind === "picture",
		);
		expect(picture).toMatchObject({
			media: "ppt/media/image1.png",
			description: "Team photo",
			crop: { left: 0.1, right: 0.1, top: 0, bottom: 0 },
		});
		expect(deck.media["ppt/media/image1.png"]).toEqual(
			new Uint8Array([137, 80, 78, 71]),
		);

		const table = first.elements.find((element) => element.kind === "table");
		expect(table?.kind === "table" && table.columns).toEqual([
			2000000, 2000000,
		]);
		expect(
			table?.kind === "table" &&
				table.rows.map((row) => row.cells.map((cell) => cell.fill)),
		).toEqual([
			["#ff0000", null],
			[null, null],
		]);
	});

	it("maps grouped shapes to the slide and numbers lists and fields", () => {
		const [, second] = parsePptx(pptx()).slides;
		expect(second.hidden).toBe(true);
		expect(second.background).toEqual({
			kind: "color",
			color: "rgba(0, 255, 0, 0.5)",
		});
		// showMasterSp="0" leaves the master's band out.
		expect(second.elements).toHaveLength(1);
		const [steps] = shapes(second.elements);
		expect(steps.box).toMatchObject({
			x: 2000000,
			y: 2000000,
			width: 200000,
			height: 200000,
		});
		expect(steps.geometry).toEqual({
			kind: "preset",
			name: "ellipse",
			adjust: {},
		});
		expect(steps.text?.anchor).toBe("middle");
		expect(
			steps.text?.paragraphs.map((paragraph) => [
				paragraph.bullet?.text ?? null,
				paragraph.runs.map((part) => part.text).join(""),
			]),
		).toEqual([
			["1.", "Plan"],
			["2.", "Ship"],
			[null, "2"],
		]);
	});

	it("refuses files that are not presentations", async () => {
		expect(() =>
			parsePptx(zipSync({ "word/document.xml": strToU8("<w:document/>") })),
		).toThrow("This is not a PowerPoint presentation.");
		await expect(readPresentation(strToU8("plain text"))).rejects.toThrow(
			"This is not a PowerPoint presentation.",
		);
	});
});

describe("presentationToMarkdown", () => {
	it("gives each slide's title, text, tables, pictures and notes", async () => {
		expect(presentationToMarkdown(await readPresentation(pptx()))).toBe(
			[
				"## Slide 1: Q3 & plans",
				"- Revenue up\n  - EU led",
				"[Image: Team photo]",
				"| Region | Sales \\| net |\n| --- | --- |\n| EU | 1.2M |",
				"Notes: Speak slowly",
				"## Slide 2 (hidden)",
				"- Plan\n- Ship\n2",
			].join("\n\n"),
		);
	});
});
