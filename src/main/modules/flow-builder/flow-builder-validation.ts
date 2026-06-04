import type { Edge, Node } from "@xyflow/react";
import type { CatalogStep } from "@/services/flow-builder-catalog";

export type FlowValidationSeverity = "error" | "warning";

export interface FlowValidationIssue {
	code: string;
	message: string;
	severity: FlowValidationSeverity;
}

export function validateFlowGraph<T extends Record<string, unknown>>(
	nodes: Node<T>[],
	edges: Edge[],
	_stepsCatalog: CatalogStep[],
): FlowValidationIssue[] {
	const issues: FlowValidationIssue[] = [];

	const startNodes = nodes.filter(
		(node) => node.id !== "__start__" && node.data?.isStart,
	);
	const endNodes = nodes.filter(
		(node) => node.id !== "__end__" && node.data?.isEnd,
	);

	if (nodes.length === 0) {
		issues.push({
			code: "graph.empty",
			message: "Flow has no steps.",
			severity: "error",
		});
	}

	if (startNodes.length === 0) {
		issues.push({
			code: "graph.no_start",
			message: "Flow requires at least one start step.",
			severity: "error",
		});
	}

	if (endNodes.length === 0) {
		issues.push({
			code: "graph.no_end",
			message: "Flow requires at least one end step.",
			severity: "error",
		});
	}

	const nodeIds = new Set(nodes.map((node) => node.id));
	const danglingEdges = edges.filter(
		(edge) => !nodeIds.has(edge.source) || !nodeIds.has(edge.target),
	);

	if (danglingEdges.length > 0) {
		issues.push({
			code: "graph.dangling_edges",
			message: "Flow has connections pointing to missing steps.",
			severity: "error",
		});
	}

	const invalidStartEdges = edges.filter((edge) => edge.target === "__start__");
	if (invalidStartEdges.length > 0) {
		issues.push({
			code: "graph.start_incoming",
			message: "Start node cannot have incoming connections.",
			severity: "error",
		});
	}

	const invalidEndEdges = edges.filter((edge) => edge.source === "__end__");
	if (invalidEndEdges.length > 0) {
		issues.push({
			code: "graph.end_outgoing",
			message: "End node cannot have outgoing connections.",
			severity: "error",
		});
	}

	return issues;
}
