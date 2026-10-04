import {
	ArrowLeft,
	Braces,
	Check,
	ChevronDown,
	ChevronUp,
	CircleDot,
	ExternalLink,
	ListChecks,
	Pencil,
	Play,
	Plus,
	RefreshCw,
	Save,
	Square,
	SquareCheck,
	Trash2,
	Upload,
} from "lucide-react";
import React from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/main/components/ui/badge";
import { Button } from "@/main/components/ui/button";
import { Switch } from "@/main/components/ui/switch";
import { MarkdownMessageBody } from "@/main/modules/chat/components/message/MarkdownMessageBody";
import { AudioClipPlayer } from "@/main/modules/studio/components/shared/AudioClipPlayer";
import { StoredImage } from "@/main/modules/studio/components/shared/StoredImage";
import { assignRefs } from "@/services/memon/app-kit/render-text";
import type {
	MemonBadge,
	MemonControlValue,
	MemonInputNode,
	MemonViewNode,
} from "@/services/memon/app-kit/types";

type IconComponent = React.ComponentType<{ size?: number; className?: string }>;

const ICONS: Record<string, IconComponent> = {
	add: Plus,
	back: ArrowLeft,
	delete: Trash2,
	edit: Pencil,
	open: ExternalLink,
	play: Play,
	refresh: RefreshCw,
	save: Save,
	upload: Upload,
	json: Braces,
	builder: ListChecks,
	expand: ChevronDown,
	collapse: ChevronUp,
};

/**
 * Every control is one height (32px): fields, selects, buttons and the box
 * a switch sits in, so a row of them lines up.
 */
const FIELD =
	"w-full rounded-md border border-input bg-background px-2.5 text-xs outline-none placeholder:text-muted-foreground/70 focus-visible:ring-1 focus-visible:ring-ring";
const LABEL = "text-[11px] font-medium leading-4 text-muted-foreground";

const TONE: Record<string, string> = {
	muted: "text-muted-foreground",
	error: "text-red-700 dark:text-red-300",
	warning: "text-amber-800 dark:text-amber-200",
	success: "text-emerald-700 dark:text-emerald-300",
};

const BADGE_TONE: Record<string, string> = {
	info: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300",
	success:
		"border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
	warning:
		"border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200",
	muted: "text-muted-foreground",
};

export interface MemonAppViewProps {
	nodes: MemonViewNode[];
	refPrefix: string;
	/** A control used by the user; resolves when the machine has it. */
	onAction: (id: string, value: MemonControlValue) => Promise<unknown>;
	/** A button only the user has, e.g. one that moves their own screen. */
	onUserAction?: (id: string) => void;
	/** Widgets the window draws itself, by slot name. */
	slots?: Record<string, React.ReactNode>;
	/** Icons beyond the kit's own, by name (e.g. a studio's). */
	icons?: Record<string, IconComponent>;
}

/** A field with its label drawn above it. */
const labelledAbove = (node: MemonViewNode): boolean =>
	(node.type === "input" && !node.inline && !node.hideLabel) ||
	(node.type === "select" && !node.inline);

