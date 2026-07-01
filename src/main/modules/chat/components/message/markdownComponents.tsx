import React from "react";
import remarkGfm from "remark-gfm";
import { MermaidRenderer } from "@/main/components/atoms/MermaidRenderer";
import { CodeBlockWithSave } from "./CodeBlockWithSave";
import { Citation } from "./Citation";
import { HtmlCodePreview } from "./HtmlCodePreview";
import { MemorallToolCallCard } from "./MemorallToolCallCard";

export const remarkPlugins = [remarkGfm];
export const rehypePlugins = [];

const SEPARATE_RENDER_STREAM = false;

export const markdownComponents = {
	table: ({ children, ...props }: { children?: React.ReactNode }) => (
		<div className="overflow-x-auto rounded">
			<table
				className="w-full"
				style={{ borderCollapse: "separate", borderSpacing: 0 }}
				{...props}
			>
				{children}
			</table>
		</div>
	),
	th: ({ children, ...props }: { children?: React.ReactNode }) => (
		<th
			className="border border-gray-700 dark:border-gray-300 bg-gray-100 dark:bg-gray-800 px-2 py-1 text-left font-semibold first:rounded-tl last:rounded-tr first:border-l last:border-r border-t"
			{...props}
		>
			{children}
		</th>
	),
	tbody: ({ children, ...props }: { children?: React.ReactNode }) => (
		<tbody {...props}>{children}</tbody>
	),
	tr: ({ children, ...props }: { children?: React.ReactNode }) => (
		<tr {...props}>{children}</tr>
	),
	td: ({ children, ...props }: { children?: React.ReactNode }) => (
		<td
			className="border-b border-gray-700 dark:border-gray-300 px-2 py-1 first:border-l last:border-r [tr:last-child_&]:first:rounded-bl [tr:last-child_&]:last:rounded-br"
			{...props}
		>
			{children}
		</td>
	),
	pre: ({ children, ...props }: { children?: React.ReactNode }) => (
		<div className="overflow-x-auto" {...props}>
			{children}
		</div>
	),
	blockquote: ({ children, ...props }: { children?: React.ReactNode }) => (
		<blockquote
			className="border-l-2 border-gray-700 dark:border-gray-300 pl-2 italic opacity-80 text-sm"
			{...props}
		>
			{children}
		</blockquote>
	),
	hr: ({ ...props }) => (
		<hr className="border-gray-700 dark:border-gray-300" {...props} />
	),
	a: ({
		href,
		children,
		...props
	}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
		children?: React.ReactNode;
	}) => {
		if (
			href &&
			(href.startsWith("#citations:node/") ||
				href.startsWith("#citation:edge/"))
		) {
			const isNode = href.startsWith("#citations:node/");
			const uuid = isNode
				? href.replace("#citations:node/", "")
				: href.replace("#citation:edge/", "");
			const label = String(children || "");

			return (
				<Citation type={isNode ? "node" : "edge"} uuid={uuid} label={label} />
			);
		}

		return (
			<a
				href={href}
				className="text-blue-600 dark:text-blue-400 hover:underline"
				target="_blank"
				rel="noopener noreferrer"
				{...props}
			>
				{children}
			</a>
		);
	},
};

const animatingComponents = {
	...markdownComponents,
	code: ({ children, className, ...props }: any) => {
		const match = /language-(\w+)/.exec(className || "");
		const isInline = !match;

		if (isInline) {
			return (
				<code
					className="rounded bg-gray-200 dark:bg-gray-700 px-0.5 text-xs font-mono"
					{...props}
				>
					{children}
				</code>
			);
		}

		return (
			<pre className="rounded-md text-sm bg-gray-100 dark:bg-gray-800 p-4 overflow-x-auto">
				<code className="font-mono text-xs">{children}</code>
			</pre>
		);
	},
	a: markdownComponents.a,
};

export const createMarkdownComponents = ({
	isDark,
	isStreaming,
}: {
	isDark: boolean;
	isStreaming: boolean;
}) => {
	if (isStreaming && SEPARATE_RENDER_STREAM) {
		return animatingComponents;
	}

	return {
		...markdownComponents,
		code: ({ children, className, ...props }: any) => {
			const match = /language-(\w+)/.exec(className || "");
			const language = match ? match[1] : "";
			const isInline = !match;

			if (isInline) {
				return (
					<code
						className="rounded bg-gray-200 dark:bg-gray-700 px-0.5 text-xs font-mono"
						{...props}
					>
						{children}
					</code>
				);
			}

			const code = String(children).replace(/\n$/, "");

			if (language === "mermaid") {
				return <MermaidRenderer chart={code} />;
			}

			if (language === "html") {
				return <HtmlCodePreview code={code} />;
			}

			if (language === "memorall_tool_call") {
				return <MemorallToolCallCard code={code} />;
			}

			return (
				<CodeBlockWithSave code={code} language={language} isDark={isDark} />
			);
		},
	};
};
