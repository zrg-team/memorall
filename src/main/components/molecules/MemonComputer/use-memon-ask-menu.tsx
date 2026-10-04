import { MessageSquarePlus } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { MemonMachineSnapshot } from "@/services/memon/types";
import {
	askInChat,
	type MemonAskTarget,
	memonWindowSource,
	memonWindowTarget,
} from "./ask-in-chat";
import {
	contextMenuActions,
	type MemonMenuAction,
} from "./context-menu-actions";

interface MenuItem {
	label: string;
	target: MemonAskTarget;
}

interface MenuState {
	x: number;
	y: number;
	/** What the item under the pointer offers, e.g. Open or Delete. */
	actions: MemonMenuAction[];
	items: MenuItem[];
}

const MENU_WIDTH = 240;
const ROW_HEIGHT = 30;
const PREVIEW_CHARS = 36;

const preview = (value: string): string => {
	const line = value.trim().replace(/\s+/g, " ");
	return line.length > PREVIEW_CHARS
		? `${line.slice(0, PREVIEW_CHARS - 1)}…`
		: line;
};

/**
 * Selected text under the pointer: the Terminal's own selection (it draws
 * it), a field's, else the page's.
 */
const selectedText = (element: HTMLElement, root: HTMLElement): string => {
	const owner = element.closest<HTMLElement>("[data-memon-ask-selection]");
	if (owner) return owner.dataset.memonAskSelection ?? "";
	if (
		element instanceof HTMLTextAreaElement ||
		element instanceof HTMLInputElement
	) {
		const { selectionStart, selectionEnd, value } = element;
		if (selectionStart !== null && selectionEnd !== null) {
			return value.slice(selectionStart, selectionEnd);
		}
	}
	const selection = document.getSelection();
	if (!selection || selection.isCollapsed) return "";
	return root.contains(selection.anchorNode) ? selection.toString() : "";
};

/**
 * Right-click on the computer: the actions the item under the pointer added
 * (see addContextMenuActions), then ask in chat about the selection, the
 * item (a page block, file, terminal line) or the whole window.
 */
export const useMemonAskMenu = (
	snapshot: MemonMachineSnapshot | undefined,
	desktopRef: React.RefObject<HTMLDivElement | null>,
): {
	onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
	menu: React.ReactNode;
} => {
	const { t } = useTranslation("common");
	const [state, setState] = React.useState<MenuState | null>(null);
	const menuRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (!state) return;
		const close = (event: Event) => {
			if (
				event instanceof KeyboardEvent
					? event.key === "Escape"
					: !menuRef.current?.contains(event.target as Node)
			) {
				setState(null);
			}
		};
		document.addEventListener("pointerdown", close, true);
		document.addEventListener("keydown", close, true);
		return () => {
			document.removeEventListener("pointerdown", close, true);
			document.removeEventListener("keydown", close, true);
		};
	}, [state]);

	const onContextMenu = (event: React.MouseEvent<HTMLElement>) => {
		const desktop = desktopRef.current;
		const element = event.target as HTMLElement;
		if (!snapshot || !desktop?.contains(element)) return;
		const windowId = element.closest<HTMLElement>("[data-memon-window]")
			?.dataset.memonWindow;
		const window = snapshot.windows.find(
			(candidate) => candidate.id === windowId,
		);
		const source = window ? memonWindowSource(snapshot, window) : "Desktop";
		const items: MenuItem[] = [];

		const selection = selectedText(element, desktop).trim();
		if (selection) {
			items.push({
				label: t("memonComputer.ask.selection", { text: preview(selection) }),
				target: { kind: "text", source, text: selection },
			});
		}
		const item = element.closest<HTMLElement>(
			"[data-memon-ask],[data-memon-ask-path]",
		);
		const path = item?.dataset.memonAskPath;
		if (path) {
			items.push({
				label: t("memonComputer.ask.item", {
					name: path.split("/").pop() || path,
				}),
				target:
					item?.dataset.memonAskFolder !== undefined
						? { kind: "folder", source, path }
						: { kind: "file", source, path },
			});
		} else if (item?.dataset.memonAsk) {
			items.push({
				label: t("memonComputer.ask.item", {
					name: preview(item.dataset.memonAsk),
				}),
				target: { kind: "text", source, text: item.dataset.memonAsk },
			});
		}
		const whole = window ? memonWindowTarget(snapshot, window) : null;
		if (window && whole) {
			items.push({
				label: t("memonComputer.ask.window", {
					name: t(`memonComputer.apps.${window.app}`),
				}),
				target: whole,
			});
		}
		const actions = contextMenuActions(event);
		// Nothing to offer: leave the browser's own menu alone.
		if (!items.length && !actions.length) return;
		event.preventDefault();
		const rect = desktop.getBoundingClientRect();
		const height = (actions.length + items.length) * ROW_HEIGHT + 16;
		setState({
			x: Math.min(event.clientX - rect.left, rect.width - MENU_WIDTH - 4),
			y: Math.min(event.clientY - rect.top, rect.height - height),
			actions,
			items,
		});
	};

	const menu = state ? (
		<div
			ref={menuRef}
			role="menu"
			style={{ left: Math.max(4, state.x), top: Math.max(4, state.y) }}
			className="absolute z-[9200] w-60 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
		>
			{state.actions.map((action) => {
				const Icon = action.icon;
				return (
					<button
						type="button"
						role="menuitem"
						key={action.label}
						onClick={() => {
							setState(null);
							action.run();
						}}
						className={cn(
							"flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground",
							action.destructive &&
								"text-red-600 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400",
						)}
					>
						<Icon size={13} className="shrink-0" />
						<span className="min-w-0 flex-1 truncate">{action.label}</span>
						{action.shortcut ? (
							<span className="shrink-0 text-[10px] text-muted-foreground">
								{action.shortcut}
							</span>
						) : null}
					</button>
				);
			})}
			{state.actions.length && state.items.length ? (
				<div role="separator" className="-mx-1 my-1 h-px bg-border" />
			) : null}
			{state.items.map((entry) => (
				<button
					type="button"
					role="menuitem"
					key={entry.label}
					onClick={() => {
						askInChat(entry.target, t);
						setState(null);
					}}
					className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
				>
					<MessageSquarePlus size={13} className="shrink-0" />
					<span className="min-w-0 truncate">{entry.label}</span>
				</button>
			))}
		</div>
	) : null;

	return { onContextMenu, menu };
};
