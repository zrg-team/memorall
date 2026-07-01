import "katex/dist/katex.min.css";
import type React from "react";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
	MarkdownMessageBody,
	type MarkdownMessageBodyProps,
} from "./MarkdownMessageBody";
import { remarkPlugins } from "./markdownComponents";

const mathRemarkPlugins = [...remarkPlugins, remarkMath];
const mathRehypePlugins = [rehypeKatex];

const MarkdownMathMessageBody: React.FC<MarkdownMessageBodyProps> = (props) => (
	<MarkdownMessageBody
		{...props}
		remarkPluginsOverride={mathRemarkPlugins}
		rehypePluginsOverride={mathRehypePlugins}
	/>
);

export default MarkdownMathMessageBody;
