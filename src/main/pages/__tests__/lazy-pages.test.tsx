import React, { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Stub every page module so the lazy wrappers resolve without pulling in the
// pages' heavy dependency trees. Each stub exports the SAME named export the
// wrapper maps to `default`, so a wrong mapping would render `undefined` and fail.
const stub = (name: string) => () => <div data-testid={name} />;

vi.mock("../EmbeddingPage", () => ({ EmbeddingPage: stub("EmbeddingPage") }));
vi.mock("../LLMPage", () => ({ LLMPage: stub("LLMPage") }));
vi.mock("../DatabasePage", () => ({ DatabasePage: stub("DatabasePage") }));
vi.mock("../LogsPage", () => ({ LogsPage: stub("LogsPage") }));
vi.mock("../KnowledgeGraphPage", () => ({
	KnowledgeGraphPage: stub("KnowledgeGraphPage"),
}));
vi.mock("../DocumentLibraryPage", () => ({
	DocumentLibraryPage: stub("DocumentLibraryPage"),
}));
vi.mock("../ActivityTimelinePage", () => ({
	ActivityTimelinePage: stub("ActivityTimelinePage"),
}));
vi.mock("../AgentsPage", () => ({ AgentsPage: stub("AgentsPage") }));
vi.mock("../RuntimePage", () => ({ RuntimePage: stub("RuntimePage") }));
vi.mock("../FlowBuilderPage/FlowBuilderPage", () => ({
	FlowBuilderPage: stub("FlowBuilderPage"),
}));

import * as LazyPages from "../lazy-pages";

const cases: Array<[string, React.LazyExoticComponent<React.ComponentType>]> = [
	["EmbeddingPage", LazyPages.EmbeddingPage],
	["LLMPage", LazyPages.LLMPage],
	["DatabasePage", LazyPages.DatabasePage],
	["LogsPage", LazyPages.LogsPage],
	["KnowledgeGraphPage", LazyPages.KnowledgeGraphPage],
	["DocumentLibraryPage", LazyPages.DocumentLibraryPage],
	["ActivityTimelinePage", LazyPages.ActivityTimelinePage],
	["AgentsPage", LazyPages.AgentsPage],
	["RuntimePage", LazyPages.RuntimePage],
	["FlowBuilderPage", LazyPages.FlowBuilderPage],
];

describe("lazy-pages", () => {
	it.each(
		cases,
	)("lazily resolves %s past the Suspense fallback", async (name, Page) => {
		render(
			<Suspense fallback={<div data-testid="page-fallback" />}>
				<Page />
			</Suspense>,
		);

		expect(await screen.findByTestId(name)).toBeInTheDocument();
	});
});
