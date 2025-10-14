/**
 * Document Storage Service
 * High-performance, type-safe document management using ZenFS
 */

import fs from "@/utils/fs";
import { nanoid } from "nanoid";
import type {
	DocumentFile,
	DocumentFolder,
	DocumentLibraryItem,
	DocumentTreeNode,
	DocumentType,
	DocumentFilter,
	StorageStats,
	DOCUMENT_MIME_TYPES,
} from "@/types/document-library";
import { logError, logInfo } from "@/utils/logger";

const DOCUMENTS_ROOT = "/home/documents";
const METADATA_FILE = ".metadata.json";

/**
 * Document metadata stored alongside files
 */
interface StoredMetadata {
	files: Record<string, DocumentFile>;
	folders: Record<string, DocumentFolder>;
	version: number;
}

class DocumentStorageService {
	private static instance: DocumentStorageService;

	private metadata: StoredMetadata = {
		files: {},
		folders: {},
		version: 1,
	};
	private initialized = false;

	private constructor() {
		// Private constructor for singleton
	}

	static getInstance(): DocumentStorageService {
		if (!DocumentStorageService.instance) {
			DocumentStorageService.instance = new DocumentStorageService();
		}
		return DocumentStorageService.instance;
	}

	/**
	 * Initialize the document storage system
	 */
	async initialize(): Promise<void> {
		if (this.initialized) return;

		try {
			// Ensure documents root exists
			await this.ensureDirectory(DOCUMENTS_ROOT);

			// Load or create metadata
			await this.loadMetadata();

			this.initialized = true;
			logInfo("📚 Document storage initialized");
		} catch (error) {
			logError("Failed to initialize document storage:", error);
			throw error;
		}
	}

	/**
	 * Ensure a directory exists
	 */
	private async ensureDirectory(path: string): Promise<void> {
		try {
			await fs.promises.stat(path);
		} catch {
			await fs.promises.mkdir(path, { recursive: true });
		}
	}

	/**
	 * Load metadata from filesystem
	 */
	private async loadMetadata(): Promise<void> {
		const metadataPath = `${DOCUMENTS_ROOT}/${METADATA_FILE}`;
		try {
			const data = await fs.promises.readFile(metadataPath, "utf-8");
			this.metadata = JSON.parse(data);

			// Convert date strings back to Date objects
			Object.values(this.metadata.files).forEach((file) => {
				file.createdAt = new Date(file.createdAt);
				file.modifiedAt = new Date(file.modifiedAt);
			});
			Object.values(this.metadata.folders).forEach((folder) => {
				folder.createdAt = new Date(folder.createdAt);
				folder.modifiedAt = new Date(folder.modifiedAt);
			});
		} catch {
			// Initialize empty metadata
			this.metadata = {
				files: {},
				folders: {},
				version: 1,
			};
			await this.saveMetadata();
		}
	}

	/**
	 * Save metadata to filesystem
	 */
	private async saveMetadata(): Promise<void> {
		const metadataPath = `${DOCUMENTS_ROOT}/${METADATA_FILE}`;
		await fs.promises.writeFile(
			metadataPath,
			JSON.stringify(this.metadata, null, 2),
		);
	}

	/**
	 * Get document type from MIME type
	 */
	private getDocumentType(mimeType: string): DocumentType {
		if (mimeType.startsWith("application/pdf")) return "pdf";
		if (mimeType.startsWith("text/plain")) return "text";
		if (mimeType.includes("markdown")) return "markdown";
		if (mimeType.startsWith("image/")) return "image";
		return "other";
	}

	/**
	 * Normalize path (remove trailing slashes, handle relative paths)
	 */
	private normalizePath(path: string): string {
		return path.replace(/\/+$/, "") || "/";
	}

	/**
	 * Create a new folder
	 */
	async createFolder(
		name: string,
		parentPath: string = "/",
	): Promise<DocumentFolder> {
		await this.initialize();

		const normalizedParent = this.normalizePath(parentPath);
		const fullPath = `${DOCUMENTS_ROOT}${normalizedParent}/${name}`;

		try {
			await fs.promises.mkdir(fullPath, { recursive: true });

			const folder: DocumentFolder = {
				id: nanoid(),
				name,
				path: `${normalizedParent}/${name}`,
				parentPath: normalizedParent === "/" ? null : normalizedParent,
				createdAt: new Date(),
				modifiedAt: new Date(),
				childCount: 0,
			};

			this.metadata.folders[folder.id] = folder;
			await this.saveMetadata();

			logInfo(`📁 Created folder: ${folder.path}`);
			return folder;
		} catch (error) {
			logError(`Failed to create folder ${name}:`, error);
			throw error;
		}
	}

