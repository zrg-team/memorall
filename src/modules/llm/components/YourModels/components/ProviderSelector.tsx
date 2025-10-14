import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import React from "react";

interface ProviderSelectorProps {
	quickProvider: ServiceProvider;
	setQuickProvider: (provider: ServiceProvider) => void;
	loading: boolean;
}

export const ProviderSelector: React.FC<ProviderSelectorProps> = ({
	quickProvider,
	setQuickProvider,
	loading,
}) => {
	return (
		<div className="flex items-center gap-2">
			<select
				value={quickProvider}
				onChange={(e) => setQuickProvider(e.target.value as ServiceProvider)}
				className="text-xs border rounded px-2 py-1 bg-background"
				disabled={loading}
			>
				<option value="wllama">Wllama (GGUF)</option>
				<option value="webllm">WebLLM (MLC)</option>
				<option value="openai">OpenAI (Cloud)</option>
				<option value="lmstudio">LM Studio (Local)</option>
				<option value="ollama">Ollama (Local)</option>
			</select>
			<span className="text-xs text-muted-foreground">Recommended models</span>
		</div>
	);
};
