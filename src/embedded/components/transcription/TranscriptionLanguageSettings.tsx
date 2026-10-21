import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/main/components/ui/button";
import { useEmbeddedTranslation } from "@/embedded/hooks/use-embedded-language";
import { TRANSCRIPT_LANGUAGES } from "@/services/tab-transcription/languages";
import { PROVIDER_REGISTRY } from "@/services/llm/provider-registry";
import type {
	TabTranscriptionSession,
	TranslationModelOption,
} from "@/services/tab-transcription/types";
import type { TranscriptionViewActions } from "@/content/modules/tab-transcription-view";

const modelKey = (option: TranslationModelOption) =>
	`${option.model.serviceName}:${option.model.modelId}`;

export function TranscriptionLanguageSettings({
	session,
	actions,
	onClose,
}: {
	session?: TabTranscriptionSession | null;
	actions: TranscriptionViewActions;
	onClose: () => void;
}) {
	const t = useEmbeddedTranslation("transcription");
	const region = useRef<HTMLDivElement>(null);
	const currentActions = useRef(actions);
	currentActions.current = actions;
	const [source, setSource] = useState(session?.sourceLanguage || "auto");
	const [target, setTarget] = useState(
		session?.translation?.targetLanguage || "off",
	);
	const [original, setOriginal] = useState(
		session?.translation?.showOriginal !== false,
	);
	const [models, setModels] = useState<TranslationModelOption[]>([]);
	const [model, setModel] = useState(
		session?.translation?.model
			? modelKey({ model: session.translation.model, label: "" })
			: "",
	);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	useEffect(() => {
		region.current
			?.querySelector<HTMLSelectElement>("select:not(:disabled)")
			?.focus();
		let disposed = false;
		void (
			currentActions.current.getTranslationModels?.() ?? Promise.resolve([])
		)
			.then((options) => {
				if (disposed) return;
				const saved = session?.translation?.model;
				if (
					saved &&
					!options.some(
						(option) =>
							modelKey(option) === modelKey({ model: saved, label: "" }),
					)
				)
					options = [
						{ model: saved, label: `${saved.provider} · ${saved.modelId}` },
						...options,
					];
				setModels(options);
				setModel((value) => value || (options[0] ? modelKey(options[0]) : ""));
			})
			.catch((reason) => {
				if (!disposed) setError(String(reason));
			})
			.finally(() => {
				if (!disposed) setLoading(false);
			});
		return () => {
			disposed = true;
		};
	}, []);
	const apply = async () => {
		setBusy(true);
		setError("");
		try {
			await actions.configure?.({
				...(session?.status === "recording"
					? { language: source === "auto" ? null : source }
					: {}),
				translation:
					target === "off"
						? null
						: {
								targetLanguage: target,
								model: models.find((option) => modelKey(option) === model)
									?.model,
								showOriginal: original,
							},
			});
			onClose();
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setBusy(false);
		}
	};
	return (
		<div
			className="mt-language-settings"
			ref={region}
			role="region"
			aria-label={t("languageSettings")}
		>
			<div className="mt-settings-heading">
				<h3>{t("languageSettings")}</h3>
				<Button
					variant="ghost"
					size="icon"
					className="mt-icon"
					aria-label={t("closeSettings")}
					onClick={onClose}
				>
					<X />
				</Button>
			</div>
			<div className="mt-settings-fields">
				<label className="mt-field">
					<span>{t("spokenLanguage")}</span>
					<select
						value={source}
						disabled={busy || session?.status !== "recording"}
						onChange={(event) => setSource(event.target.value)}
					>
						<option value="auto">{t("autoLanguage")}</option>
						{TRANSCRIPT_LANGUAGES.filter(
							(language) => language.code !== "zh-TW",
						).map((language) => (
							<option key={language.code} value={language.code}>
								{language.name}
							</option>
						))}
					</select>
				</label>
				<label className="mt-field">
					<span>{t("translateTo")}</span>
					<select
						value={target}
						disabled={busy}
						onChange={(event) => setTarget(event.target.value)}
					>
						<option value="off">{t("translationOff")}</option>
						{TRANSCRIPT_LANGUAGES.map((language) => (
							<option key={language.code} value={language.code}>
								{language.name}
							</option>
						))}
					</select>
				</label>
				{target !== "off" ? (
					<>
						<label className="mt-field">
							<span>{t("translationModel")}</span>
							<select
								value={model}
								disabled={busy || loading || !models.length}
								onChange={(event) => setModel(event.target.value)}
							>
								{!models.length ? (
									<option value="">
										{t(loading ? "loadingModels" : "chooseTranslationModel")}
									</option>
								) : (
									models.map((option) => (
										<option key={modelKey(option)} value={modelKey(option)}>
											{option.label}
										</option>
									))
								)}
							</select>
						</label>
						<label className="mt-original-toggle">
							<input
								type="checkbox"
								checked={original}
								disabled={busy}
								onChange={(event) => setOriginal(event.target.checked)}
							/>
							{t("showOriginal")}
						</label>
					</>
				) : null}
				<p className="mt-settings-hint">
					{t("model")}:{" "}
					{session ? PROVIDER_REGISTRY[session.model.provider]?.shortLabel : ""}{" "}
					· {session?.model.modelId}
				</p>
				{error ? (
					<p className="mt-settings-error" role="alert">
						{error}
					</p>
				) : null}
			</div>
			<p className="mt-settings-hint mt-settings-privacy">
				{t("translationPrivacy")}
			</p>
			<div className="mt-settings-actions">
				<Button size="sm" variant="ghost" onClick={onClose}>
					{t("cancelSettings")}
				</Button>
				<Button
					size="sm"
					disabled={busy || (target !== "off" && (loading || !model))}
					onClick={() => void apply()}
				>
					{busy ? <Loader2 size={13} className="animate-spin" /> : null}
					{t("applySettings")}
				</Button>
			</div>
		</div>
	);
}
