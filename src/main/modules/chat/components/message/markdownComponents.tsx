import React, { useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import { Lexer } from "marked";
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

type MarkdownComponents = typeof animatingComponents;

/**
 * One set per combination of what the components read, shared by every
 * message. A `code` component made anew is a new component type to React, so
 * every code block under it mounted again — which a reply did as it finished
 * streaming, rebuilding its highlighted code, diagrams and HTML previews.
 */
const markdownComponentsCache = new Map<string, MarkdownComponents>();

export const createMarkdownComponents = ({
	isDark,
	isStreaming,
	showCodeBlockSave = true,
}: {
	isDark: boolean;
	isStreaming: boolean;
	/** Hosts that already own the file (e.g. the Skills editor) opt out. */
	showCodeBlockSave?: boolean;
}): MarkdownComponents => {
	if (isStreaming && SEPARATE_RENDER_STREAM) {
		return animatingComponents;
	}

	const key = `${isDark}:${showCodeBlockSave}`;
	const cached = markdownComponentsCache.get(key);
	if (cached) return cached;
	const components = buildMarkdownComponents({ isDark, showCodeBlockSave });
	markdownComponentsCache.set(key, components);
	return components;
};

const buildMarkdownComponents = ({
	isDark,
	showCodeBlockSave,
}: {
	isDark: boolean;
	showCodeBlockSave: boolean;
}): MarkdownComponents => {
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
				<CodeBlockWithSave
					code={code}
					language={language}
					isDark={isDark}
					showSave={showCodeBlockSave}
				/>
			);
		},
	};
};

type MarkdownOptions = Pick<
	React.ComponentProps<typeof ReactMarkdown>,
	"components" | "remarkPlugins" | "rehypePlugins"
>;

/**
 * What is read across blocks: a footnote where it is defined, display math,
 * which may hold blank lines. Text holding either renders as one block.
 */
const READ_ACROSS_BLOCKS = /\$\$|\[\^[^\]\s]+\]/;
const FENCE_OPENING = /^ {0,3}(`{3,}|~{3,})/;
/** Fences whose unfinished content still renders as itself. */
const LIVE_FENCE_LANGUAGES = new Set(["memorall_tool_call"]);

/** The language a code fence names, from its opening line. */
const fenceLanguage = (fence: string): string => {
	const newline = fence.indexOf("\n");
	const opening = newline === -1 ? fence : fence.slice(0, newline);
	return opening.replace(FENCE_OPENING, "").trim().split(/\s+/)[0] ?? "";
};

/** Whether a fenced code block has its closing fence yet. */
const isClosedFence = (raw: string): boolean => {
	const opening = FENCE_OPENING.exec(raw);
	// Indented code has no fence to wait for.
	if (!opening) return true;
	const lines = raw.trimEnd().split("\n");
	if (lines.length < 2) return false;
	const closing = lines[lines.length - 1].trim();
	const fence = opening[1];
	return (
		closing.length >= fence.length &&
		closing === fence[0].repeat(closing.length)
	);
};

export interface MarkdownBlockSplit {
	/** The text in order, cut at the blank lines between its top-level blocks. */
	blocks: string[];
	/** Where in the last block a code fence opens that is not closed yet, or -1. */
	openFenceAt: number;
}

/**
 * Markdown cut into the blocks that render on their own, so text that grows at
 * its end re-parses only its last block. It is only cut at a blank line
 * between top-level blocks, where the parser renders the same either way, and
 * not at all when something in it is read across blocks.
 */
export const splitMarkdownBlocks = (markdown: string): MarkdownBlockSplit => {
	const whole = { blocks: [markdown], openFenceAt: -1 };
	if (READ_ACROSS_BLOCKS.test(markdown)) return whole;
	let tokens: ReturnType<typeof Lexer.lex>;
	try {
		tokens = Lexer.lex(markdown, { gfm: true });
	} catch {
		// The lexer can give up on odd input; one block renders as before.
		return whole;
	}
	// A reference definition gives its meaning to links in other blocks.
	if (Object.keys(tokens.links).length > 0) return whole;

	const blocks: string[] = [];
	let separated = true;
	let openFenceAt = -1;
	for (const token of tokens) {
		openFenceAt = -1;
		if (token.type === "space") {
			if (blocks.length > 0) blocks[blocks.length - 1] += token.raw;
			else blocks.push(token.raw);
			separated = true;
			continue;
		}
		if (separated) blocks.push("");
		separated = false;
		const last = blocks.length - 1;
		if (
			token.type === "code" &&
			!isClosedFence(token.raw) &&
			!LIVE_FENCE_LANGUAGES.has(fenceLanguage(token.raw))
		) {
			openFenceAt = blocks[last].length;
		}
		blocks[last] += token.raw;
	}
	return { blocks: blocks.length > 0 ? blocks : [markdown], openFenceAt };
};

/**
 * A code block still being written: plain text until its fence closes.
 * Highlighting it, drawing it as a diagram or loading it into an HTML preview
 * redid all of that on every update, for code that is not finished yet.
 */
const OpenCodeFence: React.FC<{ fence: string }> = ({ fence }) => {
	const { t } = useTranslation("chat");
	const newline = fence.indexOf("\n");
	const language = fenceLanguage(fence);
	const code = newline === -1 ? "" : fence.slice(newline + 1);

	return (
		<div className="overflow-x-auto" data-open-code-fence>
			<div className="my-2 overflow-hidden rounded-md border border-border">
				<div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
					<span className="truncate text-xs text-muted-foreground">
						{language || t("htmlPreview.code")}
					</span>
				</div>
				<pre className="m-0 overflow-x-auto p-4 text-sm">
					<code className="font-mono">{code}</code>
				</pre>
			</div>
		</div>
	);
};

const MarkdownBlock: React.FC<
	MarkdownOptions & { source: string; openFenceAt: number }
> = React.memo(({ source, openFenceAt, ...options }) => (
	// The same shape with or without an open fence, so the text before the
	// fence keeps its tree when the fence closes.
	<>
		<ReactMarkdown {...options}>
			{openFenceAt === -1 ? source : source.slice(0, openFenceAt)}
		</ReactMarkdown>
		{openFenceAt === -1 ? null : (
			<OpenCodeFence fence={source.slice(openFenceAt)} />
		)}
	</>
));

MarkdownBlock.displayName = "MarkdownBlock";

/**
 * Markdown that may still be streaming. Once it has streamed here it renders
 * block by block, so each update re-parses only the block being written rather
 * than the whole text, and keeps doing so after it finishes so nothing mounts
 * again then. Text that never streamed renders whole, as it always has.
 */
export const MarkdownBlocks: React.FC<
	MarkdownOptions & { children: string; isStreaming: boolean }
> = ({ children, isStreaming, ...options }) => {
	const splitRef = useRef(isStreaming);
	if (isStreaming) splitRef.current = true;
	const split = splitRef.current;
	const { blocks, openFenceAt } = useMemo(
		() =>
			split
				? splitMarkdownBlocks(children)
				: { blocks: [children], openFenceAt: -1 },
		[children, split],
	);

	return (
		<>
			{blocks.map((block, index) => (
				<MarkdownBlock
					// By position: streaming only appends, so a block keeps its place.
					// biome-ignore lint/suspicious/noArrayIndexKey: blocks are positional
					key={index}
					source={block}
					openFenceAt={
						isStreaming && index === blocks.length - 1 ? openFenceAt : -1
					}
					{...options}
				/>
			))}
		</>
	);
};
