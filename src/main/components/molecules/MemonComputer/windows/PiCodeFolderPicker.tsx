import {
	ChevronRight,
	FileText,
	Folder,
	FolderOpen,
	FolderPlus,
	HardDrive,
	History,
	House,
	Loader2,
	Pi,
	Search,
	X,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Button } from "@/main/components/ui/button";
import { memonDisplayPath } from "@/services/memon/constants";
import type {
	MemonPiCodeBrowse,
	MemonPiCodeFolder,
} from "@/services/memon/types";
import { MEMON_APP_TINTS } from "../MemonWindowFrame";
import type { MemonSend } from "../types";

const loadClient = () =>
	import("@/services/memon/memon-client").then((module) => module.memonClient);

/** A typed path waits this long for more keys before its folder is listed. */
const TYPING_MS = 120;
/** Files shown under a folder's folders, so it is known by what it holds. */
const MAX_FILES = 12;
/** Folders the path bar shows before the middle ones fold into "…". */
const MAX_CRUMBS = 4;

interface Crumb {
	name: string;
	path: string;
}

const baseName = (path: string): string =>
	path === "/" ? "/" : path.slice(path.lastIndexOf("/") + 1);

const joinPath = (dir: string, name: string): string =>
	`${dir === "/" ? "" : dir}/${name}`;

/** `~`, `~/…` or `/…`: a path to go through, not words to look for. */
const isTypedPath = (query: string): boolean => /^(~(\/|$)|\/)/.test(query);

/** A typed path: the folder it is in, and the start of the name being typed. */
const splitTyped = (query: string): { dir: string; base: string } => {
	const slash = query.lastIndexOf("/");
	return slash < 0
		? { dir: query, base: "" }
		: { dir: query.slice(0, slash) || "/", base: query.slice(slash + 1) };
};

const errorText = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

/** "3 hours ago", in the app's language. */
const useTimeAgo = (): ((time: number) => string) => {
	const { i18n } = useTranslation();
	const language = i18n?.resolvedLanguage ?? i18n?.language ?? "en";
	return React.useMemo(() => {
		let format: Intl.RelativeTimeFormat;
		try {
			format = new Intl.RelativeTimeFormat(
				language === "vn" ? "vi" : language,
				{ numeric: "auto" },
			);
		} catch {
			format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
		}
		return (time: number) => {
			const seconds = Math.round((time - Date.now()) / 1000);
			const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
				["year", 31_536_000],
				["month", 2_592_000],
				["week", 604_800],
				["day", 86_400],
				["hour", 3_600],
				["minute", 60],
			];
			for (const [unit, size] of units) {
				if (Math.abs(seconds) >= size) {
					return format.format(Math.round(seconds / size), unit);
				}
			}
			return format.format(0, "second");
		};
	}, [language]);
};

type PickerRow =
	| { kind: "recent"; path: string; folder: MemonPiCodeFolder }
	| { kind: "folder"; path: string; name: string };

const ROW =
	"group flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 outline-none";
const ROW_ACTION =
	"inline-flex h-6 shrink-0 items-center gap-1 rounded-md border border-input bg-background px-2 text-[11px] font-medium text-foreground hover:bg-accent";
const SECTION =
	"px-2 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";
const KBD =
	"rounded border border-border bg-muted px-1 font-mono text-[10px] text-foreground/80";

/**
 * pi code's folder picker: pi works and keeps its sessions in a folder, so
 * opening it starts by picking one. As editors do it: the folders used last
 * first (each can continue its last session), then the folders here to go
 * through, with a path bar. Typing filters both; typing a path (~/…, /…)
 * goes through folders as a shell completes them. Enter opens the
 * highlighted folder, → goes into it, ← or Backspace goes up, Ctrl+Enter
 * opens the folder being shown, and New folder makes one and opens it.
 */
