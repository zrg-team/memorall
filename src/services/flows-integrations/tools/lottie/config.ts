import type { FsToolConfig } from "@memorall/agent-harness-flows/tools/fs/config";

export interface LottieToolConfig extends FsToolConfig {
	rootPath?: string;
	resourceRoots?: string[];
}
