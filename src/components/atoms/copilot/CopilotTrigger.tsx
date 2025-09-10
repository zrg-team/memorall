import React from "react";
import { Button } from "@/components/ui/button";
import { useCopilot } from "@/components/molecules/contexts/CopilotContext";
import { HelpCircle } from "lucide-react";

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
			{children || "Help Tour"}
		</Button>
	);
};
