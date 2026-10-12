import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { ChevronDown, ChevronRight, Search, Zap } from "lucide-react";
import { getSupportedModels } from "@/services/llm/registry/model-registry";
import type { WorkspaceMode } from "@/services/llm/interfaces/model-category";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";

interface FileInfo {
	name: string;
	size: number;
}

interface WllamaTabProps {
	category?: WorkspaceMode;
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
	ready: boolean;
	onFetchRepoFiles: (repoInfo: string) => Promise<void>;
	onLoadModel: () => Promise<void>;
	onUnloadModel: () => Promise<void>;
	quickDownloads: React.ReactNode;
}

export const WllamaTab: React.FC<WllamaTabProps> = ({
	category = "chat",
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
	ready,
	onFetchRepoFiles,
	onLoadModel,
	onUnloadModel,
	quickDownloads,
}) => {
	const { t } = useTranslation("llm");
	const [showAdvantages, setShowAdvantages] = React.useState(false);
	React.useEffect(() => {
		const models = getSupportedModels("wllama", category);
		if (!useCustomRepo && !models.some((model) => model.id === repo)) {
			const first = models[0];
			if (first) {
				setRepo(first.id);
				setFilePath(first.wllamaConfig!.filename);
				setAvailableFiles([
					{
						name: first.wllamaConfig!.filename,
						size: first.sizeGB * 1024 ** 3,
					},
				]);
			}
		}
	}, [category, repo, useCustomRepo, setRepo, setFilePath, setAvailableFiles]);
	return (
		<div className="space-y-4">
			<section className="rounded-lg border bg-muted/20">
				<Button
					type="button"
					variant="ghost"
					className="h-auto w-full justify-start gap-2 rounded-none p-3 text-left text-sm font-medium"
					onClick={() => setShowAdvantages((value) => !value)}
				>
					{showAdvantages ? (
						<ChevronDown className="h-4 w-4" />
					) : (
						<ChevronRight className="h-4 w-4" />
					)}
					<Zap className="h-4 w-4 text-primary" />
					{t("wllama.advantagesTitle")}
				</Button>
				{showAdvantages && (
					<ul className="space-y-1 px-4 pb-3 text-xs text-muted-foreground">
						<li>{t("wllama.advantages.wasm")}</li>
						<li>{t("wllama.advantages.cpu")}</li>
						<li>{t("wllama.advantages.huggingFace")}</li>
						<li>{t("wllama.advantages.cache")}</li>
					</ul>
				)}
			</section>

			<section className="space-y-3">
				<div className="text-sm font-semibold">
					{t("yourModels.quickDownload")}
				</div>
				{quickDownloads}
			</section>

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
					{t("wllama.recommendedModels")}
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
					{t("wllama.customRepository")}
				</label>
			</div>

			{!useCustomRepo ? (
				/* Recommended Models */
				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					<div>
						<label className="text-xs text-muted-foreground">
							{t("wllama.modelRepository")}
						</label>
						<Select value={repo} onValueChange={setRepo} disabled={loading}>
							<SelectTrigger className="w-full">
								<SelectValue placeholder={t("wllama.selectRepository")} />
							</SelectTrigger>
							<SelectContent>
								{getSupportedModels("wllama", category)
									.map((model) => model.id)
									.map((r) => (
										<SelectItem key={r} value={r}>
											{r}
										</SelectItem>
									))}
							</SelectContent>
						</Select>
					</div>
					<div>
						<label className="text-xs text-muted-foreground">
							{t("wllama.ggufFilename")}
						</label>
						{availableFiles.length > 0 ? (
							<Select
								value={filePath}
								onValueChange={setFilePath}
								disabled={loading}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder={t("wllama.selectFile")} />
								</SelectTrigger>
								<SelectContent>
									{availableFiles.map((f) => (
										<SelectItem key={f.name} value={f.name}>
											{f.name} (
											{f.size > 0
												? `${(f.size / (1024 * 1024)).toFixed(0)}MB`
												: t("wllama.unknownSize")}
											)
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						) : (
							<Input
								placeholder={t("wllama.filePlaceholder")}
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
							{t("wllama.huggingFaceRepo")}
						</label>
						<div className="flex gap-2">
							<Input
								placeholder={t("wllama.repoPlaceholder")}
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
								{t("wllama.search")}
							</Button>
						</div>
					</div>
					{availableFiles.length > 0 && (
						<div>
							<label className="text-xs text-muted-foreground">
								{t("wllama.availableFiles", { count: availableFiles.length })}
							</label>
							<Select
								value={filePath}
								onValueChange={setFilePath}
								disabled={loading}
							>
								<SelectTrigger className="w-full">
									<SelectValue placeholder={t("wllama.selectFile")} />
								</SelectTrigger>
								<SelectContent>
									{availableFiles.map((f) => (
										<SelectItem key={f.name} value={f.name}>
											{f.name} (
											{f.size > 0
												? `${(f.size / (1024 * 1024)).toFixed(0)}MB`
												: t("wllama.unknownSize")}
											)
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
				</div>
			)}

			<div className="flex gap-2">
				<Button
					onClick={onLoadModel}
					disabled={loading || ready || !repo || !filePath}
				>
					{t("advanced.loadModel")}
				</Button>
				<Button
					onClick={onUnloadModel}
					variant="outline"
					disabled={loading || !ready}
				>
					{t("advanced.unload")}
				</Button>
			</div>
		</div>
	);
};
