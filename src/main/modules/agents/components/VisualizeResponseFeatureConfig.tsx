import React, { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/main/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/main/components/ui/select";
import { useAgentConfigStore } from "@/main/stores/agent-config";
import {
	VISUALIZE_RESPONSE_FEATURE_NAME,
	type OpenUITheme,
} from "@/services/flows-integrations/steps/features/visualize-response/index";

const THEMES: { value: OpenUITheme; labelKey: string }[] = [
	{ value: "shadcn", labelKey: "agentSettings.visualizeThemeShadcn" },
	{ value: "wireframe", labelKey: "agentSettings.visualizeThemeWireframe" },
	{ value: "glass", labelKey: "agentSettings.visualizeThemeGlass" },
];

export const VisualizeResponseFeatureConfig: React.FC = () => {
	const { t } = useTranslation("chat");
	const { savedUnifiedConfig, patchStepConfig } = useAgentConfigStore();

	const currentTheme: OpenUITheme =
		(savedUnifiedConfig?.steps.find(
			(s) => s.name === VISUALIZE_RESPONSE_FEATURE_NAME,
		)?.config?.theme as OpenUITheme | undefined) ?? "shadcn";

	const [theme, setTheme] = useState<OpenUITheme>(currentTheme);

	useEffect(() => {
		setTheme(currentTheme);
	}, [currentTheme]);

	const handleChange = (value: OpenUITheme) => {
		setTheme(value);
		patchStepConfig(VISUALIZE_RESPONSE_FEATURE_NAME, {
			theme: value === "shadcn" ? undefined : value,
		});
	};

	return (
		<div className="space-y-2">
			<Label className="text-xs font-medium">
				{t("agentSettings.visualizeThemeLabel")}
			</Label>
			<Select
				value={theme}
				onValueChange={(v) => handleChange(v as OpenUITheme)}
			>
				<SelectTrigger className="h-9">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{THEMES.map(({ value, labelKey }) => (
						<SelectItem key={value} value={value}>
							{t(labelKey)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-[10px] text-muted-foreground">
				{t("agentSettings.visualizeThemeHint")}
			</p>
		</div>
	);
};
