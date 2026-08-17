import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Save } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
	oneDark,
	oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { logError } from "@/utils/logger";
import { DocumentSaveFolderDialog } from "../DocumentSaveFolderDialog";

type SaveState = "idle" | "saved";

const CODE_FILE_META: Record<string, { extension: string; mimeType: string }> =
	{
		css: { extension: "css", mimeType: "text/css" },
		html: { extension: "html", mimeType: "text/html" },
		js: { extension: "js", mimeType: "text/javascript" },
		json: { extension: "json", mimeType: "application/json" },
		jsx: { extension: "jsx", mimeType: "text/javascript" },
		md: { extension: "md", mimeType: "text/markdown" },
		py: { extension: "py", mimeType: "text/x-python" },
		ts: { extension: "ts", mimeType: "text/typescript" },
		tsx: { extension: "tsx", mimeType: "text/typescript" },
		txt: { extension: "txt", mimeType: "text/plain" },
	};

const getCodeFileMeta = (language: string) =>
	CODE_FILE_META[language.toLowerCase()] ?? {
		extension: language.toLowerCase() || "txt",
		mimeType: "text/plain",
	};

interface CodeBlockWithSaveProps {
	code: string;
	language: string;
	isDark: boolean;
	/**
	 * Offer "save this snippet into Documents". Off for hosts where the code is
	 * already a file the user is editing — the Skills preview, for instance,
	 * where it would both duplicate the editor's own Save and write a stray
	 * snippet into the document library.
	 */
	showSave?: boolean;
}

export const CodeBlockWithSave: React.FC<CodeBlockWithSaveProps> = React.memo(
	({ code, language, isDark, showSave = true }) => {
		const [saveState, setSaveState] = useState<SaveState>("idle");
		const [saveDialogOpen, setSaveDialogOpen] = useState(false);
		const { t } = useTranslation("chat");
		const fileMeta = getCodeFileMeta(language);
		const fileName = `code-${Date.now()}.${fileMeta.extension}`;

		return (
			<div className="my-2 overflow-hidden rounded-md border border-border">
				<div className="flex items-center justify-between gap-2 border-b border-border bg-muted/30 px-3 py-1.5">
					<span className="truncate text-xs text-muted-foreground">
						{language || t("htmlPreview.code")}
					</span>
					{showSave ? (
						<button
							type="button"
							onClick={() => setSaveDialogOpen(true)}
							disabled={saveState !== "idle"}
							className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border/50 disabled:opacity-60"
						>
							{saveState === "saved" ? (
								<>
									<Check className="w-3 h-3" /> {t("htmlPreview.saved")}
								</>
							) : (
								<>
									<Save className="w-3 h-3" /> {t("htmlPreview.save")}
								</>
							)}
						</button>
					) : null}
				</div>
				<SyntaxHighlighter
					style={isDark ? oneDark : oneLight}
					language={language}
					PreTag="div"
					className="text-sm"
					customStyle={{
						margin: 0,
						padding: "1rem",
						backgroundColor: isDark ? "hsl(220 13% 18%)" : "hsl(210 40% 98%)",
					}}
				>
					{code}
				</SyntaxHighlighter>
				{showSave ? (
					<DocumentSaveFolderDialog
						open={saveDialogOpen}
						content={code}
						initialFileName={fileName}
						mimeType={fileMeta.mimeType}
						onOpenChange={setSaveDialogOpen}
						onSaved={() => {
							setSaveState("saved");
							setTimeout(() => setSaveState("idle"), 2000);
						}}
						onError={(err) => {
							logError("Failed to save code block to documents:", err);
							setSaveState("idle");
						}}
					/>
				) : null}
			</div>
		);
	},
);

CodeBlockWithSave.displayName = "CodeBlockWithSave";
