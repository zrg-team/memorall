import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import NiceModal from "@ebay/nice-modal-react";
import {
	documentFileSystemService,
	type FilesystemChangeEvent,
} from "@/services/filesystem/document-filesystem";
import {
	folderLineage,
	parentFolder,
} from "@/services/folder-index/index-config";
import {
	toSandboxPath,
	toDocumentsSandboxPath,
	normalizeSandboxPath,
	DOCUMENTS_SANDBOX_ROOT,
} from "@/services/filesystem/sandbox-paths";
import { topicService } from "@/main/modules/topics/services/topic-service";
import { TopicSelectorDialog } from "@/main/modules/topics/modals";
import { useKnowledgeConversion } from "./use-knowledge-conversion";
import type {
	DocumentLibraryItem,
	DocumentTreeNode,
	DocumentUploadProgress,
	DocumentFile,
	DocumentFolder,
} from "@/types/document-library";
import type { Topic } from "@/services/database/entities/topics";
import { logError, logInfo } from "@/utils/logger";
import { readPDFFile } from "../handlers/pdf-extraction";
import { readExcelFile } from "../handlers/excel-extraction";
import { UploadProgressDialog, CreateDocumentDialog } from "../modals";
import {
	findNodeById,
	findNodeByPath,
	expandNodePath,
	toggleNodeExpand,
	updateNodeByPath,
	mergeTreeState,
} from "../utils/tree-utils";
import { downloadFolderAsZip } from "../utils/save-download";
import {
	HOSTED_APP_IDS,
	HOSTED_APPS,
	hostedAppForPath,
} from "@/services/memon/apps/hosted/catalog";
import { createHostedFile } from "@/services/memon/apps/hosted/commands";
import { loadHostedEngine } from "@/services/memon/apps/hosted/engines";

// ── Module-level helpers ──────────────────────────────────────────────────────

// toSandboxPath is imported from @/services/filesystem/sandbox-paths

/**
 * How long a burst of filesystem changes (an agent or the sandbox writing many
 * files) is gathered before the tree is read again, once for all of them.
 */
const FILESYSTEM_RELOAD_DELAY_MS = 200;

/**
 * What "Upload files" offers to pick: what the viewers show, the text the
 * editors open, and every file a hosted app opens (Office files, boards,
 * PDFs), from the apps' own catalog.
 */
const UPLOAD_ACCEPT = [
	".pdf,.png,.jpg,.jpeg,.gif,.webp",
	".txt,.md,.markdown,.json,.yaml,.yml,.csv,.tsv,.html,.htm",
	// Audio and video play in the viewer.
	".wav,.mp3,.ogg,.oga,.m4a,.flac,.mp4,.m4v,.mov,.webm,.ogv,.mkv",
	"audio/*,video/*",
	...new Set(
		HOSTED_APP_IDS.flatMap((id) =>
			HOSTED_APPS[id].extensions.map((extension) => `.${extension}`),
		),
	),
].join(",");
/** A steady stream of changes still shows up at least this often. */
const FILESYSTEM_RELOAD_MAX_DELAY_MS = 1_000;

/**
 * Whether a change can alter which topics files have. Topics are kept by file
 * path, so writing or creating files leaves them as they were; anything that
 * moves or removes a path, or says nothing about what changed, may not.
 */
const changeAffectsTopics = (change: FilesystemChangeEvent | null): boolean => {
	if (!change) return true;
	if (change.operation === "batch")
		return (change.changes ?? []).some(changeAffectsTopics);
	return !["write", "create", "mkdir"].includes(change.operation);
};

/** Same content, as the database hands it back (dates included). */
const sameJson = (a: unknown, b: unknown): boolean =>
	JSON.stringify(a) === JSON.stringify(b);

