/**
 * Whiteboard keeps boards in the browser (IndexedDB) and has no notion of a
 * file it was opened with. Here a `.whiteboard` file (the board's own JSON,
 * as the app exports it) is the board: it is put in the browser's store under
 * an id of the file's, opened at start (see the edit in apps.mjs), and every
 * save of that board is written back to the file.
 */
import { board as blankBoard, validateBoard } from "../model.js";
import { local } from "../storage.js";

/** Long enough to gather a drag's saves into one write. */
const WRITE_DELAY_MS = 700;

/** The same id each time the file opens, so the store holds one copy of it. */
const boardIdFor = async (path) => {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(`memorall:${path}`),
	);
	const hex = [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
	return `file-${hex.slice(0, 32)}`;
};

const titleOf = (name) =>
	String(name || "Untitled board")
		.replace(/\.[^.]+$/, "")
		.slice(0, 200) || "Untitled board";

/** What goes in the file: the board, without this browser's sharing state. */
const fileContent = (board) => {
	const { shared, deletedAt, ...rest } = board;
	return JSON.stringify(rest);
};

export async function prepare(init) {
	const item = init?.launch?.[0];
	if (!item?.path || !globalThis.puter) return;
	const text = await (await globalThis.puter.fs.read(item.path)).text();
	const id = await boardIdFor(item.path);
	let board;
	if (text.trim()) {
		board = validateBoard(JSON.parse(text));
	} else {
		board = blankBoard(titleOf(item.name));
	}
	board.id = id;
	delete board.shared;
	delete board.deletedAt;
	board.updated = Date.now();
	await local.save(board);
	globalThis.__memorallLaunchBoard = id;

	let latest = null;
	let timer = null;
	let writing = Promise.resolve();
	const write = () => {
		timer = null;
		const snapshot = latest;
		if (!snapshot) return writing;
		latest = null;
		writing = writing
			.catch(() => {})
			.then(() =>
				globalThis.puter.fs.write(
					item.path,
					new Blob([fileContent(snapshot)], { type: "application/json" }),
					{ overwrite: true },
				),
			)
			.catch((error) => console.error("Could not save the board file", error));
		return writing;
	};
	const save = local.save;
	local.save = (b, options = {}) => {
		const result = save(b, options);
		// A library save (favorite, trash) changes only the browser's list.
		if (b?.id === id && !options.library) {
			latest = b;
			if (timer) clearTimeout(timer);
			timer = setTimeout(write, WRITE_DELAY_MS);
		}
		return result;
	};
	// Closing the window writes what is still waiting first. The app itself
	// never asks about closing, so this is the window's only handler.
	const flush = () => {
		if (timer) {
			clearTimeout(timer);
			void write();
		}
		return writing;
	};
	window.addEventListener("pagehide", flush);
	globalThis.puter.ui.onWindowClose(async () => {
		await flush();
		globalThis.puter.exit();
	});
}
