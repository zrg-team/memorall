/**
 * Files the user brings to the computer: picked with a file dialog or dropped
 * on a window. They are saved to the documents tree the computer's Files app
 * shows, so the agent can open them by path.
 */

/** Opens the file dialog; resolves with the picked files (none if cancelled). */
export const pickFiles = (
	options: { accept?: string; multiple?: boolean } = {},
): Promise<File[]> =>
	new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.multiple = options.multiple ?? true;
		if (options.accept) input.accept = options.accept;
		input.onchange = () => resolve(Array.from(input.files ?? []));
		input.oncancel = () => resolve([]);
		input.click();
	});

/**
 * Saves files into a folder of Files and returns their paths. A name that is
 * taken gets a numbered copy, like an upload on the Files page.
 */
export const uploadToComputer = async (
	files: File[],
	dir: string,
): Promise<string[]> => {
	const [{ documentFileSystemService }, { toDocumentsSandboxPath }] =
		await Promise.all([
			import("@/services/filesystem/document-filesystem"),
			import("@/services/filesystem/sandbox-paths"),
		]);
	const paths: string[] = [];
	for (const file of files) {
		const saved = await documentFileSystemService.uploadFile(
			file,
			toDocumentsSandboxPath(dir),
		);
		paths.push(saved.path);
	}
	return paths;
};
