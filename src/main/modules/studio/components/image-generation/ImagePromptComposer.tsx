import { Dices, SlidersHorizontal } from "lucide-react";
import type React from "react";
import { forwardRef, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import { Label } from "@/main/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/main/components/ui/popover";
import {
	COMPOSER_CONTROL,
	StudioComposer,
	StudioComposerTextarea,
} from "../shared/StudioComposer";
import {
	formatImageSize,
	IMAGE_QUALITIES,
	type ImageQuality,
	MAX_IMAGE_COUNT,
	orientationOf,
	randomSeed,
} from "./image-generation-options";

export interface ImageSettings {
	size: string;
	n: number;
	quality: ImageQuality;
	/** Kept as typed; empty means a fresh random seed per run. */
	seed: string;
}

export interface ImageComposerCapabilities {
	sizes: string[];
	count: boolean;
	quality: boolean;
	seed: boolean;
}

export interface ImagePromptComposerHandle {
	focus: () => void;
}

interface ImagePromptComposerProps {
	prompt: string;
	onPromptChange: (prompt: string) => void;
	settings: ImageSettings;
	onSettingsChange: (settings: ImageSettings) => void;
	capabilities: ImageComposerCapabilities;
	running: boolean;
	onSubmit: () => void;
	onStop: () => void;
	isNarrow: boolean;
}

const OptionButton: React.FC<{
	selected: boolean;
	onClick: () => void;
	children: React.ReactNode;
	className?: string;
	[data: `data-${string}`]: string | boolean | undefined;
}> = ({ selected, onClick, children, className, ...data }) => (
	<button
		type="button"
		aria-pressed={selected}
		onClick={onClick}
		className={cn(
			"rounded-md border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
			selected
				? "border-primary bg-primary/10 text-foreground"
				: "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
			className,
		)}
		{...data}
	>
		{children}
	</button>
);

/**
 * The prompt box pinned under the gallery - chat's composer, with the image
 * options in its toolbar.
 *
 * Settings sit behind one popover because a 360px panel has room for the
 * prompt and a button, not for four rows of controls; the trigger echoes the
 * choices that differ from a single default image so they are not forgotten.
 */
export const ImagePromptComposer = forwardRef<
	ImagePromptComposerHandle,
	ImagePromptComposerProps
>(
	(
		{
			prompt,
			onPromptChange,
			settings,
			onSettingsChange,
			capabilities,
			running,
			onSubmit,
			onStop,
			isNarrow,
		},
		ref,
	) => {
		const { t } = useTranslation("studioImage");
		const { t: tc } = useTranslation("studio");
		const textarea = useRef<HTMLTextAreaElement>(null);

		useImperativeHandle(ref, () => ({
			focus: () => textarea.current?.focus(),
		}));

		const set = (patch: Partial<ImageSettings>) =>
			onSettingsChange({ ...settings, ...patch });
		const canSubmit = prompt.trim().length > 0;
		const hasSettings =
			capabilities.sizes.length > 1 ||
			capabilities.count ||
			capabilities.quality ||
			capabilities.seed;

		const summary = [
			capabilities.sizes.length > 1 ? formatImageSize(settings.size) : null,
			capabilities.count && settings.n > 1 ? `×${settings.n}` : null,
			capabilities.seed && settings.seed ? `#${settings.seed}` : null,
		]
			.filter(Boolean)
			.join(" · ");

		return (
			<StudioComposer
				data-image-composer
				running={running}
				canSubmit={canSubmit}
				onSubmit={onSubmit}
				onStop={onStop}
				submitLabel={tc("common.generate", { defaultValue: "Generate" })}
				stopLabel={tc("common.stop", { defaultValue: "Stop" })}
				submitProps={{ "data-image-generate": true }}
				stopProps={{ "data-image-stop": true }}
				trailing={
					isNarrow ? null : (
						<span className="hidden truncate px-1 text-[11px] text-muted-foreground sm:inline">
							{t("composer.shortcut", {
								defaultValue: "Enter to generate",
							})}
						</span>
					)
				}
				tools={
					<>
						{hasSettings ? (
							<Popover>
								<PopoverTrigger asChild>
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className={cn(COMPOSER_CONTROL, "min-w-0 gap-1.5 px-2")}
										aria-label={t("composer.settings", {
											defaultValue: "Image settings",
										})}
										title={t("composer.settings", {
											defaultValue: "Image settings",
										})}
										data-image-settings-trigger
									>
										<SlidersHorizontal size={14} />
										{summary ? (
											<span className="truncate">{summary}</span>
										) : null}
									</Button>
								</PopoverTrigger>
								<PopoverContent
									align="start"
									side="top"
									className="w-72 max-w-[calc(100vw-1.5rem)] space-y-3 p-3"
									data-image-settings
								>
									{capabilities.sizes.length > 1 ? (
										<fieldset className="space-y-1.5" data-image-sizes>
											<legend className="text-xs font-medium">
												{t("settings.size", { defaultValue: "Size" })}
											</legend>
											<div className="flex flex-wrap gap-1.5">
												{capabilities.sizes.map((size) => (
													<OptionButton
														key={size}
														selected={settings.size === size}
														onClick={() => set({ size })}
														data-image-size={size}
													>
														<span className="block">
															{t(
																`settings.orientation.${orientationOf(size)}`,
																{
																	defaultValue: orientationOf(size),
																},
															)}
														</span>
														{size !== "auto" ? (
															<span className="block text-[10px] text-muted-foreground tabular-nums">
																{formatImageSize(size)}
															</span>
														) : null}
													</OptionButton>
												))}
											</div>
										</fieldset>
									) : null}

									{capabilities.count ? (
										<fieldset className="space-y-1.5" data-image-count>
											<legend className="text-xs font-medium">
												{t("settings.count", {
													defaultValue: "Number of images",
												})}
											</legend>
											<div className="flex gap-1.5">
												{Array.from(
													{ length: MAX_IMAGE_COUNT },
													(_, index) => index + 1,
												).map((count) => (
													<OptionButton
														key={count}
														selected={settings.n === count}
														onClick={() => set({ n: count })}
														className="w-9 tabular-nums"
														data-image-count-option={String(count)}
													>
														{count}
													</OptionButton>
												))}
											</div>
										</fieldset>
									) : null}

									{capabilities.quality ? (
										<fieldset className="space-y-1.5" data-image-quality>
											<legend className="text-xs font-medium">
												{t("settings.quality", { defaultValue: "Quality" })}
											</legend>
											<div className="flex flex-wrap gap-1.5">
												{IMAGE_QUALITIES.map((quality) => (
													<OptionButton
														key={quality}
														selected={settings.quality === quality}
														onClick={() => set({ quality })}
														data-image-quality-option={quality}
													>
														{t(`settings.qualities.${quality}`, {
															defaultValue: quality,
														})}
													</OptionButton>
												))}
											</div>
										</fieldset>
									) : null}

									{capabilities.seed ? (
										<div className="space-y-1.5" data-image-seed>
											<Label
												htmlFor="image-generation-seed"
												className="text-xs"
											>
												{t("settings.seed", { defaultValue: "Seed" })}
											</Label>
											<div className="flex gap-1.5">
												<Input
													id="image-generation-seed"
													inputMode="numeric"
													value={settings.seed}
													onChange={(event) =>
														set({
															seed: event.target.value
																.replace(/[^\d]/g, "")
																.slice(0, 10),
														})
													}
													placeholder={t("settings.seedPlaceholder", {
														defaultValue: "Random",
													})}
													className="h-8 text-xs"
												/>
												<Button
													type="button"
													variant="outline"
													size="icon"
													className="h-8 w-8 shrink-0"
													onClick={() => set({ seed: String(randomSeed()) })}
													aria-label={t("settings.randomizeSeed", {
														defaultValue: "Random seed",
													})}
													title={t("settings.randomizeSeed", {
														defaultValue: "Random seed",
													})}
													data-image-seed-randomize
												>
													<Dices size={14} />
												</Button>
											</div>
											<p className="text-[11px] text-muted-foreground">
												{t("settings.seedHint", {
													defaultValue:
														"Use the same seed and prompt to get the same image again.",
												})}
											</p>
										</div>
									) : null}
								</PopoverContent>
							</Popover>
						) : null}
					</>
				}
			>
				<label htmlFor="image-generation-prompt" className="sr-only">
					{t("composer.placeholder", {
						defaultValue: "Describe the image you want",
					})}
				</label>
				<StudioComposerTextarea
					id="image-generation-prompt"
					ref={textarea}
					value={prompt}
					onChange={(event) => onPromptChange(event.target.value)}
					onSubmitShortcut={() => {
						if (!running && canSubmit) onSubmit();
					}}
					placeholder={t("composer.placeholder", {
						defaultValue: "Describe the image you want",
					})}
					data-image-prompt
				/>
			</StudioComposer>
		);
	},
);
ImagePromptComposer.displayName = "ImagePromptComposer";
