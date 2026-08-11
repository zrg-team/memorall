import { createBrowserPlatform } from "@memorall/agent-harness-browser";
import {
	SandboxManager as StandaloneSandboxManager,
	type SandboxManagerConfig,
	type SandboxProviderRegistry,
	type SandboxWorkspaceCoordinator,
} from "@memorall/agent-harness-sandbox";

export type { SandboxManagerConfig } from "@memorall/agent-harness-sandbox";

/** @deprecated Import SandboxManager from @memorall/agent-harness-sandbox. */
export class SandboxManager extends StandaloneSandboxManager {
	constructor(
		providers: SandboxProviderRegistry,
		config: SandboxManagerConfig,
		workspaces?: SandboxWorkspaceCoordinator,
	) {
		super(
			providers,
			config,
			createBrowserPlatform({ runtime: "extension-worker" }),
			workspaces,
		);
	}
}
