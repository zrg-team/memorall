import type React from "react";
import { Monitor } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import type { AgentWizardComputerOffer as Offer } from "../types";

/**
 * MemonOS Bot, offered while the wizard builds an agent. One click turns it on
 * in the draft; nothing has to be typed back to the wizard.
 */
export const AgentWizardComputerOffer: React.FC<{
	offer: Offer;
	onAccept: () => void;
	onDismiss: () => void;
}> = ({ offer, onAccept, onDismiss }) => {
	const { t } = useTranslation(["agents", "common"]);
	const tw = (key: string) =>
		t(`wizard.computerOffer.${key}`, { ns: "agents" });

	return (
		<div className="mx-3 mb-2 flex items-start gap-3 rounded-xl border border-cyan-500/40 bg-cyan-500/5 p-3 shadow-[0_0_0_1px_rgba(6,182,212,0.15)]">
			<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-500">
				<Monitor size={18} />
			</span>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold">{tw("title")}</p>
				<p className="mt-0.5 text-xs text-muted-foreground">
					{offer.reason || tw("description")}
				</p>
				{offer.apps.length > 0 ? (
					<div className="mt-2 flex flex-wrap gap-1">
						{offer.apps.map((app) => (
							<span
								key={app}
								className="rounded-md border border-cyan-500/30 px-1.5 py-0.5 text-[11px] text-cyan-600 dark:text-cyan-400"
							>
								{t(`memonComputer.apps.${app}`, { ns: "common" })}
							</span>
						))}
					</div>
				) : null}
			</div>
			<div className="flex shrink-0 flex-col gap-1.5">
				<Button
					type="button"
					size="sm"
					className="h-8 bg-cyan-600 text-xs text-white hover:bg-cyan-500"
					onClick={onAccept}
				>
					{tw("turnOn")}
				</Button>
				<Button
					type="button"
					size="sm"
					variant="ghost"
					className="h-7 text-xs text-muted-foreground"
					onClick={onDismiss}
				>
					{tw("notNow")}
				</Button>
			</div>
		</div>
	);
};
