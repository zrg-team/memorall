import type {
	DocumentFile,
	DocumentFolder,
	DocumentTreeNode,
} from "@/types/document-library";

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
 *
 * Nodes that come back the same are the previous objects, and so is the whole
 * tree when nothing changed, so the rows of an untouched branch (and the open
 * file's node) keep their identity and memoised rows skip the rebuild.
 */
export function mergeTreeState(
	previous: DocumentTreeNode[],
	next: DocumentTreeNode[],
): DocumentTreeNode[] {
	if (previous.length === 0) return next.length === 0 ? previous : next;
	const byPath = new Map(previous.map((node) => [node.path, node]));
	let changed = previous.length !== next.length;

	const merged = next.map((node, index) => {
		const before = byPath.get(node.path);
		if (!before) {
			changed = true;
			return node;
		}

		// A folder that was read stays read: the service still holds the listing,
		// and re-reading it is the cost this exists to avoid.
		const keptRead = node.isLazy === true && !before.isLazy;
		const keptChildren =
			keptRead && before.children.length > 0
				? before.children
				: mergeTreeState(before.children, node.children);

		const candidate: DocumentTreeNode = {
			...node,
			isExpanded: before.isExpanded,
			children: keptChildren,
			...(keptRead ? { isLazy: false } : {}),
			...(keptRead && node.folder
				? { folder: { ...node.folder, childCount: keptChildren.length } }
				: {}),
		};
		const kept = sameNode(before, candidate) ? before : candidate;
		if (kept !== previous[index]) changed = true;
		return kept;
	});
	return changed ? merged : previous;
}

const sameFolder = (a?: DocumentFolder, b?: DocumentFolder): boolean =>
	a === b ||
	(a !== undefined &&
		b !== undefined &&
		a.id === b.id &&
		a.name === b.name &&
		a.path === b.path &&
		a.parentPath === b.parentPath &&
		// Folder dates are stamped when the tree is read, not stored, so a
		// rebuild alone would make every folder look changed.
		a.childCount === b.childCount);

const time = (date: Date | string): number => new Date(date).getTime();

const sameFile = (a?: DocumentFile, b?: DocumentFile): boolean =>
	a === b ||
	(a !== undefined &&
		b !== undefined &&
		a.id === b.id &&
		a.name === b.name &&
		a.path === b.path &&
		a.type === b.type &&
		a.mimeType === b.mimeType &&
		a.size === b.size &&
		Object.is(time(a.createdAt), time(b.createdAt)) &&
		Object.is(time(a.modifiedAt), time(b.modifiedAt)) &&
		JSON.stringify(a.metadata ?? {}) === JSON.stringify(b.metadata ?? {}));

/** Same as far as anything draws it; children by identity (merged first). */
const sameNode = (a: DocumentTreeNode, b: DocumentTreeNode): boolean =>
	a.id === b.id &&
	a.name === b.name &&
	a.path === b.path &&
	a.type === b.type &&
	a.isExpanded === b.isExpanded &&
	Boolean(a.isLazy) === Boolean(b.isLazy) &&
	Boolean(a.isLoading) === Boolean(b.isLoading) &&
	a.children === b.children &&
	sameFolder(a.folder, b.folder) &&
	sameFile(a.file, b.file);
