/**
 * Markdown Editor Component
 * - Preview mode: renders raw initialContent via react-markdown (never goes through Tiptap)
 * - Edit mode: Tiptap WYSIWYG with table, image, and formatting support
 */

import React, {
	useState,
	useEffect,
	useCallback,
	useMemo,
	useRef,
} from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import Placeholder from "@tiptap/extension-placeholder";
import { marked } from "marked";
import TurndownService from "turndown";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { gfm } = require("turndown-plugin-gfm");
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
	oneDark,
	oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { MermaidRenderer } from "@/main/components/atoms/MermaidRenderer";
import { useTheme } from "@/main/components/molecules/ThemeContext";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/main/components/ui/popover";
import {
	Save,
	Loader2,
	Bold,
	Italic,
	List,
	ListOrdered,
	Code,
	Quote,
	Eye,
	Edit2,
	ImageIcon,
	Table as TableIcon,
} from "lucide-react";
import { logInfo, logError } from "@/utils/logger";
import type { DocumentEditorProps } from "./types";
import { cn } from "@/lib/utils";
import "./tiptap-editor.css";

// Configure markdown parser
marked.setOptions({ gfm: true, breaks: true });

// Configure HTML → Markdown converter with GFM table support
const turndownService = new TurndownService({
	headingStyle: "atx",
	codeBlockStyle: "fenced",
});
turndownService.use(gfm);

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeRaw];

