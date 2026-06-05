import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Folder, Save } from "lucide-react";

import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import {
	DOCUMENTS_SANDBOX_ROOT,
	toDocumentsSandboxPath,
} from "@/services/filesystem/sandbox-paths";
import type { DocumentTreeNode } from "@/types/document-library";

interface DocumentSaveFolderDialogProps {
	open: boolean;
	content: string;
	initialFileName: string;
	mimeType: string;
	onOpenChange: (open: boolean) => void;
	onSaved?: () => void;
	onError?: (error: unknown) => void;
}

function collectFolderPaths(nodes: DocumentTreeNode[]): string[] {
	const folders = new Set<string>(["/"]);
	const visit = (items: DocumentTreeNode[]): void => {
		items.forEach((node) => {
			if (node.type === "folder") folders.add(node.path);
			if (node.children?.length) visit(node.children);
		});
	};
	visit(nodes);
	return Array.from(folders).sort((left, right) => left.localeCompare(right));
}

export const DocumentSaveFolderDialog: React.FC<
	DocumentSaveFolderDialogProps
> = ({
	open,
	content,
	initialFileName,
	mimeType,
	onOpenChange,
	onSaved,
	onError,
}) => {
	const { t } = useTranslation("chat");
	const [folders, setFolders] = useState<string[]>(["/"]);
	const [selectedFolder, setSelectedFolder] = useState("/");
	const [fileName, setFileName] = useState(initialFileName);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!open) return;

		let cancelled = false;
		setFileName(initialFileName);
		setError(null);
		void documentFileSystemService
			.initialize()
			.then(() => documentFileSystemService.getTree(DOCUMENTS_SANDBOX_ROOT))
			.then((tree) => {
				if (cancelled) return;
				const nextFolders = collectFolderPaths(tree);
				setFolders(nextFolders);
				setSelectedFolder((current) =>
					nextFolders.includes(current) ? current : (nextFolders[0] ?? "/"),
				);
			})
			.catch((err) => {
				if (cancelled) return;
				setFolders(["/"]);
				setSelectedFolder("/");
				onError?.(err);
			});

		return () => {
			cancelled = true;
		};
	}, [initialFileName, onError, open]);

	const handleSave = async () => {
		const trimmedName = fileName.trim();
		if (!trimmedName || saving) return;

		setSaving(true);
		setError(null);
		try {
			const file = new File([content], trimmedName, { type: mimeType });
			await documentFileSystemService.uploadFile(
				file,
				toDocumentsSandboxPath(selectedFolder),
			);
			onSaved?.();
			onOpenChange(false);
		} catch (err) {
			setError(
				err instanceof Error
					? err.message
					: t("saveDialog.failed", "Failed to save"),
			);
			onError?.(err);
		} finally {
			setSaving(false);
		}
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => !saving && onOpenChange(nextOpen)}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Folder className="h-5 w-5" />
						{t("saveDialog.title", "Select folder to store")}
					</DialogTitle>
				</DialogHeader>

				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="document-save-folder">
							{t("saveDialog.folder", "Folder")}
						</Label>
						<Select
							value={selectedFolder}
							onValueChange={setSelectedFolder}
							disabled={saving}
						>
							<SelectTrigger id="document-save-folder">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{folders.map((folder) => (
									<SelectItem key={folder} value={folder}>
										{folder}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="document-save-name">
							{t("saveDialog.fileName", "File name")}
						</Label>
						<Input
							id="document-save-name"
							value={fileName}
							onChange={(event) => {
								setFileName(event.target.value);
								setError(null);
							}}
							onKeyDown={(event) => {
								if (event.key === "Enter") void handleSave();
							}}
							disabled={saving}
							autoFocus
						/>
						{error ? <p className="text-sm text-destructive">{error}</p> : null}
					</div>
				</div>

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={saving}
					>
						{t("saveDialog.cancel", "Cancel")}
					</Button>
					<Button
						type="button"
						onClick={() => void handleSave()}
						disabled={saving || !fileName.trim()}
					>
						<Save className="mr-1 h-4 w-4" />
						{saving
							? t("saveDialog.saving", "Saving...")
							: t("saveDialog.save", "Save to documents")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};
