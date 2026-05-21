import React from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";

export interface ArtifactProps {
	content: string;
	identifier?: string;
	title?: string;
}

export interface ArtifactAction {
	label: string;
	icon: React.ReactNode;
	onClick: () => void;
	disabled?: boolean;
}

export const ArtifactActionsMenu: React.FC<{
	actions: ArtifactAction[];
	label: string;
}> = ({ actions, label }) => {
	if (actions.length === 0) {
		return null;
	}

	return (
		<div className="absolute right-2 top-2 z-10">
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						title={label}
						className="h-7 w-7 bg-background/75 text-muted-foreground opacity-80 shadow-sm backdrop-blur transition-opacity hover:bg-background/90 hover:text-foreground hover:opacity-100"
					>
						<MoreHorizontal size={15} />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					{actions.map((action) => (
						<DropdownMenuItem
							key={action.label}
							onClick={action.onClick}
							disabled={action.disabled}
							className="flex items-center gap-2"
						>
							{action.icon}
							<span>{action.label}</span>
						</DropdownMenuItem>
					))}
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
};
