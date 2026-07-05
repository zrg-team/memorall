import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
	oneDark,
	oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { Save } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import type { DocumentEditorProps } from "./types";

/** Maps lowercase file extensions to Prism language identifiers */
const EXT_TO_LANG: Record<string, string> = {
	js: "javascript",
	jsx: "jsx",
	ts: "typescript",
	tsx: "tsx",
	py: "python",
	rb: "ruby",
	go: "go",
	rs: "rust",
	java: "java",
	c: "c",
	cpp: "cpp",
	cs: "csharp",
	php: "php",
	swift: "swift",
	kt: "kotlin",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	fish: "bash",
	ps1: "powershell",
	html: "markup",
	htm: "markup",
	xml: "markup",
	svg: "markup",
	css: "css",
	scss: "scss",
	sass: "sass",
	less: "less",
	json: "json",
	yaml: "yaml",
	yml: "yaml",
	toml: "toml",
	sql: "sql",
	graphql: "graphql",
	gql: "graphql",
	md: "markdown",
	lua: "lua",
	r: "r",
	ini: "ini",
	cfg: "ini",
	conf: "nginx",
	dockerfile: "docker",
	tf: "hcl",
	dart: "dart",
	vue: "markup",
	svelte: "markup",
};

function getLanguage(filename: string): string {
	const dotIndex = filename.lastIndexOf(".");
	if (dotIndex === -1) return "text";
	const ext = filename.slice(dotIndex + 1).toLowerCase();
	return EXT_TO_LANG[ext] ?? "text";
}

/**
 * Shared typographic constants — must be identical on both the
 * highlighted <pre> layer and the transparent <textarea> overlay so the
 * caret lines up with the rendered tokens.
 */
const FONT_FAMILY =
	'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const FONT_SIZE = "0.875rem"; // 14 px
const LINE_HEIGHT = "1.5";
const PADDING = "1rem"; // 16 px
const GUTTER_WIDTH = "3.5rem";

