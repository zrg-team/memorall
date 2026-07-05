/**
 * Create Folder Dialog Modal
 * Dialog for creating new folders using nice-modal
 */

import React, { useState } from "react";
import NiceModal, { useModal } from "@ebay/nice-modal-react";
import { Loader2 } from "lucide-react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";

interface CreateFolderDialogProps {
	onCreateFolder: (folderName: string) => Promise<void>;
}

export const CreateFolderDialog = NiceModal.create<CreateFolderDialogProps>(
	({ onCreateFolder }) => {
		const modal = useModal();
		const [folderName, setFolderName] = useState("");
		const [creating, setCreating] = useState(false);

		const handleCreate = async () => {
			if (!folderName.trim()) return;

			setCreating(true);
			try {
				await onCreateFolder(folderName);
				modal.resolve();
				modal.hide();
				setFolderName("");
			} catch (error) {
				// Error handling is done in the callback
			} finally {
				setCreating(false);
			}
		};

		return (
			<Dialog
				open={modal.visible}
				onOpenChange={(open) => {
					if (!open) {
						modal.hide();
						setFolderName("");
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create New Folder</DialogTitle>
						<DialogDescription>
							Enter a name for the new folder
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="folder-name">Folder Name</Label>
							<Input
								id="folder-name"
								value={folderName}
								onChange={(e) => setFolderName(e.target.value)}
								placeholder="My Folder"
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										handleCreate();
									}
								}}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								modal.hide();
								setFolderName("");
							}}
						>
							Cancel
						</Button>
						<Button onClick={handleCreate} disabled={creating}>
							{creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
							Create
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		);
	},
);
