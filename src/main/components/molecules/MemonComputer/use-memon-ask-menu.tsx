import { MessageSquarePlus } from "lucide-react";
import React from "react";
import { useTranslation } from "react-i18next";
import type { MemonMachineSnapshot } from "@/services/memon/types";
import {
	askInChat,
	type MemonAskTarget,
	memonWindowSource,
	memonWindowTarget,
} from "./ask-in-chat";

interface MenuItem {
	label: string;
	target: MemonAskTarget;
}

interface MenuState {
	x: number;
	y: number;
	items: MenuItem[];
}

const MENU_WIDTH = 240;
const PREVIEW_CHARS = 36;

const preview = (value: string): string => {
	const line = value.trim().replace(/\s+/g, " ");
	return line.length > PREVIEW_CHARS
		? `${line.slice(0, PREVIEW_CHARS - 1)}…`
		: line;
};

/** Selected text under the pointer: a field's selection, else the page's. */
const selectedText = (element: HTMLElement, root: HTMLElement): string => {
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
 * Right-click on the computer: ask in chat about the selection, the item
 * under the pointer (a page block, file, terminal line) or the whole window.
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
		// Nothing to ask about: leave the browser's own menu alone.
		if (!items.length) return;
		event.preventDefault();
		const rect = desktop.getBoundingClientRect();
		setState({
			x: Math.min(event.clientX - rect.left, rect.width - MENU_WIDTH - 4),
			y: Math.min(event.clientY - rect.top, rect.height - 40 * items.length),
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
