/**
 * Markdown Editor Component
 * - Preview mode: renders raw initialContent via react-markdown (never goes through Tiptap)
 * - Edit mode: Tiptap WYSIWYG, mounted on demand by MarkdownWysiwyg
 */

import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
	oneDark,
	oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { Edit2, ImageIcon } from "lucide-react";
import { MermaidRenderer } from "@/main/components/atoms/MermaidRenderer";
import { useTheme } from "@/main/components/molecules/ThemeContext";
import { Button } from "@/main/components/ui/button";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import {
	imageMimeFor,
	isDirectlyLoadable,
	resolveMarkdownAssetPath,
} from "./markdown-assets";
import { MarkdownWysiwyg } from "./MarkdownWysiwyg";
import type { DocumentEditorProps } from "./types";
import { cn } from "@/lib/utils";
import "./tiptap-editor.css";

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeRaw];

/**
 * Image in the rendered preview. Relative sources are read out of the document
 * filesystem and shown through a blob URL — pointing an <img> at the raw
 * relative path would resolve it against the extension page instead and 404.
 */
const MarkdownPreviewImage: React.FC<
	React.ImgHTMLAttributes<HTMLImageElement> & { filePath: string }
> = ({ filePath, src, alt, ...props }) => {
	const [objectUrl, setObjectUrl] = useState<string | null>(null);
	const [isMissing, setIsMissing] = useState(false);
	const isLocalAsset = typeof src === "string" && !isDirectlyLoadable(src);

	useEffect(() => {
		if (!isLocalAsset || typeof src !== "string") return;
		let currentUrl: string | null = null;
		let cancelled = false;
		setObjectUrl(null);
		setIsMissing(false);

		void (async () => {
			const assetPath = resolveMarkdownAssetPath(filePath, src);
			if (!assetPath) {
				if (!cancelled) setIsMissing(true);
				return;
			}
			try {
				const bytes = await documentFileSystemService.readFile(assetPath);
				if (cancelled) return;
				currentUrl = URL.createObjectURL(
					new Blob([bytes.slice()], { type: imageMimeFor(assetPath) }),
				);
				setObjectUrl(currentUrl);
			} catch {
				// Documents routinely reference images that were never stored
				// alongside them; that is a placeholder, not an error worth logging.
				if (!cancelled) setIsMissing(true);
			}
		})();

		return () => {
			cancelled = true;
			if (currentUrl) URL.revokeObjectURL(currentUrl);
		};
	}, [filePath, src, isLocalAsset]);

	if (!isLocalAsset) {
		return <img src={src} alt={alt ?? ""} {...props} />;
	}

	if (isMissing) {
		return (
			<span className="my-2 inline-flex max-w-full items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
				<ImageIcon className="h-3.5 w-3.5 shrink-0" />
				<span className="truncate">{alt?.trim() || src}</span>
			</span>
		);
	}

	if (!objectUrl) {
		return (
			<span className="my-2 inline-flex h-24 w-40 max-w-full animate-pulse rounded-md bg-muted" />
		);
	}

	return <img src={objectUrl} alt={alt ?? ""} {...props} />;
};

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
	const [isPreview, setIsPreview] = useState(true);
	// The WYSIWYG is built on first edit and then kept mounted, so switching back
	// to preview does not throw away unsaved changes.
	const [hasEnteredEditMode, setHasEnteredEditMode] = useState(false);

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
			img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
				<MarkdownPreviewImage {...props} filePath={file.path} />
			),
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
		[isDark, file.path],
	);

	return (
		<div className={cn("flex flex-col h-full min-h-0", className)}>
			<div
				className={cn(
					"flex-1 min-h-0 overflow-auto bg-background",
					!isPreview && "hidden",
				)}
			>
				{!readOnly && (
					<div className="sticky top-4 z-10 flex justify-end px-4 pointer-events-none">
						<Button
							variant="secondary"
							size="sm"
							onClick={() => {
								setHasEnteredEditMode(true);
								setIsPreview(false);
							}}
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

			{hasEnteredEditMode && (
				<div className={cn("flex-1 min-h-0", isPreview && "hidden")}>
					<MarkdownWysiwyg
						file={file}
						initialContent={initialContent}
						onContentChange={onContentChange}
						onSave={onSave}
						readOnly={readOnly}
						onRequestPreview={() => setIsPreview(true)}
					/>
				</div>
			)}
		</div>
	);
};
