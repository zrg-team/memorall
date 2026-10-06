import {
	ClipboardPaste,
	Copy,
	FileArchive,
	FileText,
	Folder,
	HardDrive,
	House,
	Loader2,
	Menu,
	Plus,
	Scissors,
	Trash2,
	Upload,
	X,
} from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { listFileRefs } from "@/services/memon/screen-serializer";
import type { MemonFilesState } from "@/services/memon/types";
import {
	addContextMenuActions,
	fileMenuActions,
	pasteMenuAction,
} from "../context-menu-actions";
import type { MemonSend } from "../types";
import { pickFiles, uploadToComputer } from "../upload";
import { useDeleteConfirm } from "../use-delete-confirm";
import { downloadFolderAsZip } from "@/main/modules/files/utils/save-download";
import { cn } from "@/lib/utils";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/main/components/ui/dropdown-menu";
import { logError } from "@/utils/logger";

const formatSize = (size?: number): string =>
	size === undefined
		? ""
		: size < 1024
			? `${size} B`
			: `${(size / 1024).toFixed(1)} KB`;

/** Entries dragged inside Files, as JSON paths. */
const DRAG_TYPE = "application/x-memon-files";

/** Header buttons are icons of one size: the header never changes height. */
const TOOL_BUTTON =
	"inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60";

