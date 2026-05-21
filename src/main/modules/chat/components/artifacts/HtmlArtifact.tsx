import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Save, Check } from "lucide-react";
import { logError } from "@/utils/logger";
import { DocumentSaveFolderDialog } from "../DocumentSaveFolderDialog";
import { ArtifactActionsMenu, type ArtifactProps } from "./ArtifactActionsMenu";

type SaveState = "idle" | "saving" | "saved";

const toSafeFileName = (value?: string) => {
	const name = (value?.trim() || "artifact")
		.replace(/[^a-z0-9._-]+/gi, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 64);

	return name || "artifact";
};

export const HtmlArtifact: React.FC<ArtifactProps> = ({
	content,
	identifier,
	title,
}) => {
	const [saveState, setSaveState] = useState<SaveState>("idle");
	const [saveDialogOpen, setSaveDialogOpen] = useState(false);
	const { t } = useTranslation("chat");

	const handleSave = () => {
		if (saveState !== "idle") return;
		setSaveDialogOpen(true);
	};

	return (
		<div className="relative my-2 overflow-hidden rounded-md">
			<ArtifactActionsMenu
				label={t("htmlPreview.artifactActions")}
				actions={[
					{
						label:
							saveState === "saved"
								? t("htmlPreview.saved")
								: saveState === "saving"
									? t("htmlPreview.saving")
									: t("htmlPreview.save"),
						icon:
							saveState === "saved" ? (
								<Check className="h-3.5 w-3.5" />
							) : (
								<Save className="h-3.5 w-3.5" />
							),
						onClick: handleSave,
						disabled: saveState !== "idle",
					},
				]}
			/>
			<DocumentSaveFolderDialog
				open={saveDialogOpen}
				content={content}
				initialFileName={`${toSafeFileName(identifier || title)}-${Date.now()}.html`}
				mimeType="text/html"
				onOpenChange={setSaveDialogOpen}
				onSaved={() => {
					setSaveState("saved");
					setTimeout(() => setSaveState("idle"), 2000);
				}}
				onError={(err) => {
					logError("Failed to save artifact HTML to documents:", err);
					setSaveState("idle");
				}}
			/>
			<iframe
				srcDoc={content}
				sandbox="allow-scripts allow-same-origin"
				className="w-full bg-white"
				style={{ height: "60vh", border: "none" }}
				title={title || t("htmlPreview.title")}
			/>
		</div>
	);
};