	/**
	 * Upload a document file
	 */
	async uploadFile(
		file: File,
		targetPath: string = "/",
		metadata?: DocumentFile["metadata"],
	): Promise<DocumentFile> {
		await this.initialize();

		const normalizedPath = this.normalizePath(targetPath);
		const fileName = file.name;
		const fullPath = `${DOCUMENTS_ROOT}${normalizedPath}/${fileName}`;

		try {
			// Read file as ArrayBuffer
			const arrayBuffer = await file.arrayBuffer();
			// Convert ArrayBuffer to Uint8Array for ZenFS
			const uint8Array = new Uint8Array(arrayBuffer);

			// Ensure target directory exists
			await this.ensureDirectory(`${DOCUMENTS_ROOT}${normalizedPath}`);

			// Write file to filesystem
			await fs.promises.writeFile(fullPath, uint8Array);

			// Create file metadata
			const docFile: DocumentFile = {
				id: nanoid(),
				name: fileName,
				path: `${normalizedPath}/${fileName}`,
				type: this.getDocumentType(file.type),
				mimeType: file.type,
				size: file.size,
				createdAt: new Date(),
				modifiedAt: new Date(),
				metadata: metadata || {},
			};

			this.metadata.files[docFile.id] = docFile;
			await this.saveMetadata();

			logInfo(`📄 Uploaded file: ${docFile.path} (${docFile.size} bytes)`);
			return docFile;
		} catch (error) {
			logError(`Failed to upload file ${fileName}:`, error);
			throw error;
		}
	}

	/**
	 * Get file content
	 */
	async getFileContent(fileId: string): Promise<Uint8Array> {
		await this.initialize();

		const file = this.metadata.files[fileId];
		if (!file) {
			throw new Error(`File not found: ${fileId}`);
		}

		const fullPath = `${DOCUMENTS_ROOT}${file.path}`;
		const buffer = await fs.promises.readFile(fullPath);
		return new Uint8Array(buffer);
	}

	/**
	 * List items in a directory
	 */
	async listItems(path: string = "/"): Promise<DocumentLibraryItem[]> {
		await this.initialize();

		const normalizedPath = this.normalizePath(path);
		const items: DocumentLibraryItem[] = [];

		// Add folders
		Object.values(this.metadata.folders)
			.filter(
				(folder) =>
					folder.parentPath ===
					(normalizedPath === "/" ? null : normalizedPath),
			)
			.forEach((folder) => {
				items.push({ type: "folder", item: folder });
			});

		// Add files
		Object.values(this.metadata.files)
			.filter((file) => {
				const fileDir =
					file.path.substring(0, file.path.lastIndexOf("/")) || "/";
				return fileDir === normalizedPath;
			})
			.forEach((file) => {
				items.push({ type: "file", item: file });
			});

		return items;
	}

	/**
	 * Build tree structure for navigation (includes both folders and files)
	 */
	async getTree(): Promise<DocumentTreeNode[]> {
		await this.initialize();

		const buildNode = (folder: DocumentFolder | null): DocumentTreeNode => {
			const path = folder?.path || "/";
			const name = folder?.name || "Documents";

			const children: DocumentTreeNode[] = [];

			// Add child folders first
			Object.values(this.metadata.folders)
				.filter((f) => f.parentPath === (folder?.path || null))
				.sort((a, b) => a.name.localeCompare(b.name))
				.forEach((childFolder) => {
					children.push(buildNode(childFolder));
				});

			// Add files in this folder
			Object.values(this.metadata.files)
				.filter((file) => {
					const fileDir =
						file.path.substring(0, file.path.lastIndexOf("/")) || "/";
					return fileDir === path;
				})
				.sort((a, b) => a.name.localeCompare(b.name))
				.forEach((file) => {
					children.push({
						id: file.id,
						name: file.name,
						path: file.path,
						type: "file",
						isExpanded: false,
						children: [],
						file,
					});
				});

			return {
				id: folder?.id || "root",
				name,
				path,
				type: "folder",
				isExpanded: path === "/", // Root expanded by default
				children,
				folder: folder || undefined,
			};
		};

		return [buildNode(null)];
	}

