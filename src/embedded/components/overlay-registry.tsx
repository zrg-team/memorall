/**
 * One page overlay at a time.
 *
 * Smart select and canvas select both cover the page and both listen on the
 * document, so two of them at once fight over the pointer. Each used to keep
 * its own module-level latch, which worked only while there was one family of
 * overlay; with two, opening one has to close the other, and whoever was
 * closed has to find out — a dock button that still looks pressed after its
 * overlay has gone will call a dead teardown on the next click.
 */

import type { ReactNode } from "react";
import { createRoot } from "react-dom/client";

/** Containers the overlays must not capture, hit-test, or photograph. */
export const SMART_SELECT_CONTAINER_ID = "memorall-smart-select-container";
export const CANVAS_SELECT_CONTAINER_ID = "memorall-canvas-select-container";
export const EMBEDDED_CHAT_MODAL_ID = "memorall-embedded-chat-modal";
export const CO_AGENT_OVERLAY_ID = "memorall-co-agent-overlay";

const MEMORALL_OVERLAY_IDS = [
	SMART_SELECT_CONTAINER_ID,
	CANVAS_SELECT_CONTAINER_ID,
	EMBEDDED_CHAT_MODAL_ID,
	CO_AGENT_OVERLAY_ID,
];

/**
 * Memorall's own on-page UI.
 *
 * Used both to ignore our own chrome while picking a target and to hide it
 * before a capture — without the co-agent dock in this list it ends up in the
 * picture.
 */
export const getMemorallOverlayContainers = (): HTMLElement[] =>
	MEMORALL_OVERLAY_IDS.map((id) => document.getElementById(id)).filter(
		(node): node is HTMLElement => Boolean(node),
	);

interface ActiveOverlay {
	cleanup: () => void;
	onDisplaced?: () => void;
}

let active: ActiveOverlay | null = null;

/** Close whatever overlay is open, telling it that it was displaced. */
export const closeActiveOverlay = (): void => {
	const current = active;
	if (!current) return;
	active = null;
	current.cleanup();
	current.onDisplaced?.();
};

export interface MountOverlayOptions {
	containerId: string;
	/** Render the overlay; `close` tears it down without reporting displacement. */
	render: (close: () => void) => ReactNode;
	/**
	 * Called when *another* overlay takes over — never when this overlay closes
	 * itself. Lets an owner that mirrors overlay liveness in its own state (a
	 * pressed dock button, say) find out that its overlay has gone.
	 */
	onDisplaced?: () => void;
}

/**
 * Mount an overlay as the only one, returning its teardown.
 *
 * The returned cleanup is idempotent: a displaced overlay's owner may still
 * call the handle it was given, and that must not unmount a root twice or
 * remove a container belonging to the overlay that replaced it.
 */
export const mountExclusiveOverlay = (
	options: MountOverlayOptions,
): (() => void) => {
	closeActiveOverlay();

	const container = document.createElement("div");
	container.id = options.containerId;
	document.body.appendChild(container);

	const root = createRoot(container);
	let torn = false;

	const cleanup = () => {
		if (torn) return;
		torn = true;
		// Unmounting synchronously from inside a React event handler warns; the
		// overlay is already on its way out either way.
		queueMicrotask(() => root.unmount());
		container.remove();
		if (active?.cleanup === cleanup) {
			active = null;
		}
	};

	active = { cleanup, onDisplaced: options.onDisplaced };
	root.render(options.render(cleanup));

	return cleanup;
};
