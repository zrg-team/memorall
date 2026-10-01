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
import type { OpenUITheme } from "@/services/flows-integrations/steps/features/visualize-response/index";
import { withPartBoundary } from "./components/part-boundary";

/** Every component in its own error boundary: one broken part, not a blank visual. */
const bounded = <T extends Parameters<typeof withPartBoundary>[0]>(
	components: T[],
): T[] => components.map(withPartBoundary);

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
			components: bounded([
				...wireframeContentComponents,
				...wireframeChartComponents,
				...wireframeInteractiveComponents,
				...wireframeFormComponents,
				...wireframeKnowledgeComponents,
			]),
			componentGroups,
		});
	} else if (theme === "glass") {
		library = createLibrary({
			root: "CardBlock",
			components: bounded([
				...glassContentComponents,
				...glassChartComponents,
				...glassInteractiveComponents,
				...glassFormComponents,
				...glassKnowledgeComponents,
			]),
			componentGroups,
		});
	} else {
		library = createLibrary({
			root: "CardBlock",
			components: bounded([
				...contentComponents,
				...chartComponents,
				...interactiveComponents,
				...formComponents,
				...knowledgeComponents,
			]),
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
