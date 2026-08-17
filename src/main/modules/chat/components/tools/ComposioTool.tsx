import React from "react";
import { AlertTriangle, CheckCircle2, Link2, Search } from "lucide-react";

import { Badge } from "@/main/components/ui/badge";
import { cn } from "@/lib/utils";
import { AppIcon } from "@/main/modules/connections/components/AppIcon";
import type { ActionRenderer, MessageActionItem } from "../types";
import {
	getStructuredToolPayload,
	getToolCallArguments,
	isRecord,
	openToolUrl,
	stringifyToolPayload,
	ToolCodeBlock,
	ToolDetail,
	ToolDetailsGrid,
	ToolItemRawIO,
	ToolSection,
} from "./ToolCommon";
import {
	actionLabel,
	humanizeSlug,
	looksLikeToolSlug,
	routerToolLabel,
	stripServerPrefix,
	toolkitFromSlug,
	toolkitLabel,
	toolkitLogoSlug,
} from "./composio-toolkits";

/* ─── payload helpers ──────────────────────────────────────────────────────── */

const asArray = (value: unknown): unknown[] =>
	Array.isArray(value) ? value : [];

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.trim() ? value : undefined;

/**
 * Composio returns tool output as a JSON string in the description. It is
 * sometimes double-encoded (a JSON string containing JSON), and sometimes
 * wrapped in the MCP `{content:[{type:"text",text}]}` envelope.
 */
