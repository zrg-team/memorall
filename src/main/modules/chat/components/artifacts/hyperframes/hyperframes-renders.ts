import { documentFileSystemService } from "@/services/filesystem/document-filesystem";
import { toDocumentsSandboxPath } from "@/services/filesystem/sandbox-paths";
import { hyperframesRenderPath } from "@/services/flows-integrations/tools/hyperframes/reference";

/**
 * Saves an MP4 exported from a project into its renders folder
 * (`{project}/renders/{project}.mp4`, replacing the last one), where Files,
 * MemonOS and the agent can use it. Returns the saved path.
 */
export const saveHyperframesRender = async (
	projectPath: string,
	blob: Blob,
): Promise<string> => {
	const path = hyperframesRenderPath(projectPath);
	await documentFileSystemService.writeFile(
		toDocumentsSandboxPath(path),
		new Uint8Array(await blob.arrayBuffer()),
	);
	return path;
};
