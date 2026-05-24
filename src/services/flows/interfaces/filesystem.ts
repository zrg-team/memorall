export type BufferEncoding =
	| "ascii"
	| "utf8"
	| "utf-8"
	| "utf16le"
	| "ucs2"
	| "ucs-2"
	| "base64"
	| "latin1"
	| "binary"
	| "hex";

export interface WriteFileOptions {
	encoding?: BufferEncoding;
	flag?: string;
	mode?: number;
}

export interface FileStat {
	isFile(): boolean;
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
	size: number;
	mtime: Date;
	atime: Date;
	ctime: Date;
	birthtime: Date;
	mode: number;
}

export interface DirEntry {
	name: string;
	isFile(): boolean;
	isDirectory(): boolean;
	isSymbolicLink(): boolean;
}

export interface IFlowFileSystem {
	readFile(path: string): Promise<Uint8Array>;
	readFile(
		path: string,
		options: { encoding: BufferEncoding },
	): Promise<string>;

	writeFile(
		path: string,
		data: string | Uint8Array,
		options?: WriteFileOptions,
	): Promise<void>;
	appendFile(path: string, data: string | Uint8Array): Promise<void>;

	unlink(path: string): Promise<void>;
	rename(oldPath: string, newPath: string): Promise<void>;
	copyFile(src: string, dest: string): Promise<void>;

	mkdir(
		path: string,
		options?: { recursive?: boolean; mode?: number },
	): Promise<string | undefined>;
	rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
	rm(
		path: string,
		options?: { recursive?: boolean; force?: boolean },
	): Promise<void>;

	readdir(path: string): Promise<string[]>;
	readdir(path: string, options: { withFileTypes: true }): Promise<DirEntry[]>;

	stat(path: string): Promise<FileStat>;
	access(path: string, mode?: number): Promise<void>;

	watch?(
		path: string,
		options?: { recursive?: boolean; signal?: AbortSignal },
	): AsyncIterable<{ eventType: "rename" | "change"; filename: string | null }>;
}
