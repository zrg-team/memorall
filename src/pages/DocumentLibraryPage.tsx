/**
 * Document Library Page
 * Main page for document management with file system interface
 */

import React, { useState, useEffect, useCallback } from "react";
import {
	Upload,
	FolderPlus,
	Grid3x3,
	List,
	Search,
	Loader2,
	AlertCircle,
	Home,
	ChevronRight,
	Folder,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { documentStorageService } from "@/modules/documents/services/document-storage";
import { DocumentTree } from "@/modules/documents/DocumentTree";
import { DocumentList } from "@/modules/documents/DocumentList";
import { DocumentViewer } from "@/modules/documents/DocumentViewer";
import type {
	DocumentLibraryItem,
	DocumentTreeNode,
	DocumentUploadProgress,
	DocumentFile,
} from "@/types/document-library";
import { logError, logInfo } from "@/utils/logger";
import { readPDFFile } from "@/embedded/pdf-extraction";

export const DocumentLibraryPage: React.FC = () => {
	// State
	const [tree, setTree] = useState<DocumentTreeNode[]>([]);
	const [selectedNode, setSelectedNode] = useState<DocumentTreeNode | null>(
		null,
	);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [viewMode, setViewMode] = useState<"grid" | "list">("list");
	const [searchQuery, setSearchQuery] = useState("");

	// Derived state
	const currentPath = selectedNode?.path || "/";
	const isFileSelected = selectedNode?.type === "file";
	const isFolderSelected = selectedNode?.type === "folder";

	// Upload state
	const [showUploadDialog, setShowUploadDialog] = useState(false);
	const [uploadProgress, setUploadProgress] = useState<
		Map<string, DocumentUploadProgress>
	>(new Map());

	// Folder creation state
	const [showCreateFolderDialog, setShowCreateFolderDialog] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");
	const [creatingFolder, setCreatingFolder] = useState(false);

	// Initialize
	useEffect(() => {
		initializeLibrary();
	}, []);

	const initializeLibrary = async () => {
		try {
			setLoading(true);
			await documentStorageService.initialize();
			await loadTree();
			setError(null);
		} catch (err) {
			logError("Failed to initialize document library:", err);
			setError("Failed to initialize document library");
		} finally {
			setLoading(false);
		}
	};

	const loadTree = async () => {
		try {
			const treeData = await documentStorageService.getTree();
			setTree(treeData);
			// Select root by default if nothing selected
			if (!selectedNode && treeData.length > 0) {
				setSelectedNode(treeData[0]);
			}
		} catch (err) {
			logError("Failed to load tree:", err);
		}
	};

	/**
	 * Handle node selection in tree
	 * - If folder selected: show its contents in grid/list
	 * - If file selected: show file viewer
	 */
	const handleSelectNode = (node: DocumentTreeNode) => {
		setSelectedNode(node);
	};

	/**
	 * Toggle folder expansion in tree
	 */
	const handleToggleExpand = (nodeToToggle: DocumentTreeNode) => {
		const toggleNode = (nodes: DocumentTreeNode[]): DocumentTreeNode[] => {
			return nodes.map((node) => {
				if (node.id === nodeToToggle.id) {
					return { ...node, isExpanded: !node.isExpanded };
				}
				if (node.children && node.children.length > 0) {
					return { ...node, children: toggleNode(node.children) };
				}
				return node;
			});
		};

		setTree((prevTree) => toggleNode(prevTree));
	};

	/**
	 * Get folder contents for display in main area
	 */
	const getFolderContents = (): DocumentLibraryItem[] => {
		if (!selectedNode || selectedNode.type !== "folder") return [];

		const items: DocumentLibraryItem[] = [];

		// Get children from the selected node
		selectedNode.children.forEach((child) => {
			if (child.type === "folder" && child.folder) {
				items.push({ type: "folder", item: child.folder });
			} else if (child.type === "file" && child.file) {
				items.push({ type: "file", item: child.file });
			}
		});

		return items;
	};

	const handleUploadFiles = async (files: FileList) => {
		const fileArray = Array.from(files);
		const newProgress = new Map(uploadProgress);

		for (const file of fileArray) {
			const id = `${Date.now()}-${file.name}`;
			newProgress.set(id, {
				id,
				file,
				progress: 0,
				status: "pending",
			});
		}

		setUploadProgress(newProgress);
		setShowUploadDialog(true);

		for (const file of fileArray) {
			const id = `${Date.now()}-${file.name}`;

			try {
				// Update progress
				updateProgress(id, 10, "uploading");

				// Extract PDF metadata if it's a PDF
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
				}

				updateProgress(id, 70, "uploading");

				// Upload file
				await documentStorageService.uploadFile(file, currentPath, metadata);

				updateProgress(id, 100, "completed");

				logInfo(`Uploaded file: ${file.name}`);
			} catch (err) {
				logError(`Failed to upload file ${file.name}:`, err);
				updateProgress(id, 0, "error", String(err));
			}
		}

		// Reload tree
		await loadTree();

		// Close dialog after a delay
		setTimeout(() => {
			setShowUploadDialog(false);
			setUploadProgress(new Map());
		}, 2000);
	};

	const updateProgress = (
		id: string,
		progress: number,
		status: DocumentUploadProgress["status"],
		error?: string,
	) => {
		setUploadProgress((prev) => {
			const newMap = new Map(prev);
			const item = newMap.get(id);
			if (item) {
				newMap.set(id, { ...item, progress, status, error });
			}
			return newMap;
		});
	};

	const handleCreateFolder = async () => {
		if (!newFolderName.trim()) return;

		setCreatingFolder(true);
		try {
			// Get the current folder path for creating subfolder
			const targetPath =
				selectedNode?.type === "folder" ? selectedNode.path : "/";
			await documentStorageService.createFolder(newFolderName, targetPath);
			await loadTree();
			setShowCreateFolderDialog(false);
			setNewFolderName("");
		} catch (err) {
			logError("Failed to create folder:", err);
			setError("Failed to create folder");
		} finally {
			setCreatingFolder(false);
		}
	};

	const handleDeleteItem = async (item: DocumentLibraryItem) => {
		if (
			!confirm(
				`Are you sure you want to delete "${item.item.name}"?${item.type === "folder" ? " All contents will be deleted." : ""}`,
			)
		) {
			return;
		}

		try {
			if (item.type === "file") {
				await documentStorageService.deleteFile(item.item.id);
			} else {
				await documentStorageService.deleteFolder(item.item.id);
			}

			await loadTree();

			// Clear selection if deleted item was selected
			if (selectedNode?.id === item.item.id) {
				setSelectedNode(tree[0]); // Go back to root
			}
		} catch (err) {
			logError("Failed to delete item:", err);
			setError("Failed to delete item");
		}
	};

	const handleDeleteSelectedFile = async () => {
		if (!selectedNode || selectedNode.type !== "file") return;

		if (!confirm(`Are you sure you want to delete "${selectedNode.name}"?`)) {
			return;
		}

		try {
			await documentStorageService.deleteFile(selectedNode.id);
			await loadTree();
			setSelectedNode(tree[0]); // Go back to root
		} catch (err) {
			logError("Failed to delete file:", err);
			setError("Failed to delete file");
		}
	};

	const handleDownloadFile = async (fileId: string) => {
		try {
			const content = await documentStorageService.getFileContent(fileId);

			// Find file in tree
			const findFile = (nodes: DocumentTreeNode[]): DocumentFile | null => {
				for (const node of nodes) {
					if (node.type === "file" && node.id === fileId && node.file) {
						return node.file;
					}
					if (node.children) {
						const found = findFile(node.children);
						if (found) return found;
					}
				}
				return null;
			};

			const file = findFile(tree);
			if (!file) return;

			// Convert Uint8Array to ArrayBuffer for Blob
			const arrayBuffer =
				content.buffer instanceof ArrayBuffer
					? content.buffer
					: new ArrayBuffer(content.byteLength);
			const blob = new Blob([arrayBuffer], { type: file.mimeType });
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
			setError("Failed to download file");
		}
	};

	const handleDownloadSelectedFile = async () => {
		if (selectedNode?.type === "file") {
			await handleDownloadFile(selectedNode.id);
		}
	};

	const triggerFileUpload = () => {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = true;
		input.accept = ".pdf,.txt,.md,.png,.jpg,.jpeg,.gif,.webp";
		input.onchange = (e) => {
			const files = (e.target as HTMLInputElement).files;
			if (files && files.length > 0) {
				handleUploadFiles(files);
			}
		};
		input.click();
	};

	// Breadcrumb navigation
	const pathSegments = currentPath.split("/").filter(Boolean);

	// Get folder contents for main area display
	const folderContents = getFolderContents();

	if (loading) {
		return (
			<div className="flex items-center justify-center h-full">
				<Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
			</div>
		);
	}

	return (
		<div className="flex flex-col h-full overflow-hidden bg-background">
			{/* Header */}
			<div className="border-b bg-card">
				{/* Top Row: Breadcrumb + Actions */}
				<div className="flex items-center justify-between gap-2 px-2 md:px-3 py-2 border-b">
					{/* Breadcrumb - More compact on small screens */}
					<div className="flex items-center gap-1 text-xs md:text-sm text-muted-foreground min-w-0 flex-1 overflow-hidden">
						<button
							onClick={() => {
								// Find root node and select it
								if (tree.length > 0) {
									handleSelectNode(tree[0]);
								}
							}}
							className="flex items-center gap-1 hover:text-foreground transition-colors flex-shrink-0"
							title="Documents"
						>
							<Home className="h-3.5 w-3.5 md:h-4 md:w-4" />
						</button>
						{pathSegments.length > 0 && (
							<>
								<ChevronRight className="h-3 w-3 md:h-3.5 md:w-3.5 flex-shrink-0" />
								{/* Show only last 2 segments on small screens */}
								{pathSegments.slice(-2).map((segment, index) => {
									const actualIndex = pathSegments.length - 2 + index;
									const path =
										"/" + pathSegments.slice(0, actualIndex + 1).join("/");
									const isLast = actualIndex === pathSegments.length - 1;
									return (
										<React.Fragment key={path}>
											<button
												onClick={() => {
													// Find node by path and select it
													const findNodeByPath = (
														nodes: DocumentTreeNode[],
														targetPath: string,
													): DocumentTreeNode | null => {
														for (const node of nodes) {
															if (node.path === targetPath) return node;
															if (node.children) {
																const found = findNodeByPath(
																	node.children,
																	targetPath,
																);
																if (found) return found;
															}
														}
														return null;
													};

													const node = findNodeByPath(tree, path);
													if (node) handleSelectNode(node);
												}}
												className={`hover:text-foreground transition-colors truncate max-w-[120px] ${
													isLast ? "font-medium text-foreground" : ""
												}`}
												title={segment}
											>
												{segment}
											</button>
											{!isLast && (
												<ChevronRight className="h-3 w-3 md:h-3.5 md:w-3.5 flex-shrink-0" />
											)}
										</React.Fragment>
									);
								})}
							</>
						)}
					</div>

					{/* Actions - Icon-only on small screens */}
					<div className="flex items-center gap-1 flex-shrink-0">
						<Button
							variant="outline"
							size="sm"
							onClick={() => setShowCreateFolderDialog(true)}
							className="h-8 px-2"
							title="New Folder"
						>
							<FolderPlus className="h-4 w-4" />
							<span className="hidden lg:inline ml-2">New Folder</span>
						</Button>
						<Button
							size="sm"
							onClick={triggerFileUpload}
							className="h-8 px-2"
							title="Upload Files"
						>
							<Upload className="h-4 w-4" />
							<span className="hidden lg:inline ml-2">Upload</span>
						</Button>
					</div>
				</div>

				{/* Bottom Row: Search and View Controls */}
				<div className="flex items-center gap-2 px-2 md:px-3 py-2">
					<div className="relative flex-1 min-w-0">
						<Search className="absolute left-2 md:left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 md:h-4 md:w-4 text-muted-foreground" />
						<Input
							placeholder="Search..."
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							className="pl-8 md:pl-10 h-8 md:h-9 text-sm"
						/>
					</div>
					<div className="flex items-center gap-0.5 border rounded-md p-0.5 flex-shrink-0">
						<Button
							variant={viewMode === "list" ? "secondary" : "ghost"}
							size="sm"
							onClick={() => setViewMode("list")}
							className="h-6 w-6 md:h-7 md:w-7 p-0"
							title="List view"
						>
							<List className="h-3.5 w-3.5 md:h-4 md:w-4" />
						</Button>
						<Button
							variant={viewMode === "grid" ? "secondary" : "ghost"}
							size="sm"
							onClick={() => setViewMode("grid")}
							className="h-6 w-6 md:h-7 md:w-7 p-0"
							title="Grid view"
						>
							<Grid3x3 className="h-3.5 w-3.5 md:h-4 md:w-4" />
						</Button>
					</div>
				</div>

				{error && (
					<div className="px-3 pb-2">
						<Alert variant="destructive">
							<AlertCircle className="h-4 w-4" />
							<AlertDescription>{error}</AlertDescription>
						</Alert>
					</div>
				)}
			</div>

			{/* Main Content - Windows Explorer Style */}
			<div className="flex-1 flex overflow-hidden">
				{/* Left Panel: Tree Navigation (shows files and folders) - Hidden on small screens */}
				<div className="hidden md:block md:w-48 lg:w-64 border-r bg-card overflow-hidden flex-shrink-0">
					<DocumentTree
						tree={tree}
						selectedId={selectedNode?.id || null}
						onSelectNode={handleSelectNode}
						onToggleExpand={handleToggleExpand}
					/>
				</div>

				{/* Right Panel: Content or Viewer */}
				<div className="flex-1 overflow-hidden min-w-0">
					{isFolderSelected ? (
						/* Show folder contents in grid/list */
						<DocumentList
							items={folderContents}
							selectedItem={null}
							onSelectItem={(item) => {
								// When clicking an item in the list, find it in tree and select it
								const findNodeById = (
									nodes: DocumentTreeNode[],
									id: string,
								): DocumentTreeNode | null => {
									for (const node of nodes) {
										if (node.id === id) return node;
										if (node.children) {
											const found = findNodeById(node.children, id);
											if (found) return found;
										}
									}
									return null;
								};

								const node = findNodeById(tree, item.item.id);
								if (node) handleSelectNode(node);
							}}
							onOpenFolder={(path) => {
								// Find folder node and select it
								const findNodeByPath = (
									nodes: DocumentTreeNode[],
									targetPath: string,
								): DocumentTreeNode | null => {
									for (const node of nodes) {
										if (node.path === targetPath) return node;
										if (node.children) {
											const found = findNodeByPath(node.children, targetPath);
											if (found) return found;
										}
									}
									return null;
								};

								const node = findNodeByPath(tree, path);
								if (node) handleSelectNode(node);
							}}
							onDeleteItem={handleDeleteItem}
							onDownloadFile={handleDownloadFile}
							viewMode={viewMode}
						/>
					) : isFileSelected && selectedNode.file ? (
						/* Show file viewer */
						<DocumentViewer
							file={selectedNode.file}
							onClose={() => {
								// Go back to parent folder
								const parentPath =
									currentPath.substring(0, currentPath.lastIndexOf("/")) || "/";
								const findNodeByPath = (
									nodes: DocumentTreeNode[],
									targetPath: string,
								): DocumentTreeNode | null => {
									for (const node of nodes) {
										if (node.path === targetPath) return node;
										if (node.children) {
											const found = findNodeByPath(node.children, targetPath);
											if (found) return found;
										}
									}
									return null;
								};

								const parentNode = findNodeByPath(tree, parentPath);
								if (parentNode) handleSelectNode(parentNode);
							}}
							onDelete={handleDeleteSelectedFile}
							onDownload={handleDownloadSelectedFile}
						/>
					) : (
						/* Empty state */
						<div className="flex items-center justify-center h-full text-muted-foreground">
							<div className="text-center">
								<Folder className="h-12 w-12 mx-auto mb-4 opacity-50" />
								<p className="text-sm">Select a folder or file to view</p>
							</div>
						</div>
					)}
				</div>
			</div>

			{/* Upload Progress Dialog */}
			<Dialog open={showUploadDialog} onOpenChange={setShowUploadDialog}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Uploading Files</DialogTitle>
						<DialogDescription>
							Please wait while your files are being uploaded
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-3">
						{Array.from(uploadProgress.values()).map((progress) => (
							<div key={progress.id} className="space-y-2">
								<div className="flex items-center justify-between text-sm">
									<span className="truncate flex-1">{progress.file.name}</span>
									<span className="text-muted-foreground ml-2">
										{progress.progress}%
									</span>
								</div>
								<Progress value={progress.progress} />
								{progress.error && (
									<p className="text-xs text-destructive">{progress.error}</p>
								)}
							</div>
						))}
					</div>
				</DialogContent>
			</Dialog>

			{/* Create Folder Dialog */}
			<Dialog
				open={showCreateFolderDialog}
				onOpenChange={setShowCreateFolderDialog}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Create New Folder</DialogTitle>
						<DialogDescription>
							Enter a name for the new folder
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="folder-name">Folder Name</Label>
							<Input
								id="folder-name"
								value={newFolderName}
								onChange={(e) => setNewFolderName(e.target.value)}
								placeholder="My Folder"
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										handleCreateFolder();
									}
								}}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								setShowCreateFolderDialog(false);
								setNewFolderName("");
							}}
						>
							Cancel
						</Button>
						<Button onClick={handleCreateFolder} disabled={creatingFolder}>
							{creatingFolder && (
								<Loader2 className="h-4 w-4 mr-2 animate-spin" />
							)}
							Create
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
};
