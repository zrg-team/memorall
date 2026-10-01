import {
	ArrowLeft,
	Braces,
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
};

const FIELD =
	"w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring";

const TONE: Record<string, string> = {
	muted: "text-muted-foreground",
	error: "text-red-700 dark:text-red-300",
	warning: "text-amber-800 dark:text-amber-200",
	success: "text-emerald-700 dark:text-emerald-300",
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
				className="min-w-0 flex-1 truncate rounded px-1 text-left text-xs hover:bg-muted/60"
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
				className={cn(FIELD, node.mono && "font-mono text-[11px]")}
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
				className={cn(FIELD, "min-w-0 flex-1", node.mono && "font-mono")}
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

/**
 * Draws an app's nodes as its window. Every control carries the ref the
 * agent reads on its screen (`data-memon-ref`), so the agent's cursor lands
 * on it and both work the same controls. Actions run in order: a field the
 * user leaves is committed before the button they press.
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

	const draw = (list: MemonViewNode[], keyPrefix: string): React.ReactNode =>
		list.map((node, index) => {
			const key = `${keyPrefix}${index}`;
			const ref = refs.get(node);
			switch (node.type) {
				case "heading":
					return (
						<p
							key={key}
							className="min-w-0 flex-1 truncate text-xs font-semibold"
						>
							{node.text}
						</p>
					);
				case "text":
					return node.mono ? (
						<pre
							key={key}
							className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 px-2 py-1.5 font-mono text-[11px] leading-relaxed"
						>
							{node.text}
						</pre>
					) : (
						<p
							key={key}
							className={cn(
								"whitespace-pre-wrap text-[11px]",
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
						<div key={key} className="space-y-1">
							<p className="text-[11px] text-muted-foreground">
								{node.value}/{node.max} {node.label}
							</p>
							<div className="h-1 overflow-hidden rounded-full bg-muted">
								<div
									className="h-full rounded-full bg-emerald-500 transition-all"
									style={{
										width: node.max
											? `${(node.value / node.max) * 100}%`
											: "0%",
									}}
								/>
							</div>
						</div>
					);
				case "group":
					return (
						<div
							key={key}
							className={cn(
								node.layout === "row"
									? "flex flex-wrap items-center gap-2"
									: "space-y-2",
							)}
						>
							{draw(node.children, `${key}.`)}
						</div>
					);
				case "item": {
					const StatusIcon = node.status ? STATUS_ICON[node.status] : null;
					return (
						<div
							key={key}
							data-memon-ask={`${node.title}${node.detail ? ` — ${node.detail}` : ""}`}
							className={cn(
								"space-y-1.5 rounded-lg px-2 py-1.5 hover:bg-muted/40",
								node.tone === "muted" && "opacity-80",
							)}
						>
							<div className="flex min-w-0 items-center gap-2">
								{StatusIcon ? (
									<StatusIcon
										size={14}
										className={cn(
											"shrink-0",
											node.status === "done"
												? "text-emerald-600"
												: node.status === "doing"
													? "text-sky-600"
													: "text-muted-foreground",
										)}
									/>
								) : null}
								<span
									className={cn(
										"min-w-0 truncate text-xs font-medium",
										node.tone === "error" && TONE.error,
									)}
								>
									{node.title}
								</span>
								{node.detail ? (
									<span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
										{node.detail}
									</span>
								) : (
									<span className="flex-1" />
								)}
								{node.badges?.map((badge) => (
									<Badge
										key={badge}
										variant="outline"
										className="shrink-0 text-[10px]"
									>
										{badge}
									</Badge>
								))}
							</div>
							{node.children?.length ? (
								<div className="space-y-1.5 pl-5">
									{draw(node.children, `${key}.`)}
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
								"h-7 shrink-0 text-[11px]",
								node.variant === "danger" && "text-red-700 dark:text-red-300",
							)}
						>
							{Icon ? <Icon size={12} /> : null}
							{node.label}
						</Button>
					);
				}
				case "toggle":
					return (
						<label
							key={key}
							htmlFor={`memon-kit-${ref}`}
							title={node.disabled}
							className="flex shrink-0 items-center gap-1.5 text-[11px]"
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
								"min-w-0",
								node.inline ? "flex flex-1" : "flex-1 space-y-1",
							)}
						>
							{node.inline ? null : (
								<p className="text-[10px] font-medium text-muted-foreground">
									{node.label}
								</p>
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
				case "select":
					return (
						<label
							key={key}
							className="flex shrink-0 items-center gap-1.5 text-[11px]"
						>
							<span className="text-muted-foreground">{node.label}</span>
							<select
								data-memon-ref={ref}
								value={node.value}
								onChange={(event) => act(node.id, event.target.value)}
								className={cn(FIELD, "w-auto")}
							>
								{node.options.map((option) => (
									<option key={option.value} value={option.value}>
										{option.label}
									</option>
								))}
							</select>
						</label>
					);
				case "tabs":
					return (
						<div
							key={key}
							data-memon-ref={ref}
							role="tablist"
							aria-label={node.label}
							className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
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
											"inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[11px] font-medium transition-colors",
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
							className="h-28 w-auto max-w-full rounded-md border border-border/60 object-contain"
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

	return <div className="space-y-2">{draw(nodes, "")}</div>;
};
