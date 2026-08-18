import type { ISandboxContainerService } from "@/services/sandbox-container";
import type { IFlowFileSystem } from "@/services/flows-core/interfaces/services/filesystem";
import { createBrowserPlatform } from "@memorall/agent-harness-browser";
import {
	SandboxManager,
	SandboxProviderRegistry,
	SandboxWorkspaceCoordinator,
	type IAgentSandboxService,
} from "@memorall/agent-harness-sandbox";
import {
	BrowserSandboxProvider,
	BROWSER_SANDBOX_PROVIDER_ID,
} from "./browser-sandbox-provider";

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
	const service = new SandboxManager(
		providers,
		{
			providerId: BROWSER_SANDBOX_PROVIDER_ID,
			sessionPolicy: "reuse-conversation",
		},
		createBrowserPlatform({ runtime: "extension-worker" }),
		workspaces,
	);
	serviceCache.set(containerService, { service, workspaces });
	return service;
};
