import type { FsToolConfig } from "@/services/flows-core/tools/fs/config";

export interface LottieToolConfig extends FsToolConfig {
	rootPath?: string;
	resourceRoots?: string[];
}
