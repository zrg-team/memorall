import type { DocumentTreeNode } from "@/types/document-library";

export function findNodeById(
	nodes: DocumentTreeNode[],
	id: string,
): DocumentTreeNode | null {
	for (const node of nodes) {
		if (node.id === id) return node;
		if (node.children?.length) {
			const found = findNodeById(node.children, id);
			if (found) return found;
		}
	}
	return null;
}

export function findNodeByPath(
	nodes: DocumentTreeNode[],
	path: string,
): DocumentTreeNode | null {
	for (const node of nodes) {
		if (node.path === path) return node;
		if (node.children?.length) {
			const found = findNodeByPath(node.children, path);
			if (found) return found;
		}
	}
	return null;
}

export function toggleNodeExpand(
	nodes: DocumentTreeNode[],
	targetId: string,
): DocumentTreeNode[] {
	return nodes.map((node) => {
		if (node.id === targetId) return { ...node, isExpanded: !node.isExpanded };
		if (node.children?.length)
			return { ...node, children: toggleNodeExpand(node.children, targetId) };
		return node;
	});
}

export function expandNodePath(
	nodes: DocumentTreeNode[],
	targetPath: string,
): DocumentTreeNode[] {
	return nodes.map((node) => {
		if (node.path === targetPath) return { ...node, isExpanded: true };
		if (!targetPath.startsWith(`${node.path}/`) || !node.children?.length) {
			return node;
		}
		return {
			...node,
			isExpanded: true,
			children: expandNodePath(node.children, targetPath),
		};
	});
}
