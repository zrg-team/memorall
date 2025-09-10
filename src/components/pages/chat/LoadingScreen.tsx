import React from "react";
import { Loader2 } from "lucide-react";

export const LoadingScreen: React.FC = () => {
	return (
		<div className="flex items-center justify-center h-screen">
			<div className="text-center">
				<Loader2 className="h-8 w-8 animate-spin mx-auto mb-4" />
				<p className="text-muted-foreground">Initializing services...</p>
			</div>
		</div>
	);
};
