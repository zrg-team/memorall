import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import {
	FileConflictError,
	type SyncedFile,
	useDocumentSync,
} from "../use-document-sync";

/** A file on a fake disk that announces every write, like the real one. */
function fakeFile(initial: string) {
	let disk = initial;
	const listeners = new Set<() => void>();
	const file: SyncedFile = {
		read: async () => disk,
		write: async (content) => {
			disk = content;
			for (const listener of listeners) listener();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
	return {
		file,
		get disk() {
			return disk;
		},
		/** Someone else — the agent — writes the file. */
		writeElsewhere(content: string) {
			disk = content;
			for (const listener of listeners) listener();
		},
		/** Changes the file without announcing it. */
		writeSilently(content: string) {
			disk = content;
		},
	};
}

const renderSync = (file: SyncedFile, initial: string) =>
	renderHook(() => {
		const [content, setContent] = useState<string | null>(initial);
		return { content, sync: useDocumentSync(file, content, setContent) };
	});

describe("useDocumentSync", () => {
	it("follows the file while there are no unsaved edits", async () => {
		const fake = fakeFile("a");
		const { result } = renderSync(fake.file, "a");

		act(() => fake.writeElsewhere("from the agent"));

		await waitFor(() => expect(result.current.content).toBe("from the agent"));
		expect(result.current.sync.conflict).toBeNull();
	});

	it("reports a conflict instead of discarding unsaved edits", async () => {
		const fake = fakeFile("a");
		const { result } = renderSync(fake.file, "a");
		act(() => result.current.sync.onDirtyChange(true));

		act(() => fake.writeElsewhere("from the agent"));

		await waitFor(() =>
			expect(result.current.sync.conflict).toEqual({
				base: "a",
				disk: "from the agent",
			}),
		);
		expect(result.current.content).toBe("a");
	});

	it("refuses a save over a file that changed since it was loaded", async () => {
		const fake = fakeFile("a");
		const { result } = renderSync(fake.file, "a");
		fake.writeSilently("from the agent");

		await act(async () => {
			await expect(result.current.sync.save("mine")).rejects.toBeInstanceOf(
				FileConflictError,
			);
		});

		expect(fake.disk).toBe("from the agent");
		expect(result.current.sync.conflict?.disk).toBe("from the agent");
	});

	it("saves without seeing its own write as a conflict", async () => {
		const fake = fakeFile("a");
		const { result } = renderSync(fake.file, "a");
		act(() => result.current.sync.onDirtyChange(true));

		await act(() => result.current.sync.save("mine"));

		expect(fake.disk).toBe("mine");
		expect(result.current.content).toBe("mine");
		expect(result.current.sync.conflict).toBeNull();
	});

	it("keeps mine or reloads theirs", async () => {
		const fake = fakeFile("a");
		const { result } = renderSync(fake.file, "a");
		act(() => {
			result.current.sync.onDirtyChange(true);
			result.current.sync.onContentChange("mine");
		});
		act(() => fake.writeElsewhere("theirs"));
		await waitFor(() => expect(result.current.sync.conflict).not.toBeNull());

		await act(() => result.current.sync.keepMine());
		expect(fake.disk).toBe("mine");
		expect(result.current.content).toBe("mine");
		expect(result.current.sync.conflict).toBeNull();

		act(() => result.current.sync.onDirtyChange(true));
		act(() => fake.writeElsewhere("theirs again"));
		await waitFor(() => expect(result.current.sync.conflict).not.toBeNull());

		act(() => result.current.sync.reload());
		expect(result.current.content).toBe("theirs again");
		expect(fake.disk).toBe("theirs again");
		expect(result.current.sync.conflict).toBeNull();
	});
});
