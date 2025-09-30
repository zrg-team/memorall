import React from "react";

// Loader component
export const Loader: React.FC<{ size?: number }> = ({ size = 16 }) => (
	<div
		className="animate-spin rounded-full border-2 border-muted border-t-primary"
		style={{ width: size, height: size }}
	/>
);

// Rotate Counter-clockwise Icon
export const RotateCcwIcon: React.FC<{ className: string }> = ({
	className,
}) => (
	<svg
		className={className}
		fill="none"
		stroke="currentColor"
		viewBox="0 0 24 24"
	>
		<path
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={2}
			d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
		/>
	</svg>
);

// Chevron Right Icon (for expandable sections)
export const ChevronRightIcon: React.FC<{ className?: string }> = ({
	className,
}) => (
	<svg className={className} fill="currentColor" viewBox="0 0 20 20">
		<path
			fillRule="evenodd"
			d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
			clipRule="evenodd"
		/>
	</svg>
);

// Close/X Icon
export const CloseIcon: React.FC<{
	className?: string;
	style?: React.CSSProperties;
}> = ({ className, style }) => (
	<svg
		className={className}
		fill="none"
		stroke="currentColor"
		viewBox="0 0 24 24"
	>
		<path
			style={style}
			strokeLinecap="round"
			strokeLinejoin="round"
			strokeWidth={2}
			d="M6 18L18 6M6 6l12 12"
		/>
	</svg>
);
