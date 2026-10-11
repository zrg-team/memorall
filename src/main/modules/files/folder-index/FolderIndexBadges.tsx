import type React from "react";
import { useFolderIndex } from "./FolderIndexContext";
import { IndexTypeBadge } from "./IndexTypeBadge";

/** The index types in effect in a folder, for folder rows and cards. */
export const FolderIndexBadges: React.FC<{
	path: string;
	className?: string;
}> = ({ path, className }) => {
	const index = useFolderIndex();
	const effective = index?.effectiveAt(path) ?? [];
	if (!index || !effective.length) return null;
	return (
		<span className={className}>
			{effective.map((typeId) => (
				<IndexTypeBadge
					key={typeId}
					label={
						index.types.find((type) => type.id === typeId)?.label ?? typeId
					}
				/>
			))}
		</span>
	);
};
