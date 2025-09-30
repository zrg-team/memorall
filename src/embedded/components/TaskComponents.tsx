import React from "react";

// Task/Action Components (embedded versions)
export const Task: React.FC<{
	children: React.ReactNode;
	className?: string;
	defaultOpen?: boolean;
}> = ({ children, className, defaultOpen = false }) => (
	<details className={`group ${className || ""}`} open={defaultOpen}>
		{children}
	</details>
);

export const TaskTrigger: React.FC<{ title: string }> = ({ title }) => (
	<summary className="cursor-pointer flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground py-1">
		<svg
			className="w-3 h-3 group-open:rotate-90 transition-transform"
			fill="currentColor"
			viewBox="0 0 20 20"
		>
			<path
				style={{
					scale: 1.35,
				}}
				fillRule="evenodd"
				d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
				clipRule="evenodd"
			/>
		</svg>
		<span>{title}</span>
	</summary>
);

export const TaskContent: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => <div className="mt-2">{children}</div>;

export const TaskItem: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => <div className="pl-5 text-xs text-muted-foreground">{children}</div>;
