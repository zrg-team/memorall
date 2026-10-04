/**
 * pi's bash, run in the Memon sandbox: the same almostnode shell and host
 * commands (git, python, curl, ...) the Memon Terminal uses. Output streams
 * by polling the sandbox process; aborting or timing out stops it.
 */
import type {
	IAgentSandboxService,
	SandboxOutputEvent,
} from "@memorall/agent-harness-sandbox";
import type { BashOperations } from "../coding-agent/core/tools/bash";

/** How long one sandbox call waits for more output before returning. */
const OUTPUT_WAIT_MS = 1_000;

const operationId = (label: string): string =>
	`pi-code:${label}:${Math.random().toString(36).slice(2, 10)}`;

export function createSandboxBashOperations(
	getSandbox: () => Promise<IAgentSandboxService>,
	sessionKey: string,
): BashOperations {
	return {
		async exec(command, cwd, { onData, signal, timeout, env }) {
			if (signal?.aborted) throw new Error("aborted");
			const sandbox = await getSandbox();
			const encoder = new TextEncoder();
			const emit = (events: SandboxOutputEvent[]) => {
				for (const event of events) {
					if (
						(event.type === "stdout" || event.type === "stderr") &&
						event.text
					) {
						onData(encoder.encode(event.text));
					}
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
			signal?.addEventListener("abort", stop, { once: true });

			try {
				const timeoutMs = timeout && timeout > 0 ? timeout * 1000 : undefined;
				const deadline = timeoutMs ? Date.now() + timeoutMs : undefined;
				const started = await sandbox.run(
					{
						operation: "command",
						command,
						cwd,
						env: env && Object.keys(env).length > 0 ? env : undefined,
						waitTimeoutMs: OUTPUT_WAIT_MS,
						commandTimeoutMs: timeoutMs,
					},
					{ operationId: operationId("run"), sessionKey, signal },
				);
				if (started.kind !== "command") {
					throw new Error("The sandbox returned a non-command result.");
				}
				processId = started.processId;
				if (signal?.aborted) stop();
				emit(started.events);

				let { status, exitCode } = started;
				let cursor = started.nextCursor;
				while (status === "running" && !signal?.aborted) {
					if (deadline && Date.now() > deadline) {
						stop();
						throw new Error(`timeout:${timeout}`);
					}
					const read = await sandbox.process(
						{ operation: "read", processId, cursor, waitMs: OUTPUT_WAIT_MS },
						{ operationId: operationId("read"), sessionKey },
					);
					if (!("events" in read)) break;
					emit(read.events);
					cursor = read.nextCursor;
					status = read.status;
					exitCode = read.exitCode;
				}

				if (signal?.aborted) throw new Error("aborted");
				if (exitCode !== undefined) return { exitCode };
				return {
					exitCode:
						status === "completed" ? 0 : status === "stopped" ? null : 1,
				};
			} finally {
				signal?.removeEventListener("abort", stop);
			}
		},
	};
}
