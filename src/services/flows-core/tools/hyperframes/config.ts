import type { FsToolConfig } from "flow-core/tools/fs/config";

export interface HyperframesToolConfig extends FsToolConfig {
	rootPath?: string;
	resourceRoots?: string[];
}
