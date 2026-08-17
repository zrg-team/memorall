import React from "react";
import { useTranslation } from "react-i18next";
import { eq } from "drizzle-orm";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	CheckCircle2,
	ShieldCheck,
	Zap,
} from "lucide-react";

import { Badge } from "@/main/components/ui/badge";
import { Button } from "@/main/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/main/components/ui/card";
import { useCurrentModel } from "@/main/hooks/use-current-model";
import { serviceManager } from "@/services";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import { logError } from "@/utils/logger";
import secureSession from "@/utils/secure-session";

import { useDownloadProgress } from "../hooks/use-download-progress";
import { useDownloadedModels } from "../hooks/use-downloaded-models";
import { useLocalModels } from "../hooks/use-local-models";
import { useMagicModelDownload } from "../hooks/use-magic-model-download";
import { useModelOperations } from "../hooks/use-model-operations";
import { MagicSetup } from "./MagicSetup";
import { OpenRouterTab } from "./OpenRouterTab";
import { ProgressSection } from "./YourModels/components/ProgressSection";
import { RemoteModelsSection } from "./YourModels/components/RemoteModelsSection";

export type RecommendedPath = "fast" | "free";

interface RecommendedSetupProps {
	/** Fired once a real model is chosen (never for the bare OpenRouter connect). */
	onModelLoaded?: (modelId: string, provider: ServiceProvider) => void;
	/** Switches the page over to the provider-by-provider surface. */
	onBrowseAll: () => void;
}

const BulletList: React.FC<{ items: string[]; tone: "pro" | "con" }> = ({
	items,
	tone,
}) => (
	<ul className="space-y-1.5 text-sm">
		{items.map((item) => (
			<li key={item} className="flex items-start gap-2">
				{tone === "pro" ? (
					<Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600 dark:text-green-500" />
				) : (
					<span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
				)}
				<span className={tone === "pro" ? undefined : "text-muted-foreground"}>
					{item}
				</span>
			</li>
		))}
	</ul>
);

