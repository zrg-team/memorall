import type { FsToolConfig } from "@/services/flows-legacy/tools/fs/config";

export interface HyperframesToolConfig extends FsToolConfig {
	rootPath?: string;
	resourceRoots?: string[];
}
