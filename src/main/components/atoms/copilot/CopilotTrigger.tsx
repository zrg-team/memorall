import { HelpCircle } from "lucide-react";
import type React from "react";
import { useCopilot } from "@/main/components/molecules/Copilot/CopilotContext";
import { Button } from "@/main/components/ui/button";

interface CopilotTriggerProps {
	variant?: "default" | "outline" | "ghost" | "secondary";
	size?: "default" | "sm" | "lg" | "icon";
	className?: string;
	showIcon?: boolean;
	children?: React.ReactNode;
}

export const CopilotTrigger: React.FC<CopilotTriggerProps> = ({
	variant = "outline",
	size = "sm",
	className = "",
	showIcon = true,
	children,
}) => {
	const { startTour, state } = useCopilot();

	const handleClick = () => {
		startTour();
	};

	if (state.isActive) {
		return null; // Don't show trigger when tour is active
	}

	return (
		<Button
			variant={variant}
			size={size}
			onClick={handleClick}
			className={`${className}`}
		>
			{showIcon && <HelpCircle size={16} className="mr-1" />}
			{children}
		</Button>
	);
};
