/**
 * fx's workspace in MemonOS: its shell commands run in the Memon sandbox, the
 * one the Terminal and pi code use, on the agent's Memon files.
 *
 * fx's WebAssembly build has no file system of its own. It does everything
 * through its `shell` tool, which calls `exec` here, and reads instruction
 * files (AGENTS.md) through `readFile`. The home's AGENTS.md is written by
 * Memorall: what this computer is, and the skills the agent has, followed by
 * whatever the user keeps in their own ~/.fx/AGENTS.md.
 */

import type {
	IAgentSandboxService,
	SandboxOutputEvent,
} from "@memorall/agent-harness-sandbox";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import { fxDir } from "./fx-stores";

/** How long one sandbox call waits for more output before returning. */
const OUTPUT_WAIT_MS = 1_000;

export interface FxExecResult {
	exitCode: number;
	stdout: string;
	stderr: string;
}

/** The workspace contract fx's terminal takes (libfx `FxWorkspace`, version 1). */
export interface FxWorkspaceAdapter {
	info: {
		version: 1;
		root: string;
		cwd: string;
		home: string;
		gitAvailable: false;
		ephemeral: true;
	};
	permission: "allow-sandboxed" | "prompt";
	exec(request: {
		command: string;
		cwd: string;
		signal: AbortSignal;
		timeoutMs: number;
		outputLimitBytes: number;
	}): Promise<FxExecResult>;
	readFile(request: {
		path: string;
		signal: AbortSignal;
	}): Promise<string | null>;
}

const operationId = (label: string): string =>
	`fx:${label}:${Math.random().toString(36).slice(2, 10)}`;

/** Text cut to `limit` UTF-8 bytes, saying so when it was. */
const limitBytes = (text: string, limit: number): string => {
	const bytes = new TextEncoder().encode(text);
	if (bytes.length <= limit) return text;
	const kept = new TextDecoder().decode(
		bytes.subarray(0, Math.max(0, limit - 64)),
	);
	return `${kept.replace(/�$/, "")}\n[output cut at ${limit} bytes]`;
};

/** One command in the Memon sandbox, its output read until it ends. */
export const runSandboxCommand = async (
	sandbox: IAgentSandboxService,
	request: {
		command: string;
		cwd: string;
		env?: Record<string, string>;
		signal: AbortSignal;
		timeoutMs: number;
		outputLimitBytes: number;
	},
	sessionKey: string,
): Promise<FxExecResult> => {
	let stdout = "";
	let stderr = "";
	const collect = (events: SandboxOutputEvent[]) => {
		for (const event of events) {
			if (event.type === "stdout" && event.text) stdout += event.text;
			else if (event.type === "stderr" && event.text) stderr += event.text;
		}
	};
	let processId: string | undefined;
	const stop = () => {
		if (!processId) return;
		void sandbox
			.process(
				{ operation: "stop", processId },
				{ operationId: operationId("stop"), sessionKey },
			)
			.catch(() => {});
	};
	request.signal.addEventListener("abort", stop, { once: true });
	const finish = (exitCode: number): FxExecResult => ({
		exitCode,
		stdout: limitBytes(stdout, request.outputLimitBytes),
		stderr: limitBytes(stderr, request.outputLimitBytes),
	});

	try {
		const deadline = Date.now() + request.timeoutMs;
		const started = await sandbox.run(
			{
				operation: "command",
				command: request.command,
				cwd: request.cwd,
				env: request.env,
				waitTimeoutMs: OUTPUT_WAIT_MS,
				commandTimeoutMs: request.timeoutMs,
			},
			{ operationId: operationId("run"), sessionKey, signal: request.signal },
		);
		if (started.kind !== "command") {
			throw new Error("The sandbox returned a non-command result.");
		}
		processId = started.processId;
		if (request.signal.aborted) stop();
		collect(started.events);

		let { status, exitCode } = started;
		let cursor = started.nextCursor;
		while (status === "running" && !request.signal.aborted) {
			if (Date.now() > deadline) {
				stop();
				stderr += `\n[stopped after ${Math.round(request.timeoutMs / 1000)}s]`;
				return finish(124);
			}
			const read = await sandbox.process(
				{ operation: "read", processId, cursor, waitMs: OUTPUT_WAIT_MS },
				{ operationId: operationId("read"), sessionKey },
			);
			if (!("events" in read)) break;
			collect(read.events);
			cursor = read.nextCursor;
			status = read.status;
			exitCode = read.exitCode;
		}
		if (request.signal.aborted) return finish(130);
		if (exitCode !== undefined && exitCode !== null) return finish(exitCode);
		return finish(status === "completed" ? 0 : 1);
	} finally {
		request.signal.removeEventListener("abort", stop);
	}
};

export interface FxWorkspaceOptions {
	fs: IFlowFileSystem;
	getSandbox: () => Promise<IAgentSandboxService>;
	sessionKey: string;
	home: string;
	/** Where fx works: its project root and every command's folder. */
	root: string;
	/** What Memorall tells fx before the user's own ~/.fx/AGENTS.md. */
	instructions: () => Promise<string>;
}

export const fxHomeInstructionsPath = (home: string): string =>
	`${fxDir(home)}/AGENTS.md`;

export const createFxWorkspace = (
	options: FxWorkspaceOptions,
): FxWorkspaceAdapter => {
	const { fs, home, root } = options;
	const readText = (path: string) =>
		fs.readFile(path, { encoding: "utf8" }).catch(() => null);
	return {
		info: {
			version: 1,
			root,
			cwd: root,
			home,
			gitAvailable: false,
			ephemeral: true,
		},
		// Commands run without fx asking: the Memon sandbox is the boundary, as
		// it is for pi code. fx's own modes cannot guard them in its WebAssembly
		// build (libfx 0.0.14): auto mode has no reviewer and holds every
		// command, and ask mode's approval prompt crashes the page it runs in,
		// which here is the one that runs Memorall's services.
		permission: "allow-sandboxed",
		async exec(request) {
			return runSandboxCommand(
				await options.getSandbox(),
				{ ...request, cwd: request.cwd || root, env: { HOME: home } },
				options.sessionKey,
			);
		},
		async readFile({ path }) {
			if (path === fxHomeInstructionsPath(home)) {
				const own = await readText(path);
				return [await options.instructions(), own?.trim()]
					.filter(Boolean)
					.join("\n\n");
			}
			return readText(path);
		},
	};
};
