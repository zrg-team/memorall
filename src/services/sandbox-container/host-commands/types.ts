import type { SandboxPythonRunRequest, SandboxPythonRunResult } from "../types";
import type { CurlHttp } from "./curl/http";

export interface HostCommandOutput {
	stdout: string;
	/** stdout byte for byte, for a redirect to a file (curl > image.png). */
	stdoutBytes?: Uint8Array;
	stderr: string;
	exitCode: number;
}

export interface HostFileEntry {
	path: string;
	size: number;
}

/** The host filesystem as host commands see it, by public "/" paths. */
export interface HostFiles {
	isDirectory(path: string): Promise<boolean>;
	exists(path: string): Promise<boolean>;
	/** Files under `dir`, depth first, within the limits. */
	walk(
		dir: string,
		limits: {
			skipDirs: ReadonlySet<string>;
			maxFiles: number;
			maxBytes: number;
		},
	): Promise<{ files: HostFileEntry[]; truncated: boolean }>;
	read(path: string): Promise<Uint8Array>;
	write(path: string, data: Uint8Array | string): Promise<void>;
	append(path: string, data: string): Promise<void>;
	remove(path: string): Promise<void>;
}

export interface HostCommandContext {
	cwd: string;
	env: Record<string, string>;
	files: HostFiles;
	runPython(request: SandboxPythonRunRequest): Promise<SandboxPythonRunResult>;
	/** Longest a command may run, when the caller set one. */
	timeoutMs?: number;
	/** What the command line pipes in (`… | curl -d @-`). */
	stdin?: Uint8Array;
	/** stdout goes to a file or a pipe, not the terminal. */
	stdoutRedirected?: boolean;
	/** HTTP for curl: this computer's servers and, through the browser, the web. */
	http?: CurlHttp;
	/** Tells the sandbox shell and the Files views that files changed. */
	filesChanged(): void;
}

export type HostCommand = (
	argv: string[],
	context: HostCommandContext,
) => Promise<HostCommandOutput>;
