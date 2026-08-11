import React from "react";

export const WorkspaceCollapsedSidebarSection: React.FC<{
	label: string;
}> = ({ label }) => (
	<div className="flex h-4 w-full items-center justify-center px-1">
		<span className="text-[8px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
			{label}
		</span>
	</div>
);