export const RecommendedSetup: React.FC<RecommendedSetupProps> = ({
	onModelLoaded,
	onBrowseAll,
}) => {
	const { t } = useTranslation("llm");
	const [path, setPath] = React.useState<RecommendedPath | null>(null);

	// ── OpenRouter (Fast) status ─────────────────────────────────────────────
	const [openrouterConnected, setOpenrouterConnected] = React.useState(false);
	const [openrouterHasConfig, setOpenrouterHasConfig] = React.useState(false);
	const [openrouterChecking, setOpenrouterChecking] = React.useState(true);

	const refreshOpenRouterStatus = React.useCallback(async () => {
		try {
			const connected =
				serviceManager.llmService.has("openrouter") &&
				(await secureSession.exists("openrouter_ready"));
			setOpenrouterConnected(connected);

			const rows = await serviceManager.databaseService.use(({ db, schema }) =>
				db
					.select()
					.from(schema.encryption)
					.where(eq(schema.encryption.key, "openrouter_config"))
					.limit(1),
			);
			setOpenrouterHasConfig(rows.length > 0);
		} catch (error) {
			logError("Failed to check OpenRouter status:", error);
		} finally {
			setOpenrouterChecking(false);
		}
	}, []);

	React.useEffect(() => {
		void refreshOpenRouterStatus();
	}, [refreshOpenRouterStatus]);

	const { localModels: openrouterModels, localModelsLoading } = useLocalModels(
		"openrouter",
		null,
		openrouterConnected,
	);

	// ── Local models (Free) status + download pipeline ───────────────────────
	const [loading, setLoading] = React.useState(false);
	const { current, setCurrent } = useCurrentModel();
	const { downloadedModels, downloadedOnly, fetchDownloadedModels } =
		useDownloadedModels();
	const {
		downloadProgress,
		setDownloadProgress,
		quickDownloadModel,
		setQuickDownloadModel,
	} = useDownloadProgress();

	const { handleQuickDownload } = useModelOperations({
		setCurrent,
		setLoading,
		setQuickDownloadModel,
		setDownloadProgress,
		fetchDownloadedModels,
		downloadedModels,
		onModelLoaded,
	});
	const downloadRecommendation = useMagicModelDownload({ handleQuickDownload });

	// ── Chooser ──────────────────────────────────────────────────────────────

	if (path === null) {
		const fastAction = openrouterConnected
			? t("recommended.fast.actionConnected")
			: openrouterHasConfig
				? t("recommended.fast.actionUnlock")
				: t("recommended.fast.action");
		const freeAction =
			downloadedOnly.length > 0
				? t("recommended.free.actionMore")
				: t("recommended.free.action");

		return (
			<div className="space-y-5">
				<div className="space-y-1 text-center">
					<h2 className="text-lg font-semibold">{t("recommended.title")}</h2>
					<p className="text-sm text-muted-foreground">
						{t("recommended.description")}
					</p>
				</div>

				<div className="grid gap-4 md:grid-cols-2">
					{/* ── Fast ─────────────────────────────────────────────────── */}
					<Card className="flex flex-col border-2 transition-all hover:border-primary hover:shadow-lg">
						<CardHeader className="pb-3 text-center">
							<div className="mx-auto mb-3 w-fit rounded-full bg-amber-500/10 p-3">
								<Zap className="h-6 w-6 text-amber-600 dark:text-amber-500" />
							</div>
							<CardTitle className="flex items-center justify-center gap-2 text-lg">
								{t("recommended.fast.title")}
								{!openrouterChecking && openrouterConnected && (
									<Badge
										variant="secondary"
										className="border-primary/20 bg-primary/10 text-primary"
									>
										<CheckCircle2 className="mr-1 h-3 w-3" />
										{t("recommended.fast.connected")}
									</Badge>
								)}
							</CardTitle>
							<CardDescription>
								{t("recommended.fast.description")}
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-1 flex-col gap-4">
							{openrouterConnected ? (
								<div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
									{localModelsLoading
										? t("recommended.fast.loadingModels")
										: t("recommended.fast.modelsAvailable", {
												count: openrouterModels.length,
											})}
								</div>
							) : (
								<>
									<BulletList
										tone="pro"
										items={[
											t("recommended.fast.pro1"),
											t("recommended.fast.pro2"),
											t("recommended.fast.pro3"),
										]}
									/>
									<BulletList
										tone="con"
										items={[
											t("recommended.fast.con1"),
											t("recommended.fast.con2"),
										]}
									/>
								</>
							)}
							<Button
								className="mt-auto w-full"
								size="lg"
								onClick={() => setPath("fast")}
							>
								{fastAction}
								<ArrowRight className="ml-2 h-4 w-4" />
							</Button>
						</CardContent>
					</Card>

					{/* ── Free ─────────────────────────────────────────────────── */}
					<Card className="flex flex-col border-2 transition-all hover:border-primary hover:shadow-lg">
						<CardHeader className="pb-3 text-center">
							<div className="mx-auto mb-3 w-fit rounded-full bg-green-500/10 p-3">
								<ShieldCheck className="h-6 w-6 text-green-600 dark:text-green-500" />
							</div>
							<CardTitle className="flex items-center justify-center gap-2 text-lg">
								{t("recommended.free.title")}
								{downloadedOnly.length > 0 && (
									<Badge
										variant="secondary"
										className="border-primary/20 bg-primary/10 text-primary"
									>
										<CheckCircle2 className="mr-1 h-3 w-3" />
										{t("recommended.free.downloadedCount", {
											count: downloadedOnly.length,
										})}
									</Badge>
								)}
							</CardTitle>
							<CardDescription>
								{t("recommended.free.description")}
							</CardDescription>
						</CardHeader>
						<CardContent className="flex flex-1 flex-col gap-4">
							<BulletList
								tone="pro"
								items={[
									t("recommended.free.pro1"),
									t("recommended.free.pro2"),
									t("recommended.free.pro3"),
								]}
							/>
							<BulletList
								tone="con"
								items={[t("recommended.free.con1"), t("recommended.free.con2")]}
							/>
							<Button
								className="mt-auto w-full"
								size="lg"
								variant="outline"
								onClick={() => setPath("free")}
							>
								{freeAction}
								<ArrowRight className="ml-2 h-4 w-4" />
							</Button>
						</CardContent>
					</Card>
				</div>

				<div className="space-y-1 text-center text-sm text-muted-foreground">
					<div>{t("recommended.browseAllHint")}</div>
					<Button variant="link" size="sm" onClick={onBrowseAll}>
						{t("recommended.browseAll")}
					</Button>
				</div>
			</div>
		);
	}

	// ── Drill-in header, shared by both paths ────────────────────────────────

	const header = (
		<div className="flex items-center gap-3">
			<Button variant="outline" size="sm" onClick={() => setPath(null)}>
				<ArrowLeft className="mr-1 h-4 w-4" />
				{t("recommended.back")}
			</Button>
			<div className="min-w-0">
				<div className="truncate text-sm font-semibold">
					{path === "fast"
						? t("recommended.fast.headerTitle")
						: t("recommended.free.headerTitle")}
				</div>
				<div className="truncate text-xs text-muted-foreground">
					{path === "fast"
						? t("recommended.fast.headerDescription")
						: t("recommended.free.headerDescription")}
				</div>
			</div>
		</div>
	);

	// ── Fast: OpenRouter ─────────────────────────────────────────────────────

	if (path === "fast") {
		return (
			<div className="space-y-4">
				{header}

				<ol className="flex items-center gap-2 text-xs">
					{[
						{ step: 1, label: t("recommended.fast.stepConnect") },
						{ step: 2, label: t("recommended.fast.stepPick") },
					].map(({ step, label }, index) => {
						const done = step === 1 && openrouterConnected;
						const active = step === (openrouterConnected ? 2 : 1);
						return (
							<li key={step} className="flex items-center gap-2">
								{index > 0 && (
									<span className="h-px w-6 bg-border" aria-hidden="true" />
								)}
								<span
									className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${
										active
											? "border-primary bg-primary/10 font-medium text-primary"
											: "border-border text-muted-foreground"
									}`}
								>
									{done ? (
										<Check className="h-3 w-3" />
									) : (
										<span className="font-mono">{step}</span>
									)}
									{label}
								</span>
							</li>
						);
					})}
				</ol>

				<div className="rounded-lg border p-3">
					<OpenRouterTab
						// A successful connect is not a model choice — it only advances
						// the stepper. The real pick bubbles up from the list below.
						onModelLoaded={() => {
							setOpenrouterConnected(true);
							void refreshOpenRouterStatus();
						}}
					/>
				</div>

				{openrouterConnected && (
					<div className="space-y-2">
						<div className="text-sm text-muted-foreground">
							{t("recommended.fast.pickHint")}
						</div>
						<RemoteModelsSection
							providers={[
								{
									provider: "openrouter",
									models: openrouterModels,
									loading: localModelsLoading,
									ready: true,
								},
							]}
							current={current}
							loading={loading}
							onModelLoaded={onModelLoaded}
							defaultExpanded
						/>
					</div>
				)}
			</div>
		);
	}

	// ── Free: on-device ──────────────────────────────────────────────────────

	return (
		<div className="space-y-4">
			{header}

			<ProgressSection
				loading={loading}
				quickDownloadModel={quickDownloadModel}
				downloadProgress={downloadProgress}
			/>

			<MagicSetup
				onModelSelected={downloadRecommendation}
				onCancel={onBrowseAll}
			/>
		</div>
	);
};
