import { test, expect } from "./fixtures";
import { runSandboxOperation } from "./sandbox-job";

test.describe.configure({ mode: "serial" });

test("runtime health and structured JavaScript execution", async ({ extensionPage }) => {
	const health = await runSandboxOperation<{ ready: boolean }>(
		extensionPage,
		"health",
		undefined,
	);
	expect(health.ready).toBe(true);

	const result = await runSandboxOperation<{
		status: string;
		result: string;
		logs: Array<{ level: string; message: string }>;
	}>(extensionPage, "runtime.executeCode", {
		code: "console.log('stdout'); console.error('stderr'); module.exports = 6 * 7",
		maxLogEntries: 20,
	});
	expect(result.status).toBe("ok");
	expect(result.result).toContain("42");
	expect(result.logs.map((entry) => entry.message).join("\n")).toContain("stdout");
	expect(result.logs.map((entry) => entry.message).join("\n")).toContain("stderr");

	const failure = await runSandboxOperation<{ status: string; error: string }>(
		extensionPage,
		"runtime.executeCode",
		{ code: "throw new Error('expected sandbox failure')" },
	);
	expect(failure.status).toBe("error");
	expect(failure.error).toContain("expected sandbox failure");
});

test("workspace file execution, runtime mutation, and flush", async ({ extensionPage }) => {
	await runSandboxOperation(extensionPage, "fs.mkdir", {
		path: "/projects/sandbox-e2e",
		recursive: true,
	});
	await runSandboxOperation(extensionPage, "fs.writeFile", {
		path: "/projects/sandbox-e2e/main.js",
		content: "require('fs').writeFileSync('/projects/sandbox-e2e/generated.txt', 'generated'); module.exports = 21 * 2",
	});
	const execution = await runSandboxOperation<{ status: string; result: string }>(
		extensionPage,
		"runtime.runFile",
		{ path: "/projects/sandbox-e2e/main.js" },
	);
	expect(execution).toMatchObject({ status: "ok", result: expect.stringContaining("42") });

	const generated = await runSandboxOperation<{ content: string }>(
		extensionPage,
		"fs.readFile",
		{ path: "/projects/sandbox-e2e/generated.txt", encoding: "utf8" },
	);
	expect(generated.content).toBe("generated");
	await runSandboxOperation(extensionPage, "fs.flushWorkspaceWrites", undefined);
});

test("filesystem exists, list, rename, delete, and flush", async ({ extensionPage }) => {
	const root = "/projects/sandbox-e2e/fs-operations";
	const originalPath = `${root}/original.txt`;
	const renamedPath = `${root}/renamed.txt`;
	await runSandboxOperation(extensionPage, "fs.mkdir", {
		path: root,
		recursive: true,
	});
	await runSandboxOperation(extensionPage, "fs.writeFile", {
		path: originalPath,
		content: "filesystem lifecycle",
	});
	await expect(
		runSandboxOperation<{ exists: boolean }>(extensionPage, "fs.exists", {
			path: originalPath,
		}),
	).resolves.toMatchObject({ exists: true });
	const directory = await runSandboxOperation<{ entries: string[] }>(
		extensionPage,
		"fs.readdir",
		{ path: root },
	);
	expect(directory.entries).toContain("original.txt");
	await runSandboxOperation(extensionPage, "fs.rename", {
		oldPath: originalPath,
		newPath: renamedPath,
	});
	await expect(
		runSandboxOperation<{ exists: boolean }>(extensionPage, "fs.exists", {
			path: originalPath,
		}),
	).resolves.toMatchObject({ exists: false });
	await expect(
		runSandboxOperation<{ content: string }>(extensionPage, "fs.readFile", {
			path: renamedPath,
			encoding: "utf8",
		}),
	).resolves.toMatchObject({ content: "filesystem lifecycle" });
	await runSandboxOperation(extensionPage, "fs.unlink", { path: renamedPath });
	await expect(
		runSandboxOperation<{ exists: boolean }>(extensionPage, "fs.exists", {
			path: renamedPath,
		}),
	).resolves.toMatchObject({ exists: false });
	await runSandboxOperation(extensionPage, "fs.flushWorkspaceWrites", undefined);
});

