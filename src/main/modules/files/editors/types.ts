/**
 * Document Editor Types
 * Type-safe definitions for extensible document editor system
 */

import type { DocumentFile, DocumentType } from "@/types/document-library";

/**
 * Props that all document editors must implement
 */
export interface DocumentEditorProps {
	/** The document file being edited */
	file: DocumentFile;
	/** Initial content of the document */
	initialContent: string;
	/** Callback when content changes */
	onContentChange?: (content: string) => void;
	/** Callback when save is requested */
	onSave: (content: string) => Promise<void>;
	/** Whether the document is read-only */
	readOnly?: boolean;
	/** Additional CSS class names */
	className?: string;
}

/**
 * Editor component type
 */
export type EditorComponent = React.FC<DocumentEditorProps>;

/**
 * Editor configuration for a document type
 */
export interface EditorConfig {
	/** The document type this editor handles */
	type: DocumentType;
	/** The editor component */
	component: EditorComponent;
	/** Display name of the editor */
	name: string;
	/** Whether this editor supports creation of new documents */
	supportsCreate: boolean;
	/** Default file extension for new documents */
	defaultExtension: string;
	/** MIME type for new documents */
	mimeType: string;
}
