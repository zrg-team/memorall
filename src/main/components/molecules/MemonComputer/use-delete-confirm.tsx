import React from "react";
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

/**
 * Asks before deleting files: the computer has no trash, so a delete is
 * final. `confirmDelete` opens the question; `dialog` renders it.
 */
export const useDeleteConfirm = (
	onDelete: (paths: string[]) => void,
): {
	confirmDelete: (paths: string[]) => void;
	dialog: React.ReactNode;
} => {
	const { t } = useTranslation("common");
	const [paths, setPaths] = React.useState<string[] | null>(null);
	const confirmDelete = React.useCallback((next: string[]) => {
		if (next.length) setPaths(next);
	}, []);
	const name = paths?.length === 1 ? paths[0].split("/").pop() : undefined;
	const dialog = (
		<AlertDialog
			open={paths !== null}
			onOpenChange={(open) => {
				if (!open) setPaths(null);
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{name
							? t("memonComputer.files.deleteOne", { name })
							: t("memonComputer.files.deleteMany", {
									count: paths?.length ?? 0,
								})}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t("memonComputer.files.deleteWarning")}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("buttons.cancel")}</AlertDialogCancel>
					<AlertDialogAction
						className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						onClick={() => {
							if (paths) onDelete(paths);
							setPaths(null);
						}}
					>
						{t("buttons.delete")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
	return { confirmDelete, dialog };
};
