import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import NiceModal from "@ebay/nice-modal-react";
import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
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
} from "../utils/tree-utils";

// ── Module-level helpers ──────────────────────────────────────────────────────

// toSandboxPath is imported from @/services/filesystem/sandbox-paths

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
	const [uploadProgress, setUploadProgress] = useState<
		Map<string, DocumentUploadProgress>
	>(new Map());
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
	}, [selectedNode, selectedTopicIds, fileTopicMap, isWorkspaceSection]);

	// ── Data loaders (stable — only use setters + services) ─────────────────
	const loadTopics = useCallback(async () => {
		try {
			const [topicsData, fileTopicMapData] = await Promise.all([
				topicService.getTopicsWithContentCount(),
				topicService.getFileTopicMap(),
			]);
			setTopics(topicsData);
			setFileTopicMap(fileTopicMapData);
		} catch (err) {
			logError("[DOCUMENT_LIBRARY] Failed to load topics:", err);
		}
	}, []);

	const loadTree = useCallback(async () => {
		try {
			const treeData = await documentFileSystemService.getTree(
				DOCUMENTS_SANDBOX_ROOT,
			);
			setTree(treeData);
			setSelectedNode((prev) => {
				if (!prev || prev.id === "__docs_root__") return makeDocsRoot(treeData);
				return (
					findNodeById(treeData, prev.id) ??
					findNodeByPath(treeData, prev.path) ??
					null
				);
			});
			return treeData;
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

	useEffect(() => {
		initializeLibrary();
	}, []); // eslint-disable-line react-hooks/exhaustive-deps

	useEffect(() => {
		return documentFileSystemService.onFilesystemChanged(() => {
			Promise.all([loadTree(), loadTopics()]).catch((err) => {
				logError(
					"[DOCUMENT_LIBRARY] Failed to reload after filesystem change:",
					err,
				);
			});
		});
	}, [loadTree, loadTopics]);

	// ── Node navigation (stable, [] deps) ───────────────────────────────────
	const handleSelectNode = useCallback((node: DocumentTreeNode | null) => {
		if (!node) {
			setSelectedNode(makeDocsRoot(treeRef.current));
			return;
		}
		setSelectedNode(node);
	}, []);

	const handleSelectDocNode = useCallback((node: DocumentTreeNode) => {
		setSelectedSection("documents");
		setSelectedNode(node);
	}, []);

	/** Select the documents section, falling back to the first top-level node. */
	const handleSelectDocumentsSection = useCallback(() => {
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
		setSelectedNode(node);
	}, []);

	/** Select the workspace root (used by the sidebar label click). */
	const handleSelectWorkspaceSection = useCallback(() => {
		setSelectedSection("documents");
		setSelectedNode(makeDocsRoot(treeRef.current));
	}, []);

	const handleToggleExpand = useCallback((nodeToToggle: DocumentTreeNode) => {
		setTree((prev) => toggleNodeExpand(prev, nodeToToggle.id));
	}, []);

	const handleToggleExpandWorkspace = useCallback(
		(nodeToToggle: DocumentTreeNode) => {
			setWorkspaceTree((prev) => toggleNodeExpand(prev, nodeToToggle.id));
		},
		[],
	);

	/** Navigate to a node by id in the currently active tree. */
	const handleSelectNodeInActiveTree = useCallback((id: string) => {
		const activeTree = treeRef.current;
		const node = findNodeById(activeTree, id);
		if (node) {
			setSelectedNode(node);
			if (node.type === "folder") {
				setTree((prev) => expandNodePath(prev, node.path));
			}
		}
	}, []);

	/** Navigate to a folder by path in the currently active tree. */
	const handleOpenFolderByPath = useCallback((path: string) => {
		const activeTree = treeRef.current;
		const node = findNodeByPath(activeTree, path);
		if (node) {
			setSelectedNode(node);
			setTree((prev) => expandNodePath(prev, path));
		}
	}, []);

	const handleOpenDocumentByPath = useCallback((path: string) => {
		const normalizedPath = normalizeSandboxPath(path);
		setSelectedSection("documents");
		const node = findNodeByPath(treeRef.current, normalizedPath);
		if (node) {
			setTree((prev) => expandNodePath(prev, normalizedPath));
			setSelectedNode(node);
		}
	}, []);

	/** Go to parent folder when closing a file viewer. */
	const handleCloseViewer = useCallback(() => {
		const path = currentPathRef.current;
		const parentPath = path.substring(0, path.lastIndexOf("/")) || "/";
		const parentNode = findNodeByPath(treeRef.current, parentPath);
		setSelectedNode(parentNode ?? null);
	}, []);

	// ── Upload ───────────────────────────────────────────────────────────────
	const updateProgress = useCallback(
		(
			id: string,
			progress: number,
			status: DocumentUploadProgress["status"],
			errorMsg?: string,
		) => {
			setUploadProgress((prev) => {
				const next = new Map(prev);
				const item = next.get(id);
				if (item) next.set(id, { ...item, progress, status, error: errorMsg });
				return next;
			});
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
			setUploadProgress(newProgress);
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
				setUploadProgress(new Map());
			}, 2000);
		},
		[updateProgress, loadTree],
	);

	const triggerFileUpload = useCallback(() => {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.accept = ".pdf,.txt,.md,.png,.jpg,.jpeg,.gif,.webp,.xls,.xlsx,.xlsm";
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

			const file = new File(
				[new Blob([""], { type: "text/markdown" })],
				fullFileName,
				{ type: "text/markdown" },
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
				const findFile = (nodes: DocumentTreeNode[]): DocumentFile | null => {
					for (const node of nodes) {
						if (node.type === "file" && node.id === fileId && node.file)
							return node.file;
						if (node.children) {
							const found = findFile(node.children);
							if (found) return found;
						}
					}
					return null;
				};
				const file = findFile(treeRef.current);
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
		handleMove,
		handleTopicFilterChange,
		handleRemoveTopicFilter,
		handleClearTopicFilters,
		handleToggleTopicFilter,
		handleManageFileTopic,
		handleConvertToKnowledge,
	};
}
