import React, { Suspense, lazy } from "react";
import type { ExcelViewerProps } from "./ExcelViewer";

// The Excel viewer pulls in the full UniverJS suite (several MB). Load it lazily
// so it is code-split out of the entry bundle and only fetched when the user
// actually opens a spreadsheet document.
const ExcelViewer = lazy(() =>
	import("./ExcelViewer").then((m) => ({ default: m.ExcelViewer })),
);

export interface LazyExcelViewerProps extends ExcelViewerProps {
	/** Fallback shown while the code-split viewer chunk loads. */
	fallback?: React.ReactNode;
}

export const LazyExcelViewer: React.FC<LazyExcelViewerProps> = ({
	fallback,
	...props
}) => (
	<Suspense
		fallback={
			fallback ?? (
				<div className="flex items-center justify-center h-full p-4 text-sm text-muted-foreground">
					…
				</div>
			)
		}
	>
		<ExcelViewer {...props} />
	</Suspense>
);
