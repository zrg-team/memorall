import type { ISandboxContainerService } from "@/services/sandbox-container";
import type { IFlowFileSystem } from "flow-core/interfaces/services/filesystem";
import type { IAgentSandboxService } from "flow-core/interfaces/services/agent-sandbox";
import {
	BrowserSandboxProvider,
	BROWSER_SANDBOX_PROVIDER_ID,
} from "./browser-sandbox-provider";
import { SandboxManager } from "./sandbox-manager";
import { SandboxProviderRegistry } from "./provider-registry";
import { SandboxWorkspaceCoordinator } from "./workspace-coordinator";

export * from "./browser-sandbox-provider";
export * from "./provider-registry";
export * from "./sandbox-manager";
export * from "./workspace-coordinator";

const serviceCache = new WeakMap<
	ISandboxContainerService,
	{ service: IAgentSandboxService; workspaces: SandboxWorkspaceCoordinator }
>();

export const createAgentSandboxService = (
	containerService: ISandboxContainerService,
	fileSystem?: IFlowFileSystem,
): IAgentSandboxService => {
	const cached = serviceCache.get(containerService);
	if (cached) {
		if (fileSystem) cached.workspaces.setFileSystem(fileSystem);
		return cached.service;
	}
	const providers = new SandboxProviderRegistry().register(
		new BrowserSandboxProvider(containerService),
	);
	const workspaces = new SandboxWorkspaceCoordinator(fileSystem);
	const service = new SandboxManager(providers, {
		providerId: BROWSER_SANDBOX_PROVIDER_ID,
		sessionPolicy: "reuse-conversation",
	}, workspaces);
	serviceCache.set(containerService, { service, workspaces });
	return service;
};
