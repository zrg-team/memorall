import type { HostedAppAi, HostedChatOptions } from "./ai";
import type { HostedAppId } from "./catalog";
import type { HostedAppRequestMethod, HostedFileItem } from "./protocol";

/**
 * Answers a hosted app's requests (its Puter SDK calls) from the user's
 * files. Paths the app gives are absolute ("/notes/Plan.docx", the file it
 * was opened with) or relative to its home ("Spreadsheets/Budget.xlsx", its
 * own folder), as on Puter's drive.
 */

export interface HostedBridgeEntry {
	path: string;
	type: "file" | "dir";
	size: number;
	mtimeMs: number;
}

/** The file system the bridge works on (Memorall's, or a fake in tests). */
export interface HostedBridgeFiles {
	read(path: string): Promise<Uint8Array>;
	write(path: string, bytes: Uint8Array): Promise<void>;
	stat(path: string): Promise<HostedBridgeEntry | null>;
	list(path: string): Promise<HostedBridgeEntry[]>;
	mkdir(path: string): Promise<void>;
	remove(path: string): Promise<void>;
	/** Moves or renames. */
	move(from: string, to: string): Promise<void>;
	copy(from: string, to: string): Promise<void>;
}

/** A refusal the app reads as Puter's: with a code it can test. */
export class HostedBridgeError extends Error {
	constructor(
		message: string,
		readonly code: string,
	) {
		super(message);
	}
}

const notFound = (path: string) =>
	new HostedBridgeError(`${path} does not exist`, "subject_does_not_exist");

const MIME: Record<string, string> = {
	xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
	xls: "application/vnd.ms-excel",
	ods: "application/vnd.oasis.opendocument.spreadsheet",
	csv: "text/csv",
	docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	hwp: "application/x-hwp",
	hwpx: "application/hwp+zip",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	pdf: "application/pdf",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	json: "application/json",
	whiteboard: "application/json",
	txt: "text/plain",
	md: "text/markdown",
};

const mimeOf = (path: string): string =>
	MIME[/\.([^./]+)$/.exec(path.toLowerCase())?.[1] ?? ""] ??
	"application/octet-stream";

const nameOf = (path: string): string => path.split("/").pop() || path;
const parentOf = (path: string): string =>
	path.slice(0, path.lastIndexOf("/")) || "/";
const joinPath = (folder: string, name: string): string =>
	folder === "/" ? `/${name}` : `${folder}/${name}`;

