import type { FsToolConfig } from "@/services/flows-core/tools/fs/config";

export interface HyperframesToolConfig extends FsToolConfig {
	rootPath?: string;
	resourceRoots?: string[];
}
