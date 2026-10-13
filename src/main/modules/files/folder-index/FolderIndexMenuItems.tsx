import { Check, Library } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
} from "@/main/components/ui/dropdown-menu";
import { useFolderIndex } from "./FolderIndexContext";
import { IndexTypeBadge } from "./IndexTypeBadge";

/**
 * A folder menu's "Indexes" submenu: each index type, ticked where it is in
 * effect. Choosing one adds it or removes it here; a subfolder of an indexed
 * folder can leave the index this way.
 */
export const FolderIndexMenuItems: React.FC<{
	path: string;
	mapped?: boolean;
}> = ({ path, mapped }) => {
	const { t } = useTranslation("documents");
	const index = useFolderIndex();
	if (!index?.types.length) return null;
	const effective = index.effectiveAt(path);

	return (
		<>
			<DropdownMenuSub>
				<DropdownMenuSubTrigger onClick={(event) => event.stopPropagation()}>
					<Library className="mr-2 h-4 w-4" />
					{t("folderIndex.menu")}
				</DropdownMenuSubTrigger>
				<DropdownMenuSubContent>
					{index.types.map((type) => {
						const on = effective.includes(type.id);
						return (
							<DropdownMenuItem
								key={type.id}
								title={type.beta ? t("folderIndex.betaNote") : undefined}
								onClick={(event) => {
									event.stopPropagation();
									void index.setFolderType(path, type.id, !on, { mapped });
								}}
							>
								<span className="mr-2 flex h-4 w-4 items-center justify-center">
									{on && <Check className="h-3.5 w-3.5" />}
								</span>
								<IndexTypeBadge
									label={type.label}
									beta={type.beta}
									className="mr-2"
								/>
								{on ? t("folderIndex.removeHere") : t("folderIndex.addHere")}
							</DropdownMenuItem>
						);
					})}
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onClick={(event) => {
							event.stopPropagation();
							index.setDialogOpen(true);
						}}
					>
						{t("folderIndex.manage")}
					</DropdownMenuItem>
				</DropdownMenuSubContent>
			</DropdownMenuSub>
			<DropdownMenuSeparator />
		</>
	);
};
