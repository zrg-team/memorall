import { describe, expect, it } from "vitest";
import { editorRegistry, registerAllEditors } from "../index";

describe("registerAllEditors", () => {
	it("registers the markdown editor with its expected config and a component", () => {
		registerAllEditors();

		expect(editorRegistry.hasEditor("markdown")).toBe(true);

		const config = editorRegistry.getEditor("markdown");
		expect(config?.type).toBe("markdown");
		expect(config?.supportsCreate).toBe(true);
		expect(config?.defaultExtension).toBe(".md");
		expect(config?.mimeType).toBe("text/markdown");

		// The registered component is the lazy wrapper (a function component),
		// not the eagerly-imported heavy editor.
		expect(typeof editorRegistry.getEditorComponent("markdown")).toBe(
			"function",
		);
	});
});
