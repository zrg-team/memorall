/**
 * Document Library Types
 * Type-safe definitions for extensible document management system
 */

/**
 * Supported document types (extensible for future)
 */
export type DocumentType = "pdf" | "text" | "markdown" | "image" | "other";

/**
 * Document MIME type mapping
 */
export const DOCUMENT_MIME_TYPES: Record<DocumentType, string[]> = {
	pdf: ["application/pdf"],
	text: ["text/plain"],
	markdown: ["text/markdown", "text/x-markdown"],
	image: ["image/jpeg", "image/png", "image/gif", "image/webp"],
	other: ["*/*"],
};

/**
 * File metadata interface
 */
export interface DocumentFile {
	id: string;
	name: string;
	path: string;
	type: DocumentType;
	mimeType: string;
	size: number;
	createdAt: Date;
	modifiedAt: Date;
	metadata?: {
		// PDF specific
		title?: string;
		author?: string;
		subject?: string;
		pageCount?: number;
		// Image specific
		width?: number;
		height?: number;
		// General
		description?: string;
		tags?: string[];
	};
}

/**
 * Folder metadata interface
 */
export interface DocumentFolder {
	id: string;
	name: string;
	path: string;
	parentPath: string | null;
	createdAt: Date;
	modifiedAt: Date;
	childCount: number;
}

/**
 * Union type for items in the library
 */
export type DocumentLibraryItem =
	| { type: "file"; item: DocumentFile }
	| { type: "folder"; item: DocumentFolder };

/**
 * Tree node for navigation
 */
export interface DocumentTreeNode {
	id: string;
	name: string;
	path: string;
	type: "file" | "folder";
	isExpanded: boolean;
	children: DocumentTreeNode[];
	// Reference to actual data
	file?: DocumentFile;
	folder?: DocumentFolder;
}

/**
 * Library state management
 */
export interface DocumentLibraryState {
	currentPath: string;
	selectedItem: DocumentLibraryItem | null;
	items: DocumentLibraryItem[];
	tree: DocumentTreeNode[];
	loading: boolean;
	error: string | null;
}

/**
 * Upload progress tracking
 */
export interface DocumentUploadProgress {
	id: string;
	file: File;
	progress: number;
	status: "pending" | "uploading" | "processing" | "completed" | "error";
	error?: string;
}

/**
 * File filter options
 */
export interface DocumentFilter {
	types?: DocumentType[];
	searchQuery?: string;
	dateFrom?: Date;
	dateTo?: Date;
	sortBy?: "name" | "date" | "size" | "type";
	sortOrder?: "asc" | "desc";
}

/**
 * Storage statistics
 */
export interface StorageStats {
	totalFiles: number;
	totalFolders: number;
	totalSize: number;
	usedSpace: number;
	availableSpace: number;
	filesByType: Record<DocumentType, number>;
}
