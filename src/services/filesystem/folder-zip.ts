/**
 * A folder from Files as one .zip, and a .zip back into Files, for the Files
 * page, the MemonOS Bot Files app and the agent alike.
 */

import { unzipSync, zipSync, type Zippable } from "fflate";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";

/** A zip is built in memory: past this the browser tab is at risk. */
export const MAX_FOLDER_ZIP_BYTES = 1024 * 1024 * 1024;

/** Already compressed: deflating them again only costs time. */
const STORED_EXTENSIONS = new Set([
	"zip",
	"gz",
	"tgz",
	"7z",
	"rar",
	"jpg",
	"jpeg",
	"png",
	"gif",
	"webp",
	"avif",
	"mp3",
	"mp4",
	"m4a",
	"mov",
	"webm",
	"ogg",
	"pdf",
	"docx",
	"xlsx",
	"pptx",
	"woff",
	"woff2",
]);

export type FolderZipFileSystem = Pick<
	IFlowFileSystem,
	"readdir" | "readFile" | "stat"
>;

export interface FolderZip {
	/** The folder's name with .zip. */
	name: string;
	bytes: Uint8Array;
	fileCount: number;
	/** The files' total size before compression. */
	totalBytes: number;
}

const baseName = (path: string) =>
	path.replace(/\/+$/, "").split("/").pop() || "files";

const joinPath = (dir: string, name: string) =>
	dir === "/" ? `/${name}` : `${dir}/${name}`;

export const folderZipName = (folderPath: string): string =>
	`${baseName(folderPath)}.zip`;

/** Whether Files offers to unzip a file of this name. */
export const isZipFileName = (name: string): boolean => /\.zip$/i.test(name);

/**
 * Every file under the folder, at its path inside it, in one zip whose top
 * folder is the folder itself. Empty folders keep their place.
 */
export const zipFolder = async (
	fs: FolderZipFileSystem,
	folderPath: string,
	{ maxBytes = MAX_FOLDER_ZIP_BYTES }: { maxBytes?: number } = {},
): Promise<FolderZip> => {
	const root = folderPath.replace(/\/+$/, "") || "/";
	if (!(await fs.stat(root)).isDirectory()) {
		throw new Error(`${root} is not a folder.`);
	}
	const top = root === "/" ? "files" : baseName(root);
	const tree: Zippable = {};
	let fileCount = 0;
	let totalBytes = 0;

	const walk = async (dir: string, into: Zippable) => {
		const entries = await fs.readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const path = joinPath(dir, entry.name);
			if (entry.isDirectory()) {
				const child: Zippable = {};
				await walk(path, child);
				// An empty folder is a "name/" entry; nested empties vanish.
				if (Object.keys(child).length > 0) into[entry.name] = child;
				else into[`${entry.name}/`] = new Uint8Array(0);
				continue;
			}
			if (!entry.isFile()) continue;
			const bytes = await fs.readFile(path);
			totalBytes += bytes.byteLength;
			if (totalBytes > maxBytes) {
				throw new Error(
					`${root} holds more than ${Math.round(maxBytes / 1024 / 1024)} MB; zip a smaller folder.`,
				);
			}
			const extension = entry.name.split(".").pop()?.toLowerCase() ?? "";
			into[entry.name] = STORED_EXTENSIONS.has(extension)
				? [bytes, { level: 0 }]
				: bytes;
			fileCount += 1;
		}
	};

	const contents: Zippable = {};
	tree[top] = contents;
	await walk(root, contents);
	return {
		name: folderZipName(root),
		bytes: zipSync(tree, { level: 6 }),
		fileCount,
		totalBytes,
	};
};

export type ZipExtractFileSystem = Pick<
	IFlowFileSystem,
	"readFile" | "writeFile" | "mkdir" | "stat"
>;

export interface ZipExtraction {
	/** What the zip became: its one top entry, or a folder named after it. */
	path: string;
	fileCount: number;
	/** The files' total size, unpacked. */
	totalBytes: number;
}

/** How far an unzip has got, reported after each file it writes. */
export interface ZipExtractProgress {
	filesDone: number;
	fileCount: number;
	bytesDone: number;
	totalBytes: number;
}

/** 0 to 100: by size, or by count when every file is empty. */
export const extractPercent = ({
	filesDone,
	fileCount,
	bytesDone,
	totalBytes,
}: ZipExtractProgress): number =>
	Math.floor(
		totalBytes
			? (bytesDone / totalBytes) * 100
			: fileCount
				? (filesDone / fileCount) * 100
				: 100,
	);

/**
 * Unpacked a batch at a time: the whole contents never sit in memory at
 * once, and progress moves between batches.
 */
const EXTRACT_BATCH_BYTES = 16 * 1024 * 1024;

const parentOf = (path: string) => path.replace(/\/[^/]*$/, "") || "/";

/** Finder's own bookkeeping, which a zip made on a Mac carries along. */
const isFinderMetadata = (segments: readonly string[]) =>
	segments[0] === "__MACOSX" || segments[segments.length - 1] === ".DS_Store";

