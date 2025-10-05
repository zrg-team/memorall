import React from "react";

interface ProviderTabsProps {
	advancedProvider: "wllama" | "webllm" | "openai" | "lmstudio" | "ollama";
	setAdvancedProvider: (
		provider: "wllama" | "webllm" | "openai" | "lmstudio" | "ollama",
	) => void;
	loading: boolean;
	onProviderChange: () => void;
	onWebLLMTabSelect: (webllmAvailableModels: string[]) => void;
	webllmAvailableModels: string[];
	onOpenAITabSelect: () => void;
}

export const ProviderTabs: React.FC<ProviderTabsProps> = ({
	advancedProvider,
	setAdvancedProvider,
	loading,
	onProviderChange,
	onWebLLMTabSelect,
	webllmAvailableModels,
	onOpenAITabSelect,
}) => {
	return (
		<div className="flex border-b overflow-x-auto">
			<button
				onClick={() => {
					setAdvancedProvider("wllama");
					if (advancedProvider !== "wllama") {
						onProviderChange();
					}
				}}
				className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
					advancedProvider === "wllama"
						? "border-primary text-primary"
						: "border-transparent text-muted-foreground hover:text-foreground"
				}`}
				disabled={loading}
			>
				Wllama (GGUF)
			</button>
			<button
				onClick={() => {
					setAdvancedProvider("webllm");
					if (advancedProvider !== "webllm") {
						onProviderChange();
						onWebLLMTabSelect(webllmAvailableModels);
					}
				}}
				className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
					advancedProvider === "webllm"
						? "border-primary text-primary"
						: "border-transparent text-muted-foreground hover:text-foreground"
				}`}
				disabled={loading}
			>
				WebLLM (MLC)
			</button>
			<button
				onClick={() => {
					setAdvancedProvider("openai");
					if (advancedProvider !== "openai") {
						onProviderChange();
						onOpenAITabSelect();
					}
				}}
				className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
					advancedProvider === "openai"
						? "border-primary text-primary"
						: "border-transparent text-muted-foreground hover:text-foreground"
				}`}
				disabled={loading}
			>
				OpenAI
			</button>
			<button
				onClick={() => {
					setAdvancedProvider("lmstudio");
					if (advancedProvider !== "lmstudio") {
						onProviderChange();
					}
				}}
				className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
					advancedProvider === "lmstudio"
						? "border-primary text-primary"
						: "border-transparent text-muted-foreground hover:text-foreground"
				}`}
				disabled={loading}
			>
				LM Studio
			</button>
			<button
				onClick={() => {
					setAdvancedProvider("ollama");
					if (advancedProvider !== "ollama") {
						onProviderChange();
					}
				}}
				className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
					advancedProvider === "ollama"
						? "border-primary text-primary"
						: "border-transparent text-muted-foreground hover:text-foreground"
				}`}
				disabled={loading}
			>
				Ollama
			</button>
		</div>
	);
};
