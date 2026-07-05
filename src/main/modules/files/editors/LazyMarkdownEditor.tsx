import React, { Suspense, lazy } from "react";
import type { DocumentEditorProps } from "./types";

// The markdown editor pulls in TipTap, marked, turndown, react-markdown and
// react-syntax-highlighter. Load it lazily so registering editors at app start
// does not drag all of that into the entry bundle — it is fetched only when a
// document is actually opened/edited.
const MarkdownEditorInner = lazy(() =>
	import("./MarkdownEditor").then((m) => ({ default: m.MarkdownEditor })),
);

export const LazyMarkdownEditor: React.FC<DocumentEditorProps> = (props) => (
	<Suspense
		fallback={<div className="p-4 text-sm text-muted-foreground">…</div>}
	>
		<MarkdownEditorInner {...props} />
	</Suspense>
);
