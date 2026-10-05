/**
 * WYSIWYG half of the markdown editor.
 *
 * Lives in its own component so `MarkdownEditor` can mount it only once the
 * user asks to edit. A Tiptap instance built for a document nobody is editing
 * still loads every image that document references — which 404s for
 * document-relative paths — and costs an editor teardown on every remount.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import {
	Bold,
	Code,
	Eye,
	ImageIcon,
	Italic,
	List,
	ListChecks,
	ListOrdered,
	Loader2,
	Quote,
	Save,
	Table as TableIcon,
} from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/main/components/ui/popover";
import { logInfo, logError } from "@/utils/logger";
import {
	createMarkdownExtensions,
	getMarkdownContent,
	setMarkdownContent,
} from "./markdown-extensions";
import type { DocumentEditorProps } from "./types";

interface MarkdownWysiwygProps extends Omit<DocumentEditorProps, "className"> {
	/** Switch the surrounding editor back to the rendered preview. */
	onRequestPreview: () => void;
}

export const MarkdownWysiwyg: React.FC<MarkdownWysiwygProps> = ({
	file,
	initialContent,
	onContentChange,
	onDirtyChange,
	onSave,
	readOnly = false,
	onRequestPreview,
}) => {
	const { t } = useTranslation("documents");
	const [isSaving, setIsSaving] = useState(false);
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
	const [imagePopoverOpen, setImagePopoverOpen] = useState(false);
	const [imageUrl, setImageUrl] = useState("");
	const [imageAlt, setImageAlt] = useState("");
	const imageUrlInputRef = useRef<HTMLInputElement>(null);
	// The document as this editor writes it when nothing was changed. Comparing
	// against the file itself would flag every file the serializer normalizes
	// (table padding, list markers) as changed the moment it opens.
	const baselineRef = useRef(initialContent);
	// What the last save wrote; it comes back as `initialContent`.
	const savedRef = useRef<string | null>(null);
	const initialContentRef = useRef(initialContent);
	initialContentRef.current = initialContent;
	const onContentChangeRef = useRef(onContentChange);
	onContentChangeRef.current = onContentChange;

	const editor = useEditor({
		extensions: createMarkdownExtensions({
			placeholder: t("editor.markdownPlaceholder"),
		}),
		editable: !readOnly,
		editorProps: {
			attributes: {
				class:
					"prose prose-sm sm:prose focus:outline-none max-w-none p-4 min-h-[500px]",
			},
		},
		onUpdate: ({ editor }) => {
			// Only track dirty state — the preview always renders the saved file.
			const markdown = getMarkdownContent(editor, initialContentRef.current);
			setHasUnsavedChanges(markdown !== baselineRef.current);
			onContentChangeRef.current?.(markdown);
		},
	});

	useEffect(() => {
		onDirtyChange?.(hasUnsavedChanges);
	}, [hasUnsavedChanges, onDirtyChange]);

	// Reset the document when the file changes underneath the editor.
	useEffect(() => {
		// A destroyed instance has no command manager, so `editor.commands`
		// throws. Tiptap tears the editor down a tick after unmount, so a quick
		// remount can still hand this effect the render's stale instance.
		if (!editor || editor.isDestroyed) return;
		if (initialContent === savedRef.current) {
			// Our own save: the document already shows it, and resetting it would
			// send the cursor back to the start. Edits made while it was saving
			// stay unsaved.
			savedRef.current = null;
			baselineRef.current = initialContent;
			setHasUnsavedChanges(
				getMarkdownContent(editor, initialContent) !== initialContent,
			);
			return;
		}
		setMarkdownContent(editor, initialContent);
		baselineRef.current = getMarkdownContent(editor, initialContent);
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
		const markdown = getMarkdownContent(editor, initialContent);
		try {
			setIsSaving(true);
			savedRef.current = markdown;
			await onSave(markdown);
			baselineRef.current = markdown;
			setHasUnsavedChanges(
				getMarkdownContent(editor, initialContent) !== markdown,
			);
			logInfo(`[MARKDOWN_EDITOR] Saved ${file.name}`);
		} catch (error) {
			savedRef.current = null;
			logError("[MARKDOWN_EDITOR] Failed to save:", error);
		} finally {
			setIsSaving(false);
		}
	}, [
		editor,
		file.name,
		hasUnsavedChanges,
		initialContent,
		isSaving,
		onSave,
		readOnly,
	]);

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

	// No manual editor.destroy() here: useEditor owns the instance lifecycle and
	// schedules teardown a tick after unmount so a quick remount (Suspense, tab
	// switch) can reuse the instance. Destroying it synchronously left that
	// reused instance dead, and every command on it then threw.

	if (!editor) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="flex h-full min-h-0 flex-col">
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
						variant={editor.isActive("taskList") ? "secondary" : "ghost"}
						size="sm"
						onClick={() => editor.chain().focus().toggleTaskList().run()}
						disabled={readOnly}
						className="h-8 w-8 p-0"
						title={t("editor.taskList")}
					>
						<ListChecks className="h-4 w-4" />
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
							onClick={onRequestPreview}
							className="gap-1.5"
						>
							<Eye className="h-4 w-4" />
							<span className="text-xs">{t("editor.previewMode")}</span>
						</Button>
					)}
				</div>
			</div>
			<div className="flex-1 overflow-auto bg-background">
				<EditorContent editor={editor} className="h-full" />
			</div>
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
		</div>
	);
};
