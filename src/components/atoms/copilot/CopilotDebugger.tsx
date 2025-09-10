import React from "react";
import { Button } from "@/components/ui/button";
import { useCopilot } from "@/components/molecules/contexts/CopilotContext";
import { X, RotateCcw, Play } from "lucide-react";

export const CopilotDebugger: React.FC = () => {
	const { state, startTour, endTour } = useCopilot();

	if (process.env.NODE_ENV === "production") {
		return null; // Only show in development
	}

	return (
		<div className="fixed bottom-4 right-4 z-[2147483648] bg-red-500 text-white p-2 rounded-lg shadow-lg text-xs">
			<div className="mb-1">Copilot Debug</div>
			<div className="flex gap-1">
				<Button
					size="sm"
					variant="secondary"
					onClick={() => endTour()}
					className="h-6 text-xs"
				>
					<X size={12} />
				</Button>
				<Button
					size="sm"
					variant="secondary"
					onClick={() => {
						localStorage.removeItem("memorall-copilot-completed");
						window.location.reload();
					}}
					className="h-6 text-xs"
				>
					<RotateCcw size={12} />
				</Button>
				<Button
					size="sm"
					variant="secondary"
					onClick={() => startTour()}
					className="h-6 text-xs"
				>
					<Play size={12} />
				</Button>
			</div>
			<div className="text-xs mt-1">
				Active: {state.isActive ? "Yes" : "No"} | Step: {state.currentStep + 1}/
				{state.steps.length}
			</div>
		</div>
	);
};
