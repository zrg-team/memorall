/**
 * Document Breadcrumb Component
 * Navigation breadcrumb for document library
 */

import React from "react";
import { useTranslation } from "react-i18next";
import { Home, ChevronRight } from "lucide-react";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import type { DocumentTreeNode } from "@/types/document-library";

export interface DocumentBreadcrumbHomeOption {
	label: string;
	isActive: boolean;
	onSelect: () => void;
}

interface DocumentBreadcrumbProps {
	/** Current path */
	currentPath: string;
	/** Full document tree */
	tree: DocumentTreeNode[];
	/** Callback when a breadcrumb item is clicked */
	onNavigate: (node: DocumentTreeNode | null) => void;
	/** Library title for home button */
	homeTitle?: string;
	/** Optional root selector shown from the home button */
	homeOptions?: DocumentBreadcrumbHomeOption[];
}

export const DocumentBreadcrumb: React.FC<DocumentBreadcrumbProps> = ({
	currentPath,
	tree,
	onNavigate,
	homeTitle,
	homeOptions,
}) => {
	const { t } = useTranslation("documents");
	const rootTitle = homeTitle || t("library.home");
	const hasHomeOptions = Boolean(homeOptions?.length);

	// Split path into segments
	const pathSegments = currentPath.split("/").filter(Boolean);

	/**
	 * Find a node by its path in the tree
	 */
	const findNodeByPath = (
		nodes: DocumentTreeNode[],
		targetPath: string,
	): DocumentTreeNode | null => {
		for (const node of nodes) {
			if (node.path === targetPath) return node;
			if (node.children) {
				const found = findNodeByPath(node.children, targetPath);
				if (found) return found;
			}
		}
		return null;
	};

	/**
	 * Handle home button click - navigate to root
	 */
	const handleHomeClick = () => {
		// Navigate to root by passing null (represents root level)
		onNavigate(null);
	};

	/**
	 * Handle breadcrumb segment click
	 */
	const handleSegmentClick = (path: string) => {
		const node = findNodeByPath(tree, path);
		if (node) {
			onNavigate(node);
		}
	};

	const homeButton = (
		<button
			onClick={hasHomeOptions ? undefined : handleHomeClick}
			className="flex min-w-0 items-center gap-1 hover:text-foreground transition-colors flex-shrink-0"
			title={rootTitle}
		>
			<Home className="h-3.5 w-3.5 md:h-4 md:w-4" />
			<span
				className={`truncate max-w-[110px] ${
					pathSegments.length === 0 ? "font-medium text-foreground" : ""
				}`}
			>
				{rootTitle}
			</span>
		</button>
	);

	return (
		<div className="flex items-center gap-1 text-xs md:text-sm text-muted-foreground min-w-0 flex-1 overflow-hidden">
			{/* Home button */}
			{hasHomeOptions ? (
				<DropdownMenu>
					<DropdownMenuTrigger asChild>{homeButton}</DropdownMenuTrigger>
					<DropdownMenuContent align="start">
						{homeOptions?.map((option) => (
							<DropdownMenuItem
								key={option.label}
								onClick={option.onSelect}
								className={option.isActive ? "font-medium" : undefined}
							>
								{option.label}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			) : (
				homeButton
			)}

			{/* Path segments */}
			{pathSegments.length > 0 && (
				<>
					<ChevronRight className="h-3 w-3 md:h-3.5 md:w-3.5 flex-shrink-0" />
					{/* Show only last 2 segments on small screens */}
					{pathSegments.slice(-2).map((segment, index) => {
						const actualIndex = pathSegments.length - 2 + index;
						const segmentPath =
							"/" + pathSegments.slice(0, actualIndex + 1).join("/");
						const isLast = actualIndex === pathSegments.length - 1;

						return (
							<React.Fragment key={segmentPath}>
								<button
									onClick={() => handleSegmentClick(segmentPath)}
									className={`hover:text-foreground transition-colors truncate max-w-[120px] ${
										isLast ? "font-medium text-foreground" : ""
									}`}
									title={segment}
								>
									{segment}
								</button>
								{!isLast && (
									<ChevronRight className="h-3 w-3 md:h-3.5 md:w-3.5 flex-shrink-0" />
								)}
							</React.Fragment>
						);
					})}
				</>
			)}
		</div>
	);
};
