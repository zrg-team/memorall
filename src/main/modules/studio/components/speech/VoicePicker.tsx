import { Check, ChevronDown, Pause, Play, UserRound } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/main/components/ui/popover";
import type { MediaVoice } from "@/types/openai-media";

interface VoicePickerProps {
	voices: MediaVoice[];
	value: string;
	onChange: (voice: string) => void;
	disabled?: boolean;
	isNarrow?: boolean;
}

const tagClass =
	"rounded-full border border-border/70 px-1.5 py-px text-[10px] font-medium uppercase leading-4 text-muted-foreground";

/**
 * Compact voice chooser for the composer.
 *
 * A popover rather than a select because each row needs a second control: the
 * preview button. Hearing a voice before spending a (possibly slow, local)
 * generation on it is the single most useful thing a voice list can offer.
 */
export const VoicePicker: React.FC<VoicePickerProps> = ({
	voices,
	value,
	onChange,
	disabled,
	isNarrow,
}) => {
	const { t } = useTranslation("studioSpeech");
	const [open, setOpen] = useState(false);
	const [previewing, setPreviewing] = useState<string | null>(null);
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const selected = voices.find((voice) => voice.id === value) ?? voices[0];

	const stopPreview = useCallback(() => {
		audioRef.current?.pause();
		audioRef.current = null;
		setPreviewing(null);
	}, []);

	useEffect(() => stopPreview, [stopPreview]);

	const togglePreview = (voice: MediaVoice) => {
		if (!voice.previewUrl) return;
		const wasPlaying = previewing === voice.id;
		// Only one preview at a time; a second click on the same voice stops it.
		stopPreview();
		if (wasPlaying) return;
		const audio = new Audio(voice.previewUrl);
		audioRef.current = audio;
		setPreviewing(voice.id);
		const clear = () => {
			if (audioRef.current === audio) {
				audioRef.current = null;
				setPreviewing(null);
			}
		};
		audio.addEventListener("ended", clear);
		audio.addEventListener("error", clear);
		void audio.play().catch(clear);
	};

	const genderLabel = (gender: MediaVoice["gender"]) =>
		gender === "female"
			? t("voice.female", { defaultValue: "Female" })
			: gender === "male"
				? t("voice.male", { defaultValue: "Male" })
				: gender === "neutral"
					? t("voice.neutral", { defaultValue: "Neutral" })
					: null;

	const moveFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
		const options = Array.from(
			listRef.current?.querySelectorAll<HTMLButtonElement>(
				"[data-voice-option]",
			) ?? [],
		);
		if (options.length === 0) return;
		event.preventDefault();
		const index = options.indexOf(document.activeElement as HTMLButtonElement);
		const next =
			event.key === "ArrowDown"
				? (index + 1) % options.length
				: (index - 1 + options.length) % options.length;
		options[next]?.focus();
	};

	return (
		<Popover
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) stopPreview();
			}}
		>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="sm"
					disabled={disabled}
					className="h-8 min-w-0 max-w-[11rem] gap-1 rounded-xl px-2 text-xs text-muted-foreground hover:text-foreground"
					aria-label={t("voice.choose", {
						voice: selected?.name ?? value,
						defaultValue: `Voice: ${selected?.name ?? value}`,
					})}
					data-voice-picker
				>
					<UserRound size={14} className="shrink-0" />
					<span className="truncate">{selected?.name ?? value}</span>
					<ChevronDown size={12} className="shrink-0 opacity-60" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				align="start"
				side="top"
				className={cn(
					"p-1",
					isNarrow ? "w-[min(18rem,calc(100vw-2rem))]" : "w-72",
				)}
				onOpenAutoFocus={(event) => {
					// Land on the current voice so arrow keys start from it.
					event.preventDefault();
					listRef.current
						?.querySelector<HTMLButtonElement>(
							'[data-voice-option][aria-selected="true"]',
						)
						?.focus();
				}}
			>
				<div className="px-2 pb-1 pt-1.5 text-[11px] font-medium text-muted-foreground">
					{t("voice.label", { defaultValue: "Voice" })}
				</div>
				<div
					ref={listRef}
					role="listbox"
					aria-label={t("voice.label", { defaultValue: "Voice" })}
					className="max-h-72 overflow-y-auto"
					onKeyDown={moveFocus}
					data-voice-options
				>
					{voices.map((voice) => {
						const isSelected = voice.id === selected?.id;
						const gender = genderLabel(voice.gender);
						return (
							<div
								key={voice.id}
								className={cn(
									"flex items-center gap-1 rounded-md pr-1",
									isSelected && "bg-muted/60",
								)}
							>
								<button
									type="button"
									role="option"
									aria-selected={isSelected}
									className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
									onClick={() => {
										onChange(voice.id);
										setOpen(false);
										stopPreview();
									}}
									data-voice-option={voice.id}
								>
									<span className="min-w-0 flex-1 truncate">{voice.name}</span>
									{gender ? <span className={tagClass}>{gender}</span> : null}
									{voice.language ? (
										<span className={tagClass}>{voice.language}</span>
									) : null}
									<Check
										size={14}
										className={cn(
											"shrink-0",
											isSelected ? "opacity-100" : "opacity-0",
										)}
									/>
								</button>
								{voice.previewUrl ? (
									<Button
										type="button"
										variant="ghost"
										size="icon"
										className="h-7 w-7 shrink-0 rounded-full text-muted-foreground"
										onClick={() => togglePreview(voice)}
										aria-label={
											previewing === voice.id
												? t("voice.stopPreview", {
														voice: voice.name,
														defaultValue: `Stop preview of ${voice.name}`,
													})
												: t("voice.preview", {
														voice: voice.name,
														defaultValue: `Preview ${voice.name}`,
													})
										}
										aria-pressed={previewing === voice.id}
										data-voice-preview={voice.id}
									>
										{previewing === voice.id ? (
											<Pause size={13} />
										) : (
											<Play size={13} />
										)}
									</Button>
								) : null}
							</div>
						);
					})}
				</div>
			</PopoverContent>
		</Popover>
	);
};
