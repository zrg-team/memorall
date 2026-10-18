import type { DesktopVmRuntime } from "./vm-runtime";

export const VM_OPERATIONS = new Set([
	"health",
	"runtime.executeCode",
	"runtime.runFile",
	"runtime.executeCommand",
	"runtime.listenCommand",
	"runtime.sendCommandInput",
	"runtime.stopCommand",
	"runtime.listCommands",
	"runtime.getLogs",
	"runtime.clearLogs",
	"runtime.reset",
	"network.fetch",
	"fs.writeFile",
	"fs.readFile",
	"fs.mkdir",
	"fs.readdir",
	"fs.unlink",
	"fs.rename",
	"fs.exists",
	"sync.state",
	"sync.apply",
	"sync.collect",
	"sync.ack",
	"sync.stubs",
	"sync.packLocal",
	"sync.restoreLocal",
	"npm.install",
	"npm.installFromPackageJson",
	"npm.list",
	"server.start",
	"server.stop",
	"server.list",
	"server.request",
	"server.renderUrl",
	"server.handleSwRequest",
]);
export async function handleVmRequest(
	vm: DesktopVmRuntime,
	method: string,
	params: unknown,
	signal: AbortSignal,
): Promise<unknown> {
	if (!params || typeof params !== "object" || Array.isArray(params))
		throw new Error("Sandbox params must be an object");
	if (signal.aborted) throw new Error("Sandbox request cancelled");
	const values = params as Record<string, unknown>;
	if (method === "sandbox.status") return vm.status();
	if (method === "sandbox.stop") {
		await vm.stop();
		return { stopped: true };
	}
	if (
		method !== "sandbox.request" ||
		typeof values.operation !== "string" ||
		!VM_OPERATIONS.has(values.operation)
	)
		throw new Error("Sandbox operation is not allowed");
	if (
		values.timeoutMs !== undefined &&
		(typeof values.timeoutMs !== "number" ||
			!Number.isSafeInteger(values.timeoutMs) ||
			values.timeoutMs < 1 ||
			values.timeoutMs > 900_000)
	)
		throw new Error("Invalid sandbox timeout");
	return vm.request(
		values.operation,
		values.payload,
		values.timeoutMs as number | undefined,
		signal,
	);
}
