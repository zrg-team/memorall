import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CO_AGENT_CONTAINER_ID } from "@/co-agent/constants";
import {
	type CoAgentContextAnchor,
	createContextAnchor,
	createSelectionAnchor,
	isEditableElement,
	refreshContextAnchor,
} from "@/co-agent/dom/context-anchor";

const HOVER_DWELL_MS = 650;
const HOVER_ANCHOR_IDLE_HIDE_MS = 4200;

export const CO_AGENT_CONTEXT_SHORTCUT_LABEL = "Alt/Option+Shift+A";

const isCoAgentEvent = (event: Event): boolean =>
	event
		.composedPath()
		.some(
			(node) =>
				node instanceof HTMLElement && node.id === CO_AGENT_CONTAINER_ID,
		);

const getAnchorCandidate = (element: Element): Element | null => {
	if (!(element instanceof HTMLElement)) return null;
	if (element === document.documentElement || element === document.body) {
		return null;
	}
	return (
		element.closest(
			"a, button, input, textarea, select, [role='button'], [role='link'], article, main, section, form, fieldset, li, tr, td, th, p, h1, h2, h3",
		) ?? element
	);
};

interface UseCoAgentContextAnchorOptions {
	disabled: boolean;
	promptOpen: boolean;
	onOpenPrompt: () => void;
}

export const useCoAgentContextAnchor = ({
	disabled,
	promptOpen,
	onOpenPrompt,
}: UseCoAgentContextAnchorOptions) => {
	const [activeAnchor, setActiveAnchor] = useState<CoAgentContextAnchor | null>(
		null,
	);
	const hoverTimerRef = useRef<number | null>(null);
	const hoverHideTimerRef = useRef<number | null>(null);
	const hoverTargetRef = useRef<Element | null>(null);
	const hiddenHoverTargetRef = useRef<Element | null>(null);
	const activeAnchorRef = useRef<CoAgentContextAnchor | null>(null);

	const freshAnchor = useMemo(
		() => (activeAnchor ? refreshContextAnchor(activeAnchor) : null),
		[activeAnchor],
	);

	useEffect(() => {
		activeAnchorRef.current = activeAnchor;
	}, [activeAnchor]);

	const clearHoverTimer = useCallback(() => {
		if (hoverTimerRef.current !== null) {
			window.clearTimeout(hoverTimerRef.current);
			hoverTimerRef.current = null;
		}
	}, []);

	const clearHoverHideTimer = useCallback(() => {
		if (hoverHideTimerRef.current !== null) {
			window.clearTimeout(hoverHideTimerRef.current);
			hoverHideTimerRef.current = null;
		}
	}, []);

	useEffect(() => {
		if (disabled) return;

		const scheduleHoverHide = (target: Element) => {
			clearHoverHideTimer();
			hoverHideTimerRef.current = window.setTimeout(() => {
				if (!promptOpen) {
					hiddenHoverTargetRef.current = target;
					hoverTargetRef.current = null;
					setActiveAnchor((current) =>
						current?.kind === "hover" ? null : current,
					);
				}
				hoverHideTimerRef.current = null;
			}, HOVER_ANCHOR_IDLE_HIDE_MS);
		};

		const handlePointerMove = (event: PointerEvent) => {
			if (isCoAgentEvent(event)) return;
			const target = getAnchorCandidate(event.target as Element);
			clearHoverTimer();
			if (!target) {
				if (!promptOpen) setActiveAnchor(null);
				hoverTargetRef.current = null;
				hiddenHoverTargetRef.current = null;
				clearHoverHideTimer();
				return;
			}
			if (
				hiddenHoverTargetRef.current &&
				hiddenHoverTargetRef.current !== target
			) {
				hiddenHoverTargetRef.current = null;
			}
			if (hiddenHoverTargetRef.current === target) return;
			if (
				hoverTargetRef.current === target &&
				activeAnchorRef.current?.kind === "hover"
			) {
				scheduleHoverHide(target);
				return;
			}
			hoverTimerRef.current = window.setTimeout(() => {
				const anchor = createContextAnchor(target, "hover");
				if (anchor) {
					hoverTargetRef.current = target;
					setActiveAnchor({
						...anchor,
						uiPoint: { x: event.clientX, y: event.clientY },
					});
					scheduleHoverHide(target);
				}
				hoverTimerRef.current = null;
			}, HOVER_DWELL_MS);
		};

		const handleFocusIn = (event: FocusEvent) => {
			if (isCoAgentEvent(event)) return;
			clearHoverHideTimer();
			hoverTargetRef.current = null;
			const target = getAnchorCandidate(event.target as Element);
			if (!target) return;
			const anchor = createContextAnchor(target, "focus");
			if (anchor) setActiveAnchor(anchor);
		};

		const handleSelectionChange = () => {
			clearHoverHideTimer();
			hoverTargetRef.current = null;
			window.setTimeout(() => {
				const anchor = createSelectionAnchor();
				if (anchor) setActiveAnchor(anchor);
			}, 120);
		};

		// Scroll is listened to on the capture phase, so this fires for every
		// scrolling element on the host page — many times a frame on a long one.
		// Each call measures the anchor and updates React state, so coalescing to
		// one per frame is the difference between following the page and taxing
		// it. The position cannot be seen to change faster than a frame anyway.
		let refreshFrame: number | null = null;
		const refreshAnchor = () => {
			if (refreshFrame !== null) return;
			refreshFrame = window.requestAnimationFrame(() => {
				refreshFrame = null;
				setActiveAnchor((anchor) =>
					anchor ? refreshContextAnchor(anchor) : null,
				);
			});
		};

		window.addEventListener("pointermove", handlePointerMove, {
			passive: true,
		});
		window.addEventListener("focusin", handleFocusIn);
		document.addEventListener("selectionchange", handleSelectionChange);
		window.addEventListener("scroll", refreshAnchor, {
			capture: true,
			passive: true,
		});
		window.addEventListener("resize", refreshAnchor);
		return () => {
			clearHoverTimer();
			clearHoverHideTimer();
			if (refreshFrame !== null) window.cancelAnimationFrame(refreshFrame);
			window.removeEventListener("pointermove", handlePointerMove);
			window.removeEventListener("focusin", handleFocusIn);
			document.removeEventListener("selectionchange", handleSelectionChange);
			window.removeEventListener("scroll", refreshAnchor, { capture: true });
			window.removeEventListener("resize", refreshAnchor);
		};
	}, [clearHoverHideTimer, clearHoverTimer, disabled, promptOpen]);

	useEffect(() => {
		if (disabled) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			if (isCoAgentEvent(event)) return;
			const isShortcut =
				event.altKey &&
				event.shiftKey &&
				!event.ctrlKey &&
				!event.metaKey &&
				event.code === "KeyA";
			if (!isShortcut) return;
			const target = event.target instanceof Element ? event.target : null;
			if (isEditableElement(target) && !activeAnchor) return;
			const anchor =
				activeAnchor ||
				createSelectionAnchor() ||
				(target ? createContextAnchor(target, "shortcut") : null);
			if (!anchor || anchor.isStale) return;
			event.preventDefault();
			setActiveAnchor({ ...anchor, kind: "shortcut" });
			onOpenPrompt();
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [activeAnchor, disabled, onOpenPrompt]);

	return {
		activeAnchor,
		freshAnchor,
		setActiveAnchor,
	};
};
