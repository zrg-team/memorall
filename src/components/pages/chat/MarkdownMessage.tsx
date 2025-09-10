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

// Global counter for unique mermaid IDs
let mermaidCounter = 0;

// Mermaid component
const MermaidDiagram: React.FC<{
	chart: string;
	fallback: () => React.ReactNode;
	isStreaming?: boolean;
}> = ({ chart, fallback, isStreaming = false }) => {
	const ref = useRef<HTMLDivElement>(null);
	const [renderState, setRenderState] = React.useState<
		"loading" | "success" | "error"
	>("loading");
	const [uniqueId] = React.useState(
		() => `mermaid-${++mermaidCounter}-${Date.now()}`,
	);

	useEffect(() => {
		// Don't render mermaid during streaming
		if (isStreaming) {
			setRenderState("error");
			return;
		}

		let isMounted = true;
		let timeoutId: NodeJS.Timeout;

		const renderChart = async () => {
			const trimmedChart = chart.trim();

			// Enhanced validation for mermaid syntax
			const validMermaidTypes = [
				"graph",
				"flowchart",
				"sequenceDiagram",
				"classDiagram",
				"stateDiagram",
				"gantt",
				"pie",
				"journey",
				"gitgraph",
				"erDiagram",
				"mindmap",
				"timeline",
				"quadrantChart",
			];

			const firstLine = trimmedChart.split("\n")[0].toLowerCase().trim();
			const hasValidStart = validMermaidTypes.some(
				(type) => firstLine.startsWith(type) || firstLine.includes(type),
			);

			if (!trimmedChart || !hasValidStart) {
				if (isMounted) setRenderState("error");
				return;
			}

			if (ref.current && isMounted) {
				try {
					// Add timeout to prevent infinite loading
					timeoutId = setTimeout(() => {
						if (isMounted) setRenderState("error");
					}, 5000); // 5 second timeout

					// Try to parse first to catch syntax errors before rendering
					await mermaid.parse(trimmedChart);

					if (!isMounted) return;

					// Clear any previous content
					ref.current.innerHTML = "";

					// Use unique ID for each diagram to prevent conflicts
					const { svg } = await mermaid.render(uniqueId, trimmedChart);

					if (!isMounted) return;

					clearTimeout(timeoutId);

					// Check if we got valid SVG and no error messages
					if (svg && svg.includes("<svg") && !svg.includes("Syntax error")) {
						if (ref.current) {
							ref.current.innerHTML = svg;
						}
						setRenderState("success");
					} else {
						setRenderState("error");
					}
				} catch (error) {
					if (!isMounted) return;

					clearTimeout(timeoutId);

					// Clear any partial content that might have been rendered
					if (ref.current) {
						ref.current.innerHTML = "";
					}
					setRenderState("error");
				}
			}
		};

		renderChart();

		// Cleanup function
		return () => {
			isMounted = false;
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
		};
	}, [chart, isStreaming, uniqueId]);

	if (renderState === "error" || isStreaming) {
		return <>{fallback()}</>;
	}

	if (renderState === "loading") {
		return (
			<div className="my-4 h-8 flex items-center text-muted-foreground text-sm">
				Loading diagram...
			</div>
		);
	}

	return <div ref={ref} className="my-4" />;
};

const markdownComponents = {
	// Custom components for better styling
	table: ({ children, ...props }: any) => (
		<div className="overflow-x-auto">
			<table
				className="min-w-full border-collapse border border-border"
				{...props}
			>
				{children}
			</table>
		</div>
	),
	th: ({ children, ...props }: any) => (
		<th
			className="border border-border bg-muted px-2 py-1 text-left font-semibold"
			{...props}
		>
			{children}
		</th>
	),
	td: ({ children, ...props }: any) => (
		<td className="border border-border px-2 py-1" {...props}>
			{children}
		</td>
	),
	pre: ({ children, ...props }: any) => (
		<pre className="rounded bg-muted p-3 overflow-x-auto" {...props}>
			{children}
		</pre>
	),
	// Style other elements
	blockquote: ({ children, ...props }: any) => (
		<blockquote
			className="border-l-4 border-primary pl-4 italic text-muted-foreground"
			{...props}
		>
			{children}
		</blockquote>
	),
	hr: ({ ...props }: any) => <hr className="my-4 border-border" {...props} />,
	ul: ({ children, ...props }: any) => (
		<ul className="list-disc list-inside space-y-1" {...props}>
			{children}
		</ul>
	),
	ol: ({ children, ...props }: any) => (
		<ol className="list-decimal list-inside space-y-1" {...props}>
			{children}
		</ol>
	),
	li: ({ children, ...props }: any) => (
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
