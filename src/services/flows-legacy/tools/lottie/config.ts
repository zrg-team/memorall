import type { FsToolConfig } from "@/services/flows-legacy/tools/fs/config";

export interface LottieToolConfig extends FsToolConfig {
	rootPath?: string;
	resourceRoots?: string[];
}
