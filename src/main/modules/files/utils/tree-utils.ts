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

/**
 * Replace one node in place, leaving every other branch identity-equal.
 *
 * Rebuilding only the path down to the target keeps the memoized rows in
 * `DocumentTree` from re-rendering — which matters most in exactly the case
 * this exists for, a mapped folder with thousands of siblings on screen.
 */
export function updateNodeByPath(
	nodes: DocumentTreeNode[],
	targetPath: string,
	update: (node: DocumentTreeNode) => DocumentTreeNode,
): DocumentTreeNode[] {
	return nodes.map((node) => {
		if (node.path === targetPath) return update(node);
		if (!targetPath.startsWith(`${node.path}/`) || !node.children?.length) {
			return node;
		}
		return {
			...node,
			children: updateNodeByPath(node.children, targetPath, update),
		};
	});
}

/**
 * Carry what the user has already done onto a freshly-read tree.
 *
 * Any filesystem change rebuilds the tree, and the rebuild does not know which
 * folders were open or which deferred folders had been read. Dropping that
 * meant a mapped folder collapsed and had to be read again every time anything
 * anywhere changed — including the agent writing a file somewhere else
 * entirely. Matching on path, open folders stay open and listings already paid
 * for are kept.
 */
export function mergeTreeState(
	previous: DocumentTreeNode[],
	next: DocumentTreeNode[],
): DocumentTreeNode[] {
	if (previous.length === 0) return next;
	const byPath = new Map(previous.map((node) => [node.path, node]));

	return next.map((node) => {
		const before = byPath.get(node.path);
		if (!before) return node;

		// A folder that was read stays read: the service still holds the listing,
		// and re-reading it is the cost this exists to avoid.
		const keptChildren =
			node.isLazy && !before.isLazy && before.children.length > 0
				? before.children
				: mergeTreeState(before.children, node.children);

		return {
			...node,
			isExpanded: before.isExpanded,
			children: keptChildren,
			...(node.isLazy && !before.isLazy ? { isLazy: false } : {}),
		};
	});
}
