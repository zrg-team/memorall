import type { FsToolConfig } from "@memorall/agent-harness-flows/tools/fs/config";

export interface HyperframesToolConfig extends FsToolConfig {
	rootPath?: string;
	resourceRoots?: string[];
}
