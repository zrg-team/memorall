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
import type { OpenUITheme } from "@/services/flows-legacy/steps/features/visualize-response";

const componentGroups = [
	{ name: "Content", components: contentComponents.map((c) => c.name) },
	{ name: "Charts and tables", components: chartComponents.map((c) => c.name) },
	{ name: "Interactive", components: interactiveComponents.map((c) => c.name) },
	{ name: "Forms", components: formComponents.map((c) => c.name) },
	{ name: "Knowledge", components: knowledgeComponents.map((c) => c.name) },
];

export function createComponentLibrary(theme: OpenUITheme = "shadcn") {
	if (theme === "wireframe") {
		return createLibrary({
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
	}

	if (theme === "glass") {
		return createLibrary({
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
	}

	return createLibrary({
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

export const componentLibrary = createComponentLibrary("shadcn");

export type MemorallOpenUIComponentLibrary = ReturnType<
	typeof createComponentLibrary
>;
