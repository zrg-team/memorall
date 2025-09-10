import React from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

interface WebLLMTabProps {
	webllmModel: string;
	setWebllmModel: (model: string) => void;
	webllmAvailableModels: string[];
	loading: boolean;
}

export const WebLLMTab: React.FC<WebLLMTabProps> = ({
	webllmModel,
	setWebllmModel,
	webllmAvailableModels,
	loading,
}) => {
	return (
		<div className="space-y-4">
			<div className="grid grid-cols-1 gap-3">
				<div>
					<label className="text-xs text-muted-foreground">WebLLM Model</label>
					<Select
						value={webllmModel}
						onValueChange={setWebllmModel}
						disabled={loading}
					>
						<SelectTrigger className="w-full">
							<SelectValue placeholder="Select a WebLLM model..." />
						</SelectTrigger>
						<SelectContent>
							{webllmAvailableModels.map((model) => (
								<SelectItem key={model} value={model}>
									{model}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>
		</div>
	);
};
