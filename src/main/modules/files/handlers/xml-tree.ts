/**
 * A small XML reader for Office Open XML parts. Elements are named by their
 * local name ("sp" for "p:sp"); attributes keep the name as written
 * ("r:embed"), since an element can carry both "id" and "r:id". String-based
 * so it runs where DOMParser does not (workers, tests).
 */
export interface XmlNode {
	name: string;
	attrs: Record<string, string>;
	children: XmlNode[];
	/** The text directly inside the element, decoded. */
	text: string;
}

const ENTITY = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;
const NAMED_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
};

export const decodeXmlText = (text: string): string =>
	text.includes("&")
		? text.replace(ENTITY, (_, entity: string) => {
				if (entity[0] !== "#") return NAMED_ENTITIES[entity.toLowerCase()];
				const code =
					entity[1] === "x" || entity[1] === "X"
						? Number.parseInt(entity.slice(2), 16)
						: Number(entity.slice(1));
				return Number.isFinite(code) && code <= 0x10ffff
					? String.fromCodePoint(code)
					: "";
			})
		: text;

const ATTRIBUTE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** The index of the `>` closing the tag at `start`, skipping quoted values. */
const tagEnd = (xml: string, start: number): number => {
	let quote = "";
	for (let index = start + 1; index < xml.length; index += 1) {
		const char = xml[index];
		if (quote) {
			if (char === quote) quote = "";
		} else if (char === '"' || char === "'") quote = char;
		else if (char === ">") return index;
	}
	return xml.length;
};

/** The document root; its children are the top-level elements. */
export function parseXml(xml: string): XmlNode {
	const root: XmlNode = { name: "", attrs: {}, children: [], text: "" };
	const stack = [root];
	let index = 0;
	while (index < xml.length) {
		const open = xml.indexOf("<", index);
		const parent = stack[stack.length - 1];
		if (open < 0) break;
		if (open > index) parent.text += decodeXmlText(xml.slice(index, open));
		if (xml.startsWith("<!--", open)) {
			const end = xml.indexOf("-->", open + 4);
			index = end < 0 ? xml.length : end + 3;
			continue;
		}
		if (xml.startsWith("<![CDATA[", open)) {
			const end = xml.indexOf("]]>", open + 9);
			parent.text += xml.slice(open + 9, end < 0 ? xml.length : end);
			index = end < 0 ? xml.length : end + 3;
			continue;
		}
		const close = tagEnd(xml, open);
		index = close + 1;
		const marker = xml[open + 1];
		if (marker === "?" || marker === "!") continue;
		if (marker === "/") {
			if (stack.length > 1) stack.pop();
			continue;
		}
		const selfClosing = xml[close - 1] === "/";
		const body = xml.slice(open + 1, selfClosing ? close - 1 : close);
		const nameEnd = body.search(/\s/);
		const qualified = nameEnd < 0 ? body : body.slice(0, nameEnd);
		const node: XmlNode = {
			name: qualified.slice(qualified.indexOf(":") + 1),
			attrs: {},
			children: [],
			text: "",
		};
		if (nameEnd >= 0) {
			for (const match of body.slice(nameEnd).matchAll(ATTRIBUTE)) {
				node.attrs[match[1]] = decodeXmlText(match[2] ?? match[3] ?? "");
			}
		}
		parent.children.push(node);
		if (!selfClosing) stack.push(node);
	}
	return root;
}

/** The first child with this local name. */
export const xmlChild = (
	node: XmlNode | undefined,
	name: string,
): XmlNode | undefined => node?.children.find((child) => child.name === name);

/** Every child with this local name. */
export const xmlChildren = (
	node: XmlNode | undefined,
	name: string,
): XmlNode[] => node?.children.filter((child) => child.name === name) ?? [];

/** The node at a path of child names, e.g. `xmlPath(sp, "spPr", "xfrm")`. */
export const xmlPath = (
	node: XmlNode | undefined,
	...names: string[]
): XmlNode | undefined =>
	names.reduce<XmlNode | undefined>(
		(current, name) => xmlChild(current, name),
		node,
	);

/** The first descendant with this local name, depth first. */
export const xmlFind = (
	node: XmlNode | undefined,
	name: string,
): XmlNode | undefined => {
	if (!node) return undefined;
	for (const child of node.children) {
		if (child.name === name) return child;
		const found = xmlFind(child, name);
		if (found) return found;
	}
	return undefined;
};

/** Every descendant with this local name, in document order. */
export const xmlFindAll = (
	node: XmlNode | undefined,
	name: string,
	found: XmlNode[] = [],
): XmlNode[] => {
	for (const child of node?.children ?? []) {
		if (child.name === name) found.push(child);
		xmlFindAll(child, name, found);
	}
	return found;
};