test("background command cursor reads and stop", async ({ extensionPage }) => {
	await runSandboxOperation(extensionPage, "fs.writeFile", {
		path: "/projects/sandbox-e2e/process.js",
		content:
			"process.stdin.on('data', (data) => console.log('input:' + String(data).trim()))",
	});
	const started = await runSandboxOperation<{
		commandId: string;
		nextOffset: number;
		completed: boolean;
		stdout: string;
	}>(extensionPage, "runtime.executeCommand", {
		command: "node process.js",
		cwd: "/projects/sandbox-e2e",
		waitTimeoutMs: 1,
	});
	expect(started.commandId).toEqual(expect.any(String));
	expect(started.completed).toBe(false);
	const listed = await runSandboxOperation<{
		commands: Array<{ commandId: string; status: string }>;
	}>(extensionPage, "runtime.listCommands", undefined);
	expect(listed.commands).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ commandId: started.commandId, status: "running" }),
		]),
	);

	await runSandboxOperation(extensionPage, "runtime.sendCommandInput", {
		commandId: started.commandId,
		input: "first",
		appendNewline: true,
	});

	const firstPage = await runSandboxOperation<{
		stdout: string;
		nextOffset: number;
	}>(extensionPage, "runtime.listenCommand", {
		commandId: started.commandId,
		offset: started.nextOffset,
		waitTimeoutMs: 2_000,
	});
	expect(firstPage.nextOffset).toBeGreaterThan(started.nextOffset);
	expect(firstPage.stdout).toContain("input:first");

	await runSandboxOperation(extensionPage, "runtime.sendCommandInput", {
		commandId: started.commandId,
		input: "second",
		appendNewline: true,
	});
	const secondPage = await runSandboxOperation<{
		stdout: string;
		nextOffset: number;
	}>(extensionPage, "runtime.listenCommand", {
		commandId: started.commandId,
		offset: firstPage.nextOffset,
		waitTimeoutMs: 2_000,
	});
	expect(secondPage.nextOffset).toBeGreaterThan(firstPage.nextOffset);
	expect(secondPage.stdout).toContain("input:second");
	await runSandboxOperation(extensionPage, "runtime.stopCommand", {
		commandId: started.commandId,
	});
});

test("snapshot restore preserves code and files", async ({ extensionPage }) => {
	await runSandboxOperation(extensionPage, "fs.writeFile", {
		path: "/projects/sandbox-e2e/state.txt",
		content: "baseline",
	});
	const snapshot = await runSandboxOperation<{ snapshot: unknown }>(
		extensionPage,
		"snapshot.get",
		undefined,
	);
	await runSandboxOperation(extensionPage, "fs.writeFile", {
		path: "/projects/sandbox-e2e/state.txt",
		content: "mutated",
	});
	await runSandboxOperation(extensionPage, "snapshot.restore", {
		snapshot: snapshot.snapshot,
	});
	const restored = await runSandboxOperation<{ content: string }>(
		extensionPage,
		"fs.readFile",
		{ path: "/projects/sandbox-e2e/state.txt", encoding: "utf8" },
	);
	expect(restored.content).toBe("baseline");
});

test("static preview request, render URL, and Runtime Sessions UI", async ({
	extensionContext,
	extensionPage,
}) => {
	await runSandboxOperation(extensionPage, "fs.writeFile", {
		path: "/projects/sandbox-e2e/server.js",
		content:
			"const http=require('http'); http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<main id=ready>Sandbox ready</main>')}).listen(4173);",
	});
	const server = await runSandboxOperation<{ port: number; url: string }>(
		extensionPage,
		"server.start",
		{
			kind: "express",
			port: 4173,
			rootDir: "/projects/sandbox-e2e",
			entryPath: "/projects/sandbox-e2e/server.js",
		},
	);
	expect(server.url).toEqual(expect.any(String));
	const response = await runSandboxOperation<{ status: number; body: string }>(
		extensionPage,
		"server.request",
		{ port: 4173, path: "/", responseType: "html" },
	);
	expect(response).toMatchObject({ status: 200, body: expect.stringContaining("Sandbox ready") });
	const rendered = await runSandboxOperation<{ url: string }>(
		extensionPage,
		"server.renderUrl",
		{ port: 4173, path: "/" },
	);
	const renderUrl = new URL(rendered.url);
	expect(renderUrl.protocol).toBe("chrome-extension:");
	expect(renderUrl.searchParams.get("port")).toBe("4173");
	const previewPage = await extensionContext.newPage();
	await previewPage.goto(rendered.url);
	await expect(previewPage.getByText("Sandbox ready", { exact: true })).toBeVisible();
	await previewPage.close();

	await extensionPage.evaluate(() => {
		history.pushState({}, "", "/runtime");
		window.dispatchEvent(new PopStateEvent("popstate"));
	});
	await expect(extensionPage.getByText("Runtime Sessions", { exact: false }).first()).toBeVisible();
	await expect(extensionPage.getByText("4173", { exact: false }).first()).toBeVisible();
	const servers = await runSandboxOperation<{
		servers: Array<{ port: number }>;
	}>(extensionPage, "server.list", undefined);
	expect(servers.servers).toEqual(
		expect.arrayContaining([expect.objectContaining({ port: 4173 })]),
	);
	await expect(
		runSandboxOperation<{ port: number }>(extensionPage, "server.stop", {
			port: 4173,
		}),
	).resolves.toEqual({ port: 4173 });
	const stoppedServers = await runSandboxOperation<{
		servers: Array<{ port: number }>;
	}>(extensionPage, "server.list", undefined);
	expect(stoppedServers.servers).not.toEqual(
		expect.arrayContaining([expect.objectContaining({ port: 4173 })]),
	);
});

