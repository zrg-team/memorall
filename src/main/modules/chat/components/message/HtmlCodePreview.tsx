import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Save } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
	oneDark,
	oneLight,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { useTheme } from "@/main/components/molecules/ThemeContext";
import { logError } from "@/utils/logger";
import { DocumentSaveFolderDialog } from "../DocumentSaveFolderDialog";
import { DeferredMount } from "./DeferredMount";

type SaveState = "idle" | "saving" | "saved";

export const HtmlCodePreview: React.FC<{ code: string }> = React.memo(
	({ code }) => {
		const { actualTheme } = useTheme();
		const isDark = actualTheme === "dark";
		const [showCode, setShowCode] = useState(false);
		const [saveState, setSaveState] = useState<SaveState>("idle");
		const [saveDialogOpen, setSaveDialogOpen] = useState(false);
		const { t } = useTranslation("chat");

		const handleSave = () => {
			if (saveState !== "idle") return;
			setSaveDialogOpen(true);
		};

		return (
			<div className="rounded-md overflow-hidden border border-border my-2">
				<div className="flex items-center justify-between border-b border-border px-3 py-1.5 bg-muted/30">
					<span className="text-xs text-muted-foreground">
						{t("htmlPreview.label")}
					</span>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={handleSave}
							disabled={saveState !== "idle"}
							className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border/50 disabled:opacity-60"
						>
							{saveState === "saved" ? (
								<>
									<Check className="w-3 h-3" /> {t("htmlPreview.saved")}
								</>
							) : (
								<>
									<Save className="w-3 h-3" />{" "}
									{saveState === "saving"
										? t("htmlPreview.saving")
										: t("htmlPreview.save")}
								</>
							)}
						</button>
						<button
							type="button"
							onClick={() => setShowCode((prev) => !prev)}
							className="px-2 py-0.5 text-xs rounded bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors border border-border/50"
						>
							{showCode ? t("htmlPreview.preview") : t("htmlPreview.code")}
						</button>
					</div>
				</div>
				{showCode ? (
					<SyntaxHighlighter
						style={isDark ? oneDark : oneLight}
						language="html"
						PreTag="div"
						className="text-sm"
						customStyle={{
							margin: 0,
							padding: "1rem",
							borderRadius: 0,
							backgroundColor: isDark ? "hsl(220 13% 18%)" : "hsl(210 40% 98%)",
						}}
					>
						{code}
					</SyntaxHighlighter>
				) : (
					// A live page per preview: only mounted while near the screen, so
					// a long chat does not keep every one it ever showed running.
					<DeferredMount minHeight={240}>
						<iframe
							srcDoc={code}
							sandbox="allow-scripts allow-same-origin"
							className="w-full bg-white"
							style={{ height: "60vh", border: "none" }}
							title="HTML Preview"
						/>
					</DeferredMount>
				)}
				<DocumentSaveFolderDialog
					open={saveDialogOpen}
					content={code}
					initialFileName={`preview-${Date.now()}.html`}
					mimeType="text/html"
					onOpenChange={setSaveDialogOpen}
					onSaved={() => {
						setSaveState("saved");
						setTimeout(() => setSaveState("idle"), 2000);
					}}
					onError={(err) => {
						logError("Failed to save HTML to documents:", err);
						setSaveState("idle");
					}}
				/>
			</div>
		);
	},
);

HtmlCodePreview.displayName = "HtmlCodePreview";
