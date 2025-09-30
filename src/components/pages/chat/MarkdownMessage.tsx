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
import mermaid from "mermaid";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

// Performance optimization: Define plugins and components outside component
const remarkPlugins = [remarkGfm, remarkMath];
const rehypePlugins = [rehypeKatex];

// Initialize mermaid with better settings for multiple diagrams
mermaid.initialize({
	startOnLoad: false, // Disable auto-start to manually control rendering
	theme: "default",
	securityLevel: "loose",
	flowchart: {
		useMaxWidth: true,
		htmlLabels: true,
	},
	sequence: {
		useMaxWidth: true,
	},
	gantt: {
		useMaxWidth: true,
	},
});

const markdownComponents = {
	// Custom components for better styling
	table: ({ children, ...props }: { children?: React.ReactNode }) => (
		<div className="overflow-x-auto">
			<table className="min-w-full border-collapse border" {...props}>
				{children}
			</table>
		</div>
	),
	th: ({ children, ...props }: { children?: React.ReactNode }) => (
		<th
			className="border border-border bg-muted px-2 py-1 text-left font-semibold"
			{...props}
		>
			{children}
		</th>
	),
	td: ({ children, ...props }: { children?: React.ReactNode }) => (
		<td className="border border-border px-2 py-1" {...props}>
			{children}
		</td>
	),
	pre: ({ children, ...props }: { children?: React.ReactNode }) => (
		<pre className="rounded bg-muted p-3 overflow-x-auto" {...props}>
			{children}
		</pre>
	),
	// Style other elements
	blockquote: ({ children, ...props }: { children?: React.ReactNode }) => (
		<blockquote
			className="border-l-4 border-primary pl-4 italic text-muted-foreground"
			{...props}
		>
			{children}
		</blockquote>
	),
	hr: ({ ...props }) => <hr className="my-4 border-border" {...props} />,
	ul: ({ children, ...props }: { children?: React.ReactNode }) => (
		<ul className="list-disc list-inside space-y-1" {...props}>
			{children}
		</ul>
	),
	ol: ({ children, ...props }: { children?: React.ReactNode }) => (
		<ol className="list-decimal list-inside space-y-1" {...props}>
			{children}
		</ol>
	),
	li: ({ children, ...props }: { children?: React.ReactNode }) => (
		<li className="text-sm" {...props}>
			{children}
		</li>
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
						className="rounded bg-muted px-1 py-0.5 text-sm font-mono"
						{...props}
					>
						{children}
					</code>
				);
			}

			// Handle mermaid diagrams - DISABLED: render as code block for now
			if (language === "mermaid") {
				const chartContent = String(children).replace(/\n$/, "");
				return (
					<SyntaxHighlighter
						style={isDark ? oneDark : oneLight}
						language="text"
						PreTag="div"
						className="rounded-md text-sm"
						customStyle={{
							margin: 0,
							padding: "1rem",
							backgroundColor: isDark ? "hsl(220 13% 18%)" : "hsl(210 40% 98%)",
						}}
					>
						{chartContent}
					</SyntaxHighlighter>
				);
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
				"prose prose-sm max-w-none dark:prose-invert",
				"prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0",
				"prose-headings:my-3 prose-h1:my-4 prose-h2:my-3 prose-h3:my-2",
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