export const PiCodeFolderPicker: React.FC<{
	machineKey: string;
	home: string;
	send: MemonSend;
	/** Keys go to the picker while its window is in front. */
	focused: boolean;
	/** The folder pi works in, when the picker moves it to another one. */
	current?: string;
	/** Closes the picker over a running pi. */
	onCancel?: () => void;
	/** pi opened the picked folder. */
	onOpened?: () => void;
}> = ({ machineKey, home, send, focused, current, onCancel, onOpened }) => {
	const { t } = useTranslation("common");
	const timeAgo = useTimeAgo();
	const listId = React.useId();
	const inputRef = React.useRef<HTMLInputElement>(null);
	const [recent, setRecent] = React.useState<MemonPiCodeFolder[] | null>(null);
	const [query, setQuery] = React.useState("");
	const [browseDir, setBrowseDir] = React.useState(() =>
		current ? current.replace(/\/[^/]*$/, "") || "/" : home,
	);
	const [browse, setBrowse] = React.useState<{
		dir: string;
		result?: MemonPiCodeBrowse;
		error?: string;
	} | null>(null);
	const [active, setActive] = React.useState(0);
	const [naming, setNaming] = React.useState<string | null>(null);
	const [nameError, setNameError] = React.useState<string | null>(null);
	const [opening, setOpening] = React.useState<string | null>(null);
	const [openError, setOpenError] = React.useState<string | null>(null);

	// The home can move while the picker is up (the agent's home resolved,
	// the agent renamed): a folder shown in it moves along.
	const shownHome = React.useRef(home);
	React.useEffect(() => {
		const previous = shownHome.current;
		shownHome.current = home;
		if (previous === home) return;
		setBrowseDir((shown) =>
			shown === previous || shown.startsWith(`${previous}/`)
				? `${home}${shown.slice(previous.length)}`
				: shown,
		);
	}, [home]);

	const typed = isTypedPath(query) ? splitTyped(query) : null;
	const dir = typed ? typed.dir : browseDir;
	const filter = typed ? typed.base : query.trim();

	React.useEffect(() => {
		let live = true;
		void loadClient()
			.then((client) => client.request("piCode.folders", { key: machineKey }))
			.then((folders) => {
				if (live) setRecent(folders ?? []);
			})
			.catch(() => {
				if (live) setRecent([]);
			});
		return () => {
			live = false;
		};
	}, [machineKey]);

	// The folder being shown; a typed one once the keys pause.
	const typing = typed !== null;
	React.useEffect(() => {
		let live = true;
		const timer = setTimeout(
			() => {
				void loadClient()
					.then((client) =>
						client.request("piCode.browse", { key: machineKey, dir }),
					)
					.then((result) => {
						if (!live) return;
						setBrowse(
							result
								? { dir, result }
								: { dir, error: t("memonComputer.piCode.picker.gone") },
						);
					})
					.catch((error: unknown) => {
						if (live) setBrowse({ dir, error: errorText(error) });
					});
			},
			typing ? TYPING_MS : 0,
		);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [machineKey, dir, typing, t]);

	const listed = browse?.dir === dir ? browse : null;
	const here = listed?.result;
	const needle = filter.toLowerCase();
	const matches = (text: string) => text.toLowerCase().includes(needle);
	const rows: PickerRow[] = [
		...(typed
			? []
			: (recent ?? [])
					.filter(
						(folder) =>
							!needle ||
							matches(baseName(folder.path)) ||
							matches(memonDisplayPath(folder.path, home)),
					)
					.map(
						(folder): PickerRow => ({
							kind: "recent",
							path: folder.path,
							folder,
						}),
					)),
		...(here?.folders ?? [])
			.filter(
				(folder) =>
					(!folder.name.startsWith(".") || filter.startsWith(".")) &&
					(typed
						? folder.name.toLowerCase().startsWith(needle)
						: matches(folder.name)),
			)
			.map(
				(folder): PickerRow => ({
					kind: "folder",
					path: folder.path,
					name: folder.name,
				}),
			),
	];
	const recentCount = rows.filter((row) => row.kind === "recent").length;
	// A typed folder ending in / is what Enter opens, until a key picks a row.
	const noPick = typed !== null && !typed.base;
	const selected = Math.min(active, rows.length - 1);
	const selectedRow = selected >= 0 ? rows[selected] : undefined;

	// biome-ignore lint/correctness/useExhaustiveDependencies: starts over on every new query or folder.
	React.useEffect(() => {
		setActive(noPick ? -1 : 0);
	}, [query, browseDir]);

	React.useEffect(() => {
		if (focused) inputRef.current?.focus();
	}, [focused]);

	React.useEffect(() => {
		if (selected < 0) return;
		document
			.getElementById(`${listId}-${selected}`)
			?.scrollIntoView?.({ block: "nearest" });
	}, [selected, listId]);

	const open = async (
		path: string,
		options: { continueLast?: boolean; create?: boolean } = {},
	) => {
		if (opening) return;
		setOpening(path);
		setOpenError(null);
		try {
			await send(
				"piCode.open",
				{ key: machineKey, cwd: memonDisplayPath(path, home), ...options },
				{ rethrow: true },
			);
			onOpened?.();
		} catch (error) {
			setOpenError(errorText(error));
		} finally {
			setOpening(null);
		}
	};

	/** Shows a folder: as a typed path while one is typed. */
	const go = (path: string) => {
		setNaming(null);
		if (typed) {
			setQuery(path === "/" ? "/" : `${memonDisplayPath(path, home)}/`);
		} else {
			setQuery("");
			setBrowseDir(path);
		}
		inputRef.current?.focus();
	};

	const up = () => {
		if (here?.parent) go(here.parent);
	};

	const startNaming = () => {
		setNaming("");
		setNameError(null);
	};

	const createFolder = () => {
		if (!here || naming === null) return;
		const name = naming.trim();
		const problem = !name
			? t("memonComputer.piCode.picker.nameEmpty")
			: /[/\\]/.test(name) || name === "." || name === ".."
				? t("memonComputer.piCode.picker.nameInvalid")
				: here.folders.some((folder) => folder.name === name)
					? t("memonComputer.piCode.picker.nameTaken", { name })
					: null;
		if (problem) {
			setNameError(problem);
			return;
		}
		void open(joinPath(here.dir, name), { create: true });
	};

	const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		const atEnd =
			event.currentTarget.selectionStart === event.currentTarget.value.length;
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				setActive(Math.min(selected + 1, rows.length - 1));
				return;
			case "ArrowUp":
				event.preventDefault();
				setActive(Math.max(selected - 1, noPick ? -1 : 0));
				return;
			case "Enter":
				event.preventDefault();
				if (event.ctrlKey || event.metaKey || !selectedRow) {
					if (here) void open(here.dir);
				} else if (event.shiftKey && selectedRow.kind === "recent") {
					void open(selectedRow.path, { continueLast: true });
				} else {
					void open(selectedRow.path);
				}
				return;
			case "Tab":
			case "ArrowRight":
				// Tab completes a typed path; → goes in at the end of the line.
				if (event.key === "Tab" ? !typed : !atEnd) return;
				if (!selectedRow) return;
				event.preventDefault();
				go(selectedRow.path);
				return;
			case "ArrowLeft":
			case "Backspace":
				if (query) return;
				event.preventDefault();
				up();
				return;
			case "Escape":
				if (query) {
					event.preventDefault();
					setQuery("");
				} else if (onCancel) {
					event.preventDefault();
					onCancel();
				}
				return;
		}
	};

	// The path bar: the whole path from the drive, the home with its house.
	// A long one folds its middle folders into "…", keeping the first, the
	// home and the last two.
	const shownDir = here?.dir ?? (listed ? undefined : browse?.result?.dir);
	const crumbs: Crumb[] = (shownDir ?? home)
		.split("/")
		.filter(Boolean)
		.map((name, index, names) => ({
			name,
			path: `/${names.slice(0, index + 1).join("/")}`,
		}));
	const kept = new Set([
		0,
		crumbs.findIndex((crumb) => crumb.path === home),
		crumbs.length - 2,
		crumbs.length - 1,
	]);
	const shownCrumbs: Array<Crumb | { folded: Crumb[] }> = [];
	crumbs.forEach((crumb, index) => {
		const previous = shownCrumbs.at(-1);
		if (crumbs.length <= MAX_CRUMBS || kept.has(index)) {
			shownCrumbs.push(crumb);
		} else if (previous && "folded" in previous) {
			previous.folded.push(crumb);
		} else {
			shownCrumbs.push({ folded: [crumb] });
		}
	});
	const files = (here?.files ?? []).filter(
		(name) =>
			(!name.startsWith(".") || filter.startsWith(".")) &&
			(typed ? name.toLowerCase().startsWith(needle) : matches(name)),
	);

	const rowId = (index: number) => `${listId}-${index}`;
	const renderRow = (row: PickerRow, index: number) => {
		const isSelected = index === selected;
		const isCurrent = row.path === current;
		const busy = opening === row.path;
		if (row.kind === "recent") {
			const { folder } = row;
			const continueTitle = folder.latest.title
				? t("memonComputer.piCode.picker.continueTitle", {
						title: folder.latest.title,
					})
				: t("memonComputer.piCode.picker.continue");
			return (
				// biome-ignore lint/a11y/useKeyWithClickEvents: the search field moves through the rows.
				<div
					key={`recent:${row.path}`}
					id={rowId(index)}
					role="option"
					tabIndex={-1}
					aria-selected={isSelected}
					data-testid="memon-pi-code-recent"
					onMouseMove={() => selected !== index && setActive(index)}
					onClick={() => void open(row.path)}
					className={cn(ROW, isSelected && "bg-accent")}
				>
					<span
						className={cn(
							"flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
							MEMON_APP_TINTS.pi,
						)}
					>
						{busy ? (
							<Loader2 size={14} className="animate-spin" />
						) : (
							<Folder size={14} />
						)}
					</span>
					<div className="min-w-0 flex-1">
						<div className="flex min-w-0 items-center gap-1.5">
							<span className="truncate text-[13px] font-medium">
								{baseName(folder.path)}
							</span>
							{isCurrent ? (
								<span className="shrink-0 rounded-full bg-lime-500/15 px-1.5 text-[10px] font-medium text-lime-700 dark:text-lime-300">
									{t("memonComputer.piCode.picker.openNow")}
								</span>
							) : null}
						</div>
						<div className="truncate text-[11px] text-muted-foreground">
							{memonDisplayPath(folder.path, home)} · {timeAgo(folder.lastUsed)}{" "}
							·{" "}
							{t("memonComputer.piCode.picker.sessions", {
								count: folder.sessions,
							})}
						</div>
					</div>
					<button
						type="button"
						tabIndex={-1}
						title={continueTitle}
						aria-label={continueTitle}
						data-testid="memon-pi-code-continue"
						onClick={(event) => {
							event.stopPropagation();
							void open(row.path, { continueLast: true });
						}}
						className={cn(
							ROW_ACTION,
							!isSelected && "opacity-0 group-hover:opacity-100",
						)}
					>
						<History size={11} />
						{t("memonComputer.piCode.picker.continue")}
					</button>
				</div>
			);
		}
		return (
			// biome-ignore lint/a11y/useKeyWithClickEvents: the search field moves through the rows.
			<div
				key={`folder:${row.path}`}
				id={rowId(index)}
				role="option"
				tabIndex={-1}
				aria-selected={isSelected}
				data-testid="memon-pi-code-folder"
				onMouseMove={() => selected !== index && setActive(index)}
				onClick={() => go(row.path)}
				className={cn(ROW, "py-1", isSelected && "bg-accent")}
			>
				{busy ? (
					<Loader2
						size={15}
						className="shrink-0 animate-spin text-muted-foreground"
					/>
				) : (
					<Folder size={15} className="shrink-0 fill-current text-sky-500/70" />
				)}
				<span className="min-w-0 flex-1 truncate text-[13px]">{row.name}</span>
				<button
					type="button"
					tabIndex={-1}
					data-testid="memon-pi-code-open-folder"
					onClick={(event) => {
						event.stopPropagation();
						void open(row.path);
					}}
					className={cn(
						ROW_ACTION,
						!isSelected && "opacity-0 group-hover:opacity-100",
					)}
				>
					{t("memonComputer.piCode.picker.open")}
				</button>
				<ChevronRight size={14} className="shrink-0 text-muted-foreground" />
			</div>
		);
	};

	const folderRows = rows.slice(recentCount);
	const showRecent = !typed && (recent === null || recent.length > 0);

	return (
		<div
			data-testid="memon-pi-code-picker"
			className="@container flex h-full min-h-0 flex-col bg-background text-foreground"
		>
			<div className="shrink-0 space-y-3 px-4 pb-2 pt-4">
				<div className="flex items-start gap-3">
					<span
						className={cn(
							"flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
							MEMON_APP_TINTS.pi,
						)}
					>
						<Pi size={18} />
					</span>
					<div className="min-w-0 flex-1">
						<h2 className="text-sm font-semibold">
							{t(
								current
									? "memonComputer.piCode.picker.switchTitle"
									: "memonComputer.piCode.picker.title",
							)}
						</h2>
						<p className="text-xs leading-snug text-muted-foreground">
							{t("memonComputer.piCode.picker.subtitle")}
						</p>
					</div>
					{onCancel ? (
						<button
							type="button"
							onClick={onCancel}
							aria-label={t("memonComputer.piCode.picker.cancel")}
							title={t("memonComputer.piCode.picker.cancel")}
							className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
						>
							<X size={14} />
						</button>
					) : null}
				</div>
				<div className="relative">
					<Search
						size={14}
						className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
					/>
					<input
						ref={inputRef}
						type="text"
						role="combobox"
						aria-expanded
						aria-controls={listId}
						aria-activedescendant={selected >= 0 ? rowId(selected) : undefined}
						aria-label={t("memonComputer.piCode.picker.search")}
						data-testid="memon-pi-code-search"
						autoComplete="off"
						spellCheck={false}
						placeholder={t("memonComputer.piCode.picker.search")}
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onKeyDown={onKeyDown}
						className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-[13px] outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
					/>
				</div>
				{openError ? (
					<p
						role="alert"
						className="rounded-md bg-red-500/10 px-2 py-1.5 text-xs text-red-700 dark:text-red-300"
					>
						{openError}
					</p>
				) : null}
			</div>

			<div
				id={listId}
				role="listbox"
				aria-label={t("memonComputer.piCode.picker.title")}
				className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
			>
				{showRecent ? (
					<>
						<div className={SECTION}>
							{t("memonComputer.piCode.picker.recent")}
						</div>
						{recent === null ? (
							<div className="space-y-1 px-2 py-1" aria-hidden="true">
								<div className="h-8 animate-pulse rounded-md bg-muted" />
								<div className="h-8 animate-pulse rounded-md bg-muted/60" />
							</div>
						) : recentCount ? (
							rows.slice(0, recentCount).map(renderRow)
						) : (
							<p className="px-2 py-1 text-xs text-muted-foreground">
								{t("memonComputer.piCode.picker.noMatch", { query: filter })}
							</p>
						)}
					</>
				) : null}

				<div className="flex items-center gap-1 pb-1 pl-1 pr-0.5 pt-3">
					<nav
						aria-label={t("memonComputer.piCode.picker.location")}
						className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-[11px] text-muted-foreground"
					>
						<button
							type="button"
							onClick={() => go("/")}
							title="/"
							aria-label="/"
							className={cn(
								"inline-flex shrink-0 items-center rounded px-1 py-1 hover:bg-accent hover:text-foreground",
								!crumbs.length && "text-foreground",
							)}
						>
							<HardDrive size={12} />
						</button>
						{shownCrumbs.map((crumb, index) => {
							const last = index === shownCrumbs.length - 1;
							const separator = (
								<ChevronRight size={11} className="shrink-0 opacity-60" />
							);
							if ("folded" in crumb) {
								const hidden = crumb.folded.at(-1) as Crumb;
								return (
									<React.Fragment key={`folded:${hidden.path}`}>
										{separator}
										<button
											type="button"
											title={hidden.path}
											onClick={() => go(hidden.path)}
											className="shrink-0 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
										>
											…
										</button>
									</React.Fragment>
								);
							}
							return (
								<React.Fragment key={crumb.path}>
									{separator}
									<button
										type="button"
										title={crumb.path === home ? "~" : crumb.path}
										onClick={() => go(crumb.path)}
										className={cn(
											"inline-flex min-w-0 max-w-[10rem] items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground",
											last && "font-medium text-foreground",
										)}
									>
										{crumb.path === home ? (
											<House size={12} className="shrink-0" />
										) : null}
										<span className="truncate">{crumb.name}</span>
									</button>
								</React.Fragment>
							);
						})}
						{!listed ? (
							<Loader2 size={11} className="ml-1 shrink-0 animate-spin" />
						) : null}
					</nav>
					<button
						type="button"
						onClick={startNaming}
						disabled={!here}
						data-testid="memon-pi-code-new-folder"
						className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
					>
						<FolderPlus size={12} />
						{t("memonComputer.piCode.picker.newFolder")}
					</button>
				</div>

				{naming !== null && here ? (
					<div className="mb-1 space-y-1 rounded-md border border-input bg-muted/40 p-2">
						<div className="flex items-center gap-2">
							<FolderPlus
								size={14}
								className="shrink-0 text-muted-foreground"
							/>
							<input
								// biome-ignore lint/a11y/noAutofocus: the user asked to name a folder.
								autoFocus
								type="text"
								aria-label={t("memonComputer.piCode.picker.newFolderName")}
								data-testid="memon-pi-code-new-folder-name"
								placeholder={t("memonComputer.piCode.picker.newFolderName")}
								value={naming}
								onChange={(event) => {
									setNaming(event.target.value);
									setNameError(null);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										createFolder();
									} else if (event.key === "Escape") {
										event.preventDefault();
										event.stopPropagation();
										setNaming(null);
										inputRef.current?.focus();
									}
								}}
								className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
							/>
							<Button
								type="button"
								size="sm"
								className="h-7 text-[11px]"
								onClick={createFolder}
								disabled={Boolean(opening)}
							>
								{t("memonComputer.piCode.picker.create")}
							</Button>
						</div>
						<p
							className={cn(
								"pl-6 text-[11px]",
								nameError
									? "text-red-700 dark:text-red-300"
									: "text-muted-foreground",
							)}
						>
							{nameError ??
								t("memonComputer.piCode.picker.createHint", {
									folder: memonDisplayPath(here.dir, home),
								})}
						</p>
					</div>
				) : null}

				{listed?.error ? (
					<p className="px-2 py-1 text-xs text-muted-foreground">
						{listed.error}
					</p>
				) : !listed ? null : folderRows.length ? (
					folderRows.map((row, index) => renderRow(row, recentCount + index))
				) : (
					<p className="px-2 py-1 text-xs text-muted-foreground">
						{filter
							? t("memonComputer.piCode.picker.noMatch", { query: filter })
							: t("memonComputer.piCode.picker.empty")}
					</p>
				)}
				{listed && files.length ? (
					// What else the folder holds: seen, not picked.
					<div
						aria-hidden="true"
						data-testid="memon-pi-code-files"
						className="mt-0.5 select-none"
					>
						{files.slice(0, MAX_FILES).map((name) => (
							<div
								key={name}
								className="flex items-center gap-2.5 px-2 py-0.5 text-[12px] text-muted-foreground/60"
							>
								<FileText size={14} className="shrink-0" />
								<span className="truncate">{name}</span>
							</div>
						))}
						{files.length > MAX_FILES ? (
							<div className="px-2 py-0.5 pl-[2.1rem] text-[11px] text-muted-foreground/60">
								{t("memonComputer.piCode.picker.moreFiles", {
									count: files.length - MAX_FILES,
								})}
							</div>
						) : null}
					</div>
				) : null}
			</div>

			<div className="flex shrink-0 items-center gap-2 border-t px-3 py-2">
				<p className="hidden min-w-0 flex-1 items-center gap-1 truncate text-[10px] text-muted-foreground @sm:flex">
					<kbd className={KBD}>↵</kbd>
					{t("memonComputer.piCode.picker.keyOpen")}
					<kbd className={cn(KBD, "ml-1.5")}>→</kbd>
					{t("memonComputer.piCode.picker.keyInto")}
					<kbd className={cn(KBD, "ml-1.5")}>⇧↵</kbd>
					{t("memonComputer.piCode.picker.keyContinue")}
				</p>
				<span className="flex-1 @sm:hidden" />
				{onCancel ? (
					<Button
						type="button"
						size="sm"
						variant="outline"
						className="h-7 text-[11px]"
						onClick={onCancel}
					>
						{t("memonComputer.piCode.picker.cancel")}
					</Button>
				) : null}
				<Button
					type="button"
					size="sm"
					data-testid="memon-pi-code-open-here"
					className="h-7 max-w-[60%] gap-1.5 text-[11px]"
					disabled={!here || Boolean(opening)}
					title={here ? here.dir : undefined}
					onClick={() => here && void open(here.dir)}
				>
					{opening && opening === here?.dir ? (
						<Loader2 size={12} className="shrink-0 animate-spin" />
					) : (
						<FolderOpen size={12} className="shrink-0" />
					)}
					<span className="truncate">
						{t("memonComputer.piCode.picker.openHere", {
							folder: here ? baseName(here.dir) : "…",
						})}
					</span>
				</Button>
			</div>
		</div>
	);
};
