import { createElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";

const ELEMENTS = [
	"p",
	"a",
	"span",
	"div",
	"sup",
	"sub",
	"br",
	"hr",
	"h1",
	"h2",
	"h3",
	"h4",
	"h5",
	"h6",
	"strong",
	"em",
	"del",
	"blockquote",
	"ul",
	"ol",
	"li",
	"pre",
	"code",
	"table",
	"thead",
	"tbody",
	"tfoot",
	"tr",
	"td",
	"th",
];

// OCR can return HTML tables (especially chart data). Render document markup,
// dropping all model-provided attributes, media and active elements.
const components = Object.fromEntries(
	ELEMENTS.map((tag) => [
		tag,
		({ children }: { children?: ReactNode }) =>
			createElement(tag, null, children),
	]),
) as Components;

export function OCRPreview({ markdown }: { markdown: string }) {
	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm]}
			rehypePlugins={[rehypeRaw]}
			allowedElements={ELEMENTS}
			components={components}
		>
			{markdown}
		</ReactMarkdown>
	);
}
