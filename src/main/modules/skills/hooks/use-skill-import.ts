import React from "react";
import {
	skillFileSystemService,
	type SkillImportCandidate,
} from "@/services/filesystem/skill-filesystem";
import { logError } from "@/utils/logger";

/**
 * The file/folder import entry points, shared by the Skills page and the
 * agent-config picker so both produce the same review step.
 *
 * Planning is deliberately separate from writing: every lane hands back
 * candidates for the user to confirm before anything touches the sandbox.
 */
export const useSkillImport = (
	onPlanned: (candidates: SkillImportCandidate[]) => void,
) => {
	const [isPlanning, setIsPlanning] = React.useState(false);

	const planFromFileList = React.useCallback(
		async (files: File[], folder: boolean) => {
			setIsPlanning(true);
			try {
				onPlanned(
					folder
						? await skillFileSystemService.planFolderImport(files)
						: await skillFileSystemService.planFileImport(files),
				);
			} catch (error) {
				logError("Failed to read the selected skills:", error);
				onPlanned([]);
			} finally {
				setIsPlanning(false);
			}
		},
		[onPlanned],
	);

	const pickFiles = React.useCallback(
		(folder: boolean) => {
			const input = document.createElement("input");
			input.type = "file";
			input.multiple = true;
			if (folder) {
				// Non-standard but universally supported; the DOM types don't know it.
				(
					input as HTMLInputElement & { webkitdirectory: boolean }
				).webkitdirectory = true;
			} else {
				input.accept = ".md";
			}
			input.onchange = (event) => {
				const list = (event.target as HTMLInputElement).files;
				if (list?.length) void planFromFileList([...list], folder);
			};
			input.click();
		},
		[planFromFileList],
	);

	/** A dropped directory arrives with `webkitRelativePath` set on its members. */
	const planFromDrop = React.useCallback(
		async (files: File[]) => {
			if (!files.length) return;
			const looksLikeFolder = files.some(
				(file) =>
					(file as File & { webkitRelativePath?: string }).webkitRelativePath,
			);
			await planFromFileList(files, looksLikeFolder);
		},
		[planFromFileList],
	);

	return { isPlanning, pickFiles, planFromFileList, planFromDrop };
};
