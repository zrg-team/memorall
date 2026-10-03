import type { ISandboxContainerService } from "@/services/sandbox-container";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
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
	IAgentSandboxService
>();

/**
 * The agent's sandbox. `_fileSystem` is accepted and not used: the container
 * keeps the sandbox's files in step with the documents filesystem itself,
 * change by change. Given to the harness's coordinator, it would read and
 * hash every file of that filesystem before and after each run.
 */
export const createAgentSandboxService = (
	containerService: ISandboxContainerService,
	_fileSystem?: IFlowFileSystem,
): IAgentSandboxService => {
	const cached = serviceCache.get(containerService);
	if (cached) return cached;
	const providers = new SandboxProviderRegistry().register(
		new BrowserSandboxProvider(containerService),
	);
	const service = new SandboxManager(
		providers,
		{
			providerId: BROWSER_SANDBOX_PROVIDER_ID,
			sessionPolicy: "reuse-conversation",
		},
		createBrowserPlatform({ runtime: "extension-worker" }),
		new SandboxWorkspaceCoordinator(),
	);
	serviceCache.set(containerService, service);
	return service;
};