/** An absolute, normalized path; ".." never climbs above the root. */
export const resolveHostedPath = (home: string, value: string): string => {
	const raw = String(value ?? "")
		.replaceAll("\\", "/")
		.trim();
	if (!raw) throw new HostedBridgeError("No path was given.", "invalid_path");
	const base = raw.startsWith("/")
		? raw
		: raw === "~" || raw.startsWith("~/")
			? `${home}${raw.slice(1)}`
			: `${home}/${raw}`;
	const parts: string[] = [];
	for (const part of base.split("/")) {
		if (!part || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return `/${parts.join("/")}`;
};

export const hostedFileItem = (entry: HostedBridgeEntry): HostedFileItem => {
	const seconds = Math.floor(entry.mtimeMs / 1000);
	return {
		id: entry.path,
		uid: entry.path,
		name: nameOf(entry.path),
		path: entry.path,
		is_dir: entry.type === "dir",
		size: entry.size,
		modified: seconds,
		created: seconds,
		type: entry.type === "dir" ? "" : mimeOf(entry.path),
	};
};

/** "Budget (2).xlsx" for "Budget.xlsx" while taken. */
const freePath = async (
	files: HostedBridgeFiles,
	path: string,
): Promise<string> => {
	if (!(await files.stat(path))) return path;
	const name = nameOf(path);
	const dot = name.lastIndexOf(".");
	const stem = dot > 0 ? name.slice(0, dot) : name;
	const extension = dot > 0 ? name.slice(dot) : "";
	for (let n = 2; n < 1000; n++) {
		const candidate = joinPath(parentOf(path), `${stem} (${n})${extension}`);
		if (!(await files.stat(candidate))) return candidate;
	}
	throw new HostedBridgeError("Too many files with this name.", "name_taken");
};

export interface HostedBridgeOptions {
	app: HostedAppId;
	/** Where relative paths go (the app's own folders). */
	home: string;
	/** The file the app was opened with, if any (where "Save as" saves). */
	launchPath: string | null;
	files: HostedBridgeFiles;
	/** Called after the app wrote a file, with its bytes. */
	onWrite?: (path: string, bytes: Uint8Array) => void;
	/**
	 * Lets the user choose files to open ("Open from Memorall…"), starting
	 * in `folder`; null when they cancel. Without it the picker is refused.
	 */
	pickFiles?: (request: {
		accept: string;
		multiple: boolean;
		folder: string;
	}) => Promise<string[] | null>;
	/** Answers the app's `puter.ai.chat`; without it the app has no AI. */
	ai?: HostedAppAi;
}

export interface HostedBridgeAnswer {
	result: unknown;
	/** Buffers to transfer with the answer instead of copying. */
	transfer?: ArrayBuffer[];
}

/** Bytes from a message, whichever window's realm made the buffer. */
const asBytes = (value: unknown): Uint8Array => {
	if (value instanceof Uint8Array) return value;
	if (Object.prototype.toString.call(value) === "[object ArrayBuffer]")
		return new Uint8Array(value as ArrayBuffer);
	if (ArrayBuffer.isView(value))
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	throw new HostedBridgeError("No file content was given.", "invalid_content");
};

export const createHostedAppBridge = ({
	home,
	launchPath,
	files,
	onWrite,
	pickFiles,
	ai,
}: HostedBridgeOptions) => {
	const at = (value: unknown) => resolveHostedPath(home, String(value ?? ""));

	const statItem = async (path: string): Promise<HostedFileItem> => {
		const entry = await files.stat(path);
		if (!entry) throw notFound(path);
		return hostedFileItem(entry);
	};

	const write = async (
		path: string,
		bytes: Uint8Array,
		{ dedupeName = false, overwrite = true } = {},
	): Promise<HostedFileItem> => {
		let target = path;
		const existing = await files.stat(target);
		if (existing?.type === "dir")
			throw new HostedBridgeError(`${path} is a folder.`, "is_dir");
		if (existing && dedupeName) target = await freePath(files, target);
		else if (existing && !overwrite)
			throw new HostedBridgeError(
				`${path} already exists.`,
				"item_with_same_name_exists",
			);
		await files.mkdir(parentOf(target));
		await files.write(target, bytes);
		onWrite?.(target, bytes);
		return statItem(target);
	};

	const handlers: Record<
		HostedAppRequestMethod,
		(
			params: Record<string, unknown>,
			context: HostedChatOptions,
		) => Promise<HostedBridgeAnswer>
	> = {
		"fs.read": async (params) => {
			const path = at(params.path);
			const entry = await files.stat(path);
			if (entry?.type !== "file") throw notFound(path);
			const bytes = await files.read(path);
			const buffer = bytes.slice().buffer;
			return {
				result: { bytes: buffer, type: mimeOf(path) },
				transfer: [buffer],
			};
		},
		"fs.write": async (params) => ({
			result: await write(at(params.path), asBytes(params.bytes), {
				dedupeName: params.dedupeName === true,
				overwrite: params.overwrite !== false,
			}),
		}),
		"fs.stat": async (params) => ({ result: await statItem(at(params.path)) }),
		"fs.readdir": async (params) => {
			const path = at(params.path);
			const entry = await files.stat(path);
			if (entry?.type !== "dir") throw notFound(path);
			return { result: (await files.list(path)).map(hostedFileItem) };
		},
		"fs.mkdir": async (params) => {
			let path = at(params.path);
			if (params.dedupeName === true) path = await freePath(files, path);
			await files.mkdir(path);
			return { result: await statItem(path) };
		},
		"fs.delete": async (params) => {
			const path = at(params.path);
			if (!(await files.stat(path))) throw notFound(path);
			await files.remove(path);
			return { result: true };
		},
		"fs.rename": async (params) => {
			const from = at(params.path);
			const name = String(params.name ?? "").trim();
			if (!name || name.includes("/"))
				throw new HostedBridgeError(
					"A name cannot hold a slash.",
					"invalid_name",
				);
			const to = joinPath(parentOf(from), name);
			if (await files.stat(to))
				throw new HostedBridgeError(
					`${name} already exists.`,
					"item_with_same_name_exists",
				);
			await files.move(from, to);
			return { result: await statItem(to) };
		},
		"fs.move": async (params) => {
			const from = at(params.path);
			let to = at(params.to);
			if ((await files.stat(to))?.type === "dir")
				to = joinPath(to, nameOf(from));
			await files.move(from, to);
			return { result: await statItem(to) };
		},
		"fs.copy": async (params) => {
			const from = at(params.path);
			let to = at(params.to);
			if ((await files.stat(to))?.type === "dir")
				to = joinPath(to, nameOf(from));
			to = await freePath(files, to);
			await files.copy(from, to);
			return { result: await statItem(to) };
		},
		// "Open from Memorall…": the host lets the user choose, from the open
		// file's folder; Puter answers one item, or a list when several may go.
		"ui.showOpenFilePicker": async (params) => {
			const multiple = params.multiple === true;
			const chosen = await pickFiles?.({
				accept: String(params.accept ?? ""),
				multiple,
				folder: launchPath ? parentOf(launchPath) : home,
			});
			if (!chosen?.length)
				throw new HostedBridgeError("No file was chosen.", "cancelled");
			const items = await Promise.all(chosen.map((path) => statItem(at(path))));
			return { result: multiple ? items : items[0] };
		},
		// "Save as": next to the file the app was opened with, or in its home.
		"ui.showSaveFilePicker": async (params) => {
			const name = nameOf(String(params.name ?? "").trim()) || "Untitled";
			const folder = launchPath ? parentOf(launchPath) : home;
			return {
				result: await write(joinPath(folder, name), asBytes(params.bytes), {
					dedupeName: true,
				}),
			};
		},
		// A streamed answer goes out in parts as it comes; the response ends it.
		"ai.chat": async (params, context) => {
			if (!ai)
				throw new HostedBridgeError(
					"AI is not available here.",
					"not_supported",
				);
			const streamed = params.stream === true;
			const reply = await ai.chat(params, {
				signal: context.signal,
				onPart: streamed ? context.onPart : undefined,
			});
			return { result: streamed ? { done: true } : reply };
		},
	};

	return {
		async handle(
			method: string,
			params: Record<string, unknown>,
			context: HostedChatOptions = {},
		): Promise<HostedBridgeAnswer> {
			const handler = handlers[method as HostedAppRequestMethod];
			if (!handler)
				throw new HostedBridgeError(
					`${method} is not available here.`,
					"not_supported",
				);
			return handler(params ?? {}, context);
		},
		launchItem: async (): Promise<HostedFileItem | null> =>
			launchPath ? statItem(launchPath) : null,
	};
};

export type HostedAppBridge = ReturnType<typeof createHostedAppBridge>;
