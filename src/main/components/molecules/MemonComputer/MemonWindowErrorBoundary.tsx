import React from "react";
import { Button } from "@/main/components/ui/button";
import { logError } from "@/utils/logger";

interface Props {
	/** What the window says when it fails, and its retry button. */
	labels: { failed: string; retry: string };
	children: React.ReactNode;
}

interface State {
	error: Error | null;
}

/**
 * Keeps one window's failure inside that window: the rest of the computer
 * keeps working, and the window can be drawn again.
 */
export class MemonWindowErrorBoundary extends React.Component<Props, State> {
	state: State = { error: null };

	static getDerivedStateFromError(error: Error): State {
		return { error };
	}

	componentDidCatch(error: Error) {
		logError("[MEMON] A computer window failed:", error);
	}

	render() {
		if (!this.state.error) return this.props.children;
		return (
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
				<p>{this.props.labels.failed}</p>
				<p className="max-w-xs truncate font-mono text-[10px]">
					{this.state.error.message}
				</p>
				<Button
					type="button"
					size="sm"
					variant="outline"
					className="h-7 text-[11px]"
					onClick={() => this.setState({ error: null })}
				>
					{this.props.labels.retry}
				</Button>
			</div>
		);
	}
}