/** A field that keeps what the user types until it is committed. */
const Field: React.FC<{
	node: MemonInputNode;
	refName: string;
	commit: (value: string) => void;
}> = ({ node, refName, commit }) => {
	const [draft, setDraft] = React.useState(node.value);
	const [focused, setFocused] = React.useState(false);
	const [editingInline, setEditingInline] = React.useState(false);
	// Follow the machine (the agent typing) unless the user is in the field.
	React.useEffect(() => {
		if (!focused) setDraft(node.value);
	}, [node.value, focused]);
	const finish = () => {
		setFocused(false);
		setEditingInline(false);
		if (draft !== node.value) commit(draft);
	};
	const listId = node.suggestions?.length ? `memon-kit-${refName}` : undefined;

	if (node.inline && !editingInline) {
		return (
			<button
				type="button"
				data-memon-ref={refName}
				title={node.label}
				onClick={() => setEditingInline(true)}
				className="h-8 min-w-0 flex-1 truncate rounded-md px-1.5 text-left text-xs hover:bg-muted/60"
			>
				{node.value || node.placeholder || node.label}
			</button>
		);
	}
	const shared = {
		"data-memon-ref": refName,
		value: draft,
		placeholder: node.placeholder ?? node.label,
		"aria-label": node.label,
		spellCheck: !node.mono,
		autoFocus: node.inline,
		onFocus: () => setFocused(true),
		onBlur: finish,
	};
	if (node.lines && node.lines > 1) {
		return (
			<textarea
				{...shared}
				rows={node.lines}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
						event.preventDefault();
						event.currentTarget.blur();
					}
				}}
				className={cn(
					FIELD,
					"block resize-y py-1.5 leading-5",
					node.mono && "font-mono text-[11px]",
				)}
			/>
		);
	}
	return (
		<>
			<input
				{...shared}
				list={listId}
				onChange={(event) => setDraft(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						event.currentTarget.blur();
					}
					if (event.key === "Escape" && node.inline) {
						setDraft(node.value);
						setEditingInline(false);
					}
				}}
				className={cn(FIELD, "h-8 min-w-0", node.mono && "font-mono")}
			/>
			{listId ? (
				<datalist id={listId}>
					{node.suggestions?.map((value) => (
						<option key={value} value={value} />
					))}
				</datalist>
			) : null}
		</>
	);
};

const STATUS_ICON = {
	todo: Square,
	doing: CircleDot,
	done: SquareCheck,
} as const;

const badgeOf = (badge: MemonBadge) =>
	typeof badge === "string" ? { text: badge, tone: undefined } : badge;

/**
 * Draws an app's nodes as its window. Every control carries the ref the
 * agent reads on its screen (`data-memon-ref`), so the agent's cursor lands
 * on it and both work the same controls. Actions run in order: a field the
 * user leaves is committed before the button they press.
 *
 * Layout: nodes stack; a row lines its controls up on their bottoms when
 * one has its label above, and centers them otherwise. A list item with
 * controls is drawn as a card, its details under its title.
 */
