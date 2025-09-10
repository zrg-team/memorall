import { useEffect } from "react";

interface UseRepoEffectProps {
	repo: string;
	fetchRepoFiles: (repoInfo: string) => Promise<void>;
	setAvailableFiles: (files: any[]) => void;
	setFilePath: (filePath: string) => void;
	setStatus: (status: string) => void;
}

export const useRepoEffect = ({
	repo,
	fetchRepoFiles,
	setAvailableFiles,
	setFilePath,
	setStatus,
}: UseRepoEffectProps) => {
	// When repo changes, fetch available file list (only for wllama)
	useEffect(() => {
		if (!repo) return;
		const [username, r] = (repo || "").split("/");
		const repoInfo = username && r ? `${username}/${r}` : "";
		if (repoInfo) {
			fetchRepoFiles(repoInfo);
		} else {
			setAvailableFiles([]);
			setFilePath("");
			setStatus("Select a model repository");
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [repo]);
};