export const CodeEditor: React.FC<DocumentEditorProps> = ({
	file,
	initialContent,
	onSave,
	readOnly = false,
	className,
}) => {
	const { t } = useTranslation("documents");
	const [content, setContent] = useState(initialContent);
	const [isDirty, setIsDirty] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const highlightRef = useRef<HTMLDivElement>(null);
	const gutterRef = useRef<HTMLDivElement>(null);
	const language = getLanguage(file.name);
	const lineCount = content.split("\n").length;

	// Sync highlighted layer position to textarea scroll
	const syncHighlight = useCallback(() => {
		if (!highlightRef.current || !textareaRef.current) return;
		const { scrollTop, scrollLeft } = textareaRef.current;
		highlightRef.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
		if (gutterRef.current) {
			gutterRef.current.style.transform = `translateY(${-scrollTop}px)`;
		}
	}, []);

	useEffect(() => {
		setContent(initialContent);
		setIsDirty(false);
	}, [initialContent]);

	const handleSave = useCallback(async () => {
		if (!isDirty || isSaving) return;
		setIsSaving(true);
		try {
			await onSave(content);
			setIsDirty(false);
		} finally {
			setIsSaving(false);
		}
	}, [content, isDirty, isSaving, onSave]);

	// Ctrl/Cmd+S
	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "s") {
				e.preventDefault();
				void handleSave();
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [handleSave]);

	// Tab key inserts two spaces instead of moving focus
	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === "Tab") {
			e.preventDefault();
			const el = e.currentTarget;
			const start = el.selectionStart;
			const end = el.selectionEnd;
			const newContent =
				content.substring(0, start) + "  " + content.substring(end);
			setContent(newContent);
			setIsDirty(true);
			requestAnimationFrame(() => {
				el.selectionStart = el.selectionEnd = start + 2;
			});
		}
	};

	const highlighterCustomStyle: React.CSSProperties = {
		margin: 0,
		paddingTop: PADDING,
		paddingRight: PADDING,
		paddingBottom: PADDING,
		paddingLeft: `calc(${PADDING} + ${GUTTER_WIDTH})`,
		fontSize: FONT_SIZE,
		lineHeight: LINE_HEIGHT,
		fontFamily: FONT_FAMILY,
		background: "transparent",
		overflow: "visible",
		whiteSpace: "pre",
		wordBreak: "normal",
		overflowWrap: "normal",
		minWidth: "100%",
	};

	const codeTagProps = {
		style: {
			fontFamily: FONT_FAMILY,
			fontSize: FONT_SIZE,
			lineHeight: LINE_HEIGHT,
		},
	};

	return (
		<div className={cn("flex flex-col h-full", className)}>
			{/* Toolbar */}
			{!readOnly && (
				<div className="flex items-center gap-2 px-3 py-1.5 border-b bg-muted/30 flex-shrink-0">
					<span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
						{language}
					</span>

					<div className="flex-1" />

					{isDirty && (
						<span className="flex items-center gap-1 text-xs text-amber-500">
							<span className="h-1.5 w-1.5 rounded-full bg-amber-500 inline-block" />
							{t("editor.unsaved")}
						</span>
					)}

					<Button
						size="sm"
						variant="ghost"
						onClick={() => void handleSave()}
						disabled={!isDirty || isSaving}
						className="h-7 px-2 text-xs gap-1"
					>
						<Save className="h-3 w-3" />
						{isSaving ? t("editor.saving") : t("editor.save")}
					</Button>
				</div>
			)}

			{/* Editor: highlighted layer behind transparent textarea */}
			<div className="relative flex-1 overflow-hidden bg-background">
				<div
					ref={gutterRef}
					className="absolute top-0 left-0 pointer-events-none select-none border-r text-right text-muted-foreground/70"
					style={{
						width: `calc(${GUTTER_WIDTH} + ${PADDING})`,
						paddingTop: PADDING,
						paddingRight: "0.75rem",
						paddingBottom: PADDING,
						fontFamily: FONT_FAMILY,
						fontSize: FONT_SIZE,
						lineHeight: LINE_HEIGHT,
						background: "hsl(var(--muted) / 0.25)",
					}}
					aria-hidden
				>
					{Array.from({ length: lineCount }, (_, i) => (
						<div key={i + 1}>{i + 1}</div>
					))}
				</div>

				{/* Syntax-highlighted layer (absolutely positioned, pointer-events: none) */}
				<div
					ref={highlightRef}
					className="absolute top-0 left-0 pointer-events-none"
					style={{ willChange: "transform", minWidth: "100%" }}
					aria-hidden
				>
					{/* Light mode */}
					<SyntaxHighlighter
						className="dark:hidden"
						language={language}
						style={oneLight}
						customStyle={highlighterCustomStyle}
						codeTagProps={codeTagProps}
					>
						{content}
					</SyntaxHighlighter>
					{/* Dark mode */}
					<SyntaxHighlighter
						className="hidden dark:block"
						language={language}
						style={oneDark}
						customStyle={highlighterCustomStyle}
						codeTagProps={codeTagProps}
					>
						{content}
					</SyntaxHighlighter>
				</div>

				{/* Transparent textarea — receives all user input */}
				<textarea
					ref={textareaRef}
					value={content}
					onChange={(e) => {
						setContent(e.target.value);
						setIsDirty(true);
					}}
					onScroll={syncHighlight}
					onKeyDown={handleKeyDown}
					className="absolute inset-0 resize-none outline-none border-0 overflow-auto"
					style={{
						fontFamily: FONT_FAMILY,
						fontSize: FONT_SIZE,
						lineHeight: LINE_HEIGHT,
						paddingTop: PADDING,
						paddingRight: PADDING,
						paddingBottom: PADDING,
						paddingLeft: `calc(${PADDING} + ${GUTTER_WIDTH})`,
						tabSize: 2,
						color: "transparent",
						caretColor: "hsl(var(--foreground))",
						background: "transparent",
						whiteSpace: "pre",
						wordBreak: "normal",
						overflowWrap: "normal",
					}}
					spellCheck={false}
					autoCorrect="off"
					autoCapitalize="off"
					readOnly={readOnly}
				/>
			</div>
		</div>
	);
};
