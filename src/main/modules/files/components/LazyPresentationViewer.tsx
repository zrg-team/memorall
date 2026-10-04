import React, { Suspense, lazy } from "react";
import type { PresentationViewerProps } from "./PresentationViewer";

// Split out of the entry bundle; fetched when the user opens a presentation.
const PresentationViewer = lazy(() =>
	import("./PresentationViewer").then((m) => ({
		default: m.PresentationViewer,
	})),
);

export const LazyPresentationViewer: React.FC<PresentationViewerProps> = (
	props,
) => (
	<Suspense
		fallback={
			<div className="flex h-full items-center justify-center p-4 text-sm text-muted-foreground">
				…
			</div>
		}
	>
		<PresentationViewer {...props} />
	</Suspense>
);
