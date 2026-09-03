import React from "react";
import { useTranslation } from "react-i18next";
import { Check, Search } from "lucide-react";
import { Input } from "@/main/components/ui/input";
import { Badge } from "@/main/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CachedToolDescriptor } from "@/services/mcp-connections";

/**
 * Tool scoping. Presets carry most users; the checkboxes are for the rest.
 *
 * "Read only" is derived from the MCP `readOnlyHint` annotation rather than a
 * list we maintain, so it stays correct as servers change.
 */

interface ToolScopeListProps {
	tools: CachedToolDescriptor[];
	/** Selected exposed names. Empty array means "everything". */
	value: string[];
	onChange: (next: string[]) => void;
	/**
	 * Exposed names of a curated minimal set, when the server has one (the
	 * Composio router's search → schema → execute trio). Shown as a preset.
	 */
	recommended?: string[];
	className?: string;
}

const INITIAL_VISIBLE = 6;

export const ToolScopeList: React.FC<ToolScopeListProps> = ({
	tools,
	value,
	onChange,
	recommended,
	className,
}) => {
	const { t } = useTranslation("connections");
	const [query, setQuery] = React.useState("");
	const [expanded, setExpanded] = React.useState(false);

	const selected = React.useMemo(() => new Set(value), [value]);
	const allSelected = value.length === 0 || value.length === tools.length;

	const recommendedNames = React.useMemo(() => {
		if (!recommended?.length) return [];
		const known = new Set(tools.map((tool) => tool.exposedName));
		return recommended.filter((name) => known.has(name));
	}, [recommended, tools]);
	const recommendedSelected =
		recommendedNames.length > 0 &&
		value.length === recommendedNames.length &&
		recommendedNames.every((name) => selected.has(name));

	const readOnlyNames = React.useMemo(
		() => tools.filter((tool) => tool.readOnly).map((tool) => tool.exposedName),
		[tools],
	);

	const filtered = React.useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return tools;
		return tools.filter(
			(tool) =>
				tool.exposedName.toLowerCase().includes(needle) ||
				tool.description.toLowerCase().includes(needle),
		);
	}, [tools, query]);

	const visible = expanded ? filtered : filtered.slice(0, INITIAL_VISIBLE);
	const hidden = filtered.length - visible.length;

	const toggle = (name: string) => {
		// An empty allowlist means "all", so the first explicit removal has to
		// materialise the full list before subtracting from it.
		const base =
			value.length === 0 ? tools.map((tool) => tool.exposedName) : value;
		onChange(
			base.includes(name)
				? base.filter((candidate) => candidate !== name)
				: [...base, name],
		);
	};

	if (tools.length === 0) {
		return null;
	}

	return (
		<div className={cn("space-y-2", className)}>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="relative min-w-0 flex-1">
					<Search
						size={12}
						className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder={t("tools.searchPlaceholder")}
						className="h-8 rounded-lg pl-7 text-xs"
					/>
				</div>
				<div className="flex items-center gap-1.5">
					{recommendedNames.length > 0 ? (
						<button
							type="button"
							onClick={() => onChange(recommendedNames)}
							className={cn(
								"rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
								recommendedSelected
									? "border-blue-500/30 bg-blue-500/10 text-blue-500"
									: "border-border bg-muted/50 text-muted-foreground hover:text-foreground",
							)}
						>
							{t("tools.presetRecommended")} · {recommendedNames.length}
						</button>
					) : null}
					<button
						type="button"
						onClick={() => onChange(readOnlyNames)}
						disabled={readOnlyNames.length === 0}
						className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
					>
						{t("tools.presetReadOnly")} · {readOnlyNames.length}
					</button>
					<button
						type="button"
						onClick={() => onChange([])}
						className={cn(
							"rounded-full border px-2 py-0.5 text-[10px] font-semibold transition-colors",
							allSelected
								? "border-blue-500/30 bg-blue-500/10 text-blue-500"
								: "border-border bg-muted/50 text-muted-foreground hover:text-foreground",
						)}
					>
						{t("tools.presetAll")} · {tools.length}
					</button>
				</div>
			</div>

			<div className="overflow-hidden rounded-xl border border-border/60">
				{visible.map((tool, index) => {
					const isOn = value.length === 0 || selected.has(tool.exposedName);
					return (
						<button
							key={tool.exposedName}
							type="button"
							onClick={() => toggle(tool.exposedName)}
							className={cn(
								"flex w-full items-center gap-2.5 px-2.5 py-1.5 text-left transition-colors hover:bg-muted/60",
								index % 2 === 1 && "bg-muted/25",
							)}
						>
							<span
								className={cn(
									"flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
									isOn
										? "border-blue-500 bg-blue-500 text-white"
										: "border-border",
								)}
							>
								{isOn ? <Check size={9} strokeWidth={3.5} /> : null}
							</span>
							<span
								className={cn(
									"min-w-0 flex-1 truncate font-mono text-[10.5px]",
									isOn ? "text-foreground" : "text-muted-foreground",
								)}
							>
								{tool.exposedName}
							</span>
							{tool.description ? (
								<span className="hidden min-w-0 max-w-[45%] truncate text-[10.5px] text-muted-foreground sm:block">
									{tool.description}
								</span>
							) : null}
							{tool.destructive ? (
								<Badge
									variant="outline"
									className="shrink-0 border-destructive/30 bg-destructive/10 text-[9px] text-destructive"
								>
									{t("tools.badgeDestructive")}
								</Badge>
							) : tool.readOnly ? (
								<Badge variant="outline" className="shrink-0 text-[9px]">
									{t("tools.badgeRead")}
								</Badge>
							) : (
								<Badge variant="outline" className="shrink-0 text-[9px]">
									{t("tools.badgeWrites")}
								</Badge>
							)}
						</button>
					);
				})}
			</div>

			{hidden > 0 ? (
				<button
					type="button"
					onClick={() => setExpanded(true)}
					className="text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
				>
					{t("detail.showMore", { count: hidden })}
				</button>
			) : null}
		</div>
	);
};
