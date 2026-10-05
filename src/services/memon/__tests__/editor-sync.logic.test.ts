import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MEMON_FEATURE_CONFIG } from "../feature-config";
import { MemonMachine, type MemonPorts } from "../memon-machine";
import { serializeScreen } from "../screen-serializer";

const PATH = "/notes/a.md";

/** A machine with `PATH` open in the Editor, on a disk that announces writes. */
const openEditor = async () => {
	const files = new Map([[PATH, "hello"]]);
	const listeners = new Set<() => void>();
	const announce = () => {
		for (const listener of listeners) listener();
	};
	const ports = {
		browser: { availability: () => ({ available: true }) },
		terminal: { availability: () => ({ available: true }) },
		files: {
			availability: () => ({ available: true }),
			list: vi.fn(async () => []),
			read: vi.fn(async (path: string) => {
				const content = files.get(path);
				if (content === undefined) throw new Error("ENOENT");
				return content;
			}),
			write: vi.fn(async (path: string, content: string) => {
				files.set(path, content);
				announce();
			}),
			isDirectory: vi.fn(async (path: string) =>
				["/", "/notes"].includes(path),
			),
			exists: vi.fn(async (path: string) => files.has(path)),
			subscribe: vi.fn((listener: () => void) => {
				listeners.add(listener);
				return () => listeners.delete(listener);
			}),
		},
	} as unknown as MemonPorts;
	const machine = new MemonMachine(
		"conversation-1",
		ports,
		DEFAULT_MEMON_FEATURE_CONFIG,
	);
	await machine.openFile(PATH);
	return {
		machine,
		files,
		editor: () => machine.snapshot().editor,
		/** Someone else — the agent's file tools, another window — writes it. */
		writeElsewhere: async (content: string) => {
			files.set(PATH, content);
			announce();
			await vi.advanceTimersByTimeAsync(200);
		},
	};
};

describe("MemonMachine Editor and the file on disk", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("follows the file while nothing is unsaved", async () => {
		const { editor, writeElsewhere } = await openEditor();

		await writeElsewhere("from the agent");

		expect(editor()).toMatchObject({ content: "from the agent", saved: true });
		expect(editor().conflict).toBeUndefined();
	});

	it("keeps unsaved edits and refuses to save over a changed file", async () => {
		const { machine, files, editor, writeElsewhere } = await openEditor();
		machine.setEditorContent("mine");

		await writeElsewhere("from the agent");

		expect(editor()).toMatchObject({
			content: "mine",
			saved: false,
			conflict: "from the agent",
		});
		expect(serializeScreen(machine.snapshot())).toContain(
			"the file changed on disk",
		);
		await expect(machine.saveEditor()).rejects.toThrow(/changed on disk/);
		expect(files.get(PATH)).toBe("from the agent");
	});

	it("reloads the file or overwrites it on purpose", async () => {
		const { machine, files, editor, writeElsewhere } = await openEditor();
		machine.setEditorContent("mine");
		await writeElsewhere("from the agent");

		await machine.saveEditor({ overwrite: true });
		expect(files.get(PATH)).toBe("mine");
		expect(editor()).toMatchObject({ content: "mine", saved: true });
		expect(editor().conflict).toBeUndefined();

		machine.setEditorContent("mine again");
		await writeElsewhere("from the agent again");
		await machine.reloadEditor();
		expect(editor()).toMatchObject({
			content: "from the agent again",
			saved: true,
		});
		expect(editor().conflict).toBeUndefined();
	});

	it("refuses a window's draft based on text the file no longer holds", async () => {
		const { machine, files, writeElsewhere } = await openEditor();
		// The window's draft started from "hello"; the Editor then followed
		// the agent's write, which the draft never saw.
		await writeElsewhere("from the agent");
		machine.setEditorContent("draft");

		await expect(machine.saveEditor({ base: "hello" })).rejects.toThrow(
			/changed on disk/,
		);
		expect(files.get(PATH)).toBe("from the agent");
	});

	it("does not take its own save for someone else's change", async () => {
		const { machine, files, editor } = await openEditor();
		machine.setEditorContent("mine");

		await machine.saveEditor();
		await vi.advanceTimersByTimeAsync(200);

		expect(files.get(PATH)).toBe("mine");
		expect(editor()).toMatchObject({ content: "mine", saved: true });
		expect(editor().conflict).toBeUndefined();
	});
});
