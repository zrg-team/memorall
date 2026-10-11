import type React from "react";
import { useTranslation } from "react-i18next";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/main/components/ui/alert-dialog";
import { useFolderIndex } from "./FolderIndexContext";

/** Asks before indexing a folder that lives on the user's own disk. */
export const FolderIndexMappedConfirm: React.FC = () => {
	const { t } = useTranslation("documents");
	const index = useFolderIndex();
	const pending = index?.pendingMapped ?? null;
	if (!index) return null;
	const type = index.types.find(
		(candidate) => candidate.id === pending?.typeId,
	);

	return (
		<AlertDialog
			open={Boolean(pending)}
			onOpenChange={(open) => !open && void index.confirmMapped(false)}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("folderIndex.mappedTitle", {
							type: type?.label ?? "",
							folder: pending?.path ?? "",
						})}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t("folderIndex.mappedBody")}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={() => void index.confirmMapped(false)}>
						{t("folderIndex.cancel")}
					</AlertDialogCancel>
					<AlertDialogAction onClick={() => void index.confirmMapped(true)}>
						{t("folderIndex.mappedConfirm", { type: type?.label ?? "" })}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
};
