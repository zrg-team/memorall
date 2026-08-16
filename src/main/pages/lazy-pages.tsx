import { lazy } from "react";

/**
 * Route-level code splitting.
 *
 * Each page is a named export, so it is wrapped to expose a `default` export for
 * `React.lazy`. Splitting pages here keeps their (often heavy) dependency trees —
 * D3, @xyflow/react, recharts, TipTap, react-syntax-highlighter, etc. — out of
 * the entry bundle so the popup/options app boots faster. Pages are fetched on
 * first navigation and cached by the browser thereafter.
 *
 * `AuthPage` is intentionally NOT split: it renders before the app shell and
 * should be immediately available.
 */

export const EmbeddingPage = lazy(() =>
	import("./EmbeddingPage").then((m) => ({ default: m.EmbeddingPage })),
);
export const LLMPage = lazy(() =>
	import("./LLMPage").then((m) => ({ default: m.LLMPage })),
);
export const DatabasePage = lazy(() =>
	import("./DatabasePage").then((m) => ({ default: m.DatabasePage })),
);
export const LogsPage = lazy(() =>
	import("./LogsPage").then((m) => ({ default: m.LogsPage })),
);
export const KnowledgeGraphPage = lazy(() =>
	import("./KnowledgeGraphPage").then((m) => ({
		default: m.KnowledgeGraphPage,
	})),
);
export const DocumentLibraryPage = lazy(() =>
	import("./DocumentLibraryPage").then((m) => ({
		default: m.DocumentLibraryPage,
	})),
);
export const ActivityTimelinePage = lazy(() =>
	import("./ActivityTimelinePage").then((m) => ({
		default: m.ActivityTimelinePage,
	})),
);
export const AgentsPage = lazy(() =>
	import("./AgentsPage").then((m) => ({ default: m.AgentsPage })),
);
export const RuntimePage = lazy(() =>
	import("./RuntimePage").then((m) => ({ default: m.RuntimePage })),
);
export const ConnectionsPage = lazy(() =>
	import("./ConnectionsPage").then((m) => ({ default: m.ConnectionsPage })),
);
export const FlowBuilderPage = lazy(() =>
	import("./FlowBuilderPage/FlowBuilderPage").then((m) => ({
		default: m.FlowBuilderPage,
	})),
);
