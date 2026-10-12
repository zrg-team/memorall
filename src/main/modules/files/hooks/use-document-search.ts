import { useEffect, useMemo, useState } from "react";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { folderIndexClient } from "@/services/folder-index/folder-index-client";
import { EMBEDDING_INDEX_TYPE_ID } from "@/services/folder-index/constants";
import { isSameOrInside } from "@/services/folder-index/index-config";
import type { EmbeddingSearchHit } from "@/services/folder-index/embedding/types";
import type { Topic } from "@/services/database/entities/topics";
import type {
	DocumentLibraryItem,
	DocumentTreeNode,
} from "@/types/document-library";
import { useFolderIndex } from "../folder-index/FolderIndexContext";

const SEARCH_DELAY_MS = 300;
const EMPTY_HITS = new Map<string, EmbeddingSearchHit>();

const inventoryOf = (folder: DocumentTreeNode | null) => {
	const items: DocumentLibraryItem[] = [];
	const deferred: DocumentTreeNode[] = [];
	const visit = (node: DocumentTreeNode) => {
		if (node.type === "file" && node.file) {
			items.push({ type: "file", item: node.file });
		} else if (node.type === "folder") {
			if (node.folder) items.push({ type: "folder", item: node.folder });
			if (node.isLazy) deferred.push(node);
			else node.children.forEach(visit);
		}
	};
	if (folder?.type === "folder") {
		if (folder.isLazy) deferred.push(folder);
		else folder.children.forEach(visit);
	}
	return { items, deferred };
};

interface SearchState {
	key: string;
	folder: DocumentTreeNode | null;
	names: DocumentLibraryItem[];
	semantic: DocumentLibraryItem[];
	hits: Map<string, EmbeddingSearchHit>;
	pending: number;
	error: string | null;
}

/** Name matches appear immediately; indexed content and mapped folders follow. */
export function useDocumentSearch({
	folder,
	folderContents,
	searchQuery,
	fileTopicMap,
	selectedTopicIds,
}: {
	folder: DocumentTreeNode | null;
	folderContents: DocumentLibraryItem[];
	searchQuery: string;
	fileTopicMap: Map<string, Topic[]>;
	selectedTopicIds: string[];
}) {
	const index = useFolderIndex();
	const query = searchQuery.trim();
	const path = folder?.path ?? "/";
	const active = query.length > 0 && folder?.type === "folder";
	const inventory = useMemo(
		() => inventoryOf(active ? folder : null),
		[active, folder],
	);
	const embeddingFolders = (index?.state?.folders ?? []).filter(
		(candidate) =>
			isSameOrInside(candidate.path, path) ||
			isSameOrInside(path, candidate.path),
	);
	const hasEmbeddings =
		(index?.effectiveAt(path).includes(EMBEDDING_INDEX_TYPE_ID) ?? false) ||
		embeddingFolders.some(
			(candidate) =>
				isSameOrInside(candidate.path, path) &&
				candidate.effective.includes(EMBEDDING_INDEX_TYPE_ID),
		);
	// A completed rebuild refreshes results; unchanged polling does not run inference again.
	const revision = JSON.stringify(
		embeddingFolders.map((candidate) => [
			candidate.path,
			candidate.on,
			candidate.off,
			candidate.status.filter(
				(status) => status.typeId === EMBEDDING_INDEX_TYPE_ID,
			),
		]),
	);
	const key = JSON.stringify([path, query, revision]);
	const [state, setState] = useState<SearchState | null>(null);

	useEffect(() => {
		if (!active) {
			setState(null);
			return;
		}
		let cancelled = false;
		const pending =
			Number(inventory.deferred.length > 0) + Number(hasEmbeddings);
		setState({
			key,
			folder,
			names: [],
			semantic: [],
			hits: new Map(),
			pending,
			error: null,
		});
		const update = (patch: Partial<SearchState>) => {
			if (cancelled) return;
			setState((previous) =>
				previous?.key === key && previous.folder === folder
					? { ...previous, ...patch, pending: previous.pending - 1 }
					: previous,
			);
		};
		const fail = (error: unknown) =>
			update({ error: error instanceof Error ? error.message : String(error) });
		const timer = setTimeout(() => {
			if (inventory.deferred.length) {
				void (async () => {
					const names: DocumentLibraryItem[] = [];
					const queue = [...inventory.deferred];
					for (const node of queue) {
						if (cancelled) return;
						const children = await documentFileSystemService.getFolderChildren(
							node.path,
						);
						const next = inventoryOf({ ...node, children, isLazy: false });
						names.push(...next.items);
						queue.push(...next.deferred);
					}
					update({ names });
				})().catch(fail);
			}
			if (hasEmbeddings) {
				void (async () => {
					const result = await folderIndexClient.request("embedding.search", {
						query,
						folder: path,
						limit: 50,
					});
					if (cancelled) return;
					const hits = new Map<string, EmbeddingSearchHit>();
					for (const hit of [...result.hits].sort(
						(a, b) => b.score - a.score,
					)) {
						if (isSameOrInside(hit.path, path) && !hits.has(hit.path))
							hits.set(hit.path, hit);
					}
					const known = new Map(
						inventory.items.map((item) => [item.item.path, item]),
					);
					const nodes = await Promise.allSettled(
						[...hits.keys()].map(
							async (hitPath): Promise<DocumentLibraryItem | null> => {
								const item = known.get(hitPath);
								if (item?.type === "file") return item;
								const node =
									await documentFileSystemService.resolveNode(hitPath);
								return node?.type === "file" && node.file
									? { type: "file", item: node.file }
									: null;
							},
						),
					);
					const semantic = nodes.flatMap((node) =>
						node.status === "fulfilled" && node.value ? [node.value] : [],
					);
					update({ semantic, hits });
				})().catch(fail);
			}
		}, SEARCH_DELAY_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [active, folder, inventory, hasEmbeddings, key, path, query]);

	const current = state?.key === key && state.folder === folder ? state : null;
	const items = useMemo(() => {
		if (!active) return folderContents;
		const terms = query.toLocaleLowerCase().split(/\s+/u);
		const matches = new Map<string, DocumentLibraryItem>();
		for (const item of [...inventory.items, ...(current?.names ?? [])]) {
			const relativePath = item.item.path.slice(
				path === "/" ? 1 : path.length + 1,
			);
			const text = `${item.item.name} ${relativePath}`.toLocaleLowerCase();
			if (terms.every((term) => text.includes(term)))
				matches.set(item.item.path, item);
		}
		for (const item of current?.semantic ?? [])
			matches.set(item.item.path, item);
		return [...matches.values()].filter(
			(item) =>
				item.type === "folder" ||
				selectedTopicIds.length === 0 ||
				(fileTopicMap.get(item.item.path) ?? []).some((topic) =>
					selectedTopicIds.includes(topic.id),
				),
		);
	}, [
		active,
		folderContents,
		query,
		inventory,
		current,
		path,
		fileTopicMap,
		selectedTopicIds,
	]);
	return {
		active,
		items,
		hits: active ? (current?.hits ?? EMPTY_HITS) : EMPTY_HITS,
		busy:
			active &&
			(current
				? current.pending > 0
				: inventory.deferred.length > 0 || hasEmbeddings),
		error: active ? (current?.error ?? null) : null,
	};
}
