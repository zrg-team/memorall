import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import type { HostedBridgeEntry, HostedBridgeFiles } from "./bridge";
import type { HostedFileAccess } from "./commands";
import type { HostedEngineServices } from "./engine-types";

/**
 * The hosted apps on Memorall's files: the flow file system (the document
 * library, "/" rooted) as the frame bridge, the command runner and the
 * engines need it. The same adapter serves the page (the app's frame) and
 * the agent's tools.
 */

const joinPath = (dir: string, name: string): string =>
	dir === "/" ? `/${name}` : `${dir}/${name}`;
const parentOf = (path: string): string =>
	path.slice(0, path.lastIndexOf("/")) || "/";

const isMissing = (error: unknown): boolean => {
	const code = (error as { code?: string })?.code;
	const message = error instanceof Error ? error.message : String(error);
	return (
		code === "ENOENT" ||
		/not found|no such|does not exist|ENOENT/i.test(message)
	);
};

const ensureFolder = async (fs: IFlowFileSystem, path: string) => {
	if (path !== "/") await fs.mkdir(path, { recursive: true });
};

export const hostedBridgeFiles = (fs: IFlowFileSystem): HostedBridgeFiles => {
	const stat = async (path: string): Promise<HostedBridgeEntry | null> => {
		try {
			const info = await fs.stat(path);
			return {
				path,
				type: info.isDirectory() ? "dir" : "file",
				size: info.isDirectory() ? 0 : info.size,
				mtimeMs: info.mtime ? new Date(info.mtime).getTime() : Date.now(),
			};
		} catch (error) {
			if (isMissing(error)) return null;
			throw error;
		}
	};
	const copyTree = async (from: string, to: string): Promise<void> => {
		if (!(await fs.stat(from)).isDirectory()) {
			await fs.copyFile(from, to);
			return;
		}
		await fs.mkdir(to, { recursive: true });
		for (const name of await fs.readdir(from)) {
			await copyTree(joinPath(from, name), joinPath(to, name));
		}
	};
	return {
		read: (path) => fs.readFile(path),
		async write(path, bytes) {
			await ensureFolder(fs, parentOf(path));
			await fs.writeFile(path, bytes);
		},
		stat,
		async list(path) {
			const entries = await fs.readdir(path, { withFileTypes: true });
			const listed: HostedBridgeEntry[] = [];
			for (const entry of entries) {
				const child = joinPath(path, entry.name);
				// The listing has no times; a stat per file is cheap for the
				// app folders this serves (an app's own few files).
				const info = await stat(child);
				if (info) listed.push(info);
			}
			return listed;
		},
		mkdir: (path) => ensureFolder(fs, path),
		remove: (path) => fs.rm(path, { recursive: true }),
		async move(from, to) {
			await ensureFolder(fs, parentOf(to));
			await fs.rename(from, to);
		},
		async copy(from, to) {
			await ensureFolder(fs, parentOf(to));
			await copyTree(from, to);
		},
	};
};

export const hostedFileAccess = (fs: IFlowFileSystem): HostedFileAccess => ({
	async read(path) {
		try {
			const info = await fs.stat(path);
			if (info.isDirectory()) throw new Error(`${path} is a folder.`);
		} catch (error) {
			if (isMissing(error)) return null;
			throw error;
		}
		return fs.readFile(path);
	},
	async write(path, bytes) {
		await ensureFolder(fs, parentOf(path));
		await fs.writeFile(path, bytes);
	},
});

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
	bytes.buffer instanceof ArrayBuffer
		? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
		: new Uint8Array(bytes).buffer;

/** What engines borrow from Memorall: other files, and pdf.js to read text. */
export const hostedEngineServices = (
	fs: IFlowFileSystem,
	resolve: (path: string) => string = (path) => path,
): HostedEngineServices => ({
	readFile: (path) => fs.readFile(resolve(path)),
	async extractText(bytes, pages) {
		const { readPDFPages } = await import(
			"@/main/modules/files/handlers/pdf-extraction"
		);
		const first = Math.min(...pages);
		const last = Math.max(...pages);
		const wanted = new Set(pages);
		const content = await readPDFPages(toArrayBuffer(bytes), first, last);
		const text = content
			.filter((page) => wanted.has(page.pageNumber))
			.map(
				(page) =>
					`--- page ${page.pageNumber}\n${page.text.trim() || "(no text)"}`,
			)
			.join("\n");
		return text.length > 60_000
			? `${text.slice(0, 60_000)}\n… (cut off; read fewer pages at a time)`
			: text;
	},
});
