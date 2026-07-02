/**
 * Document Editors Module
 * Exports all editors and handles registration
 */

export * from "./types";
export * from "./registry";
export { LazyMarkdownEditor } from "./LazyMarkdownEditor";

// Import editors and registry. The markdown editor is registered via its lazy
// wrapper so its heavy dependencies (TipTap, marked, turndown, …) are code-split
// out of the entry bundle and only loaded when a document is opened.
import { LazyMarkdownEditor } from "./LazyMarkdownEditor";
import { editorRegistry } from "./registry";

/**
 * Register all available editors
 * Call this once during app initialization
 */
export function registerAllEditors(): void {
	// Register Markdown Editor (lazily loaded)
	editorRegistry.register({
		type: "markdown",
		component: LazyMarkdownEditor,
		name: "Markdown Editor",
		supportsCreate: true,
		defaultExtension: ".md",
		mimeType: "text/markdown",
	});

	// Future editors can be registered here:
	// editorRegistry.register({
	//   type: "text",
	//   component: TextEditor,
	//   name: "Text Editor",
	//   supportsCreate: true,
	//   defaultExtension: ".txt",
	//   mimeType: "text/plain",
	// });
}
