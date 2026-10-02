import React from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { AppWindow, PanelRightOpen } from "lucide-react";
import { useShellLayoutStore } from "@/main/stores/shell-layout";
import { runtimeArtifactState } from "../artifacts/runtime-artifact-state";

/**
 * An artifact shown in the right panel, marked where it sits in the message
 * so it is not lost while the panel holds the preview. Opens that artifact.
 */
export const CompactArtifactReference: React.FC<{
	type: string;
	title?: string;
	identifier?: string;
}> = ({ type, title, identifier }) => {
	const { t } = useTranslation("chat");
	const navigate = useNavigate();
	const setRightPanelCollapsed = useShellLayoutStore(
		(state) => state.setRightPanelCollapsed,
	);
	const label =
		title?.trim() || identifier?.trim() || `${type.toUpperCase()} artifact`;

	return (
		<button
			type="button"
			onClick={() => {
				setRightPanelCollapsed(false);
				navigate("/runtime", {
					state: runtimeArtifactState({ type, title, identifier }),
				});
			}}
			className="my-2 flex w-full max-w-md items-center gap-3 rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2.5 text-left shadow-[0_0_0_1px_rgba(59,130,246,0.18),0_4px_20px_rgba(59,130,246,0.1)] transition-colors hover:border-blue-500/60 hover:bg-blue-500/15"
		>
			<span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-blue-500/15 text-blue-500">
				<AppWindow size={16} />
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate text-sm font-medium text-foreground">
					{label}
				</span>
				<span className="block truncate text-xs text-muted-foreground">
					{t("htmlPreview.inPanel", {
						defaultValue: "Artifact · open in the right panel",
					})}
				</span>
			</span>
			<PanelRightOpen size={16} className="flex-shrink-0 text-blue-500" />
		</button>
	);
};
