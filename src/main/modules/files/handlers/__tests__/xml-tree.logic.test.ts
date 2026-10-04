import { describe, expect, it } from "vitest";
import { parseXml, xmlChild, xmlFindAll, xmlPath } from "../xml-tree";

describe("parseXml", () => {
	it("reads local names, attributes as written and decoded text", () => {
		const root = parseXml(
			`<?xml version="1.0"?><!-- note --><p:sld xmlns:p="urn:p" show='0'><p:sp a="x > y" r:id="rId1" id="2"><a:t>Tom &amp; Jerry &#x2192; &lt;b&gt; &#65;</a:t><a:t><![CDATA[<raw>]]></a:t><a:br/></p:sp></p:sld>`,
		);
		const slide = xmlChild(root, "sld");
		expect(slide?.attrs.show).toBe("0");
		const shape = xmlPath(root, "sld", "sp");
		expect(shape?.attrs).toEqual({ a: "x > y", "r:id": "rId1", id: "2" });
		expect(xmlFindAll(root, "t").map((node) => node.text)).toEqual([
			"Tom & Jerry → <b> A",
			"<raw>",
		]);
		expect(shape?.children.map((node) => node.name)).toEqual(["t", "t", "br"]);
	});
});
