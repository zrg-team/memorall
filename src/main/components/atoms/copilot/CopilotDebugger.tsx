import { Play, RotateCcw, X } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { useCopilot } from "@/main/components/molecules/Copilot/CopilotContext";
import { Button } from "@/main/components/ui/button";

export const CopilotDebugger: React.FC = () => {
	const { state, startTour, endTour } = useCopilot();
	const { t } = useTranslation("copilot");

	if (process.env.NODE_ENV === "production") {
		return null; // Only show in development
	}

	return (
		<div className="fixed bottom-4 right-4 z-[2147483648] bg-red-500 text-white p-2 rounded-lg shadow-lg text-xs">
			<div className="mb-1">{t("debugger.title")}</div>
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
				{t("debugger.status", {
					active: state.isActive ? t("debugger.yes") : t("debugger.no"),
					current: state.currentStep + 1,
					total: state.steps.length,
				})}
			</div>
		</div>
	);
};
