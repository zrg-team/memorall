import { SlidersHorizontal, Volume2, VolumeX } from "lucide-react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/main/components/ui/popover";
import type { MediaVoice } from "@/types/openai-media";
import {
	COMPOSER_CONTROL,
	COMPOSER_ICON_CONTROL,
	StudioComposer,
	StudioComposerTextarea,
} from "../shared/StudioComposer";
import { LiveLevelMeter } from "./LiveLevelMeter";
import { SpeechSettings, type SpeechSettingsValue } from "./SpeechSettings";
import {
	DEFAULT_SPEED,
	MUSIC_DURATIONS,
	formatSpeed,
	SPEECH_INPUT_LIMIT,
	SPEECH_INPUT_WARN,
} from "./speech-studio-utils";
import { VoicePicker } from "./VoicePicker";

interface SpeechComposerProps {
	isMusic: boolean;
	isNarrow: boolean;
	text: string;
	onTextChange: (text: string) => void;
	voices: MediaVoice[];
	voice: string;
	onVoiceChange: (voice: string) => void;
	/** The model publishes no voices but its provider needs a voice name. */
	asksVoiceName: boolean;
	/** Seconds of music to generate. */
	duration: number;
	onDurationChange: (seconds: number) => void;
	settings: SpeechSettingsValue;
	onSettingsChange: (patch: Partial<SpeechSettingsValue>) => void;
	showInstructions: boolean;
	showSeed: boolean;
	/** Input past the limit is rejected by the provider, not just slow. */
	enforceLimit: boolean;
	running: boolean;
	onGenerate: () => void;
	onStop: () => void;
	livePlayback: boolean;
	onLivePlaybackChange: (enabled: boolean) => void;
	playing: boolean;
	analyser: AnalyserNode | null;
	/** Prompt ideas shown while the box is empty (music only). */
	examples?: string[];
	textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

const chipClass =
	"shrink-0 rounded-full border border-border/70 bg-background px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The write -> hear box pinned under the clip thread - chat's composer, with
 * the voice, settings and live playback in its toolbar.
 *
 * Settings sit behind one popover so a 360px panel keeps room for the text;
 * the trigger echoes a changed speed so it is not forgotten.
 */
export const SpeechComposer: React.FC<SpeechComposerProps> = ({
	isMusic,
	isNarrow,
	text,
	onTextChange,
	voices,
	voice,
	onVoiceChange,
	asksVoiceName,
	duration,
	onDurationChange,
	settings,
	onSettingsChange,
	showInstructions,
	showSeed,
	enforceLimit,
	running,
	onGenerate,
	onStop,
	livePlayback,
	onLivePlaybackChange,
	playing,
	analyser,
	examples,
	textareaRef,
}) => {
	const { t } = useTranslation("studioSpeech");
	const { t: tStudio } = useTranslation("studio");

	const length = text.length;
	const overLimit = length > SPEECH_INPUT_LIMIT;
	const nearLimit = length > SPEECH_INPUT_WARN;
	const blocked =
		text.trim().length === 0 ||
		(enforceLimit && overLimit) ||
		(!isMusic && asksVoiceName && voice.trim().length === 0);

	const hasSettings = !isMusic;
	const settingsLabel = t("settings.label", { defaultValue: "Settings" });
	const speedChanged = settings.speed !== DEFAULT_SPEED;

	const liveLabel = livePlayback
		? t("composer.muteLive", { defaultValue: "Mute live playback" })
		: t("composer.unmuteLive", { defaultValue: "Play while generating" });

	const label = isMusic
		? t("composer.musicLabel", { defaultValue: "Music prompt" })
		: t("composer.label", { defaultValue: "Text to speak" });

	return (
		<StudioComposer
			data-speech-composer={isMusic ? "music" : "speech"}
			running={running}
			canSubmit={!blocked}
			onSubmit={onGenerate}
			onStop={onStop}
			submitLabel={tStudio("common.generate", { defaultValue: "Generate" })}
			stopLabel={tStudio("common.stop", { defaultValue: "Stop" })}
			submitProps={{ "data-speech-generate": true }}
			stopProps={{ "data-speech-stop": true }}
			above={
				isMusic && examples?.length && text.length === 0 ? (
					<div
						className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5"
						data-music-examples
					>
						{examples.map((example) => (
							<button
								key={example}
								type="button"
								className={chipClass}
								onClick={() => {
									onTextChange(example);
									textareaRef.current?.focus();
								}}
								data-example-prompt
							>
								{example}
							</button>
						))}
					</div>
				) : null
			}
			tools={
				<>
					{!isMusic && voices.length > 1 ? (
						<VoicePicker
							voices={voices}
							value={voice}
							onChange={onVoiceChange}
							disabled={running}
							isNarrow={isNarrow}
						/>
					) : null}
					{/* A model that publishes no voices takes whatever voice name its
					    provider documents. */}
					{!isMusic && asksVoiceName ? (
						<input
							type="text"
							value={voice}
							onChange={(event) => onVoiceChange(event.target.value)}
							disabled={running}
							placeholder={t("composer.voicePlaceholder", {
								defaultValue: "Voice",
							})}
							aria-label={t("composer.voice", { defaultValue: "Voice" })}
							className="h-8 w-28 min-w-0 rounded-xl border border-border/70 bg-background px-2 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							data-speech-voice-input
						/>
					) : null}

					{isMusic ? (
						<select
							value={duration}
							onChange={(event) => onDurationChange(Number(event.target.value))}
							disabled={running}
							aria-label={t("composer.duration", { defaultValue: "Length" })}
							title={t("composer.duration", { defaultValue: "Length" })}
							className="h-8 min-w-0 rounded-xl border border-border/70 bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
							data-music-duration
						>
							{MUSIC_DURATIONS.map((seconds) => (
								<option key={seconds} value={seconds}>
									{t("composer.seconds", {
										seconds,
										defaultValue: `${seconds} s`,
									})}
								</option>
							))}
						</select>
					) : null}

					{hasSettings ? (
						<Popover>
							<PopoverTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									className={cn(COMPOSER_CONTROL, "min-w-0 gap-1.5 px-2")}
									aria-label={settingsLabel}
									title={settingsLabel}
									data-speech-settings-toggle
								>
									<SlidersHorizontal size={14} />
									{!isNarrow ? (
										<span className="truncate">{settingsLabel}</span>
									) : null}
									{speedChanged ? (
										<span className="tabular-nums text-[10px] text-primary">
											{formatSpeed(settings.speed)}
										</span>
									) : null}
								</Button>
							</PopoverTrigger>
							<PopoverContent
								side="top"
								align="start"
								className="w-72 max-w-[calc(100vw-1.5rem)] p-3"
							>
								<SpeechSettings
									value={settings}
									onChange={onSettingsChange}
									showInstructions={showInstructions}
									showSeed={showSeed}
									disabled={running}
								/>
							</PopoverContent>
						</Popover>
					) : null}
				</>
			}
			trailing={
				<>
					{text.length > 0 && !isMusic ? (
						<span
							className={cn(
								"px-1 tabular-nums text-[11px] text-muted-foreground",
								nearLimit && "text-amber-600 dark:text-amber-400",
								overLimit && "font-medium text-destructive",
							)}
							title={
								overLimit
									? t("composer.overLimit", {
											limit: SPEECH_INPUT_LIMIT,
											defaultValue: `Longer than ${SPEECH_INPUT_LIMIT} characters`,
										})
									: undefined
							}
							data-speech-counter={
								overLimit ? "over" : nearLimit ? "warn" : "ok"
							}
						>
							{nearLimit ? `${length} / ${SPEECH_INPUT_LIMIT}` : length}
						</span>
					) : null}

					{running ? (
						<LiveLevelMeter analyser={analyser} active={playing} />
					) : null}

					<Button
						type="button"
						variant="ghost"
						size="icon"
						className={cn(
							COMPOSER_ICON_CONTROL,
							!livePlayback && "text-muted-foreground/60",
						)}
						onClick={() => onLivePlaybackChange(!livePlayback)}
						aria-label={liveLabel}
						title={liveLabel}
						aria-pressed={livePlayback}
						data-live-playback={livePlayback ? "on" : "off"}
					>
						{livePlayback ? <Volume2 size={15} /> : <VolumeX size={15} />}
					</Button>
				</>
			}
		>
			<StudioComposerTextarea
				ref={textareaRef}
				value={text}
				onChange={(event) => onTextChange(event.target.value)}
				onSubmitShortcut={() => {
					if (!running && !blocked) onGenerate();
				}}
				placeholder={
					isMusic
						? t("composer.musicPlaceholder", {
								defaultValue:
									"Describe the music: genre, mood, instruments, tempo",
							})
						: t("composer.placeholder", {
								defaultValue: "Type or paste text to speak",
							})
				}
				aria-label={label}
				data-speech-input
			/>
		</StudioComposer>
	);
};
