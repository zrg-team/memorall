import { afterEach, describe, expect, it, vi } from "vitest";
import { watchLibrary } from "../runtime";
import type {
	DocumentFileSystem,
	FilesystemChangeEvent,
} from "@/services/filesystem/document-filesystem";
import type { FolderIndexer } from "../folder-indexer";

afterEach(() => vi.useRealTimers());
describe("index change scheduling", () => {
	const fixture = () => {
		vi.useFakeTimers();
		let notify!: (event: FilesystemChangeEvent) => void;
		const unsubscribe = vi.fn(),
			syncPaths = vi.fn(async (_paths: string[]) => {}),
			moveFolder = vi.fn(async () => {}),
			forgetFolder = vi.fn(async () => {});
		const stop = watchLibrary(
			{
				onFilesystemChanged: (listener) => {
					notify = listener;
					return unsubscribe;
				},
			},
			{ syncPaths, moveFolder, forgetFolder } as unknown as FolderIndexer,
		);
		const emit = (path: string) =>
			notify({ scope: "root", operation: "write", path });
		return { notify, emit, stop, unsubscribe, syncPaths };
	};
	it("coalesces edit bursts and never indexes its own generated store", async () => {
		const f = fixture();
		f.notify({
			scope: "root",
			operation: "write",
			origin: "folder-index",
			path: "/home/indexes/embeddings/manifest.json",
		});
		await vi.advanceTimersByTimeAsync(2500);
		expect(f.syncPaths).not.toHaveBeenCalled();
		for (let i = 0; i < 100; i++) f.emit(`/Work/${i % 3}.txt`);
		await vi.advanceTimersByTimeAsync(2000);
		expect(f.syncPaths).toHaveBeenCalledTimes(1);
		expect(f.syncPaths.mock.calls[0][0]).toEqual([
			"/Work/0.txt",
			"/Work/1.txt",
			"/Work/2.txt",
		]);
		f.stop();
	});
	it("keeps both sides of moves and cancels pending work on disposal", async () => {
		const f = fixture();
		f.notify({
			scope: "root",
			operation: "move",
			oldPath: "/Work/old.txt",
			newPath: "/Work/new.txt",
		});
		await vi.advanceTimersByTimeAsync(2000);
		expect(f.syncPaths).toHaveBeenCalledWith([
			"/Work/old.txt",
			"/Work/new.txt",
		]);
		f.emit("/Work/pending.txt");
		f.stop();
		await vi.advanceTimersByTimeAsync(2000);
		expect(f.syncPaths).toHaveBeenCalledTimes(1);
		expect(f.unsubscribe).toHaveBeenCalled();
	});
	it("schedules nothing for changes in /tmp", async () => {
		const f = fixture();
		f.emit("/tmp/downloads/paper.pdf");
		await vi.advanceTimersByTimeAsync(2500);
		expect(f.syncPaths).not.toHaveBeenCalled();
		f.notify({
			scope: "root",
			operation: "move",
			oldPath: "/tmp/downloads/paper.pdf",
			newPath: "/Work/paper.pdf",
		});
		await vi.advanceTimersByTimeAsync(2000);
		expect(f.syncPaths).toHaveBeenCalledWith(["/Work/paper.pdf"]);
		f.stop();
	});
	it("does not suppress a user folder named like the physical private store", async () => {
		const f = fixture();
		f.emit("/home/indexes/my-notes.txt");
		await vi.advanceTimersByTimeAsync(2000);
		expect(f.syncPaths).toHaveBeenCalledWith(["/home/indexes/my-notes.txt"]);
		f.stop();
	});
	it("indexes a steady stream of changes within ten seconds, and says when", async () => {
		vi.useFakeTimers();
		let notify!: (event: FilesystemChangeEvent) => void;
		const syncPaths = vi.fn(async (_paths: string[]) => {});
		const noteChangesWaiting = vi.fn();
		const stop = watchLibrary(
			{
				onFilesystemChanged: (listener) => {
					notify = listener;
					return () => {};
				},
			},
			{
				syncPaths,
				moveFolder: vi.fn(async () => {}),
				forgetFolder: vi.fn(async () => {}),
				noteChangesWaiting,
			} as unknown as FolderIndexer,
		);
		const start = Date.now();
		// An agent writing a file every second, for a minute.
		for (
			let second = 0;
			second < 60 && !syncPaths.mock.calls.length;
			second++
		) {
			notify({
				scope: "root",
				operation: "write",
				path: `/content/${second}.md`,
			});
			await vi.advanceTimersByTimeAsync(1_000);
		}
		expect(syncPaths).toHaveBeenCalled();
		expect(Date.now() - start).toBeLessThanOrEqual(11_000);
		// Told when indexing is due, then that it has started.
		expect(typeof noteChangesWaiting.mock.calls[0]?.[0]).toBe("number");
		expect(noteChangesWaiting).toHaveBeenCalledWith(null);
		stop();
	});
});
