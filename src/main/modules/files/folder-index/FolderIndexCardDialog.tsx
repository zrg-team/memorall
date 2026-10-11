import type React from "react";
import { useTranslation } from "react-i18next";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@/main/components/ui/dialog";
import { FolderIndexCardView } from "./FolderIndexCardView";
import { useFolderIndex } from "./FolderIndexContext";

/** A file's OKF card, opened from the Files list or an open file. */
export const FolderIndexCardDialog: React.FC = () => {
	const { t } = useTranslation("documents");
	const index = useFolderIndex();
	const path = index?.cardPath ?? null;
	if (!index) return null;

	return (
		<Dialog
			open={Boolean(path)}
			onOpenChange={(open) => !open && index.openCard(null)}
		>
			<DialogContent className="flex h-[min(88vh,720px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl [&>button]:hidden">
				<DialogTitle className="sr-only">
					{t("folderIndex.card.title")}
				</DialogTitle>
				<DialogDescription className="sr-only">{path}</DialogDescription>
				{path && (
					<FolderIndexCardView
						path={path}
						onClose={() => index.openCard(null)}
						className="h-full"
					/>
				)}
			</DialogContent>
		</Dialog>
	);
};
