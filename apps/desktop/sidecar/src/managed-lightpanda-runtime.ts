import { spawn, type ChildProcess } from "node:child_process";
import { access } from "node:fs/promises";
import { createServer, connect } from "node:net";
import { BrowserAutomationError } from "./browser-runtime-types";

const freePort = async (): Promise<number> =>
	await new Promise((resolve, reject) => {
		const server = createServer();
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				server.close();
				reject(new Error("Failed to reserve a loopback port."));
				return;
			}
			server.close((error) => (error ? reject(error) : resolve(address.port)));
		});
	});

const waitForPort = async (
	port: number,
	child: ChildProcess,
): Promise<void> => {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		if (child.exitCode !== null)
			throw new Error(`Lightpanda exited with code ${String(child.exitCode)}.`);
		const ready = await new Promise<boolean>((resolve) => {
			const socket = connect({ host: "127.0.0.1", port });
			const settle = (value: boolean) => {
				socket.destroy();
				resolve(value);
			};
			socket.once("connect", () => settle(true));
			socket.once("error", () => settle(false));
			socket.setTimeout(200, () => settle(false));
		});
		if (ready) return;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error("Timed out waiting for Lightpanda MCP.");
};

export class ManagedLightpandaRuntime {
	private child: ChildProcess | null = null;
	private endpoint: string | null = null;
	private starting: Promise<string> | null = null;

	async ensure(): Promise<string> {
		if (process.env.MEMORALL_LIGHTPANDA_MCP_URL) {
			return process.env.MEMORALL_LIGHTPANDA_MCP_URL;
		}
		if (this.endpoint && this.child?.exitCode === null) return this.endpoint;
		if (!this.starting) this.starting = this.start();
		try {
			return await this.starting;
		} finally {
			this.starting = null;
		}
	}

	async stop(): Promise<void> {
		const child = this.child;
		this.child = null;
		this.endpoint = null;
		if (!child || child.exitCode !== null || !child.pid) return;
		if (process.platform === "win32") {
			await new Promise<void>((resolve) => {
				const killer = spawn(
					"taskkill",
					["/PID", String(child.pid), "/T", "/F"],
					{
						stdio: "ignore",
						windowsHide: true,
					},
				);
				killer.once("exit", () => resolve());
				killer.once("error", () => {
					child.kill();
					resolve();
				});
			});
		} else {
			try {
				process.kill(-child.pid, "SIGTERM");
			} catch {
				child.kill("SIGTERM");
			}
		}
	}

	private async start(): Promise<string> {
		const executable = process.env.MEMORALL_LIGHTPANDA_PATH;
		if (!executable) {
			throw new BrowserAutomationError(
				"LIGHTPANDA_NOT_CONFIGURED",
				"The optional Lightpanda runtime path was not provided.",
			);
		}
		try {
			await access(executable);
		} catch {
			throw new BrowserAutomationError(
				"LIGHTPANDA_NOT_CONFIGURED",
				`The optional Lightpanda executable is not packaged: ${executable}`,
			);
		}
		const port = await freePort();
		const child = spawn(
			executable,
			[
				"mcp",
				"--host",
				"127.0.0.1",
				"--port",
				String(port),
				"--log-level",
				"warn",
			],
			{
				stdio: "ignore",
				windowsHide: true,
				detached: process.platform !== "win32",
			},
		);
		this.child = child;
		try {
			await waitForPort(port, child);
			this.endpoint = `http://127.0.0.1:${port}/mcp`;
			return this.endpoint;
		} catch (error) {
			await this.stop();
			throw new BrowserAutomationError(
				"LIGHTPANDA_START_FAILED",
				error instanceof Error ? error.message : String(error),
			);
		}
	}
}
