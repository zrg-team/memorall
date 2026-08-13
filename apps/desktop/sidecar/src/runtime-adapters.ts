import { NodeLocalSandboxProvider } from "@memorall/agent-harness-node";
import { createSanitizedEnvironment } from "./approval-policy";

export interface ManagedRuntimePaths {
	nodeExecutable: string;
	npmExecutable: string;
	temporaryDirectory: string;
}

export function createManagedLocalExecutor(
	paths: ManagedRuntimePaths,
	sourceEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): NodeLocalSandboxProvider {
	return new NodeLocalSandboxProvider({
		id: "memorall-desktop-local-executor",
		nodeExecutable: paths.nodeExecutable,
		npmExecutable: paths.npmExecutable,
		temporaryDirectory: paths.temporaryDirectory,
		environment: createSanitizedEnvironment(sourceEnvironment, [
			"PATH",
			"LANG",
			"LC_ALL",
			"SYSTEMROOT",
			"TEMP",
			"TMP",
		]),
	});
}
