import { Check, FolderOpen } from "lucide-react";
import type React from "react";
import { Suspense, lazy, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DocumentSaveContent } from "@/main/modules/chat/components/DocumentSaveFolderDialog";
import { logError } from "@/utils/logger";
import { StudioAction } from "./StudioThread";

// Loaded on first use: the dialog brings the documents filesystem with it,
// which every generation card would otherwise import just to render a button.
const DocumentSaveFolderDialog = lazy(() =>
	import("@/main/modules/chat/components/DocumentSaveFolderDialog").then(
		(module) => ({ default: module.DocumentSaveFolderDialog }),
	),
);

interface SaveToFilesActionProps {
	/** Suggested name, extension included; the dialog lets the user change it. */
	fileName: string;
	mimeType: string;
	/** The file's bytes or text; a loader is only called when saving. */
	content: DocumentSaveContent;
	label?: string;
	iconOnly?: boolean;
	className?: string;
	[data: `data-${string}`]: string | boolean | undefined;
}

/**
 * Chat's "Save" for a generation: pick a folder in Files and store a copy
 * there under a readable name. The studio's own copy stays where the session
 * keeps it, so saving never breaks history.
 */
export const SaveToFilesAction: React.FC<SaveToFilesActionProps> = ({
	fileName,
	mimeType,
	content,
	label,
	iconOnly = false,
	className,
	...data
}) => {
	const { t } = useTranslation("chat");
	const { t: tStudio } = useTranslation("studio");
	const [open, setOpen] = useState(false);
	const [opened, setOpened] = useState(false);
	const [saved, setSaved] = useState(false);

	useEffect(() => {
		if (!saved) return;
		const timer = setTimeout(() => setSaved(false), 3000);
		return () => clearTimeout(timer);
	}, [saved]);

	return (
		<>
			<StudioAction
				icon={
					saved ? (
						<Check className="h-3.5 w-3.5 text-green-500" />
					) : (
						<FolderOpen className="h-3.5 w-3.5" />
					)
				}
				label={
					saved
						? t("messages.saved", "Saved")
						: (label ??
							tStudio("common.saveToFiles", { defaultValue: "Save to Files" }))
				}
				iconOnly={iconOnly}
				onClick={() => {
					setOpened(true);
					setOpen(true);
				}}
				className={className}
				data-save-to-files
				{...data}
			/>
			{opened ? (
				<Suspense fallback={null}>
					<DocumentSaveFolderDialog
						open={open}
						content={content}
						initialFileName={fileName}
						mimeType={mimeType}
						onOpenChange={setOpen}
						onSaved={() => setSaved(true)}
						onError={(error) =>
							logError("[Studio] save to files failed", error)
						}
					/>
				</Suspense>
			) : null}
		</>
	);
};
