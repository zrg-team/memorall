import { describe, expect, it } from "vitest";
import "../tools/fs/fs-edit.js";
import { toolRegistry } from "../registries/tool-registry.js";
import type { IFlowFileSystem } from "../interfaces/services/filesystem.js";

/**
 * A string replacement expands `$&`, `$$`, `` $` `` and `$'`, so code or a
 * price in new_string would be rewritten on its way into the file.
 */
const LITERAL = "cost $$5, match $&, before $`, after $'";

describe("fs_edit", () => {
	it("inserts new_string literally", async () => {
		let written: string | undefined;
		const fs = {
			stat: async () => ({
				size: 16,
				isFile: () => true,
				isDirectory: () => false,
			}),
			readFile: async () => new TextEncoder().encode("a PLACEHOLDER b"),
			writeFile: async (_path: string, data: string | Uint8Array) => {
				written =
					typeof data === "string" ? data : new TextDecoder().decode(data);
			},
			mkdir: async () => undefined,
		} as unknown as IFlowFileSystem;

		const tool = toolRegistry.get("fs_edit")?.factory?.({ fs } as never, {});
		if (!tool) throw new Error("fs_edit is not registered");
		await (
			tool as { execute: (input: Record<string, unknown>) => Promise<string> }
		).execute({
			file_path: "/a.txt",
			old_string: "PLACEHOLDER",
			new_string: LITERAL,
		});

		expect(written).toBe(`a ${LITERAL} b`);
	});
});