const exists = async (fs: Pick<IFlowFileSystem, "stat">, path: string) => {
	try {
		await fs.stat(path);
		return true;
	} catch {
		return false;
	}
};

/** `name` in `dir`, else "name 2", "name 3"…; a folder's name has no extension. */
const freePath = async (
	fs: Pick<IFlowFileSystem, "stat">,
	dir: string,
	name: string,
	folder: boolean,
): Promise<string> => {
	const dot = folder ? -1 : name.lastIndexOf(".");
	const [stem, ext] =
		dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
	for (let n = 1; n < 1000; n++) {
		const path = joinPath(dir, n === 1 ? name : `${stem} ${n}${ext}`);
		if (!(await exists(fs, path))) return path;
	}
	throw new Error(`${dir} has too many entries named like ${name}.`);
};

interface ArchiveEntry {
	/** As the zip names it: unzipSync keys what it unpacks by this. */
	name: string;
	segments: string[];
	folder: boolean;
	size: number;
}

/**
 * Unpacks the .zip at `archivePath` into `into` (the zip's own folder by
 * default) as Finder does: a zip that holds one folder, or one file, gives
 * it back; loose entries land in a folder named after the zip. Nothing is
 * overwritten: a name taken already gets a number.
 */
export const extractZip = async (
	fs: ZipExtractFileSystem,
	archivePath: string,
	{
		into = parentOf(archivePath),
		maxBytes = MAX_FOLDER_ZIP_BYTES,
		onProgress,
	}: {
		into?: string;
		maxBytes?: number;
		onProgress?: (progress: ZipExtractProgress) => void;
	} = {},
): Promise<ZipExtraction> => {
	const archiveName = baseName(archivePath);
	const archive = await fs.readFile(archivePath);
	const entries: ArchiveEntry[] = [];
	let unsafe: string | undefined;
	try {
		// Sees every entry and unpacks none: the listing alone.
		unzipSync(archive, {
			filter: (file) => {
				const segments = file.name
					.replace(/\\/g, "/")
					.split("/")
					.filter((segment) => segment && segment !== ".");
				if (segments.includes("..")) unsafe ??= file.name;
				else if (segments.length && !isFinderMetadata(segments)) {
					entries.push({
						name: file.name,
						segments,
						folder: /[\\/]$/.test(file.name),
						size: file.originalSize,
					});
				}
				return false;
			},
		});
	} catch {
		throw new Error(`${archiveName} is not a zip file, or it is damaged.`);
	}
	if (unsafe) {
		throw new Error(
			`${archiveName} has an entry that points outside its folder (${unsafe}), so it was not unzipped.`,
		);
	}
	if (!entries.length) throw new Error(`${archiveName} is empty.`);
	const files = entries.filter((entry) => !entry.folder);
	const totalBytes = files.reduce((sum, entry) => sum + entry.size, 0);
	if (totalBytes > maxBytes) {
		throw new Error(
			`${archiveName} unpacks to more than ${Math.round(maxBytes / 1024 / 1024)} MB, too much to unzip here.`,
		);
	}

	const tops = new Set(entries.map((entry) => entry.segments[0]));
	const [single] = tops.size === 1 ? tops : [];
	const singleIsFile =
		single !== undefined &&
		entries.every((entry) => !entry.folder && entry.segments.length === 1);
	const root =
		single !== undefined
			? await freePath(fs, into, single, !singleIsFile)
			: await freePath(
					fs,
					into,
					archiveName.replace(/\.zip$/i, "") || "unzipped",
					true,
				);
	const target = (entry: ArchiveEntry) =>
		[root, ...entry.segments.slice(single !== undefined ? 1 : 0)].join("/");

	const made = new Set<string>();
	const makeDir = async (path: string) => {
		if (made.has(path)) return;
		await fs.mkdir(path, { recursive: true });
		made.add(path);
	};
	if (!singleIsFile) await makeDir(root);
	for (const entry of entries) {
		if (entry.folder) await makeDir(target(entry));
	}
	const progress: ZipExtractProgress = {
		filesDone: 0,
		fileCount: files.length,
		bytesDone: 0,
		totalBytes,
	};
	onProgress?.({ ...progress });
	for (let next = 0; next < files.length; ) {
		const batch: ArchiveEntry[] = [];
		let bytes = 0;
		while (
			next < files.length &&
			(!batch.length || bytes + files[next].size <= EXTRACT_BATCH_BYTES)
		) {
			bytes += files[next].size;
			batch.push(files[next++]);
		}
		const wanted = new Set(batch.map((entry) => entry.name));
		const unpacked = unzipSync(archive, {
			filter: (file) => wanted.has(file.name),
		});
		for (const entry of batch) {
			const path = target(entry);
			await makeDir(parentOf(path));
			await fs.writeFile(path, unpacked[entry.name]);
			progress.filesDone += 1;
			progress.bytesDone += entry.size;
			onProgress?.({ ...progress });
		}
	}
	return { path: root, fileCount: files.length, totalBytes };
};
