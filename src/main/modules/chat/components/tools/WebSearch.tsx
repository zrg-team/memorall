import React, { useState } from "react";
import {
	Search,
	ExternalLink,
	Globe,
	AlertCircle,
	ChevronDown,
	ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionRenderer } from "@/main/modules/chat/components/types";
import type { MessageActionItem } from "@/main/modules/chat/components/types";
import { defaultActionRenderer } from "./DefaultActionRenderer";
import {
	getStructuredToolPayload,
	openToolUrl,
	ToolItemRawIO,
} from "./ToolCommon";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SearchResultItem {
	title: string;
	url: string;
	snippet: string;
}

interface EngineResult {
	engine: string;
	searchUrl: string;
	results: SearchResultItem[];
}

interface WebSearchPayload {
	query?: string;
	engines?: string;
	results?: EngineResult[];
	errors?: { engine: string; error: string; classification?: string }[];
	success?: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getDomain = (url: string): string => {
	try {
		return new URL(url).hostname.replace(/^www\./, "");
	} catch {
		return "";
	}
};

const getFaviconUrl = (url: string): string => {
	const domain = getDomain(url);
	if (!domain) return "";
	return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
};

const extractPayload = (item: MessageActionItem): WebSearchPayload | null => {
	const raw = getStructuredToolPayload(item);
	if (!raw || raw.actionType !== "web_search") return null;

	const results = Array.isArray(raw.results)
		? (raw.results as unknown[])
				.map((r): EngineResult | null => {
					if (typeof r !== "object" || r === null) return null;
					const rec = r as Record<string, unknown>;
					return {
						engine: typeof rec.engine === "string" ? rec.engine : "unknown",
						searchUrl: typeof rec.searchUrl === "string" ? rec.searchUrl : "",
						results: Array.isArray(rec.results)
							? (rec.results as unknown[])
									.map((item): SearchResultItem | null => {
										if (typeof item !== "object" || item === null) return null;
										const it = item as Record<string, unknown>;
										return {
											title: typeof it.title === "string" ? it.title : "",
											url: typeof it.url === "string" ? it.url : "",
											snippet: typeof it.snippet === "string" ? it.snippet : "",
										};
									})
									.filter((x): x is SearchResultItem => x !== null)
							: [],
					};
				})
				.filter((x): x is EngineResult => x !== null)
		: [];

	// `classification` is produced by the search tool (it already distinguishes a
	// "challenge" from a parse failure) and used to be dropped here, which is why
	// a search blocked by a bot wall looked identical to one that found nothing.
	type SearchError = { engine: string; error: string; classification?: string };
	const errors = Array.isArray(raw.errors)
		? (raw.errors as unknown[])
				.map((e): SearchError | null => {
					if (typeof e !== "object" || e === null) return null;
					const rec = e as Record<string, unknown>;
					return {
						engine: typeof rec.engine === "string" ? rec.engine : "?",
						error: typeof rec.error === "string" ? rec.error : String(e),
						classification:
							typeof rec.classification === "string"
								? rec.classification
								: undefined,
					};
				})
				.filter((x): x is SearchError => x !== null)
		: [];

	return {
		query: typeof raw.query === "string" ? raw.query : undefined,
		engines: typeof raw.engines === "string" ? raw.engines : undefined,
		success: typeof raw.success === "boolean" ? raw.success : undefined,
		results,
		errors,
	};
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const RESULTS_COLLAPSED_COUNT = 5;

const Favicon: React.FC<{ url: string }> = ({ url }) => {
	const [failed, setFailed] = useState(false);
	const faviconUrl = getFaviconUrl(url);

	if (!faviconUrl || failed) {
		return <Globe className="w-3.5 h-3.5 shrink-0 text-muted-foreground/60" />;
	}

	return (
		<img
			src={faviconUrl}
			alt=""
			width={14}
			height={14}
			className="w-3.5 h-3.5 shrink-0 rounded-[2px] object-contain"
			onError={() => setFailed(true)}
		/>
	);
};

const ResultCard: React.FC<{ result: SearchResultItem }> = ({ result }) => {
	const domain = getDomain(result.url);

	return (
		<div className="group flex gap-2.5 rounded-md border border-border/40 bg-background px-3 py-2.5 hover:border-border/70 hover:bg-muted/10 transition-colors cursor-default">
			<div className="mt-[3px] shrink-0">
				<Favicon url={result.url} />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-start justify-between gap-2">
					<p className="text-xs font-medium text-foreground leading-snug line-clamp-2 flex-1">
						{result.title || result.url}
					</p>
					<button
						type="button"
						className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground mt-0.5"
						onClick={() => openToolUrl(result.url)}
						title="Open in new tab"
					>
						<ExternalLink className="w-3 h-3" />
					</button>
				</div>
				{domain && (
					<p className="mt-0.5 text-[10px] text-muted-foreground/70 font-mono truncate">
						{domain}
					</p>
				)}
				{result.snippet && (
					<p className="mt-1 text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
						{result.snippet}
					</p>
				)}
			</div>
		</div>
	);
};

const EngineSection: React.FC<{ engineResult: EngineResult }> = ({
	engineResult,
}) => {
	const [expanded, setExpanded] = useState(false);
	const { engine, results, searchUrl } = engineResult;
	const total = results.length;
	const visible = expanded
		? results
		: results.slice(0, RESULTS_COLLAPSED_COUNT);
	const hasMore = total > RESULTS_COLLAPSED_COUNT;

	return (
		<div className="space-y-1.5">
			<div className="flex items-center justify-between gap-2 px-0.5">
				<div className="flex items-center gap-1.5">
					<span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
						{engine}
					</span>
					<span className="rounded-full bg-muted/60 px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
						{total}
					</span>
				</div>
				{searchUrl && (
					<button
						type="button"
						className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
						onClick={() => openToolUrl(searchUrl)}
						title={`Open ${engine} search`}
					>
						<ExternalLink className="w-3 h-3" />
					</button>
				)}
			</div>

			{total === 0 ? (
				<p className="text-[11px] text-muted-foreground/60 px-1">
					No results extracted.
				</p>
			) : (
				<>
					<div className="space-y-1.5">
						{visible.map((result, i) => (
							<ResultCard
								key={`${engine}-${result.url || result.title || "result"}-${i}`}
								result={result}
							/>
						))}
					</div>
					{hasMore && (
						<button
							type="button"
							className="flex w-full items-center justify-center gap-1 rounded-md border border-dashed border-border/40 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-border/70 transition-colors"
							onClick={() => setExpanded((p) => !p)}
						>
							<ChevronDown
								className={cn(
									"w-3 h-3 transition-transform duration-150",
									expanded && "rotate-180",
								)}
							/>
							{expanded
								? "Show less"
								: `Show ${total - RESULTS_COLLAPSED_COUNT} more`}
						</button>
					)}
				</>
			)}
		</div>
	);
};

// ─── Main renderer ────────────────────────────────────────────────────────────

export const webSearchRenderer: ActionRenderer = (
	item: MessageActionItem,
	isOpen: boolean,
) => {
	if (!isOpen) return null;

	const payload = extractPayload(item);
	if (!payload) {
		return defaultActionRenderer(item, isOpen);
	}

	const { query, results = [], errors = [] } = payload;
	const totalResults = results.reduce((acc, e) => acc + e.results.length, 0);
	const multiEngine = results.length > 1;

	return (
		<div className="space-y-3">
			{/* Query header */}
			<div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5">
				<Search className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
				<p className="flex-1 text-sm font-medium text-foreground truncate">
					{query || "Web search"}
				</p>
				<span className="shrink-0 text-[10px] text-muted-foreground/60 font-mono">
					{totalResults} result{totalResults !== 1 ? "s" : ""}
				</span>
			</div>

			{/* Engine results */}
			{results.length > 0 && (
				<div className={cn("space-y-4", !multiEngine && "space-y-1.5")}>
					{results.map((engineResult, index) => (
						<EngineSection
							key={`${engineResult.engine}-${engineResult.searchUrl || index}`}
							engineResult={engineResult}
						/>
					))}
				</div>
			)}

			{/* Errors */}
			{errors.length > 0 && (
				<div className="space-y-1.5">
					{errors.map((err, index) => (
						<div
							key={`${err.engine}-${err.error}-${index}`}
							className={cn(
								"flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
								err.classification === "challenge"
									? "border-amber-500/30 bg-amber-500/5 text-amber-700"
									: "border-red-600/20 bg-red-600/5 text-red-700",
							)}
						>
							{err.classification === "challenge" ? (
								<ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
							) : (
								<AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
							)}
							<span>
								<span className="font-semibold">{err.engine}:</span> {err.error}
								{err.classification === "challenge" ? (
									// The engine served a bot wall rather than results. There is
									// no session behind a search failure to hand over, so say so
									// plainly instead of offering a button with nothing to act on.
									<span className="block opacity-80">
										Open the page yourself, or try a different engine.
									</span>
								) : null}
							</span>
						</div>
					))}
				</div>
			)}

			<ToolItemRawIO item={item} output={payload} />
		</div>
	);
};
