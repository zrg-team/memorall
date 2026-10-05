import * as almostnode from "almostnode";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	executeCommandSession,
	listenToCommandSession,
	runtimeState,
	sendCommandSessionInput,
	stopAllCommands,
	stopCommandSession,
} from "../../../../public/sandbox/runtime/shared.js";

/** AlmostNode's container, which its typings leave out. */
const createContainer = (
	almostnode as unknown as {
		createContainer: (options: { cwd: string }) => unknown;
	}
).createContainer;
/** The runtime's state, typed for the test. */
const state = runtimeState as unknown as {
	container: unknown;
	commandServers: Map<number, unknown>;
};

interface CommandResult {
	commandId: string;
	completed: boolean;
	status: string;
	exitCode?: number;
	stdout: string;
	stderr: string;
}

interface ListeningServer {
	server: { close?: () => void };
}

interface TestContainer {
	vfs: {
		mkdirSync(path: string, options?: { recursive?: boolean }): void;
		writeFileSync(path: string, content: string): void;
		existsSync(path: string): boolean;
	};
	serverBridge: {
		getServerPorts(): number[];
		servers: Map<number, ListeningServer>;
	};
}

const run = (command: string, waitTimeoutMs: number) =>
	executeCommandSession({
		command,
		cwd: "/app",
		waitTimeoutMs,
	}) as Promise<CommandResult>;

const listen = (commandId: string, waitTimeoutMs = 500) =>
	listenToCommandSession({
		commandId,
		offset: 0,
		waitTimeoutMs,
	}) as Promise<CommandResult>;

/** Waits for a running command's output to contain `text`. */
const outputOf = async (commandId: string, text: string) => {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		const result = await listen(commandId, 100);
		if (result.stdout.includes(text)) return result;
	}
	return listen(commandId, 0);
};

// almostnode wraps the timers and listens for unhandled rejections the way a
// browser does; the test puts Node's back afterwards.
const nodeTimers = {
	setTimeout: globalThis.setTimeout,
	setInterval: globalThis.setInterval,
	clearTimeout: globalThis.clearTimeout,
	clearInterval: globalThis.clearInterval,
};
const browserEvents = globalThis as unknown as {
	addEventListener?: unknown;
	removeEventListener?: unknown;
};
browserEvents.addEventListener ??= () => undefined;
browserEvents.removeEventListener ??= () => undefined;

const container = createContainer({ cwd: "/" }) as unknown as TestContainer;

const SERVER = `const http = require("http");
http.createServer((q, s) => s.end("ok")).listen(8347, () => console.log("serving 8347"));
process.stdin.on("data", (d) => console.log("server got: " + String(d).trim()));`;

describe("sandbox commands side by side", () => {
	beforeEach(() => {
		state.container = container;
		container.vfs.mkdirSync("/app", { recursive: true });
		container.vfs.writeFileSync("/app/server.js", SERVER);
	});

	afterEach(async () => {
		await stopAllCommands();
		for (const port of container.serverBridge.getServerPorts()) {
			container.serverBridge.servers.get(port)?.server.close?.();
		}
		state.commandServers.clear();
		state.container = null;
	});

	afterAll(() => {
		Object.assign(globalThis, nodeTimers);
	});

	it("gives each command its own output, input and stop", async () => {
		container.vfs.writeFileSync(
			"/app/second.js",
			'console.log("second ran"); process.exit(0);',
		);
		const server = await run("node server.js", 300);
		expect(server.completed).toBe(false);

		const second = await run("node second.js", 3_000);
		expect(second).toMatchObject({
			completed: true,
			exitCode: 0,
			stdout: "second ran\n",
		});

		// The server still has its stdin and output.
		await sendCommandSessionInput({
			commandId: server.commandId,
			input: "hello",
			appendNewline: true,
		});
		const served = await outputOf(server.commandId, "server got: hello");
		expect(served.stdout).toBe("serving 8347\nserver got: hello\n");
		expect(served.stdout).not.toContain("second ran");

		await stopCommandSession({ commandId: server.commandId });
		await expect(listen(server.commandId)).resolves.toMatchObject({
			completed: true,
			status: "stopped",
		});
	});

	it("closes a second server and stops its command, naming the one serving", async () => {
		container.vfs.writeFileSync(
			"/app/other.js",
			'require("http").createServer((q, s) => s.end("x")).listen(9000);',
		);
		const server = await run("node server.js", 300);
		await outputOf(server.commandId, "serving 8347");

		const other = await run("node other.js", 3_000);
		expect(other).toMatchObject({ completed: true, exitCode: 1 });
		expect(other.stderr).toContain(
			"Error: listen EADDRINUSE: one server runs at a time, and `node server.js` already serves http://localhost:8347, so port 9000 was closed. Use that server, or stop it first.",
		);
		expect(container.serverBridge.getServerPorts()).toEqual([8347]);
		await expect(listen(server.commandId, 0)).resolves.toMatchObject({
			completed: false,
		});
	});

	it("lets one command serve several ports", async () => {
		container.vfs.writeFileSync(
			"/app/two.js",
			`const http = require("http");
http.createServer((q, s) => s.end("a")).listen(7000);
http.createServer((q, s) => s.end("b")).listen(7001, () => console.log("both"));`,
		);
		const both = await run("node two.js", 300);
		await outputOf(both.commandId, "both");
		expect(container.serverBridge.getServerPorts().sort()).toEqual([
			7000, 7001,
		]);
		await expect(listen(both.commandId, 0)).resolves.toMatchObject({
			completed: false,
		});
	});

	it("checks a script's syntax without running it", async () => {
		container.vfs.writeFileSync(
			"/app/bad.js",
			'import x from "y";\nconst = 5;\n',
		);
		container.vfs.writeFileSync(
			"/app/good.mjs",
			'import x from "y";\nexport const a = x;\n',
		);
		container.vfs.writeFileSync(
			"/app/writes.js",
			'require("fs").writeFileSync("/app/ran.txt", "ran");',
		);

		const bad = await run("node --check bad.js", 3_000);
		expect(bad).toMatchObject({ completed: true, exitCode: 1 });
		expect(bad.stderr).toBe(
			"/app/bad.js:2\nconst = 5;\n      ^\n\nSyntaxError: Unexpected token\n",
		);
		await expect(run("node --check good.mjs", 3_000)).resolves.toMatchObject({
			completed: true,
			exitCode: 0,
		});
		await expect(run("node -c writes.js", 3_000)).resolves.toMatchObject({
			completed: true,
			exitCode: 0,
		});
		expect(container.vfs.existsSync("/app/ran.txt")).toBe(false);
	});
});
