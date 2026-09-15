import { SendIcon, Square } from "lucide-react";
import type React from "react";
import {
	forwardRef,
	useImperativeHandle,
	useLayoutEffect,
	useRef,
} from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import {
	PromptInput,
	PromptInputToolbar,
	PromptInputTools,
} from "@/main/components/ui/shadcn-io/ai/prompt-input";
import { useStudioModelPicker } from "./studio-model-picker";

/** Chat's composer control: a quiet 32px pill (see `ChatInputControls`). */
export const COMPOSER_CONTROL =
	"h-8 rounded-xl text-xs text-muted-foreground hover:text-foreground";
export const COMPOSER_ICON_CONTROL = `${COMPOSER_CONTROL} w-8 px-0`;

type DataAttributes = Record<`data-${string}`, string | boolean | undefined>;

interface StudioComposerProps {
	/** Above the input card, inside the dock (staged files, hints). */
	above?: React.ReactNode;
	/** The card's body: a textarea, a staged file, a recorder. */
	children: React.ReactNode;
	/** Left of the toolbar: pickers and settings. */
	tools?: React.ReactNode;
	/** Right of the toolbar, before the send button: counters, hints. */
	trailing?: React.ReactNode;
	running: boolean;
	onStop: () => void;
	stopLabel: string;
	/** Omit the send button (a composer whose input starts the run itself). */
	hideSubmit?: boolean;
	/** Required unless `hideSubmit`. */
	canSubmit?: boolean;
	onSubmit?: () => void;
	submitLabel?: string;
	submitProps?: DataAttributes;
	stopProps?: DataAttributes;
	className?: string;
	[data: `data-${string}`]: string | boolean | undefined;
}

/**
 * The input dock under a studio thread, built from chat's prompt-input
 * primitives with chat's card, toolbar and send/stop buttons, so writing to a
 * speech or image model feels like writing to a chat model.
 */
export const StudioComposer: React.FC<StudioComposerProps> = ({
	above,
	children,
	tools,
	trailing,
	running,
	canSubmit = false,
	onSubmit,
	onStop,
	submitLabel,
	stopLabel,
	hideSubmit = false,
	submitProps,
	stopProps,
	className,
	...data
}) => {
	const modelPicker = useStudioModelPicker();
	return (
		<div className="relative z-10 w-full flex-shrink-0 bg-background/90 px-2 pb-3 pt-0 shadow-[0_-18px_45px_hsl(var(--background)/0.92)] backdrop-blur-xl sm:px-4 sm:pb-4">
			<div className="relative mx-auto min-w-0 max-w-4xl">
				{above ? <div className="mb-2">{above}</div> : null}
				<PromptInput
					className={cn(
						"divide-border/50 rounded-[22px] border-border/70 bg-card/95 shadow-[0_18px_55px_hsl(var(--foreground)/0.10)]",
						className,
					)}
					onSubmit={(event) => {
						event.preventDefault();
						if (!running && canSubmit) onSubmit?.();
					}}
					{...data}
				>
					<div>{children}</div>
					<PromptInputToolbar className="items-center gap-1 p-1.5">
						<div className="flex min-w-0 flex-1 items-center gap-1">
							<div className="min-w-0 flex-1 overflow-hidden">
								<PromptInputTools className="min-w-0 flex-nowrap gap-1">
									{tools}
									{modelPicker ? (
										<div
											className="flex h-8 min-w-0 items-center rounded-xl bg-muted/40"
											data-studio-model-pill
										>
											{modelPicker}
										</div>
									) : null}
								</PromptInputTools>
							</div>
							<div className="ml-auto flex shrink-0 items-center gap-1">
								{trailing}
								{running ? (
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={onStop}
										className={cn(
											COMPOSER_ICON_CONTROL,
											"border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10",
										)}
										aria-label={stopLabel}
										title={stopLabel}
										{...stopProps}
									>
										<Square size={14} />
									</Button>
								) : hideSubmit ? null : (
									<Button
										type="submit"
										size="icon"
										disabled={!canSubmit}
										aria-label={submitLabel}
										title={submitLabel}
										className="h-8 w-8 rounded-xl bg-foreground/90 px-0 text-background shadow-sm transition hover:bg-foreground disabled:bg-muted/70 disabled:text-muted-foreground disabled:opacity-100"
										{...submitProps}
									>
										<SendIcon className="size-4" />
									</Button>
								)}
							</div>
						</div>
					</PromptInputToolbar>
				</PromptInput>
			</div>
		</div>
	);
};

type StudioComposerTextareaProps =
	React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
		/** Called on Enter (Shift+Enter keeps a newline), like chat. */
		onSubmitShortcut?: () => void;
	};

/** Whether the browser sizes a textarea to its content from CSS alone. */
const supportsFieldSizing = () =>
	typeof CSS !== "undefined" &&
	typeof CSS.supports === "function" &&
	CSS.supports("field-sizing", "content");

/** Chat's composer textarea: grows with the text, Enter sends. */
export const StudioComposerTextarea = forwardRef<
	HTMLTextAreaElement,
	StudioComposerTextareaProps
>(({ className, onSubmitShortcut, onKeyDown, value, ...props }, ref) => {
	const inner = useRef<HTMLTextAreaElement>(null);
	useImperativeHandle(ref, () => inner.current as HTMLTextAreaElement);

	// Browsers without `field-sizing` (Firefox) get the same growth measured
	// by hand; the CSS max height still caps it.
	// biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
	useLayoutEffect(() => {
		const element = inner.current;
		if (!element || supportsFieldSizing()) return;
		element.style.height = "auto";
		element.style.height = `${element.scrollHeight}px`;
	}, [value]);

	return (
		<textarea
			ref={inner}
			rows={1}
			value={value}
			onKeyDown={(event) => {
				onKeyDown?.(event);
				if (event.defaultPrevented) return;
				if (
					event.key === "Enter" &&
					!event.shiftKey &&
					!event.nativeEvent.isComposing
				) {
					event.preventDefault();
					onSubmitShortcut?.();
				}
			}}
			className={cn(
				"field-sizing-content block min-h-[72px] max-h-[40vh] w-full resize-none border-0 bg-transparent px-3 py-2.5 text-[15px] leading-6 text-foreground shadow-none outline-none placeholder:text-muted-foreground focus-visible:outline-none sm:px-4",
				className,
			)}
			{...props}
		/>
	);
});
StudioComposerTextarea.displayName = "StudioComposerTextarea";
