/**
 * Keeps an open text document in step with its file.
 *
 * The agent writes documents the user may have open. Before this, an open
 * editor kept showing the old text, and the user's next save silently replaced
 * what the agent wrote. Now an editor without unsaved changes follows the file,
 * one with unsaved changes is told the file changed, and a save first checks
 * that the file is still the version the edits started from.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** The open file, as the sync reads, writes and watches it. */
export interface SyncedFile {
	read(): Promise<string>;
	write(content: string): Promise<void>;
	/** Calls back whenever the file may have changed. */
	subscribe(listener: () => void): () => void;
}

/** A save refused because the file changed since the editor loaded it. */
export class FileConflictError extends Error {
	constructor() {
		super("The file changed since it was opened.");
		this.name = "FileConflictError";
	}
}

/** The file changed under unsaved edits. */
export interface FileConflict {
	/** The text the unsaved edits started from. */
	base: string;
	/** The text the file holds now. */
	disk: string;
}

export interface DocumentSync {
	conflict: FileConflict | null;
	/** Saves unless the file changed since it was loaded. */
	save(content: string): Promise<void>;
	onContentChange(content: string): void;
	onDirtyChange(dirty: boolean): void;
	/** Drops the unsaved edits and shows the file as it is now. */
	reload(): void;
	/** Saves the unsaved edits over the file's new content. */
	keepMine(): Promise<void>;
}

/**
 * @param file The open file; keep it stable (memoize it), it is subscribed to.
 * @param content The text the editor shows, or null while it loads.
 * @param setContent Shows new text in the editor.
 */
export function useDocumentSync(
	file: SyncedFile | null,
	content: string | null,
	setContent: (content: string) => void,
): DocumentSync {
	const [conflict, setConflict] = useState<FileConflict | null>(null);
	// The file text the editor's content is based on.
	const baseRef = useRef<string | null>(content);
	const dirtyRef = useRef(false);
	const draftRef = useRef<string | null>(null);
	const setContentRef = useRef(setContent);
	setContentRef.current = setContent;

	// Loaded, reloaded or saved: the editor now shows the file as it is.
	useEffect(() => {
		baseRef.current = content;
		draftRef.current = null;
	}, [content]);

	useEffect(() => {
		setConflict(null);
		dirtyRef.current = false;
		if (!file) return;
		let active = true;
		let running = false;
		let again = false;

		const check = async () => {
			let disk: string;
			try {
				disk = await file.read();
			} catch {
				return; // Moved or deleted: there is nothing to follow.
			}
			const base = baseRef.current;
			if (!active || base === null) return;
			if (disk === base) {
				setConflict(null);
			} else if (dirtyRef.current) {
				setConflict({ base, disk });
			} else {
				baseRef.current = disk;
				setConflict(null);
				setContentRef.current(disk);
			}
		};

		// One read at a time; changes that land during it get one more read.
		const schedule = () => {
			if (running) {
				again = true;
				return;
			}
			running = true;
			void check().finally(() => {
				running = false;
				if (again && active) {
					again = false;
					schedule();
				}
			});
		};

		const unsubscribe = file.subscribe(schedule);
		return () => {
			active = false;
			unsubscribe();
		};
	}, [file]);

	const writeOver = useCallback(
		async (next: string) => {
			if (!file) return;
			const previous = baseRef.current;
			// Before the write, so its own change notice finds the expected text.
			baseRef.current = next;
			try {
				await file.write(next);
			} catch (error) {
				baseRef.current = previous;
				throw error;
			}
			setConflict(null);
			setContentRef.current(next);
		},
		[file],
	);

	const save = useCallback(
		async (next: string) => {
			if (!file) return;
			draftRef.current = next;
			let disk: string | null;
			try {
				disk = await file.read();
			} catch {
				disk = null; // Gone: saving puts it back.
			}
			const base = baseRef.current;
			if (disk !== null && base !== null && disk !== base) {
				setConflict({ base, disk });
				throw new FileConflictError();
			}
			await writeOver(next);
		},
		[file, writeOver],
	);

	const reload = useCallback(() => {
		if (!conflict) return;
		baseRef.current = conflict.disk;
		dirtyRef.current = false;
		setConflict(null);
		setContentRef.current(conflict.disk);
	}, [conflict]);

	const keepMine = useCallback(async () => {
		const draft = draftRef.current ?? content;
		if (draft !== null) await writeOver(draft);
	}, [content, writeOver]);

	const onContentChange = useCallback((next: string) => {
		draftRef.current = next;
	}, []);

	const onDirtyChange = useCallback((dirty: boolean) => {
		dirtyRef.current = dirty;
	}, []);

	return {
		conflict,
		save,
		onContentChange,
		onDirtyChange,
		reload,
		keepMine,
	};
}
