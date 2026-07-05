/**
 * Upload Progress Dialog Modal
 * Shows progress for file uploads using nice-modal
 */
import NiceModal, { useModal } from "@ebay/nice-modal-react";

import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { Progress } from "@/main/components/ui/progress";
import type { DocumentUploadProgress } from "@/types/document-library";

interface UploadProgressDialogProps {
	uploadProgress: Map<string, DocumentUploadProgress>;
}

export const UploadProgressDialog = NiceModal.create<UploadProgressDialogProps>(
	({ uploadProgress }) => {
		const modal = useModal();

		return (
			<Dialog
				open={modal.visible}
				onOpenChange={(open) => !open && modal.hide()}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Uploading Files</DialogTitle>
						<DialogDescription>
							Please wait while your files are being uploaded
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3">
						{Array.from(uploadProgress.values()).map((progress) => (
							<div key={progress.id} className="space-y-2">
								<div className="flex items-center justify-between text-sm">
									<span className="truncate flex-1">{progress.file.name}</span>
									<span className="text-muted-foreground ml-2">
										{progress.progress}%
									</span>
								</div>
								<Progress value={progress.progress} />
								{progress.error && (
									<p className="text-xs text-destructive">{progress.error}</p>
								)}
							</div>
						))}
					</div>
				</DialogContent>
			</Dialog>
		);
	},
);
