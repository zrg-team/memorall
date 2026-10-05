import { describe, expect, it } from "vitest";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import { createDocEditTool } from "@/services/flows-integrations/tools/files/doc-edit";
import { createFsEditTool } from "@/services/flows-integrations/tools/files-fs/fs-edit";
import { createHyperframesEditTool } from "@/services/flows-integrations/tools/hyperframes/hyperframes-edit";
import { createLottieEditTool } from "@/services/flows-integrations/tools/lottie/lottie-edit";

/**
 * `String.prototype.replace` with a string replacement expands `$&`, `$$`,
 * `` $` `` and `$'`. Agents write code and prices, so new_string has to land
 * exactly as sent.
 */
const LITERAL = "cost $$5, match $&, before $`, after $'";

type EditTool = { execute: (input: never) => Promise<unknown> };

/** One file, whatever path the tool resolves; returns what the tool wrote. */
const editOnce = async (
	create: (services: { fs: IFlowFileSystem }) => EditTool,
	content: string,
	input: Record<string, unknown>,
): Promise<string | undefined> => {
	let written: string | undefined;
	const fs = {
		readFile: async () => new TextEncoder().encode(content),
		writeFile: async (_path: string, data: string | Uint8Array) => {
			written =
				typeof data === "string" ? data : new TextDecoder().decode(data);
		},
		mkdir: async () => undefined,
	} as unknown as IFlowFileSystem;
	await create({ fs }).execute({
		old_string: "PLACEHOLDER",
		...input,
	} as never);
	return written;
};

describe("edit tools insert new_string literally", () => {
	it("doc_edit", async () => {
		const written = await editOnce(
			(services) => createDocEditTool(services as never),
			"a PLACEHOLDER b",
			{ file_path: "/notes.md", new_string: LITERAL },
		);
		expect(written).toBe(`a ${LITERAL} b`);
	});

	it("document_fs_edit", async () => {
		const written = await editOnce(
			(services) => createFsEditTool(services as never),
			"a PLACEHOLDER b",
			{ file_path: "/notes.md", new_string: LITERAL },
		);
		expect(written).toBe(`a ${LITERAL} b`);
	});

	it("hyperframes_edit", async () => {
		const written = await editOnce(
			(services) => createHyperframesEditTool(services as never, {}),
			"<p>PLACEHOLDER</p>",
			{ project_path: "/demo", new_string: LITERAL },
		);
		expect(written).toBe(`<p>${LITERAL}</p>`);
	});

	it("lottie_edit", async () => {
		const written = await editOnce(
			(services) => createLottieEditTool(services as never, {}),
			'{"nm":"PLACEHOLDER"}',
			{ project_path: "/anim", new_string: LITERAL },
		);
		expect(written).toBe(`{"nm":"${LITERAL}"}`);
	});
});
