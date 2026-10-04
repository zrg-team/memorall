import type { TFunction } from "i18next";
import {
	ClipboardPaste,
	Copy,
	FolderOpen,
	type LucideIcon,
	SquareArrowOutUpRight,
	Scissors,
	Trash2,
} from "lucide-react";

/** What a right-click offers for the item under the pointer, e.g. Delete. */
export interface MemonMenuAction {
	label: string;
	icon: LucideIcon;
	run: () => void;
	/** Shown at the right, e.g. "Ctrl+C". */
	shortcut?: string;
	/** Drawn in red: it cannot be undone. */
	destructive?: boolean;
}

const actionsByEvent = new WeakMap<Event, MemonMenuAction[]>();

/**
 * Adds actions to the computer's right-click menu for this event. An item
 * adds them from its own onContextMenu; the desktop's menu, further up the
 * tree, shows them above its "Ask in chat" entries.
 */
export const addContextMenuActions = (
	event: { nativeEvent: Event },
	actions: MemonMenuAction[],
): void => {
	actionsByEvent.set(event.nativeEvent, [
		...(actionsByEvent.get(event.nativeEvent) ?? []),
		...actions,
	]);
};

/** The actions items under the pointer added for this event. */
export const contextMenuActions = (event: {
	nativeEvent: Event;
}): MemonMenuAction[] => actionsByEvent.get(event.nativeEvent) ?? [];

const isApple = (): boolean =>
	typeof navigator !== "undefined" &&
	/Mac|iPhone|iPad/.test(navigator.userAgent);

/** A Ctrl shortcut as this platform writes it: ⌘C or Ctrl+C. */
export const modifierShortcut = (key: string): string =>
	isApple() ? `⌘${key}` : `Ctrl+${key}`;

/** The name a path ends in. */
const nameOf = (path: string): string => path.split("/").pop() || path;

/**
 * Open, Cut, Copy, Paste into (a folder, when something is cut or copied)
 * and Delete for files and folders. `paths` are what the edits act on: the
 * whole selection when the item is part of it.
 */
export const fileMenuActions = ({
	t,
	paths,
	folder,
	canPaste,
	open,
	toClipboard,
	paste,
	remove,
}: {
	t: TFunction;
	paths: string[];
	/** Set when the item is a folder: Paste goes into it. */
	folder?: string;
	canPaste: boolean;
	open: () => void;
	toClipboard: (mode: "copy" | "cut", paths: string[]) => void;
	paste: (folder: string) => void;
	remove: (paths: string[]) => void;
}): MemonMenuAction[] => [
	{
		label: t("memonComputer.files.open"),
		icon: folder ? FolderOpen : SquareArrowOutUpRight,
		run: open,
	},
	{
		label: t("memonComputer.files.cut"),
		icon: Scissors,
		shortcut: modifierShortcut("X"),
		run: () => toClipboard("cut", paths),
	},
	{
		label: t("memonComputer.files.copy"),
		icon: Copy,
		shortcut: modifierShortcut("C"),
		run: () => toClipboard("copy", paths),
	},
	...(folder && canPaste
		? [
				{
					label: t("memonComputer.files.pasteInto", { name: nameOf(folder) }),
					icon: ClipboardPaste,
					run: () => paste(folder),
				},
			]
		: []),
	{
		label: t("buttons.delete"),
		icon: Trash2,
		shortcut: isApple() ? "⌘⌫" : "Del",
		destructive: true,
		run: () => remove(paths),
	},
];

/** Paste into a folder, for a right-click on its empty space. */
export const pasteMenuAction = (
	t: TFunction,
	run: () => void,
): MemonMenuAction => ({
	label: t("memonComputer.files.paste"),
	icon: ClipboardPaste,
	shortcut: modifierShortcut("V"),
	run,
});
