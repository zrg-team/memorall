import { createBrowserPlatform } from "@memorall/agent-harness-browser";
import type { IFlowFileSystem } from "@memorall/agent-harness-flows/interfaces/services/filesystem";
import {
	type IAgentSandboxService,
	SandboxManager,
	SandboxProviderRegistry,
	SandboxWorkspaceCoordinator,
} from "@memorall/agent-harness-sandbox";
import { platform } from "@/platform/current";
import type { ISandboxContainerService } from "@/services/sandbox-container";
import {
	BROWSER_SANDBOX_PROVIDER_ID,
	BrowserSandboxProvider,
} from "./browser-sandbox-provider";
import {
	DESKTOP_VM_CAPABILITIES,
	DESKTOP_VM_PROVIDER_ID,
} from "./desktop-vm-capabilities";

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
		new BrowserSandboxProvider(
			containerService,
			platform.sandboxRuntime
				? { id: DESKTOP_VM_PROVIDER_ID, capabilities: DESKTOP_VM_CAPABILITIES }
				: {},
		),
	);
	const service = new SandboxManager(
		providers,
		{
			providerId: platform.sandboxRuntime
				? DESKTOP_VM_PROVIDER_ID
				: BROWSER_SANDBOX_PROVIDER_ID,
			sessionPolicy: "reuse-conversation",
		},
		createBrowserPlatform({ runtime: "extension-worker" }),
		new SandboxWorkspaceCoordinator(),
	);
	serviceCache.set(containerService, service);
	return service;
};