export const MemonAppView: React.FC<MemonAppViewProps> = ({
	nodes,
	refPrefix,
	onAction,
	onUserAction,
	slots,
	icons,
}) => {
	const refs = React.useMemo(
		() => assignRefs(nodes, refPrefix),
		[nodes, refPrefix],
	);
	const queue = React.useRef<Promise<unknown>>(Promise.resolve());
	const act = (id: string, value?: MemonControlValue) => {
		queue.current = queue.current.then(
			() => onAction(id, value),
			() => onAction(id, value),
		);
	};
	const iconFor = (name?: string) =>
		name ? (icons?.[name] ?? ICONS[name]) : undefined;

	const draw = (
		list: MemonViewNode[],
		keyPrefix: string,
		inRow = false,
	): React.ReactNode =>
		list.map((node, index) => {
			const key = `${keyPrefix}${index}`;
			const ref = refs.get(node);
			switch (node.type) {
				case "heading":
					return (
						<p
							key={key}
							className={cn(
								"text-xs font-semibold",
								inRow ? "min-w-0 flex-1 truncate" : "pt-1",
							)}
						>
							{node.text}
						</p>
					);
				case "text":
					return node.mono ? (
						<pre
							key={key}
							className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 px-2.5 py-2 font-mono text-[11px] leading-relaxed"
						>
							{node.text}
						</pre>
					) : (
						<p
							key={key}
							className={cn(
								"whitespace-pre-wrap text-[11px] leading-4",
								inRow && "min-w-0 flex-1",
								node.tone && TONE[node.tone],
							)}
						>
							{node.text}
						</p>
					);
				case "markdown":
					return (
						<div
							key={key}
							className="rounded-md border border-border/60 px-3 py-2"
						>
							<MarkdownMessageBody
								className="text-sm"
								showCodeBlockSave={false}
							>
								{node.text}
							</MarkdownMessageBody>
						</div>
					);
				case "progress":
					return (
						<div key={key} className="flex items-center gap-2">
							<div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
								<div
									className="h-full rounded-full bg-emerald-500 transition-all"
									style={{
										width: node.max
											? `${(node.value / node.max) * 100}%`
											: "0%",
									}}
								/>
							</div>
							<span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
								{node.value}/{node.max} {node.label}
							</span>
						</div>
					);
				case "spacer":
					return <span key={key} aria-hidden="true" className="flex-1" />;
				case "group":
					return node.layout === "row" ? (
						<div
							key={key}
							className={cn(
								"flex min-w-0 flex-wrap gap-2",
								node.children.some(labelledAbove)
									? "items-end"
									: "items-center",
							)}
						>
							{draw(node.children, `${key}.`, true)}
						</div>
					) : (
						<div key={key} className="flex min-w-0 flex-col gap-2">
							{draw(node.children, `${key}.`)}
						</div>
					);
				case "item": {
					const StatusIcon = node.status ? STATUS_ICON[node.status] : null;
					const card = Boolean(node.children?.length);
					return (
						<div
							key={key}
							data-memon-ask={`${node.title}${node.detail ? ` — ${node.detail}` : ""}`}
							className={cn(
								"flex min-w-0 flex-col gap-2 rounded-lg",
								card
									? "border border-border/70 bg-muted/[0.15] px-3 py-2.5"
									: "px-2 py-1.5 hover:bg-muted/40",
								node.tone === "muted" && "opacity-75",
							)}
						>
							<div className="flex min-w-0 items-start gap-2">
								{StatusIcon ? (
									<StatusIcon
										size={14}
										className={cn(
											"mt-px shrink-0",
											node.status === "done"
												? "text-emerald-600"
												: node.status === "doing"
													? "text-sky-500"
													: "text-muted-foreground",
										)}
									/>
								) : null}
								<div className="min-w-0 flex-1">
									<p
										title={node.title}
										className={cn(
											"line-clamp-2 break-words text-xs font-medium leading-4",
											node.tone === "error" && TONE.error,
										)}
									>
										{node.title}
									</p>
									{node.detail ? (
										<p
											title={node.detail}
											className="mt-0.5 truncate text-[11px] leading-4 text-muted-foreground"
										>
											{node.detail}
										</p>
									) : null}
								</div>
								{node.badges?.length ? (
									<div className="flex shrink-0 flex-wrap justify-end gap-1">
										{node.badges.map((entry) => {
											const badge = badgeOf(entry);
											return (
												<Badge
													key={badge.text}
													variant="outline"
													className={cn(
														"h-5 px-1.5 text-[10px] font-medium leading-none",
														badge.tone && BADGE_TONE[badge.tone],
													)}
												>
													{badge.text}
												</Badge>
											);
										})}
									</div>
								) : null}
							</div>
							{card ? (
								<div
									className={cn(
										"flex min-w-0 flex-col gap-2",
										StatusIcon && "pl-[22px]",
									)}
								>
									{draw(node.children ?? [], `${key}.`)}
								</div>
							) : null}
						</div>
					);
				}
				case "button": {
					const Icon = iconFor(node.icon);
					return (
						<Button
							key={key}
							type="button"
							size="sm"
							variant={
								node.variant === "primary"
									? "default"
									: node.variant === "ghost" || node.variant === "danger"
										? "ghost"
										: "outline"
							}
							data-memon-ref={ref}
							disabled={Boolean(node.disabled)}
							title={node.disabled ? node.disabled : undefined}
							onClick={() =>
								node.userOnly ? onUserAction?.(node.id) : act(node.id)
							}
							className={cn(
								"h-8 shrink-0 gap-1.5 px-3 text-xs",
								!inRow && "self-start",
								node.variant === "danger" &&
									"text-red-700 hover:bg-red-500/10 hover:text-red-700 dark:text-red-300 dark:hover:text-red-300",
							)}
						>
							{Icon ? <Icon size={13} /> : null}
							{node.label}
						</Button>
					);
				}
				case "toggle":
					if (node.variant === "check") {
						return (
							<button
								key={key}
								type="button"
								role="checkbox"
								aria-checked={node.checked}
								data-memon-ref={ref}
								disabled={Boolean(node.disabled)}
								title={node.disabled}
								onClick={() => act(node.id, !node.checked)}
								className="-mx-1 flex min-w-0 items-start gap-2 rounded-md px-1 py-1 text-left text-xs leading-4 transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
							>
								<span
									className={cn(
										"flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
										node.checked
											? "border-emerald-600 bg-emerald-600 text-white"
											: "border-muted-foreground/50",
									)}
								>
									{node.checked ? <Check size={12} strokeWidth={3} /> : null}
								</span>
								<span
									className={cn(
										"min-w-0 flex-1 break-words",
										node.checked && "text-muted-foreground line-through",
									)}
								>
									{node.label}
								</span>
							</button>
						);
					}
					return (
						<label
							key={key}
							htmlFor={`memon-kit-${ref}`}
							title={node.disabled}
							className={cn(
								"flex h-8 shrink-0 items-center gap-2 text-xs",
								!inRow && "self-start",
							)}
						>
							<Switch
								id={`memon-kit-${ref}`}
								data-memon-ref={ref}
								checked={node.checked}
								disabled={Boolean(node.disabled)}
								onCheckedChange={(checked) => act(node.id, checked)}
							/>
							{node.label}
						</label>
					);
				case "input":
					return (
						<div
							key={key}
							className={cn(
								"flex min-w-0 flex-col gap-1",
								inRow && "min-w-[10rem] flex-1",
							)}
						>
							{node.inline || node.hideLabel ? null : (
								<p className={LABEL}>{node.label}</p>
							)}
							<div className="flex min-w-0 items-center gap-2">
								<Field
									node={node}
									refName={ref ?? ""}
									commit={(value) => act(node.id, value)}
								/>
							</div>
						</div>
					);
				case "select": {
					const select = (
						<select
							data-memon-ref={ref}
							aria-label={node.label}
							value={node.value}
							onChange={(event) => act(node.id, event.target.value)}
							className={cn(FIELD, "h-8 w-auto max-w-full cursor-pointer pr-7")}
						>
							{node.options.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					);
					return node.inline ? (
						<label
							key={key}
							className="flex h-8 shrink-0 items-center gap-1.5 text-xs"
						>
							<span className="text-muted-foreground">{node.label}</span>
							{select}
						</label>
					) : (
						<div
							key={key}
							className={cn(
								"flex shrink-0 flex-col gap-1",
								!inRow && "self-start",
							)}
						>
							<p className={LABEL}>{node.label}</p>
							{select}
						</div>
					);
				}
				case "tabs":
					return (
						<div
							key={key}
							data-memon-ref={ref}
							role="tablist"
							aria-label={node.label}
							className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5"
						>
							{node.options.map((option) => {
								const Icon = iconFor(option.icon);
								const selected = option.value === node.value;
								return (
									<button
										type="button"
										role="tab"
										key={option.value}
										aria-selected={selected}
										onClick={() => act(node.id, option.value)}
										className={cn(
											"inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors",
											selected
												? "border-cyan-500/40 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
												: "border-border/60 text-muted-foreground hover:bg-muted",
										)}
									>
										{Icon ? <Icon size={12} /> : null}
										{option.label}
										{option.dot ? (
											<span
												className={cn(
													"h-1.5 w-1.5 rounded-full",
													option.dot === "on"
														? "bg-emerald-500"
														: "bg-muted-foreground/30",
												)}
											/>
										) : null}
									</button>
								);
							})}
						</div>
					);
				case "audio":
					return (
						<AudioClipPlayer
							key={key}
							path={node.path}
							mimeType={node.mimeType}
							durationMs={node.durationMs}
							downloadName={node.label ?? "audio"}
							compact
						/>
					);
				case "image":
					return (
						<StoredImage
							key={key}
							path={node.path}
							mimeType={node.mimeType}
							alt={node.alt}
							className="h-28 w-auto max-w-full self-start rounded-md border border-border/60 object-contain"
							placeholderClassName="h-28 w-28 rounded-md"
						/>
					);
				case "slot":
					return (
						<React.Fragment key={key}>
							{slots?.[node.name] ?? (
								<p className="text-[11px] text-muted-foreground">{node.text}</p>
							)}
						</React.Fragment>
					);
			}
			return null;
		});

	return <div className="flex min-w-0 flex-col gap-2.5">{draw(nodes, "")}</div>;
};
