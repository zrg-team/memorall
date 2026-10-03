import { serviceManager } from "@/services";
import type {
	ISandboxContainerService,
	SandboxOperation,
	SandboxOperationPayloadMap,
} from "@/services/sandbox-container";
import { backgroundProcessFactory } from "./process-factory";
import type {
	BaseJob,
	ItemHandlerResult,
	ProcessDependencies,
	ProcessHandler,
} from "./types";

export const SANDBOX_OPERATION_JOB_NAME = "sandbox-operation" as const;

export type SandboxOperationJobPayload = {
	[K in SandboxOperation]: {
		operation: K;
		payload: SandboxOperationPayloadMap[K];
	};
}[SandboxOperation];

export interface SandboxOperationJobResult extends Record<string, unknown> {
	operation: SandboxOperation;
	result: unknown;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null;

const isSandboxOperationPayload = (
	value: unknown,
): value is SandboxOperationJobPayload => {
	if (!isObject(value)) {
		return false;
	}
	return typeof value.operation === "string";
};

export class SandboxOperationsHandler implements ProcessHandler<BaseJob> {
	private getSandboxContainerService(): ISandboxContainerService {
		return serviceManager.getSandboxContainerService();
	}

	async process(
		jobId: string,
		job: BaseJob,
		dependencies: ProcessDependencies,
	): Promise<ItemHandlerResult> {
		const { logger } = dependencies;
		if (!isSandboxOperationPayload(job.payload)) {
			throw new Error("Invalid sandbox-operation payload");
		}

		const { operation } = job.payload;
		await logger.info(
			"Starting sandbox operation",
			{ jobId, operation },
			"offscreen",
		);

		const result = await this.runWithStrongTypes(job.payload);

		await logger.info(
			"Completed sandbox operation",
			{ jobId, operation },
			"offscreen",
		);

		return {
			operation,
			result,
		};
	}

	private async runWithStrongTypes(
		payload: SandboxOperationJobPayload,
	): Promise<unknown> {
		const sandboxContainerService = this.getSandboxContainerService();

		switch (payload.operation) {
			case "health":
				return sandboxContainerService.health();
			case "runtime.executeCode":
				return sandboxContainerService.executeCode(payload.payload);
			case "runtime.runFile":
				return sandboxContainerService.runFile(payload.payload);
			case "runtime.executeCommand":
				return sandboxContainerService.executeCommand(payload.payload);
			case "runtime.listenCommand":
				return sandboxContainerService.listenCommand(payload.payload);
			case "runtime.sendCommandInput":
				return sandboxContainerService.sendCommandInput(payload.payload);
			case "runtime.stopCommand":
				return sandboxContainerService.stopCommand(payload.payload);
			case "runtime.listCommands":
				return sandboxContainerService.listCommands();
			case "runtime.createRepl":
				return sandboxContainerService.createRepl();
			case "runtime.replEval":
				return sandboxContainerService.replEval(payload.payload);
			case "runtime.getLogs":
				return sandboxContainerService.getLogs(payload.payload);
			case "runtime.clearLogs":
				return sandboxContainerService.clearLogs();
			case "network.fetch":
				return sandboxContainerService.fetchResource(payload.payload);
			case "fs.writeFile":
				return sandboxContainerService.writeFile(payload.payload);
			case "fs.readFile":
				return sandboxContainerService.readFile(payload.payload);
			case "fs.mkdir":
				return sandboxContainerService.mkdir(payload.payload);
			case "fs.readdir":
				return sandboxContainerService.readdir(payload.payload);
			case "fs.unlink":
				return sandboxContainerService.unlink(payload.payload);
			case "fs.rename":
				return sandboxContainerService.rename(payload.payload);
			case "fs.exists":
				return sandboxContainerService.exists(payload.payload);
			case "npm.install":
				return sandboxContainerService.installPackage(payload.payload);
			case "npm.installFromPackageJson":
				return sandboxContainerService.installFromPackageJson(payload.payload);
			case "npm.list":
				return sandboxContainerService.listInstalledPackages();
			case "server.start":
				return sandboxContainerService.startServer(payload.payload);
			case "server.stop":
				return sandboxContainerService.stopServer(payload.payload);
			case "server.list":
				return sandboxContainerService.listServers();
			case "server.request":
				return sandboxContainerService.requestServer(payload.payload);
			case "server.renderUrl":
				return sandboxContainerService.getServerRenderUrl(payload.payload);
			case "server.handleSwRequest":
				// With the retry that sends a file the sandbox lacked, then asks again.
				return sandboxContainerService.handleSwRequestWithRetry(
					payload.payload,
				);
			case "snapshot.get":
				return sandboxContainerService.getSnapshot();
			case "snapshot.restore":
				return sandboxContainerService.restoreSnapshot(payload.payload);
			case "runtime.reset":
				return sandboxContainerService.request(
					"runtime.reset",
					payload.payload,
				);
			default: {
				throw new Error(`Unsupported sandbox operation payload`);
			}
		}
	}
}

backgroundProcessFactory.register({
	instance: new SandboxOperationsHandler(),
	jobs: [SANDBOX_OPERATION_JOB_NAME],
});

declare global {
	interface JobTypeRegistry {
		[SANDBOX_OPERATION_JOB_NAME]: SandboxOperationJobPayload;
	}

	interface JobResultRegistry {
		[SANDBOX_OPERATION_JOB_NAME]: SandboxOperationJobResult;
	}
}
