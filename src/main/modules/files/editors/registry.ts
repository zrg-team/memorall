/**
 * Document Editor Registry
 * Centralized registry for all document editors
 * Makes it easy to add new editor types in the future
 */

import type { DocumentType } from "@/types/document-library";
import type { EditorConfig, EditorComponent } from "./types";

class EditorRegistry {
	private static instance: EditorRegistry;
	private editors: Map<DocumentType, EditorConfig> = new Map();

	private constructor() {}

	static getInstance(): EditorRegistry {
		if (!EditorRegistry.instance) {
			EditorRegistry.instance = new EditorRegistry();
		}
		return EditorRegistry.instance;
	}

	/**
	 * Register an editor for a document type
	 */
	register(config: EditorConfig): void {
		this.editors.set(config.type, config);
	}

	/**
	 * Get editor configuration for a document type
	 */
	getEditor(type: DocumentType): EditorConfig | undefined {
		return this.editors.get(type);
	}

	/**
	 * Get editor component for a document type
	 */
	getEditorComponent(type: DocumentType): EditorComponent | undefined {
		return this.editors.get(type)?.component;
	}

	/**
	 * Check if an editor exists for a document type
	 */
	hasEditor(type: DocumentType): boolean {
		return this.editors.has(type);
	}

	/**
	 * Get all editors that support creation
	 */
	getCreatableEditors(): EditorConfig[] {
		return Array.from(this.editors.values()).filter(
			(editor) => editor.supportsCreate,
		);
	}

	/**
	 * Get all registered editor types
	 */
	getRegisteredTypes(): DocumentType[] {
		return Array.from(this.editors.keys());
	}
}

export const editorRegistry = EditorRegistry.getInstance();
