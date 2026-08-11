import * as fs from "node:fs/promises";
import type { BufferEncoding, DirEntry, FileStat, HarnessFileSystem } from "@memorall/agent-harness-standard/filesystem";

export class NodeFileSystem implements HarnessFileSystem {
  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, options: { encoding: BufferEncoding }): Promise<string>;
  async readFile(path: string, options?: { encoding: BufferEncoding }): Promise<Uint8Array | string> {
    return options ? fs.readFile(path, { encoding: options.encoding }) : fs.readFile(path);
  }
  async writeFile(path: string, data: string | Uint8Array): Promise<void> { await fs.writeFile(path, data); }
  async appendFile(path: string, data: string | Uint8Array): Promise<void> { await fs.appendFile(path, data); }
  async unlink(path: string): Promise<void> { await fs.unlink(path); }
  async rename(oldPath: string, newPath: string): Promise<void> { await fs.rename(oldPath, newPath); }
  async copyFile(src: string, dest: string): Promise<void> { await fs.copyFile(src, dest); }
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined> { return fs.mkdir(path, options); }
  async rmdir(path: string, options?: { recursive?: boolean }): Promise<void> { await fs.rmdir(path, options); }
  async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> { await fs.rm(path, options); }
  readdir(path: string): Promise<string[]>;
  readdir(path: string, options: { withFileTypes: true }): Promise<DirEntry[]>;
  async readdir(path: string, options?: { withFileTypes: true }): Promise<string[] | DirEntry[]> {
    if (!options) return fs.readdir(path);
    return (await fs.readdir(path, options)).map((entry) => ({
      name: entry.name,
      isFile: () => entry.isFile(),
      isDirectory: () => entry.isDirectory(),
      isSymbolicLink: () => entry.isSymbolicLink(),
    }));
  }
  async stat(path: string): Promise<FileStat> { return fs.stat(path); }
  async access(path: string): Promise<void> { await fs.access(path); }
}
