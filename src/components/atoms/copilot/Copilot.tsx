import React, { useEffect } from "react";
import { CopilotOverlay } from "./CopilotOverlay";
import { useCopilot } from "@/components/molecules/Copilot/CopilotContext";

interface CopilotProps {
	autoStart?: boolean;
	showOnFirstVisit?: boolean;
}

export const Copilot: React.FC<CopilotProps> = ({
	autoStart = true,
	showOnFirstVisit = true,
}) => {
	const { state, startTour } = useCopilot();

	useEffect(() => {
		// Auto-start tour on first visit if enabled, but only after services are ready
		if (
			autoStart &&
			showOnFirstVisit &&
			state.showOnFirstVisit &&
			!state.hasCompletedTour &&
			state.isServicesReady
		) {
			// Small delay to ensure DOM is ready
			const timer = setTimeout(() => {
				startTour();
			}, 1000);

			return () => clearTimeout(timer);
		}
	}, [
		autoStart,
		showOnFirstVisit,
		state.showOnFirstVisit,
		state.hasCompletedTour,
		state.isServicesReady,
		startTour,
	]);

	return <CopilotOverlay />;
};

// HOC to make any component a copilot step target
export interface CopilotStepProps {
	copilotId?: string;
	"data-copilot"?: string;
}

export function withCopilotStep<P extends object>(
	Component: React.ComponentType<P>,
): React.ComponentType<P & CopilotStepProps> {
	const WrappedComponent = (props: P & CopilotStepProps) => {
		const { copilotId, "data-copilot": dataCopilot, ...restProps } = props;

		return (
			<Component
				{...(restProps as P)}
				data-copilot={copilotId || dataCopilot}
			/>
		);
	};

	WrappedComponent.displayName = `withCopilotStep(${Component.displayName || Component.name})`;

	return WrappedComponent;
}
