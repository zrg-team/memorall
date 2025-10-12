import React, { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
	oneDark,
	oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { MermaidRenderer } from "@/components/atoms/MermaidRenderer";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

// Performance optimization: Define plugins and components outside component
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

const markdownComponents = {
	// Custom components for better styling
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
		<pre className="overflow-x-auto" {...props}>
			{children}
		</pre>
	),
	// Style other elements
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
};

interface MarkdownMessageProps {
	content: string;
	className?: string;
	isStreaming?: boolean;
}

// Hook to detect theme
const useTheme = () => {
	const [isDark, setIsDark] = React.useState(false);

	useEffect(() => {
		const checkTheme = () => {
			setIsDark(document.documentElement.classList.contains("dark"));
		};

		checkTheme();
		const observer = new MutationObserver(checkTheme);
		observer.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["class"],
		});

		return () => observer.disconnect();
	}, []);

	return isDark;
};

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({
	content,
	className,
	isStreaming = false,
}) => {
	const isDark = useTheme();

	// Create theme-aware markdown components
	const themeAwareComponents = {
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

			// Handle mermaid diagrams
			if (language === "mermaid") {
				const chartContent = String(children).replace(/\n$/, "");
				return <MermaidRenderer chart={chartContent} />;
			}

			// Use syntax highlighter for code blocks with theme-aware styling
			return (
				<SyntaxHighlighter
					style={isDark ? oneDark : oneLight}
					language={language}
					PreTag="div"
					className="rounded-md text-sm"
					customStyle={{
						margin: 0,
						padding: "1rem",
						backgroundColor: isDark ? "hsl(220 13% 18%)" : "hsl(210 40% 98%)",
					}}
					{...props}
				>
					{String(children).replace(/\n$/, "")}
				</SyntaxHighlighter>
			);
		},
	};

	return (
		<div
			className={cn(
				"markdown-body",
				"[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
				className,
			)}
		>
			<ReactMarkdown
				remarkPlugins={remarkPlugins}
				rehypePlugins={rehypePlugins}
				components={themeAwareComponents}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
};
