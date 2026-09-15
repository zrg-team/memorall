import { RotateCcw } from "lucide-react";
import type React from "react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import { Textarea } from "@/main/components/ui/textarea";
import {
	DEFAULT_SPEED,
	formatSpeed,
	SPEED_MAX,
	SPEED_MIN,
	SPEED_STEP,
} from "./speech-studio-utils";

export interface SpeechSettingsValue {
	speed: number;
	instructions: string;
	/** Kept as text so an empty field means "random", not 0. */
	seed: string;
}

interface SpeechSettingsProps {
	value: SpeechSettingsValue;
	onChange: (patch: Partial<SpeechSettingsValue>) => void;
	showInstructions: boolean;
	showSeed: boolean;
	disabled?: boolean;
}

/**
 * The knobs behind the composer's Settings button.
 *
 * Only settings the selected model actually honours are shown: a style prompt
 * that a local model silently ignores would teach people the feature is broken.
 */
export const SpeechSettings: React.FC<SpeechSettingsProps> = ({
	value,
	onChange,
	showInstructions,
	showSeed,
	disabled,
}) => {
	const { t } = useTranslation("studioSpeech");
	const speedId = useId();
	const instructionsId = useId();
	const seedId = useId();

	return (
		<div className="flex flex-col gap-3" data-speech-settings>
			<div className="flex flex-col gap-1.5">
				<div className="flex items-center gap-2">
					<Label htmlFor={speedId} className="text-xs">
						{t("settings.speed", { defaultValue: "Speed" })}
					</Label>
					<span
						className="tabular-nums text-xs text-muted-foreground"
						data-speed-value
					>
						{formatSpeed(value.speed)}
					</span>
					{value.speed !== DEFAULT_SPEED ? (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="ml-auto h-6 w-6 text-muted-foreground"
							onClick={() => onChange({ speed: DEFAULT_SPEED })}
							disabled={disabled}
							aria-label={t("settings.resetSpeed", {
								defaultValue: "Reset speed",
							})}
							title={t("settings.resetSpeed", { defaultValue: "Reset speed" })}
						>
							<RotateCcw size={12} />
						</Button>
					) : null}
				</div>
				<input
					id={speedId}
					type="range"
					min={SPEED_MIN}
					max={SPEED_MAX}
					step={SPEED_STEP}
					value={value.speed}
					disabled={disabled}
					onChange={(event) => onChange({ speed: Number(event.target.value) })}
					className="h-4 w-full cursor-pointer accent-primary disabled:cursor-not-allowed"
					aria-valuetext={formatSpeed(value.speed)}
					data-speed-slider
				/>
				<div className="flex justify-between text-[10px] text-muted-foreground">
					<span>{formatSpeed(SPEED_MIN)}</span>
					<span>{formatSpeed(SPEED_MAX)}</span>
				</div>
			</div>

			{showInstructions ? (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={instructionsId} className="text-xs">
						{t("settings.instructions", { defaultValue: "Style instructions" })}
					</Label>
					<Textarea
						id={instructionsId}
						value={value.instructions}
						disabled={disabled}
						onChange={(event) => onChange({ instructions: event.target.value })}
						placeholder={t("settings.instructionsPlaceholder", {
							defaultValue: "e.g. Warm and upbeat, like a friendly radio host",
						})}
						className="min-h-[60px] resize-none text-xs md:text-xs"
						rows={2}
						data-speech-instructions
					/>
				</div>
			) : null}

			{showSeed ? (
				<div className="flex flex-col gap-1.5">
					<Label htmlFor={seedId} className="text-xs">
						{t("settings.seed", { defaultValue: "Seed" })}
					</Label>
					<Input
						id={seedId}
						type="number"
						inputMode="numeric"
						min={0}
						step={1}
						value={value.seed}
						disabled={disabled}
						onChange={(event) => onChange({ seed: event.target.value })}
						placeholder={t("settings.seedPlaceholder", {
							defaultValue: "Random",
						})}
						className="h-8 text-xs md:text-xs"
						data-speech-seed
					/>
					<p className="text-[10px] text-muted-foreground">
						{t("settings.seedHint", {
							defaultValue: "Use the same seed to get the same delivery again.",
						})}
					</p>
				</div>
			) : null}
		</div>
	);
};
