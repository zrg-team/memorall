import React from "react";
import {
	ArrowLeft,
	ArrowRight,
	Check,
	ExternalLink,
	Loader2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { DEFAULT_OPENROUTER_MODEL } from "@/constants/openai";
import { Badge } from "@/main/components/ui/badge";
import { Button } from "@/main/components/ui/button";
import { serviceManager } from "@/services";
import { PROVIDER_TO_SERVICE } from "@/services/llm/constants";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";
import { resolveModelCategories } from "@/services/llm/registry/media-model-registry";
import { rootErrorMessage } from "@/utils/error-message";
import { useLocalModels } from "../hooks/use-local-models";
import { OpenRouterTab } from "./OpenRouterTab";

interface OpenRouterSetupProps {
	onModelLoaded?: (modelId: string, provider: ServiceProvider) => void;
}

type SetupStep = 1 | 2 | 3 | 4;
const STEP_LABELS = ["account", "key", "connect", "model"] as const;
const STEP_TITLES = [
	"accountTitle",
	"keyTitle",
	"connectTitle",
	"modelTitle",
] as const;

/** Start with the free router; the user may choose another chat model. */
export const OpenRouterSetup: React.FC<OpenRouterSetupProps> = ({
	onModelLoaded,
}) => {
	const { t } = useTranslation("llm");
	const selectId = React.useId();
	const headingId = React.useId();
	const headingRef = React.useRef<HTMLHeadingElement>(null);
	const previousStep = React.useRef<SetupStep>(1);
	const [step, setStep] = React.useState<SetupStep>(1);
	const [connected, setConnected] = React.useState(false);
	const [connectionBusy, setConnectionBusy] = React.useState(false);
	const [selectedModel, setSelectedModel] = React.useState<string>(
		DEFAULT_OPENROUTER_MODEL,
	);
	const [saving, setSaving] = React.useState(false);
	const [error, setError] = React.useState<string | null>(null);
	React.useEffect(() => {
		if (previousStep.current !== step) {
			headingRef.current?.focus();
			previousStep.current = step;
		}
	}, [step]);

	const handleConnected = () => {
		setConnected(true);
		setConnectionBusy(false);
		setStep(4);
	};
	const { localModels, localModelsLoading } = useLocalModels(
		"openrouter",
		null,
		connected,
	);
	const otherModels = localModels
		.filter(
			(model) =>
				model.id !== DEFAULT_OPENROUTER_MODEL &&
				resolveModelCategories("openrouter", model.id, model).includes("chat"),
		)
		.sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
	const freeModels = otherModels.filter((model) => model.id.endsWith(":free"));
	const remainingModels = otherModels.filter(
		(model) => !model.id.endsWith(":free"),
	);
	// Catalog refreshes must preserve a user's choice and never replace an
	// unavailable model with a paid choice automatically.
	const modelId = otherModels.some((model) => model.id === selectedModel)
		? selectedModel
		: DEFAULT_OPENROUTER_MODEL;

	const start = async () => {
		if (!connected || saving) return;
		setSaving(true);
		setError(null);
		try {
			await serviceManager.llmService.setCurrentModelFor(
				"chat",
				"openrouter",
				modelId,
				PROVIDER_TO_SERVICE.openrouter,
			);
			onModelLoaded?.(modelId, "openrouter");
		} catch (failure) {
			setError(rootErrorMessage(failure));
		} finally {
			setSaving(false);
		}
	};

	return (
		<section
			className="openrouter-theme space-y-5"
			data-copilot="setup-openrouter"
			data-agent-cursor-point="copilot-setup-openrouter"
		>
			<div className="space-y-2">
				<Badge variant="secondary">{t("openrouterGuide.noCard")}</Badge>
				<h2 className="text-xl font-semibold">{t("openrouterGuide.title")}</h2>
				<p className="text-sm text-muted-foreground">
					{t("openrouterGuide.description")}
				</p>
			</div>

			<div className="relative">
				<div
					aria-hidden="true"
					className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-4 h-0.5 -translate-y-1/2 bg-border"
				>
					<div
						className="h-full bg-[var(--openrouter-accent)] transition-[width] duration-200"
						style={{
							width: `${((step - 1) / (STEP_LABELS.length - 1)) * 100}%`,
						}}
					/>
				</div>
				<ol
					aria-label={t("openrouterGuide.progress")}
					className="relative grid grid-cols-4"
				>
					{STEP_LABELS.map((label, index) => {
						const number = index + 1;
						return (
							<li
								key={label}
								aria-current={step === number ? "step" : undefined}
								className="flex flex-col items-center gap-2 px-1 text-center text-xs"
							>
								<span
									className={`relative flex h-8 w-8 items-center justify-center rounded-full border font-medium ${number <= step ? "border-[var(--openrouter-accent)] bg-[var(--openrouter-accent)] text-[var(--openrouter-on-accent)]" : "border-border bg-background text-muted-foreground"}`}
								>
									{number < step ? (
										<Check className="h-4 w-4" aria-hidden="true" />
									) : (
										number
									)}
								</span>
								<span
									className={
										number === step ? "font-semibold" : "text-muted-foreground"
									}
								>
									{t(`openrouterGuide.steps.${label}`)}
								</span>
							</li>
						);
					})}
				</ol>
			</div>

			<div
				className="space-y-5 rounded-xl border bg-card p-5 sm:p-6"
				role="group"
				aria-labelledby={headingId}
			>
				<div className="space-y-1.5">
					<p className="text-xs text-muted-foreground" role="status">
						{t("openrouterGuide.stepCount", { current: step, total: 4 })}
					</p>
					<h3
						id={headingId}
						ref={headingRef}
						tabIndex={-1}
						className="text-lg font-semibold outline-none"
					>
						{t(`openrouterGuide.${STEP_TITLES[step - 1]}`)}
					</h3>
				</div>

				{step === 1 && (
					<div className="space-y-4">
						<p className="text-sm text-muted-foreground">
							{t("openrouterGuide.accountHelp")}
						</p>
						<div className="flex flex-wrap gap-2">
							<Button asChild className="openrouter-action">
								<a
									href="https://openrouter.ai/sign-up"
									target="_blank"
									rel="noopener noreferrer"
								>
									{t("openrouterGuide.createAccount")}
									<ExternalLink className="ml-2 h-3 w-3" />
								</a>
							</Button>
							<Button asChild variant="outline">
								<a
									href="https://openrouter.ai/sign-in"
									target="_blank"
									rel="noopener noreferrer"
								>
									{t("openrouterGuide.signIn")}
									<ExternalLink className="ml-2 h-3 w-3" />
								</a>
							</Button>
						</div>
						<p className="text-xs text-muted-foreground">
							{t("openrouterGuide.returnHere")}
						</p>
						<Button
							variant="link"
							className="h-auto p-0"
							onClick={() => setStep(3)}
						>
							{t("openrouterGuide.haveKey")}
						</Button>
					</div>
				)}

				{step === 2 && (
					<div className="space-y-4">
						<p className="text-sm text-muted-foreground">
							{t("openrouterGuide.keyHelp")}
						</p>
						<ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
							<li>{t("openrouterGuide.keyName")}</li>
							<li>{t("openrouterGuide.keyCopy")}</li>
						</ol>
						<Button asChild className="openrouter-action">
							<a
								href="https://openrouter.ai/settings/keys"
								target="_blank"
								rel="noopener noreferrer"
							>
								{t("openrouterGuide.createKey")}
								<ExternalLink className="ml-2 h-3 w-3" />
							</a>
						</Button>
					</div>
				)}

				{step === 3 && (
					<div className="space-y-4">
						<p className="text-sm text-muted-foreground">
							{t("openrouterGuide.connectHelp")}
						</p>
						<OpenRouterTab
							simplified
							onConnectionChanged={setConnected}
							onBusyChanged={setConnectionBusy}
							onModelLoaded={handleConnected}
						/>
					</div>
				)}

				{step === 4 && (
					<div className="space-y-3">
						<p className="text-sm text-muted-foreground">
							{t("openrouterGuide.modelHelp")}
						</p>
						<label htmlFor={selectId} className="block text-sm font-medium">
							{t("openrouterGuide.modelLabel")}
						</label>
						<select
							id={selectId}
							className="h-10 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
							value={modelId}
							onChange={(event) => setSelectedModel(event.target.value)}
							disabled={!connected || saving}
						>
							<option value={DEFAULT_OPENROUTER_MODEL}>
								{t("openrouterGuide.freeRouter")}
							</option>
							{freeModels.length > 0 && (
								<optgroup label={t("openrouterGuide.otherFreeModels")}>
									{freeModels.map((model) => (
										<option key={model.id} value={model.id}>
											{model.name || model.id}
										</option>
									))}
								</optgroup>
							)}
							{remainingModels.length > 0 && (
								<optgroup label={t("openrouterGuide.otherModels")}>
									{remainingModels.map((model) => (
										<option key={model.id} value={model.id}>
											{model.name || model.id}
										</option>
									))}
								</optgroup>
							)}
						</select>
						{modelId !== DEFAULT_OPENROUTER_MODEL &&
							!modelId.endsWith(":free") && (
								<p className="text-xs text-muted-foreground">
									{t("openrouterGuide.otherModelPricing")}
								</p>
							)}
						{connected && localModelsLoading && (
							<p role="status" className="text-xs text-muted-foreground">
								{t("recommended.fast.loadingModels")}
							</p>
						)}
						{error && (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						)}
					</div>
				)}

				<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
					{step > 1 ? (
						<Button
							variant="outline"
							disabled={connectionBusy || saving}
							onClick={() => {
								setError(null);
								setStep((value) => (value - 1) as SetupStep);
							}}
						>
							<ArrowLeft className="mr-1 h-4 w-4" />
							{t("openrouterGuide.back")}
						</Button>
					) : (
						<span />
					)}
					{step === 1 && (
						<Button variant="outline" onClick={() => setStep(2)}>
							{t("openrouterGuide.accountContinue")}
							<ArrowRight className="ml-1 h-4 w-4" />
						</Button>
					)}
					{step === 2 && (
						<Button variant="outline" onClick={() => setStep(3)}>
							{t("openrouterGuide.keyContinue")}
							<ArrowRight className="ml-1 h-4 w-4" />
						</Button>
					)}
					{step === 3 && (
						<Button
							className="openrouter-action"
							disabled={!connected || connectionBusy}
							onClick={() => setStep(4)}
						>
							{t("openrouterGuide.modelContinue")}
							<ArrowRight className="ml-1 h-4 w-4" />
						</Button>
					)}
					{step === 4 && (
						<Button
							className="openrouter-action"
							disabled={!connected || saving}
							onClick={() => void start()}
						>
							{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
							{t("openrouterGuide.start")}
						</Button>
					)}
				</div>
			</div>
			{step === 4 && (
				<p className="text-xs text-muted-foreground">
					{t("openrouterGuide.limits")}{" "}
					<a
						className="underline underline-offset-2"
						href="https://openrouter.ai/docs/api_reference/limits"
						target="_blank"
						rel="noopener noreferrer"
					>
						{t("openrouterGuide.currentLimits")}
					</a>
				</p>
			)}
		</section>
	);
};
