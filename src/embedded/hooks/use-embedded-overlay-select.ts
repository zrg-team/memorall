import { useCallback, useEffect, useRef, useState } from "react";
import { createCanvasSelectOverlay } from "@/embedded/components/CanvasSelectOverlay";
import { createSmartSelectOverlay } from "@/embedded/components/SmartSelectOverlay";
import type { EmbeddedContextItem } from "@/embedded/types";

/**
 * Running one of the page-overlay pickers from the embedded panel.
 *
 * Smart select and canvas select differ only in which overlay they mount, so
 * the start/cancel/teardown dance lives here once. The overlay registry lets
 * only one be open at a time and cancels whichever it displaced, which is what
 * keeps two of these hooks from both believing they are active.
 */

export type OverlaySelectFactory = (
	onSelect: (item: EmbeddedContextItem) => void,
	onCancel: () => void,
) => () => void;

interface UseEmbeddedOverlaySelectOptions {
	createOverlay: OverlaySelectFactory;
	onAttachContext: (contextItem: EmbeddedContextItem) => void;
	onSelected?: () => void;
}

export const useEmbeddedOverlaySelect = ({
	createOverlay,
	onAttachContext,
	onSelected,
}: UseEmbeddedOverlaySelectOptions) => {
	const cleanupRef = useRef<(() => void) | null>(null);
	const [isActive, setIsActive] = useState(false);

	useEffect(() => {
		return () => {
			cleanupRef.current?.();
			cleanupRef.current = null;
		};
	}, []);

	const start = useCallback(() => {
		setIsActive(true);
		cleanupRef.current?.();
		cleanupRef.current = createOverlay(
			(contextItem) => {
				cleanupRef.current = null;
				setIsActive(false);
				onAttachContext(contextItem);
				onSelected?.();
			},
			() => {
				cleanupRef.current = null;
				setIsActive(false);
			},
		);
	}, [createOverlay, onAttachContext, onSelected]);

	const cancel = useCallback(() => {
		cleanupRef.current?.();
		cleanupRef.current = null;
		setIsActive(false);
	}, []);

	return { isActive, start, cancel };
};

type PickerOptions = Omit<UseEmbeddedOverlaySelectOptions, "createOverlay">;

export const useEmbeddedSmartSelect = (options: PickerOptions) => {
	const { isActive, start, cancel } = useEmbeddedOverlaySelect({
		...options,
		createOverlay: createSmartSelectOverlay,
	});
	return {
		isSmartSelectMode: isActive,
		startSmartSelect: start,
		cancelSmartSelect: cancel,
	};
};

export const useEmbeddedCanvasSelect = (options: PickerOptions) => {
	const { isActive, start, cancel } = useEmbeddedOverlaySelect({
		...options,
		createOverlay: createCanvasSelectOverlay,
	});
	return {
		isCanvasSelectMode: isActive,
		startCanvasSelect: start,
		cancelCanvasSelect: cancel,
	};
};
