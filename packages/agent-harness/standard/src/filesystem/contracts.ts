import { createServiceToken } from "@memorall/agent-harness-core";

export type BufferEncoding = "utf8" | "utf-8" | "base64" | "hex" | "latin1";

export interface FileStat {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
  mtime: Date;
}

export interface DirEntry {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export interface HarnessFileSystem {
  readFile(path: string): Promise<Uint8Array>;
  readFile(path: string, options: { encoding: BufferEncoding }): Promise<string>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  appendFile(path: string, data: string | Uint8Array): Promise<void>;
  unlink(path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  copyFile(src: string, dest: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
  rmdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  readdir(path: string, options: { withFileTypes: true }): Promise<DirEntry[]>;
  stat(path: string): Promise<FileStat>;
  access(path: string): Promise<void>;
}

export const FILESYSTEM_SERVICE = createServiceToken<HarnessFileSystem>("fs", {
  description: "Agent workspace filesystem",
});
