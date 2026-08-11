import type {
  BufferEncoding,
  DirEntry,
  FileStat,
  HarnessFileSystem,
} from "@memorall/agent-harness-standard/filesystem";

const parts = (path: string): string[] => path.replace(/\\/g, "/").split("/").filter(Boolean);

const encode = (data: string | Uint8Array): Uint8Array => typeof data === "string" ? new TextEncoder().encode(data) : data;

const decode = (data: Uint8Array, encoding: BufferEncoding): string => {
  if (encoding === "base64") {
    let binary = "";
    for (const byte of data) binary += String.fromCharCode(byte);
    return btoa(binary);
  }
  if (encoding === "hex") return [...data].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return new TextDecoder(encoding === "latin1" ? "windows-1252" : "utf-8").decode(data);
};

export class OpfsFileSystem implements HarnessFileSystem {
  readonly #root: Promise<FileSystemDirectoryHandle>;
  constructor(root?: FileSystemDirectoryHandle | Promise<FileSystemDirectoryHandle>) {
    this.#root = Promise.resolve(root ?? navigator.storage.getDirectory());
  }

  async #directory(path: string, create = false): Promise<FileSystemDirectoryHandle> {
    let current = await this.#root;
    for (const part of parts(path)) current = await current.getDirectoryHandle(part, { create });
    return current;
  }
  async #parent(path: string, create = false): Promise<{ directory: FileSystemDirectoryHandle; name: string }> {
    const names = parts(path);
    const name = names.pop();
    if (!name) throw new Error("A file path is required");
    return { directory: await this.#directory(`/${names.join("/")}`, create), name };
  }
  async #file(path: string, create = false): Promise<FileSystemFileHandle> {
    const { directory, name } = await this.#parent(path, create);
    return directory.getFileHandle(name, { create });
  }

  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, options: { encoding: BufferEncoding }): Promise<string>;
  async readFile(path: string, options?: { encoding: BufferEncoding }): Promise<Uint8Array | string> {
    const bytes = new Uint8Array(await (await (await this.#file(path)).getFile()).arrayBuffer());
    return options ? decode(bytes, options.encoding) : bytes;
  }
  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    const writable = await (await this.#file(path, true)).createWritable();
    await writable.write(encode(data) as FileSystemWriteChunkType);
    await writable.close();
  }
  async appendFile(path: string, data: string | Uint8Array): Promise<void> {
    let current: Uint8Array<ArrayBufferLike> = new Uint8Array();
    try { current = await this.readFile(path); } catch { /* New file. */ }
    const addition = encode(data);
    const combined = new Uint8Array(current.length + addition.length);
    combined.set(current); combined.set(addition, current.length);
    await this.writeFile(path, combined);
  }
  async unlink(path: string): Promise<void> { const { directory, name } = await this.#parent(path); await directory.removeEntry(name); }
  async rename(oldPath: string, newPath: string): Promise<void> { await this.copyFile(oldPath, newPath); await this.unlink(oldPath); }
  async copyFile(src: string, dest: string): Promise<void> { await this.writeFile(dest, await this.readFile(src) as Uint8Array); }
  async mkdir(path: string): Promise<string | undefined> { await this.#directory(path, true); return path; }
  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> { await this.rm(path, options); }
  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
    try { const { directory, name } = await this.#parent(path); await directory.removeEntry(name, { recursive: options?.recursive }); }
    catch (error) { if (!options?.force) throw error; }
  }
  readdir(path: string): Promise<string[]>;
  readdir(path: string, options: { withFileTypes: true }): Promise<DirEntry[]>;
  async readdir(path: string, options?: { withFileTypes: true }): Promise<string[] | DirEntry[]> {
    const entries: DirEntry[] = [];
    const directory = await this.#directory(path) as FileSystemDirectoryHandle & {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    };
    for await (const [name, handle] of directory.entries()) {
      entries.push({ name, isFile: () => handle.kind === "file", isDirectory: () => handle.kind === "directory", isSymbolicLink: () => false });
    }
    return options ? entries : entries.map(({ name }) => name);
  }
  async stat(path: string): Promise<FileStat> {
    try {
      const file = await (await this.#file(path)).getFile();
      return { isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false, size: file.size, mtime: new Date(file.lastModified) };
    } catch {
      await this.#directory(path);
      return { isFile: () => false, isDirectory: () => true, isSymbolicLink: () => false, size: 0, mtime: new Date(0) };
    }
  }
  async access(path: string): Promise<void> { await this.stat(path); }
}