export const MarkdownEditor: React.FC<DocumentEditorProps> = ({
	file,
	initialContent,
	onContentChange,
	onSave,
	readOnly = false,
	className,
}) => {
	const { t } = useTranslation("documents");
	const { actualTheme } = useTheme();
	const isDark = actualTheme === "dark";
	const [isSaving, setIsSaving] = useState(false);
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
	const [isPreview, setIsPreview] = useState(true);
	const [imagePopoverOpen, setImagePopoverOpen] = useState(false);
	const [imageUrl, setImageUrl] = useState("");
	const [imageAlt, setImageAlt] = useState("");
	const imageUrlInputRef = useRef<HTMLInputElement>(null);

	// Preview ALWAYS renders initialContent directly — never goes through Tiptap
	// so tables, mermaid, and all GFM features always render correctly.

	const initialHtmlContent = useMemo(() => {
		try {
			return marked.parse(initialContent) as string;
		} catch (error) {
			logError("[MARKDOWN_EDITOR] Failed to parse markdown:", error);
			return initialContent;
		}
	}, [initialContent]);

	const editor = useEditor({
		extensions: [
			StarterKit.configure({ heading: { levels: [1, 2, 3, 4, 5, 6] } }),
			Image.configure({ inline: false, allowBase64: true }),
			Table.configure({ resizable: false }),
			TableRow,
			TableHeader,
			TableCell,
			Placeholder.configure({
				placeholder: t("editor.markdownPlaceholder"),
			}),
		],
		content: initialHtmlContent,
		editable: !readOnly,
		editorProps: {
			attributes: {
				class:
					"prose prose-sm sm:prose focus:outline-none max-w-none p-4 min-h-[500px]",
			},
		},
		onUpdate: ({ editor }) => {
			// Only track dirty state — do NOT derive preview content from Tiptap
			const html = editor.getHTML();
			const markdown = turndownService.turndown(html);
			setHasUnsavedChanges(markdown !== initialContent);
			onContentChange?.(markdown);
		},
	});

	// Reset editor when file changes
	useEffect(() => {
		if (!editor) return;
		const newHtml = marked.parse(initialContent) as string;
		// emitUpdate=false: don't trigger onUpdate for programmatic content sets
		editor.commands.setContent(newHtml, { emitUpdate: false } as any);
		setHasUnsavedChanges(false);
	}, [initialContent, editor]);

	const handleOpenImagePopover = useCallback(() => {
		if (!editor) return;
		const attrs = editor.getAttributes("image");
		setImageUrl(attrs.src || "");
		setImageAlt(attrs.alt || "");
		setImagePopoverOpen(true);
		setTimeout(() => imageUrlInputRef.current?.focus(), 50);
	}, [editor]);

	const handleInsertImage = useCallback(() => {
		if (!editor || !imageUrl.trim()) return;
		editor
			.chain()
			.focus()
			.setImage({ src: imageUrl.trim(), alt: imageAlt.trim() })
			.run();
		setImagePopoverOpen(false);
		setImageUrl("");
		setImageAlt("");
	}, [editor, imageUrl, imageAlt]);

	const handleInsertTable = useCallback(() => {
		if (!editor) return;
		editor
			.chain()
			.focus()
			.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
			.run();
	}, [editor]);

	const handleSave = useCallback(async () => {
		if (!editor || !hasUnsavedChanges || isSaving || readOnly) return;
		try {
			setIsSaving(true);
			const html = editor.getHTML();
			const markdown = turndownService.turndown(html);
			await onSave(markdown);
			setHasUnsavedChanges(false);
			logInfo(`[MARKDOWN_EDITOR] Saved ${file.name}`);
		} catch (error) {
			logError("[MARKDOWN_EDITOR] Failed to save:", error);
		} finally {
			setIsSaving(false);
		}
	}, [editor, file.name, hasUnsavedChanges, isSaving, onSave, readOnly]);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.ctrlKey || e.metaKey) && e.key === "s") {
				e.preventDefault();
				handleSave();
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleSave]);

	useEffect(
		() => () => {
			editor?.destroy();
		},
		[editor],
	);

	const previewComponents = useMemo(
		() => ({
			code: ({ children, className, ...props }: any) => {
				const match = /language-(\w+)/.exec(className || "");
				const language = match ? match[1] : "";
				if (!match) {
					return (
						<code
							className="rounded bg-muted px-1 py-0.5 text-sm font-mono"
							{...props}
						>
							{children}
						</code>
					);
				}
				if (language === "mermaid") {
					return (
						<MermaidRenderer chart={String(children).replace(/\n$/, "")} />
					);
				}
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
			a: ({
				href,
				children,
				...props
			}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
				children?: React.ReactNode;
			}) => (
				<a
					href={href}
					className="text-blue-600 dark:text-blue-400 hover:underline"
					target="_blank"
					rel="noopener noreferrer"
					{...props}
				>
					{children}
				</a>
			),
		}),
		[isDark],
	);

	if (!editor) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className={cn("flex flex-col h-full", className)}>
			{!isPreview && (
				<div className="flex items-center justify-between gap-2 px-4 py-2 border-b bg-card">
					<div className="flex items-center gap-1 flex-wrap">
						<Button
							variant={editor.isActive("bold") ? "secondary" : "ghost"}
							size="sm"
							onClick={() => editor.chain().focus().toggleBold().run()}
							disabled={readOnly}
							className="h-8 w-8 p-0"
							title="Bold (Ctrl+B)"
						>
							<Bold className="h-4 w-4" />
						</Button>
						<Button
							variant={editor.isActive("italic") ? "secondary" : "ghost"}
							size="sm"
							onClick={() => editor.chain().focus().toggleItalic().run()}
							disabled={readOnly}
							className="h-8 w-8 p-0"
							title="Italic (Ctrl+I)"
						>
							<Italic className="h-4 w-4" />
						</Button>
						<Button
							variant={editor.isActive("code") ? "secondary" : "ghost"}
							size="sm"
							onClick={() => editor.chain().focus().toggleCode().run()}
							disabled={readOnly}
							className="h-8 w-8 p-0"
							title="Code"
						>
							<Code className="h-4 w-4" />
						</Button>
						<div className="w-px h-6 bg-border mx-1" />
						<Button
							variant={editor.isActive("bulletList") ? "secondary" : "ghost"}
							size="sm"
							onClick={() => editor.chain().focus().toggleBulletList().run()}
							disabled={readOnly}
							className="h-8 w-8 p-0"
							title="Bullet List"
						>
							<List className="h-4 w-4" />
						</Button>
						<Button
							variant={editor.isActive("orderedList") ? "secondary" : "ghost"}
							size="sm"
							onClick={() => editor.chain().focus().toggleOrderedList().run()}
							disabled={readOnly}
							className="h-8 w-8 p-0"
							title="Numbered List"
						>
							<ListOrdered className="h-4 w-4" />
						</Button>
						<Button
							variant={editor.isActive("blockquote") ? "secondary" : "ghost"}
							size="sm"
							onClick={() => editor.chain().focus().toggleBlockquote().run()}
							disabled={readOnly}
							className="h-8 w-8 p-0"
							title="Quote"
						>
							<Quote className="h-4 w-4" />
						</Button>
						<div className="w-px h-6 bg-border mx-1" />

						{/* Insert Table */}
						<Button
							variant={editor.isActive("table") ? "secondary" : "ghost"}
							size="sm"
							onClick={handleInsertTable}
							disabled={readOnly}
							className="h-8 w-8 p-0"
							title={t("editor.insertTable")}
						>
							<TableIcon className="h-4 w-4" />
						</Button>

						{/* Insert / Edit Image */}
						<Popover open={imagePopoverOpen} onOpenChange={setImagePopoverOpen}>
							<PopoverTrigger asChild>
								<Button
									variant={editor.isActive("image") ? "secondary" : "ghost"}
									size="sm"
									onClick={handleOpenImagePopover}
									disabled={readOnly}
									className="h-8 w-8 p-0"
									title={
										editor.isActive("image")
											? t("editor.editImage")
											: t("editor.insertImage")
									}
								>
									<ImageIcon className="h-4 w-4" />
								</Button>
							</PopoverTrigger>
							<PopoverContent
								className="w-72 p-3"
								align="start"
								onOpenAutoFocus={(e) => e.preventDefault()}
							>
								<p className="text-sm font-medium mb-3">
									{editor.isActive("image")
										? t("editor.editImage")
										: t("editor.insertImage")}
								</p>
								<div className="space-y-2">
									<div>
										<Label className="text-xs">{t("editor.imageUrl")}</Label>
										<Input
											ref={imageUrlInputRef}
											value={imageUrl}
											onChange={(e) => setImageUrl(e.target.value)}
											placeholder="https://example.com/image.png"
											className="h-8 text-sm mt-1"
											onKeyDown={(e) => {
												if (e.key === "Enter") handleInsertImage();
												if (e.key === "Escape") setImagePopoverOpen(false);
											}}
										/>
									</div>
									<div>
										<Label className="text-xs">{t("editor.imageAlt")}</Label>
										<Input
											value={imageAlt}
											onChange={(e) => setImageAlt(e.target.value)}
											placeholder={t("editor.imageAltPlaceholder")}
											className="h-8 text-sm mt-1"
											onKeyDown={(e) => {
												if (e.key === "Enter") handleInsertImage();
												if (e.key === "Escape") setImagePopoverOpen(false);
											}}
										/>
									</div>
									<Button
										size="sm"
										className="w-full"
										onClick={handleInsertImage}
										disabled={!imageUrl.trim()}
									>
										{editor.isActive("image")
											? t("editor.updateImage")
											: t("editor.insertImage")}
									</Button>
								</div>
							</PopoverContent>
						</Popover>

						<div className="w-px h-6 bg-border mx-1" />
						<Button
							size="sm"
							onClick={handleSave}
							disabled={!hasUnsavedChanges || isSaving || readOnly}
							className="gap-2"
						>
							{isSaving ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin" />
									{t("editor.saving")}
								</>
							) : (
								<>
									<Save className="h-4 w-4" />
									{t("editor.save")}
								</>
							)}
						</Button>
					</div>

					<div className="flex items-center gap-2">
						{hasUnsavedChanges && (
							<span className="text-xs text-muted-foreground">
								{t("editor.unsavedChanges")}
							</span>
						)}
						{!readOnly && (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setIsPreview(true)}
								className="gap-1.5"
							>
								<Eye className="h-4 w-4" />
								<span className="text-xs">{t("editor.previewMode")}</span>
							</Button>
						)}
					</div>
				</div>
			)}

			{/* Content */}
			{isPreview ? (
				<div className="flex-1 overflow-auto bg-background">
					{!readOnly && (
						<div className="sticky top-4 z-10 flex justify-end px-4 pointer-events-none">
							<Button
								variant="secondary"
								size="sm"
								onClick={() => setIsPreview(false)}
								className="gap-1.5 shadow-md pointer-events-auto"
							>
								<Edit2 className="h-4 w-4" />
								<span className="text-xs">{t("editor.editMode")}</span>
							</Button>
						</div>
					)}
					<div
						className={cn(
							"markdown-preview mx-auto max-w-4xl px-8 py-6",
							!readOnly && "-mt-10",
						)}
					>
						<ReactMarkdown
							remarkPlugins={remarkPlugins}
							rehypePlugins={rehypePlugins}
							components={previewComponents}
						>
							{initialContent}
						</ReactMarkdown>
					</div>
				</div>
			) : (
				<div className="flex-1 overflow-auto bg-background">
					<EditorContent editor={editor} className="h-full" />
				</div>
			)}

			{!isPreview && (
				<div className="px-4 py-1 border-t bg-card text-xs text-muted-foreground flex items-center justify-between">
					<span>
						{t("editor.characterCount", {
							count:
								editor.storage.characterCount?.characters() ||
								editor.getText().length,
						})}
					</span>
					<span>{t("editor.saveHint")}</span>
				</div>
			)}
		</div>
	);
};