test("service worker restart yields completion or a recoverable error", async ({ extensionContext, extensionPage }) => {
	const [worker] = extensionContext.serviceWorkers();
	expect(worker).toBeDefined();
	const cdp = await extensionContext.newCDPSession(extensionPage);
	const versionId = await new Promise<string>((resolve, reject) => {
		const timeoutId = setTimeout(
			() => reject(new Error(`Service-worker version was not reported for ${worker?.url()}`)),
			10_000,
		);
		cdp.on("ServiceWorker.workerVersionUpdated", ({ versions }) => {
			const version = versions.find(
				(candidate) => candidate.scriptURL === worker?.url() && candidate.runningStatus === "running",
			);
			if (!version) return;
			clearTimeout(timeoutId);
			resolve(version.versionId);
		});
		void cdp.send("ServiceWorker.enable").catch(reject);
	});
	await cdp.send("ServiceWorker.stopWorker", { versionId });
	await cdp.detach();
	const result = await runSandboxOperation<{ status?: string; ready?: boolean }>(
		extensionPage,
		"health",
		undefined,
	);
	expect(result.ready ?? result.status).toBeTruthy();
});

test("persistent REPL, runtime logs, clear, and reset", async ({ extensionPage }) => {
	const repl = await runSandboxOperation<{ replId: string }>(
		extensionPage,
		"runtime.createRepl",
		undefined,
	);
	await runSandboxOperation(extensionPage, "runtime.replEval", {
		replId: repl.replId,
		code: "globalThis.__sandboxE2eCounter = 40",
	});
	const evaluation = await runSandboxOperation<{ status: string; result: string }>(
		extensionPage,
		"runtime.replEval",
		{
			replId: repl.replId,
			code: "globalThis.__sandboxE2eCounter += 2",
		},
	);
	expect(evaluation).toMatchObject({
		status: "ok",
		result: expect.stringContaining("42"),
	});

	await runSandboxOperation(extensionPage, "runtime.executeCode", {
		code: "console.warn('sandbox-log-marker')",
	});
	const logs = await runSandboxOperation<{
		logs: Array<{ level: string; message: string }>;
	}>(extensionPage, "runtime.getLogs", { limit: 100 });
	expect(logs.logs).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ level: "warn", message: "sandbox-log-marker" }),
		]),
	);
	await expect(
		runSandboxOperation<{ cleared: boolean }>(
			extensionPage,
			"runtime.clearLogs",
			undefined,
		),
	).resolves.toEqual({ cleared: true });
	await expect(
		runSandboxOperation<{ logs: unknown[] }>(extensionPage, "runtime.getLogs", {
			limit: 100,
		}),
	).resolves.toEqual({ logs: [] });
	await expect(
		runSandboxOperation<{ reset: boolean }>(
			extensionPage,
			"runtime.reset",
			undefined,
		),
	).resolves.toEqual({ reset: true });
	await expect(
		runSandboxOperation(extensionPage, "runtime.replEval", {
			replId: repl.replId,
			code: "1 + 1",
		}),
	).rejects.toThrow("REPL not found");
});
