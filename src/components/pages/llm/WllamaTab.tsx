import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { RECOMMENDATION_WALLAMA_LLMS } from "@/constants/wllama";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

interface FileInfo {
	name: string;
	size: number;
}

interface WllamaTabProps {
	repo: string;
	setRepo: (repo: string) => void;
	filePath: string;
	setFilePath: (filePath: string) => void;
	availableFiles: FileInfo[];
	setAvailableFiles: (files: FileInfo[]) => void;
	customRepo: string;
	setCustomRepo: (repo: string) => void;
	useCustomRepo: boolean;
	setUseCustomRepo: (use: boolean) => void;
	loading: boolean;
	onFetchRepoFiles: (repoInfo: string) => Promise<void>;
}

export const WllamaTab: React.FC<WllamaTabProps> = ({
	repo,
	setRepo,
	filePath,
	setFilePath,
	availableFiles,
	setAvailableFiles,
	customRepo,
	setCustomRepo,
	useCustomRepo,
	setUseCustomRepo,
	loading,
	onFetchRepoFiles,
}) => {
	return (
		<div className="space-y-4">
			{/* Repository Selection Mode */}
			<div className="flex items-center gap-4 p-3 border rounded-lg bg-muted/20">
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						name="repoMode"
						checked={!useCustomRepo}
						onChange={() => {
							setUseCustomRepo(false);
							onFetchRepoFiles(repo);
						}}
						disabled={loading}
					/>
					Recommended Models
				</label>
				<label className="flex items-center gap-2 text-sm">
					<input
						type="radio"
						name="repoMode"
						checked={useCustomRepo}
						onChange={() => {
							setUseCustomRepo(true);
							setAvailableFiles([]);
						}}
						disabled={loading}
					/>
					Custom Repository
				</label>
			</div>

			{!useCustomRepo ? (
				/* Recommended Models */
				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					<div>
						<label className="text-xs text-muted-foreground">
							Model repository
						</label>
						<Select value={repo} onValueChange={setRepo} disabled={loading}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder="Select a model repository..." />
							</SelectTrigger>
							<SelectContent>
								{RECOMMENDATION_WALLAMA_LLMS.map((r) => (
									<SelectItem key={r} value={r}>
										{r}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
					<div>
						<label className="text-xs text-muted-foreground">
							GGUF filename (inside repo)
						</label>
						{availableFiles.length > 0 ? (
							<Select
								value={filePath}
								onValueChange={setFilePath}
								disabled={loading}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Select a file..." />
								</SelectTrigger>
								<SelectContent>
									{availableFiles.map((f) => (
										<SelectItem key={f.name} value={f.name}>
											{f.name} (
											{f.size > 0
												? `${(f.size / (1024 * 1024)).toFixed(0)}MB`
												: "Unknown size"}
											)
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : (
							<Input
								placeholder="e.g., Q4_K_M.gguf or ggml-model-q4_0.gguf"
								value={filePath}
								onChange={(e) => setFilePath(e.target.value)}
								disabled={loading}
							/>
						)}
					</div>
				</div>
			) : (
				/* Custom Repository */
				<div className="space-y-3">
					<div>
						<label className="text-xs text-muted-foreground">
							Hugging Face Repository (username/repo)
						</label>
						<div className="flex gap-2">
							<Input
								placeholder="e.g., microsoft/DialoGPT-medium"
								value={customRepo}
								onChange={(e) => {
									setCustomRepo(e.target.value);
									setAvailableFiles([]);
								}}
								disabled={loading}
							/>
							<Button
								onClick={() => onFetchRepoFiles(customRepo)}
								disabled={loading || !customRepo.trim()}
								size="sm"
								variant="outline"
								className="!h-10"
							>
								<Search size={16} />
								Search
							</Button>
						</div>
					</div>
					{availableFiles.length > 0 && (
						<div>
							<label className="text-xs text-muted-foreground">
								Available GGUF files ({availableFiles.length} found)
							</label>
							<Select
								value={filePath}
								onValueChange={setFilePath}
								disabled={loading}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder="Select a file..." />
								</SelectTrigger>
								<SelectContent>
									{availableFiles.map((f) => (
										<SelectItem key={f.name} value={f.name}>
											{f.name} (
											{f.size > 0
												? `${(f.size / (1024 * 1024)).toFixed(0)}MB`
												: "Unknown size"}
											)
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
				</div>
			)}
		</div>
	);
};
