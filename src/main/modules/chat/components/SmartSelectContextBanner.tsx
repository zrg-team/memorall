import React from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { Badge } from "@/main/components/ui/badge";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/main/components/ui/dialog";
import type { EmbeddedContextItem } from "@/embedded/types";
import { platform } from "@/platform/current";

export function useSmartSelectContext() {
	const [smartSelectContext, setSmartSelectContext] =
		React.useState<EmbeddedContextItem | null>(null);

	React.useEffect(() => {
		void (async () => {
			try {
				const raw =
					await platform.sessionStore.get<string>("smartSelectContext");
				if (raw) {
					setSmartSelectContext(JSON.parse(raw) as EmbeddedContextItem);
					await platform.sessionStore.remove("smartSelectContext");
				}
			} catch (_) {}
		})();
	}, []);

	return { smartSelectContext, setSmartSelectContext };
}

interface SmartSelectContextBannerProps {
	context: EmbeddedContextItem | null;
	onClear: () => void;
}

export const SmartSelectContextBanner: React.FC<
	SmartSelectContextBannerProps
> = ({ context, onClear }) => {
	const { t } = useTranslation("chat");
	const [dialogOpen, setDialogOpen] = React.useState(false);

	if (!context) return null;

	return (
		<>
			<div className="relative z-30 w-full flex-shrink-0 px-4">
				<div className="max-w-3xl mx-auto">
					<div className="relative z-30 mx-3 -mb-px flex items-center justify-between gap-3 rounded-lg rounded-bl-none rounded-br-none border border-violet-500/30 bg-violet-500/10 px-3 py-2">
						<div className="min-w-0">
							<div className="flex items-center gap-2 text-xs font-semibold text-violet-700 dark:text-violet-200">
								<Badge
									variant="outline"
									className="border-violet-400/60 text-violet-700 dark:text-violet-300"
								>
									{t("smartSelect.label")}
								</Badge>
								{context.label}
							</div>
							<div className="mt-0.5 text-xs text-violet-700/80 dark:text-violet-100/80 truncate">
								{context.content.slice(0, 100)}
								{context.content.length > 100 ? "…" : ""}
							</div>
						</div>
						<div className="flex items-center gap-1 shrink-0">
							<Button
								type="button"
								size="sm"
								onClick={() => setDialogOpen(true)}
								className="h-8 border border-violet-300 bg-violet-50 px-3 text-violet-950 hover:bg-violet-100 dark:border-violet-300/40 dark:bg-violet-100 dark:text-violet-950 dark:hover:bg-violet-200"
							>
								{t("smartSelect.viewFull")}
							</Button>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								onClick={onClear}
								className="h-8 w-8 text-violet-400 hover:text-violet-700 hover:bg-violet-100 dark:hover:text-violet-200 dark:hover:bg-violet-900"
							>
								<X className="w-3.5 h-3.5" />
							</Button>
						</div>
					</div>
				</div>
			</div>

			<Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<DialogContent className="max-w-2xl max-h-[70vh] flex flex-col">
					<DialogHeader>
						<DialogTitle>{t("smartSelect.dialogTitle")}</DialogTitle>
					</DialogHeader>
					<div className="flex-1 overflow-y-auto">
						<div className="text-xs font-semibold text-muted-foreground mb-2">
							{context.label}
						</div>
						<pre className="text-sm whitespace-pre-wrap break-words font-mono bg-muted rounded-lg p-3">
							{context.content}
						</pre>
					</div>
				</DialogContent>
			</Dialog>
		</>
	);
};
