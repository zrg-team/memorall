import type { FsToolConfig } from "flow-core/tools/fs/config";

export interface LottieToolConfig extends FsToolConfig {
	rootPath?: string;
	resourceRoots?: string[];
}