	/**
	 * Search files with filters
	 */
	async searchFiles(filter: DocumentFilter): Promise<DocumentFile[]> {
		await this.initialize();

		let files = Object.values(this.metadata.files);

		// Filter by type
		if (filter.types && filter.types.length > 0) {
			files = files.filter((file) => filter.types!.includes(file.type));
		}

		// Filter by search query
		if (filter.searchQuery) {
			const query = filter.searchQuery.toLowerCase();
			files = files.filter(
				(file) =>
					file.name.toLowerCase().includes(query) ||
					file.metadata?.title?.toLowerCase().includes(query) ||
					file.metadata?.description?.toLowerCase().includes(query),
			);
		}

		// Filter by date range
		if (filter.dateFrom) {
			files = files.filter((file) => file.createdAt >= filter.dateFrom!);
		}
		if (filter.dateTo) {
			files = files.filter((file) => file.createdAt <= filter.dateTo!);
		}

		// Sort
		const sortBy = filter.sortBy || "date";
		const sortOrder = filter.sortOrder || "desc";

		files.sort((a, b) => {
			let comparison = 0;
			switch (sortBy) {
				case "name":
					comparison = a.name.localeCompare(b.name);
					break;
				case "size":
					comparison = a.size - b.size;
					break;
				case "type":
					comparison = a.type.localeCompare(b.type);
					break;
				case "date":
				default:
					comparison = a.createdAt.getTime() - b.createdAt.getTime();
			}
			return sortOrder === "asc" ? comparison : -comparison;
		});

		return files;
	}

	/**
	 * Delete a file
	 */
	async deleteFile(fileId: string): Promise<void> {
		await this.initialize();

		const file = this.metadata.files[fileId];
		if (!file) {
			throw new Error(`File not found: ${fileId}`);
		}

		const fullPath = `${DOCUMENTS_ROOT}${file.path}`;

		try {
			await fs.promises.unlink(fullPath);
			delete this.metadata.files[fileId];
			await this.saveMetadata();

			logInfo(`🗑️ Deleted file: ${file.path}`);
		} catch (error) {
			logError(`Failed to delete file ${file.name}:`, error);
			throw error;
		}
	}

	/**
	 * Delete a folder (recursive)
	 */
	async deleteFolder(folderId: string): Promise<void> {
		await this.initialize();

		const folder = this.metadata.folders[folderId];
		if (!folder) {
			throw new Error(`Folder not found: ${folderId}`);
		}

		const fullPath = `${DOCUMENTS_ROOT}${folder.path}`;

		try {
			// Delete all files in this folder
			const filesToDelete = Object.entries(this.metadata.files)
				.filter(([_, file]) => file.path.startsWith(folder.path + "/"))
				.map(([fileId]) => fileId);

			for (const fileId of filesToDelete) {
				const file = this.metadata.files[fileId];
				const filePath = `${DOCUMENTS_ROOT}${file.path}`;
				try {
					await fs.promises.unlink(filePath);
				} catch (err) {
					// File might not exist, continue
				}
				delete this.metadata.files[fileId];
			}

			// Delete all subfolders recursively
			const foldersToDelete = Object.entries(this.metadata.folders)
				.filter(([_, f]) => f.path.startsWith(folder.path + "/"))
				.map(([fId]) => fId);

			for (const fId of foldersToDelete) {
				const subFolder = this.metadata.folders[fId];
				const subFolderPath = `${DOCUMENTS_ROOT}${subFolder.path}`;
				try {
					await fs.promises.rmdir(subFolderPath);
				} catch (err) {
					// Folder might not exist, continue
				}
				delete this.metadata.folders[fId];
			}

			// Delete the folder itself
			try {
				await fs.promises.rmdir(fullPath);
			} catch (err) {
				// Folder might not exist or not be empty, continue
			}

			delete this.metadata.folders[folderId];
			await this.saveMetadata();

			logInfo(`🗑️ Deleted folder: ${folder.path}`);
		} catch (error) {
			logError(`Failed to delete folder ${folder.name}:`, error);
			throw error;
		}
	}

	/**
	 * Get storage statistics
	 */
	async getStats(): Promise<StorageStats> {
		await this.initialize();

		const files = Object.values(this.metadata.files);
		const totalSize = files.reduce((sum, file) => sum + file.size, 0);

		const filesByType: Record<string, number> = {};
		files.forEach((file) => {
			filesByType[file.type] = (filesByType[file.type] || 0) + 1;
		});

		return {
			totalFiles: files.length,
			totalFolders: Object.keys(this.metadata.folders).length,
			totalSize,
			usedSpace: totalSize,
			availableSpace: Number.MAX_SAFE_INTEGER, // IndexedDB doesn't have a fixed limit
			filesByType: filesByType as any,
		};
	}

	/**
	 * Update file metadata
	 */
	async updateFileMetadata(
		fileId: string,
		metadata: Partial<DocumentFile["metadata"]>,
	): Promise<DocumentFile> {
		await this.initialize();

		const file = this.metadata.files[fileId];
		if (!file) {
			throw new Error(`File not found: ${fileId}`);
		}

		file.metadata = {
			...file.metadata,
			...metadata,
		};
		file.modifiedAt = new Date();

		await this.saveMetadata();

		logInfo(`📝 Updated metadata for: ${file.path}`);
		return file;
	}
}

export const documentStorageService = DocumentStorageService.getInstance();
