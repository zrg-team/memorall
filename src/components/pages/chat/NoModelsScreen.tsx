import React from "react";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { YourModels } from "@/components/molecules/YourModels";

interface NoModelsScreenProps {
	onModelLoaded: () => void;
	onNavigateToModels: () => void;
}

export const NoModelsScreen: React.FC<NoModelsScreenProps> = ({
	onModelLoaded,
	onNavigateToModels,
}) => {
	return (
		<div className="flex flex-col h-full bg-background">
			<div className="flex-1 flex items-center justify-center">
				<div className="w-full max-w-4xl mx-auto p-8">
					<div className="text-center mb-8">
						<Bot className="w-16 h-16 mx-auto mb-6 text-muted-foreground opacity-50" />
						<h3 className="text-xl font-semibold mb-2">No Models Loaded</h3>
						<p className="text-muted-foreground mb-6">
							You need to load a model before you can start chatting. Choose
							from your downloaded models below or download new ones.
						</p>
					</div>
					<YourModels onModelLoaded={onModelLoaded} />
					<div className="mt-6 text-center">
						<Button onClick={onNavigateToModels} className="w-full max-w-md">
							<Bot className="w-4 h-4 mr-2" />
							Download More Models
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
};
