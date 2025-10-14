/**
 * PDF Library Types
 * Type-safe definitions for PDF library functionality
 */

export interface PDFFile {
	id: string;
	name: string;
	path: string;
	size: number;
	createdAt: Date;
	modifiedAt: Date;
	mimeType: string;
	metadata?: {
		title?: string;
		author?: string;
		subject?: string;
		pageCount?: number;
	};
}

export interface PDFFolder {
	id: string;
	name: string;
	path: string;
	parentPath: string | null;
	createdAt: Date;
	modifiedAt: Date;
	childCount: number;
}

export type PDFLibraryItem = PDFFile | PDFFolder;

export interface PDFTreeNode {
	id: string;
	name: string;
	path: string;
	type: "file" | "folder";
	children?: PDFTreeNode[];
	isExpanded?: boolean;
	file?: PDFFile;
	folder?: PDFFolder;
}

export interface PDFLibraryState {
	currentPath: string;
	selectedItem: PDFLibraryItem | null;
	selectedType: "file" | "folder" | null;
	items: PDFLibraryItem[];
	tree: PDFTreeNode[];
	loading: boolean;
	error: string | null;
}

export interface PDFUploadProgress {
	file: File;
	progress: number;
	status: "pending" | "uploading" | "processing" | "completed" | "error";
	error?: string;
}
