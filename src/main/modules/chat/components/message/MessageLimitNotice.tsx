import React from "react";
import { AlertTriangle, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";

/**
 * A reply the agent's iteration limit cut off: says so, and lets the user
 * have the agent go on from where it stopped.
 */
export const MessageLimitNotice: React.FC<{
	maxIterations: number;
	/** Absent where nothing can continue the run, or it is no longer the latest reply. */
	onContinue?: () => void;
}> = ({ maxIterations, onContinue }) => {
	const { t } = useTranslation("chat");

	return (
		<div
			role="status"
			className="my-2 rounded-md border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-100"
		>
			<div className="flex items-start gap-2">
				<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
				<div className="min-w-0 flex-1">
					<div className="font-medium">
						{t("messages.iterationLimit.title")}
					</div>
					<div className="mt-0.5 text-xs text-amber-700/80 dark:text-amber-100/80">
						{t("messages.iterationLimit.description", {
							count: maxIterations,
						})}
					</div>
				</div>
				{onContinue ? (
					<Button
						type="button"
						size="sm"
						variant="outline"
						onClick={onContinue}
						className="h-7 shrink-0 gap-1 border-amber-500/40 bg-transparent px-2.5 text-xs text-amber-800 hover:bg-amber-500/15 hover:text-amber-900 dark:text-amber-100 dark:hover:text-amber-50"
					>
						<Play className="h-3 w-3" />
						{t("messages.iterationLimit.continue")}
					</Button>
				) : null}
			</div>
		</div>
	);
};