export const FilesWindow: React.FC<{
	machineKey: string;
	files: MemonFilesState;
	/** The agent's home folder, drawn as a house. */
	home: string;
	send: MemonSend;
}> = ({ machineKey, files, home, send }) => {
	const { t } = useTranslation("common");
	const refs = listFileRefs(files);
	const newFile = refs.find(({ target }) => target.kind === "new-file");
	// Inside the home the path starts at the house; elsewhere at the drive.
	const inHome = files.cwd === home || files.cwd.startsWith(`${home}/`);
	const base = inHome ? home : "/";
	const segments = (inHome ? files.cwd.slice(home.length) : files.cwd)
		.split("/")
		.filter(Boolean);
	const joinBase = (parts: string[]) =>
		`${base === "/" ? "" : base}/${parts.join("/")}`;
	const open = (ref: string) =>
		void send("files.ref", { key: machineKey, ref });
	const [uploading, setUploading] = React.useState(false);
	const [zipping, setZipping] = React.useState(false);
	const [dragging, setDragging] = React.useState(false);
	const [selected, setSelected] = React.useState<string[]>([]);
	const [anchor, setAnchor] = React.useState<string | null>(null);
	const [dropTarget, setDropTarget] = React.useState<string | null>(null);
	const clipboard = files.clipboard ?? null;
	const entryPaths = files.entries.map((entry) => entry.path);
	const { confirmDelete, dialog: deleteDialog } = useDeleteConfirm((paths) => {
		setSelected([]);
		void send("files.delete", { key: machineKey, paths });
	});

	// A selection belongs to the folder it was made in.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset on every folder change.
	React.useEffect(() => {
		setSelected([]);
		setAnchor(null);
	}, [files.cwd]);

	/** Saves the files into a folder (the open one by default). */
	/** The one folder selected, or the open folder: as a .zip download. */
	const zipFolder = async () => {
		if (zipping) return;
		const [only] = selected;
		const folder =
			selected.length === 1 &&
			files.entries.some((entry) => entry.path === only && entry.type === "dir")
				? only
				: files.cwd;
		setZipping(true);
		try {
			await downloadFolderAsZip(folder);
		} catch (error) {
			logError("[MEMON] Zip failed:", error);
		} finally {
			setZipping(false);
		}
	};

	const upload = async (picked: File[], folder = files.cwd) => {
		if (!picked.length || uploading) return;
		setUploading(true);
		try {
			const paths = await uploadToComputer(picked, folder);
			await send("files.uploaded", { key: machineKey, paths });
		} catch (error) {
			logError("[MEMON] Upload failed:", error);
		} finally {
			setUploading(false);
		}
	};

	const toClipboard = (mode: "copy" | "cut", paths = selected) => {
		if (!paths.length) return;
		void send("files.clipboard", { key: machineKey, mode, paths });
	};
	/** Pastes into a folder, the open one by default. */
	const paste = (to?: string) => {
		if (!clipboard) return;
		void send("files.paste", { key: machineKey, ...(to ? { to } : {}) });
	};
	const refOf = (path: string) =>
		refs.find(
			({ target }) => target.kind === "entry" && target.entry.path === path,
		)?.ref;

	const select = (event: React.MouseEvent, path: string): boolean => {
		if (event.ctrlKey || event.metaKey) {
			setSelected((current) =>
				current.includes(path)
					? current.filter((entry) => entry !== path)
					: [...current, path],
			);
			setAnchor(path);
			return true;
		}
		if (event.shiftKey) {
			const from = entryPaths.indexOf(anchor ?? path);
			const to = entryPaths.indexOf(path);
			const [start, end] = from < to ? [from, to] : [to, from];
			setSelected(entryPaths.slice(Math.max(start, 0), end + 1));
			return true;
		}
		return false;
	};

	/** Drop handlers for a folder: entries move (copy with Ctrl or Alt), files upload. */
	const folderDrop = (folder: string) => ({
		onDragOver: (event: React.DragEvent) => {
			const types = event.dataTransfer.types;
			if (!types.includes(DRAG_TYPE) && !types.includes("Files")) return;
			event.preventDefault();
			event.stopPropagation();
			event.dataTransfer.dropEffect = types.includes("Files")
				? "copy"
				: event.ctrlKey || event.altKey
					? "copy"
					: "move";
			setDropTarget(folder);
		},
		onDragLeave: () =>
			setDropTarget((current) => (current === folder ? null : current)),
		onDrop: (event: React.DragEvent) => {
			setDropTarget(null);
			setDragging(false);
			const raw = event.dataTransfer.getData(DRAG_TYPE);
			if (raw) {
				event.preventDefault();
				event.stopPropagation();
				const paths = (JSON.parse(raw) as string[]).filter(
					(path) => path !== folder,
				);
				if (!paths.length) return;
				const copy = event.ctrlKey || event.altKey;
				void send(copy ? "files.copy" : "files.move", {
					key: machineKey,
					paths,
					to: folder,
				});
				return;
			}
			if (event.dataTransfer.files.length) {
				event.preventDefault();
				event.stopPropagation();
				void upload(Array.from(event.dataTransfer.files), folder);
			}
		},
	});

	const crumb = (label: React.ReactNode, path: string, title?: string) => (
		<button
			type="button"
			{...folderDrop(path)}
			title={title ?? path}
			aria-label={title}
			className={cn(
				"inline-flex items-center rounded px-1 py-0.5 hover:bg-muted",
				dropTarget === path && "bg-cyan-500/15 ring-1 ring-cyan-500/60",
			)}
			onClick={() => void send("files.open", { key: machineKey, path })}
		>
			{label}
		</button>
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border px-2">
				<nav className="flex min-w-0 flex-auto items-center gap-0.5 overflow-hidden whitespace-nowrap font-mono text-[11px]">
					{inHome
						? crumb(<House size={13} />, home, t("memonComputer.files.home"))
						: crumb(
								<HardDrive size={13} />,
								"/",
								t("memonComputer.files.root"),
							)}
					{segments.map((segment, index) => {
						const path = joinBase(segments.slice(0, index + 1));
						return (
							<span key={path} className="flex items-center gap-0.5">
								<span className="text-muted-foreground">/</span>
								{crumb(segment, path)}
							</span>
						);
					})}
				</nav>
				<button
					type="button"
					disabled={uploading}
					aria-label={t("memonComputer.upload")}
					title={t("memonComputer.upload")}
					onClick={() => void pickFiles().then((picked) => upload(picked))}
					className={TOOL_BUTTON}
				>
					{uploading ? (
						<Loader2 size={13} className="animate-spin" />
					) : (
						<Upload size={13} />
					)}
				</button>
				{newFile ? (
					<button
						type="button"
						data-memon-ref={newFile.ref}
						aria-label={t("memonComputer.newFile")}
						title={t("memonComputer.newFile")}
						onClick={() => open(newFile.ref)}
						className={TOOL_BUTTON}
					>
						<Plus size={13} />
					</button>
				) : null}
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-label={t("memonComputer.files.more")}
							title={t("memonComputer.files.more")}
							className={cn(TOOL_BUTTON, "relative")}
						>
							{zipping ? (
								<Loader2 size={13} className="animate-spin" />
							) : (
								<Menu size={13} />
							)}
							{/* Over the button, so a selection never moves the header. */}
							{selected.length || clipboard ? (
								<span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-cyan-600 px-0.5 text-[9px] font-semibold leading-none text-white">
									{selected.length || clipboard?.paths.length}
								</span>
							) : null}
						</button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-52">
						{selected.length ? (
							<>
								<DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
									{t("memonComputer.files.selected", {
										count: selected.length,
									})}
								</DropdownMenuLabel>
								<DropdownMenuItem onSelect={() => toClipboard("cut")}>
									<Scissors size={13} />
									{t("memonComputer.files.cut")}
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={() => toClipboard("copy")}>
									<Copy size={13} />
									{t("memonComputer.files.copy")}
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={() => confirmDelete(selected)}>
									<Trash2 size={13} />
									{t("buttons.delete")}
								</DropdownMenuItem>
								<DropdownMenuItem onSelect={() => setSelected([])}>
									<X size={13} />
									{t("memonComputer.files.clear")}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
							</>
						) : null}
						{clipboard ? (
							<DropdownMenuItem
								title={clipboard.paths.join("\n")}
								onSelect={() => paste()}
							>
								<ClipboardPaste size={13} />
								{t(
									clipboard.mode === "cut"
										? "memonComputer.files.pasteCut"
										: "memonComputer.files.pasteCopy",
									{ count: clipboard.paths.length },
								)}
							</DropdownMenuItem>
						) : null}
						<DropdownMenuItem
							disabled={zipping}
							title={t("memonComputer.files.zipHint")}
							onSelect={() => void zipFolder()}
						>
							<FileArchive size={13} />
							{t("memonComputer.files.zip")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: the list takes dropped files, keys and right-clicks; every action also has a button. */}
			{/* biome-ignore lint/a11y/useKeyWithClickEvents: a click on empty space only clears the selection; Escape does too. */}
			<div
				tabIndex={-1}
				className={cn(
					"min-h-0 flex-1 overflow-auto p-1 outline-none",
					dragging &&
						"bg-cyan-500/5 outline-dashed outline-1 -outline-offset-4 outline-cyan-500/60",
				)}
				onKeyDown={(event) => {
					const mod = event.ctrlKey || event.metaKey;
					const key = event.key.toLowerCase();
					// Enter opens the row with focus, else the one selected.
					const focusedRef = (event.target as HTMLElement).closest<HTMLElement>(
						"[data-memon-ref]",
					)?.dataset.memonRef;
					const openRef =
						focusedRef ??
						(selected.length === 1 ? refOf(selected[0]) : undefined);
					if (mod && key === "c") toClipboard("copy");
					else if (mod && key === "x") toClipboard("cut");
					else if (mod && key === "v") paste();
					else if (mod && key === "a") setSelected(entryPaths);
					else if (key === "escape") setSelected([]);
					else if (key === "enter" && openRef) open(openRef);
					else if (key === "delete" || (event.metaKey && key === "backspace"))
						confirmDelete(selected);
					else return;
					event.preventDefault();
				}}
				onClick={(event) => {
					// A click on empty space clears the selection.
					if (!(event.target as HTMLElement).closest("[data-memon-ref]")) {
						setSelected([]);
					}
				}}
				onContextMenu={(event) => {
					if (
						clipboard &&
						!(event.target as HTMLElement).closest("[data-memon-ref]")
					) {
						addContextMenuActions(event, [pasteMenuAction(t, () => paste())]);
					}
				}}
				onDragOver={(event) => {
					if (!event.dataTransfer.types.includes("Files")) return;
					event.preventDefault();
					setDragging(true);
				}}
				onDragLeave={() => setDragging(false)}
				onDrop={(event) => {
					setDragging(false);
					if (!event.dataTransfer.files.length) return;
					event.preventDefault();
					void upload(Array.from(event.dataTransfer.files));
				}}
			>
				{files.error ? (
					<p className="px-2 py-1 text-xs text-red-700 dark:text-red-300">
						{files.error}
					</p>
				) : null}
				{refs.map(({ ref, target }) => {
					if (target.kind === "new-file") return null;
					const isDir = target.kind === "up" || target.entry.type === "dir";
					const name = target.kind === "up" ? ".." : target.entry.name;
					const path = target.kind === "up" ? target.path : target.entry.path;
					const entry = target.kind === "entry";
					const isSelected = entry && selected.includes(path);
					const isCut =
						clipboard?.mode === "cut" && clipboard.paths.includes(path);
					return (
						<button
							type="button"
							key={ref}
							data-memon-ref={ref}
							data-memon-ask-path={entry ? path : undefined}
							data-memon-ask-folder={entry && isDir ? "" : undefined}
							aria-pressed={entry ? isSelected : undefined}
							draggable={entry}
							onDragStart={(event) => {
								const paths = isSelected ? selected : [path];
								event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths));
								event.dataTransfer.effectAllowed = "copyMove";
							}}
							{...(isDir ? folderDrop(path) : {})}
							// One click selects, two open: as Finder and Explorer do.
							onClick={(event) => {
								if (!entry || select(event, path)) return;
								setSelected([path]);
								setAnchor(path);
							}}
							onDoubleClick={() => open(ref)}
							onContextMenu={(event) => {
								if (!entry) return;
								// A right-click acts on the selection it is part of, else
								// selects just this.
								const paths = isSelected ? selected : [path];
								if (!isSelected) {
									setSelected([path]);
									setAnchor(path);
								}
								addContextMenuActions(
									event,
									fileMenuActions({
										t,
										paths,
										folder: isDir ? path : undefined,
										canPaste: Boolean(clipboard),
										open: () => open(ref),
										toClipboard,
										paste,
										remove: confirmDelete,
									}),
								);
							}}
							className={cn(
								"grid w-full grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-muted/50",
								isSelected && "bg-cyan-500/10 ring-1 ring-cyan-500/40",
								dropTarget === path && "bg-cyan-500/15 ring-1 ring-cyan-500/60",
								isCut && "opacity-50",
							)}
						>
							<span className="rounded border border-border px-1 font-mono text-[10px] text-muted-foreground">
								{ref}
							</span>
							{isDir ? (
								<Folder size={14} className="text-muted-foreground" />
							) : (
								<FileText size={14} className="text-muted-foreground" />
							)}
							<span className="truncate">
								{name}
								{isDir && target.kind !== "up" ? "/" : ""}
							</span>
							<span className="font-mono text-[10px] text-muted-foreground">
								{target.kind === "entry" && target.entry.type === "file"
									? formatSize(target.entry.size)
									: ""}
							</span>
						</button>
					);
				})}
				{!files.entries.length && !files.error ? (
					<p className="px-2 py-3 text-xs text-muted-foreground">
						{t("memonComputer.emptyFolder")}
					</p>
				) : null}
				<p className="px-2 py-2 text-[10px] text-muted-foreground/70">
					{t("memonComputer.dropHint")} {t("memonComputer.files.hint")}
				</p>
			</div>
			{deleteDialog}
		</div>
	);
};
