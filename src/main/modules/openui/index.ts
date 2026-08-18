import { createLibrary } from "@openuidev/react-lang";
import {
	chartComponents,
	contentComponents,
	formComponents,
	interactiveComponents,
	knowledgeComponents,
} from "./components/shadcn";
import {
	chartComponents as wireframeChartComponents,
	contentComponents as wireframeContentComponents,
	formComponents as wireframeFormComponents,
	interactiveComponents as wireframeInteractiveComponents,
	knowledgeComponents as wireframeKnowledgeComponents,
} from "./components/wireframe";
import {
	chartComponents as glassChartComponents,
	contentComponents as glassContentComponents,
	formComponents as glassFormComponents,
	interactiveComponents as glassInteractiveComponents,
	knowledgeComponents as glassKnowledgeComponents,
} from "./components/glass";
import type { OpenUITheme } from "@/services/flows-core/steps/features/visualize-response";

const componentGroups = [
	{ name: "Content", components: contentComponents.map((c) => c.name) },
	{ name: "Charts and tables", components: chartComponents.map((c) => c.name) },
	{ name: "Interactive", components: interactiveComponents.map((c) => c.name) },
	{ name: "Forms", components: formComponents.map((c) => c.name) },
	{ name: "Knowledge", components: knowledgeComponents.map((c) => c.name) },
];

const componentLibraryCache = new Map<
	OpenUITheme,
	ReturnType<typeof createLibrary>
>();

export function createComponentLibrary(theme: OpenUITheme = "shadcn") {
	const cached = componentLibraryCache.get(theme);
	if (cached) return cached;

	let library: ReturnType<typeof createLibrary>;
	if (theme === "wireframe") {
		library = createLibrary({
			root: "CardBlock",
			components: [
				...wireframeContentComponents,
				...wireframeChartComponents,
				...wireframeInteractiveComponents,
				...wireframeFormComponents,
				...wireframeKnowledgeComponents,
			],
			componentGroups,
		});
	} else if (theme === "glass") {
		library = createLibrary({
			root: "CardBlock",
			components: [
				...glassContentComponents,
				...glassChartComponents,
				...glassInteractiveComponents,
				...glassFormComponents,
				...glassKnowledgeComponents,
			],
			componentGroups,
		});
	} else {
		library = createLibrary({
			root: "CardBlock",
			components: [
				...contentComponents,
				...chartComponents,
				...interactiveComponents,
				...formComponents,
				...knowledgeComponents,
			],
			componentGroups,
		});
	}
	componentLibraryCache.set(theme, library);
	return library;
}

export const componentLibrary = createComponentLibrary("shadcn");

export type MemorallOpenUIComponentLibrary = ReturnType<
	typeof createComponentLibrary
>;