const parseComposioOutput = (item: MessageActionItem): unknown => {
	const structured = getStructuredToolPayload(item);
	if (structured && !("actionType" in structured)) {
		return structured;
	}

	const raw = item.description?.trim();
	if (!raw) return structured ?? null;

	let parsed: unknown = raw;
	for (let depth = 0; depth < 3 && typeof parsed === "string"; depth++) {
		const text = parsed.trim();
		if (!/^[[{"]/.test(text)) break;
		try {
			parsed = JSON.parse(text);
		} catch {
			break;
		}
	}

	// Unwrap the MCP text-content envelope if that is what came back.
	if (isRecord(parsed) && Array.isArray(parsed.content)) {
		const text = parsed.content
			.map((entry) =>
				isRecord(entry) && typeof entry.text === "string" ? entry.text : "",
			)
			.join("")
			.trim();
		if (text) {
			try {
				return JSON.parse(text);
			} catch {
				return text;
			}
		}
	}

	return parsed;
};

/** Composio wraps most results as `{successful, data, error}`. */
const unwrapResult = (
	value: unknown,
): { ok?: boolean; data: unknown; error?: string } => {
	if (!isRecord(value)) {
		return { data: value };
	}

	const ok =
		typeof value.successful === "boolean"
			? value.successful
			: typeof value.success === "boolean"
				? value.success
				: undefined;
	const error = asString(value.error) ?? asString(value.message);
	const hasEnvelope = "data" in value || ok !== undefined;

	return hasEnvelope
		? { ok, data: "data" in value ? value.data : value, error }
		: { data: value, error };
};

const TITLE_KEYS = [
	"summary",
	"name",
	"title",
	"subject",
	"displayName",
	"display_name",
	"full_name",
	"filename",
	"path",
	"email",
	"slug",
	"id",
];

const SUBTITLE_KEYS = [
	"description",
	"snippet",
	"body",
	"status",
	"state",
	"url",
	"html_link",
	"htmlLink",
	"web_url",
	"timeZone",
	"time_zone",
	"start",
	"created_at",
	"updated_at",
	"mimeType",
	"mime_type",
];

const pickField = (
	record: Record<string, unknown>,
	keys: string[],
): string | undefined => {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
		if (typeof value === "number" || typeof value === "boolean") {
			return String(value);
		}
		if (isRecord(value)) {
			const nested =
				asString(value.dateTime) ??
				asString(value.date) ??
				asString(value.name);
			if (nested) return nested;
		}
	}
	return undefined;
};

/** The first array in a result that plausibly holds the records. */
const findRecordList = (data: unknown): unknown[] | null => {
	if (Array.isArray(data)) return data;
	if (!isRecord(data)) return null;

	const preferred = [
		"items",
		"results",
		"records",
		"data",
		"events",
		"messages",
		"files",
		"issues",
		"rows",
		"entries",
		"calendars",
		"channels",
	];
	for (const key of preferred) {
		if (Array.isArray(data[key])) return data[key];
	}
	for (const value of Object.values(data)) {
		if (Array.isArray(value) && value.length > 0 && isRecord(value[0])) {
			return value;
		}
	}
	return null;
};

/* ─── shared presentation ──────────────────────────────────────────────────── */

/** App identity: the mark, the vendor's name, and the raw slug for the curious. */
const ToolkitHeader: React.FC<{
	toolkit: string | null;
	action?: string;
	slug?: string;
	trailing?: React.ReactNode;
}> = ({ toolkit, action, slug, trailing }) => (
	<div className="flex min-w-0 items-center gap-2.5">
		{toolkit ? (
			<AppIcon
				name={toolkitLabel(toolkit)}
				composioSlug={toolkitLogoSlug(toolkit)}
				size={28}
			/>
		) : (
			<span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
				<Link2 className="h-3.5 w-3.5" />
			</span>
		)}
		<div className="min-w-0 flex-1">
			<div className="truncate text-sm font-semibold text-foreground">
				{toolkit ? toolkitLabel(toolkit) : "Composio"}
				{action ? (
					<span className="font-normal text-muted-foreground"> · {action}</span>
				) : null}
			</div>
			{slug ? (
				<div className="truncate font-mono text-[10px] text-muted-foreground/80">
					{slug}
				</div>
			) : null}
		</div>
		{trailing}
	</div>
);

const OutcomeBadge: React.FC<{ ok?: boolean }> = ({ ok }) => {
	if (ok === undefined) return null;
	return (
		<Badge
			variant="outline"
			className={cn(
				"shrink-0 gap-1 text-[10px]",
				ok
					? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-500"
					: "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-500",
			)}
		>
			{ok ? (
				<CheckCircle2 className="h-3 w-3" />
			) : (
				<AlertTriangle className="h-3 w-3" />
			)}
			{ok ? "Success" : "Failed"}
		</Badge>
	);
};

/** Arguments as a readable table rather than a JSON blob. */
const ArgumentList: React.FC<{ args: Record<string, unknown> }> = ({
	args,
}) => {
	const entries = Object.entries(args).filter(
		([, value]) => value !== undefined && value !== null && value !== "",
	);
	if (entries.length === 0) return null;

	return (
		<div className="mt-2 space-y-1">
			{entries.map(([key, value]) => {
				const complex = isRecord(value) || Array.isArray(value);
				return (
					<div
						key={key}
						className="grid grid-cols-[minmax(5rem,9rem)_minmax(0,1fr)] gap-2 rounded-md bg-muted/25 px-2 py-1 text-xs"
					>
						<span className="truncate font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80">
							{key}
						</span>
						{complex ? (
							<span className="min-w-0 break-words font-mono text-[11px] text-foreground/90">
								{stringifyToolPayload(value).slice(0, 400)}
							</span>
						) : (
							<span className="min-w-0 break-words text-foreground">
								{String(value)}
							</span>
						)}
					</div>
				);
			})}
		</div>
	);
};

/**
 * A result, summarised.
 *
 * Composio hands back whatever the underlying vendor API returned, so there is
 * no schema to lean on. Lists get one line per record with a title picked from
 * whichever conventional field is present; scalars get a small grid; everything
 * keeps its full JSON one click away.
 */
const ResultBody: React.FC<{ data: unknown; emptyLabel?: string }> = ({
	data,
	emptyLabel = "No data returned.",
}) => {
	const [expanded, setExpanded] = React.useState(false);

	if (data === null || data === undefined || data === "") {
		return <div className="text-xs text-muted-foreground">{emptyLabel}</div>;
	}

	if (typeof data === "string") {
		return (
			<div className="whitespace-pre-wrap break-words text-xs text-foreground/90">
				{data}
			</div>
		);
	}

	const list = findRecordList(data);
	if (list && list.length > 0) {
		const shown = expanded ? list : list.slice(0, 5);
		return (
			<div className="space-y-1.5">
				<div className="text-[11px] font-medium text-muted-foreground">
					{list.length} {list.length === 1 ? "item" : "items"}
				</div>
				{shown.map((entry, index) => {
					const record = isRecord(entry) ? entry : null;
					const title = record
						? (pickField(record, TITLE_KEYS) ?? `Item ${index + 1}`)
						: String(entry);
					const subtitle = record
						? pickField(record, SUBTITLE_KEYS)
						: undefined;
					const href = record
						? (asString(record.url) ??
							asString(record.htmlLink) ??
							asString(record.html_link))
						: undefined;

					return (
						<div
							key={index}
							className="min-w-0 rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5"
						>
							<div className="flex min-w-0 items-baseline gap-2">
								<span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
									{title}
								</span>
								{href ? (
									<button
										type="button"
										onClick={() => openToolUrl(href)}
										className="shrink-0 text-[10px] text-primary hover:underline"
									>
										Open
									</button>
								) : null}
							</div>
							{subtitle ? (
								<div className="mt-0.5 line-clamp-2 break-words text-[11px] text-muted-foreground">
									{subtitle}
								</div>
							) : null}
						</div>
					);
				})}
				{list.length > shown.length ? (
					<button
						type="button"
						onClick={() => setExpanded(true)}
						className="text-[11px] text-primary hover:underline"
					>
						Show {list.length - shown.length} more
					</button>
				) : null}
			</div>
		);
	}

	if (isRecord(data)) {
		const scalars = Object.entries(data).filter(
			([, value]) => !isRecord(value) && !Array.isArray(value),
		);
		if (scalars.length > 0 && scalars.length <= 12) {
			return (
				<ToolDetailsGrid>
					{scalars.map(([key, value]) => (
						<ToolDetail
							key={key}
							label={key}
							value={value === null ? "—" : String(value)}
						/>
					))}
				</ToolDetailsGrid>
			);
		}
	}

	return (
		<ToolCodeBlock className="max-h-56">
			{stringifyToolPayload(data)}
		</ToolCodeBlock>
	);
};

/* ─── per-tool bodies ──────────────────────────────────────────────────────── */

interface DiscoveredTool {
	slug: string;
	toolkit: string | null;
	description?: string;
}

/**
 * Where COMPOSIO_SEARCH_TOOLS actually keeps the tools.
 *
 * The response is an envelope — `{results, tool_schemas, session,
 * toolkit_connection_statuses, time_info, next_steps_guidance}` — so walking
 * its top level reads those field names as tools. Only these containers hold
 * real entries.
 */
const TOOL_CONTAINER_KEYS = [
	"results",
	"tools",
	"tool_schemas",
	"schemas",
	"actions",
	"items",
];

const collectDiscoveredTools = (data: unknown): DiscoveredTool[] => {
	const out: DiscoveredTool[] = [];
	const seen = new Set<string>();

	const push = (slug: string, record: Record<string, unknown> | null) => {
		const declaredToolkit = record ? asString(record.toolkit) : undefined;
		// A declared toolkit makes an entry trustworthy even if its slug is
		// unusual; otherwise the slug itself has to look like one. Without this
		// gate, envelope keys such as `results` become apps called "Results".
		if (!declaredToolkit && !looksLikeToolSlug(slug)) {
			return;
		}
		if (seen.has(slug)) {
			return;
		}
		seen.add(slug);
		out.push({
			slug,
			toolkit: declaredToolkit?.toUpperCase() ?? toolkitFromSlug(slug),
			description: record ? asString(record.description) : undefined,
		});
	};

	const harvest = (container: unknown) => {
		for (const entry of asArray(container)) {
			if (isRecord(entry)) {
				const slug = asString(entry.tool_slug) ?? asString(entry.slug);
				if (slug) push(slug, entry);
			} else if (typeof entry === "string") {
				push(entry, null);
			}
		}

		if (isRecord(container) && !Array.isArray(container)) {
			for (const [key, value] of Object.entries(container)) {
				if (isRecord(value)) {
					push(asString(value.tool_slug) ?? key, value);
				}
			}
		}
	};

	const scan = (root: unknown) => {
		harvest(root);
		if (!isRecord(root)) return;
		for (const key of TOOL_CONTAINER_KEYS) {
			if (key in root) harvest(root[key]);
		}
	};

	scan(data);
	// Some responses nest the whole envelope one level down.
	if (isRecord(data) && isRecord(data.data)) {
		scan(data.data);
	}

	return out;
};

/** Apps the session can reach, straight from the search envelope. */
interface ConnectionStatus {
	toolkit: string;
	connected?: boolean;
	label?: string;
}

const collectConnectionStatuses = (data: unknown): ConnectionStatus[] => {
	const source = isRecord(data)
		? (data.toolkit_connection_statuses ??
			(isRecord(data.data) ? data.data.toolkit_connection_statuses : undefined))
		: undefined;
	if (!isRecord(source)) {
		return [];
	}

	return Object.entries(source).map(([toolkit, value]) => {
		const status = isRecord(value)
			? (asString(value.status) ?? asString(value.state))
			: asString(value);
		const connected =
			isRecord(value) && typeof value.connected === "boolean"
				? value.connected
				: undefined;
		const normalised = status?.toLowerCase();

		return {
			toolkit: toolkit.toUpperCase(),
			connected:
				connected ??
				(normalised
					? ["active", "connected", "initiated"].includes(normalised)
					: undefined),
			label: status,
		};
	});
};

const getGuidance = (data: unknown): string | undefined => {
	if (!isRecord(data)) return undefined;
	return (
		asString(data.next_steps_guidance) ??
		(isRecord(data.data) ? asString(data.data.next_steps_guidance) : undefined)
	);
};

/** COMPOSIO_SEARCH_TOOLS / COMPOSIO_RETRIEVE_ACTIONS — what the agent looked for, what it found. */
const SearchToolsBody: React.FC<{
	args: Record<string, unknown> | null;
	data: unknown;
}> = ({ args, data }) => {
	const queries = asArray(args?.queries)
		.map((entry) =>
			isRecord(entry)
				? (asString(entry.use_case) ?? asString(entry.query))
				: asString(entry),
		)
		.filter((value): value is string => Boolean(value));

	const tools = collectDiscoveredTools(data);
	const connections = collectConnectionStatuses(data);
	const guidance = getGuidance(data);
	const byToolkit = new Map<string, DiscoveredTool[]>();
	for (const tool of tools) {
		const key = tool.toolkit ?? "OTHER";
		byToolkit.set(key, [...(byToolkit.get(key) ?? []), tool]);
	}

	return (
		<div className="space-y-3">
			{connections.length > 0 ? (
				<ToolSection title="Apps">
					<div className="flex flex-wrap gap-1.5">
						{connections.map((connection) => (
							<span
								key={connection.toolkit}
								className={cn(
									"inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px]",
									connection.connected === false
										? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
										: "border-border/60 bg-muted/25 text-foreground",
								)}
							>
								<AppIcon
									name={toolkitLabel(connection.toolkit)}
									composioSlug={toolkitLogoSlug(connection.toolkit)}
									size={16}
								/>
								{toolkitLabel(connection.toolkit)}
								{connection.connected === false ? (
									<span className="text-[10px] opacity-80">
										{connection.label ?? "not connected"}
									</span>
								) : null}
							</span>
						))}
					</div>
				</ToolSection>
			) : null}

			{queries.length > 0 ? (
				<ToolSection title="Looking for">
					<div className="space-y-1">
						{queries.map((query) => (
							<div
								key={query}
								className="flex min-w-0 items-start gap-2 text-xs text-foreground"
							>
								<Search className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
								<span className="min-w-0 break-words">{query}</span>
							</div>
						))}
					</div>
				</ToolSection>
			) : null}

			{tools.length > 0 ? (
				<ToolSection
					title={`Found ${tools.length} ${tools.length === 1 ? "tool" : "tools"}`}
				>
					<div className="space-y-3">
						{[...byToolkit.entries()].map(([toolkit, group]) => (
							<div key={toolkit} className="space-y-1.5">
								<ToolkitHeader
									toolkit={toolkit === "OTHER" ? null : toolkit}
									trailing={
										<Badge variant="outline" className="shrink-0 text-[10px]">
											{group.length}
										</Badge>
									}
								/>
								<div className="space-y-1 pl-[2.375rem]">
									{group.map((tool) => (
										<div
											key={tool.slug}
											className="min-w-0 rounded-md border border-border/50 bg-background/60 px-2.5 py-1.5"
										>
											<div className="truncate text-xs font-medium text-foreground">
												{actionLabel(tool.slug)}
											</div>
											<div className="truncate font-mono text-[10px] text-muted-foreground/80">
												{tool.slug}
											</div>
											{tool.description ? (
												<div className="mt-0.5 line-clamp-2 break-words text-[11px] text-muted-foreground">
													{tool.description}
												</div>
											) : null}
										</div>
									))}
								</div>
							</div>
						))}
					</div>
				</ToolSection>
			) : null}

			{tools.length === 0 ? (
				<ToolSection title="Response">
					<ResultBody data={data} emptyLabel="No tools matched." />
				</ToolSection>
			) : null}

			{guidance ? (
				<div className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
					{guidance}
				</div>
			) : null}
		</div>
	);
};

interface ExecutedCall {
	slug: string;
	args: Record<string, unknown>;
}

const collectExecutedCalls = (
	args: Record<string, unknown> | null,
): ExecutedCall[] => {
	if (!args) return [];

	const fromList = asArray(args.tools)
		.map((entry) => {
			if (!isRecord(entry)) return null;
			const slug = asString(entry.tool_slug) ?? asString(entry.slug);
			if (!slug) return null;
			return {
				slug,
				args: isRecord(entry.arguments) ? entry.arguments : {},
			};
		})
		.filter((call): call is ExecutedCall => call !== null);

	if (fromList.length > 0) return fromList;

	// COMPOSIO_EXECUTE_TOOL takes a single tool rather than a list.
	const single = asString(args.tool_slug) ?? asString(args.slug);
	if (single) {
		return [
			{ slug: single, args: isRecord(args.arguments) ? args.arguments : {} },
		];
	}
	return [];
};

/** Aligns each executed call with its result, however the response is shaped. */
const resultForCall = (
	data: unknown,
	call: ExecutedCall,
	index: number,
	total: number,
): unknown => {
	if (isRecord(data)) {
		if (call.slug in data) return data[call.slug];
		const results = data.results ?? data.tool_results ?? data.responses;
		if (Array.isArray(results)) return results[index];
	}
	if (Array.isArray(data) && data.length === total) {
		return data[index];
	}
	return total === 1 ? data : undefined;
};

/** COMPOSIO_MULTI_EXECUTE_TOOL / COMPOSIO_EXECUTE_TOOL — one card per app call. */
const ExecuteBody: React.FC<{
	args: Record<string, unknown> | null;
	data: unknown;
	envelopeOk?: boolean;
	envelopeError?: string;
}> = ({ args, data, envelopeOk, envelopeError }) => {
	const calls = collectExecutedCalls(args);
	const step = args ? asString(args.current_step) : undefined;
	const metric = args ? asString(args.current_step_metric) : undefined;

	if (calls.length === 0) {
		return (
			<div className="space-y-3">
				{step ? <StepBanner step={step} metric={metric} /> : null}
				<ToolSection title="Result">
					<ResultBody data={data} />
				</ToolSection>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{step ? <StepBanner step={step} metric={metric} /> : null}
			{calls.map((call, index) => {
				const raw = resultForCall(data, call, index, calls.length);
				const {
					ok = envelopeOk,
					data: callData,
					error = envelopeError,
				} = unwrapResult(raw);

				return (
					<ToolSection key={`${call.slug}-${index}`}>
						<div className="space-y-2">
							<ToolkitHeader
								toolkit={toolkitFromSlug(call.slug)}
								action={actionLabel(call.slug)}
								slug={call.slug}
								trailing={<OutcomeBadge ok={ok} />}
							/>
							{Object.keys(call.args).length > 0 ? (
								<div>
									<div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
										Arguments
									</div>
									<ArgumentList args={call.args} />
								</div>
							) : null}
							{error ? (
								<div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-300">
									<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
									<span className="min-w-0 break-words">{error}</span>
								</div>
							) : null}
							{raw !== undefined ? (
								<div>
									<div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
										Result
									</div>
									<ResultBody data={callData} />
								</div>
							) : null}
						</div>
					</ToolSection>
				);
			})}
		</div>
	);
};

/** The agent's own progress label, when it sent one. */
const StepBanner: React.FC<{ step: string; metric?: string }> = ({
	step,
	metric,
}) => (
	<div className="flex min-w-0 flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-2.5 py-1.5">
		<Badge
			variant="outline"
			className="shrink-0 border-primary/30 bg-primary/10 text-[10px] text-primary"
		>
			Step
		</Badge>
		<span className="min-w-0 break-words text-xs font-medium text-foreground">
			{humanizeSlug(step)}
		</span>
		{metric ? (
			<span className="shrink-0 text-[11px] text-muted-foreground">
				{metric}
			</span>
		) : null}
	</div>
);

/** COMPOSIO_GET_TOOL_SCHEMAS — which schemas were pulled, and their inputs. */
const SchemasBody: React.FC<{
	args: Record<string, unknown> | null;
	data: unknown;
}> = ({ args, data }) => {
	const requested = asArray(args?.tool_slugs)
		.map((entry) => asString(entry))
		.filter((value): value is string => Boolean(value));
	const described = collectDiscoveredTools(data);
	const slugs =
		described.length > 0
			? described
			: requested.map((slug) => ({
					slug,
					toolkit: toolkitFromSlug(slug),
					description: undefined,
				}));

	return (
		<div className="space-y-3">
			<ToolSection
				title={`${slugs.length} ${slugs.length === 1 ? "schema" : "schemas"}`}
			>
				<div className="space-y-2">
					{slugs.map((tool) => (
						<div key={tool.slug} className="space-y-1">
							<ToolkitHeader
								toolkit={tool.toolkit}
								action={actionLabel(tool.slug)}
								slug={tool.slug}
							/>
							{tool.description ? (
								<div className="pl-[2.375rem] text-[11px] text-muted-foreground">
									{tool.description}
								</div>
							) : null}
						</div>
					))}
				</div>
			</ToolSection>
		</div>
	);
};

/** Connection lifecycle tools — which app, and whether it is usable. */
const ConnectionBody: React.FC<{
	args: Record<string, unknown> | null;
	data: unknown;
	ok?: boolean;
}> = ({ args, data, ok }) => {
	const toolkitArg =
		(args ? (asString(args.toolkit) ?? asString(args.app)) : undefined) ??
		(isRecord(data) ? asString(data.toolkit) : undefined);
	const record = isRecord(data) ? data : null;
	const status =
		(record
			? (asString(record.status) ?? asString(record.state))
			: undefined) ??
		(ok === undefined ? undefined : ok ? "active" : "inactive");
	const redirect = record
		? (asString(record.redirect_url) ??
			asString(record.redirectUrl) ??
			asString(record.auth_url))
		: undefined;

	return (
		<div className="space-y-3">
			<ToolSection>
				<div className="space-y-2">
					<ToolkitHeader
						toolkit={toolkitArg ? toolkitArg.toUpperCase() : null}
						trailing={
							status ? (
								<Badge variant="outline" className="shrink-0 text-[10px]">
									{status}
								</Badge>
							) : (
								<OutcomeBadge ok={ok} />
							)
						}
					/>
					{redirect ? (
						<button
							type="button"
							onClick={() => openToolUrl(redirect)}
							className="text-xs text-primary hover:underline"
						>
							Open authorisation link
						</button>
					) : null}
					<ResultBody
						data={data}
						emptyLabel="No connection details returned."
					/>
				</div>
			</ToolSection>
		</div>
	);
};

/* ─── entry point ──────────────────────────────────────────────────────────── */

export const composioToolRenderer: ActionRenderer = (item, isOpen) => {
	if (!isOpen) return null;

	const bare = stripServerPrefix(item.name).toUpperCase();
	const args = getToolCallArguments(item);
	const parsed = parseComposioOutput(item);
	const { ok, data, error } = unwrapResult(parsed);

	const router = routerToolLabel(bare);
	const executedSlugs = collectExecutedCalls(args).map((call) => call.slug);

	let body: React.ReactNode;
	switch (bare) {
		case "COMPOSIO_SEARCH_TOOLS":
		case "COMPOSIO_RETRIEVE_ACTIONS":
			body = <SearchToolsBody args={args} data={data} />;
			break;
		case "COMPOSIO_MULTI_EXECUTE_TOOL":
		case "COMPOSIO_EXECUTE_TOOL":
			body = (
				<ExecuteBody
					args={args}
					data={data}
					envelopeOk={ok}
					envelopeError={error}
				/>
			);
			break;
		case "COMPOSIO_GET_TOOL_SCHEMAS":
			body = <SchemasBody args={args} data={data} />;
			break;
		case "COMPOSIO_CHECK_ACTIVE_CONNECTION":
		case "COMPOSIO_INITIATE_CONNECTION":
		case "COMPOSIO_MANAGE_CONNECTIONS":
		case "COMPOSIO_WAIT_FOR_CONNECTION":
			body = <ConnectionBody args={args} data={data} ok={ok} />;
			break;
		default: {
			// Every other Composio tool — including a toolkit tool called
			// directly — gets the same app header, argument table and result
			// summary, so nothing falls back to a raw JSON dump.
			const toolkit = toolkitFromSlug(bare);
			body = (
				<ToolSection>
					<div className="space-y-2">
						<ToolkitHeader
							toolkit={toolkit}
							action={router ?? actionLabel(bare)}
							slug={bare}
							trailing={<OutcomeBadge ok={ok} />}
						/>
						{args && Object.keys(args).length > 0 ? (
							<div>
								<div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
									Arguments
								</div>
								<ArgumentList args={args} />
							</div>
						) : null}
						{error ? (
							<div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-700 dark:text-red-300">
								<AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
								<span className="min-w-0 break-words">{error}</span>
							</div>
						) : null}
						<div>
							<div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
								Result
							</div>
							<ResultBody data={data} />
						</div>
					</div>
				</ToolSection>
			);
		}
	}

	return (
		<div className="space-y-3">
			{body}
			<ToolItemRawIO item={item} input={args ?? undefined} output={parsed} />
		</div>
	);
};

export { collectExecutedCalls as __collectExecutedCalls };
