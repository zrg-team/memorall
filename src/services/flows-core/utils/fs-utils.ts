import type { IFlowFileSystem } from "@/services/flows-core/interfaces/services/filesystem";

export const ensureFolderExists = async (
	fs: IFlowFileSystem,
	folderPath: string,
): Promise<void> => {
	if (folderPath === "/" || !folderPath) return;
	const segments = folderPath.split("/").filter(Boolean);
	let currentPath = "/";
	for (const segment of segments) {
		const nextPath = `${currentPath === "/" ? "" : currentPath}/${segment}`;
		try {
			await fs.mkdir(nextPath);
		} catch {
			// Existing folder or virtual FS conflict; continue so callers can write.
		}
		currentPath = nextPath;
	}
};
