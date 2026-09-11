import {
	Check,
	ChevronDown,
	Cpu,
	Loader2,
	Search,
	Sparkles,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { Input } from "@/main/components/ui/input";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/main/components/ui/popover";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/main/components/ui/tooltip";
import {
	providerLabel,
	type SelectableModel,
	shortModelName,
} from "@/main/hooks/selectable-model";
import type { ServiceProvider } from "@/services/llm/interfaces/llm-service.interface";

/**
 * Above this many models the list gets a search box.
 *
 * OpenRouter alone publishes hundreds, so scrolling is not a way to find
 * anything; a handful of local models is faster to read than to filter.
 */
const SEARCH_THRESHOLD = 8;

export interface ModelSelectorProps {
	models: SelectableModel[];
	byProvider: Map<ServiceProvider, SelectableModel[]>;
	currentModelId: string;
	isLoading: boolean;
	onSelect: (model: SelectableModel) => void;
	/**
	 * Providers configured but not loaded — an encrypted key that has not been
	 * unlocked in this session. Reported so the empty state can say what to do.
	 */
	lockedProviders?: ServiceProvider[];
	/** Re-read the providers. Called on open, since one may have become ready. */
	onOpen?: () => void;
	/** Shorten the name for a composer too narrow to spell it out. */
	isNarrow?: boolean;
	disabled?: boolean;
	className?: string;
}

const matches = (model: SelectableModel, query: string): boolean => {
	if (!query) return true;
	const needle = query.toLowerCase();
	return (
		model.name.toLowerCase().includes(needle) ||
		model.id.toLowerCase().includes(needle) ||
		providerLabel(model.provider).toLowerCase().includes(needle)
	);
};

export const ModelSelector: React.FC<ModelSelectorProps> = ({
	models,
	byProvider,
	currentModelId,
	isLoading,
	onSelect,
	lockedProviders = [],
	onOpen,
	isNarrow = false,
	disabled = false,
	className,
}) => {
	const { t } = useTranslation("chat");
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const searchRef = useRef<HTMLInputElement>(null);

	const showSearch = models.length > SEARCH_THRESHOLD;

	// Reopening with the last search still applied hides models the user never
	// excluded on purpose.
	useEffect(() => {
		if (!open) setQuery("");
	}, [open]);

	// A provider whose key was locked when the composer mounted is usually ready
	// by the time someone opens this, so re-read rather than showing the stale
	// "no models" answer.
	useEffect(() => {
		if (open) onOpen?.();
	}, [open, onOpen]);

	useEffect(() => {
		if (!open || !showSearch) return;
		const timer = window.setTimeout(() => searchRef.current?.focus(), 30);
		return () => window.clearTimeout(timer);
	}, [open, showSearch]);

	const current = useMemo(
		() => models.find((model) => model.id === currentModelId),
		[models, currentModelId],
	);

	const groups = useMemo(() => {
		const filtered: Array<[ServiceProvider, SelectableModel[]]> = [];
		for (const [provider, providerModels] of byProvider) {
			const kept = providerModels.filter((model) => matches(model, query));
			if (kept.length > 0) filtered.push([provider, kept]);
		}
		return filtered;
	}, [byProvider, query]);

	const label = current
		? shortModelName(current)
		: currentModelId
			? shortModelName({ id: currentModelId, name: currentModelId })
			: t("model.select", { defaultValue: "Model" });

	const triggerTitle = current
		? `${providerLabel(current.provider)} · ${current.name}`
		: label;

	return (
		<Popover open={open} onOpenChange={setOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							disabled={disabled}
							aria-label={triggerTitle}
							className={cn(
								"h-8 min-w-0 gap-1 rounded-xl px-2 text-xs text-muted-foreground hover:text-foreground",
								className,
							)}
						>
							{isLoading ? (
								<Loader2 size={14} className="shrink-0 animate-spin" />
							) : current?.isLocal ? (
								<Cpu size={14} className="shrink-0" />
							) : (
								<Sparkles size={14} className="shrink-0" />
							)}
							{/* Narrow keeps the name, just a shorter one: an icon alone
							    does not say which model is running. */}
							<span
								className={cn(
									"min-w-0 truncate",
									isNarrow ? "max-w-14" : "max-w-24",
								)}
							>
								{label}
							</span>
							<ChevronDown size={10} className="shrink-0 opacity-50" />
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent>
					<p className="text-xs">{triggerTitle}</p>
				</TooltipContent>
			</Tooltip>

			<PopoverContent align="start" className="w-72 p-0">
				{showSearch ? (
					<div className="relative border-b border-border/60 p-2">
						<Search className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
						<Input
							ref={searchRef}
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={t("model.searchPlaceholder", {
								defaultValue: "Search models",
							})}
							className="h-8 pl-7 text-xs"
						/>
					</div>
				) : null}

				{/* A stable handle for tests: the trigger repeats the current model
				    name, so "is it in the list" has to be asked of the list. */}
				<div data-model-options className="max-h-72 overflow-y-auto p-1">
					{groups.length === 0 ? (
						<p className="px-2 py-6 text-center text-xs text-muted-foreground">
							{models.length > 0
								? t("model.noMatches", { defaultValue: "No matching models" })
								: lockedProviders.length > 0
									? t("model.locked", {
											providers: lockedProviders
												.map((provider) => providerLabel(provider))
												.join(", "),
											defaultValue: `${lockedProviders
												.map((provider) => providerLabel(provider))
												.join(
													", ",
												)} is set up but locked. Unlock it on the Models page to use it here.`,
										})
									: t("model.noneAvailable", {
											defaultValue:
												"No models yet. Add a provider or download one first.",
										})}
						</p>
					) : (
						groups.map(([provider, providerModels]) => (
							<div key={provider} className="mb-1 last:mb-0">
								<p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
									{providerLabel(provider)}
								</p>
								{providerModels.map((model) => {
									const isCurrent = model.id === currentModelId;
									return (
										<button
											key={`${model.provider}:${model.id}`}
											type="button"
											onClick={() => {
												setOpen(false);
												if (!isCurrent) onSelect(model);
											}}
											title={model.id}
											className={cn(
												"flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
												"hover:bg-accent hover:text-accent-foreground",
												isCurrent && "bg-accent/60 text-accent-foreground",
											)}
										>
											<span className="min-w-0 flex-1 truncate">
												{shortModelName(model)}
											</span>
											{isCurrent ? (
												<Check size={13} className="shrink-0 text-primary" />
											) : null}
										</button>
									);
								})}
							</div>
						))
					)}
				</div>

				{lockedProviders.length > 0 && models.length > 0 ? (
					<p className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
						{t("model.lockedHint", {
							providers: lockedProviders
								.map((provider) => providerLabel(provider))
								.join(", "),
							defaultValue: `${lockedProviders
								.map((provider) => providerLabel(provider))
								.join(", ")} is locked — unlock it on the Models page.`,
						})}
					</p>
				) : null}
			</PopoverContent>
		</Popover>
	);
};
