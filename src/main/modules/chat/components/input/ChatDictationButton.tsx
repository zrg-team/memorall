import { Loader2, Mic, Square } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import { useAudioRecorder } from "@/main/modules/studio/hooks/use-audio-recorder";
import { useCategoryCurrentModel } from "@/main/modules/studio/hooks/use-category-current-model";
import { useWorkspaceModeStore } from "@/main/stores/workspace-mode";
import { serviceManager } from "@/services";
import { isResidentLocalProvider } from "@/services/llm/provider-registry";

interface ChatDictationButtonProps {
	/** Receives the transcript; the composer decides where it goes. */
	onText: (text: string) => void;
	disabled?: boolean;
	className?: string;
}

/**
 * Dictate into the composer with the transcription model.
 *
 * Nothing is sent: the transcript lands in the input for the user to read and
 * edit first, because a misheard word in a sent prompt costs a whole turn.
 * Without a transcription model the button opens the Transcribe studio, where
 * one can be picked.
 */
export const ChatDictationButton: React.FC<ChatDictationButtonProps> = ({
	onText,
	disabled = false,
	className,
}) => {
	const { t } = useTranslation("chat");
	const { current } = useCategoryCurrentModel("speech-to-text");
	const recorder = useAudioRecorder();
	const setWorkspaceMode = useWorkspaceModeStore((state) => state.setMode);
	const [transcribing, setTranscribing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const recording = recorder.state === "recording";
	const unavailable = recorder.state === "unsupported";

	const finish = useCallback(async () => {
		const blob = await recorder.stop();
		if (!blob || !current) return;
		setTranscribing(true);
		setError(null);
		try {
			const bytes = new Uint8Array(await blob.arrayBuffer());
			const result = await serviceManager.llmService.audioTranscriptionsFor(
				current.serviceName,
				{
					model: current.modelId,
					file: { kind: "bytes", bytes, mimeType: blob.type || "audio/webm" },
				},
			);
			const text = result.text.trim();
			if (text) onText(text);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : String(reason));
		} finally {
			setTranscribing(false);
		}
	}, [current, onText, recorder]);

	useEffect(() => {
		if (!recording) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") recorder.cancel();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [recording, recorder]);

	const handleClick = () => {
		if (!current) {
			setWorkspaceMode("speech-to-text");
			return;
		}
		if (recording) {
			void finish();
			return;
		}
		setError(null);
		void recorder.start();
	};

	const label = !current
		? t("dictation.chooseModel", {
				defaultValue: "Dictate — choose a transcription model first",
			})
		: recording
			? t("dictation.stop", {
					defaultValue: "Stop and transcribe (Esc to cancel)",
				})
			: transcribing
				? t("dictation.transcribing", { defaultValue: "Transcribing…" })
				: recorder.state === "denied"
					? t("dictation.denied", {
							defaultValue: "Microphone access is blocked for this page",
						})
					: t("dictation.start", { defaultValue: "Dictate" });

	const hint =
		current && isResidentLocalProvider(current.provider)
			? t("dictation.localHint", {
					defaultValue:
						"Runs on this device. A local chat model is unloaded while transcribing and reloads on your next message.",
				})
			: null;

	if (unavailable) return null;

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					onClick={handleClick}
					disabled={disabled || transcribing || recorder.state === "requesting"}
					aria-label={label}
					aria-pressed={recording}
					data-chat-dictation={
						recording ? "recording" : transcribing ? "transcribing" : "idle"
					}
					className={cn(
						"relative h-8 w-8 rounded-xl px-0 text-xs text-muted-foreground hover:text-foreground",
						recording && "bg-red-500/10 text-red-600 hover:text-red-600",
						className,
					)}
				>
					{recording ? (
						<>
							<span
								aria-hidden="true"
								className="absolute inset-1 rounded-lg bg-red-500/20 motion-reduce:hidden"
								style={{ transform: `scale(${1 + recorder.level * 0.35})` }}
							/>
							<Square size={12} className="relative fill-current" />
						</>
					) : transcribing ? (
						<Loader2 size={14} className="animate-spin" />
					) : (
						<Mic size={14} />
					)}
				</Button>
			</TooltipTrigger>
			<TooltipContent className="max-w-64">
				<p className="text-xs">{error ?? label}</p>
				{hint && !error ? (
					<p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
				) : null}
			</TooltipContent>
		</Tooltip>
	);
};