/** Build the virtual documents-root DocumentTreeNode that wraps top-level doc items. */
function makeDocsRoot(items: DocumentTreeNode[]): DocumentTreeNode {
	const folder: DocumentFolder = {
		id: "__docs_root__",
		name: "Documents",
		path: "/",
		parentPath: null,
		createdAt: new Date(0),
		modifiedAt: new Date(0),
		childCount: items.length,
	};
	return {
		id: "__docs_root__",
		name: "Documents",
		path: "/",
		type: "folder",
		isExpanded: true,
		children: items,
		folder,
	};
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useDocumentLibrary() {
	const { t } = useTranslation("documents");
	const { convertToKnowledge } = useKnowledgeConversion();

	// ── State ───────────────────────────────────────────────────────────────
	const [tree, setTree] = useState<DocumentTreeNode[]>([]);
	const [workspaceTree, setWorkspaceTree] = useState<DocumentTreeNode[]>([]);
	const [selectedNode, setSelectedNode] = useState<DocumentTreeNode | null>(
		null,
	);
	const [selectedSection, setSelectedSection] = useState<
		"documents" | "workspace"
	>("documents");
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [viewMode, setViewMode] = useState<"grid" | "list">("list");
	const [searchQuery, setSearchQuery] = useState("");
	// Not state: nothing on the page draws it, so a tick must not redraw the page.
	const uploadProgressRef = useRef<Map<string, DocumentUploadProgress>>(
		new Map(),
	);
	const [topics, setTopics] = useState<Array<Topic & { fileCount: number }>>(
		[],
	);
	const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
	const [fileTopicMap, setFileTopicMap] = useState<Map<string, Topic[]>>(
		new Map(),
	);

	// ── Derived ─────────────────────────────────────────────────────────────
	const currentPath = selectedNode?.path ?? "/";
	const isFileSelected = selectedNode?.type === "file";
	const isFolderSelected = selectedNode?.type === "folder";
	const isWorkspaceSection = false;

	// ── Refs (for stable callbacks that read but don't capture state) ────────
	const selectedNodeRef = useRef(selectedNode);
	const treeRef = useRef(tree);
	const currentPathRef = useRef(currentPath);
	const fileTopicMapRef = useRef(fileTopicMap);
	const topicsRef = useRef(topics);
	const navigationRequestRef = useRef(0);

	useEffect(() => {
		selectedNodeRef.current = selectedNode;
	}, [selectedNode]);
	useEffect(() => {
		treeRef.current = tree;
	}, [tree]);
	useEffect(() => {
		currentPathRef.current = currentPath;
	}, [currentPath]);
	useEffect(() => {
		fileTopicMapRef.current = fileTopicMap;
	}, [fileTopicMap]);
	useEffect(() => {
		topicsRef.current = topics;
	}, [topics]);

	// ── Folder contents (memoized) ───────────────────────────────────────────
	const folderContents = useMemo((): DocumentLibraryItem[] => {
		if (!selectedNode || selectedNode.type !== "folder") return [];
		const items: DocumentLibraryItem[] = [];
		for (const child of selectedNode.children) {
			if (child.type === "folder" && child.folder) {
				items.push({ type: "folder", item: child.folder });
			} else if (child.type === "file" && child.file) {
				if (selectedTopicIds.length > 0 && !isWorkspaceSection) {
					const childTopics = fileTopicMap.get(child.file.path) ?? [];
					const childTopicIds = childTopics.map((t) => t.id);
					if (selectedTopicIds.some((tid) => childTopicIds.includes(tid))) {
						items.push({ type: "file", item: child.file });
					}
				} else {
					items.push({ type: "file", item: child.file });
				}
			}
		}
		return items;
	}, [selectedNode, selectedTopicIds, fileTopicMap]);

	// ── Data loaders (stable — only use setters + services) ─────────────────
	const loadTopics = useCallback(async () => {
		try {
			const [topicsData, fileTopicMapData] = await Promise.all([
				topicService.getTopicsWithContentCount(),
				topicService.getFileTopicMap(),
			]);
			// Unchanged reads keep the old objects: the list and every row that
			// shows topics would otherwise redraw for nothing.
			setTopics((previous) =>
				sameJson(previous, topicsData) ? previous : topicsData,
			);
			setFileTopicMap((previous) =>
				sameJson([...previous], [...fileTopicMapData])
					? previous
					: fileTopicMapData,
			);
		} catch (err) {
			logError("[DOCUMENT_LIBRARY] Failed to load topics:", err);
		}
	}, []);

	const loadTree = useCallback(async () => {
		try {
			const treeData = await documentFileSystemService.getTree(
				DOCUMENTS_SANDBOX_ROOT,
			);
			// Keep open folders open and already-read mapped folders read, rather
			// than collapsing the library every time anything on disk changes.
			const merged = mergeTreeState(treeRef.current, treeData);
			setTree(merged);
			// Re-select from the merged tree, not the raw one: the raw node for a
			// mapped folder has no children, so selecting it would empty the
			// content pane on every unrelated change.
			setSelectedNode((prev) => {
				if (!prev || prev.id === "__docs_root__")
					return prev?.children === merged ? prev : makeDocsRoot(merged);
				return (
					findNodeById(merged, prev.id) ??
					findNodeByPath(merged, prev.path) ??
					null
				);
			});
			return merged;
		} catch (err) {
			logError("Failed to load tree:", err);
			return [] as DocumentTreeNode[];
		}
	}, []);

	const loadWorkspaceTree = useCallback(async () => {
		setWorkspaceTree([]);
		return [] as DocumentTreeNode[];
	}, []);

	// ── Initialization ───────────────────────────────────────────────────────
	const initializeLibrary = useCallback(async () => {
		try {
			setLoading(true);
			await documentFileSystemService.initialize();
			documentFileSystemService.forceRefresh();
			await Promise.all([loadTree(), loadTopics()]);
			setError(null);
		} catch (err) {
			logError("Failed to initialize document library:", err);
			setError(t("library.initializationError"));
		} finally {
			setLoading(false);
		}
	}, [loadTree, loadTopics, t]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: the library is read once, when the page opens.
	useEffect(() => {
		initializeLibrary();
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		// A burst of changes is read once, after it settles, and never by two
		// reads at a time: each read walks the whole tree, and topics take a
		// database round trip.
		let timer: ReturnType<typeof setTimeout> | null = null;
		let firstChangeAt = 0;
		let reading = false;
		let again = false;
		let topicsChanged = false;
		let disposed = false;
		const reload = () => {
			timer = null;
			if (disposed) return;
			if (reading) {
				again = true;
				return;
			}
			reading = true;
			const withTopics = topicsChanged;
			topicsChanged = false;
			Promise.all([loadTree(), withTopics ? loadTopics() : null])
				.catch((err) => {
					logError(
						"[DOCUMENT_LIBRARY] Failed to reload after filesystem change:",
						err,
					);
				})
				.finally(() => {
					reading = false;
					if (!again) return;
					again = false;
					reload();
				});
		};
		const unsubscribe = documentFileSystemService.onFilesystemChanged(
			(change) => {
				// The editor's own save: redrawing would reset the editor.
				if (change?.quiet) return;
				if (changeAffectsTopics(change)) topicsChanged = true;
				const now = Date.now();
				if (timer === null) firstChangeAt = now;
				else if (now - firstChangeAt >= FILESYSTEM_RELOAD_MAX_DELAY_MS) return;
				else clearTimeout(timer);
				timer = setTimeout(reload, FILESYSTEM_RELOAD_DELAY_MS);
			},
		);
		return () => {
			disposed = true;
			if (timer) clearTimeout(timer);
			unsubscribe();
		};
	}, [loadTree, loadTopics]);

	// ── Node navigation (stable, [] deps) ───────────────────────────────────
	/**
	 * Fill in a folder whose contents were deferred.
	 *
	 * Mapped folders arrive without children so the library can draw before the
	 * OS has been walked, which means *any* path that shows a folder's contents
	 * has to be able to ask for them — opening it in the tree, and selecting it
	 * to list it on the right. Missing the second one made a mapped folder read
	 * as empty, which is worse than slow.
	 */
	const materializeFolder = useCallback(
		async (node: DocumentTreeNode): Promise<DocumentTreeNode> => {
			if (node.type !== "folder" || node.isLazy !== true) return node;

			setTree((prev) =>
				updateNodeByPath(prev, node.path, (current) => ({
					...current,
					isLoading: true,
				})),
			);
			try {
				const children = await documentFileSystemService.getFolderChildren(
					node.path,
				);
				const loaded: DocumentTreeNode = {
					...node,
					children,
					isLazy: false,
					isLoading: false,
					...(node.folder
						? { folder: { ...node.folder, childCount: children.length } }
						: {}),
				};
				setTree((prev) =>
					updateNodeByPath(prev, node.path, (current) => ({
						...current,
						children,
						isLazy: false,
						isLoading: false,
						...(current.folder
							? { folder: { ...current.folder, childCount: children.length } }
							: {}),
					})),
				);
				setSelectedNode((prev) =>
					prev && prev.path === node.path ? { ...prev, ...loaded } : prev,
				);
				return loaded;
			} catch (err) {
				logError("Failed to read a mapped folder:", err);
				// Left lazy on purpose: selecting or reopening it retries, rather
				// than leaving the folder looking permanently empty.
				setTree((prev) =>
					updateNodeByPath(prev, node.path, (current) => ({
						...current,
						isLoading: false,
					})),
				);
				return node;
			}
		},
		[],
	);

	const handleSelectNode = useCallback(
		(node: DocumentTreeNode | null) => {
			navigationRequestRef.current++;
			if (!node) {
				setSelectedNode(makeDocsRoot(treeRef.current));
				return;
			}
			setSelectedNode(node);
			void materializeFolder(node);
		},
		[materializeFolder],
	);

	const handleSelectDocNode = useCallback(
		(node: DocumentTreeNode) => {
			navigationRequestRef.current++;
			setSelectedSection("documents");
			setSelectedNode(node);
			void materializeFolder(node);
		},
		[materializeFolder],
	);

	/** Select the documents section, falling back to the first top-level node. */
	const handleSelectDocumentsSection = useCallback(() => {
		navigationRequestRef.current++;
		setSelectedSection("documents");
		const currentNode = selectedNodeRef.current;
		if (currentNode) {
			const matchingNode =
				findNodeById(treeRef.current, currentNode.id) ??
				findNodeByPath(treeRef.current, currentNode.path);
			if (matchingNode) {
				setSelectedNode(matchingNode);
				return;
			}
		}
		setSelectedNode(makeDocsRoot(treeRef.current));
	}, []);

	const handleSelectWorkspaceNode = useCallback((node: DocumentTreeNode) => {
		navigationRequestRef.current++;
		setSelectedNode(node);
	}, []);

	/** Select the workspace root (used by the sidebar label click). */
	const handleSelectWorkspaceSection = useCallback(() => {
		navigationRequestRef.current++;
		setSelectedSection("documents");
		setSelectedNode(makeDocsRoot(treeRef.current));
	}, []);

	/**
	 * Open or close a folder, reading its contents first if they were deferred.
	 *
	 * Mapped folders arrive without children so the library can draw immediately
	 * (see `DocumentFileSystem.getFolderChildren`). The row is marked loading and
	 * opened straight away rather than after the read, so opening a slow folder
	 * looks like a folder opening rather than like a click that did nothing.
	 */
	const handleToggleExpand = useCallback(
		(nodeToToggle: DocumentTreeNode) => {
			const opening =
				nodeToToggle.type === "folder" && !nodeToToggle.isExpanded;

			// Open straight away and fill in behind, so opening a slow folder looks
			// like a folder opening rather than like a click that did nothing.
			setTree((prev) =>
				updateNodeByPath(prev, nodeToToggle.path, (node) => ({
					...node,
					isExpanded: !node.isExpanded,
				})),
			);
			if (opening) void materializeFolder(nodeToToggle);
		},
		[materializeFolder],
	);

	const handleToggleExpandWorkspace = useCallback(
		(nodeToToggle: DocumentTreeNode) => {
			setWorkspaceTree((prev) => toggleNodeExpand(prev, nodeToToggle.id));
		},
		[],
	);

	/** Navigate to a node by id in the currently active tree. */
	const handleSelectNodeInActiveTree = useCallback((id: string) => {
		navigationRequestRef.current++;
		const activeTree = treeRef.current;
		const node = findNodeById(activeTree, id);
		if (node) {
			setSelectedNode(node);
			if (node.type === "folder") {
				setTree((prev) => expandNodePath(prev, node.path));
			}
		}
	}, []);

	/** Search and index results can point inside a mapped folder not yet in the tree. */
	const handleOpenDocumentByPath = useCallback(
		async (path: string) => {
			const request = ++navigationRequestRef.current;
			const normalizedPath = normalizeSandboxPath(path);
			try {
				const node =
					normalizedPath === "/"
						? makeDocsRoot(treeRef.current)
						: (findNodeByPath(treeRef.current, normalizedPath) ??
							(await documentFileSystemService.resolveNode(normalizedPath)));
				if (!node || request !== navigationRequestRef.current) return;
				// Reveal deferred ancestors so the selection also survives tree refreshes.
				let visibleTree = treeRef.current;
				for (const ancestorPath of folderLineage(
					parentFolder(normalizedPath) ?? "/",
				)) {
					if (request !== navigationRequestRef.current) return;
					const ancestor = findNodeByPath(visibleTree, ancestorPath);
					if (!ancestor?.isLazy) continue;
					const loaded = await materializeFolder(ancestor);
					visibleTree = updateNodeByPath(
						visibleTree,
						ancestorPath,
						() => loaded,
					);
				}
				if (request !== navigationRequestRef.current) return;
				setSelectedSection("documents");
				setTree((prev) => expandNodePath(prev, normalizedPath));
				setSelectedNode(node);
				void materializeFolder(node);
			} catch (err) {
				if (request !== navigationRequestRef.current) return;
				logError("Failed to open library item:", err);
				setError(t("library.openItemError"));
			}
		},
		[materializeFolder, t],
	);

	const handleOpenFolderByPath = useCallback(
		(path: string) => {
			void handleOpenDocumentByPath(path);
		},
		[handleOpenDocumentByPath],
	);

	/** Go to parent folder when closing a file viewer. */
	const handleCloseViewer = useCallback(() => {
		const path = currentPathRef.current;
		const parentPath = path.substring(0, path.lastIndexOf("/")) || "/";
		void handleOpenDocumentByPath(parentPath);
	}, [handleOpenDocumentByPath]);

	const handleSearchChange = useCallback(
		(query: string) => {
			setSearchQuery(query);
			const node = selectedNodeRef.current;
			if (node?.type !== "file") return;
			if (query.trim()) {
				void handleOpenDocumentByPath(parentFolder(node.path) ?? "/");
			} else {
				navigationRequestRef.current++;
			}
		},
		[handleOpenDocumentByPath],
	);

	// ── Upload ───────────────────────────────────────────────────────────────
	const updateProgress = useCallback(
		(
			id: string,
			progress: number,
			status: DocumentUploadProgress["status"],
			errorMsg?: string,
		) => {
			const next = new Map(uploadProgressRef.current);
			const item = next.get(id);
			if (item) next.set(id, { ...item, progress, status, error: errorMsg });
			uploadProgressRef.current = next;
		},
		[],
	);

	const handleUploadFiles = useCallback(
		async (files: FileList) => {
			const fileArray = Array.from(files);
			const newProgress = new Map<string, DocumentUploadProgress>();
			for (const file of fileArray) {
				const id = `${Date.now()}-${file.name}`;
				newProgress.set(id, { id, file, progress: 0, status: "pending" });
			}
			uploadProgressRef.current = newProgress;
			NiceModal.show(UploadProgressDialog, { uploadProgress: newProgress });

			const targetSandboxPath = toSandboxPath(currentPathRef.current);

			for (const file of fileArray) {
				const id = `${Date.now()}-${file.name}`;
				try {
					updateProgress(id, 10, "uploading");
					let metadata: DocumentFile["metadata"] | undefined;

					if (file.type === "application/pdf") {
						try {
							updateProgress(id, 30, "processing");
							const pdfContent = await readPDFFile(file);
							metadata = {
								title: pdfContent.title,
								author: pdfContent.author,
								subject: pdfContent.subject,
								pageCount: pdfContent.numPages,
							};
						} catch (err) {
							logError("Failed to extract PDF metadata:", err);
						}
					} else if (
						file.type === "application/vnd.ms-excel" ||
						file.type ===
							"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
						file.type === "application/vnd.ms-excel.sheet.macroEnabled.12"
					) {
						try {
							updateProgress(id, 30, "processing");
							const excelContent = await readExcelFile(file);
							metadata = {
								title: excelContent.title,
								sheetCount: excelContent.sheetCount,
								sheetNames: excelContent.sheetNames,
							};
						} catch (err) {
							logError("Failed to extract Excel metadata:", err);
						}
					}

					updateProgress(id, 70, "uploading");
					await documentFileSystemService.uploadFile(
						file,
						targetSandboxPath,
						metadata,
					);
					updateProgress(id, 100, "completed");
					logInfo(`Uploaded file: ${file.name}`);
				} catch (err) {
					logError(`Failed to upload file ${file.name}:`, err);
					updateProgress(id, 0, "error", String(err));
				}
			}

			await loadTree();
			setTimeout(() => {
				NiceModal.hide(UploadProgressDialog);
				uploadProgressRef.current = new Map();
			}, 2000);
		},
		[updateProgress, loadTree],
	);

	const triggerFileUpload = useCallback(() => {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.accept = UPLOAD_ACCEPT;
		input.onchange = (e) => {
			const files = (e.target as HTMLInputElement).files;
			if (files?.length) handleUploadFiles(files);
		};
		input.click();
	}, [handleUploadFiles]);

	// ── Create ───────────────────────────────────────────────────────────────
	const handleCreateFolder = useCallback(
		async (folderName: string) => {
			try {
				const node = selectedNodeRef.current;
				const targetPath = node?.type === "folder" ? node.path : "/";
				const logicalNew =
					targetPath === "/" ? `/${folderName}` : `${targetPath}/${folderName}`;
				await documentFileSystemService.mkdir(toSandboxPath(logicalNew));
				await loadTree();
			} catch (err) {
				logError("Failed to create folder:", err);
				setError(t("library.createFolderError"));
				throw err;
			}
		},
		[loadTree, t],
	);

	const handleCreateDocument = useCallback(async () => {
		try {
			const result = (await NiceModal.show(CreateDocumentDialog)) as {
				name: string;
				extension: string;
			} | null;
			if (!result) return;

			const node = selectedNodeRef.current;
			const targetPath = node?.type === "folder" ? node.path : "/";
			const fullFileName = `${result.name}${result.extension}`;
			const logicalNew =
				targetPath === "/"
					? `/${fullFileName}`
					: `${targetPath}/${fullFileName}`;

			// A spreadsheet, document, deck or board starts as its app starts
			// one: an empty file would not open.
			const app = hostedAppForPath(fullFileName);
			const content = app
				? await createHostedFile(fullFileName, loadHostedEngine)
				: "";
			const type = app ? "application/octet-stream" : "text/markdown";
			const file = new File(
				[new Blob([content as BlobPart], { type })],
				fullFileName,
				{ type },
			);
			await documentFileSystemService.uploadFile(
				file,
				toSandboxPath(targetPath),
			);
			const newTree = await loadTree();
			const newNode = findNodeByPath(newTree, logicalNew);
			if (newNode) setSelectedNode(newNode);
		} catch (err) {
			logError("Failed to create document:", err);
			setError(
				t("library.createDocumentError", {
					defaultValue: "Failed to create document",
				}),
			);
		}
	}, [loadTree, t]);

	// ── Delete / Rename ──────────────────────────────────────────────────────
	const handleDeleteItem = useCallback(
		async (item: DocumentLibraryItem) => {
			if (
				!confirm(
					item.type === "folder"
						? t("library.deleteConfirmFolder", { name: item.item.name })
						: t("library.deleteConfirm", { name: item.item.name }),
				)
			)
				return;

			try {
				const sp = toSandboxPath(item.item.path);
				if (item.type === "file") {
					await documentFileSystemService.deleteFile(sp);
				} else {
					await documentFileSystemService.deleteFolder(sp);
				}
				const newTree = await loadTree();
				if (selectedNodeRef.current?.id === item.item.id) {
					const curPath = currentPathRef.current;
					const parentPath =
						curPath.substring(0, curPath.lastIndexOf("/")) || "/";
					const parentNode = findNodeByPath(newTree, parentPath);
					setSelectedNode(
						parentNode ?? (newTree.length > 0 ? newTree[0] : null),
					);
				}
			} catch (err) {
				logError("Failed to delete item:", err);
				setError(t("library.deleteItemError"));
			}
		},
		[loadTree, t],
	);

	const handleRenameItem = useCallback(
		async (item: DocumentLibraryItem, newName: string) => {
			try {
				const newSandboxPath = await documentFileSystemService.rename(
					toSandboxPath(item.item.path),
					newName,
				);
				const newTree = await loadTree();
				if (selectedNodeRef.current?.id === item.item.id) {
					const updatedNode = findNodeByPath(newTree, newSandboxPath);
					if (updatedNode) setSelectedNode(updatedNode);
				}
				logInfo(`Renamed ${item.type}: ${item.item.name} -> ${newName}`);
			} catch (err) {
				logError("Failed to rename item:", err);
				setError(t("library.renameItemError"));
			}
		},
		[loadTree, t],
	);

	const handleDeleteSelectedFile = useCallback(async () => {
		const node = selectedNodeRef.current;
		if (!node || node.type !== "file") return;
		if (!confirm(t("library.deleteConfirm", { name: node.name }))) return;

		try {
			await documentFileSystemService.deleteFile(toSandboxPath(node.path));
			const newTree = await loadTree();
			const curPath = currentPathRef.current;
			const parentPath = curPath.substring(0, curPath.lastIndexOf("/")) || "/";
			const parentNode = findNodeByPath(newTree, parentPath);
			setSelectedNode(parentNode ?? (newTree.length > 0 ? newTree[0] : null));
		} catch (err) {
			logError("Failed to delete file:", err);
			setError(t("library.deleteFileError"));
		}
	}, [loadTree, t]);

	// ── Download ─────────────────────────────────────────────────────────────

	/** Download a documents-scope file by its logical path (used externally). */
	const handleDownloadFile = useCallback(
		async (fileId: string) => {
			try {
				const content = await documentFileSystemService.readFile(
					toDocumentsSandboxPath(fileId),
				);
				const node = await documentFileSystemService.resolveNode(fileId);
				const file = node?.file;
				if (!file) return;
				const blob = new Blob([content.slice()], { type: file.mimeType });
				const url = URL.createObjectURL(blob);
				const a = document.createElement("a");
				a.href = url;
				a.download = file.name;
				document.body.appendChild(a);
				a.click();
				document.body.removeChild(a);
				URL.revokeObjectURL(url);
			} catch (err) {
				logError("Failed to download file:", err);
				setError(t("library.downloadFileError"));
			}
		},
		[t],
	);

	const handleDownloadSelectedFile = useCallback(async () => {
		const node = selectedNodeRef.current;
		if (!node || node.type !== "file") return;
		try {
			const content = await documentFileSystemService.readFile(
				toSandboxPath(node.path),
			);
			const mimeType = node.file?.mimeType ?? "application/octet-stream";
			const blob = new Blob([content.slice()], { type: mimeType });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = node.name;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			URL.revokeObjectURL(url);
		} catch (err) {
			logError("Failed to download file:", err);
			setError(t("library.downloadFileError"));
		}
	}, [t]);

	/** A folder, with everything in it, as one .zip download. */
	const handleDownloadFolder = useCallback(
		async (folderPath: string) => {
			try {
				await downloadFolderAsZip(folderPath);
			} catch (err) {
				logError("Failed to download folder:", err);
				setError(t("library.downloadFolderError"));
			}
		},
		[t],
	);

	// ── Move ─────────────────────────────────────────────────────────────────
	const handleMove = useCallback(
		async (
			nodeId: string,
			targetFolderId: string,
			_nodeType: "file" | "folder",
		) => {
			try {
				await documentFileSystemService.move(
					toSandboxPath(nodeId),
					toSandboxPath(targetFolderId),
				);
				await loadTree();
			} catch (err) {
				logError("[DOCUMENT_LIBRARY] Failed to move item:", err);
				setError("Failed to move item");
			}
		},
		[loadTree],
	);

	// ── Topic handlers ────────────────────────────────────────────────────────
	const handleTopicFilterChange = useCallback((topicIds: string[]) => {
		setSelectedTopicIds(topicIds);
	}, []);

	const handleRemoveTopicFilter = useCallback((topicId: string) => {
		setSelectedTopicIds((prev) => prev.filter((id) => id !== topicId));
	}, []);

	const handleClearTopicFilters = useCallback(() => {
		setSelectedTopicIds([]);
	}, []);

	const handleToggleTopicFilter = useCallback((topicId: string) => {
		setSelectedTopicIds((prev) =>
			prev.includes(topicId)
				? prev.filter((id) => id !== topicId)
				: [...prev, topicId],
		);
	}, []);

	const handleManageFileTopic = useCallback(
		async (file: DocumentFile) => {
			const fileTopics = fileTopicMapRef.current.get(file.path) ?? [];
			const topicIds = await NiceModal.show(TopicSelectorDialog, {
				filePath: file.path,
				fileName: file.name,
				initialTopicIds: fileTopics.map((t) => t.id),
			});

			if (topicIds && Array.isArray(topicIds)) {
				const updatedTopics = topicsRef.current.filter((t) =>
					topicIds.includes(t.id),
				);
				const newMap = new Map(fileTopicMapRef.current);
				if (updatedTopics.length > 0) {
					newMap.set(file.path, updatedTopics);
				} else {
					newMap.delete(file.path);
				}
				setFileTopicMap(newMap);
				await loadTopics();
			}
		},
		[loadTopics],
	);

	const handleConvertToKnowledge = useCallback(
		async (file: DocumentFile) => {
			try {
				const currentFileTopics = fileTopicMapRef.current.get(file.path) ?? [];
				await convertToKnowledge(file, currentFileTopics, loadTopics);
			} catch (err) {
				logError("[DOCUMENT_LIBRARY] Failed to convert to knowledge:", err);
			}
		},
		[convertToKnowledge, loadTopics],
	);

	// ── Return ────────────────────────────────────────────────────────────────
	return {
		// State
		tree,
		workspaceTree,
		selectedNode,
		selectedSection,
		loading,
		error,
		viewMode,
		searchQuery,
		topics,
		selectedTopicIds,
		fileTopicMap,
		// Derived
		currentPath,
		isFileSelected,
		isFolderSelected,
		isWorkspaceSection,
		folderContents,
		// Setters (stable)
		setViewMode,
		setSearchQuery,
		handleSearchChange,
		// Handlers
		handleSelectNode,
		handleSelectDocNode,
		handleSelectDocumentsSection,
		handleSelectWorkspaceNode,
		handleSelectWorkspaceSection,
		handleToggleExpand,
		handleToggleExpandWorkspace,
		handleSelectNodeInActiveTree,
		handleOpenFolderByPath,
		handleOpenDocumentByPath,
		handleCloseViewer,
		handleUploadFiles,
		triggerFileUpload,
		handleCreateFolder,
		handleCreateDocument,
		handleDeleteItem,
		handleRenameItem,
		handleDeleteSelectedFile,
		handleDownloadFile,
		handleDownloadSelectedFile,
		handleDownloadFolder,
		handleMove,
		handleTopicFilterChange,
		handleRemoveTopicFilter,
		handleClearTopicFilters,
		handleToggleTopicFilter,
		handleManageFileTopic,
		handleConvertToKnowledge,
	};
}
